/**
 * A compliance score a compliant citizen cannot achieve.
 *
 * A taxpayer with a TIN, one levy paid on time and nothing outstanding scored
 * 50 out of 100 and was told "Needs Attention — your compliance score needs
 * improvement. Paying your obligations on time will raise it." They had paid
 * their obligation on time. There was nothing else for them to do.
 *
 * Two separate faults produced that.
 *
 * THE SCALE MEASURED VOLUME, NOT COMPLIANCE. Payments scored five points each
 * up to thirty-five, and periods five each up to twenty — so full marks needed
 * seven payments and four periods. A trader assessed once a year could never
 * reach them however punctually they paid, and a score that cannot be earned by
 * doing everything right is not measuring whether you did everything right. It
 * gates fertiliser and seed, so the arithmetic decides who eats.
 *
 * THE PERIODS COMPONENT SILENTLY SCORED ZERO. It counted DISTINCT period_label,
 * and most revenue items have none — a daily market levy carries no period, an
 * annual shop rate does. Two equally compliant citizens got different scores
 * according to which levy they happened to pay, for a reason neither could see
 * or influence.
 *
 * Both components are now ratios of what the taxpayer was actually asked for.
 * Paying everything asked, on time, owing nothing, scores full marks — whether
 * that is one levy or forty.
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
import { queryOne, withTransaction } from '../db/pool';
import { computeComplianceScore } from '../services/incentives';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentAuth: { token: string; deviceId: string };
let subject = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Score Admin', phone: '+2348000000070', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Score Finance',
    phone: '+2348000000071',
    role: 'finance_officer',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

let lastPhone = '';

async function newTaxpayer() {
  subject += 1;
  lastPhone = `+2348171${String(subject).padStart(6, '0')}`;
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Score',
      lastName: `Subject${subject}`,
      phone: lastPhone,
      address: '8 Murtala Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `score-tp-${subject}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.taxpayerId as string;
}

/** Assess one levy against a taxpayer, optionally paying and settling it. */
async function assess(taxpayerId: string, itemCode: string, options: { pay?: boolean } = {}) {
  subject += 1;
  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId, revenueItemId: await revenueItemByCode(itemCode), inputs: {} },
    { ...agentAuth, idempotencyKey: `score-as-${subject}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  if (options.pay) {
    const payment = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId },
      { ...agentAuth, idempotencyKey: `score-pay-${subject}` },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      agentAuth,
    );
    await settleTransaction(assessment.body.transactionId);
  }
  return assessment.body.transactionId as string;
}

const scoreFor = (taxpayerId: string) =>
  withTransaction((client) => computeComplianceScore(client, taxpayerId));

describe('Somebody who has done everything asked of them', () => {
  it('scores full marks on one levy paid on time', async () => {
    /*
     * The case that produced the complaint. A TIN, one obligation, paid on
     * time, nothing owed — and a verdict of "Needs Attention".
     */
    const taxpayerId = await newTaxpayer();
    await assess(taxpayerId, 'MARKET-LEVY', { pay: true });

    const { score, components } = await scoreFor(taxpayerId);
    assert.equal(
      score,
      100,
      `paying everything asked, on time, owing nothing, is full compliance: ${JSON.stringify(components)}`,
    );
  });

  it('scores the same whether the levy carries a period label or not', async () => {
    /*
     * A daily market levy has no period_label; an annual shop rate does. The
     * periods component counted DISTINCT period_label, so the first scored zero
     * on it — up to twenty points decided by which levy a citizen happened to
     * be assessed under, which is not a fact about their compliance.
     */
    const unlabelled = await newTaxpayer();
    await assess(unlabelled, 'MARKET-LEVY', { pay: true });

    const labelled = await newTaxpayer();
    const transactionId = await assess(labelled, 'SHOPS-KIOSKS', { pay: true });
    // No revenue item sets a period_label of its own — only vehicle renewals
    // pass one — so the two cases have to be made to differ deliberately, or
    // this test passes without exercising anything.
    await pool.query(
      `UPDATE assessments SET period_label = '2026-Q1'
        WHERE id = (SELECT assessment_id FROM transactions WHERE id = $1)`,
      [transactionId],
    );

    const a = await scoreFor(unlabelled);
    const b = await scoreFor(labelled);
    assert.equal(
      a.score,
      b.score,
      `two equally compliant taxpayers must score alike: ${a.score} vs ${b.score}`,
    );
  });

  it('does not need seven payments to be considered compliant', async () => {
    // The old scale capped payments at 5 points each up to 35, so a taxpayer
    // assessed once a year could never reach it however punctually they paid.
    const once = await newTaxpayer();
    await assess(once, 'MARKET-LEVY', { pay: true });

    const often = await newTaxpayer();
    for (let i = 0; i < 7; i += 1) await assess(often, 'MARKET-LEVY', { pay: true });

    const a = await scoreFor(once);
    const b = await scoreFor(often);
    assert.equal(a.score, b.score, 'compliance is a ratio, not a quantity');
  });
});

describe('Somebody who has not', () => {
  it('scores below a taxpayer who has paid everything', async () => {
    const compliant = await newTaxpayer();
    await assess(compliant, 'MARKET-LEVY', { pay: true });

    const behind = await newTaxpayer();
    await assess(behind, 'MARKET-LEVY', { pay: true });
    await assess(behind, 'SHOPS-KIOSKS');

    const good = await scoreFor(compliant);
    const bad = await scoreFor(behind);
    assert.ok(
      bad.score < good.score,
      `an unpaid obligation must cost something: ${bad.score} vs ${good.score}`,
    );
  });

  it('loses the outstanding-liabilities points while anything is unpaid', async () => {
    const taxpayerId = await newTaxpayer();
    await assess(taxpayerId, 'MARKET-LEVY');

    const { components } = await scoreFor(taxpayerId);
    const outstanding = components.find((c) => /outstanding/i.test(c.factor));
    assert.ok(outstanding, 'the breakdown must name the liability');
    assert.equal(outstanding!.points, 0, 'and score nothing for it');
  });

  it('scores worse the more of their obligations go unpaid', async () => {
    // The ratio has to move, or it is not measuring anything.
    const half = await newTaxpayer();
    await assess(half, 'MARKET-LEVY', { pay: true });
    await assess(half, 'SHOPS-KIOSKS');

    const none = await newTaxpayer();
    await assess(none, 'MARKET-LEVY');
    await assess(none, 'SHOPS-KIOSKS');

    const a = await scoreFor(half);
    const b = await scoreFor(none);
    assert.ok(a.score > b.score, `half paid must beat none paid: ${a.score} vs ${b.score}`);
  });
});

describe('Somebody with no history at all', () => {
  it('is not told they need to improve', async () => {
    /*
     * A taxpayer registered this morning has been assessed nothing and so has
     * defaulted on nothing. A ratio has no meaning here, and reporting a low
     * number reads as an accusation about conduct there has not been any of.
     */
    const taxpayerId = await newTaxpayer();
    const { components } = await scoreFor(taxpayerId);

    const history = components.find((c) => /no assessment|nothing assessed|no history/i.test(
      `${c.factor} ${c.detail}`,
    ));
    assert.ok(
      history,
      `the breakdown must say there is no history yet: ${JSON.stringify(components)}`,
    );
  });

  it('is not told by the citizen portal that they need to improve either', async () => {
    /*
     * Where the complaint actually surfaced. Every read path syncs the score
     * first, so a row always exists by the time the status is decided, and the
     * NOT_ASSESSED branch that was written for exactly this case could never
     * be reached.
     */
    await newTaxpayer();
    const phone = lastPhone;

    const response = await get(`/citizen-status?phone=${encodeURIComponent(phone)}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.found, true);
    assert.equal(
      response.body.complianceStatus,
      'NOT_ASSESSED',
      `a taxpayer assessed nothing has not failed at anything: ${JSON.stringify(response.body)}`,
    );
    assert.doesNotMatch(
      response.body.message ?? '',
      /needs improvement/i,
      'and must not be told to improve conduct there has not been any of',
    );
  });

  it('still records the TIN they do have', async () => {
    const taxpayerId = await newTaxpayer();
    const { components } = await scoreFor(taxpayerId);
    const tin = components.find((c) => /TIN/i.test(c.factor));
    assert.ok(tin, 'the TIN component must still be reported');
  });
});

describe('What the number is used for', () => {
  it('still tells a taxpayer with arrears that they have them', async () => {
    // The control on the NOT_ASSESSED branch: it must widen only to people
    // with no history, not to everyone.
    const taxpayerId = await newTaxpayer();
    const phone = lastPhone;
    await assess(taxpayerId, 'MARKET-LEVY');

    const response = await get(`/citizen-status?phone=${encodeURIComponent(phone)}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.complianceStatus, 'HAS_ARREARS', JSON.stringify(response.body));
  });

  it('is stored so an officer and a programme read the same figure', async () => {
    const taxpayerId = await newTaxpayer();
    await assess(taxpayerId, 'MARKET-LEVY', { pay: true });
    const { score } = await scoreFor(taxpayerId);

    const stored = await queryOne<{ score: number; compliant_periods: number }>(
      pool,
      'SELECT score, compliant_periods FROM taxpayer_compliance WHERE taxpayer_id = $1',
      [taxpayerId],
    );
    assert.equal(stored!.score, score, 'the stored score is the computed one');
    assert.ok(
      stored!.compliant_periods >= 1,
      'and a paid assessment counts as a compliant period however it is labelled',
    );
  });
});
