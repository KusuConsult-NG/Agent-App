/**
 * The role editor, used on the role that holds it.
 *
 * `changeUserRole` refuses an officer changing their own role, because an
 * account with `user:manage` that could promote itself needs no other weakness
 * to become anything it likes. The role editor was the same attack by a
 * different door. Measured through the route: an administrator granted the
 * admin role payment:reverse:approve, approval:authorise,
 * commission:payout:approve and period:close — four 204s — and held every
 * power the separation of duties keeps away from the role that manages users.
 *
 * The export limit was the same door again: an administrator raised the admin
 * role's from 50,000 rows to 1,000,000, and the next export would have
 * carried that much of the register.
 *
 * And the opposite mistake: revoking `user:manage` from the only role that
 * held it succeeded, after which nobody could open the roles screen, change a
 * role or create an officer. Measured: 200, no holder left, and 403 on the
 * roles screen for the administrator who did it.
 */

import './env';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
import { query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import * as rbacStore from '../services/rbac-store';

const ADMIN = '+2348077600001';
const ICT = '+2348077600002';
let adminId = '';
let token = '';

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
  adminId = await createGovernmentUser({ fullName: 'Role Admin', phone: ADMIN, role: 'admin' });
  token = (await loginAs(ADMIN)).accessToken;
});

async function asAdmin(path: string, body: Record<string, unknown>) {
  await grantStepUp(token, ADMIN, 'user.role.change');
  return post(path, body, { token });
}

async function adminHolds(permission: string): Promise<boolean> {
  rbacStore.forget();
  return (await rbacStore.permissionsFor('admin')).includes(permission as never);
}

/** A second role that also manages users, with somebody in it. */
async function ictRole(): Promise<string> {
  const admin = { userId: adminId, role: 'admin' };
  await rbacStore.createRole(admin, { name: 'ict_manager', label: 'ICT Manager', isPortal: true });
  await rbacStore.grant(admin, {
    role: 'ict_manager',
    permission: 'user:manage',
    reason: 'ICT administers accounts alongside the Director of Administration.',
  });
  await createGovernmentUser({ fullName: 'ICT Manager', phone: ICT, role: 'ict_manager' });
  rbacStore.forget();
  return (await loginAs(ICT)).accessToken;
}

const MONEY_POWERS = [
  'payment:reverse:approve',
  'approval:authorise',
  'commission:payout:approve',
  'period:close',
];

describe('an administrator adding to their own role', () => {
  for (const permission of MONEY_POWERS) {
    it(`is refused ${permission}, and does not come to hold it`, async () => {
      assert.equal(await adminHolds(permission), false, 'the fixture already grants it');
      const response = await asAdmin('/government/roles/admin/grant', {
        permission,
        reason: 'Widening my own role to approve what I request.',
      });
      assert.equal(response.status, 403, JSON.stringify(response.body));
      assert.match(response.body.error.message, /your own role/i);
      assert.equal(await adminHolds(permission), false);
    });
  }

  it('can still grant another role', async () => {
    const response = await asAdmin('/government/roles/finance_officer/grant', {
      permission: 'catalogue:configure',
      reason: 'The Board delegated rate maintenance to Finance this quarter.',
    });
    assert.equal(response.status, 204, JSON.stringify(response.body));
  });

  it('can be done by somebody in a different role that also manages users', async () => {
    const ictToken = await ictRole();
    await grantStepUp(ictToken, ICT, 'user.role.change');
    const response = await post(
      '/government/roles/admin/grant',
      { permission: 'period:close', reason: 'The Director of Administration closes the month this year.' },
      { token: ictToken },
    );
    assert.equal(response.status, 204, JSON.stringify(response.body));
    assert.equal(await adminHolds('period:close'), true);
  });
});

describe('removing user:manage', () => {
  it('is refused from the only role that holds it, and changes nothing', async () => {
    const response = await asAdmin('/government/roles/admin/revoke', {
      permission: 'user:manage',
      reason: 'Tidying the administrator role.',
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'LAST_USER_MANAGER');
    assert.equal(await adminHolds('user:manage'), true);

    const roles = await get('/government/roles', { token: (await loginAs(ADMIN)).accessToken });
    assert.equal(roles.status, 200, 'the administrator can still manage roles');
  });

  it('is allowed once another role with somebody in it holds user:manage', async () => {
    await ictRole();
    const response = await asAdmin('/government/roles/admin/revoke', {
      permission: 'user:manage',
      reason: 'ICT administers accounts from now on.',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await adminHolds('user:manage'), false);
  });

  it('does not count a role nobody holds, which manages nothing', async () => {
    const admin = { userId: adminId, role: 'admin' };
    await rbacStore.createRole(admin, { name: 'empty_manager', label: 'Empty Manager', isPortal: true });
    await rbacStore.grant(admin, {
      role: 'empty_manager',
      permission: 'user:manage',
      reason: 'A role made ready for an appointment not yet made.',
    });

    const response = await asAdmin('/government/roles/admin/revoke', {
      permission: 'user:manage',
      reason: 'Handing over to a role with nobody in it.',
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'LAST_USER_MANAGER');
  });

  /*
   * A retired role cannot be assigned to anybody, so whoever is left in one
   * is there from before it was retired, and it is not a route anybody can
   * be given. Written directly, because retiring a role somebody holds is
   * itself refused.
   */
  it('does not count a retired role', async () => {
    await ictRole();
    await pool.query(`UPDATE roles SET status = 'RETIRED' WHERE name = 'ict_manager'`);

    const response = await asAdmin('/government/roles/admin/revoke', {
      permission: 'user:manage',
      reason: 'Handing over to a retired role.',
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'LAST_USER_MANAGER');
  });

  it('leaves an administrator free to remove other permissions from their own role', async () => {
    const response = await asAdmin('/government/roles/admin/revoke', {
      permission: 'report:read:all',
      reason: 'Reports move to the Planning unit.',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await adminHolds('report:read:all'), false);
  });
});

describe('an administrator changing their own role’s export limit', () => {
  /*
   * The roles table survives `resetDatabase` — the platform's own roles cannot
   * be truncated — so a limit changed here would still be changed for every
   * file after this one in the same database. Each test puts back what it
   * found, and works from the limit it found rather than a fixed figure.
   */
  let found: { name: string; export_row_limit: number }[] = [];
  beforeEach(async () => {
    found = await query(pool, `SELECT name, export_row_limit FROM roles WHERE is_system`, []);
  });
  afterEach(async () => {
    for (const role of found) {
      await pool.query('UPDATE roles SET export_row_limit = $2 WHERE name = $1', [
        role.name,
        role.export_row_limit,
      ]);
    }
  });

  const limit = async (role: string) => {
    const rows = await query<{ export_row_limit: number }>(
      pool,
      'SELECT export_row_limit FROM roles WHERE name = $1',
      [role],
    );
    return rows[0]!.export_row_limit;
  };

  it('is refused a raise, and the limit stays where it was', async () => {
    const before = await limit('admin');
    const response = await asAdmin('/government/roles/admin/export-limit', {
      limit: before + 100_000,
      reason: 'Raising my own limit to take the whole register.',
    });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.match(response.body.error.message, /your own role/i);
    assert.equal(await limit('admin'), before);
  });

  it('may lower it', async () => {
    const lower = (await limit('admin')) - 1;
    const response = await asAdmin('/government/roles/admin/export-limit', {
      limit: lower,
      reason: 'Administrators export less after the data-protection review.',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await limit('admin'), lower);
  });

  it('may still raise another role’s', async () => {
    const higher = (await limit('finance_officer')) + 10_000;
    const response = await asAdmin('/government/roles/finance_officer/export-limit', {
      limit: higher,
      reason: 'The year-end ledger runs past fifty thousand lines.',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await limit('finance_officer'), higher);
  });

  it('can have it raised by somebody in a different role that also manages users', async () => {
    const ictToken = await ictRole();
    const higher = (await limit('admin')) + 10_000;
    await grantStepUp(ictToken, ICT, 'user.role.change');
    const response = await post(
      '/government/roles/admin/export-limit',
      { limit: higher, reason: 'Administration takes the annual register to the Board.' },
      { token: ictToken },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await limit('admin'), higher);
  });
});

describe('what the database holds afterwards', () => {
  it('records no grant for a refused one', async () => {
    await asAdmin('/government/roles/admin/grant', {
      permission: 'payment:reverse:approve',
      reason: 'Widening my own role to approve what I request.',
    });
    const rows = await query(
      pool,
      `SELECT 1 FROM role_permissions WHERE role = 'admin' AND permission = 'payment:reverse:approve'`,
      [],
    );
    assert.equal(rows.length, 0);
  });
});
