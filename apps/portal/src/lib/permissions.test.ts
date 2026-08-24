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

  it('gives the supervisor their territory, not the whole state', () => {
    /*
     * This test's name was right and its list was wrong. "Their territory,
     * not the whole state" described the intention; what it actually froze
     * was a menu with no analytics in it at all — no dashboard and no
     * revenue intelligence — because both were gated on report:read:all and
     * a supervisor holds report:read:territory instead.
     *
     * The menu is what `landingPath` reads, so the effect was that the role
     * whose job is a territory signed in to a raw transaction list. Both
     * screens are now offered, and the API narrows what they contain to the
     * territories that officer is assigned.
     */
    expect(menu('supervisor')).toEqual([
      'Home',
      'Collections dashboard',
      'Revenue intelligence',
      'Revenue summary',
      'Transactions',
      'Agent performance',
      'Commissions',
      'Approvals',
      'Fraud & leakage',
      'Support desk',
      'Outstanding work',
      'Revenue catalogue',
    ]);
  });

  it('gives the revenue officer everything except settlement', () => {
    expect(menu('revenue_officer')).toEqual([
      'Home',
      'Collections dashboard',
      'Revenue intelligence',
      'Revenue summary',
      'Transactions',
      'Agents & clearance',
      'Referees',
      'Agent performance',
      'Commissions',
      'Approvals',
      'Fraud & leakage',
      'Support desk',
      'Outstanding work',
      'Audit log',
      'Product usage',
      'Revenue catalogue',
      'Social incentives',
      'Groups & cooperatives',
      'Taxpayer corrections',
    ]);
  });

  it('gives the finance officer settlement, and not the support desk', () => {
    expect(menu('finance_officer')).toEqual([
      'Home',
      'Collections dashboard',
      'Revenue intelligence',
      'Revenue summary',
      'Transactions',
      'Agents & clearance',
      'Referees',
      'Agent performance',
      'Reconciliation',
      'Commissions',
      'Approvals',
      'Fraud & leakage',
      'Outstanding work',
      'Audit log',
      'Product usage',
      'Revenue catalogue',
    ]);
  });

  it('gives the auditor everything to read and no approvals', () => {
    expect(menu('auditor')).toEqual([
      'Home',
      'Collections dashboard',
      'Revenue intelligence',
      'Revenue summary',
      'Transactions',
      'Agents & clearance',
      'Referees',
      'Agent performance',
      'Reconciliation',
      'Commissions',
      'Fraud & leakage',
      'Support desk',
      'Outstanding work',
      'Audit log',
      'Product usage',
      'Revenue catalogue',
      'Social incentives',
    ]);
  });

  it('gives the admin administration, and neither settlement nor approvals', () => {
    // Segregation of duties, and it is meant to look like this: an
    // administrator manages accounts, devices and configuration. They do not
    // sign off money. `report:financial` and `approval:review` are both absent
    // from the role for that reason.
    expect(menu('admin')).toEqual([
      'Home',
      'Collections dashboard',
      'Revenue intelligence',
      'Revenue summary',
      'Transactions',
      'Agents & clearance',
      'Referees',
      'Agent performance',
      'Commissions',
      'Fraud & leakage',
      'Support desk',
      'Outstanding work',
      'Audit log',
      'Product usage',
      'Revenue catalogue',
      'Social incentives',
      'Groups & cooperatives',
      'Taxpayer corrections',
      'Officer access',
    ]);
  });

  /**
   * Nobody signs in onto a permission error.
   *
   * A supervisor used to, because '/' renders the executive dashboard and they
   * do not hold `report:read:all` — their first impression of the portal was
   * "Your role (supervisor) is not permitted to perform this action", on a
   * screen the menu had already decided not to offer them.
   */
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
    const READ_ONLY_PERMISSIONS = PERMISSIONS.filter(
      (permission) => !(MUTATING_PERMISSIONS as readonly string[]).includes(permission),
    );
    const unclassified = PERMISSIONS.filter(
      (permission) =>
        !(MUTATING_PERMISSIONS as readonly string[]).includes(permission) &&
        !READ_ONLY_PERMISSIONS.includes(permission),
    );
    expect(unclassified).toEqual([]);

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
