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
import { translations } from '@psirs/shared';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
/**
 * The menu moved out of `App.tsx` into `lib/permissions.ts` so the portal could
 * test it without a DOM. This path moved with it — and the move is exactly the
 * hazard the parser note below describes: reading a table out of source means a
 * refactor can leave the test reading nothing while still passing. The
 * "finds the navigation at all" case is what turns that into a failure, and it
 * is why this file caught its own breakage rather than going quiet.
 */
const PORTAL_NAV = join(REPO_ROOT, 'apps', 'portal', 'src', 'lib', 'permissions.ts');
const GOVERNMENT_ROUTES = join(REPO_ROOT, 'apps', 'api', 'src', 'routes', 'government.ts');

interface NavItem {
  path: string;
  /**
   * The English label, resolved from the dictionary key the catalogue holds.
   *
   * The portal's menu is translated, so the source carries keys. Reading the
   * key into a failure message would say `ofcNavReconciliation` where a person
   * needs to see "Reconciliation" — and resolving it here also means a key
   * added to the menu and never to the dictionary shows up as `undefined` in
   * the message rather than passing unnoticed.
   */
  label: string;
  /**
   * Every permission that opens the item. A menu item may name several,
   * because `requirePermission` grants on any one of the permissions it lists
   * and the menu has to be able to describe the same thing.
   */
  permissions: string[];
}

/**
 * Read the menu out of the portal's source.
 *
 * Both spellings are parsed. When the array form was introduced this pattern
 * matched only the single-quoted one, so the new item was skipped in silence
 * and every assertion below still passed — a test that had stopped checking
 * one of the things it exists to check, which is worse than one that fails.
 */
function navigationItems(): NavItem[] {
  const source = readFileSync(PORTAL_NAV, 'utf8');
  const pattern =
    /\{\s*path:\s*'([^']+)',\s*label:\s*'([^']+)',\s*permission:\s*(\[[^\]]*\]|'[^']+')\s*,?\s*\}/g;
  const en = translations.en as unknown as Record<string, string>;
  return [...source.matchAll(pattern)].map((match) => ({
    path: match[1]!,
    label: en[match[2]!] ?? match[2]!,
    permissions: [...match[3]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!),
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

    const performance = items.find((item) => item.path === '/performance');
    assert.ok(performance, 'the menu should include agent performance');
    assert.equal(
      performance!.permissions.length,
      2,
      'agent performance names two permissions; if this parser stops seeing both, ' +
        'the checks below silently stop covering it',
    );
  });

  it('names only permissions that exist', () => {
    // A permission that has been renamed or removed silently hides the menu
    // item from everyone, because no role holds a string that is not a
    // permission — a failure that looks like an empty sidebar, not an error.
    for (const item of navigationItems()) {
      assert.ok(item.permissions.length > 0, `"${item.label}" names no permission`);
      for (const permission of item.permissions) {
        assert.ok(
          (PERMISSIONS as readonly string[]).includes(permission),
          `"${item.label}" is gated on "${permission}", which is not a permission`,
        );
      }
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
        const offered = item!.permissions.some((permission) => held.includes(permission));
        if (!offered) continue;

        const allowed = accepted.some((permission) => held.includes(permission));
        assert.ok(
          allowed,
          `${role} is offered "${item!.label}" (needs ${item!.permissions.join(' or ')}) but GET ${getRoute} ` +
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
        item.permissions.some((permission) =>
          (permissionsForRole(role) as readonly string[]).includes(permission),
        ),
        `${role} must be able to see what the platform still owes`,
      );
    }
  });

  it('lands every role on a screen its own menu offers', () => {
    /*
     * '/' renders the executive dashboard, which needs dashboard:executive or
     * report:read:all. A supervisor holds neither, so signing in used to put
     * them on "Your role (supervisor) is not permitted to perform this action"
     * — their first impression of the portal, on a screen the menu had already
     * decided not to offer them.
     *
     * The shell now sends them to the first item they may open. This checks the
     * property that makes that safe: every portal role has at least one.
     */
    const items = navigationItems();
    for (const role of ['admin', 'revenue_officer', 'finance_officer', 'supervisor', 'auditor'] as const) {
      const held = permissionsForRole(role) as readonly string[];
      const offered = items.filter((item) =>
        item.permissions.some((permission) => held.includes(permission)),
      );
      assert.ok(
        offered.length > 0,
        `${role} is offered no screen at all, so there is nowhere to land them`,
      );
    }
  });

  it('still shows reconciliation to the roles that own it', () => {
    // The guard above is satisfied by a menu nobody can see, so this pins the
    // other half: narrowing the gate must not have hidden it from finance.
    const item = navigationItems().find((entry) => entry.path === '/reconciliation')!;
    for (const role of ['finance_officer', 'auditor'] as const) {
      assert.ok(
        item.permissions.some((permission) =>
          (permissionsForRole(role) as readonly string[]).includes(permission),
        ),
        `${role} must still be offered reconciliation`,
      );
    }
  });
});
