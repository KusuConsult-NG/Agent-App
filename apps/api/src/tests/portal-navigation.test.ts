/**
 * The portal's navigation must not offer a screen the officer cannot load.
 *
 * The sidebar is filtered by permission, and each item names one. That is only
 * as good as the match between the permission on the menu item and the
 * permission on the endpoint the screen actually fetches — and those had
 * drifted apart. "Reconciliation" was gated on `payment:read:all`, which an
 * admin holds, while the settlement dashboard it exists to show requires
 * `report:financial` or `payment:reconcile`, which an admin does not. The menu
 * offered the screen and the screen answered 403.
 *
 * That exclusion is deliberate — settlement figures are a finance and audit
 * responsibility, not an administrative one — so the fix belonged in the menu.
 * This test holds the two sides together: if either the nav gate or the route's
 * permissions change, any role that would be offered a screen it cannot load
 * fails here.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS, ROLES, permissionsForRole } from '@psirs/shared';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PORTAL_APP = join(REPO_ROOT, 'apps', 'portal', 'src', 'App.tsx');
const GOVERNMENT_ROUTES = join(REPO_ROOT, 'apps', 'api', 'src', 'routes', 'government.ts');

interface NavItem {
  path: string;
  label: string;
  permission: string;
}

function navigationItems(): NavItem[] {
  const source = readFileSync(PORTAL_APP, 'utf8');
  const pattern =
    /\{\s*path:\s*'([^']+)',\s*label:\s*'([^']+)',\s*permission:\s*'([^']+)'\s*\}/g;
  return [...source.matchAll(pattern)].map((match) => ({
    path: match[1]!,
    label: match[2]!,
    permission: match[3]!,
  }));
}

/**
 * The permissions guarding one GET route in government.ts.
 *
 * `requirePermission` grants when the role holds *any* of them, so this returns
 * the whole set and the caller checks membership the same way.
 */
function permissionsGuardingGet(path: string): string[] {
  const source = readFileSync(GOVERNMENT_ROUTES, 'utf8');
  const pattern = new RegExp(
    `governmentRouter\\.get\\(\\s*'${path.replace(/[/\-]/g, '\\$&')}',\\s*requirePermission\\(([^)]*)\\)`,
  );
  const match = source.match(pattern);
  assert.ok(match, `expected a GET ${path} guarded by requirePermission in government.ts`);
  return [...match![1]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!);
}

/**
 * Screens whose content comes from an endpoint guarded differently from the
 * menu item. Only screens with a single dominant fetch belong here: the claim
 * is "reaching this menu item and finding nothing you may read is a bug".
 */
const SCREEN_REQUIREMENTS: { navPath: string; getRoute: string }[] = [
  { navPath: '/reconciliation', getRoute: '/settlements' },
  // Outstanding work reads three queues behind three different permissions and
  // renders only the sections the officer may read. What the menu gate has to
  // guarantee is the one section everybody is shown: the refunds a taxpayer is
  // still owed.
  { navPath: '/outstanding', getRoute: '/refunds/outstanding' },
];

describe('Portal navigation matches what the API will allow', () => {
  it('finds the navigation at all, so a passing run means something', () => {
    const items = navigationItems();
    assert.ok(items.length >= 10, `expected the portal's menu, found ${items.length}`);
    assert.ok(items.some((item) => item.path === '/reconciliation'));
  });

  it('names only permissions that exist', () => {
    // A permission that has been renamed or removed silently hides the menu
    // item from everyone, because no role holds a string that is not a
    // permission — a failure that looks like an empty sidebar, not an error.
    for (const item of navigationItems()) {
      assert.ok(
        (PERMISSIONS as readonly string[]).includes(item.permission),
        `"${item.label}" is gated on "${item.permission}", which is not a permission`,
      );
    }
  });

  it('offers no screen to a role that the API would refuse', () => {
    const items = navigationItems();

    for (const { navPath, getRoute } of SCREEN_REQUIREMENTS) {
      const item = items.find((entry) => entry.path === navPath);
      assert.ok(item, `no navigation item for ${navPath}`);

      const accepted = permissionsGuardingGet(getRoute);

      for (const role of ROLES) {
        const held = permissionsForRole(role) as readonly string[];
        const offered = held.includes(item!.permission);
        if (!offered) continue;

        const allowed = accepted.some((permission) => held.includes(permission));
        assert.ok(
          allowed,
          `${role} is offered "${item!.label}" (needs ${item!.permission}) but GET ${getRoute} ` +
            `requires one of ${accepted.join(' or ')} — the menu would open onto a 403`,
        );
      }
    }
  });

  it('shows outstanding work to every role that can reach the portal', () => {
    // The refund queue is money a citizen has not had back. It was invisible to
    // everyone for as long as it had no screen; it should not now be visible to
    // only the one role that can act on it.
    const item = navigationItems().find((entry) => entry.path === '/outstanding')!;
    // The portal's roles. `agent` is in ROLES but never signs in here.
    for (const role of ['admin', 'revenue_officer', 'finance_officer', 'supervisor', 'auditor'] as const) {
      assert.ok(
        (permissionsForRole(role) as readonly string[]).includes(item.permission),
        `${role} must be able to see what the platform still owes`,
      );
    }
  });

  it('still shows reconciliation to the roles that own it', () => {
    // The guard above is satisfied by a menu nobody can see, so this pins the
    // other half: narrowing the gate must not have hidden it from finance.
    const item = navigationItems().find((entry) => entry.path === '/reconciliation')!;
    for (const role of ['finance_officer', 'auditor'] as const) {
      assert.ok(
        (permissionsForRole(role) as readonly string[]).includes(item.permission),
        `${role} must still be offered reconciliation`,
      );
    }
  });
});
