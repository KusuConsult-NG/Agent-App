/**
 * A queue that cannot empty has to say why.
 *
 * `runSync` caught every failure the same way — `catch { requestBackgroundSync() }`
 * — which is right for the case it was written for. Losing the signal is
 * temporary, the connection banner already reports it, and asking the browser to
 * retry is the whole point of the queue.
 *
 * It is wrong for everything else. When the server *refuses* the captures — the
 * handset was never registered, the clearance was withdrawn — no amount of
 * retrying will change the answer. The queue sat at "1 saved record(s) waiting
 * to send" indefinitely, and the reason was known to the server and to nobody
 * else. The refusal the API returns is specific and carries the screen to go to;
 * it simply never reached the person holding the phone.
 *
 * These lock the distinction: connectivity stays silent, a refusal is shown.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { App } from '../App';
import { api, ApiRequestError } from '../lib/api';
import * as drafts from '../lib/drafts';

// App renders the home screen behind whatever else is on the page; it needs a
// shaped payload, not an empty object, or it fails for a reason unrelated to
// the thing under test.
const HOME = {
  today: { collected_kobo: '0', successful: '0', total: '0', pending: '0' },
  commission: { lifetime_kobo: '0', available_kobo: '0', today_kobo: '0' },
  taxpayersOnboarded: { today: '0', total: '0' },
  recentTransactions: [],
};

vi.mock('../lib/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/drafts')>()),
  pendingDrafts: vi.fn(),
  syncDrafts: vi.fn(),
  requestBackgroundSync: vi.fn(),
}));

function signedIn() {
  vi.spyOn(api, 'get').mockResolvedValue(HOME as never);
  localStorage.setItem(
    'psirs.user',
    JSON.stringify({ id: 'u1', fullName: 'Demo Field Agent', role: 'agent' }),
  );
}

describe('a sync the server refuses', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('tells the agent why, and where to go, when the handset is not registered', async () => {
    signedIn();
    vi.mocked(drafts.pendingDrafts).mockResolvedValue([{ clientReference: 'c1' }] as never);
    vi.mocked(drafts.syncDrafts).mockRejectedValue(
      new ApiRequestError(403, {
        code: 'DEVICE_NOT_REGISTERED',
        message: 'This device is not registered to your agent account.',
        nextStep: 'Open Profile, then "View my application and clearance", to register it.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Saved records could not be sent/i)).toBeTruthy();
    });
    expect(screen.getByText(/not registered to your agent account/i)).toBeTruthy();
    // The next step names a screen the app actually has.
    expect(screen.getByText(/View my application and clearance/i)).toBeTruthy();
    // And the agent is told the capture survives, or they will write it on paper.
    expect(screen.getByText(/still on this phone/i)).toBeTruthy();
  });

  it('stays quiet when it is only the signal, because that resolves itself', async () => {
    signedIn();
    vi.mocked(drafts.pendingDrafts).mockResolvedValue([{ clientReference: 'c1' }] as never);
    vi.mocked(drafts.requestBackgroundSync).mockResolvedValue(undefined);
    vi.mocked(drafts.syncDrafts).mockRejectedValue(new TypeError('Failed to fetch'));

    render(<App />);

    await waitFor(() => {
      expect(drafts.requestBackgroundSync).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Saved records could not be sent/i)).toBeNull();
  });
});
