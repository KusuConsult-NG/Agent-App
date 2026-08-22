/**
 * Clearing an agent has to pay the agent.
 *
 * Confirming a fraud flag moves every PENDING and ELIGIBLE commission the
 * agent holds to ON_HOLD, which is right: PRD §28 freezes the incentive while
 * an investigation runs. Dismissing the flag did nothing at all. The review
 * route branched on CONFIRMED and had no branch for DISMISSED, and no other
 * code in the platform moves a commission out of ON_HOLD.
 *
 * `COMMISSION_TRANSITIONS` says the release was intended — `ON_HOLD` lists
 * `ELIGIBLE` among its legal destinations — but nothing performs it. So a
 * legal move existed that the platform could not make, which is the same shape
 * as an endpoint with no caller.
 *
 * The consequence lands on the third inviolable rule from the other side.
 * "No verified/reconciled transaction, no agent commission" is a rule about
 * not paying for work that was not confirmed; it does not license withholding
 * pay for work that was. An agent flagged, investigated and cleared had money
 * accrued against settled, reconciled transactions frozen for good, with a
 * `hold_reason` naming a flag that had since been dismissed. Only a manual
 * database write could pay them.
 *
 * Releasing to ELIGIBLE would be the wrong repair. A commission that was still
 * PENDING when the hold landed has not necessarily met the conditions for
 * payment — its transaction may not be settled, or its hold period may not
 * have elapsed — and ELIGIBLE means payable. Release returns it to PENDING and
 * lets `promoteEligibleCommissions` apply the ordinary test, which is the one
 * place those conditions are written down.
 */

import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let officerToken = '';
let agentId = '';
let agent: { token: string; device: string };
let collected = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  // seedDemoAgent walks the real clearance pipeline, which needs an approver.
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000092',
    fullName: 'Fraud Officer',
  });
  officerToken = (await loginAs('+2348030000092')).accessToken;

  const demo = await seedDemoAgent();
  agentId = demo!.agentId;
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  collected = 0;
});

/**
 * One complete collection, which accrues a PENDING commission the ordinary
 * way. Building the commission by hand would test a row rather than the path
 * that produces it.
 */
async function collect(): Promise<string> {
  const suffix = String(++collected);
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Fraud',
      lastName: `Subject${suffix}`,
      phone: `+23480222${suffix.padStart(5, '0')}`,
      address: '3 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `tp-${suffix}` },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `as-${suffix}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );

  const commission = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM commissions WHERE transaction_id = $1',
    [assessment.body.transactionId],
  );
  assert.ok(commission, 'a collection should accrue a commission');
  return commission!.id;
}

/**
 * A collection, then the commission it accrued forced into `status`.
 *
 * The forcing is setup, not the behaviour under test: reaching ELIGIBLE
 * legitimately needs a settled transaction and an elapsed hold period, and
 * this test is about what a fraud decision does to money, not about how money
 * becomes eligible.
 */
async function commissionWith(status: string): Promise<string> {
  const id = await collect();
  if (status !== 'PENDING') {
    await pool.query('UPDATE commissions SET status = $2 WHERE id = $1', [id, status]);
  }
  return id;
}

async function flagFor(agentIdValue: string) {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, agent_id, status)
     VALUES ('velocity', 'HIGH', 'AGENT', $1, $1, 'OPEN') RETURNING id`,
    [agentIdValue],
  );
  return row!.id;
}

const review = (flagId: string, decision: string) =>
  post(
    `/government/fraud/flags/${flagId}/review`,
    { decision, note: 'Investigated the flagged pattern and reached a decision.' },
    { token: officerToken },
  );

const statuses = async () =>
  (
    await query<{ status: string; hold_reason: string | null }>(
      pool,
      'SELECT status, hold_reason FROM commissions WHERE agent_id = $1 ORDER BY created_at',
      [agentId],
    )
  ).map((r) => r.status);

describe('a fraud flag and the money it freezes', () => {
  it('freezes the incentive when a flag is confirmed', async () => {
    await commissionWith('PENDING');
    await commissionWith('ELIGIBLE');
    const flagId = await flagFor(agentId);

    const response = await review(flagId, 'CONFIRMED');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(await statuses(), ['ON_HOLD', 'ON_HOLD']);
  });

  it('releases the money when the flag is dismissed', async () => {
    await commissionWith('PENDING');
    await commissionWith('ELIGIBLE');
    const flagId = await flagFor(agentId);

    await review(flagId, 'CONFIRMED');
    assert.deepEqual(await statuses(), ['ON_HOLD', 'ON_HOLD'], 'held while investigated');

    const response = await review(flagId, 'DISMISSED');
    assert.equal(response.status, 200, JSON.stringify(response.body));

    assert.deepEqual(
      await statuses(),
      ['PENDING', 'PENDING'],
      'a cleared agent must not be left holding frozen commission',
    );
  });

  it('leaves the hold reason behind once released', async () => {
    await commissionWith('PENDING');
    const flagId = await flagFor(agentId);
    await review(flagId, 'CONFIRMED');
    await review(flagId, 'DISMISSED');

    const row = await queryOne<{ status: string; hold_reason: string | null }>(
      pool,
      'SELECT status, hold_reason FROM commissions WHERE agent_id = $1',
      [agentId],
    );
    assert.equal(row!.status, 'PENDING');
    assert.equal(row!.hold_reason, null, 'a lifted hold should not still name a dismissed flag');
  });

  it('does not release a hold placed by a different, still-confirmed flag', async () => {
    // Two flags, two holds. Dismissing one must not pay out money frozen by
    // the other — otherwise clearing a trivial flag unfreezes a serious one.
    const first = await commissionWith('PENDING');
    const flagA = await flagFor(agentId);
    await review(flagA, 'CONFIRMED');

    const second = await commissionWith('PENDING');
    const flagB = await flagFor(agentId);
    await review(flagB, 'CONFIRMED');

    await review(flagA, 'DISMISSED');

    const rows = await query<{ id: string; status: string }>(
      pool,
      'SELECT id, status FROM commissions WHERE agent_id = $1',
      [agentId],
    );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    assert.equal(byId.get(first), 'PENDING', 'the dismissed flag releases its own hold');
    assert.equal(byId.get(second), 'ON_HOLD', 'the confirmed flag keeps its hold');
  });
});
