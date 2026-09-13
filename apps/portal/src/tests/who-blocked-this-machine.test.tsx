/**
 * Blocking a machine is a decision, and reversing one needs the record.
 *
 * Blocking ends every session on a machine and stops it signing in again —
 * this screen's own comment calls it a supervisory act. The row carries
 * `block_reason`, `blocked_by_name` and `blocked_at` so somebody can see
 * what was done and by whom.
 *
 * The actions column was a ternary. An officer who could manage saw the
 * block control; everybody else saw the reason. So the administrator holding
 * the authority to unblock was the one person shown nothing about why the
 * machine had been blocked, and neither of them ever saw who did it or when
 * — both fields declared on the row and never read.
 *
 * A decision taken without the record is a guess, and this is the decision
 * that decides whether somebody can work today.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { MyAccessScreen } from '../screens/MyAccess';
import { api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Admin Dung',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Admin Dung',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

const BLOCKED = {
  id: 'd1',
  label: 'Front desk laptop',
  user_agent: 'Firefox on Windows',
  first_seen_at: '2026-01-04T08:00:00.000Z',
  last_seen_at: '2026-09-01T16:20:00.000Z',
  status: 'BLOCKED',
  blocked_at: '2026-09-02T10:15:00.000Z',
  block_reason: 'Left unattended in a public office.',
  blocked_by_name: 'Supervisor Pam',
  live_sessions: 0,
};

/** One request returns both lists; the sessions half is not what this tests. */
function serve(devices: unknown[]) {
  return vi.spyOn(api, 'get').mockResolvedValue({ sessions: [], devices } as never);
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('a machine somebody blocked', () => {
  /*
   * The administrator is the one who can undo it, and was the one shown
   * least: the ternary gave them the button instead of the reason.
   */
  it('shows the whole record to the officer who could unblock it', async () => {
    signInAs('admin');
    serve([BLOCKED]);

    render(<MyAccessScreen user={user('admin')} />);

    await waitFor(() => expect(screen.getByText(/Front desk laptop/)).toBeTruthy());
    expect(screen.getByText(/Left unattended in a public office/)).toBeTruthy();
    expect(screen.getByText(/Supervisor Pam/)).toBeTruthy();
    expect(screen.getByText(new RegExp(en.ofcAcBlockedBy))).toBeTruthy();
    // And the control they need is still there.
    expect(screen.getByRole('button', { name: en.ofcAcUnblock })).toBeTruthy();
  });

  it('shows it to the officer whose machine it is, too', async () => {
    signInAs('finance_officer');
    serve([BLOCKED]);

    render(<MyAccessScreen user={user('finance_officer')} />);

    await waitFor(() => expect(screen.getByText(/Front desk laptop/)).toBeTruthy());
    expect(screen.getByText(/Supervisor Pam/)).toBeTruthy();
    // They still may not set it on their own machine.
    expect(screen.queryByRole('button', { name: en.ofcAcBlock })).toBeNull();
  });

  /*
   * A machine nobody has blocked says none of it, rather than rendering an
   * empty "Blocked by:" for a record that does not exist.
   */
  it('says none of it for a machine in normal use', async () => {
    signInAs('admin');
    serve([{ ...BLOCKED, status: 'ACTIVE', blocked_at: null, block_reason: null, blocked_by_name: null }]);

    render(<MyAccessScreen user={user('admin')} />);

    await waitFor(() => expect(screen.getByText(/Front desk laptop/)).toBeTruthy());
    expect(screen.queryByText(new RegExp(en.ofcAcBlockedBy))).toBeNull();
  });
});
