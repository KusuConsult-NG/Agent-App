/**
 * Taking a permission away from a role, and being told what that did.
 *
 * Revoking is not an edit to a list. Everybody holding the role is signed out
 * on the spot, because the permission map is cached for thirty seconds and
 * thirty seconds is a long time for an officer whose authority has just been
 * withdrawn to keep exercising it. The administrator pressing the button is
 * ending other people's working sessions, possibly mid-task, and the screen
 * owes them two things: the warning before, and the count after.
 *
 * The count was wrong. `sessionsEnded` came from a second query asking how
 * many sessions for the role had been revoked "in the last five seconds",
 * which counts sign-outs this revocation had nothing to do with, and — because
 * `now()` is transaction start time — reads zero when the revoking transaction
 * is slow. The screen announces the sign-out only when the number is non-zero,
 * so zero means an administrator who had just signed out every officer in a
 * role is told "Saved" and nothing more.
 *
 * That is fixed at the source, counted from the rows the UPDATE returned. What
 * this file holds is the other half: that the number, whatever it is, reaches
 * the person who caused it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { RolesScreen } from '../screens/Roles';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

const USER = { id: 'u-1', phone: '+2348000000001', fullName: 'Ladi Dung', role: 'admin' };

const ROLES = [
  {
    name: 'finance_officer',
    label: 'Finance officer',
    label_ha: 'Jami’in kudi',
    description: null,
    is_system: true,
    is_portal: true,
    status: 'ACTIVE',
    officers: '4',
    permissions: ['report:financial', 'payment:reconcile'],
    export_row_limit: 5000,
  },
];

/** What the API says exists. The screen must offer this and nothing else. */
const GRANTABLE = ['report:financial', 'payment:reconcile', 'audit:sign'];

let revokeReply: Record<string, unknown> = {};

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  revokeReply = { sessionsEnded: 4 };
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockResolvedValue({
    roles: ROLES,
    grantable: GRANTABLE,
  } as never);
  vi.spyOn(apiModule.api, 'post').mockImplementation(async () => revokeReply as never);
  // Step-up runs before the write; it is covered by its own file.
  vi.spyOn(apiModule, 'stepUp').mockResolvedValue(undefined as never);
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

/** Open the permission editor for the one role, and give a reason. */
async function openTheEditor(): Promise<void> {
  render(<RolesScreen user={USER as never} />);
  fireEvent.click(await screen.findByText(en.ofcRlPermissions, { selector: 'button' }));
  // By its label: the editor has two empty inputs, a filter and this one, and
  // matching on the empty value picks whichever comes first.
  const reason = await screen.findByLabelText(en.ofcRlGrantReason);
  fireEvent.change(reason, { target: { value: 'Financial reporting moved to audit.' } });
}

describe('withdrawing an officer’s authority', () => {
  /**
   * The warning is on the control, before it is pressed.
   *
   * Not in a confirmation dialog after the fact, and not in documentation. An
   * administrator who does not know that revoking signs people out will do it
   * during a working day and find out from the officers.
   */
  it('says everybody will be signed out before anything is pressed', async () => {
    await openTheEditor();
    expect(screen.getByText(en.ofcRlRevokeWarning)).toBeTruthy();
  });

  it('tells the administrator how many sessions they just ended', async () => {
    await openTheEditor();
    fireEvent.click(screen.getAllByText(en.ofcRlRevoke)[0]!);

    await waitFor(() => {
      expect(screen.getByText(`${en.ofcRlSignedOut}: 4`)).toBeTruthy();
    });
  });

  /**
   * Granting signs nobody out, and must not claim to.
   *
   * A grant widens authority; nothing is withdrawn and no session needs to
   * end. Announcing a sign-out here would teach an administrator that the
   * message is noise, which is how the one that matters gets ignored.
   */
  it('says nothing about sign-outs when a permission is granted', async () => {
    await openTheEditor();
    fireEvent.click(screen.getAllByText(en.ofcRlGrant)[0]!);

    await waitFor(() => expect(screen.getByText(en.ofcCwSaved)).toBeTruthy());
    expect(screen.queryByText(new RegExp(en.ofcRlSignedOut))).toBeNull();
  });

  /**
   * The screen offers what the server says exists, and nothing it invented.
   *
   * A permission is a name the route handlers check. One that appears in this
   * list without a route reading it would look like an authority and be none,
   * so an administrator would believe an officer could do something they
   * cannot.
   */
  it('offers only the permissions the server said are grantable', async () => {
    await openTheEditor();
    for (const permission of GRANTABLE) {
      expect(screen.getByText(permission), `${permission} is missing`).toBeTruthy();
    }
    // A permission the role holds but the server did not offer must not appear
    // as something that can be changed.
    expect(screen.queryByText('user:manage')).toBeNull();
  });

  it('warns an administrator reading Hausa in Hausa', async () => {
    setPortalLanguage('ha');
    render(<RolesScreen user={USER as never} />);
    fireEvent.click(await screen.findByText(ha.ofcRlPermissions, { selector: 'button' }));

    await waitFor(() => expect(screen.getByText(ha.ofcRlRevokeWarning)).toBeTruthy());
    expect(screen.queryByText(en.ofcRlRevokeWarning)).toBeNull();
    // The warning is a statement that people WILL be signed out; the Hausa has
    // to carry that rather than soften it into a possibility.
    expect(ha.ofcRlRevokeWarning).toMatch(/za a/);
  });
});
