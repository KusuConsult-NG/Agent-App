/**
 * Four figures on the outstanding screen, over the rows they could see.
 *
 * `Outstanding.tsx` draws five numbers: money owed to taxpayers, refunds not
 * made, taxpayers waiting for a TIN, and two vehicle queues. Three of them
 * came from arrays the API caps at a hundred rows and returns bare — so the
 * screen summed what it was handed and counted its length.
 *
 *   const owedKobo = (refunds ?? []).reduce((t, r) => t + BigInt(r.amount_kobo), 0n);
 *   <Stat label="ofcOsOwedToTaxpayers" value={<Money kobo={owedKobo…} />} />
 *   <Stat label="ofcOsRefundsNotMade" value={String(refunds?.length ?? 0)} />
 *
 * Past the cap every one of those is a subtotal presented as a total, on the
 * screen whose job is to say what the State owes citizens, and in the
 * direction that understates it.
 *
 * This is the gap `a-list-that-said-how-much-it-left-out.test.ts` recorded and
 * left open — "They still draw a capped list without saying so; that is a
 * separate gap on a separate surface and is not closed here" — and the shape
 * `four-figures-for-two-hundred-agents.test.tsx` answered on the performance
 * screen by saying what the figures covered, because there "the endpoint
 * answers with a bare array and no count of what it matched".
 *
 * Here the endpoint can answer. `count(*) OVER ()` and `SUM(…) OVER ()` are
 * evaluated before LIMIT, so one query returns the page and the size of what
 * it came from, and the figures are right rather than merely caveated.
 *
 * THE CAP IS DRIVEN DOWN RATHER THAN REACHED
 *
 * Filling a table past a hundred rows would prove the fixture. Each of these
 * takes `limit`, so the cap is reached by asking for a small one — the same
 * code path, the same window functions, the same slice. That is the technique
 * the earlier cap test settled on, for the same reason.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  pool,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { outstandingRefunds } from '../services/reconciliation';
import { taxpayersAwaitingTin, taxpayersEndedWithArrears } from '../services/taxpayers';
import {
  outstandingAuthorityNotifications,
  vehiclesAwaitingAuthority,
} from '../services/vehicles';

const OFFICER = '+2348089600001';
const APPROVER = '+2348089600002';
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: OFFICER, fullName: 'Queue Officer' });
  await createGovernmentUser({ role: 'admin', phone: APPROVER, fullName: 'Queue Approver' });
  lgaId = await firstLgaId();
});

/** A taxpayer, written straight in: what is under test is which rows a count counts. */
async function taxpayer(suffix: string, extra: { tinStatus?: string; status?: string } = {}) {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            status, source, tin_status)
     VALUES ('INDIVIDUAL','Queue',$1,$2,'3 Ahmadu Bello Way',$3,$4,'AGENT',$5)
     RETURNING id`,
    [
      suffix,
      `+23480896${suffix.padStart(5, '0')}`,
      lgaId,
      extra.status ?? 'ACTIVE',
      extra.tinStatus ?? 'ASSIGNED',
    ],
  );
  return row!.id;
}

/** One unpaid invoice against a taxpayer, so an ended record still owes. */
async function owes(taxpayerId: string, suffix: string, kobo: number) {
  const item = await revenueItemByCode('SHOPS-KIOSKS');
  const rate = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM revenue_item_rates WHERE revenue_item_id = $1 LIMIT 1',
    [item],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments (assessment_number, taxpayer_id, revenue_item_id, rate_version_id,
                              computation_inputs, computation_trace, base_amount_kobo,
                              amount_kobo, lga_id, status, created_by)
     SELECT 'ASM-Q-' || $5, $1, $2, $3, '{}'::jsonb, '[]'::jsonb, $4, $4, $6, 'INVOICED', u.id
       FROM users u WHERE u.phone = $7 LIMIT 1
     RETURNING id`,
    [taxpayerId, item, rate!.id, String(kobo), suffix, lgaId, OFFICER],
  );
  await query(
    pool,
    `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                           total_amount_kobo, verification_code, created_by, status)
     SELECT 'INV-Q-' || $4, $1, $2, $3, $3, 'QCODE' || $4, u.id, 'UNPAID'
       FROM users u WHERE u.phone = $5 LIMIT 1`,
    [assessment!.id, taxpayerId, String(kobo), suffix, OFFICER],
  );
}

/** A refund awaiting the taxpayer, on a chain written straight in. */
async function refundOf(kobo: number, suffix: string) {
  const subject = await taxpayer(`r${suffix}`);
  await owes(subject, `r${suffix}`, kobo);
  const invoice = await queryOne<{ id: string; assessment_id: string }>(
    pool,
    'SELECT id, assessment_id FROM invoices WHERE taxpayer_id = $1',
    [subject],
  );
  const item = await revenueItemByCode('SHOPS-KIOSKS');
  const transaction = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO transactions (transaction_reference, invoice_id, assessment_id, taxpayer_id,
                               revenue_item_id, lga_id, amount_kobo, total_amount_kobo,
                               created_by, channel, status)
     SELECT 'TXN-Q-' || $5, $1, $2, $3, $4, $6, $7, $7, u.id, 'OFFICER', 'REVERSED'
       FROM users u WHERE u.phone = $8 LIMIT 1
     RETURNING id`,
    [invoice!.id, invoice!.assessment_id, subject, item, suffix, lgaId, String(kobo), OFFICER],
  );
  const payment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO payments (payment_reference, transaction_id, amount_kobo, payment_method,
                           gateway, status)
     VALUES ('PAY-Q-' || $2, $1, $3, 'CARD', 'mock', 'REVERSED') RETURNING id`,
    [transaction!.id, suffix, String(kobo)],
  );
  const approval = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO approvals (approval_type, entity_type, entity_id, payload, requested_by,
                            requested_reason, status, approved_by, approved_at, decision_reason)
     SELECT 'PAYMENT_REVERSAL', 'transaction', $1::text, '{}'::jsonb, maker.id,
            'Seeded for the queue test', 'APPROVED', checker.id, now(), 'Approved'
       FROM (SELECT id FROM users WHERE phone = $2) maker,
            (SELECT id FROM users WHERE phone = $3) checker
     RETURNING id`,
    [transaction!.id, OFFICER, APPROVER],
  );
  await query(
    pool,
    `INSERT INTO refunds (refund_reference, transaction_id, payment_id, amount_kobo, refund_type,
                          reason, approval_id, requested_by, approved_by, approved_at, status,
                          attributable_to)
     SELECT 'REF-Q-' || $5, $1, $2, $3, 'REVERSAL', 'Seeded', $4, maker.id, checker.id,
            now(), 'PENDING', 'GOVERNMENT'
       FROM (SELECT id FROM users WHERE phone = $6) maker,
            (SELECT id FROM users WHERE phone = $7) checker`,
    [transaction!.id, payment!.id, String(kobo), approval!.id, suffix, OFFICER, APPROVER],
  );
}

describe('what the State owes taxpayers, over all of it', () => {
  it('counts and sums every outstanding refund, not the page of them', async () => {
    await refundOf(100_000, '1');
    await refundOf(250_000, '2');
    await refundOf(400_000, '3');

    const capped = await outstandingRefunds(pool, 2);
    assert.equal(capped.refunds.length, 2, 'the page is the size that was asked for');
    assert.equal(capped.matched, 3, 'and the count is of everything outstanding');
    assert.equal(
      capped.owedKobo,
      '750000',
      'the money owed is the sum of the page rather than of the backlog',
    );
    assert.equal(capped.cap, 2, 'and the screen can tell the page from the whole');

    // The row the cap excluded carries no sign of the aggregate it contributed to.
    assert.ok(
      capped.refunds.every((row) => !('matched' in row) && !('owed_kobo' in row)),
      'the window functions were shipped to the client on every row',
    );
  });

  it('answers an empty queue with zero rather than with nothing', async () => {
    const none = await outstandingRefunds(pool, 2);
    assert.deepEqual(none, { refunds: [], matched: 0, owedKobo: '0', cap: 2 });
  });
});

describe('the two taxpayer queues beside it', () => {
  it('counts every taxpayer waiting for a TIN', async () => {
    for (const n of ['1', '2', '3']) {
      await taxpayer(`t${n}`, { tinStatus: 'REQUESTED' });
      await query(pool, `UPDATE taxpayers SET tin = NULL WHERE phone = $1`, [
        `+23480896${`t${n}`.padStart(5, '0')}`,
      ]);
    }

    const capped = await taxpayersAwaitingTin(pool, 2);
    assert.equal(capped.taxpayers.length, 2);
    assert.equal(capped.matched, 3, 'the queue is longer than the page and says so');
    assert.equal(capped.cap, 2);
  });

  it('counts every ended record that still owes', async () => {
    for (const n of ['1', '2', '3']) {
      const id = await taxpayer(`e${n}`, { status: 'SUSPENDED' });
      await owes(id, `e${n}`, 150_000);
    }

    const capped = await taxpayersEndedWithArrears(pool, 2);
    assert.equal(capped.taxpayers.length, 2);
    assert.equal(
      capped.matched,
      3,
      'the count is of invoices rather than of the people who owe them',
    );
    assert.equal(capped.cap, 2);
  });
});

describe('the two vehicle queues, which I first said were not capped', () => {
  /*
   * They are. The commit that fixed the other three said "three came from
   * arrays the API caps", and all five do — these two were asserted rather
   * than checked. Counted here the same way.
   */
  async function vehicle(suffix: string, outcome: string) {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO vehicles (registration_number, owner_name, vehicle_type, source,
                             authority_lookup_outcome, status)
       VALUES ($1, 'Queue Owner', 'PRIVATE_CAR', 'MANUAL_ENTRY', $2, 'ACTIVE')
       RETURNING id`,
      [`PL-Q${suffix}-QQ`, outcome],
    );
    return row!.id;
  }

  it('counts every vehicle captured while the authority was unreachable', async () => {
    for (const n of ['1', '2', '3']) await vehicle(n, 'UNAVAILABLE');
    // One that was actually checked, so the predicate is doing work.
    await vehicle('4', 'FOUND');

    const capped = await vehiclesAwaitingAuthority(pool, 2);
    assert.equal(capped.vehicles.length, 2);
    assert.equal(capped.matched, 3, 'the queue is longer than the page and says so');
    assert.equal(capped.cap, 2);
  });

  it('answers an empty authority queue with zero', async () => {
    const none = await outstandingAuthorityNotifications(pool, 2);
    assert.deepEqual(none, { renewals: [], matched: 0, cap: 2 });
  });
});
