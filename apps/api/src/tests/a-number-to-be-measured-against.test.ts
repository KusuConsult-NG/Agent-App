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
import { todayInPlateau } from '../lib/calendar-day';

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
describe('two labels for one period, and the figure that depended on which', () => {
  /*
   * Migration 056 set out to make two live targets impossible, and said what
   * the second one costs: "every achievement percentage would depend on which
   * row the query happened to read first."
   *
   * `revenue_targets_one_live_per_scope` keyed that on `period_kind` as well
   * as the dates, and nothing that reads a target filters on `period_kind` —
   * not `withTarget`, which takes the forecast's figure with `LIMIT 1` and no
   * ORDER BY, and not `targetRollup`, whose count and SUM run over the same
   * columns. The route takes `periodKind`, `periodStart` and `periodEnd` as
   * three independent fields, so a MONTHLY target for this month and a
   * QUARTERLY one for the same two dates were two live rows the index allowed
   * and every reader treated as one.
   *
   * Both assertions below are on counts and sums rather than on which row came
   * back, because which row came back is the part that was never decided.
   */
  it('supersedes the figure for the same dates, whatever the period is called', async () => {
    const period = thisMonth();
    const first = await setTarget({ periodKind: 'MONTHLY', amountKobo: '50000000' });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await setTarget({ periodKind: 'QUARTERLY', amountKobo: '90000000' });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(
      second.body.superseded,
      first.body.id,
      'a second figure for the same scope and the same two dates did not ' +
        'supersede the first, so both are live and the label is the only thing ' +
        'telling them apart',
    );

    const live = await query<{ amount_kobo: string; period_kind: string }>(
      pool,
      `SELECT amount_kobo::text, period_kind FROM revenue_targets
        WHERE status = 'ACTIVE' AND scope = 'STATE'
          AND period_start = $1 AND period_end = $2`,
      [iso(period.start), iso(period.end)],
    );
    assert.equal(
      live.length,
      1,
      `${live.length} live state targets for one period: ${JSON.stringify(live)}`,
    );
    assert.equal(live[0]!.amount_kobo, '90000000', 'and it is the figure set second');
  });

  it('counts an LGA once in the rollup, not once per label', async () => {
    // The rollup's own symptom, and the deterministic one: `lgas_with_a_target`
    // is a count and `lga_targets_kobo` a sum, so a second live row does not
    // merely risk being read — it is read, and added.
    const period = thisMonth();
    await setTarget({ scope: 'LGA', lgaId, periodKind: 'MONTHLY', amountKobo: '30000000' });
    await setTarget({ scope: 'LGA', lgaId, periodKind: 'QUARTERLY', amountKobo: '45000000' });

    const rollup = await get(
      `/government/targets/rollup?periodStart=${iso(period.start)}&periodEnd=${iso(period.end)}`,
      auth('admin'),
    );
    assert.equal(rollup.status, 200, JSON.stringify(rollup.body));
    assert.equal(
      rollup.body.lgas_with_a_target,
      '1',
      'one LGA with one target for the period was reported as more than one',
    );
    assert.equal(
      rollup.body.lga_targets_kobo,
      '45000000',
      'the apportioned figure is the sum of two rows that both claim to be ' +
        'the target for the same work',
    );
  });

  it('is refused a second live figure at the database, not only by the service', async () => {
    /*
     * Asserted here rather than through the route, because the service is now
     * correct and would never send the second insert. The index's job is to
     * hold whoever writes — migration 080's header is the principle: "a rule
     * the service enforces and the database does not is one UPDATE away from
     * being undone." It was keyed on `period_kind`, so the two rows below were
     * accepted, and every reader of a target then read them as one.
     */
    const period = thisMonth();
    const setter = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM users WHERE phone = $1',
      ['+2348073000001'],
    );
    assert.ok(setter, 'the officer who sets the figure exists');

    const insert = (periodKind: string, amountKobo: string) =>
      pool.query(
        `INSERT INTO revenue_targets
           (scope, period_kind, period_start, period_end, amount_kobo, set_by)
         VALUES ('STATE', $1, $2, $3, $4, $5)`,
        [periodKind, iso(period.start), iso(period.end), amountKobo, setter!.id],
      );

    await insert('MONTHLY', '50000000');
    await assert.rejects(
      insert('QUARTERLY', '90000000'),
      /revenue_targets_one_live_per_scope/,
      'the database accepted a second live target for the same scope and the ' +
        'same two dates, differing only in what the period is called',
    );
  });

  it('still lets the same scope hold a target for a longer period beside it', async () => {
    /*
     * The tightening has to stop at identical dates. A month and the quarter
     * containing it are different periods and both are ordinary things to
     * plan against — which is why this is keyed on the dates rather than on
     * anything that would make one of the two unsettable.
     */
    const month = thisMonth();
    const quarter = resolvePeriod('QUARTERLY');
    const monthly = await setTarget({ periodKind: 'MONTHLY', amountKobo: '50000000' });
    const quarterly = await setTarget({
      periodKind: 'QUARTERLY',
      periodStart: iso(quarter.start),
      periodEnd: iso(quarter.end),
      amountKobo: '150000000',
    });

    assert.equal(monthly.status, 201, JSON.stringify(monthly.body));
    assert.equal(quarterly.status, 201, JSON.stringify(quarterly.body));
    assert.equal(quarterly.body.superseded, null, 'the quarter superseded the month inside it');
    assert.notEqual(
      iso(month.end),
      iso(quarter.end),
      'this month and this quarter end on the same day, so the case above is ' +
        'not the one this test means to cover',
    );
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

// ===========================================================================
/**
 * The hour when Jos is already tomorrow.
 *
 * `resolvePeriod` reads its boundaries off Plateau's calendar and says why:
 * "the period somebody means is the period they are standing in". The figures
 * measured against those boundaries were bucketed by the database session's
 * zone, which is UTC. Nigeria keeps West Africa Time all year, UTC+1 with no
 * daylight saving, so between 23:00Z and midnight the two disagree about the
 * day — and on the last day of a month, about the month.
 *
 * What that cost: money collected in the first hour of a Plateau month was
 * credited to the month that had just ended. Every new month opened
 * understated and every old one closed overstated, on the figures an
 * officer's performance is measured against and a forecast is built from.
 *
 * WHY THESE TESTS EXIST SEPARATELY FROM THE ONES ABOVE
 *
 * The suite found this by accident, by being run at 23:36Z on 30 September:
 * three tests above failed because "this month" in Plateau was already
 * October while the collections they made bucketed as September. Run at any
 * other hour they pass. A defect visible for one hour in twenty-four is one
 * CI will report as a flake and somebody will re-run until it goes away.
 *
 * So these do not ask what time it is. They put a collection at a known
 * instant that falls on one side of midnight in UTC and the other side in
 * Plateau, against a target for a month long past, and assert which month
 * gets it. They fail in both directions before the fix and are the same
 * every hour of the day.
 */
describe('a collection in the hour when UTC and Plateau disagree', () => {
  const APRIL_START = '2026-04-01';
  const APRIL_END = '2026-04-30';

  /** A settled collection stamped at an exact instant. */
  async function collectionAt(instant: Date, amountKobo: bigint): Promise<void> {
    await query(
      pool,
      `INSERT INTO transactions (
         transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
         lga_id, amount_kobo, total_amount_kobo, status, created_by, created_at, territory_id
       )
       SELECT 'TXN-TZ-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
              t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
              'SETTLED', t.created_by, $2, t.territory_id
         FROM transactions t
        WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
      [amountKobo.toString(), instant],
    );
  }

  /** April's row, with whatever the query credits to it. */
  async function aprilRow(): Promise<Record<string, string>> {
    await post(
      '/government/targets',
      {
        scope: 'STATE',
        periodKind: 'MONTHLY',
        periodStart: APRIL_START,
        periodEnd: APRIL_END,
        amountKobo: '10000000',
      },
      auth('revenue_officer'),
    );
    const rows = await get(
      `/government/targets?from=${APRIL_START}&to=${APRIL_END}`,
      auth('admin'),
    );
    const row = (rows.body as Record<string, string>[]).find(
      (candidate) => candidate.period_start.slice(0, 10) === APRIL_START,
    );
    assert.ok(row, 'April is in the list');
    return row!;
  }

  it('counts one taken at 00:30 in Jos towards the month that just began', async () => {
    // 2026-03-31T23:30:00Z is 2026-04-01T00:30 in Jos. An agent at a motor
    // park has taken money on the first of April. It is April's.
    await collect('1');
    const baseline = BigInt((await aprilRow()).collected_kobo);

    await collectionAt(new Date('2026-03-31T23:30:00Z'), 7_000_00n);

    assert.equal(
      BigInt((await aprilRow()).collected_kobo) - baseline,
      7_000_00n,
      'a collection taken in the first half-hour of April in Jos was left ' +
        "out of April's figure, because its UTC date was still 31 March",
    );
  });

  it('keeps one taken at 00:30 on 1 May out of April', async () => {
    /*
     * The same error in the other direction, and the one that makes a month
     * look better than it was. 2026-04-30T23:30:00Z is 1 May in Jos, so it
     * belongs to May — but its UTC date is 30 April, and April's window
     * claimed it.
     */
    await collect('1');
    const baseline = BigInt((await aprilRow()).collected_kobo);

    await collectionAt(new Date('2026-04-30T23:30:00Z'), 9_000_00n);

    assert.equal(
      BigInt((await aprilRow()).collected_kobo) - baseline,
      0n,
      "a collection taken on 1 May in Jos was counted in April's figure, " +
        'because its UTC date was still 30 April',
    );
  });

  it('is not confused by an instant that is the same day in both zones', async () => {
    // Most of the day is unambiguous, and must stay that way: noon on 15
    // April is 15 April on either clock.
    await collect('1');
    const baseline = BigInt((await aprilRow()).collected_kobo);

    await collectionAt(new Date('2026-04-15T12:00:00Z'), 5_000_00n);

    assert.equal(
      BigInt((await aprilRow()).collected_kobo) - baseline,
      5_000_00n,
      'a collection in the middle of an April day is no longer counted in April',
    );
  });
});

// ===========================================================================
/**
 * The other half of the same question, asked forwards.
 *
 * `periodComplete` asks whether a period has ended in Plateau and explains
 * itself at length. `daysElapsed`, thirty lines above it, subtracted
 * `periodStart` — a Plateau calendar date stored as a UTC midnight — from
 * `Date.now()`, an instant. In the hour before UTC midnight those disagree by
 * a day, so a forecast asked for the period Plateau is standing in came back
 * with the period not yet started: basis INSUFFICIENT_HISTORY, no projection,
 * for a month that already had money in it.
 *
 * THESE PASS AN EXPLICIT `now`, AND THE FIRST DRAFT OF THEM DID NOT
 *
 * Written first against a period months in the past, they asserted
 * `days_elapsed === 30` — which is what the clamp returns whichever clock the
 * subtraction uses, so they went green against the bug. Restoring
 * `Date.now()` did not fail them. `forecast` now takes `now` for the same
 * reason `resolvePeriod` takes an anchor: an hour-wide window cannot be
 * tested by waiting for it.
 */
describe('how far into a period a forecast thinks it is', () => {
  const APRIL = { periodStart: new Date(Date.UTC(2026, 3, 1)), periodEnd: new Date(Date.UTC(2026, 3, 30)) };

  it('is one day in, half an hour after the month began in Jos', async () => {
    // 23:30Z on 31 March is 00:30 on 1 April in Jos. April has begun where
    // the taxpayers and the officers are, and one day of it has started.
    const result = await forecast(pool, { ...APRIL, now: new Date('2026-03-31T23:30:00Z') });

    assert.equal(
      result.days_elapsed,
      1,
      'the first half-hour of April in Jos was reported as 0 days elapsed, ' +
        'which is what suppresses the projection entirely',
    );
    assert.notEqual(
      result.basis,
      'INSUFFICIENT_HISTORY',
      'a month that has begun and has money in it is not "not started"',
    );
  });

  it('is not started an hour earlier, when it has not begun in Jos either', async () => {
    // 22:30Z on 31 March is 23:30 on 31 March in Jos. April has not begun on
    // either clock, and saying so is correct.
    const result = await forecast(pool, { ...APRIL, now: new Date('2026-03-31T22:30:00Z') });

    assert.equal(result.days_elapsed, 0);
    assert.equal(result.basis, 'INSUFFICIENT_HISTORY');
  });

  it('holds the month open through the whole of its last day in Jos', async () => {
    /*
     * 22:30Z on 30 April is 23:30 on 30 April in Jos: the last day of the
     * month, on which its late payers settle. A figure reported as final
     * here is reported final while it can still move.
     */
    const result = await forecast(pool, { ...APRIL, now: new Date('2026-04-30T22:30:00Z') });

    assert.equal(result.days_elapsed, 30);
    assert.notEqual(
      result.confidence,
      'HIGH',
      "April was reported closed during its own last day, with the " +
        'confidence reserved for a figure that can no longer change',
    );
  });

  it('closes it once Jos has crossed into the next month', async () => {
    // 23:30Z on 30 April is 1 May in Jos. April is over; its actual is its
    // forecast, and HIGH is the honest confidence.
    const result = await forecast(pool, { ...APRIL, now: new Date('2026-04-30T23:30:00Z') });

    assert.equal(result.days_elapsed, 30);
    assert.equal(result.confidence, 'HIGH');
    assert.equal(result.projected_kobo, result.collected_kobo);
  });
});

// ===========================================================================

/**
 * The same hour, in every other figure that buckets money by day.
 *
 * The describe above fixed the targets. The rest of the platform went on
 * asking the database session's calendar, which is UTC: the period a month's
 * close freezes, the executive dashboard's today, week, month and year and its
 * per-category month, the thirty-day trend, an agent's month against the last
 * and the agent's own "today". Each case below stamps one collection at 00:30
 * in Jos on the day its figure begins — an instant whose UTC date is the day
 * before — and asserts the figure moved by exactly that amount.
 *
 * The period close is read against a month long past, like the targets above,
 * so it is the same every hour. The rest are "now" figures and have to use
 * this week's, month's and year's own first day; each skips itself in the one
 * half-hour a year, month, week or day when that instant is still to come.
 */
describe('the first hour of a Plateau day, everywhere else money is counted by day', () => {
  /** A settled collection by the demonstration agent, stamped at an exact instant. */
  async function collectionAt(instant: Date, amountKobo: bigint): Promise<void> {
    await query(
      pool,
      `INSERT INTO transactions (
         transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
         lga_id, amount_kobo, total_amount_kobo, status, created_by, created_at, territory_id,
         agent_id
       )
       SELECT 'TXN-TZ-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
              t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
              'SETTLED', t.created_by, $2, t.territory_id, t.agent_id
         FROM transactions t
        WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
      [amountKobo.toString(), instant],
    );
  }

  /** 00:30 in Jos on a Plateau calendar day — 23:30Z on the day before. */
  const halfPastMidnight = (day: string) => new Date(`${day}T00:30:00+01:00`);

  const plateauToday = () => todayInPlateau();
  const shift = (day: string, days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const mondayOf = (day: string) => shift(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

  /** Read a figure, stamp a collection, read it again: the difference. */
  async function moves(
    day: string,
    read: () => Promise<bigint>,
    amountKobo = 4_321_00n,
  ): Promise<bigint | null> {
    const instant = halfPastMidnight(day);
    if (instant.getTime() > Date.now()) return null; // that half-hour is still to come
    await collect('1');
    const before = await read();
    await collectionAt(instant, amountKobo);
    return (await read()) - before;
  }

  const dashboard = async () => {
    const response = await get('/government/dashboard', auth('admin'));
    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
    return response.body;
  };

  it('puts it in the month a period close freezes, not the month before', async () => {
    const figures = async (start: string, end: string) => {
      const response = await get(
        `/government/periods/figures?periodStart=${start}&periodEnd=${end}`,
        auth('admin'),
      );
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body as { collected_kobo: string; transaction_count: string };
    };
    await collect('1');
    const [marchBefore, aprilBefore] = [
      await figures('2026-03-01', '2026-03-31'),
      await figures('2026-04-01', '2026-04-30'),
    ];

    await collectionAt(new Date('2026-03-31T23:30:00Z'), 7_000_00n);

    const [march, april] = [
      await figures('2026-03-01', '2026-03-31'),
      await figures('2026-04-01', '2026-04-30'),
    ];
    assert.equal(
      BigInt(april.collected_kobo) - BigInt(aprilBefore.collected_kobo),
      7_000_00n,
      "money taken at 00:30 on 1 April in Jos was left out of April's close",
    );
    assert.equal(Number(april.transaction_count) - Number(aprilBefore.transaction_count), 1);
    assert.equal(
      BigInt(march.collected_kobo),
      BigInt(marchBefore.collected_kobo),
      "and was frozen into March's instead",
    );
  });

  it('counts it in today on the executive dashboard', async () => {
    const moved = await moves(plateauToday(), async () => BigInt((await dashboard()).collections.today_kobo));
    if (moved !== null) assert.equal(moved, 4_321_00n, "it was counted in yesterday's figure");
  });

  it('counts it in this week, from its Monday', async () => {
    const moved = await moves(mondayOf(plateauToday()), async () =>
      BigInt((await dashboard()).collections.week_kobo),
    );
    if (moved !== null) assert.equal(moved, 4_321_00n);
  });

  it('counts it in this month, from its first day', async () => {
    const moved = await moves(`${plateauToday().slice(0, 8)}01`, async () =>
      BigInt((await dashboard()).collections.month_kobo),
    );
    if (moved !== null) assert.equal(moved, 4_321_00n);
  });

  it('counts it in the year to date, from 1 January', async () => {
    const moved = await moves(`${plateauToday().slice(0, 4)}-01-01`, async () =>
      BigInt((await dashboard()).collections.ytd_kobo),
    );
    if (moved !== null) assert.equal(moved, 4_321_00n);
  });

  it("counts it in its category's month", async () => {
    const moved = await moves(`${plateauToday().slice(0, 8)}01`, async () =>
      ((await dashboard()).revenueByCategory as { month_kobo: string }[]).reduce(
        (total, row) => total + BigInt(row.month_kobo),
        0n,
      ),
    );
    if (moved !== null) assert.equal(moved, 4_321_00n);
  });

  it("puts it on today's bar of the thirty-day trend", async () => {
    const today = plateauToday();
    const moved = await moves(today, async () => {
      const bar = ((await dashboard()).dailyTrend as { day: string; amount_kobo: string }[]).find(
        (row) => row.day === today,
      );
      return BigInt(bar?.amount_kobo ?? '0');
    });
    if (moved !== null) assert.equal(moved, 4_321_00n);
  });

  it("counts it in the agent's month on the performance report", async () => {
    const moved = await moves(`${plateauToday().slice(0, 8)}01`, async () => {
      const rows = await get('/agents/performance', auth('admin'));
      assert.equal(rows.status, 200, JSON.stringify(rows.body).slice(0, 300));
      return (rows.body as { month_kobo: string }[]).reduce(
        (total, row) => total + BigInt(row.month_kobo),
        0n,
      );
    });
    if (moved !== null) assert.equal(moved, 4_321_00n);
  });

  it("counts it in the agent's own today", async () => {
    const moved = await moves(plateauToday(), async () => {
      const demo = await seedDemoAgent();
      const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
      const home = await get('/agents/me/home', {
        token: session.accessToken,
        deviceId: demo!.deviceIdentifier,
      });
      assert.equal(home.status, 200, JSON.stringify(home.body).slice(0, 300));
      return BigInt(home.body.today.collected_kobo);
    });
    if (moved !== null) assert.equal(moved, 4_321_00n, "the agent's screen put it in yesterday");
  });
});

/**
 * And where a person reads the date, or a Council reads a month.
 *
 * The officer home screens send their dates and times as finished strings,
 * which the portal prints as they arrive, and the commission report groups by
 * month. All three were formatted on UTC's clock.
 */
describe('a date or a time a person reads, on Plateau’s clock', () => {
  const shift = (day: string, days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  const plateauWallClock = (instant: Date) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(instant)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };

  it("gives a refused action the time it happened in Jos, on the auditor's home", async () => {
    // An auditor reads; setting a target is refused, and the refusal is audited.
    const refused = await setTarget({}, 'auditor');
    assert.equal(refused.status, 403, 'the fixture needs a refusal to record');
    const entry = await queryOne<{ created_at: Date }>(
      pool,
      `SELECT created_at FROM audit_logs WHERE result = 'DENIED' ORDER BY created_at DESC LIMIT 1`,
      [],
    );
    assert.ok(entry, 'the refusal was recorded');

    const home = await get('/government/home', auth('auditor'));
    assert.equal(home.status, 200, JSON.stringify(home.body).slice(0, 300));
    assert.equal(
      (home.body.work.refusals as { at: string }[])[0]?.at,
      plateauWallClock(entry!.created_at),
      'the auditor is shown UTC under "When", an hour behind Jos',
    );
  });

  it("shows an invoice's last day as Plateau's date on the revenue officer's home", async () => {
    // A bill whose payment window closes at 00:30 tomorrow in Jos: in UTC
    // that is still today, and the list said so.
    await collect('1');
    const tomorrow = shift(todayInPlateau(), 1);
    const deadline = new Date(`${tomorrow}T00:30:00+01:00`);
    const unpaid = await queryOne<{ id: string }>(
      pool,
      `UPDATE invoices SET status = 'UNPAID', amount_paid_kobo = 0, expires_at = $1
        WHERE id = (SELECT id FROM invoices ORDER BY created_at LIMIT 1)
        RETURNING id`,
      [deadline],
    );
    assert.ok(unpaid);

    const home = await get('/government/home', auth('revenue_officer'));
    assert.equal(home.status, 200, JSON.stringify(home.body).slice(0, 300));
    const row = (home.body.work.expiring as { id: string; expires_on: string }[]).find(
      (invoice) => invoice.id === unpaid!.id,
    );
    assert.equal(row?.expires_on, tomorrow, 'the officer was told it lapses a day early');
  });

  it('files commission accrued at 00:30 on the first under the month that began', async () => {
    const { transactionId } = await collect('1');
    const firstOfMonth = `${shift(`${todayInPlateau().slice(0, 8)}01`, -40).slice(0, 8)}01`;
    const stamped = await queryOne<{ id: string }>(
      pool,
      'UPDATE commissions SET created_at = $2 WHERE transaction_id = $1 RETURNING id',
      [transactionId, new Date(`${firstOfMonth}T00:30:00+01:00`)],
    );
    assert.ok(stamped, 'the collection earned a commission to stamp');

    const report = await get('/government/commissions/by-place', auth('admin'));
    assert.equal(report.status, 200, JSON.stringify(report.body).slice(0, 300));
    const periods = (report.body.byPeriod as { period: string }[]).map((row) => row.period);
    assert.deepEqual(
      periods,
      [firstOfMonth.slice(0, 7)],
      'it was filed under the month before, which had already ended in Jos',
    );
  });
});
