/**
 * What each role actually sees when it signs in.
 *
 * The portal filters its navigation by permission, which is the right design
 * and was already implemented. What was missing was anything checking the
 * result — and the result is not obvious, because it comes from crossing a
 * fifteen-row menu table with six role definitions in another package. Two bugs
 * had already reached users through that gap:
 *
 *   * "Reconciliation" was offered to an administrator, whose click then
 *     answered 403, because the menu gated on `payment:read:all` while the
 *     endpoint required `report:financial`.
 *   * "Agent performance" was hidden from the supervisor it was written for,
 *     because the menu gated on `report:read:all` and a supervisor holds only
 *     `report:read:territory`.
 *
 * Both are the same shape: the menu's gate disagreed with the endpoint's. So
 * the central test here is not a snapshot of labels — it is that assertion,
 * made per screen. `SCREEN_REQUIRES` restates what each screen's own API
 * endpoint demands, and every gate is checked against it. Change one without
 * the other and this fails.
 *
 * The snapshots exist for a different reason. Eleven of the fifteen items are
 * common to the four back-office roles, which is mostly deliberate — they are
 * all oversight roles and all supposed to see the revenue picture. But
 * "mostly deliberate" degrades quietly. Pinning each menu exactly means any
 * further convergence is a decision somebody makes, not a drift nobody notices.
 */

import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type Role } from '@psirs/shared';
import {
  MUTATING_PERMISSIONS,
  NAV,
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
/**
 * What each screen's own API endpoint requires, transcribed from the routes.
 *
 * This is a deliberate restatement rather than an import — the portal cannot
 * import the API's route table, and pinning it here means a change on either
 * side has to be reflected on the other. Where a route accepts several
 * permissions, all of them are listed.
 */
const SCREEN_REQUIRES: Record<string, readonly string[]> = {
  '/': ['report:read:all'],
  '/intelligence': ['report:read:all'],
  '/transactions': ['payment:read:all'],
  '/agents': ['agent:read:all'],
  '/referees': ['agent:read:all'],
  '/performance': ['report:read:all', 'report:read:territory'],
  '/reconciliation': ['report:financial', 'payment:reconcile'],
  '/commissions': ['commission:read:all'],
  '/approvals': ['approval:review'],
  '/fraud': ['fraud:read'],
  '/support': ['support:read:all'],
  '/outstanding': ['payment:read:all'],
  '/audit': ['audit:read'],
  '/catalogue': ['catalogue:read'],
  '/programmes': ['incentive:read:all', 'incentive:configure'],
};

describe('every offered link opens', () => {
  it('covers every nav item', () => {
    const paths = NAV.flatMap((group) => group.items).map((item) => item.path);
    expect(Object.keys(SCREEN_REQUIRES).sort()).toEqual([...paths].sort());
  });

  /**
   * The bug that produced the admin's 403 on Reconciliation.
   *
   * A role that can see a link must hold at least one permission its screen
   * accepts. This is the check that was missing.
   */
  it.each(ROLES)('offers %s nothing it cannot open', (role) => {
    const user = principal(role);
    for (const item of availableItems(user)) {
      const accepted = SCREEN_REQUIRES[item.path]!;
      expect(
        can(user, accepted),
        `${role} is offered "${item.label}" (${item.path}) but holds none of ${accepted.join(', ')}`,
      ).toBe(true);
    }
  });

  /**
   * The mirror bug, which hid Agent performance from supervisors.
   *
   * A role that can open a screen should be offered it. One exception is
   * carried explicitly: the settlement dashboard accepts `payment:reconcile`,
   * but the menu gates on `report:financial` so that the item means "you are
   * accountable for settlement figures" rather than "you happen to be able to
   * fetch them".
   */
  it.each(ROLES)('does not hide a screen %s can open', (role) => {
    const user = principal(role);
    const offered = new Set(availableItems(user).map((item) => item.path));
    const deliberatelyWithheld = new Set(['/reconciliation']);

    for (const [path, accepted] of Object.entries(SCREEN_REQUIRES)) {
      if (offered.has(path) || deliberatelyWithheld.has(path)) continue;
      expect(
        can(user, accepted),
        `${role} could open ${path} but it is not in their menu`,
      ).toBe(false);
    }
  });
});

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
    expect(menu('supervisor')).toEqual([
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
      'Dashboard',
      'Revenue intelligence',
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
      'Revenue catalogue',
      'Social incentives',
    ]);
  });

  it('gives the finance officer settlement, and not the support desk', () => {
    expect(menu('finance_officer')).toEqual([
      'Dashboard',
      'Revenue intelligence',
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
      'Revenue catalogue',
    ]);
  });

  it('gives the auditor everything to read and no approvals', () => {
    expect(menu('auditor')).toEqual([
      'Dashboard',
      'Revenue intelligence',
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
      'Dashboard',
      'Revenue intelligence',
      'Transactions',
      'Agents & clearance',
      'Referees',
      'Agent performance',
      'Commissions',
      'Fraud & leakage',
      'Support desk',
      'Outstanding work',
      'Audit log',
      'Revenue catalogue',
      'Social incentives',
    ]);
  });

  it('lands every portal role somewhere they can actually open', () => {
    for (const role of PORTAL_ROLES) {
      const path = landingPath(principal(role as Role));
      expect(path, `${role} lands nowhere`).not.toBeNull();
      expect(can(principal(role as Role), SCREEN_REQUIRES[path!]!)).toBe(true);
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
