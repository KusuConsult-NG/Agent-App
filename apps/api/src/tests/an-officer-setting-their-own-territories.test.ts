/**
 * An officer changing which territories they cover.
 *
 * A supervisor's reports are scoped to the territories they cover. Changing a
 * role and changing an account's status already refuse the person they are
 * about. Territories, the third lever on what an officer can see, did not.
 *
 * By default only administrators hold `user:manage`, and they already see the
 * whole State. But who holds what is PSIRS's configuration, and the roles
 * screen will grant `user:manage` to supervisors. Measured with that grant in
 * place: a supervisor covering one territory assigned themselves three (200),
 * and their reports widened with them.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query } from '../db/pool';
import { seedReferenceData } from '../db/seed';

const ADMIN = '+2348000000462';
const SUPERVISOR = '+2348000000463';
const COLLEAGUE = '+2348000000464';

let adminToken = '';
let supervisorToken = '';
let supervisorId = '';
let colleagueId = '';
let territories: string[] = [];

/*
 * Set up once rather than per test: the grant below is cached for thirty
 * seconds, and a reset between tests would leave the cache and the table
 * disagreeing about whether supervisors hold `user:manage`.
 */
before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({ fullName: 'Records Admin', phone: ADMIN, role: 'admin' });
  supervisorId = await createGovernmentUser({
    fullName: 'Territory Supervisor',
    phone: SUPERVISOR,
    role: 'supervisor',
  });
  colleagueId = await createGovernmentUser({
    fullName: 'Colleague Supervisor',
    phone: COLLEAGUE,
    role: 'supervisor',
  });
  adminToken = (await loginAs(ADMIN)).accessToken;

  territories = (
    await query<{ id: string }>(
      pool,
      `SELECT id FROM territories WHERE status = 'ACTIVE' ORDER BY code LIMIT 3`,
    )
  ).map((row) => row.id);
  assert.equal(territories.length, 3);

  const posted = await post(
    `/government/users/${supervisorId}/territories`,
    { territoryIds: [territories[0]], reason: 'Posted to the first territory.' },
    { token: adminToken },
  );
  assert.equal(posted.status, 200, JSON.stringify(posted.body));

  // The configuration under which the lever exists: supervisors manage users.
  await grantStepUp(adminToken, ADMIN, 'user.role.change');
  const granted = await post(
    '/government/roles/supervisor/grant',
    { permission: 'user:manage', reason: 'Supervisors manage their own teams.' },
    { token: adminToken },
  );
  assert.equal(granted.status, 204, JSON.stringify(granted.body));
  supervisorToken = (await loginAs(SUPERVISOR)).accessToken;
});

after(async () => {
  await stopTestServer();
});

const covered = async (userId: string) =>
  (
    await query<{ territory_id: string }>(
      pool,
      'SELECT territory_id FROM user_territories WHERE user_id = $1 ORDER BY territory_id',
      [userId],
    )
  ).map((row) => row.territory_id);

const setTerritories = (userId: string, territoryIds: string[], token: string) =>
  post(
    `/government/users/${userId}/territories`,
    { territoryIds, reason: 'Covering for colleagues this month.' },
    { token },
  );

describe('an officer and the territories they cover', () => {
  it('cannot widen their own coverage', async () => {
    const res = await setTerritories(supervisorId, territories, supervisorToken);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error.message, /territories you cover/);
    assert.deepEqual(await covered(supervisorId), [territories[0]]);
  });

  it('cannot narrow it either: the change is somebody else to make', async () => {
    const res = await setTerritories(supervisorId, [], supervisorToken);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.deepEqual(await covered(supervisorId), [territories[0]]);
  });

  it("can still set a colleague's, with the permission they were given", async () => {
    const res = await setTerritories(colleagueId, [territories[1]!], supervisorToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await covered(colleagueId), [territories[1]]);
  });

  it('is changed by an administrator as before', async () => {
    const res = await setTerritories(supervisorId, territories.slice(0, 2), adminToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await covered(supervisorId), [...territories.slice(0, 2)].sort());
  });
});
