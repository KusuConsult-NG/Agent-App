/**
 * A closed month, and the writes it refuses.
 *
 * A settled month was still writable. Everything PSIRS reported to the
 * Accountant-General for March could be changed in April by a reversal, a
 * backdated settlement or a commission adjustment, and nothing anywhere said it
 * had happened after the books were reported.
 *
 * WHAT IS ACTUALLY BEING TESTED
 *
 * Not that a row can be marked closed. That the *database* refuses the write —
 * issued as SQL, bypassing the service entirely, which is this report's own
 * standard from migrations 040 and 053: a rule that only holds when you go
 * through the service layer is not an invariant, and the whole value of a
 * closed month is that nobody can get past it.
 *
 * And three things around the edge that decide whether the control is usable:
 *
 *   * An open month is unaffected. A lock that stops today's collections is a
 *     lock somebody turns off.
 *   * Moving a row *out of* a closed month is refused too — checking only the
 *     new date would let somebody empty a closed period one row at a time.
 *   * Reconciliation is deliberately not locked, because a run over a closed
 *     month is how you discover it was wrong.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const PHONES = {
  admin: '+2348076000001',
  finance: '+2348076000002',
  revenue: '+2348076000003',
};
const tokens: Record<string, string> = {};
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
  for (const [key, phone] of Object.entries(PHONES)) {
    await createGovernmentUser({
      fullName: `Period ${key}`,
      phone,
      role: key === 'admin' ? 'admin' : key === 'finance' ? 'finance_officer' : 'revenue_officer',
    });
    tokens[key] = (await loginAs(phone)).accessToken;
  }
  lgaId = await firstLgaId();
});

const auth = (who: keyof typeof PHONES) => ({ token: tokens[who] });
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Last month, which is the month a real close is always about. */
function lastMonth(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
  };
}

async function openPeriod(bounds = lastMonth()) {
  const created = await post(
    '/government/periods',
    { periodStart: iso(bounds.start), periodEnd: iso(bounds.end) },
    auth('finance'),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body as { id: string; label: string };
}

async function close(periodId: string, body: Record<string, unknown> = {}) {
  await grantStepUp(tokens.finance, PHONES.finance, 'financial.period.close');
  return post(
    `/government/periods/${periodId}/close`,
    { note: 'March reconciled and reported to the Accountant-General.', ...body },
    auth('finance'),
  );
}

/** A verified collection dated inside a chosen month. */
async function backdatedCollection(when: Date, amountKobo = 5_000_000n): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO transactions (
       transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
       lga_id, amount_kobo, total_amount_kobo, status, created_by, created_at, territory_id
     )
     SELECT 'TXN-PER-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
            t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
            'SETTLED', t.created_by, $2, t.territory_id
       FROM transactions t WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1
     RETURNING id`,
    [amountKobo.toString(), when],
  );
  assert.ok(row, 'a settled transaction existed to copy');
  return row!.id;
}

/** One real collection, so there is something in the books at all. */
async function collect(label: string): Promise<string> {
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Period',
      lastName: `Subject${label}`,
      phone: `+2348150000${label.padStart(3, '0')}`,
      address: '11 Ledger Street, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `per-tp-${label}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `per-as-${label}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `per-pay-${label}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );
  await settleTransaction(assessment.body.transactionId);
  return assessment.body.transactionId;
}

// ===========================================================================
describe('closing a month', () => {
  it('freezes what it collected, rather than promising to recompute it', async () => {
    await collect('1');
    const bounds = lastMonth();
    await backdatedCollection(bounds.start, 7_000_000n);

    const period = await openPeriod(bounds);
    const closed = await close(period.id);
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.collectedKobo, '7000000');

    const listed = await get('/government/periods', auth('revenue'));
    const row = (listed.body as Record<string, string>[])[0]!;
    assert.equal(row.status, 'CLOSED');
    assert.equal(row.collected_kobo, '7000000');
    assert.equal(row.closed_by_name, 'Period finance');
  });

  /*
   * The guarantee, tested where it has to hold.
   *
   * Issued as SQL rather than through the service, because a period lock
   * enforced in TypeScript is a lock a compromised service account or a DBA at
   * a psql prompt walks straight through — and the entire value of a closed
   * month is that nobody can.
   */
  it('refuses a write into it, at the database', async () => {
    await collect('2');
    const bounds = lastMonth();
    const transactionId = await backdatedCollection(bounds.start);
    const period = await openPeriod(bounds);
    assert.equal((await close(period.id)).status, 200);

    // A new collection dated inside the closed month.
    await assert.rejects(() => backdatedCollection(bounds.start), /is closed/);

    /*
     * And a change to one already in it.
     *
     * `status_reason` deliberately: `amount_kobo` and `created_at` are already
     * frozen by migration 001's immutability trigger, so an update to either
     * would be refused whether or not this control existed and would prove
     * nothing about it. This is a column the platform *does* let an officer
     * change, on a row inside a closed month.
     */
    await assert.rejects(
      () =>
        query(pool, `UPDATE transactions SET status_reason = 'edited' WHERE id = $1`, [
          transactionId,
        ]),
      /cannot be changed/,
    );

    /*
     * And a deletion out of it, which two controls now refuse.
     *
     * The append-only trigger from the schema audit gets there first on this
     * table, and its message is the one that comes back. That is the right
     * outcome and worth stating rather than working around: the period lock is
     * the second line here, and the first line on tables that have no
     * append-only rule of their own — a settlement, for instance, which the
     * test below moves rather than deletes for exactly that reason.
     */
    await assert.rejects(
      () => query(pool, 'DELETE FROM transactions WHERE id = $1', [transactionId]),
      /append-only|cannot be changed/,
    );
  });

  /*
   * Moving a row *out of* a closed month is a change to that month's figures.
   *
   * Checking only the new date would let somebody empty a closed period one row
   * at a time, which is the exact shape of the leak this control exists to
   * prevent.
   */
  it('refuses a row being dragged out of a closed month as well as into one', async () => {
    await collect('3');
    const bounds = lastMonth();

    /*
     * Demonstrated on a settlement, because a transaction's `created_at` is
     * already immutable and cannot be dragged anywhere.
     *
     * A settlement's date is not, and it is exactly the row somebody would move
     * to empty a closed month: shift the government credit into April and
     * March's settled figure drops without a single deletion. Checking only the
     * new date would allow it.
     */
    await query(
      pool,
      `INSERT INTO settlements
         (settlement_reference, gateway, settlement_date, expected_amount_kobo,
          received_amount_kobo, status)
       /*
        * RECONCILED, not RECEIVED. recordSettlement already knows whether the
        * money matched when it writes the row, so there is no moment at which
        * a settlement is merely received, and enum-coverage.ts declares that.
        * A fixture writing RECEIVED would make the declaration false.
        */
       VALUES ('STL-CLOSED-1', 'PAYSTACK', $1, 5000000, 5000000, 'RECONCILED')`,
      [bounds.start],
    );

    const period = await openPeriod(bounds);
    assert.equal((await close(period.id)).status, 200);

    await assert.rejects(
      () =>
        query(pool, `UPDATE settlements SET settlement_date = CURRENT_DATE
                      WHERE settlement_reference = 'STL-CLOSED-1'`),
      /cannot be changed/,
    );
  });

  /*
   * A lock that stops today's collections is a lock somebody turns off.
   */
  it('leaves an open month entirely alone', async () => {
    await collect('4');
    const bounds = lastMonth();
    const period = await openPeriod(bounds);
    assert.equal((await close(period.id)).status, 200);

    // Today is in no closed period, so the field carries on working.
    const transactionId = await collect('5');
    assert.ok(transactionId, 'a collection today still goes through');
  });

  /*
   * Reconciliation is deliberately not locked.
   *
   * A reconciliation run over a closed month is how you discover it was wrong,
   * and refusing it would make the lock hide the thing it exists to surface.
   */
  it('still lets a reconciliation run examine a closed month', async () => {
    await collect('6');
    const bounds = lastMonth();
    await backdatedCollection(bounds.start);
    const period = await openPeriod(bounds);
    assert.equal((await close(period.id)).status, 200);

    const run = await post(
      '/government/reconciliation/run',
      { from: bounds.start.toISOString(), to: new Date().toISOString() },
      auth('finance'),
    );
    assert.equal(run.status, 200, JSON.stringify(run.body));
  });
});

// ===========================================================================
describe('what closing refuses to do quietly', () => {
  /*
   * Closing over an unresolved exception freezes a figure already known to be
   * wrong. It is sometimes the right call — a deadline is a deadline — and it
   * is never a silent one.
   */
  it('refuses a month with unresolved exceptions unless somebody says why', async () => {
    await collect('7');
    const bounds = lastMonth();
    await backdatedCollection(bounds.start);

    await query(
      pool,
      `INSERT INTO reconciliation_records
         (run_id, transaction_id, expected_amount_kobo, received_amount_kobo,
          variance_kobo, status, created_at)
       SELECT gen_random_uuid(), t.id, 5000000, 0, 5000000, 'MISSING_PAYMENT', $1
         FROM transactions t
        WHERE t.created_at::date BETWEEN $2 AND $3 LIMIT 1`,
      [bounds.start, iso(bounds.start), iso(bounds.end)],
    );

    const period = await openPeriod(bounds);
    const refused = await close(period.id);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match(JSON.stringify(refused.body), /unresolved exception/i);

    // And with a reason, it goes through — and the reason is on the record.
    const forced = await close(period.id, {
      overrideReason: 'Reported to the Accountant-General on the statutory deadline.',
    });
    assert.equal(forced.status, 200, JSON.stringify(forced.body));
    assert.equal(forced.body.overridden, true);

    const listed = await get('/government/periods', auth('revenue'));
    assert.match(
      (listed.body as Record<string, string>[])[0]!.closing_note,
      /statutory deadline/,
    );
  });

  it('refuses two periods that cover the same day', async () => {
    const bounds = lastMonth();
    await openPeriod(bounds);

    const overlapping = await post(
      '/government/periods',
      { periodStart: iso(bounds.start), periodEnd: iso(bounds.end), label: 'again' },
      auth('finance'),
    );
    assert.equal(overlapping.status, 409, JSON.stringify(overlapping.body));
    assert.match(JSON.stringify(overlapping.body), /overlap/i);

    /*
     * And the database refuses it too. One closed and one open period over the
     * same day would make a write on that date both refused and allowed
     * depending on which row the trigger read first.
     */
    await assert.rejects(
      () =>
        query(
          pool,
          `INSERT INTO financial_periods (label, period_start, period_end)
           VALUES ('direct', $1, $2)`,
          [bounds.start, bounds.end],
        ),
      /financial_periods_do_not_overlap/,
    );
  });

  it('will not delete a period, at the database', async () => {
    const period = await openPeriod();
    await assert.rejects(
      () => query(pool, 'DELETE FROM financial_periods WHERE id = $1', [period.id]),
      /never deleted/,
    );
  });
});

// ===========================================================================
describe('reopening, and who may do it', () => {
  /*
   * Closing and reopening are separate authorities on purpose.
   *
   * The officer who closes the books also being the one who can unclose them
   * removes most of what a period lock is for.
   */
  it('is the administrator’s, not the closer’s', async () => {
    await collect('8');
    const period = await openPeriod();
    assert.equal((await close(period.id)).status, 200);

    await grantStepUp(tokens.finance, PHONES.finance, 'financial.period.reopen');
    const byFinance = await post(
      `/government/periods/${period.id}/reopen`,
      { reason: 'I would like to change the figure I just froze.' },
      auth('finance'),
    );
    assert.equal(byFinance.status, 403, 'the officer who closed it cannot reopen it');

    await grantStepUp(tokens.admin, PHONES.admin, 'financial.period.reopen');
    const byAdmin = await post(
      `/government/periods/${period.id}/reopen`,
      { reason: 'The Kanam settlement was misposted and has to be corrected in March.' },
      auth('admin'),
    );
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
  });

  it('lets the month be corrected again once it is open', async () => {
    await collect('9');
    const bounds = lastMonth();
    const transactionId = await backdatedCollection(bounds.start);
    const period = await openPeriod(bounds);
    assert.equal((await close(period.id)).status, 200);
    await assert.rejects(
      () =>
        query(pool, `UPDATE transactions SET status_reason = 'corrected' WHERE id = $1`, [
          transactionId,
        ]),
      /cannot be changed/,
    );

    await grantStepUp(tokens.admin, PHONES.admin, 'financial.period.reopen');
    await post(
      `/government/periods/${period.id}/reopen`,
      { reason: 'The Kanam settlement was misposted and has to be corrected in March.' },
      auth('admin'),
    );

    // Now the correction goes through.
    await query(pool, `UPDATE transactions SET status_reason = 'corrected' WHERE id = $1`, [
      transactionId,
    ]);
    const row = await queryOne<{ status_reason: string }>(
      pool,
      'SELECT status_reason FROM transactions WHERE id = $1',
      [transactionId],
    );
    assert.equal(row!.status_reason, 'corrected');
  });

  it('records why, so the reopening is a sentence the platform can produce', async () => {
    await collect('10');
    const period = await openPeriod();
    assert.equal((await close(period.id)).status, 200);

    await grantStepUp(tokens.admin, PHONES.admin, 'financial.period.reopen');
    await post(
      `/government/periods/${period.id}/reopen`,
      { reason: 'The Kanam settlement was misposted and has to be corrected in March.' },
      auth('admin'),
    );

    const listed = await get('/government/periods', auth('revenue'));
    const row = (listed.body as Record<string, string>[])[0]!;
    assert.equal(row.status, 'OPEN');
    assert.equal(row.reopened_by_name, 'Period admin');
    assert.match(row.reopen_reason, /misposted/);
  });

  /*
   * CLOSING is not decoration: it stops the month taking new entries while the
   * officer finishes reconciling, and a screen can say "being closed" rather
   * than "closed".
   */
  it('stops entries as soon as closing begins, before it finishes', async () => {
    await collect('11');
    const bounds = lastMonth();
    await backdatedCollection(bounds.start);
    const period = await openPeriod(bounds);

    const begun = await post(
      `/government/periods/${period.id}/begin-closing`,
      {},
      auth('finance'),
    );
    assert.equal(begun.status, 200, JSON.stringify(begun.body));
    await assert.rejects(() => backdatedCollection(bounds.start), /is closed/);
  });
});
