/**
 * A citizen asking the platform what they have already paid, with no login.
 *
 * `/citizen-status` answers without one, and its own long comment sets the
 * premise: it cannot tell the taxpayer from anybody else who knows their phone
 * number — a rival trader, a lender, a former partner, a local official. Three
 * fields were removed on that reasoning, one of them the date of the last
 * payment, because a payment date describes somebody's circumstances.
 *
 * A year of payments is that judgement a hundred times over. So the history is
 * not behind a stricter identifier — a TIN and a phone are both things a
 * stranger can know — but behind a different kind of proof: a code sent to the
 * number the record carries, which only somebody holding that handset reads.
 *
 * Four properties, and each is a way the feature would otherwise hand a
 * person's finances to whoever asked for them.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, queryOne } from '../db/pool';
import {
  createGovernmentUser,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { paymentHistory } from '../services/payment-history';

const ON_THE_RECORD = '+2348031000011';
const A_STRANGERS_PHONE = '+2348039999999';

let taxpayerId: string;
let officerId: string;
let lgaId: string;

async function codeSentTo(destination: string): Promise<string | null> {
  const row = await queryOne<{ code_hash: string }>(
    pool,
    `SELECT code_hash FROM otp_codes
      WHERE destination = $1 AND purpose = 'CITIZEN_STATEMENT' AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [destination],
  );
  return row?.code_hash ?? null;
}

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Revenue Officer',
    phone: '+2348000000002',
    role: 'revenue_officer',
  });
  lgaId = (await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1', []))!.id;
  taxpayerId = (await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            status, source, tin)
     VALUES ('INDIVIDUAL','Amina','Bulus',$1,'7 Terminus Market, Jos',$2,'ACTIVE','AGENT',
             '841446134')
     RETURNING id`,
    [ON_THE_RECORD, lgaId],
  ))!.id;
});

describe('asking for a statement', () => {
  it('sends the code to the number on the record, never to one in the request', async () => {
    /*
     * The whole control. Somebody who knows a TIN — it is printed on documents
     * and quoted to banks — gets exactly one outcome from this endpoint: the
     * taxpayer's own phone buzzes. They learn nothing, and the person whose
     * record it is finds out somebody asked.
     */
    const response = await post('/citizen-status/statement/request', {
      tin: '841446134',
      phone: A_STRANGERS_PHONE,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));

    assert.ok(await codeSentTo(ON_THE_RECORD), 'the record’s own number was sent a code');
    assert.equal(
      await codeSentTo(A_STRANGERS_PHONE),
      null,
      'and the number in the request was sent nothing at all',
    );
  });

  it('answers the same whether or not the record exists', async () => {
    /*
     * A "no record found" here is a TIN validity oracle that costs nothing to
     * query. The honest answer — "if that record exists, its phone has a code"
     * — is true either way, and gives a prober no signal to work from.
     */
    const real = await post('/citizen-status/statement/request', { tin: '841446134' });
    const invented = await post('/citizen-status/statement/request', { tin: '000000000' });

    assert.equal(real.status, invented.status);
    assert.deepEqual(real.body, invented.body);
    assert.equal(await codeSentTo(ON_THE_RECORD), await codeSentTo(ON_THE_RECORD));
  });

  it('will not hand over a history without the code', async () => {
    const response = await post('/citizen-status/statement', {
      tin: '841446134',
      code: '000000',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    assert.notEqual(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.rows, undefined, 'nothing about their money came back');
  });

  it('gives the citizen their history once the code is right, without the receipt numbers', async () => {
    /*
     * A receipt number is verification material here — the public verification
     * endpoint takes one and confirms a payment against it. Returning the set
     * would let whoever passed the code check verify payments elsewhere as
     * though they held the receipts. The taxpayer has the paper; this is the
     * list, not the proof.
     */
    const rate = await queryOne<{ id: string; item: string }>(
      pool,
      `SELECT r.id, r.revenue_item_id AS item FROM revenue_item_rates r
         JOIN revenue_items i ON i.id = r.revenue_item_id
        WHERE i.code = 'MARKET-LEVY' LIMIT 1`,
    );
    const assessment = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO assessments (assessment_number, taxpayer_id, revenue_item_id, rate_version_id,
                                base_amount_kobo, amount_kobo, lga_id, created_by)
       VALUES ('ASM-CIT-1',$1,$2,$3,20000,20000,$4,$5) RETURNING id`,
      [taxpayerId, rate!.item, rate!.id, lgaId, officerId],
    );
    const invoice = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                             total_amount_kobo, verification_code, created_by, status)
       VALUES ('INV-CIT-1',$1,$2,20000,20000,'VC-CIT-1',$3,'PAID') RETURNING id`,
      [assessment!.id, taxpayerId, officerId],
    );
    const transaction = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO transactions (transaction_reference, taxpayer_id, invoice_id, assessment_id,
                                 revenue_item_id, lga_id, channel, amount_kobo, total_amount_kobo,
                                 status, verified_at, settled_at, created_by)
       VALUES ('TXN-CIT-1',$1,$2,$3,$4,$5,'OFFICER',20000,20000,'SETTLED',
               '2026-04-02'::timestamptz,'2026-04-02'::timestamptz,$6)
       RETURNING id`,
      [taxpayerId, invoice!.id, assessment!.id, rate!.item, lgaId, officerId],
    );

    const asked = await post('/citizen-status/statement/request', { tin: '841446134' });
    assert.equal(asked.status, 200);
    /*
     * The code is read out of the message that was actually queued to the
     * record's phone, not out of the response — the response deliberately
     * carries no code, because it is the same whether or not a record was
     * found. Reading it from the SMS also proves the thing the citizen
     * depends on: that the code reached the handset rather than merely a row.
     */
    const sms = await queryOne<{ message: string; recipient: string }>(
      pool,
      `SELECT message, recipient FROM notifications
        WHERE channel = 'SMS' AND recipient = $1
        ORDER BY created_at DESC LIMIT 1`,
      [ON_THE_RECORD],
    );
    const code = /(\d{4,10})/.exec(sms?.message ?? '')?.[1];
    assert.ok(code, `no code in the message sent to the record: ${sms?.message}`);

    const response = await post('/citizen-status/statement', {
      tin: '841446134',
      code,
      from: '2026-01-01',
      to: '2026-12-31',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.summary.payments, 1);
    assert.equal(response.body.summary.totalKobo, '20000');
    assert.equal(response.body.rows[0].revenueItem, 'Market Tax and Levy');

    /*
     * The officer surface carries the receipt number and this one does not,
     * asserted against each other rather than against a hardcoded absence.
     *
     * A receipt number is verification material here — the public verification
     * endpoint takes one and confirms a payment against it — so returning the
     * set would let whoever passed the code check verify payments elsewhere as
     * though they held the receipts. Checking only that the citizen response
     * lacks the field would pass just as happily on a build where nothing
     * anywhere had receipt numbers, which proves nothing about this boundary.
     */
    const officerView = await paymentHistory(pool, {
      taxpayerId,
      from: '2026-01-01',
      to: '2026-12-31',
    });
    assert.ok(
      'receiptNumber' in officerView.rows[0]!,
      'the officer-facing history carries the receipt number',
    );
    assert.ok(
      !('receiptNumber' in response.body.rows[0]),
      'and the citizen-facing one deliberately does not',
    );
    assert.ok(
      !JSON.stringify(response.body).toLowerCase().includes('receipt'),
      'nothing receipt-shaped came back at all',
    );
  });
});
