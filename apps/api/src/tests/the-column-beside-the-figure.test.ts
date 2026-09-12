/**
 * The second column, and the arithmetic that makes it honest.
 *
 * Every revenue figure this platform produced stood alone. Ten items on the
 * officer readiness assessment read Missing for want of the column beside it —
 * yesterday's revenue, previous-period comparison, growth, decline, declining
 * categories, contribution share, growth per place, growth per agent.
 *
 * WHAT IS ACTUALLY HARD HERE
 *
 * Not the subtraction. The comparison being *like for like*. "This month
 * against last month", asked on the 8th of March, compares eight days with
 * thirty-one and reports a collapse every month — an error that looks like a
 * finding, which is the worst kind. So every previous period is cut at the same
 * point through itself, and that is what these tests are for.
 *
 * The other half is what happens when there is nothing to compare against. A
 * newly deployed ward that collected ₦0 last month and ₦2m this month has not
 * grown by 0% and has not grown infinitely: it has no growth figure, and the
 * payload says null rather than inventing one.
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

let token = '';
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
  await createGovernmentUser({ fullName: 'Growth Admin', phone: '+2348074000001', role: 'admin' });
  token = (await loginAs('+2348074000001')).accessToken;
  lgaId = await firstLgaId();
});

const auth = () => ({ token });

/** One real collection, so the comparisons have something true to sit on. */
async function collect(label: string): Promise<string> {
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Growth',
      lastName: `Subject${label}`,
      phone: `+2348140000${label.padStart(3, '0')}`,
      address: '9 Growth Road, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `gr-tp-${label}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `gr-as-${label}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `gr-pay-${label}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );
  await settleTransaction(assessment.body.transactionId);
  return assessment.body.transactionId;
}

/**
 * A verified collection on a chosen date, in a chosen place.
 *
 * Written directly: `created_at` comes from the server on every real
 * collection, so a previous month cannot be produced through the API — and the
 * subject here is the comparison arithmetic, not how a transaction comes to
 * exist.
 */
async function backdated(when: Date, amountKobo: bigint, wardId?: string | null): Promise<void> {
  await query(
    pool,
    `INSERT INTO transactions (
       transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
       lga_id, ward_id, agent_id, territory_id, amount_kobo, total_amount_kobo,
       status, created_by, created_at
     )
     SELECT 'TXN-BACK-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
            t.assessment_id, t.revenue_item_id, t.lga_id,
            COALESCE($3::uuid, t.ward_id), t.agent_id, t.territory_id, $1, $1,
            'SETTLED', t.created_by, $2
       FROM transactions t
      WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
    [amountKobo.toString(), when, wardId ?? null],
  );
}

const daysIntoMonth = () => new Date().getUTCDate() - 1;

// ===========================================================================
describe('the dashboard, with the period before it', () => {
  it('states yesterday as a figure, not as a point on a line', async () => {
    await collect('1');
    await backdated(new Date(Date.now() - 86_400_000), 7_000_000n);

    const dashboard = await get('/government/dashboard', auth());
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.collections.yesterday_kobo, '7000000');
    assert.ok(dashboard.body.collections.today_kobo, 'and today, as before');
  });

  /*
   * The property this whole file exists for.
   *
   * On the 8th of a month, "last month" has to mean the first 8 days of last
   * month. Comparing against the whole of it reports a collapse every month,
   * which is an error that looks like a finding.
   */
  it('compares like with like, cutting the previous month at the same day', async () => {
    const now = new Date();
    const elapsed = daysIntoMonth();
    // A month that has barely begun cannot demonstrate the cut.
    if (elapsed < 2) return;

    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    await collect('2');
    // Inside the comparable window: day 1 of last month.
    await backdated(new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1)), 5_000_000n);
    // Outside it: the last day of last month, which a naive comparison counts.
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    await backdated(lastDay, 90_000_000n);

    const dashboard = await get('/government/dashboard', auth());
    const collections = dashboard.body.collections;

    // The comparable figure holds only what fell inside the elapsed window.
    assert.equal(collections.previous_month_kobo, '5000000');
    // And the whole of last month is returned too, because at month end that is
    // the figure an officer wants and by then the two agree.
    assert.equal(collections.previous_month_whole_kobo, '95000000');
  });

  it('reports growth in basis points, and nothing when there is nothing to compare', async () => {
    const now = new Date();
    const elapsed = daysIntoMonth();
    if (elapsed < 2) return;
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    // A real collection first: `backdated` copies an existing settled row, and
    // it is also what gives this month a figure to compare.
    await collect('3');

    const empty = await get('/government/dashboard', auth());
    assert.equal(
      empty.body.collections.month_growth_bp,
      null,
      'no previous figure is not zero growth',
    );
    const thisMonthBefore = BigInt(empty.body.collections.month_kobo);

    // ₦40,000 last month, plus ₦60,000 more this month.
    await backdated(new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1)), 4_000_000n);
    await backdated(new Date(), 6_000_000n);

    const grown = await get('/government/dashboard', auth());
    assert.equal(grown.body.collections.previous_month_kobo, '4000000');
    assert.equal(
      BigInt(grown.body.collections.month_kobo),
      thisMonthBefore + 6_000_000n,
    );
    // ((this - 4,000,000) × 10,000) ÷ 4,000,000
    const expected = Number(
      ((thisMonthBefore + 6_000_000n - 4_000_000n) * 10_000n) / 4_000_000n,
    );
    assert.equal(Number(grown.body.collections.month_growth_bp), expected);
    assert.ok(expected > 0, 'and it is growth');
  });

  it('reports a decline as a negative, rather than as a smaller number', async () => {
    const now = new Date();
    const elapsed = daysIntoMonth();
    if (elapsed < 2) return;
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    await collect('4');
    const before = await get('/government/dashboard', auth());
    const thisMonth = BigInt(before.body.collections.month_kobo);

    // Ten times this month's figure, in the comparable window of last month.
    await backdated(
      new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1)),
      thisMonth * 10n,
    );

    const dashboard = await get('/government/dashboard', auth());
    assert.ok(
      Number(dashboard.body.collections.month_growth_bp) < 0,
      `expected a decline, got ${dashboard.body.collections.month_growth_bp}`,
    );
  });
});

// ===========================================================================
describe('categories, ranked by size and judged by direction', () => {
  /*
   * A category that halved was near the top of a list sorted by size and looked
   * healthy. Growth is what makes it visible.
   */
  it('gives each category its growth and its share of the month', async () => {
    const now = new Date();
    if (daysIntoMonth() < 2) return;
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    await collect('5');
    await backdated(new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1)), 8_000_000n);
    await backdated(new Date(), 2_000_000n);

    const dashboard = await get('/government/dashboard', auth());
    const categories = dashboard.body.revenueByCategory as Record<string, string>[];
    assert.ok(categories.length > 0, 'at least one category collected something');

    const declining = categories.find((row) => row.previous_month_kobo === '8000000');
    assert.ok(declining, JSON.stringify(categories));
    assert.ok(Number(declining!.growth_bp) < 0, 'a category that fell reads as a fall');

    // Contribution shares over the month sum to a whole, give or take rounding.
    const shares = categories
      .map((row) => Number(row.contribution_bp ?? 0))
      .filter((share) => share > 0);
    const total = shares.reduce((sum, share) => sum + share, 0);
    assert.ok(Math.abs(total - 10_000) <= shares.length, `shares summed to ${total}`);
  });
});

// ===========================================================================
describe('places, compared with themselves', () => {
  /*
   * The brief's own example: "Ward B's collections increased 48% after agent
   * deployment", and "LGA A has 4,000 registered taxpayers but only 35% payment
   * activity". Neither was computable.
   */
  it('gives each LGA growth, an average transaction and a compliance share', async () => {
    await collect('6');

    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    // The window immediately before this one is the seven days before that.
    await backdated(new Date(from.getTime() - 3 * 86_400_000), 4_000_000n);
    await backdated(to, 6_000_000n);

    const rows = await get(
      `/government/intelligence/geography?from=${from.toISOString()}&to=${to.toISOString()}`,
      auth(),
    );
    assert.equal(rows.status, 200);
    const lga = (rows.body as Record<string, unknown>[]).find(
      (row) => Number(row.amount_kobo) > 0,
    );
    assert.ok(lga, JSON.stringify(rows.body).slice(0, 400));

    assert.equal(lga!.previous_amount_kobo, '4000000');
    assert.ok(Number(lga!.growth_bp) > 0, 'the place grew');
    assert.ok(Number(lga!.average_kobo) > 0, 'and has an average transaction');
    assert.ok(
      Number(lga!.registered_taxpayers) > 0 && lga!.compliance_bp !== null,
      'and a share of its register that paid',
    );
  });

  it('says nothing rather than zero where a place has no history', async () => {
    await collect('7');
    const rows = await get('/government/intelligence/geography', auth());
    const quiet = (rows.body as Record<string, unknown>[]).find(
      (row) => row.previous_amount_kobo === '0',
    );
    assert.ok(quiet, 'some LGA collected nothing in the previous window');
    assert.equal(quiet!.growth_bp, null);
  });
});

// ===========================================================================
describe('agents, compared with themselves', () => {
  it('gives each agent last month, growth, and how many categories they work', async () => {
    const now = new Date();
    if (daysIntoMonth() < 2) return;
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    await collect('8');
    await backdated(new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1)), 3_000_000n);
    await backdated(new Date(), 9_000_000n);

    const rows = await get('/agents/performance', auth());
    assert.equal(rows.status, 200, JSON.stringify(rows.body));
    const agent = (rows.body as Record<string, unknown>[])[0]!;

    assert.equal(agent.previous_month_kobo, '3000000');
    assert.ok(Number(agent.month_kobo) >= 9_000_000, 'this month includes the new collection');
    assert.ok(Number(agent.growth_bp) > 0, 'and reads as growth');
    assert.ok(Number(agent.categories_processed) >= 1, 'and says how many levies they work');
  });
});

// ===========================================================================
describe('the breakdowns the dashboard stopped short of', () => {
  /*
   * `transactions.channel` has been written on every row since the platform
   * started and nothing had ever grouped by it, so "how much came through
   * agents against the taxpayer portal" was unanswerable — which is the
   * question behind every decision about where to deploy agents.
   */
  it('groups revenue by how the money arrived', async () => {
    await collect('9');
    const dashboard = await get('/government/dashboard', auth());
    const channels = dashboard.body.revenueByChannel as Record<string, string>[];
    assert.ok(channels.length > 0, JSON.stringify(dashboard.body.revenueByChannel));
    assert.ok(channels.every((row) => row.channel && row.amount_kobo));
    assert.ok(channels.some((row) => row.channel === 'AGENT_PWA'), 'the agent handset');
  });

  it('groups revenue by individual against business', async () => {
    await collect('10');
    const dashboard = await get('/government/dashboard', auth());
    const types = dashboard.body.revenueByTaxpayerType as Record<string, string>[];
    assert.ok(types.some((row) => row.taxpayer_type === 'INDIVIDUAL'));
    assert.ok(types.every((row) => row.average_kobo !== undefined), 'with an average each');
  });

  /*
   * "Local Government Levies" is a heading. "Shops and Kiosks Levy" is the
   * thing somebody is responsible for, and the dashboard stopped at the
   * heading.
   */
  it('drills one level below the category, to the levy itself', async () => {
    await collect('11');
    const dashboard = await get('/government/dashboard', auth());
    const items = dashboard.body.revenueByItem as Record<string, string>[];
    assert.ok(items.length > 0);
    assert.ok(items[0]!.item && items[0]!.category, 'the levy and the heading above it');
  });

  it('states reversed and refunded money as figures, not as a per-agent count', async () => {
    await collect('12');
    const dashboard = await get('/government/dashboard', auth());
    for (const key of [
      'reversed_transactions',
      'reversed_kobo',
      'refunded_transactions',
      'refunded_kobo',
      'agents_suspended',
      'agents_online',
      'expected_revenue_kobo',
    ]) {
      assert.ok(
        dashboard.body.counts[key] !== undefined,
        `the dashboard should state ${key}`,
      );
    }
  });

  /*
   * Presence, read from the sessions the platform already keeps.
   *
   * `sessions.last_used_at` is written on every authenticated request, so this
   * was a fact the platform held and had never read.
   */
  it('counts an agent who is working right now as online', async () => {
    await collect('13');
    const dashboard = await get('/government/dashboard', auth());
    assert.equal(
      dashboard.body.counts.agents_online,
      '1',
      'the demonstration agent has just made requests',
    );
  });
});

// ===========================================================================
describe('the taxpayer base as a population', () => {
  /*
   * "Active" means paying, not `status = 'ACTIVE'`.
   *
   * The register's own status says whether a record is live. It says nothing
   * about whether the person is paying, so a register full of people who last
   * paid in 2024 reports 100% active under that reading — which is the reading
   * the dashboard had.
   */
  it('splits the register by whether people are actually paying', async () => {
    await collect('14');

    // A second taxpayer, registered and never assessed.
    await query(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id)
       VALUES ('INDIVIDUAL', 'Dormant', 'Subject', '+2348140009999', '2 Quiet Lane, Jos', $1)`,
      [lgaId],
    );

    const analytics = await get('/government/taxpayers/analytics', auth());
    assert.equal(analytics.status, 200, JSON.stringify(analytics.body));

    const cohorts = analytics.body.cohorts as Record<string, string>;
    assert.equal(cohorts.total, '2');
    assert.equal(cohorts.active, '1', 'one of them has paid inside the window');
    assert.equal(cohorts.inactive, '1');
    assert.equal(cohorts.never_paid, '1');
    assert.ok(Number(cohorts.average_lifetime_kobo) > 0, 'and an average payment');
  });

  it('bands payment frequency rather than averaging it away', async () => {
    await collect('15');
    const analytics = await get('/government/taxpayers/analytics', auth());
    const bands = analytics.body.paymentFrequency as Record<string, string>[];
    assert.ok(bands.length > 0, JSON.stringify(bands));
    assert.ok(
      bands.every((row) =>
        ['ONCE', 'TWO_TO_THREE', 'FOUR_TO_ELEVEN', 'TWELVE_OR_MORE'].includes(row.band),
      ),
    );
  });

  /**
   * The column that said nobody had ever paid anything.
   *
   * `byCategory` counted `taxpayers_paid` with
   * `FILTER (WHERE asm.status IN ('SETTLED'))`. `assessments.status` allows
   * SETTLED and nothing writes it — the one `UPDATE assessments SET status`
   * sets EXPIRED, and `enum-coverage.ts` carries the value as unreachable
   * with the reason "settlement is recorded on the invoice and the
   * transaction, which is what the reports read". This report read the
   * assessment, so the column was zero for every category on every register.
   *
   * `collect()` drives a real taxpayer through assessment, initiation and a
   * successful gateway outcome, so by the time this asserts, the platform
   * itself has put the transaction into a revenue-recognised state. The
   * control beside it is the `taxpayers` count in the same row: if the
   * category did not appear at all, a zero here would prove nothing.
   */
  it('counts a taxpayer who has paid as having paid', async () => {
    await collect('17');

    const analytics = await get('/government/taxpayers/analytics', auth());
    assert.equal(analytics.status, 200, JSON.stringify(analytics.body));

    const rows = analytics.body.byCategory as Record<string, string>[];
    const engaged = rows.filter((row) => Number(row.taxpayers) > 0);
    assert.ok(engaged.length > 0, 'the control is broken: no category has any taxpayer at all');
    assert.ok(
      engaged.some((row) => Number(row.taxpayers_paid) > 0),
      `every category reports nobody has paid: ${JSON.stringify(engaged)}`,
    );
  });

  it('gives each LGA its register, its active share and what it is owed', async () => {
    await collect('16');
    const analytics = await get('/government/taxpayers/analytics', auth());
    const rows = analytics.body.byLga as Record<string, string>[];
    assert.ok(rows.length >= 17, 'every LGA is listed, including the empty ones');
    const busiest = rows[0]!;
    assert.ok(busiest.lga && busiest.taxpayers !== undefined && busiest.active !== undefined);
  });
});

// ===========================================================================
describe('commission, grouped the way a Council asks', () => {
  it('reports commission by place and by month', async () => {
    await collect('17');
    const rows = await get('/government/commissions/by-place', auth());
    assert.equal(rows.status, 200, JSON.stringify(rows.body));

    const byLga = rows.body.byLga as Record<string, string>[];
    assert.ok(byLga.length > 0, 'at least one LGA accrued commission');
    assert.ok(byLga[0]!.accrued_kobo !== undefined && byLga[0]!.paid_kobo !== undefined);

    const byPeriod = rows.body.byPeriod as Record<string, string>[];
    assert.ok(byPeriod.length > 0);
    assert.match(byPeriod[0]!.period, /^\d{4}-\d{2}$/);
  });
});
