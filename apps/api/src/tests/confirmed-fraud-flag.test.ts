/**
 * A confirmed fraud flag is the strongest signal this platform has, and
 * nothing tested for it.
 *
 * `'CONFIRMED'` appears in exactly two places outside the tests: the list of
 * decisions a reviewing officer may record, and the branch that places a
 * commission hold when they record it. Every guard that consults a flag —
 * `requestPayout`, `promoteEligibleCommissions`, the dashboards — reads
 * `status IN ('OPEN', 'UNDER_REVIEW')`. So the whole protection against paying
 * an agent whose fraud was investigated and *upheld* rests on the hold placed
 * at the moment of confirmation, and that hold has two holes in it.
 *
 * It only catches what exists. `holdCommissionsForAgent` moves the PENDING and
 * ELIGIBLE rows the agent has at that instant. Commission earned afterwards is
 * new PENDING, and `promoteEligibleCommissions` — which only excludes OPEN and
 * UNDER_REVIEW — makes it payable. The agent goes on collecting and goes on
 * being paid for it.
 *
 * It can be lifted by an unrelated flag. Holds are scoped by `hold_reason`,
 * deliberately, "because an agent can be held under more than one
 * investigation at once and clearing a minor flag must not pay out money
 * frozen by a serious one". That works when the serious flag froze something.
 * A second confirmation finds nothing PENDING or ELIGIBLE left to freeze, so
 * it holds nothing under its own reason — and dismissing the first flag then
 * releases everything, with the second still standing.
 *
 * There is also no resolution state between CONFIRMED and DISMISSED, so
 * treating CONFIRMED as blocking is what the design already means: held until
 * somebody clears it.
 *
 * Separately, the guards match `entity_type = 'AGENT' AND entity_id = agent`,
 * while `fraud_flags` carries an `agent_id` column that every rule populates.
 * DEVICE_VELOCITY — one handset past forty transactions in an hour, the
 * signal most likely to mean a phone is being run by somebody it was not
 * issued to — is raised HIGH against the DEVICE, so it never reached either
 * guard.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { promoteEligibleCommissions } from '../services/commission';

let officerToken = '';
let agentId = '';
let agent: { token: string; device: string };
let agentPhone = '';
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
  await createGovernmentUser({ role: 'admin', phone: '+2348030000160', fullName: 'Fraud Admin' });
  officerToken = (await loginAs('+2348030000160')).accessToken;

  const demo = await seedDemoAgent();
  agentId = demo!.agentId;
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  agentPhone = demo!.phone;
  collected = 0;

  await pool.query(
    `UPDATE bank_accounts SET verification_status = 'VERIFIED'
      WHERE id = (SELECT bank_account_id FROM agents WHERE id = $1)`,
    [agentId],
  );
});

/** One collection, accruing a commission the ordinary way. */
async function collect(): Promise<string> {
  const suffix = String(++collected);
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Fraud',
      lastName: `Subject${suffix}`,
      phone: `+23480555${suffix.padStart(5, '0')}`,
      address: '5 Market Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `fr-tp-${suffix}` },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `fr-as-${suffix}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `fr-pay-${suffix}` },
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
  assert.ok(commission);
  // Settled, with the hold period behind it: what promoteEligibleCommissions
  // is meant to find. Setup, not the behaviour under test.
  await pool.query(
    `UPDATE transactions SET status = 'SETTLED', settled_at = now() - interval '30 days'
      WHERE id = $1`,
    [assessment.body.transactionId],
  );
  return commission!.id;
}

async function flag(severity: string, entityType: string, entityId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, agent_id, status)
     VALUES ('velocity', $1, $2, $3, $4, 'OPEN') RETURNING id`,
    [severity, entityType, entityId, agentId],
  );
  return row!.id;
}

const review = (flagId: string, decision: string) =>
  post(
    `/government/fraud/flags/${flagId}/review`,
    { decision, note: 'Investigated the flagged pattern and reached a decision.' },
    { token: officerToken },
  );

const statusOf = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM commissions WHERE id = $1', [id]))!
    .status;

async function attemptPayout() {
  await grantStepUp(agent.token, agentPhone, 'commission.payout.request');
  return post(
    '/agents/me/commission/payout',
    {},
    { token: agent.token, deviceId: agent.device, idempotencyKey: `fr-po-${Date.now()}` },
  );
}

describe('an agent whose fraud was upheld is not paid', () => {
  it('does not make commission earned after the confirmation payable', async () => {
    const first = await collect();
    const flagId = await flag('HIGH', 'AGENT', agentId);
    await review(flagId, 'CONFIRMED');
    assert.equal(await statusOf(first), 'ON_HOLD', 'what existed at the time was held');

    // The agent keeps collecting. This commission never met the hold.
    const later = await collect();
    assert.equal(await statusOf(later), 'PENDING');

    await promoteEligibleCommissions({ now: new Date() });

    assert.equal(
      await statusOf(later),
      'PENDING',
      'commission earned after a confirmed fraud flag became payable',
    );
  });

  it('does not release everything when one of two confirmations is dismissed', async () => {
    const commissionId = await collect();

    const minor = await flag('HIGH', 'AGENT', agentId);
    await review(minor, 'CONFIRMED');
    assert.equal(await statusOf(commissionId), 'ON_HOLD');

    // A second investigation, confirmed. There is nothing left PENDING or
    // ELIGIBLE for it to freeze, so it holds nothing under its own reason.
    const serious = await flag('CRITICAL', 'AGENT', agentId);
    await review(serious, 'CONFIRMED');

    // The first is cleared. The second still stands.
    await review(minor, 'DISMISSED');
    await promoteEligibleCommissions({ now: new Date() });

    const payout = await attemptPayout();
    assert.notEqual(
      payout.status,
      201,
      'an agent with a standing confirmed fraud flag was paid because a different flag was dismissed',
    );
  });

  it('holds commission for a high-severity flag raised against the handset', async () => {
    // DEVICE_VELOCITY is raised HIGH against the DEVICE, with the agent named
    // in agent_id. Both guards matched entity_type = 'AGENT', so it reached
    // neither.
    const commissionId = await collect();
    await pool.query(`UPDATE commissions SET status = 'ELIGIBLE', eligible_at = now() WHERE id = $1`, [
      commissionId,
    ]);

    const deviceId = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM agent_devices WHERE agent_id = $1 LIMIT 1',
      [agentId],
    );
    assert.ok(deviceId, 'the agent has a registered handset');
    await flag('HIGH', 'DEVICE', deviceId!.id);

    const payout = await attemptPayout();
    assert.notEqual(
      payout.status,
      201,
      'a high-severity flag against the agent’s own handset did not hold their commission',
    );
  });

  it('still pays an agent whose flag was dismissed', async () => {
    // The control. Blocking on CONFIRMED must not block on cleared.
    const commissionId = await collect();
    const flagId = await flag('HIGH', 'AGENT', agentId);
    await review(flagId, 'CONFIRMED');
    await review(flagId, 'DISMISSED');

    await promoteEligibleCommissions({ now: new Date() });
    assert.equal(await statusOf(commissionId), 'ELIGIBLE', 'a cleared agent is payable again');

    const payout = await attemptPayout();
    assert.equal(payout.status, 201, JSON.stringify(payout.body));
  });
});
