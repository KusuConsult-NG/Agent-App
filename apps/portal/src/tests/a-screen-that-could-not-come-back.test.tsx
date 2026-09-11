/**
 * One dropped request, and the screen was finished for good.
 *
 * `IntelligenceScreen` is a drill-down: Plateau State, then a Local
 * Government Area, then a ward, each level fetched as you go. The breadcrumb
 * at the top is the only way back up.
 *
 * Its catch set `error` and nothing ever cleared it, and the screen was
 * guarded by `if (error) return <ErrorAlert error={error} />`. So a single
 * failed request — the one that happens when a connection drops for a second
 * — replaced the whole screen with a sentence, including the breadcrumb. The
 * only controls that could have re-run the read were the ones the early
 * return had just removed. An officer could not go back, could not try again,
 * and could not tell that the screen was still working underneath: reloading
 * the page was the only way out, and nothing said so.
 *
 * The error is cleared before each drill now, and reported where the table
 * would be, under a breadcrumb that still works.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { IntelligenceScreen } from '../screens/Dashboard';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const STATE_ROWS = [
  {
    level: 'Jos North',
    level_id: 'lga-1',
    level_type: 'LGA',
    taxpayers: '1200',
    collected_kobo: '45000000',
    transactions: '900',
    agents: '12',
  },
];

const WARD_ROWS = [
  {
    level: 'Naraguta',
    level_id: 'ward-1',
    level_type: 'WARD',
    taxpayers: '300',
    collected_kobo: '9000000',
    transactions: '210',
    agents: '3',
  },
];

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The geography report could not be built.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signIn() {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Administrator',
      role: 'admin',
      permissions: permissionsForRole('admin'),
    }),
  );
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
});

afterEach(() => cleanup());

describe('a drill-down that hits a failure', () => {
  it('keeps the way back up', async () => {
    // The breadcrumb is the only navigation on this screen. Losing it is
    // losing the screen.
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 1) return STATE_ROWS as never;
      throw REFUSED;
    });

    render(<IntelligenceScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Jos North' }));

    await waitFor(() =>
      expect(screen.getByText(/geography report could not be built/i)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /Plateau State/i })).toBeTruthy();
  });

  it('comes back when the officer goes back up', async () => {
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 2) throw REFUSED;
      return STATE_ROWS as never;
    });

    render(<IntelligenceScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Jos North' }));
    await waitFor(() =>
      expect(screen.getByText(/geography report could not be built/i)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Plateau State/i }));

    await waitFor(() =>
      expect(screen.queryByText(/geography report could not be built/i)).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Jos North' })).toBeTruthy();
  });

  it('offers a way to ask again without moving', async () => {
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 2) throw REFUSED;
      if (call >= 3) return WARD_ROWS as never;
      return STATE_ROWS as never;
    });

    render(<IntelligenceScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Jos North' }));
    await waitFor(() =>
      expect(screen.getByText(/geography report could not be built/i)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText('Naraguta')).toBeTruthy());
  });
});

describe('when the report answers', () => {
  it('lists the areas and lets an officer drill into one', async () => {
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      return (call === 1 ? STATE_ROWS : WARD_ROWS) as never;
    });

    render(<IntelligenceScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Jos North' }));

    await waitFor(() => expect(screen.getByText('Naraguta')).toBeTruthy());
  });

  it('still draws a skeleton while a level is in flight', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}) as never);

    render(<IntelligenceScreen />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByText(/could not be built/i)).toBeNull();
  });
});
