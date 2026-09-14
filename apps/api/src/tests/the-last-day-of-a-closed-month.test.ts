/**
 * The last day of a month, on a process set to Plateau time.
 *
 * This file pins a coincidence. It passed before the change it accompanies and
 * it passes after, and that is what it is for — there was no defect here, and
 * saying otherwise would be the more interesting story rather than the true
 * one.
 *
 * WHAT THE COINCIDENCE IS
 *
 * `periodFigures` bounds a month with two dates, and its callers built them
 * differently: the `/periods/figures` route with `z.coerce.date()`, which
 * reads `2026-09-30` as midnight UTC on any process, and `closePeriod` by
 * reading the same day out of a DATE column, which `pg` hands back as midnight
 * LOCAL. On `TZ=Africa/Lagos` — the obvious setting for a Plateau State
 * deployment, and the one this repository's own dependabot schedule uses —
 * those two are an hour apart, and an hour is enough: `created_at::date` for a
 * collection on the 30th is `2026-09-30`, and a bound of `2026-09-29T23:00Z`
 * excludes it.
 *
 * It survives because `pg` serialises a `Date` parameter back in local time
 * with its offset, and Postgres keeps the date part. The skew is applied twice
 * and cancels — the same argument `lib/calendar-day.ts` makes about
 * `setHours`. Three separate behaviours have to keep agreeing for the figure
 * to be right, and none of them is mentioned anywhere near the query.
 *
 * WHY PIN IT
 *
 * Because of what the figure is. `closePeriod` writes `collected_kobo` once
 * and migration 058 puts a trigger behind it that refuses to let a closed
 * month be written to again. If the coincidence ever stopped holding — a
 * driver major, `parseInputDatesAsUTC`, an explicit `::timestamptz` added to
 * one subquery — the last day of every month would go missing from a figure
 * signed off and then frozen, and the failure would look like a quiet month.
 *
 * So these tests move the process into Africa/Lagos and close a month that has
 * money in it on its final day. `process.env.TZ` reaches `pg`'s DATE parsing,
 * so this exercises the real mechanism rather than a model of it.
 *
 * The two guard tests at the end are the ones that do fail without the change:
 * they hold the bounds to being calendar days rather than instants, at the
 * service and at the route.
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
import { queryOne } from '../db/pool';
import { periodFigures } from '../services/periods';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const PHONES = { finance: '+2348077100001', admin: '+2348077100002' };
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
  await createGovernmentUser({
    fullName: 'Period Finance',
    phone: PHONES.finance,
    role: 'finance_officer',
  });
  /* seedDemoAgent needs somebody who can approve the agent it clears. */
  await createGovernmentUser({
    fullName: 'Period Admin',
    phone: PHONES.admin,
    role: 'admin',
  });
  tokens.finance = (await loginAs(PHONES.finance)).accessToken;
  lgaId = await firstLgaId();
});

const auth = () => ({ token: tokens.finance });
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Last month, which is the month a real close is always about. */
function lastMonth(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
  };
}

/**
 * Run `body` with the process in Plateau's zone, and put it back afterwards.
 *
 * Restored in a `finally` because a shard that kept the zone would carry it
 * into every later file in the same process, which is the shape of flake that
 * takes a day to find.
 */
async function inPlateauTime<T>(body: () => Promise<T>): Promise<T> {
  const before = process.env.TZ;
  process.env.TZ = 'Africa/Lagos';
  try {
    return await body();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

/**
 * One real collection, so there is a settled row in the books to copy.
 *
 * Dated now, which is this month — deliberately not the month under test, so
 * it cannot contribute to the figures being asserted.
 */
async function collectOnce(): Promise<void> {
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ledger',
      lastName: 'Subject',
      phone: '+2348150700001',
      address: '11 Ledger Street, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: 'tz-tp-1' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: 'tz-as-1' },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: 'tz-pay-1' },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );
  await settleTransaction(assessment.body.transactionId);
}

/** A verified collection dated at a chosen instant. */
async function collectionAt(when: Date, amountKobo = 5_000_000n): Promise<void> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO transactions (
       transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
       lga_id, amount_kobo, total_amount_kobo, status, created_by, created_at, territory_id
     )
     SELECT 'TXN-TZ-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
            t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
            'SETTLED', t.created_by, $2, t.territory_id
       FROM transactions t WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1
     RETURNING id`,
    [amountKobo.toString(), when],
  );
  assert.ok(row, 'a settled transaction existed to copy');
}

async function openPeriod(bounds = lastMonth()) {
  const created = await post(
    '/government/periods',
    { periodStart: iso(bounds.start), periodEnd: iso(bounds.end) },
    auth(),
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body as { id: string; label: string };
}

async function close(periodId: string) {
  await grantStepUp(tokens.finance, PHONES.finance, 'financial.period.close');
  return post(
    `/government/periods/${periodId}/close`,
    {
      note: 'Reconciled and reported to the Accountant-General.',
      overrideReason: 'Closing for the purposes of this test.',
    },
    auth(),
  );
}

/** 09:00 UTC on a day — the middle of a working day in Plateau, either way. */
const nineAmOn = (day: Date) => new Date(`${iso(day)}T09:00:00.000Z`);

// ===========================================================================
describe('a month closed on a process set to Plateau time', () => {
  it('counts the money taken on its last day', async () => {
    const bounds = lastMonth();
    await collectOnce();
    await collectionAt(nineAmOn(bounds.end), 7_500_000n);
    const period = await openPeriod(bounds);

    const closed = await inPlateauTime(() => close(period.id));
    assert.equal(closed.status, 200, JSON.stringify(closed.body));

    const stored = await queryOne<{ collected_kobo: string; transaction_count: number }>(
      pool,
      'SELECT collected_kobo::text, transaction_count FROM financial_periods WHERE id = $1',
      [period.id],
    );
    assert.ok(
      BigInt(stored!.collected_kobo) >= 7_500_000n,
      `the last day's ₦75,000 was left out of the frozen figure: ${stored!.collected_kobo}`,
    );
    assert.ok(stored!.transaction_count >= 1, 'the last day\'s collection was not counted');
  });

  it('freezes the same figure the officer was shown before closing', async () => {
    const bounds = lastMonth();
    await collectOnce();
    await collectionAt(nineAmOn(bounds.end), 7_500_000n);
    const period = await openPeriod(bounds);

    const preview = await inPlateauTime(() =>
      get(
        `/government/periods/figures?periodStart=${iso(bounds.start)}&periodEnd=${iso(bounds.end)}`,
        auth(),
      ),
    );
    assert.equal(preview.status, 200, JSON.stringify(preview.body));

    const closed = await inPlateauTime(() => close(period.id));
    assert.equal(closed.status, 200, JSON.stringify(closed.body));

    const stored = await queryOne<{ collected_kobo: string }>(
      pool,
      'SELECT collected_kobo::text FROM financial_periods WHERE id = $1',
      [period.id],
    );
    assert.equal(
      stored!.collected_kobo,
      preview.body.collected_kobo,
      'the preview and the stored figure disagreed, which is the one thing periodFigures promises cannot happen',
    );
  });

  /*
   * A control. The fix must not have been "widen the window until the test
   * passes" — a period that swallowed the following day would count the same
   * money twice, once in each month, and the two closed figures would sum to
   * more than PSIRS ever collected.
   */
  it('still leaves out the money taken the day after it ends', async () => {
    const bounds = lastMonth();
    const dayAfter = new Date(bounds.end.getTime() + 24 * 60 * 60 * 1000);
    await collectOnce();
    await collectionAt(nineAmOn(dayAfter), 9_900_000n);
    const period = await openPeriod(bounds);

    const closed = await inPlateauTime(() => close(period.id));
    assert.equal(closed.status, 200, JSON.stringify(closed.body));

    const stored = await queryOne<{ collected_kobo: string }>(
      pool,
      'SELECT collected_kobo::text FROM financial_periods WHERE id = $1',
      [period.id],
    );
    assert.ok(
      BigInt(stored!.collected_kobo) < 9_900_000n,
      `next month's ₦99,000 was counted in this month: ${stored!.collected_kobo}`,
    );
  });

  /*
   * A second control, on the other half of the fix. Typing the bounds `string`
   * stops a `Date` reaching them — that is a compile error. Nothing stops a
   * caller stringifying one, and an ISO instant in a position that must hold a
   * calendar day is the same defect wearing a different type.
   */
  it('refuses an instant where a calendar day belongs', async () => {
    const bounds = lastMonth();
    await assert.rejects(
      () => periodFigures(pool, bounds.start.toISOString(), iso(bounds.end)),
      /calendar day/i,
      'a full ISO timestamp was accepted as a period bound',
    );
  });

  /*
   * And the route refuses it too, rather than coercing it back into a Date and
   * reintroducing exactly the instant this is about.
   */
  it('refuses an instant on the preview route', async () => {
    const bounds = lastMonth();
    const answer = await get(
      `/government/periods/figures?periodStart=${bounds.start.toISOString()}` +
        `&periodEnd=${iso(bounds.end)}`,
      auth(),
    );
    assert.equal(answer.status, 422, JSON.stringify(answer.body));
  });
});
