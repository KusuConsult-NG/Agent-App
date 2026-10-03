/**
 * A session that ended without anybody ending it.
 *
 * A session ends three ways and only one writes anything: ending it by hand
 * sets `revoked_at`; going idle past its expiry writes nothing; reaching its
 * absolute lifetime is marked only if it comes back to refresh. The screen
 * decided "active" from `revoked_at` alone, so a session that had lapsed —
 * one the platform would refuse at the next request — sat in the officer's
 * own list with a green ACTIVE badge and an End button, on the page they open
 * to check whether anybody else is in their account.
 *
 * The API now says whether each session is `live`, by the same rule signing
 * in applies (`lib/live-session.ts`), and the screen reads that.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { getTranslation, permissionsForRole } from '@psirs/shared';
import { MyAccessScreen } from '../screens/MyAccess';
import { api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

const session = (id: string, label: string, extra: Record<string, unknown>) => ({
  id,
  device_label: label,
  device_status: 'ACTIVE',
  user_agent: null,
  ip_address: '41.203.0.9',
  issued_at: '2026-09-10T08:00:00.000Z',
  last_used_at: '2026-09-11T07:00:00.000Z',
  expires_at: '2026-09-12T07:00:00.000Z',
  revoked_at: null,
  revoked_reason: null,
  is_current: false,
  ...extra,
});

const ACCESS = {
  sessions: [
    session('s-live', 'Office laptop', { live: true }),
    session('s-idle', 'Home desktop', { live: false }),
    session('s-ended', 'Old phone', {
      live: false,
      revoked_at: '2026-09-11T09:00:00.000Z',
      revoked_reason: 'Ended by the officer',
    }),
  ],
  devices: [],
};

const user = {
  id: 'u1',
  phone: '+2348000000001',
  fullName: 'Revenue Officer',
  email: null,
  role: 'revenue_officer',
  permissions: permissionsForRole('revenue_officer'),
} as never;

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  apiModule.setSession(null);
  sessionStorage.setItem('psirs.portal.user', JSON.stringify(user));
});

afterEach(() => cleanup());

function rowFor(label: string): HTMLElement {
  return screen.getByText(label).closest('tr') as HTMLElement;
}

describe('the list of places an officer is signed in', () => {
  it('does not call a lapsed session active, or offer to end it', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      (path.includes('/activity') ? { sessions: [], byAction: [], byDay: [] } : ACCESS) as never,
    );

    render(<MyAccessScreen user={user} />);
    await waitFor(() => expect(screen.getByText('Home desktop')).toBeTruthy());

    const idle = rowFor('Home desktop');
    expect(within(idle).queryByText(en.enumActive)).toBeNull();
    expect(within(idle).getByText(en.enumExpired)).toBeTruthy();
    expect(within(idle).queryByRole('button')).toBeNull();
  });

  it('still calls a live one active, and still offers to end it', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      (path.includes('/activity') ? { sessions: [], byAction: [], byDay: [] } : ACCESS) as never,
    );

    render(<MyAccessScreen user={user} />);
    await waitFor(() => expect(screen.getByText('Office laptop')).toBeTruthy());

    const live = rowFor('Office laptop');
    expect(within(live).getByText(en.enumActive)).toBeTruthy();
    expect(within(live).getByRole('button', { name: en.ofcAcEnd })).toBeTruthy();

    // And one an officer ended reads as ended, as it always did.
    const ended = rowFor('Old phone');
    expect(within(ended).getByText(new RegExp(en.ofcAcEnded))).toBeTruthy();
    expect(within(ended).queryByRole('button')).toBeNull();
  });
});
