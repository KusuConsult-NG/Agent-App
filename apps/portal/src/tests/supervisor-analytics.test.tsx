/**
 * What a supervisor is offered when they sign in.
 *
 * The menu is the authority on what a role may open — `landingPath` derives
 * the first screen from it — so a permission missing here does not merely hide
 * a link, it decides where the officer lands.
 *
 * Dashboard and Revenue intelligence were gated on `report:read:all`. A
 * supervisor holds `report:read:territory` and not that, so both vanished, and
 * a supervisor signed in to a raw transaction list. The role whose whole job
 * is a territory had no analytics at all.
 *
 * What the API returns them is narrowed there and is tested there. This is
 * only about whether the door exists.
 */

import { describe, it, expect } from 'vitest';
import { NAV, availableItems, landingPath } from '../lib/permissions';
import { permissionsForRole } from '@psirs/shared';

function principal(role: string) {
  return { id: `${role}-1`, role, permissions: permissionsForRole(role as never) } as never;
}

describe('the analytics a supervisor is offered', () => {
  it('includes the dashboard', () => {
    const paths = availableItems(principal('supervisor')).map((item) => item.path);
    expect(paths).toContain('/');
  });

  it('includes revenue intelligence', () => {
    const paths = availableItems(principal('supervisor')).map((item) => item.path);
    expect(paths).toContain('/intelligence');
  });

  it('lands them on the dashboard rather than a transaction list', () => {
    expect(landingPath(principal('supervisor'))).toBe('/');
  });
});

describe('the analytics every other portal role is offered', () => {
  it('still reaches the dashboard', () => {
    for (const role of ['admin', 'revenue_officer', 'finance_officer', 'auditor']) {
      const paths = availableItems(principal(role)).map((item) => item.path);
      expect(paths, `${role} lost the dashboard`).toContain('/');
    }
  });

  it('is not offered to a field agent, who has their own application', () => {
    const paths = availableItems(principal('agent')).map((item) => item.path);
    expect(paths).not.toContain('/');
    expect(paths).not.toContain('/intelligence');
  });
});

describe('the menu and the API agree about who may read reports', () => {
  it('gates every reporting screen on a permission some role actually holds', () => {
    // A screen gated on a permission nobody holds is invisible to everyone,
    // which is how the supervisor gap survived: the permission existed, the
    // screen existed, and no test connected the two.
    const roles = ['admin', 'supervisor', 'revenue_officer', 'finance_officer', 'auditor'];
    const reportingScreens = NAV.flatMap((group) => group.items).filter((item) =>
      ['/', '/intelligence', '/performance'].includes(item.path),
    );
    expect(reportingScreens.length).toBe(3);

    for (const screen of reportingScreens) {
      const reachable = roles.filter((role) =>
        availableItems(principal(role)).some((item) => item.path === screen.path),
      );
      expect(reachable.length, `${screen.path} is offered to nobody`).toBeGreaterThan(0);
    }
  });
});
