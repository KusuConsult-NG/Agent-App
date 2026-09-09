/**
 * The delegation of authority, moved out of code and into the database.
 *
 * Changing who may approve a refund was a code change and a deployment. The
 * permissions themselves were fine — granular, and every route names one — but
 * the *map* lived in a source file, so PSIRS could not answer a change in their
 * own delegation of authority without an engineer and a release.
 *
 * THE FIRST TEST IS THE IMPORTANT ONE
 *
 * The migration must be a no-op in behaviour: every role comes out holding
 * precisely what it held before. A permission silently gained in the move is a
 * privilege escalation and one silently lost is an outage, and both would be
 * invisible — nobody reads a hundred and eighty INSERT rows against a
 * TypeScript object literal by eye. So the test does it, in both directions.
 *
 * The rest is about what the new capability must not become: a grant naming a
 * permission nothing checks, a system role somebody deletes, a revocation an
 * officer keeps exercising for half a minute because of a cache.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, permissionsForRole } from '@psirs/shared';
import {
  createGovernmentUser,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import * as rbacStore from '../services/rbac-store';

const ADMIN_PHONE = '+2348077000001';
const FINANCE_PHONE = '+2348077000002';
let adminToken = '';
let financeToken = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  /*
   * The map is reference data, and the reset empties it.
   *
   * `seedRoles` restores the compiled map to any role that has none — which
   * after a truncate is all of them — so each test starts from the shipped
   * delegation rather than from whatever the previous test granted.
   */
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Rbac Admin', phone: ADMIN_PHONE, role: 'admin' });
  await createGovernmentUser({
    fullName: 'Rbac Finance',
    phone: FINANCE_PHONE,
    role: 'finance_officer',
  });
  adminToken = (await loginAs(ADMIN_PHONE)).accessToken;
  financeToken = (await loginAs(FINANCE_PHONE)).accessToken;
  rbacStore.forget();
});

const admin = () => ({ token: adminToken });
const finance = () => ({ token: financeToken });

// ===========================================================================
describe('the map that moved', () => {
  /*
   * Both directions, by name.
   *
   * "The database holds everything the code held" and "the code holds
   * everything the database holds" are different claims, and a migration can
   * fail either one. The failure message names the role and the permission,
   * because a diff of two hundred strings is not a fault report.
   */
  it('grants each role exactly what the compiled map granted it', async () => {
    for (const role of ROLES) {
      const compiled = [...(ROLE_PERMISSIONS[role] as readonly string[])].sort();
      const stored = (
        await query<{ permission: string }>(
          pool,
          'SELECT permission FROM role_permissions WHERE role = $1 ORDER BY permission',
          [role],
        )
      ).map((row) => row.permission);

      const gained = stored.filter((permission) => !compiled.includes(permission));
      const lost = compiled.filter((permission) => !stored.includes(permission));

      assert.deepEqual(
        gained,
        [],
        `${role} gained permission(s) in the move to the database: ${gained.join(', ')}`,
      );
      assert.deepEqual(
        lost,
        [],
        `${role} lost permission(s) in the move to the database: ${lost.join(', ')}`,
      );
    }
  });

  it('serves the same list the compiled map would have, through the store', async () => {
    for (const role of ROLES) {
      const fromStore = [...(await rbacStore.permissionsFor(role))].sort();
      const compiled = [...(permissionsForRole(role) as readonly string[])].sort();
      assert.deepEqual(fromStore, compiled, `${role} resolves differently through the store`);
    }
  });

  it('knows which roles belong in the officer portal', async () => {
    const portal = [...(await rbacStore.portalRoles())].sort();
    assert.deepEqual(portal, [
      'admin',
      'auditor',
      'finance_officer',
      'revenue_officer',
      'supervisor',
    ]);
  });
});

// ===========================================================================
describe('changing it', () => {
  it('grants a permission, and the officer holds it on their next sign-in', async () => {
    // A finance officer does not configure the catalogue.
    const before = await post(
      '/revenue/items',
      { name: 'x' },
      finance(),
    );
    assert.equal(before.status, 403);

    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const granted = await post(
      '/government/roles/finance_officer/grant',
      {
        permission: 'catalogue:configure',
        reason: 'The Board delegated rate maintenance to Finance this quarter.',
      },
      admin(),
    );
    assert.equal(granted.status, 204, JSON.stringify(granted.body));

    /*
     * The store is asked directly rather than through a fresh request.
     *
     * `forget()` is called by the grant, so the next read is fresh — but this
     * process and the request handler share the module, and asserting on the
     * store is asserting on the thing every request consults.
     */
    const held = await rbacStore.permissionsFor('finance_officer');
    assert.ok(held.includes('catalogue:configure' as never));
  });

  /*
   * A grant naming a permission nothing checks is worse than no grant.
   *
   * It appears in the administrator's list, it reads like an authority, and no
   * route consults it — so somebody believes an officer can do something they
   * cannot.
   */
  it('refuses a permission this build does not check anywhere', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const invented = await post(
      '/government/roles/finance_officer/grant',
      { permission: 'revenue:invent:anything', reason: 'A plausible-looking name.' },
      admin(),
    );
    assert.equal(invented.status, 400, JSON.stringify(invented.body));
    assert.match(JSON.stringify(invented.body), /not a permission this platform checks/i);
  });

  /*
   * Revoking does not wait for the cache.
   *
   * The map is cached for thirty seconds, and thirty seconds is a long time for
   * an officer whose authority has just been withdrawn to keep exercising it.
   * Ending their sessions makes the withdrawal immediate.
   */
  it('signs out everybody holding the role when a permission is taken away', async () => {
    // The finance officer is signed in and working.
    assert.equal((await get('/government/dashboard', finance())).status, 200);

    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const revoked = await post(
      '/government/roles/finance_officer/revoke',
      {
        permission: 'report:financial',
        reason: 'Financial reporting moved to the audit department.',
      },
      admin(),
    );
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.ok(revoked.body.sessionsEnded >= 1, 'the officer was signed out');

    const afterwards = await get('/government/dashboard', finance());
    assert.equal(afterwards.status, 401, 'and their token no longer works');

    /*
     * And on signing in again, the permission is gone.
     *
     * Asked of `/auth/me` rather than of the login response's typed shape,
     * because the portal reads its menu from exactly this call — so this is the
     * surface where a stale grant would actually show.
     */
    const fresh = await loginAs(FINANCE_PHONE);
    const me = await get('/auth/me', { token: fresh.accessToken });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.ok(
      !(me.body.permissions as string[]).includes('report:financial'),
      'the withdrawn permission is not in the new session',
    );
  });

  it('refuses to grant something a role already holds', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const again = await post(
      '/government/roles/finance_officer/grant',
      { permission: 'payment:reconcile', reason: 'They already have this one.' },
      admin(),
    );
    assert.equal(again.status, 409, JSON.stringify(again.body));
  });

  it('is the administrator’s alone', async () => {
    const attempt = await post(
      '/government/roles/finance_officer/grant',
      { permission: 'user:manage', reason: 'Giving myself the keys.' },
      finance(),
    );
    assert.equal(attempt.status, 403);
  });

  it('records every change in the audit log', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    await post(
      '/government/roles/auditor/grant',
      { permission: 'incentive:configure', reason: 'Temporary cover during the programme review.' },
      admin(),
    );
    const entry = await queryOne<{ entity_id: string; reason: string }>(
      pool,
      `SELECT entity_id, reason FROM audit_logs WHERE action = 'rbac.grant'
        ORDER BY sequence_no DESC LIMIT 1`,
    );
    assert.equal(entry!.entity_id, 'auditor');
    assert.match(entry!.reason, /programme review/);
  });
});

// ===========================================================================
describe('roles an administrator can create', () => {
  it('creates one by copying the nearest existing role', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const created = await post(
      '/government/roles',
      {
        name: 'zonal_coordinator',
        label: 'Zonal coordinator',
        isPortal: true,
        copyFrom: 'supervisor',
      },
      admin(),
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(created.body.permissions > 10, 'it started from the supervisor’s grants');

    const listed = await get('/government/roles', admin());
    const role = (listed.body.roles as { name: string; is_system: boolean }[]).find(
      (row) => row.name === 'zonal_coordinator',
    );
    assert.ok(role);
    assert.equal(role!.is_system, false);

    // And an officer can hold it, which the old CHECK constraint refused.
    const officer = await createGovernmentUser({
      fullName: 'Zonal Person',
      phone: '+2348077009999',
      role: 'zonal_coordinator',
    });
    assert.ok(officer);
  });

  /*
   * Deleting `auditor` would not be a configuration change, it would be a
   * broken deployment: the name is referenced in the portal's menus, in the
   * roles that may sign in there, and in every test that enumerates them.
   */
  it('will not let a role the platform ships with be deleted or renamed', async () => {
    await assert.rejects(
      () => query(pool, `DELETE FROM roles WHERE name = 'auditor'`),
      /ships with the platform/,
    );
    await assert.rejects(
      () => query(pool, `UPDATE roles SET name = 'examiner' WHERE name = 'auditor'`),
      /cannot be renamed/,
    );
  });

  it('will not retire a role somebody still holds', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    await post(
      '/government/roles',
      { name: 'zonal_coordinator', label: 'Zonal coordinator', isPortal: true },
      admin(),
    );
    await createGovernmentUser({
      fullName: 'Zonal Person',
      phone: '+2348077009998',
      role: 'zonal_coordinator',
    });

    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const retired = await post(
      '/government/roles/zonal_coordinator/retire',
      { reason: 'The zone structure was abandoned.' },
      admin(),
    );
    assert.equal(retired.status, 409, JSON.stringify(retired.body));
    assert.match(JSON.stringify(retired.body), /still hold/i);
  });

  /*
   * The state the whole retirement mechanism exists to produce, and the two
   * things that have to be true of it.
   *
   * Retirement used to be a status nothing read: migration 059 wrote it and
   * the foreign key on `users.role` asked only whether the name existed, so an
   * administrator could retire a role, move its holders away as instructed,
   * and have a colleague post a new account straight back into it — carrying
   * whatever grants the role held when it was closed. Migration 060 refuses
   * the assignment on the row, which is the only place it holds for a caller
   * at a psql prompt.
   */
  it('retires a role nobody holds, and then refuses to put anybody in it', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    await post(
      '/government/roles',
      { name: 'zonal_coordinator', label: 'Zonal coordinator', isPortal: true },
      admin(),
    );

    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const retired = await post(
      '/government/roles/zonal_coordinator/retire',
      { reason: 'The zone structure was abandoned in the 2026 reorganisation.' },
      admin(),
    );
    assert.equal(retired.status, 204, JSON.stringify(retired.body));

    const row = await queryOne<{ status: string }>(
      pool,
      `SELECT status FROM roles WHERE name = 'zonal_coordinator'`,
    );
    assert.equal(row!.status, 'RETIRED');

    await assert.rejects(
      () =>
        query(
          pool,
          `INSERT INTO users (full_name, phone, password_hash, role)
           VALUES ('Latecomer', '+2348077009997', 'x', 'zonal_coordinator')`,
        ),
      /has been retired/,
    );

    // Nor by moving somebody who already has an account into it.
    await createGovernmentUser({
      fullName: 'Existing Officer',
      phone: '+2348077009996',
      role: 'supervisor',
    });
    await assert.rejects(
      () =>
        query(
          pool,
          `UPDATE users SET role = 'zonal_coordinator' WHERE phone = '+2348077009996'`,
        ),
      /has been retired/,
    );

    // And the closed role can no longer be given permissions.
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const granted = await post(
      '/government/roles/zonal_coordinator/grant',
      { permission: 'report:read:all', reason: 'Trying to arm a role that was closed.' },
      admin(),
    );
    assert.equal(granted.status, 409, JSON.stringify(granted.body));
  });

  /*
   * A retirement nothing could undo would be a worse failure than the one it
   * guards against: with assignment refused on the row, a mis-click would
   * leave a role no endpoint could reopen and only SQL could rescue.
   */
  it('brings a retired role back, and says so when it was never away', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    await post(
      '/government/roles',
      { name: 'zonal_coordinator', label: 'Zonal coordinator', isPortal: true },
      admin(),
    );
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    await post(
      '/government/roles/zonal_coordinator/retire',
      { reason: 'Retired by mistake during the reorganisation.' },
      admin(),
    );

    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const restored = await post(
      '/government/roles/zonal_coordinator/restore',
      { reason: 'The zone structure was kept after all.' },
      admin(),
    );
    assert.equal(restored.status, 204, JSON.stringify(restored.body));

    // The whole point: officers can be posted into it again.
    const officer = await createGovernmentUser({
      fullName: 'Zonal Person',
      phone: '+2348077009995',
      role: 'zonal_coordinator',
    });
    assert.ok(officer);

    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const again = await post(
      '/government/roles/zonal_coordinator/restore',
      { reason: 'Asking a second time, having already brought it back.' },
      admin(),
    );
    assert.equal(again.status, 409, JSON.stringify(again.body));
  });

  it('refuses a role name that already exists', async () => {
    await grantStepUp(adminToken, ADMIN_PHONE, 'user.role.change');
    const clash = await post(
      '/government/roles',
      { name: 'auditor', label: 'Another auditor', isPortal: true },
      admin(),
    );
    assert.equal(clash.status, 409, JSON.stringify(clash.body));
  });
});

// ===========================================================================
describe('what stays in code', () => {
  /*
   * The catalogue of permissions is not data, and must not become data.
   *
   * A permission is a name route handlers reference. Inventing one in the
   * database creates a string nothing checks, which is worse than not having it
   * because it looks like a control.
   */
  it('offers exactly the permissions the code defines, and no others', async () => {
    const listed = await get('/government/roles', admin());
    assert.deepEqual(
      [...(listed.body.grantable as string[])].sort(),
      [...(PERMISSIONS as readonly string[])].sort(),
    );
  });
});
