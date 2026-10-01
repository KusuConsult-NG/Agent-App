/**
 * A super administrator told they were a field agent.
 *
 * Reported from a live deployment, with a photograph. The page read:
 *
 *     You are signed in as a field agent
 *     Your collection tools are in the agent app
 *
 * while the menu beside it listed Officer access, Roles & permissions,
 * Departments & offices and Agents & clearance — the administration menu,
 * correct for the person actually signed in. Two halves of one screen
 * disagreeing about who was reading it, and the half that was wrong was the
 * half written as a sentence.
 *
 * HOW THEY GOT THERE
 *
 * `/field-work` was rendered for anybody who arrived at its path. It belongs
 * to the agent's menu and no other role's, but a menu decides what is OFFERED,
 * not what is reachable, and nothing checked.
 *
 * The address bar still read `#/field-work` from an earlier session on the
 * same machine. Signing in again did not clear it, because the landing
 * redirect only fires when the route is exactly `/`. So the new session
 * resumed on the previous one's screen.
 *
 * WHY IT IS WORTH A TEST RATHER THAN A ONE-LINE FIX
 *
 * This is the one screen in the portal that asserts something about the
 * person reading it. Everything else is a list or a form, wrong at worst in
 * what it offers; this is wrong about WHO, on a government revenue platform,
 * to an administrator. A screen that makes a claim about its reader has to
 * check, and the check has to be held in place.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { App } from '../App';
import * as apiModule from '../lib/api';
import { menuOffers } from '../lib/permissions';

/*
 * `landingPath` is pinnable, per test, so the redirect can be made a no-op
 * for the one case that needs the render guard alone. `vi.mock` is hoisted
 * above ordinary declarations, so the switch it reads has to be hoisted with
 * it; everything else in the module stays real, because `menuOffers` is the
 * subject of the first block below and must not be a stub.
 */
const pin = vi.hoisted(() => ({ landing: null as string | null }));

vi.mock('../lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/permissions')>();
  return {
    ...actual,
    landingPath: (user: Parameters<typeof actual.landingPath>[0]) =>
      pin.landing ?? actual.landingPath(user),
  };
});

const en = getTranslation('en');

function signedInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Super Admin',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

beforeEach(() => {
  window.location.hash = '';
  vi.spyOn(apiModule.api, 'get').mockImplementation((async () => ({})) as never);
});

afterEach(() => {
  pin.landing = null;
  cleanup();
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('the menu as the authority on what a role may open', () => {
  it('offers field work to an agent', () => {
    signedInAs('agent');
    expect(menuOffers(apiModule.getUser(), '/field-work')).toBe(true);
  });

  for (const role of ['admin', 'finance_officer', 'revenue_officer', 'auditor', 'supervisor'] as Role[]) {
    it(`does not offer it to a ${role}`, () => {
      signedInAs(role);
      expect(menuOffers(apiModule.getUser(), '/field-work')).toBe(false);
    });
  }
});

describe('an officer arriving at the agent screen by its address', () => {
  it('is not told they are a field agent, even if the redirect cannot move them', async () => {
    /*
     * THE RENDER GUARD, ISOLATED FROM THE REDIRECT.
     *
     * The first version of this test asserted only that the sentence was
     * absent after rendering — and passed with the render guard deleted,
     * because the redirect had already carried the administrator away. The
     * mutation check is what exposed that: removing the guard failed nothing.
     *
     * Two things stand between an officer and this screen, and they fail
     * differently. The redirect fixes the address; the guard decides what is
     * drawn. A redirect that cannot move them — a role whose landing page is
     * this very path, or a navigation that has not run yet, which is every
     * first paint — leaves the guard alone with it.
     *
     * Pinning `landingPath` to `/field-work` makes the redirect a no-op, so
     * what remains is the guard.
     */
    pin.landing = '/field-work';
    window.location.hash = '#/field-work';
    signedInAs('admin');

    render(<App />);

    await waitFor(() => expect(document.body.textContent).toBeTruthy());
    expect(screen.queryByText(en.ofcFieldWorkTitle)).toBeNull();
  });

  it('is taken to their own landing page instead', async () => {
    window.location.hash = '#/field-work';
    signedInAs('admin');

    render(<App />);

    // The address stops lying too — leaving it would hand the same screen
    // back on the next reload.
    await waitFor(() => expect(window.location.hash).not.toBe('#/field-work'));
  });

  it('still shows it to the agent it was written for', async () => {
    window.location.hash = '#/field-work';
    signedInAs('agent');

    render(<App />);

    await waitFor(() => expect(screen.getByText(en.ofcFieldWorkTitle)).toBeTruthy());
  });
});
