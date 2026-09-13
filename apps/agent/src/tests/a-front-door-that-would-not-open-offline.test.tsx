/**
 * The one screen an offline-first application could not open offline.
 *
 * `HomeScreen` guarded itself with `if (error) return <ErrorAlert error={error}
 * />`, so one failed read of `/agents/me/home` replaced the whole screen with
 * a single sentence. The eight quick actions went with it — and four of those
 * eight are reachable from nowhere else in the application. The tab bar
 * carries Home, Taxpayers, Collect, Receipts, Commission and Profile. It does
 * not carry:
 *
 *   Renew vehicle
 *   Check a receipt      -- "agents are asked 'is this receipt real?' in the
 *                           field constantly"
 *   Hand out             -- the distribution collection point
 *   Groups               -- registering a cooperative
 *
 * The comments beside those entries say so in the source. So a dropped
 * request took four features off a field agent's handset.
 *
 * And it did it on exactly the failure the rest of this application is built
 * to survive. Captures queue. Drafts are kept. `isConnectivityFailure` exists
 * so that a refusal and a lost signal are never confused, "or an agent in a
 * market with no signal is shown an error where their work should have been
 * queued". Every part of that design assumes the agent can still reach the
 * screen they were going to. The front door was the part that did not open.
 *
 * The figures genuinely need the server and are not faked here. What changes
 * is that they fail in their own place, with something to press, under a set
 * of links that never needed the server at all.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HomeScreen } from '../screens/Home';
import { ApiRequestError, api } from '../lib/api';

const HOME = {
  today: { collected_kobo: '500000', successful: '5', total: '5', pending: '0' },
  commission: { lifetime_kobo: '25000', available_kobo: '15000', today_kobo: '7500' },
  taxpayersOnboarded: { today: '3', total: '24' },
  recentTransactions: [],
};

/** What the service worker answers for a network it knows is not there. */
const OFFLINE = new ApiRequestError(503, {
  code: 'OFFLINE',
  message: 'You are offline.',
  moneyStatus: 'NOT_APPLICABLE',
});

/** The suspension the early return exists for, which must keep behaving. */
const SUSPENDED = new ApiRequestError(403, {
  code: 'AGENT_SUSPENDED',
  message: 'Your account has been suspended pending a review.',
  moneyStatus: 'NOT_APPLICABLE',
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('an agent whose home screen could not be read', () => {
  it('can still reach the four things only this screen offers', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(OFFLINE);

    render(<HomeScreen navigate={vi.fn()} />);

    // Not a general "the screen rendered" check. These four are the ones the
    // tab bar cannot reach, so losing them loses the feature.
    expect(await screen.findByText(/Renew vehicle/i)).toBeTruthy();
    expect(screen.getByText(/Check a receipt/i)).toBeTruthy();
    expect(screen.getByText(/Hand out/i)).toBeTruthy();
    expect(screen.getByText(/Groups/i)).toBeTruthy();
  });

  it('is told why the figures are missing, and given something to press', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(OFFLINE);

    render(<HomeScreen navigate={vi.fn()} />);

    await screen.findByText('You are offline.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('comes back when the signal does, without leaving the screen', async () => {
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 1) throw OFFLINE;
      return HOME as never;
    });

    render(<HomeScreen navigate={vi.fn()} />);
    await screen.findByRole('button', { name: 'Try again' });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText(/Collected today/i);
    expect(screen.queryByText('You are offline.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

});

describe('what this must not have changed, or become', () => {
  it('does not draw the figures at all rather than drawing them as nought', async () => {
    // This one guards the FIX rather than the defect — it holds either way,
    // because the old screen showed nothing at all. It is here so that
    // keeping the screen alive never turns into a takings section reading
    // nought, or a claim that this agent has collected nothing today.
    vi.spyOn(api, 'get').mockRejectedValue(OFFLINE);

    render(<HomeScreen navigate={vi.fn()} />);
    await screen.findByText('You are offline.');

    expect(screen.queryByText(/Collected today/i)).toBeNull();
    expect(screen.queryByText(/Available for payout/i)).toBeNull();
    expect(screen.queryByText(/No transactions yet/i)).toBeNull();
  });

  it('still sends a suspended agent to their application, with no quick actions', async () => {
    // The most important control. A suspended agent must not be handed the
    // collection screen because the screen now survives a failed read.
    vi.spyOn(api, 'get').mockRejectedValue(SUSPENDED);

    render(<HomeScreen navigate={vi.fn()} />);

    await screen.findByText('Your account has been suspended pending a review.');
    expect(screen.getByRole('button', { name: /View my application/i })).toBeTruthy();
    expect(screen.queryByText(/Collect revenue/i)).toBeNull();
    expect(screen.queryByText(/Renew vehicle/i)).toBeNull();
  });

  it('still shows a skeleton while the read is in flight', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}));

    render(<HomeScreen navigate={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('still shows the takings and the quick actions when the read works', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(HOME as never);

    render(<HomeScreen navigate={vi.fn()} />);

    await screen.findByText(/Collected today/i);
    expect(screen.getByText(/Available for payout/i)).toBeTruthy();
    expect(screen.getByText(/Register taxpayer/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
