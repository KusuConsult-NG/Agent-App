/**
 * The last two step-up actions, which named operations that did not exist.
 *
 * `STEP_UP_ACTIONS` declared seven actions requiring a fresh one-time code.
 * Four were enforced by a route; three named nothing at all. The bank account
 * change closed the first. These are the other two, and each carries a
 * different risk.
 *
 * A TAXPAYER'S IDENTITY decides which person a record is about. The identity
 * hash is what duplicate detection blocks on, scoring the full 100 where a
 * shared phone reaches 85, so rewriting it can walk a compliance history —
 * and the benefits that follow from it — onto somebody else. Correcting a
 * misspelt name is ordinary administration; changing the document is not, and
 * the two are separated by permission rather than by good intentions. Agents
 * are refused both, because an agent rewriting the identity of a taxpayer
 * they registered is the whole fraud in one step.
 *
 * A USER'S ROLE decides what they may do. The risk is self-escalation, and
 * the load-bearing detail is that the role travels in the access token: a
 * demotion that does not end the user's sessions leaves them holding the old
 * permissions until the token expires, which is exactly the window that
 * matters when somebody is being demoted for cause.
 */

import {
  createGovernmentUser,
  firstLgaId,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { hashIdentityNumber } from '../lib/crypto';
import { roleHasPermission } from '@psirs/shared';

let adminToken = '';
let officerToken = '';
let otherAdmin = { id: '', token: '', phone: '' };
let agent: { token: string; device: string };
let taxpayerId = '';
let lgaId = '';

const ADMIN = '+2348030000190';
const OFFICER = '+2348030000191';
const SECOND_ADMIN = '+2348030000192';

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

  await createGovernmentUser({ role: 'admin', phone: ADMIN, fullName: 'Records Administrator' });
  adminToken = (await loginAs(ADMIN)).accessToken;
  await createGovernmentUser({ role: 'revenue_officer', phone: OFFICER, fullName: 'Revenue Officer' });
  officerToken = (await loginAs(OFFICER)).accessToken;
  await createGovernmentUser({ role: 'admin', phone: SECOND_ADMIN, fullName: 'Second Administrator' });
  const second = await loginAs(SECOND_ADMIN);
  otherAdmin = { id: second.user.id, token: second.accessToken, phone: SECOND_ADMIN };

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      lastName: 'Danjjuma',
      phone: '+2348037000111',
      address: '4 Market Road, Jos',
      lgaId,
      identityType: 'NIN',
      identityNumber: '11122233344',
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'identity-1' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  taxpayerId = created.body.taxpayerId ?? created.body.id;
});

const record = () =>
  queryOne<{ last_name: string; identity_hash: string | null; identity_masked: string | null }>(
    pool,
    'SELECT last_name, identity_hash, identity_masked FROM taxpayers WHERE id = $1',
    [taxpayerId],
  );

// ---------------------------------------------------------------- identity

describe('correcting a taxpayer record', () => {
  it('is refused without a step-up code', async () => {
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      { lastName: 'Danjuma', reason: 'Surname was misspelt at registration.' },
      { token: officerToken },
    );
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'STEP_UP_REQUIRED');
    assert.equal((await record())!.last_name, 'Danjjuma', 'nothing should have changed');
  });

  it('lets a revenue officer correct a misspelt name', async () => {
    await grantStepUp(officerToken, OFFICER, 'taxpayer.identity.change');
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      { lastName: 'Danjuma', reason: 'Surname was misspelt at registration.' },
      { token: officerToken },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.changed, ['lastName']);
    assert.equal((await record())!.last_name, 'Danjuma');
  });

  it('refuses an agent, by permission rather than by a check inside the handler', async () => {
    // Agents keep `taxpayer:update` for the records they maintain in the
    // field. `taxpayer:correct` is a separate permission they do not hold, so
    // the refusal happens at the door — an agent correcting the identity of a
    // taxpayer they registered themselves is the whole fraud in one step.
    assert.equal(roleHasPermission('agent', 'taxpayer:update'), true);
    assert.equal(roleHasPermission('agent', 'taxpayer:correct'), false);

    await grantStepUp(agent.token, '+2347010000001', 'taxpayer.identity.change');
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      { lastName: 'Danjuma', reason: 'Correcting the record I captured myself.' },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal((await record())!.last_name, 'Danjjuma', 'nothing should have changed');
  });

  it('will not let a revenue officer change which document the record is held under', async () => {
    await grantStepUp(officerToken, OFFICER, 'taxpayer.identity.change');
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      {
        identityType: 'BVN',
        identityNumber: '99988877766',
        reason: 'Trying to move the record onto a different document.',
      },
      { token: officerToken },
    );
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.match(response.body.error.message, /administrator/i);
  });

  it('lets an administrator change the document, and re-hashes it', async () => {
    const before = await record();
    await grantStepUp(adminToken, ADMIN, 'taxpayer.identity.change');
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      {
        identityType: 'BVN',
        identityNumber: '99988877766',
        reason: 'Replacement document produced at the office.',
      },
      { token: adminToken },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const after = await record();
    assert.notEqual(after!.identity_hash, before!.identity_hash);
    assert.equal(after!.identity_hash, hashIdentityNumber('99988877766'));
    assert.match(after!.identity_masked!, /7766$/);
  });

  it('will not move a record onto an identity another taxpayer already holds', async () => {
    const other = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Grace',
        lastName: 'Bitrus',
        phone: '+2348037000222',
        address: '9 Bukuru Road, Jos',
        lgaId,
        identityType: 'NIN',
        identityNumber: '55566677788',
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'identity-2' },
    );
    assert.equal(other.status, 201, JSON.stringify(other.body));

    await grantStepUp(adminToken, ADMIN, 'taxpayer.identity.change');
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      {
        identityType: 'NIN',
        identityNumber: '55566677788',
        reason: 'Attempting to collide with an identity already registered.',
      },
      { token: adminToken },
    );
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'IDENTITY_ALREADY_REGISTERED');
  });

  it('refuses a correction that would change nothing', async () => {
    await grantStepUp(officerToken, OFFICER, 'taxpayer.identity.change');
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      { lastName: 'Danjjuma', reason: 'Submitting the value already on the record.' },
      { token: officerToken },
    );
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(JSON.stringify(response.body), /would change/i);
  });

  it('refuses a date of birth nobody could hold, the same as registration does', async () => {
    await grantStepUp(officerToken, OFFICER, 'taxpayer.identity.change');
    const response = await post(
      `/taxpayers/${taxpayerId}/identity`,
      { dateOfBirth: '2099-01-01', reason: 'A birth date in the future.' },
      { token: officerToken },
    );
    assert.equal(response.status, 422);
    assert.match(JSON.stringify(response.body), /future/i);
  });

  it('records the change without putting the identity number in the audit log', async () => {
    await grantStepUp(adminToken, ADMIN, 'taxpayer.identity.change');
    await post(
      `/taxpayers/${taxpayerId}/identity`,
      {
        identityType: 'BVN',
        identityNumber: '99988877766',
        reason: 'Replacement document produced at the office.',
      },
      { token: adminToken },
    );
    const entry = await queryOne<{ reason: string; new_value: any; old_value: any }>(
      pool,
      `SELECT reason, new_value, old_value FROM audit_logs
        WHERE action = 'taxpayer.identity_changed' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(entry, 'the correction should be on the audit trail');
    assert.match(entry!.reason, /Replacement document/);
    const serialised = JSON.stringify(entry);
    assert.ok(!serialised.includes('99988877766'), `identity number leaked: ${serialised}`);
    assert.match(serialised, /7766/, 'the masked form is kept as evidence of what changed');
  });
});

// -------------------------------------------------------------------- roles

describe('changing what an officer may do', () => {
  it('is refused without a step-up code', async () => {
    const response = await post(
      `/government/users/${otherAdmin.id}/role`,
      { role: 'auditor', reason: 'Moving them to the audit office.' },
      { token: adminToken },
    );
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'STEP_UP_REQUIRED');
  });

  it('is refused for anybody without user:manage', async () => {
    await grantStepUp(officerToken, OFFICER, 'user.role.change');
    const response = await post(
      `/government/users/${otherAdmin.id}/role`,
      { role: 'admin', reason: 'A revenue officer promoting somebody.' },
      { token: officerToken },
    );
    assert.equal(response.status, 403);
  });

  it('will not let an administrator change their own role', async () => {
    const me = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [ADMIN]);
    await grantStepUp(adminToken, ADMIN, 'user.role.change');
    const response = await post(
      `/government/users/${me!.id}/role`,
      { role: 'admin', reason: 'Attempting to change my own access.' },
      { token: adminToken },
    );
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.match(response.body.error.message, /your own role/i);
  });

  it('changes the role and ends every session the user had', async () => {
    // The demoted administrator is signed in right now, which is the state
    // that makes revocation matter.
    const before = await get('/government/users', { token: otherAdmin.token });
    assert.equal(before.status, 200, 'they can reach an admin-only endpoint beforehand');

    await grantStepUp(adminToken, ADMIN, 'user.role.change');
    const response = await post(
      `/government/users/${otherAdmin.id}/role`,
      { role: 'auditor', reason: 'Moved to the audit office this month.' },
      { token: adminToken },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.previousRole, 'admin');
    assert.equal(response.body.newRole, 'auditor');
    assert.ok(response.body.sessionsEnded >= 1, 'their open session should have been ended');

    // The token carried the old role. If revocation did not happen, this still works.
    const after = await get('/government/users', { token: otherAdmin.token });
    assert.notEqual(after.status, 200, 'the old token must not still hold administrator access');
  });

  it('refuses a role the user already has', async () => {
    await grantStepUp(adminToken, ADMIN, 'user.role.change');
    const response = await post(
      `/government/users/${otherAdmin.id}/role`,
      { role: 'admin', reason: 'Setting the role they already hold.' },
      { token: adminToken },
    );
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(JSON.stringify(response.body), /already has/i);
  });

  it('will not move anybody in or out of the agent role', async () => {
    await grantStepUp(adminToken, ADMIN, 'user.role.change');
    const response = await post(
      `/government/users/${otherAdmin.id}/role`,
      { role: 'agent', reason: 'Trying to bypass the clearance pipeline.' },
      { token: adminToken },
    );
    // Refused by the request schema before it reaches the service.
    assert.ok([403, 422].includes(response.status), JSON.stringify(response.body));
  });

  it('lists the officers whose access can be changed, and marks the caller', async () => {
    const response = await get('/government/users', { token: adminToken });
    assert.equal(response.status, 200);
    const roles = response.body.users.map((u: any) => u.role);
    assert.ok(!roles.includes('agent'), 'agents are governed by clearance, not by role changes');
    const self = response.body.users.find((u: any) => u.phone === ADMIN);
    assert.equal(self.isSelf, true, 'the caller is marked so a screen can grey their own row');
  });
});
