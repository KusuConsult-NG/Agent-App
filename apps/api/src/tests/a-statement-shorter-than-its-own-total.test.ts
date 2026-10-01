/**
 * A statement whose total counts payments its own list does not show.
 *
 * `paymentHistory` answers "what have I already paid" in two parts: a summary
 * computed over the whole window, and the lines it is made of. The lines were
 * capped at 200 and the summary was not, so a market trader paying a ₦200
 * daily levy — one of four DAILY items in the catalogue — asked for the past
 * year and was told "365 payments, ₦73,000", under a list of 200 of them
 * adding to ₦40,000. Nothing on either screen said the list stopped.
 *
 * Both screens that print this are built to invite exactly that comparison.
 * The citizen's own statement ends "Keep your receipts. If this list and your
 * receipts disagree, take them to a PSIRS office — the receipt is the proof,
 * this is the record." The officer's panel is introduced as "an answer they can
 * check against their receipts". A trader holding 365 receipts against 200
 * lines was being sent to a counter to argue about a ₦33,000 gap that a LIMIT
 * had invented.
 *
 * The platform already knows how to say this: a capped levy roll, a capped
 * agent list and a partial workbench report each carry a line naming the cap
 * and telling the reader to narrow the period. The statement was the one
 * capped list that stayed quiet about it.
 *
 * So the fix is not a bigger cap. It is that the caller is told, and these
 * tests pin the three things that has to mean: the flag is raised when rows
 * were dropped, it is not raised when they were not, and the boundary is the
 * cap itself rather than one either side of it.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, queryOne, query } from '../db/pool';
import {
  createGovernmentUser,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { paymentHistory } from '../services/payment-history';

let officerId: string;
let taxpayerId: string;
let lgaId: string;
let itemMarket: string;

/**
 * A run of settled daily payments, written in three statements.
 *
 * One round trip per payment would be two hundred of them before the first
 * assertion. The shape is the same as the single-payment helper in
 * `what-have-i-already-paid.test.ts` — assessment, invoice, transaction — and
 * `transactions.invoice_id` and `assessment_id` are both NOT NULL, so all
 * three rows have to exist for each payment.
 */
async function dailyPayments(count: number, firstDay: string, amountKobo: number) {
  const rate = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM revenue_item_rates WHERE revenue_item_id = $1 LIMIT 1',
    [itemMarket],
  );

  await query(
    pool,
    `INSERT INTO assessments (assessment_number, taxpayer_id, revenue_item_id, rate_version_id,
                              base_amount_kobo, amount_kobo, period_label, lga_id, created_by)
     SELECT 'ASM-RUN-' || lpad(g::text, 4, '0'), $1, $2, $3, $4, $4,
            to_char($5::date + (g - 1), 'YYYY-MM-DD'), $6, $7
       FROM generate_series(1, $8) g`,
    [taxpayerId, itemMarket, rate!.id, amountKobo, firstDay, lgaId, officerId, count],
  );

  await query(
    pool,
    `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                           total_amount_kobo, verification_code, created_by, status)
     SELECT 'INV-RUN-' || lpad(g::text, 4, '0'), a.id, a.taxpayer_id, a.amount_kobo,
            a.amount_kobo, 'VC-RUN-' || lpad(g::text, 4, '0'), $1, 'PAID'
       FROM generate_series(1, $2) g
       JOIN assessments a ON a.assessment_number = 'ASM-RUN-' || lpad(g::text, 4, '0')`,
    [officerId, count],
  );

  await query(
    pool,
    `INSERT INTO transactions (transaction_reference, taxpayer_id, invoice_id, assessment_id,
                               revenue_item_id, lga_id, channel, amount_kobo, total_amount_kobo,
                               status, verified_at, settled_at, created_by)
     SELECT 'TXN-RUN-' || lpad(g::text, 4, '0'), i.taxpayer_id, i.id, i.assessment_id,
            $1, $2, 'OFFICER', i.amount_kobo, i.amount_kobo, 'SETTLED',
            ($3::date + (g - 1))::timestamptz, ($3::date + (g - 1))::timestamptz, $4
       FROM generate_series(1, $5) g
       JOIN invoices i ON i.invoice_number = 'INV-RUN-' || lpad(g::text, 4, '0')`,
    [itemMarket, lgaId, firstDay, officerId, count],
  );
}

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Revenue Officer',
    phone: '+2348000000002',
    role: 'revenue_officer',
  });
  lgaId = (await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1', []))!
    .id;
  itemMarket = (await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM revenue_items WHERE code = 'MARKET-LEVY'`,
    [],
  ))!.id;
  taxpayerId = (await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            status, source, tin)
     VALUES ('INDIVIDUAL','Amina','Bulus','+2348031000011','7 Terminus Market, Jos',$1,
             'ACTIVE','AGENT','841446134')
     RETURNING id`,
    [lgaId],
  ))!.id;
});

describe('a statement longer than the list it is made of', () => {
  it('says so when the list stops short of the total it printed', async () => {
    // A ₦200 market levy, paid every day for 205 days. Five past the cap, so
    // the window holds more payments than the default list can carry.
    await dailyPayments(205, '2026-02-01', 20_000);

    const history = await paymentHistory(pool, {
      taxpayerId,
      from: '2026-01-01',
      to: '2026-12-31',
    });

    // The summary is over the window, and is right.
    assert.equal(history.summary.payments, 205, 'the summary counts every payment in the window');
    assert.equal(history.summary.totalKobo, String(205 * 20_000));

    // The list is not, and cannot be: 200 is the cap.
    assert.equal(history.rows.length, 200, 'the list is capped');

    /*
     * This is the gap a trader would be arguing about at a counter. Asserted
     * as a figure rather than described, because the point of the flag is
     * that this difference exists and is now disclosed — not that it is small.
     */
    const listed = history.rows.reduce((sum, row) => sum + BigInt(row.amountKobo), 0n);
    assert.equal(listed, BigInt(200 * 20_000));
    assert.equal(BigInt(history.summary.totalKobo) - listed, BigInt(5 * 20_000));

    assert.equal(history.truncated, true, 'the caller is told the list is not all of it');
  });

  it('does not claim a list is short when every payment is on it', async () => {
    await dailyPayments(12, '2026-02-01', 20_000);

    const history = await paymentHistory(pool, {
      taxpayerId,
      from: '2026-01-01',
      to: '2026-12-31',
    });

    assert.equal(history.summary.payments, 12);
    assert.equal(history.rows.length, 12);
    assert.equal(history.truncated, false, 'a complete list does not warn about itself');

    const listed = history.rows.reduce((sum, row) => sum + BigInt(row.amountKobo), 0n);
    assert.equal(
      listed,
      BigInt(history.summary.totalKobo),
      'the lines add up to the total when nothing was dropped',
    );
  });

  it('draws the line at the cap, not one either side of it', async () => {
    await dailyPayments(10, '2026-02-01', 20_000);

    // Exactly as many payments as the caller asked lines for. Nothing was
    // dropped, so nothing is claimed — this is the off-by-one that a
    // `rows.length === limit` test would read as truncation.
    const exact = await paymentHistory(pool, {
      taxpayerId,
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 10,
    });
    assert.equal(exact.rows.length, 10);
    assert.equal(exact.truncated, false, 'a list that fits exactly is complete');

    // One fewer line than there are payments.
    const short = await paymentHistory(pool, {
      taxpayerId,
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 9,
    });
    assert.equal(short.rows.length, 9, 'the extra row fetched to detect this is not returned');
    assert.equal(short.truncated, true);
  });

  it('counts a reversal against the cap, because the list shows it', async () => {
    /*
     * The rows query returns paid and returned payments; the summary's count
     * covers only the paid ones. So `truncated` cannot be derived by comparing
     * `rows.length` with `summary.payments` — a window of 9 paid and 2
     * reversed fills a 10-line list with a payment left over while the
     * summary says 9.
     */
    await dailyPayments(10, '2026-02-01', 20_000);
    await query(
      pool,
      `UPDATE transactions SET status = 'REVERSED', reversed_at = now()
        WHERE transaction_reference = 'TXN-RUN-0001'`,
      [],
    );

    const history = await paymentHistory(pool, {
      taxpayerId,
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 9,
    });

    assert.equal(history.summary.payments, 9, 'nine of the ten are still paid');
    assert.equal(history.rows.length, 9);
    assert.equal(
      history.truncated,
      true,
      'the tenth line is missing even though the paid count matches the line count',
    );
  });
  it('carries the warning out to the citizen, who is the one holding the receipts', async () => {
    /*
     * The public response is built field by field rather than spread — `rows`
     * is rebuilt to drop the receipt numbers — so a new field on
     * `PaymentHistory` reaches the officer's screen automatically and the
     * citizen's not at all. This is the surface where the omission costs
     * somebody something: the officer can widen the dates, and the citizen
     * reading a capped list is the one being told to take their receipts to
     * an office.
     */
    await dailyPayments(205, '2026-02-01', 20_000);

    const asked = await post('/citizen-status/statement/request', { tin: '841446134' });
    assert.equal(asked.status, 200);

    // Out of the message the handset receives, not out of the response: the
    // response carries no code by design.
    const sms = await queryOne<{ message: string }>(
      pool,
      `SELECT COALESCE(secret_message, message) AS message FROM notifications
        WHERE channel = 'SMS' AND recipient = $1
        ORDER BY created_at DESC LIMIT 1`,
      ['+2348031000011'],
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
    assert.equal(response.body.summary.payments, 205);
    assert.equal(response.body.rows.length, 200);
    assert.equal(
      response.body.truncated,
      true,
      'the public statement says its list is not all of it',
    );
  });
});
