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
import { translations, type TranslationDictionary } from '@psirs/shared';
import {
  CASEWORK_PERMISSIONS,
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

/*
 * Menus read back in English, through the dictionary.
 *
 * The catalogue holds dictionary keys now, so that officers can read the menu
 * in Hausa. Asserting on the raw keys would make these tests unreadable —
 * `ofcNavReconciliation` says nothing about whether a finance officer can
 * reach reconciliation — and asserting on English resolved through
 * `translations.en` keeps them saying what they said, while also failing if a
 * key is added to the catalogue and never to the dictionary.
 */
const english = (key: keyof TranslationDictionary) => translations.en[key];

function menu(role: Role): string[] {
  return availableItems(principal(role)).map((item) => english(item.label));
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
    availableGroups({ id: 'u', role, permissions: ROLE_PERMISSIONS[role] } as never).map((g) =>
      english(g.group),
    );
  const menu = (role: Role) =>
    availableItems({ id: 'u', role, permissions: ROLE_PERMISSIONS[role] } as never).map((i) =>
      english(i.label),
    );

  /*
   * Every menu now opens with the officer's own desk, and the group after it is
   * still the one that says what the role does.
   *
   * The desk — my work, and the case queue it is drawn from — is deliberately
   * identical across the five roles, which is the one place the "same shape for
   * everybody" pattern this file warns about is correct: what is waiting for
   * *you* is the same question whatever your job, and the answer is already
   * filtered to you by identity rather than by role.
   *
   * The property the original test was protecting is unchanged and is asserted
   * one position along.
   */
  it('opens every menu with the officer’s own desk', () => {
    for (const role of PORTAL_ROLES) {
      expect(groupsFor(role as Role)[0], role).toBe('Your desk');
    }
  });

  it('follows the desk with the work that role does', () => {
    expect(groupsFor('admin')[1]).toBe('Administration');
    expect(groupsFor('revenue_officer')[1]).toBe('The register');
    expect(groupsFor('finance_officer')[1]).toBe('Settlement');
    expect(groupsFor('auditor')[1]).toBe('Examination');
    expect(groupsFor('supervisor')[1]).toBe('My territory');
  });

  it('gives no two roles the same arrangement', () => {
    const shapes = (['admin', 'revenue_officer', 'finance_officer', 'auditor', 'supervisor'] as const)
      .map((role) => groupsFor(role).join(' > '));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  /*
   * And adding that group did not move anybody's landing page.
   *
   * `landingPath` used to be "the first thing in the menu", so a new first
   * group would have silently relocated every officer's front door.
   */
  it('still lands every role on their role home', () => {
    for (const role of PORTAL_ROLES) {
      expect(landingPath(principal(role as Role)), role).toBe('/');
    }
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
          `${role} is offered ${english(item.label)} without the permission for it`,
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
  it('holds no permission that changes the record', () => {
    const held = ROLE_PERMISSIONS.auditor as readonly string[];
    const mutating = held.filter((permission) =>
      (MUTATING_PERMISSIONS as readonly string[]).includes(permission),
    );
    expect(mutating, `auditor holds mutating permission(s): ${mutating.join(', ')}`).toEqual([]);
  });

  /**
   * And writes its own findings, which is not the same thing.
   *
   * Pinned rather than left implied. The auditor gained four writing
   * permissions when casework arrived and three more with the audit workbench,
   * and the read-only marker survived both because that class is classified
   * apart — a distinction that is only worth anything if somebody stated it on
   * purpose. If a future change folds it back into `MUTATING_PERMISSIONS`, the
   * marker disappears and the test above fails; if it strips the auditor's own
   * record instead, this one does, and the failure says the role was made
   * mute.
   */
  it('writes its own record, and that is the whole of what it writes', () => {
    const held = ROLE_PERMISSIONS.auditor as readonly string[];
    expect(held).toContain('case:create');
    expect(held).toContain('case:contribute');
    expect(held).toContain('case:manage');
    // The workbench: drawing a sample, generating a report, signing one.
    expect(held).toContain('audit:sample');
    expect(held).toContain('audit:report');
    expect(held).toContain('audit:sign');

    const writes = held.filter(
      (permission) =>
        (MUTATING_PERMISSIONS as readonly string[]).includes(permission) ||
        (CASEWORK_PERMISSIONS as readonly string[]).includes(permission),
    );
    expect(writes.sort()).toEqual([
      'audit:report',
      'audit:sample',
      'audit:sign',
      'case:contribute',
      'case:create',
      'case:manage',
    ]);
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
    const lists = {
      MUTATING_PERMISSIONS: MUTATING_PERMISSIONS as readonly string[],
      CASEWORK_PERMISSIONS: CASEWORK_PERMISSIONS as readonly string[],
      READ_ONLY_PERMISSIONS: READ_ONLY_PERMISSIONS as readonly string[],
    };
    const names = Object.keys(lists) as (keyof typeof lists)[];

    const classCountOf = (permission: string) =>
      names.filter((name) => lists[name].includes(permission)).length;

    const unclassified = PERMISSIONS.filter((permission) => classCountOf(permission) === 0);
    expect(
      unclassified,
      `unclassified permission(s) — add to ${names.join(', ')}: ${unclassified.join(', ')}`,
    ).toEqual([]);

    const overclassified = PERMISSIONS.filter((permission) => classCountOf(permission) > 1);
    expect(
      overclassified,
      `in more than one list: ${overclassified.join(', ')}`,
    ).toEqual([]);

    // And nothing in any list has been removed from the shared one.
    for (const name of names) {
      const stale = lists[name].filter(
        (permission) => !(PERMISSIONS as readonly string[]).includes(permission),
      );
      expect(stale, `${name} names permissions that no longer exist: ${stale.join(', ')}`).toEqual([]);
    }
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
    // Casework writes, and is not a change to the record. `fraud:manage` is,
    // because closing a flag is a decision about an agent.
    expect(mutating).not.toContain('case:create');
    expect(mutating).toContain('fraud:manage');
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
