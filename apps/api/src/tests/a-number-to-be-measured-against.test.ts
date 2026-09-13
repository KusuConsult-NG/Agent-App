/**
 * The target, and the projection that is not one.
 *
 * Every revenue figure the platform produced answered "how much came in" and
 * none of them answered "is that enough", because nothing said what enough was.
 * Nine items on the readiness assessment read Missing for that single reason.
 *
 * What is worth testing here is not that a number can be stored. It is:
 *
 *   * Achievement is computed against the *target's* period, not the window the
 *     caller asked about. Get that wrong and a March target listed in an annual
 *     query reports 1,200%.
 *   * A revision supersedes rather than overwrites, so "the target was lowered
 *     on the 24th" stays answerable — which is the question an auditor asks
 *     about a target.
 *   * A forecast is always labelled as one, and says what it rests on. A
 *     projection handed over as a bare figure becomes a number somebody
 *     budgets against.
 *   * The seasonal method falls back to a run rate when the history cannot
 *     support it, rather than dividing by a share near zero and reporting
 *     billions.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
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
import { forecast, resolvePeriod } from '../services/targets';

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
  for (const officer of [
    { fullName: 'Target Admin', phone: '+2348073000001', role: 'admin' },
    { fullName: 'Target Revenue', phone: '+2348073000002', role: 'revenue_officer' },
    { fullName: 'Target Finance', phone: '+2348073000003', role: 'finance_officer' },
    { fullName: 'Target Auditor', phone: '+2348073000004', role: 'auditor' },
  ]) {
    await createGovernmentUser(officer);
    tokens[officer.role] = (await loginAs(officer.phone)).accessToken;
  }
  lgaId = await firstLgaId();
});

const auth = (role: string) => ({ token: tokens[role] });
const thisMonth = () => resolvePeriod('MONTHLY');
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function setTarget(body: Record<string, unknown>, role = 'revenue_officer') {
  const period = thisMonth();
  return post(
    '/government/targets',
    {
      scope: 'STATE',
      periodKind: 'MONTHLY',
      periodStart: iso(period.start),
      periodEnd: iso(period.end),
      amountKobo: '50000000',
      ...body,
    },
    auth(role),
  );
}

/** One real collection, so an actual exists to measure a target against. */
async function collect(amountLabel: string): Promise<{ transactionId: string; amountKobo: bigint }> {
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Target',
      lastName: `Subject${amountLabel}`,
      phone: `+2348130000${amountLabel.padStart(3, "0")}`,
      address: '4 Target Street, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `tgt-tp-${amountLabel}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `tgt-as-${amountLabel}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `tgt-pay-${amountLabel}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );
  await settleTransaction(assessment.body.transactionId);

  const row = await queryOne<{ amount_kobo: string }>(
    pool,
    'SELECT amount_kobo FROM transactions WHERE id = $1',
    [assessment.body.transactionId],
  );
  return {
    transactionId: assessment.body.transactionId,
    amountKobo: BigInt(row!.amount_kobo),
  };
}

// ===========================================================================
describe('setting a target', () => {
  it('records who set it, and what it is against', async () => {
    const created = await setTarget({ scope: 'LGA', lgaId });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.superseded, null);

    const listed = await get('/government/targets', auth('finance_officer'));
    assert.equal(listed.status, 200);
    const row = (listed.body as Record<string, string>[])[0]!;
    assert.equal(row.scope, 'LGA');
    assert.equal(row.target_kobo, '50000000');
    assert.equal(row.set_by_name, 'Target Revenue');
    assert.ok(row.lga_name, 'the LGA is named, not just its id');
  });

  /*
   * A revision supersedes. The old figure stays readable.
   *
   * "Was this target lowered after the quarter went badly" is the question an
   * auditor asks about a target, and an UPDATE in place is the one answer
   * nobody can reconstruct.
   */
  it('supersedes rather than overwrites, so the old figure survives', async () => {
    const first = await setTarget({ amountKobo: '80000000' });
    const second = await setTarget({ amountKobo: '40000000', note: 'Revised after the flood.' });

    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.superseded, first.body.id);

    // One live target...
    const live = await get('/government/targets', auth('admin'));
    assert.equal((live.body as unknown[]).length, 1);
    assert.equal((live.body as Record<string, string>[])[0]!.target_kobo, '40000000');

    // ...and the original still on file, with the reason for the change.
    const all = await get('/government/targets?includeInactive=true', auth('auditor'));
    const amounts = (all.body as Record<string, string>[]).map((row) => row.target_kobo).sort();
    assert.deepEqual(amounts, ['40000000', '80000000']);

    const audited = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text FROM audit_logs WHERE action = 'target.revise'`,
    );
    assert.equal(audited!.count, '1');
  });

  it('will not let a target be deleted, at the database', async () => {
    const created = await setTarget({});
    await assert.rejects(
      () => query(pool, 'DELETE FROM revenue_targets WHERE id = $1', [created.body.id]),
      /never deleted/,
    );
  });

  it('refuses a target whose scope and identifiers disagree', async () => {
    for (const [body, expected] of [
      [{ scope: 'STATE', lgaId }, /whole state/i],
      [{ scope: 'LGA' }, /has to name an LGA/i],
      [{ scope: 'CATEGORY' }, /has to name a category/i],
      [{ scope: 'AGENT' }, /has to name an agent/i],
    ] as const) {
      const attempt = await setTarget(body as Record<string, unknown>);
      assert.equal(attempt.status, 400, `${JSON.stringify(body)} → ${attempt.status}`);
      assert.match(JSON.stringify(attempt.body), expected);
    }
  });

  it('lets the roles that plan revenue set one, and no others', async () => {
    for (const role of ['admin', 'revenue_officer']) {
      const allowed = await setTarget({ amountKobo: '10000000' }, role);
      assert.equal(allowed.status, 201, `${role}: ${JSON.stringify(allowed.body)}`);
    }
    for (const role of ['finance_officer', 'auditor']) {
      const refused = await setTarget({ amountKobo: '10000000' }, role);
      assert.equal(refused.status, 403, `${role} should not be able to set a target`);
    }
    // But both may read one. An achievement percentage is meaningless without it.
    for (const role of ['finance_officer', 'auditor']) {
      assert.equal((await get('/government/targets', auth(role))).status, 200);
    }
  });

  it('withdraws a target, with a reason, and only once', async () => {
    const created = await setTarget({});
    const withdrawn = await post(
      `/government/targets/${created.body.id}/withdraw`,
      { reason: 'The Council revised the estimate downwards.' },
      auth('admin'),
    );
    assert.equal(withdrawn.status, 204, JSON.stringify(withdrawn.body));

    const again = await post(
      `/government/targets/${created.body.id}/withdraw`,
      { reason: 'The Council revised the estimate downwards.' },
      auth('admin'),
    );
    assert.equal(again.status, 409);
  });
});

// ===========================================================================
describe('target versus actual', () => {
  it('measures a target against its own period, not the query window', async () => {
    const collected = await collect('1');
    const period = thisMonth();

    // This month's target — the one the collection belongs to.
    await setTarget({ amountKobo: '10000000' });

    // And a target for a month long past, which the same annual query returns.
    await post(
      '/government/targets',
      {
        scope: 'STATE',
        periodKind: 'MONTHLY',
        periodStart: `${period.start.getUTCFullYear()}-01-01`,
        periodEnd: `${period.start.getUTCFullYear()}-01-31`,
        amountKobo: '10000000',
      },
      auth('revenue_officer'),
    );

    const rows = await get(
      `/government/targets?from=${period.start.getUTCFullYear()}-01-01&to=${period.start.getUTCFullYear()}-12-31`,
      auth('admin'),
    );
    assert.equal((rows.body as unknown[]).length, 2);

    const current = (rows.body as Record<string, string>[]).find(
      (row) => row.period_start.slice(0, 10) === iso(period.start),
    );
    assert.ok(current, 'this month is in the list');
    assert.equal(current!.collected_kobo, collected.amountKobo.toString());

    /*
     * The January row is the point of this test.
     *
     * Its collected figure must be January's — almost certainly zero — and not
     * the year's, which is what a query that measured every target against the
     * caller's window would report.
     */
    const january = (rows.body as Record<string, string>[]).find(
      (row) => row.period_start.slice(5, 10) === '01-01',
    );
    assert.ok(january, 'January is in the list');
    if (iso(period.start).slice(5) !== '01-01') {
      assert.equal(january!.collected_kobo, '0');
    }
  });

  it('reports how far through the period the figure was taken', async () => {
    await setTarget({});
    const rows = await get('/government/targets', auth('admin'));
    const row = (rows.body as Record<string, number>[])[0]!;
    assert.ok(row.days_in_period >= 28, 'a month');
    assert.ok(row.days_elapsed >= 1 && row.days_elapsed <= row.days_in_period);
  });

  /*
   * A state figure and the sum apportioned below it, side by side.
   *
   * They do not have to agree — PSIRS carries headroom at the state level — so
   * this is a report rather than a constraint, and what an officer wants to see
   * is the gap and how many LGAs have no target at all.
   */
  it('shows the state target beside what was apportioned below it', async () => {
    const period = thisMonth();
    await setTarget({ scope: 'STATE', amountKobo: '100000000' });
    await setTarget({ scope: 'LGA', lgaId, amountKobo: '30000000' });

    const rollup = await get(
      `/government/targets/rollup?periodStart=${iso(period.start)}&periodEnd=${iso(period.end)}`,
      auth('admin'),
    );
    assert.equal(rollup.status, 200);
    assert.equal(rollup.body.state_target_kobo, '100000000');
    assert.equal(rollup.body.lga_targets_kobo, '30000000');
    assert.equal(rollup.body.lgas_with_a_target, '1');
    assert.ok(Number(rollup.body.lgas_total) >= 17, 'Plateau has 17 LGAs');
  });
});

// ===========================================================================
describe('every scope and every period a target can be set for', () => {
  /*
   * Reached rather than declared.
   *
   * The suite's enum-coverage gate asks that every state the schema allows is
   * written by something. For a table this new the honest answer is that each
   * scope and each period is reachable through the API — which is also the
   * cheapest way to discover that one of them is not.
   */
  it('sets one at every scope', async () => {
    const period = thisMonth();
    const agent = await seedDemoAgent();
    assert.ok(agent, 'the demonstration agent cleared the pipeline');
    const category = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM revenue_categories LIMIT 1',
    );
    const item = await queryOne<{ id: string }>(pool, 'SELECT id FROM revenue_items LIMIT 1');

    const scopes: Record<string, unknown>[] = [
      { scope: 'STATE' },
      { scope: 'LGA', lgaId },
      { scope: 'CATEGORY', categoryId: category!.id },
      { scope: 'ITEM', revenueItemId: item!.id },
      { scope: 'AGENT', agentId: agent!.agentId },
    ];

    for (const body of scopes) {
      const created = await post(
        '/government/targets',
        {
          periodKind: 'MONTHLY',
          periodStart: iso(period.start),
          periodEnd: iso(period.end),
          amountKobo: '1000000',
          ...body,
        },
        auth('admin'),
      );
      assert.equal(created.status, 201, `${body.scope}: ${JSON.stringify(created.body)}`);
    }

    const stored = await query<{ scope: string }>(
      pool,
      'SELECT DISTINCT scope FROM revenue_targets ORDER BY scope',
    );
    assert.deepEqual(
      stored.map((row) => row.scope),
      ['AGENT', 'CATEGORY', 'ITEM', 'LGA', 'STATE'],
    );
  });

  it('sets one for every period a plan is written in', async () => {
    for (const periodKind of ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const) {
      const resolved = await get(`/government/targets/period?kind=${periodKind}`, auth('admin'));
      assert.equal(resolved.status, 200, JSON.stringify(resolved.body));

      const created = await post(
        '/government/targets',
        {
          scope: 'STATE',
          periodKind,
          periodStart: resolved.body.periodStart,
          periodEnd: resolved.body.periodEnd,
          amountKobo: '1000000',
        },
        auth('admin'),
      );
      assert.equal(created.status, 201, `${periodKind}: ${JSON.stringify(created.body)}`);
    }

    const stored = await query<{ period_kind: string }>(
      pool,
      'SELECT DISTINCT period_kind FROM revenue_targets ORDER BY period_kind',
    );
    assert.deepEqual(
      stored.map((row) => row.period_kind).sort(),
      ['ANNUAL', 'DAILY', 'MONTHLY', 'QUARTERLY', 'WEEKLY'],
    );
  });

  it('reaches all three lifecycle states', async () => {
    const active = await setTarget({ amountKobo: '1000000' });
    await setTarget({ amountKobo: '2000000' }); // supersedes the first
    const toWithdraw = await setTarget({ scope: 'LGA', lgaId, amountKobo: '3000000' });
    await post(
      `/government/targets/${toWithdraw.body.id}/withdraw`,
      { reason: 'The Council revised the estimate downwards.' },
      auth('admin'),
    );

    const states = await query<{ status: string }>(
      pool,
      'SELECT DISTINCT status FROM revenue_targets ORDER BY status',
    );
    assert.deepEqual(
      states.map((row) => row.status),
      ['ACTIVE', 'SUPERSEDED', 'WITHDRAWN'],
    );
    assert.ok(active.body.id, 'the superseded one is still on file');
  });
});

// ===========================================================================
describe('the forecast, which is not a target', () => {
  it('always says it is a forecast, and what it rests on', async () => {
    await collect('2');
    const result = await get('/government/forecast?periodKind=MONTHLY', auth('revenue_officer'));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.is_forecast, true);
    assert.ok(['SEASONAL', 'RUN_RATE', 'INSUFFICIENT_HISTORY'].includes(result.body.basis));
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(result.body.confidence));
    assert.ok(result.body.explanation_key, 'and carries a key the portal can translate');
  });

  /*
   * With no history, a run rate and the word LOW.
   *
   * The wrong behaviour here is a confident seasonal projection built from one
   * comparable period, which is not a curve, it is a coincidence.
   */
  it('falls back to a run rate when there is no comparable history', async () => {
    await collect('3');
    const result = await get('/government/forecast?periodKind=MONTHLY', auth('admin'));
    assert.equal(result.body.basis, 'RUN_RATE');
    assert.equal(result.body.confidence, 'LOW');
    assert.equal(result.body.seasonal_share_bp, null);
    assert.equal(result.body.comparable_periods, 0);
  });

  /*
   * With history, the seasonal share, and it beats a straight line.
   *
   * Backdated directly: `created_at` is set by the server on every real
   * collection, so three years of history cannot be produced through the API,
   * and the subject here is the arithmetic rather than how a transaction comes
   * to exist.
   *
   * The shape is deliberate. In each previous year, three quarters of the
   * month's revenue arrived in the first third — a demand-notice cluster. A
   * straight-line projection from the same point would therefore report about a
   * third of the true figure, and the seasonal method should not.
   */
  it('uses the collection curve, and beats a straight line', async () => {
    const collected = await collect('4');
    const period = thisMonth();
    const daysElapsed =
      Math.round((Date.now() - period.start.getTime()) / 86_400_000) + 1;

    // A curve needs somewhere to sit inside the month; skip on the 1st.
    if (daysElapsed < 3 || daysElapsed > 25) return;

    for (let yearsBack = 1; yearsBack <= 3; yearsBack += 1) {
      const historicStart = new Date(
        Date.UTC(period.start.getUTCFullYear() - yearsBack, period.start.getUTCMonth(), 1),
      );
      // Three quarters inside the elapsed window, one quarter after it.
      await backdatedCollection(historicStart, daysElapsed - 1, 3_000_000n);
      await backdatedCollection(historicStart, daysElapsed + 2, 1_000_000n);
    }

    const result = await get('/government/forecast?periodKind=MONTHLY', auth('admin'));
    assert.equal(result.body.basis, 'SEASONAL', JSON.stringify(result.body));
    assert.equal(result.body.comparable_periods, 3);
    assert.equal(result.body.seasonal_share_bp, 7500, 'three quarters in by this point');

    // collected / 0.75, against a straight line's collected × days / elapsed.
    const projected = BigInt(result.body.projected_kobo);
    const straightLine =
      (collected.amountKobo * BigInt(result.body.days_in_period)) / BigInt(daysElapsed);
    assert.equal(projected, (collected.amountKobo * 10_000n) / 7500n);
    assert.notEqual(projected, straightLine);
  });

  /*
   * A share near zero is noise, not a curve.
   *
   * An annual levy due in December collects nothing by March in every previous
   * year. Dividing by that share projects the billions, so the method has to
   * stand down rather than produce a confident absurdity.
   */
  it('stands down when the curve says almost nothing has arrived by now', async () => {
    const period = thisMonth();
    const daysElapsed = Math.round((Date.now() - period.start.getTime()) / 86_400_000) + 1;
    if (daysElapsed < 3 || daysElapsed > 25) return;

    await collect('5');
    for (let yearsBack = 1; yearsBack <= 3; yearsBack += 1) {
      const historicStart = new Date(
        Date.UTC(period.start.getUTCFullYear() - yearsBack, period.start.getUTCMonth(), 1),
      );
      // Everything arrives after the point we are standing at.
      await backdatedCollection(historicStart, daysElapsed + 2, 5_000_000n);
    }

    const result = await get('/government/forecast?periodKind=MONTHLY', auth('admin'));
    assert.equal(result.body.basis, 'RUN_RATE');
    assert.equal(result.body.confidence, 'LOW');
    assert.equal(result.body.explanation_key, 'forecastTooEarlyInCurve');
    assert.equal(result.body.seasonal_share_bp, 0);
  });

  it('reports a finished period as itself, not as a projection', async () => {
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1));
    const lastMonthEnd = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 0));
    const result = await get(
      `/government/forecast?periodStart=${iso(lastMonth)}&periodEnd=${iso(lastMonthEnd)}`,
      auth('admin'),
    );
    assert.equal(result.body.confidence, 'HIGH');
    assert.equal(result.body.explanation_key, 'forecastPeriodComplete');
    assert.equal(result.body.projected_kobo, result.body.collected_kobo);
  });

  it('names the target alongside, where one has been set', async () => {
    await collect('6');
    await setTarget({ amountKobo: '10000000' });
    const result = await get('/government/forecast?periodKind=MONTHLY', auth('admin'));
    assert.equal(result.body.target_kobo, '10000000');
    assert.ok(
      typeof result.body.projected_achievement_bp === 'number',
      'and what the projection would achieve against it',
    );
  });
});

/**
 * A verified collection on a chosen date.
 *
 * Written directly. `created_at` comes from the server on every real
 * collection, so history cannot be produced through the API — and this exists
 * to give the forecast arithmetic something to read, not to test how a
 * transaction comes to exist.
 */
async function backdatedCollection(
  monthStart: Date,
  dayOfMonth: number,
  amountKobo: bigint,
): Promise<void> {
  const when = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayOfMonth),
  );
  await query(
    pool,
    `INSERT INTO transactions (
       transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
       lga_id, amount_kobo, total_amount_kobo, status, created_by, created_at, territory_id
     )
     SELECT 'TXN-HIST-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
            t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
            'SETTLED', t.created_by, $2, t.territory_id
       FROM transactions t
      WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
    [amountKobo.toString(), when],
  );
}

// ===========================================================================
describe('resolvePeriod', () => {
  /*
   * The server decides what "this month" means.
   *
   * A client computing it from its own clock can be wrong — a handset with a
   * bad clock, a browser in another timezone — and a target set against the
   * wrong dates is silently wrong for a month.
   */
  it('resolves each period from a fixed anchor', () => {
    const anchor = new Date(Date.UTC(2026, 8, 16)); // Wednesday 16 September 2026

    assert.deepEqual(bounds(resolvePeriod('DAILY', anchor)), ['2026-09-16', '2026-09-16']);
    // Monday-based, which is how a collection week is counted here.
    assert.deepEqual(bounds(resolvePeriod('WEEKLY', anchor)), ['2026-09-14', '2026-09-20']);
    assert.deepEqual(bounds(resolvePeriod('MONTHLY', anchor)), ['2026-09-01', '2026-09-30']);
    assert.deepEqual(bounds(resolvePeriod('QUARTERLY', anchor)), ['2026-07-01', '2026-09-30']);
    assert.deepEqual(bounds(resolvePeriod('ANNUAL', anchor)), ['2026-01-01', '2026-12-31']);
  });

  it('gets February right in a leap year', () => {
    const leap = resolvePeriod('MONTHLY', new Date(Date.UTC(2028, 1, 10)));
    assert.deepEqual(bounds(leap), ['2028-02-01', '2028-02-29']);
  });

  function bounds(period: { start: Date; end: Date }) {
    return [iso(period.start), iso(period.end)];
  }
});
