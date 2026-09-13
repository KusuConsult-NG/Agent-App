/**
 * The screen for blocking a laptop already in somebody else's hands, saying
 * there is no laptop.
 *
 * `MyAccessScreen` answered a failed read with `setSessions([]);
 * setDevices([])`. Neither empty state is a blank. They read:
 *
 *   "This account has never been signed in."
 *   "No machine has been recorded yet."
 *
 * On this screen of all of them. Blocking a machine is the one control gated
 * on `user:manage` here, and the case for it is set down in the screen's own
 * comment: "a laptop already in somebody else's hands". So an administrator
 * opening somebody's access to revoke a machine, on a connection that
 * dropped, was told the account had never been used and no machine existed —
 * with nothing on the screen saying the question had not been answered.
 *
 * There is nothing to block, and no reason to look further. That is the
 * reading, and it is the one an attacker would want.
 *
 * This is the same defect as the sixteen others found in this sweep, on the
 * highest-stakes screen it has appeared on. It survived the sweep because
 * this screen was already rendered by a test — `blocking-somebody-elses-
 * laptop` — so it never came up on the list of screens nothing had drawn,
 * which is how I was enumerating them. A screen having a test says nothing
 * about whether its failure branches have one.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { MyAccessScreen } from '../screens/MyAccess';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

const OFFICER = { id: 'u-9', full_name: 'Ngo Dalyop' };

const ACCESS = {
  sessions: [
    {
      id: 's-1',
      device_label: 'Office laptop',
      ip_address: '41.203.0.9',
      issued_at: '2026-09-10T08:00:00.000Z',
      last_used_at: '2026-09-11T07:00:00.000Z',
      is_current: false,
    },
  ],
  devices: [
    {
      id: 'd-1',
      label: 'Office laptop',
      status: 'ACTIVE',
      first_seen_at: '2026-09-01T08:00:00.000Z',
      last_seen_at: '2026-09-11T07:00:00.000Z',
      block_reason: null,
      blocked_by_name: null,
      blocked_at: null,
    },
  ],
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'That account could not be read just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

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

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAs('admin');
});

afterEach(() => cleanup());

describe('an administrator whose read of somebody’s access failed', () => {
  it('is not told the account has never been signed in', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await waitFor(() =>
      expect(screen.getAllByText('That account could not be read just now.').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(en.ofcAcNoSessions)).toBeNull();
  });

  it('is not told no machine has been recorded', async () => {
    // The sentence that makes the block button pointless.
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await waitFor(() =>
      expect(screen.getAllByText('That account could not be read just now.').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(en.ofcAcNoDevices)).toBeNull();
  });

  it('can ask again, and the laptop is there', async () => {
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 1) throw REFUSED;
      return ACCESS as never;
    });

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);
    fireEvent.click(await screen.findByRole('button', { name: en.actionTryAgain }));

    await waitFor(() => expect(screen.getAllByText('Office laptop').length).toBeGreaterThan(0));
    expect(screen.queryByText('That account could not be read just now.')).toBeNull();
  });
});

describe('what this must not have changed', () => {
  it('still says the account has never been signed in when that is the answer', async () => {
    // The sentence is not wrong. It is wrong from a failure.
    vi.spyOn(api, 'get').mockResolvedValue({ sessions: [], devices: [] } as never);

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await screen.findByText(en.ofcAcNoSessions);
    expect(screen.getByText(en.ofcAcNoDevices)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.actionTryAgain })).toBeNull();
  });

  it('still lists the sessions and machines when the read works', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(ACCESS as never);

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await waitFor(() => expect(screen.getAllByText('Office laptop').length).toBe(2));
  });

  it('still waits quietly while the read is in flight', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}));

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByText(en.ofcAcNoSessions)).toBeNull();
  });
});
