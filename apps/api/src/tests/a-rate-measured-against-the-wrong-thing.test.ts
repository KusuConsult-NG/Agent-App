/**
 * A receipt-generation rate that counted every receipt ever issued.
 *
 * `kpis()` publishes three percentages to a government (PRD §91). Two are
 * formed correctly -- the numerator is a `FILTER` over the same rows as the
 * denominator, so it cannot help but be a subset:
 *
 *     count(*) FILTER (WHERE status = 'VERIFIED') / count(*)   FROM payments
 *     count(*) FILTER (WHERE status = 'MATCHED')  / count(*)   FROM reconciliation_records
 *
 * The third was not:
 *
 *     (SELECT count(*) FROM receipts) / count(*)
 *       FROM transactions WHERE status IN (revenue states)
 *
 * Every receipt the platform has ever issued, over the transactions that are
 * in a revenue state *now*. Those two move independently, and a reversal is
 * what separates them: the transaction leaves the revenue states, so it leaves
 * the denominator, while the receipt row stays. It has to stay -- `receipts`
 * carries a `prevent_delete` trigger, and reversing a collection sets the
 * receipt's status to REVERSED rather than removing it.
 *
 * Measured against a database holding one settled collection and its receipt:
 * reverse that transaction and the numerator is 1 while the denominator is 0,
 * so the `count(*) = 0` branch answers "0" -- no receipts are being generated,
 * about a platform that generated one for every collection it took. Three
 * settled and one reversed answers 133.33%. It is wrong in both directions and
 * which way depends on the mix of reversals, which is the worst property a
 * published indicator can have: it looks plausible either way.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  resetDatabase,
  seedOneCollection,
  startTestServer,
  stopTestServer,
} from './helpers';
import { pool, query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { kpis } from '../services/reports';

const ADMIN = '+2348083000001';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'KPI Administrator', phone: ADMIN, role: 'admin' });
  await loginAs(ADMIN);
});

/** The published figure, as a number. */
async function rate(): Promise<number> {
  const row = (await kpis(pool)) as { receipt_generation_rate_percent: string } | null;
  assert.ok(row, 'kpis() returned no row');
  return Number(row.receipt_generation_rate_percent);
}

async function counts(): Promise<{ receipts: number; inRevenueStates: number }> {
  const row = await queryOne<{ receipts: string; denom: string }>(
    pool,
    `SELECT (SELECT count(*) FROM receipts)::text AS receipts,
            (SELECT count(*) FROM transactions
              WHERE status IN ('PAYMENT_VERIFIED','RECEIPT_GENERATED',
                               'RECONCILIATION_PENDING','SETTLED'))::text AS denom`,
  );
  return { receipts: Number(row!.receipts), inRevenueStates: Number(row!.denom) };
}

describe('the receipt generation rate', () => {
  it('is 100% when every collection in a revenue state has a receipt', async () => {
    await seedOneCollection('920');
    await seedOneCollection('921');
    await seedOneCollection('922');

    const { receipts, inRevenueStates } = await counts();
    assert.equal(receipts, 3, 'the fixture must settle three collections, each with a receipt');
    assert.equal(inRevenueStates, 3, 'and leave all three in a revenue state');

    assert.equal(await rate(), 100);
  });

  it('does not exceed 100% once a collection has been reversed', async () => {
    await seedOneCollection('930');
    await seedOneCollection('931');
    await seedOneCollection('932');

    /*
     * The end state, established directly.
     *
     * The route to it is long -- a reversal needs a requester, a separate
     * approver and a third officer to execute, because segregation of duties
     * says so, and `integration.test.ts` walks all of it. None of that is what
     * this test is about: `kpis()` is a read, it looks only at
     * `transactions.status`, and this is the status that walk arrives at.
     * `integration.test.ts` asserts the receipt is left behind as REVERSED,
     * which is the half that makes the arithmetic wrong, so the receipt is put
     * into that state here too rather than being deleted.
     */
    const [victim] = await query<{ id: string }>(
      pool,
      `SELECT id FROM transactions WHERE status IN ('SETTLED','RECEIPT_GENERATED') LIMIT 1`,
    );
    assert.ok(victim, 'no settled transaction to reverse');
    await query(pool, `UPDATE transactions SET status = 'REVERSED' WHERE id = $1`, [victim.id]);
    await query(pool, `UPDATE receipts SET status = 'REVERSED' WHERE transaction_id = $1`, [
      victim.id,
    ]);

    const { receipts, inRevenueStates } = await counts();
    assert.equal(receipts, 3, 'the receipt survives the reversal — that is the point');
    assert.equal(inRevenueStates, 2, 'and its transaction has left the revenue states');

    /*
     * Two assertions, and the second is the one that fails on the old query.
     *
     * A percentage above 100 is the visible symptom: three over two is 150.
     * The equality is the property — the two collections still in a revenue
     * state both have receipts, so the honest answer is 100.
     */
    const published = await rate();
    assert.ok(published <= 100, `a rate of ${published}% is not a rate`);
    assert.equal(published, 100, 'both remaining collections have a receipt');
  });

  it('falls when a collection in a revenue state has no receipt', async () => {
    await seedOneCollection('940');
    await seedOneCollection('941');
    // Confirmed but not settled: the money is recognised and the citizen has
    // no receipt yet, which is precisely what this indicator exists to count.
    await seedOneCollection('942', { settle: false });

    const { receipts, inRevenueStates } = await counts();
    assert.equal(receipts, 2, 'two settled collections have receipts');
    assert.equal(inRevenueStates, 3, 'and all three are in a revenue state');

    /*
     * THE CONTROL, not a discriminator, and the difference matters.
     *
     * Both the old query and the new one answer 66.67 here -- two receipts
     * over three transactions either way. It earns its place regardless: the
     * two cases above both assert 100, and a fix that simply returned 100
     * would satisfy them. This is the case that says the figure is computed
     * rather than assumed.
     */
    assert.equal(await rate(), 66.67);
  });
});
