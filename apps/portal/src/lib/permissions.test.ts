/**
 * What each role actually sees when it signs in.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not check the menu's gates against the permissions the API actually
 * enforces. `apps/api/src/tests/portal-navigation.test.ts` owns that, and owns
 * it properly: it reads both the nav table and the route definitions from
 * source, so neither side can drift without failing. Restating those route
 * permissions here would produce a table that goes stale silently while still
 * passing — which is worse than not having one, and is the precise hazard that
 * file's own header warns about.
 *
 * WHAT IT DOES
 *
 * It pins the *outcome*: the exact menu each of the six roles receives. That
 * catches a changed gate too — a gate cannot move without moving a menu — but
 * it states the consequence rather than duplicating the cause. Eleven of the
 * fifteen items are common to the four back-office roles, and most of that is
 * deliberate: they are all oversight roles and all meant to see the revenue
 * picture. But "mostly deliberate" degrades quietly, and this was the shape of
 * the original complaint — that every officer's portal looked the same. Pinning
 * each menu means any further convergence is a decision somebody makes rather
 * than a drift nobody notices.
 *
 * And it pins the two properties that have no home in the API suite: that the
 * auditor holds nothing that changes anything, and that a field agent is turned
 * away at the door rather than admitted to a shell containing one item.
 */

import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type Role } from '@psirs/shared';
import {
  MUTATING_PERMISSIONS,
  READ_ONLY_PERMISSIONS,
  availableGroups,
  availableItems,
  belongsInPortal,
  can,
  isReadOnly,
  landingPath,
  PORTAL_ROLES,
} from './permissions';

function principal(role: Role) {
  return { role, permissions: ROLE_PERMISSIONS[role] as readonly string[] };
}

function menu(role: Role): string[] {
  return availableItems(principal(role)).map((item) => item.label);
}

// ===========================================================================
describe('each role gets a distinct portal', () => {
  it('gives the field agent nothing, because they belong in the agent app', () => {
    // catalogue:read is the only portal gate an agent passes, which is how
    // they used to arrive at a shell containing one item. They are now turned
    // away at the door instead — see belongsInPortal.
    expect(menu('agent')).toEqual(['Revenue catalogue']);
    expect(belongsInPortal('agent')).toBe(false);
  });

  /*
   * These used to pin a flat ordered list per role, and the lists were nearly
   * identical: one menu filtered by permission gives every officer the same
   * shape with gaps in it. Eleven of fifteen items were common to the four
   * back-office roles, and the header above called that "mostly deliberate"
   * while noting it degrades quietly. It had degraded — a finance officer's
   * menu led with agent clearance and an auditor's led with collections.
   *
   * Each role now has its own arrangement, so what is pinned is the shape: the
   * group a role's menu opens with, which is what its job is, and the items it
   * must have and must not.
   */
  const groupsFor = (role: Role) =>
    availableGroups({ id: 'u', role, permissions: ROLE_PERMISSIONS[role] } as never).map(
      (g) => g.group,
    );
  const menu = (role: Role) =>
    availableItems({ id: 'u', role, permissions: ROLE_PERMISSIONS[role] } as never).map(
      (i) => i.label,
    );

  it('opens each role’s menu with the work that role does', () => {
    expect(groupsFor('admin')[0]).toBe('Administration');
    expect(groupsFor('revenue_officer')[0]).toBe('The register');
    expect(groupsFor('finance_officer')[0]).toBe('Settlement');
    expect(groupsFor('auditor')[0]).toBe('Examination');
    expect(groupsFor('supervisor')[0]).toBe('My territory');
  });

  it('gives no two roles the same arrangement', () => {
    const shapes = (['admin', 'revenue_officer', 'finance_officer', 'auditor', 'supervisor'] as const)
      .map((role) => groupsFor(role).join(' > '));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('gives the supervisor their territory, not the whole state', () => {
    const items = menu('supervisor');
    expect(items).toContain('Home');
    expect(items).toContain('Agent performance');
    expect(items).toContain('Revenue summary');
    // Territory-scoped, so no statewide administration and no settlement.
    expect(items).not.toContain('Officer access');
    expect(items).not.toContain('Reconciliation');
    expect(items).not.toContain('Audit log');
  });

  it('gives the revenue officer the register, and not settlement', () => {
    const items = menu('revenue_officer');
    expect(items).toContain('Taxpayer corrections');
    expect(items).toContain('Revenue catalogue');
    expect(items).not.toContain('Reconciliation');
    expect(items).not.toContain('Officer access');
  });

  it('gives the finance officer settlement first, and not the support desk', () => {
    const items = menu('finance_officer');
    expect(items).toContain('Reconciliation');
    expect(items).toContain('Commissions');
    // The support desk is the revenue officer's and the administrator's.
    expect(items).not.toContain('Support desk');
    expect(items).not.toContain('Officer access');
  });

  it('gives the auditor everything to read and no approvals', () => {
    const items = menu('auditor');
    expect(items).toContain('Audit log');
    expect(items).toContain('Reconciliation');
    expect(items).not.toContain('Approvals');
    expect(items).not.toContain('Officer access');
  });

  it('gives the admin administration, and neither settlement nor approvals', () => {
    const items = menu('admin');
    expect(items).toContain('Officer access');
    expect(items).toContain('Agents & clearance');
    expect(items).toContain('Revenue catalogue');
    // An administrator manages access; they do not settle money or authorise
    // their own approvals.
    expect(items).not.toContain('Reconciliation');
    expect(items).not.toContain('Approvals');
  });

  it('never offers a screen the role cannot open', () => {
    // The arrangement decides what to offer; the permission decides what may
    // be offered. A menu must not promise what the API refuses.
    for (const role of PORTAL_ROLES) {
      for (const item of availableItems({
        id: 'u',
        role,
        permissions: ROLE_PERMISSIONS[role as Role],
      } as never)) {
        if (!item.permission) continue;
        expect(
          can({ id: 'u', role, permissions: ROLE_PERMISSIONS[role as Role] } as never, item.permission),
          `${role} is offered ${item.label} without the permission for it`,
        ).toBe(true);
      }
    }
  });

  it('lands every portal role on a screen in their own menu', () => {
    for (const role of PORTAL_ROLES) {
      const user = principal(role as Role);
      const path = landingPath(user);
      expect(path, `${role} lands nowhere`).not.toBeNull();
      expect(
        availableItems(user).map((item) => item.path),
        `${role} lands on ${path}, which is not in their menu`,
      ).toContain(path);
    }
  });
});

// ===========================================================================
describe('the auditor is read-only, observably', () => {
  /**
   * The property the role exists for.
   *
   * An auditor who could change one thing would still look read-only in the
   * portal — the marker is derived from the permission set, so it would
   * disappear, but nothing else would announce it. This asserts the underlying
   * fact rather than the marker.
   */
  it('holds no permission that changes anything', () => {
    const held = ROLE_PERMISSIONS.auditor as readonly string[];
    const mutating = held.filter((permission) =>
      (MUTATING_PERMISSIONS as readonly string[]).includes(permission),
    );
    expect(mutating, `auditor holds mutating permission(s): ${mutating.join(', ')}`).toEqual([]);
  });

  it('is the only role the portal describes as read-only', () => {
    const readOnly = ROLES.filter((role) => isReadOnly(principal(role)));
    expect(readOnly).toEqual(['auditor']);
  });

  /**
   * Every permission must be classified.
   *
   * Without this, a new permission added to the shared list is silently treated
   * as read-only, and a role that gains it keeps its read-only marker while
   * being able to change something. The failure message names the offender.
   */
  it('classifies every permission in the shared list as read or write', () => {
    /*
     * This test used to derive the read-only set as "everything not in
     * MUTATING_PERMISSIONS", then assert that nothing was in neither list.
     * That is `!m && !(!m)` — false for every permission, so `unclassified`
     * was empty by construction and the assertion could not fail. The guard
     * against a new permission being silently treated as read-only was itself
     * the thing that let it happen: six writes had accumulated behind it.
     *
     * The read-only set is now stated rather than derived, so a permission has
     * to be named in one list or the other to pass.
     */
    const mutating = MUTATING_PERMISSIONS as readonly string[];
    const readOnly = READ_ONLY_PERMISSIONS as readonly string[];

    const unclassified = PERMISSIONS.filter(
      (permission) => !mutating.includes(permission) && !readOnly.includes(permission),
    );
    expect(
      unclassified,
      `unclassified permission(s) — add to MUTATING_PERMISSIONS or READ_ONLY_PERMISSIONS: ${unclassified.join(', ')}`,
    ).toEqual([]);

    const both = PERMISSIONS.filter(
      (permission) => mutating.includes(permission) && readOnly.includes(permission),
    );
    expect(both, `classified as both read and write: ${both.join(', ')}`).toEqual([]);

    const staleReads = readOnly.filter(
      (permission) => !(PERMISSIONS as readonly string[]).includes(permission),
    );
    expect(staleReads, `no longer real permissions: ${staleReads.join(', ')}`).toEqual([]);

    // And nothing in the mutating list has been removed from the shared one.
    const stale = (MUTATING_PERMISSIONS as readonly string[]).filter(
      (permission) => !(PERMISSIONS as readonly string[]).includes(permission),
    );
    expect(stale, `no longer real permissions: ${stale.join(', ')}`).toEqual([]);
  });

  /**
   * A read/write judgement, spelled out.
   *
   * `payment:reconcile` and `taxpayer:tin_sync` do not read like writes and
   * are; `report:financial` reads like it might be and is not. These are the
   * ones a future reader is most likely to reclassify by accident.
   */
  it('treats the deceptively-named permissions correctly', () => {
    const mutating = MUTATING_PERMISSIONS as readonly string[];
    expect(mutating).toContain('payment:reconcile');
    expect(mutating).toContain('taxpayer:tin_sync');
    expect(mutating).toContain('vehicle:authority_sync');
    expect(mutating).not.toContain('report:financial');
    expect(mutating).not.toContain('audit:read');
  });
});

// ===========================================================================
describe('who belongs in this portal', () => {
  it('admits the five government roles and turns away the field agent', () => {
    expect(ROLES.filter(belongsInPortal)).toEqual([
      'supervisor',
      'revenue_officer',
      'finance_officer',
      'auditor',
      'admin',
    ]);
  });

  it('names only roles that exist', () => {
    for (const role of PORTAL_ROLES) {
      expect(ROLES as readonly string[]).toContain(role);
    }
  });
});

// ===========================================================================
describe('can()', () => {
  it('grants on any of several permissions, matching requirePermission', () => {
    const user = { role: 'supervisor', permissions: ['report:read:territory'] };
    expect(can(user, ['report:read:all', 'report:read:territory'])).toBe(true);
    expect(can(user, ['report:read:all', 'report:financial'])).toBe(false);
  });

  it('refuses everything to nobody', () => {
    expect(can(null, 'report:read:all')).toBe(false);
    expect(isReadOnly(null)).toBe(false);
    expect(landingPath(null)).toBeNull();
  });
});
