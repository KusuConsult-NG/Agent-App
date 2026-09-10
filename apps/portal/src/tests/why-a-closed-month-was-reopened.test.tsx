/**
 * The sentence the service was built to produce, and could not.
 *
 * `reopenPeriod` says what reopening is for, and what the record is meant to
 * yield:
 *
 *   "March was reopened on the 9th of June by Bala, because the Kanam
 *    settlement was misposted" is a sentence the platform can produce.
 *
 * It selects `closed_at`, `closing_note`, `reopened_at` and `reopen_reason`
 * to that end, and the screen's row type declares all four. The column
 * rendered two names and dropped the rest — so an officer looking at a month
 * that had been closed, reopened and closed again saw who did it and nothing
 * about when or why. The reason a set of published figures was unfrozen —
 * required at the point of reopening, precisely so it would exist — was
 * reachable only from the audit log.
 *
 * The fourth screen today whose own comment describes behaviour the code did
 * not have, and the first where the comment is in the service rather than the
 * screen: the API kept its half of the bargain and the client dropped it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { PeriodsScreen } from '../screens/Periods';
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
      fullName: 'Finance Bala',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const MARCH = {
  id: 'p1',
  label: 'March 2026',
  period_start: '2026-03-01',
  period_end: '2026-03-31',
  status: 'OPEN',
  closed_at: '2026-04-02T09:00:00.000Z',
  closing_note: 'Figures agreed with the reconciliation report.',
  reopened_at: '2026-06-09T11:30:00.000Z',
  reopen_reason: 'The Kanam settlement was misposted.',
  collected_kobo: '1000000',
  settled_kobo: '1000000',
  commission_kobo: '50000',
  transaction_count: 40,
  closed_by_name: 'Finance Bala',
  reopened_by_name: 'Admin Dung',
};

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('a month that was closed and reopened', () => {
  it('says when it was closed and what was certified', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockResolvedValue([MARCH] as never);

    render(<PeriodsScreen />);

    await waitFor(() => expect(screen.getByText(/March 2026/)).toBeTruthy());
    expect(screen.getByText(/Finance Bala/)).toBeTruthy();
    expect(screen.getByText(/Figures agreed with the reconciliation report/)).toBeTruthy();
    // The date it was closed, not only the name.
    expect(document.body.textContent).toMatch(/2026/);
  });

  /*
   * The half that matters. Reopening unfreezes figures the State has already
   * published, and the reason is required at the point of reopening for
   * exactly this reading.
   */
  it('says why it was reopened, and by whom', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockResolvedValue([MARCH] as never);

    render(<PeriodsScreen />);

    await waitFor(() => expect(screen.getByText(/Admin Dung/)).toBeTruthy());
    expect(screen.getByText(/The Kanam settlement was misposted/)).toBeTruthy();
    expect(screen.getByText(new RegExp(en.ofcPeReopenReason))).toBeTruthy();
  });

  /*
   * A month nobody has closed says none of it, rather than rendering empty
   * labels for a record that does not exist yet.
   */
  it('says none of it for a month still open', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockResolvedValue([
      {
        ...MARCH,
        closed_at: null,
        closing_note: null,
        reopened_at: null,
        reopen_reason: null,
        closed_by_name: null,
        reopened_by_name: null,
      },
    ] as never);

    render(<PeriodsScreen />);

    await waitFor(() => expect(screen.getByText(/March 2026/)).toBeTruthy());
    expect(screen.queryByText(new RegExp(en.ofcPeReopenReason))).toBeNull();
    expect(screen.queryByText(new RegExp(en.ofcPeClosingNote))).toBeNull();
  });
});
