/**
 * Who may cancel what a citizen owes, and whose name goes on it.
 *
 * `PUT /taxpayers/:id/obligations` takes the full list of what a taxpayer
 * owes. Anything already active and absent from the list is waived, and an
 * empty list waives everything. It is gated on `taxpayer:update`, which the
 * agent role holds — that permission exists so an agent can fix a phone number
 * or an address during onboarding, not so they can cancel tax liability.
 *
 * So an agent could zero out the obligations of any taxpayer they had
 * registered. Adding obligations is onboarding and belongs to the agent;
 * removing them is a revenue decision and belongs to an officer. The service
 * already draws that line in its own vocabulary — `AGENT_ONBOARDING` versus
 * `OFFICER_REVIEW` — without anything enforcing it.
 *
 * The second half is worse. The audit entry recorded:
 *
 *   actorRole: source === 'AGENT_ONBOARDING' ? 'agent' : 'revenue_officer'
 *
 * `source` is a field in the request body. An agent sending
 * `source: 'OFFICER_REVIEW'` produced an audit row attributing their own
 * change to a revenue officer. The audit chain is the platform's evidence of
 * who did what — it is hash-linked precisely so entries cannot be altered
 * afterwards — and its `actor_role` was being taken from untrusted input. The
 * chain would still verify perfectly, because the false attribution was
 * written and then sealed. Tamper-evidence does not help when the tampering
 * happens before the seal.
 */

import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  put,
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

let agent: { token: string; device: string };
let officerToken = '';
let taxpayerId = '';
let itemA = '';
let itemB = '';

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
    role: 'revenue_officer',
    phone: '+2348030000093',
    fullName: 'Revenue Officer',
  });
  officerToken = (await loginAs('+2348030000093')).accessToken;

  // seedDemoAgent walks the real clearance pipeline, which needs an approver.
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000094',
    fullName: 'Clearance Admin',
  });

  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demo agent should have been created');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  itemA = await revenueItemByCode('SHOPS-KIOSKS');
  itemB = await revenueItemByCode('DEV-LEVY');

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Obligation',
      lastName: 'Subject',
      phone: '+2348033330001',
      address: '9 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'tp-oblig' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId;
});

const setObligations = (
  itemIds: string[],
  who: { token: string; deviceId?: string },
  source?: string,
) =>
  put(
    `/taxpayers/${taxpayerId}/obligations`,
    source ? { itemIds, source } : { itemIds },
    who,
  );

const activeCount = async () =>
  Number(
    (
      await queryOne<{ count: string }>(
        pool,
        `SELECT count(*)::text AS count FROM taxpayer_tax_obligations
          WHERE taxpayer_id = $1 AND status = 'ACTIVE'`,
        [taxpayerId],
      )
    )!.count,
  );

describe('setting a taxpayer obligations', () => {
  it('lets an agent add obligations while onboarding', async () => {
    const response = await setObligations([itemA, itemB], {
      token: agent.token,
      deviceId: agent.device,
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await activeCount(), 2);
  });

  it('records the agent as the actor, whatever the request body claims', async () => {
    await setObligations([itemA], { token: agent.token, deviceId: agent.device }, 'OFFICER_REVIEW');

    const entry = await queryOne<{ actor_role: string }>(
      pool,
      `SELECT actor_role FROM audit_logs
        WHERE action = 'OBLIGATION_SET' AND entity_id = $1
        ORDER BY sequence_no DESC LIMIT 1`,
      [taxpayerId],
    );
    assert.ok(entry, 'setting obligations must be audited');
    assert.equal(
      entry!.actor_role,
      'agent',
      'the audit log records who acted, not what the caller said about itself',
    );
  });

  it('refuses to let an agent waive an obligation', async () => {
    await setObligations([itemA, itemB], { token: agent.token, deviceId: agent.device });
    assert.equal(await activeCount(), 2);

    // Dropping itemB from the list waives it.
    const response = await setObligations([itemA], { token: agent.token, deviceId: agent.device });

    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(await activeCount(), 2, 'nothing may be waived by an agent');
  });

  it('refuses to let an agent waive everything at once', async () => {
    await setObligations([itemA, itemB], { token: agent.token, deviceId: agent.device });

    const response = await setObligations([], { token: agent.token, deviceId: agent.device });

    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(await activeCount(), 2, 'an empty list must not clear a citizen liability');
  });

  it('lets a revenue officer waive, and records them as the actor', async () => {
    await setObligations([itemA, itemB], { token: agent.token, deviceId: agent.device });

    const response = await setObligations([itemA], { token: officerToken });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await activeCount(), 1, 'an officer may waive');

    const entry = await queryOne<{ actor_role: string }>(
      pool,
      `SELECT actor_role FROM audit_logs
        WHERE action = 'OBLIGATION_SET' AND entity_id = $1
        ORDER BY sequence_no DESC LIMIT 1`,
      [taxpayerId],
    );
    assert.equal(entry!.actor_role, 'revenue_officer');
  });
});
