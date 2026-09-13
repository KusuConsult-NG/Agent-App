/**
 * The additive tier nobody can see, and the periods nobody paid for.
 *
 * 1. `evaluateEligibility` computes BASE or FULL, stores it on
 *    `programme_eligibility.benefit_tier`, and returns it. Four tests already
 *    assert it. Every one of them calls the service function directly — and
 *    `benefit_tier` appears nowhere else in the codebase. Not in
 *    `getTaxpayerIncentives`, not in the taxpayer detail an officer reads, not
 *    in any route, not in any screen.
 *
 *    So the mechanism that makes PRD §40's safeguard operational — compliance
 *    raises the entitlement and never withdraws it — is invisible to the
 *    citizen it protects and to the officer administering it. Both are told
 *    `eligible: true` and nothing more, which is the same answer a gated
 *    programme gives, and the difference between them is the whole point.
 *
 *    `linkage_mode` is in the same position: it is the §40 decision about a
 *    programme, and `listProgrammes` does not return it, so an officer looking
 *    at the list cannot tell which programmes deny on tax grounds.
 *
 * 2. `compliant_periods` counts every distinct assessment period the taxpayer
 *    has ever had a transaction in, with no filter on whether any of it was
 *    paid. The breakdown shown to the taxpayer calls them "distinct assessment
 *    period(s) settled". They are not settled. Raise four assessments in four
 *    periods, pay none, and the score gains up to twenty points for
 *    compliance — and `minimum_compliance_periods`, which gates programme
 *    eligibility, is satisfied by them.
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
  startTestServer,
  stopTestServer,
  revenueItemByCode,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { evaluateEligibility, syncTaxpayerComplianceAndIncentives } from '../services/incentives';

let agent: { token: string; device: string };
let officer = '';
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
  lgaId = await firstLgaId();
  await createGovernmentUser({ fullName: 'Incentive Admin', phone: '+2348000000070', role: 'admin' });
  officer = (await loginAs('+2348000000070')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

function auth() {
  return { token: agent.token, deviceId: agent.device };
}

async function taxpayerWithTin(suffix: string): Promise<string> {
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Incentive',
      lastName: `Subject${suffix}`,
      phone: `+23480666${suffix.padStart(5, '0')}`,
      address: '8 Market Road, Bokkos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth(), idempotencyKey: `tp-${suffix}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await pool.query(
    `UPDATE taxpayers SET tin = $2, tin_status = 'ASSIGNED' WHERE id = $1 AND tin IS NULL`,
    [created.body.taxpayerId, `PL9000${suffix.padStart(4, '0')}`],
  );
  return created.body.taxpayerId as string;
}

/** A programme that is open to everyone in scope, with a score they cannot reach. */
async function additiveProgramme(code: string): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO incentive_programmes
       (name, code, description, benefit_type, benefit_description, eligibility_rules,
        minimum_score, minimum_compliance_periods, requires_no_arrears,
        start_date, approval_authority, status, linkage_mode)
     VALUES ($1,$2,'fixture','HEALTH_INSURANCE','fixture','{}'::jsonb,95,0,false,
             CURRENT_DATE, 'Test Authority', 'ACTIVE', 'ADDITIVE_BENEFIT')
     RETURNING id`,
    [`Programme ${code}`, code],
  );
  return row.rows[0]!.id;
}

/** An assessment raised and left unpaid, in its own period. */
async function unpaidAssessment(taxpayerId: string, suffix: string): Promise<void> {
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth(), idempotencyKey: `as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  // Distinct periods are what the score counts, so give each one its own.
  await pool.query(
    `UPDATE assessments SET period_label = $2 WHERE id = $1`,
    [assessment.body.assessmentId, `PERIOD-${suffix}`],
  );
}

describe('A citizen is told which entitlement they were awarded', () => {
  it('returns the benefit tier with the programmes', async () => {
    const taxpayerId = await taxpayerWithTin('1');
    const programmeId = await additiveProgramme('VIS-1');

    const evaluated = await evaluateEligibility({ programmeId, taxpayerId });
    assert.equal(evaluated.eligible, true, 'additive programmes never deny');
    assert.equal(evaluated.benefitTier, 'BASE', 'and this fixture has a shortfall');

    const read = await get(`/taxpayers/${taxpayerId}/incentives`, { token: officer });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const programme = read.body.programmes.find((p: any) => p.id === programmeId);
    assert.ok(programme, 'the programme is listed');
    assert.equal(
      programme.benefit_tier,
      'BASE',
      `the tier was computed and stored but not returned: ${JSON.stringify(programme)}`,
    );
  });

  it('says which programmes can deny on tax grounds and which cannot', async () => {
    await additiveProgramme('VIS-2');

    const list = await get('/government/programmes?status=ACTIVE', { token: officer });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const programme = list.body.find((p: any) => p.code === 'VIS-2');
    assert.ok(programme, 'the programme is listed');
    assert.equal(
      programme.linkage_mode,
      'ADDITIVE_BENEFIT',
      `an officer cannot tell a gate from an additive programme: ${JSON.stringify(programme)}`,
    );
  });

  it('carries the tier into the taxpayer record an officer reads', async () => {
    const taxpayerId = await taxpayerWithTin('2');
    const programmeId = await additiveProgramme('VIS-3');
    await evaluateEligibility({ programmeId, taxpayerId });

    const detail = await get(`/taxpayers/${taxpayerId}`, { token: officer });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const programme = detail.body.programmes.find((p: any) => p.id === programmeId);
    assert.ok(programme, 'the programme is on the record');
    assert.equal(programme.benefit_tier, 'BASE', JSON.stringify(programme));
  });
});

describe('A compliant period is one that was paid for', () => {
  it('does not count periods where nothing was paid', async () => {
    const taxpayerId = await taxpayerWithTin('3');
    for (const suffix of ['a', 'b', 'c', 'd']) {
      await unpaidAssessment(taxpayerId, suffix);
    }

    await syncTaxpayerComplianceAndIncentives(pool, taxpayerId);

    const compliance = await queryOne<{ compliant_periods: number; score_breakdown: unknown }>(
      pool,
      'SELECT compliant_periods, score_breakdown FROM taxpayer_compliance WHERE taxpayer_id = $1',
      [taxpayerId],
    );
    assert.equal(
      compliance!.compliant_periods,
      0,
      'four assessments, none of them paid, counted as compliant periods',
    );

    const periods = (compliance!.score_breakdown as { factor: string; points: number }[]).find(
      (c) => c.factor === 'Compliant periods',
    );
    assert.equal(periods?.points, 0, 'and they earned points for compliance');
  });

  it('does not let unpaid periods satisfy a programme minimum', async () => {
    const taxpayerId = await taxpayerWithTin('4');
    for (const suffix of ['e', 'f']) {
      await unpaidAssessment(taxpayerId, suffix);
    }

    const row = await pool.query<{ id: string }>(
      `INSERT INTO incentive_programmes
         (name, code, description, benefit_type, benefit_description, eligibility_rules,
          minimum_score, minimum_compliance_periods, requires_no_arrears,
          start_date, approval_authority, status, linkage_mode)
       VALUES ('Two periods required','PER-1','fixture','TRAINING_ACCESS','fixture','{}'::jsonb,
               0, 2, false, CURRENT_DATE, 'Test Authority', 'ACTIVE', 'ELIGIBILITY_GATE')
       RETURNING id`,
    );

    const evaluated = await evaluateEligibility({
      programmeId: row.rows[0]!.id,
      taxpayerId,
    });

    assert.equal(
      evaluated.eligible,
      false,
      `two unpaid assessments satisfied a two-compliant-period requirement: ${JSON.stringify(evaluated.reasons)}`,
    );
  });

  // --- controls ---

  it('still counts a period that was actually paid', async () => {
    const taxpayerId = await taxpayerWithTin('5');
    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId, revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'), inputs: {} },
      { ...auth(), idempotencyKey: 'as-paid' },
    );
    // Give it a period, as the unpaid fixtures have. A SHOPS-KIOSKS assessment
    // carries no period_label of its own, and count(DISTINCT ...) ignores
    // nulls — so without this the control could not count either, and would
    // pass or fail for a reason that has nothing to do with payment.
    await pool.query(`UPDATE assessments SET period_label = 'PERIOD-paid' WHERE id = $1`, [
      assessment.body.assessmentId,
    ]);

    const initiated = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId },
      { ...auth(), idempotencyKey: 'pay-paid' },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      auth(),
    );

    await syncTaxpayerComplianceAndIncentives(pool, taxpayerId);

    const compliance = await queryOne<{ compliant_periods: number }>(
      pool,
      'SELECT compliant_periods FROM taxpayer_compliance WHERE taxpayer_id = $1',
      [taxpayerId],
    );
    assert.ok(
      compliance!.compliant_periods >= 1,
      `a paid period must still count: ${JSON.stringify(compliance)}`,
    );
  });

  it('still never denies an additive programme to someone in scope', async () => {
    const taxpayerId = await taxpayerWithTin('6');
    await unpaidAssessment(taxpayerId, 'g');
    const programmeId = await additiveProgramme('VIS-4');

    const evaluated = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(evaluated.eligible, true, JSON.stringify(evaluated.reasons));
    assert.equal(evaluated.benefitTier, 'BASE');
  });
});
