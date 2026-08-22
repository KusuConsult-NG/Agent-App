/**
 * A renewal document belongs to the agent who processed the renewal.
 *
 * `POST /vehicles/renewals/:renewalId/document` issues the vehicle document
 * for a paid renewal and answers with its verification code and a signed
 * download URL. It checked that the renewal had been paid for — the second
 * inviolable rule holds — and nothing about whose renewal it was.
 *
 * `vehicle_renewals.agent_id` records that from the moment the renewal is
 * created, so the check was available and simply not made. Any active agent
 * could post another agent's renewal id and receive that motorist's document
 * link and verification code.
 *
 * This is the same gap as the `:own` sweep, and it was missed by that sweep
 * for a reason worth writing down: the route is guarded by `vehicle:renew`,
 * which reads as an action rather than a scope, so searching for `:own` did
 * not surface it. `vehicle:read:all` cannot do the narrowing either — every
 * role holds it, agents included, deliberately, because an agent serving a
 * motorist who has walked up needs to look their vehicle up. Looking up a
 * vehicle and being handed the document for somebody else's renewal are not
 * the same act.
 *
 * So the narrowing is on the agent context: a caller acting as an agent gets
 * their own renewals. Officers are untouched.
 */

import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  revenueItemByCode,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string; agentId: string };
let officerToken = '';
let othersRenewalId = '';
let ownRenewalId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/**
 * A real renewal, paid for, through the API the agent actually uses.
 *
 * Built rather than inserted because a database trigger refuses a vehicle
 * renewal document without a paid transaction behind it — the control is
 * doing its job, and a hand-made row cannot satisfy it honestly.
 */
async function paidRenewal(plate: string): Promise<string> {
  const auth = { token: agent.token, deviceId: agent.device };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Motorist',
      lastName: plate,
      phone: `+2348088${plate.slice(-6)}`,
      address: '7 Motor Park Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `tp-${plate}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const vehicle = await post(
    '/vehicles',
    {
      registrationNumber: plate,
      vehicleType: 'PRIVATE_CAR',
      ownerName: 'Motorist Owner',
      taxpayerId: taxpayer.body.taxpayerId,
    },
    auth,
  );
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.body));

  const renewal = await post(
    `/vehicles/${vehicle.body.vehicleId ?? vehicle.body.id}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: 12,
      taxpayerId: taxpayer.body.taxpayerId,
    },
    { ...auth, idempotencyKey: `rn-${plate}` },
  );
  assert.equal(renewal.status, 201, JSON.stringify(renewal.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: renewal.body.transactionId },
    { ...auth, idempotencyKey: `pay-${plate}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );

  return renewal.body.renewalId ?? renewal.body.id;
}

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000100',
    fullName: 'Vehicle Admin',
  });
  officerToken = (await loginAs('+2348030000100')).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier, agentId: demo!.agentId };

  ownRenewalId = await paidRenewal(`OWN${String(Date.now()).slice(-6)}`);

  // A second agent, whose renewal the first has no business opening. The
  // renewal is built the same real way and then handed over, which is exactly
  // the situation the check has to catch.
  const otherUser = await createGovernmentUser({
    role: 'agent',
    phone: '+2348077770001',
    fullName: 'Other Field Agent',
  });
  const otherAgent = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO agents (user_id, application_number) VALUES ($1, $2) RETURNING id`,
    [otherUser, `APP-OTHER-${Date.now()}`],
  );
  othersRenewalId = await paidRenewal(`OTH${String(Date.now()).slice(-6)}`);
  await pool.query('UPDATE vehicle_renewals SET agent_id = $2 WHERE id = $1', [
    othersRenewalId,
    otherAgent!.id,
  ]);
});

const issue = (renewalId: string, who: { token: string; deviceId?: string }) =>
  post(`/vehicles/renewals/${renewalId}/document`, undefined, who);

describe('issuing a vehicle renewal document', () => {
  it('issues the document for the agent own renewal', async () => {
    const response = await issue(ownRenewalId, { token: agent.token, deviceId: agent.device });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(response.body.downloadUrl, 'the agent should get their own download link');
  });

  it('will not hand one agent another agent renewal', async () => {
    const response = await issue(othersRenewalId, { token: agent.token, deviceId: agent.device });

    assert.equal(response.status, 404, JSON.stringify(response.body));
    assert.equal(
      response.body?.downloadUrl,
      undefined,
      'no download URL for a renewal that is not theirs',
    );
    assert.equal(
      response.body?.verificationCode,
      undefined,
      'and no verification code either',
    );
  });

  it('leaves a government officer able to issue any of them', async () => {
    const response = await issue(othersRenewalId, { token: officerToken });

    assert.equal(response.status, 200, JSON.stringify(response.body));
  });
});
