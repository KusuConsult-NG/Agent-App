/**
 * Removing user:manage from the last two roles that hold it, at once.
 *
 * `rbacStore.revoke` refuses to remove user:manage when no active role with
 * somebody in it would still hold it (`a-role-that-widened-itself`). Two
 * revocations from two roles at once each read the other's grant as still
 * standing, both removed theirs, and nobody was left who could manage users.
 * Taking every user:manage row before deciding queues them, so the second
 * sees what the first did.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, pool, resetDatabase, startTestServer, stopTestServer } from '../helpers';
import { query } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import * as rbacStore from '../../services/rbac-store';

let admin = { userId: '', role: 'admin' };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  rbacStore.forget();
  admin = {
    userId: await createGovernmentUser({ fullName: 'Admin', phone: '+2348077700001', role: 'admin' }),
    role: 'admin',
  };
  await rbacStore.createRole(admin, { name: 'ict_manager', label: 'ICT Manager', isPortal: true });
  await createGovernmentUser({ fullName: 'ICT Manager', phone: '+2348077700002', role: 'ict_manager' });
});

describe('the last two roles that manage users, both revoked at once', () => {
  it('leaves one of them holding user:manage', async () => {
    for (let round = 0; round < 8; round += 1) {
      await rbacStore.grant(admin, {
        role: 'ict_manager',
        permission: 'user:manage',
        reason: 'ICT administers accounts alongside the Director.',
      });
      const holders = await query<{ role: string }>(
        pool,
        `SELECT role FROM role_permissions WHERE permission = 'user:manage' ORDER BY role`,
        [],
      );
      assert.deepEqual(holders.map((row) => row.role), ['admin', 'ict_manager']);

      const outcomes = await Promise.allSettled([
        rbacStore.revoke(admin, { role: 'admin', permission: 'user:manage', reason: 'Handing over.' }),
        rbacStore.revoke(admin, { role: 'ict_manager', permission: 'user:manage', reason: 'Handing back.' }),
      ]);
      const refused = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      assert.equal(refused.length, 1, `round ${round}: ${refused.length} refused`);
      assert.equal(refused[0]!.reason.code, 'LAST_USER_MANAGER', String(refused[0]!.reason));

      const left = await query<{ role: string }>(
        pool,
        `SELECT role FROM role_permissions WHERE permission = 'user:manage'`,
        [],
      );
      assert.equal(left.length, 1, `round ${round} left ${left.length} roles managing users`);

      // Put the admin role back for the next round if it was the one removed.
      if (left[0]!.role !== 'admin') {
        await pool.query(
          `INSERT INTO role_permissions (role, permission, granted_by, reason)
           VALUES ('admin', 'user:manage', $1, 'restored between rounds')`,
          [admin.userId],
        );
        await pool.query(
          `DELETE FROM role_permissions WHERE role = 'ict_manager' AND permission = 'user:manage'`,
        );
      }
    }
  });
});
