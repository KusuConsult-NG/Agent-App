/**
 * The question a taxpayer asks at a counter.
 *
 * The platform could always say what somebody owed. It had no view of what
 * they had already settled, which meant a market trader with a shoebox of
 * faded thermal receipts was the only archive of their own payments — and when
 * that archive and PSIRS disagreed, the trader lost.
 *
 * Four things have to be true of the answer, and each is a way the feature
 * would otherwise mislead somebody:
 *
 *   1. It says what the money was for. "Eleven payments" is not an answer to
 *      "what have I paid"; "market levy, eleven times" is.
 *   2. The period means what a person reading it means. A window ending on the
 *      31st includes the 31st.
 *   3. Money that came back is shown, not quietly dropped, and does not count
 *      towards what the trade cost.
 *   4. It is not a second opinion. What counts as paid here is what counts as
 *      paid in the compliance score, or a citizen reads a receipt on one
 *      screen and "you missed a payment" on another.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, queryOne, query } from '../db/pool';
import {
  createGovernmentUser,
  get,
  loginAs,
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
let itemShops: string;

/** A settled payment on a date, written directly: the point is the reading. */
async function payment(opts: {
  item: string;
  amountKobo: number;
  on: string;
  status?: string;
  periodLabel?: string;
  reference?: string;
}) {
  const suffix = opts.reference ?? Math.random().toString(36).slice(2, 10).toUpperCase();
  const rate = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM revenue_item_rates WHERE revenue_item_id = $1 LIMIT 1',
    [opts.item],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments (assessment_number, taxpayer_id, revenue_item_id, rate_version_id,
                              base_amount_kobo, amount_kobo, period_label, lga_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8) RETURNING id`,
    [`ASM-${suffix}`, taxpayerId, opts.item, rate!.id, opts.amountKobo,
     opts.periodLabel ?? null, lgaId, officerId],
  );
  const invoice = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                           total_amount_kobo, verification_code, created_by, status)
     VALUES ($1,$2,$3,$4,$4,$5,$6,'PAID') RETURNING id`,
    [`INV-${suffix}`, assessment!.id, taxpayerId, opts.amountKobo, `VC-${suffix}`, officerId],
  );
  const transaction = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO transactions (transaction_reference, taxpayer_id, invoice_id, assessment_id,
                               revenue_item_id, lga_id, channel, amount_kobo, total_amount_kobo,
                               status, verified_at, settled_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'OFFICER',$7,$7,$8,$9::timestamptz,$9::timestamptz,$10)
     RETURNING id`,
    [
      `TXN-${suffix}`,
      taxpayerId, invoice!.id, assessment!.id, opts.item, lgaId,
      opts.amountKobo, opts.status ?? 'SETTLED', opts.on, officerId,
    ],
  );
  return transaction!.id;
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
  itemMarket = (await queryOne<{ id: string }>(
    pool, `SELECT id FROM revenue_items WHERE code = 'MARKET-LEVY'`, []))!.id;
  itemShops = (await queryOne<{ id: string }>(
    pool, `SELECT id FROM revenue_items WHERE code = 'SHOPS-KIOSKS'`, []))!.id;
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

describe('what a taxpayer has already paid', () => {
  it('says what the money was for, not just how much', async () => {
    await payment({ item: itemMarket, amountKobo: 20_000, on: '2026-03-04' });
    await payment({ item: itemMarket, amountKobo: 20_000, on: '2026-03-11' });
    await payment({ item: itemShops, amountKobo: 300_000, on: '2026-04-01' });

    const history = await paymentHistory(pool, {
      taxpayerId,
      from: '2026-01-01',
      to: '2026-12-31',
    });

    assert.equal(history.summary.payments, 3);
    assert.equal(history.summary.totalKobo, '340000');

    const items = history.summary.byItem;
    assert.equal(items.length, 2, 'two levies, not three payments');
    assert.equal(items[0]!.revenueItem, 'Shops and Kiosks Rates', 'largest first');
    assert.equal(items[0]!.totalKobo, '300000');
    const market = items.find((row) => row.revenueItem === 'Market Tax and Levy');
    assert.equal(market!.payments, 2);
    assert.equal(market!.totalKobo, '40000');
  });

  it('includes the last day of the period a person asked for', async () => {
    /*
     * `to` is a date and the payment carries a time. Compared with a plain
     * `<=` the whole of the closing day disappears — and the taxpayer asking
     * "what did I pay in March" is told nothing about the 31st, which is
     * exactly the day a monthly levy is most likely to be settled on.
     */
    await payment({ item: itemMarket, amountKobo: 20_000, on: '2026-03-31T14:30:00Z' });

    /*
     * All three, because the window is written into three separate queries —
     * the rows, the totals and the by-levy breakdown. Asserting on one of them
     * leaves the other two free to disagree, and the shape that produces is a
     * screen reading "1 payment, ₦200.00" above an empty list, which is worse
     * than either answer alone.
     */
    const inside = await paymentHistory(pool, { taxpayerId, from: '2026-03-01', to: '2026-03-31' });
    assert.equal(inside.summary.payments, 1, 'the closing day is inside the window');
    assert.equal(inside.rows.length, 1, 'and the row for it is there too');
    assert.equal(inside.summary.byItem.length, 1, 'and it is counted against its levy');

    const before = await paymentHistory(pool, { taxpayerId, from: '2026-03-01', to: '2026-03-30' });
    assert.equal(before.summary.payments, 0, 'and the day before it is not');
    assert.equal(before.rows.length, 0);
    assert.equal(before.summary.byItem.length, 0);
  });

  it('shows money that came back, and does not count it as spending', async () => {
    await payment({ item: itemMarket, amountKobo: 20_000, on: '2026-05-02' });
    await payment({ item: itemMarket, amountKobo: 50_000, on: '2026-05-03', status: 'REVERSED' });

    const history = await paymentHistory(pool, { taxpayerId, from: '2026-05-01', to: '2026-05-31' });

    assert.equal(history.rows.length, 2, 'both are on the record');
    assert.equal(history.summary.payments, 1, 'but only one was a payment');
    assert.equal(history.summary.totalKobo, '20000');
    assert.equal(history.summary.returnedKobo, '50000');
    assert.equal(
      history.summary.byItem[0]!.totalKobo,
      '20000',
      'a reversal did not make the levy look more expensive than it was',
    );
    assert.ok(history.rows.some((row) => row.returned));
  });

  it('counts as paid exactly what the compliance score counts as paid', async () => {
    /*
     * Not a restatement of the constant — a comparison against the score's own
     * behaviour. RECONCILIATION_PENDING is the interesting one: the money has
     * been confirmed but has not reached a government account, and a history
     * that excluded it would tell somebody holding an acknowledgement that
     * they had paid nothing.
     */
    await payment({ item: itemMarket, amountKobo: 20_000, on: '2026-06-01',
                    status: 'RECONCILIATION_PENDING' });
    await payment({ item: itemMarket, amountKobo: 20_000, on: '2026-06-02',
                    status: 'RECEIPT_GENERATED' });
    await payment({ item: itemMarket, amountKobo: 99_000, on: '2026-06-03', status: 'PAYMENT_PENDING' });

    const history = await paymentHistory(pool, { taxpayerId, from: '2026-06-01', to: '2026-06-30' });
    assert.equal(history.summary.payments, 2);
    assert.equal(
      history.summary.totalKobo,
      '40000',
      'money that has not been confirmed is not something the taxpayer has paid',
    );
  });

  it('refuses a period that runs backwards', async () => {
    await assert.rejects(
      paymentHistory(pool, { taxpayerId, from: '2026-12-31', to: '2026-01-01' }),
      /after its end/i,
    );
  });

  it('is reachable by an officer who has just found the person', async () => {
    await payment({ item: itemMarket, amountKobo: 20_000, on: '2026-03-04' });
    const officer = await loginAs('+2348000000002');

    const response = await get(
      `/government/taxpayers/${taxpayerId}/payments?from=2026-01-01&to=2026-12-31`,
      { token: officer.accessToken },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.summary.payments, 1);
    assert.equal(response.body.rows[0].revenueItem, 'Market Tax and Levy');
  });

  it('refuses an officer whose territories do not include this taxpayer', async () => {
    /*
     * Refused rather than emptied. An officer holding a territory permission
     * who got back "no payments" for somebody in another Council would read
     * that as a fact about the taxpayer rather than about their own reach.
     */
    const supervisorId = await createGovernmentUser({
      fullName: 'Territory Supervisor',
      phone: '+2348000000004',
      role: 'supervisor',
    });
    const elsewhere = await queryOne<{ id: string }>(
      pool, 'SELECT id FROM lgas WHERE id <> $1 LIMIT 1', [lgaId]);
    const territory = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO territories (name, code, lga_id, status)
       VALUES ('Somewhere Else', $2, $1, 'ACTIVE') RETURNING id`,
      // The seed already lays down a territory per LGA, so the code has to be
      // one nothing else claims.
      [elsewhere!.id, `TER-ELSEWHERE-${Date.now()}`],
    );
    await query(
      pool,
      `INSERT INTO user_territories (user_id, territory_id, assigned_by)
       VALUES ($1,$2,$1) ON CONFLICT DO NOTHING`,
      [supervisorId, territory!.id],
    );

    const supervisor = await loginAs('+2348000000004');
    const response = await get(
      `/government/taxpayers/${taxpayerId}/payments?from=2026-01-01&to=2026-12-31`,
      { token: supervisor.accessToken },
    );
    assert.equal(response.status, 403, JSON.stringify(response.body));
  });
});
