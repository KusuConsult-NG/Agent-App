/**
 * What happens when the request never gets an answer.
 *
 * `ApiRequestError` meant "the server said no", and nothing else. That made
 * `caught instanceof ApiRequestError` the obvious test to write, and eighty-two
 * handlers across the two applications wrote it — every one of them dropping a
 * lost connection on the floor.
 *
 * Two of those matter more than the rest:
 *
 *   * The confirm on a payment. The agent is standing in front of somebody who
 *     has just handed over money. The connection drops mid-request and the
 *     screen says nothing at all — which is the one answer that makes an agent
 *     press the button a second time.
 *   * A screen that renders its data or nothing. `ApplicationScreen` bails to
 *     `null` while it has neither status nor error, so a failed load left an
 *     applicant looking at an empty page with no message and no way back.
 *
 * `request` now wraps a fetch that never arrived in the shape every caller
 * already handles. The money status is the honest part: a write under
 * `/payments` that got no answer is UNCONFIRMED, because that is exactly what
 * is true, and anything else is NOT_APPLICABLE rather than a false alarm.
 *
 * The last two tests are the ones that matter most. The offline capture path —
 * the reason this application exists — hangs off `isConnectivityFailure`
 * returning true for a lost connection. Wrapping the TypeError broke that, and
 * all 184 tests passed over it, because every one of them handed
 * `isConnectivityFailure` a TypeError it made itself rather than driving a real
 * failure through `request`. These drive it through `request`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ApiRequestError, api, isConnectivityFailure } from '../lib/api';
import { ApplicationScreen } from '../screens/Application';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;

/** What `fetch` does when there is no network: it rejects, with a TypeError. */
function noNetwork() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
}

async function refusalFrom(call: () => Promise<unknown>): Promise<ApiRequestError> {
  try {
    await call();
  } catch (caught) {
    if (caught instanceof ApiRequestError) return caught;
    throw new Error(`expected an ApiRequestError, got ${String(caught)}`);
  }
  throw new Error('the call resolved; it was supposed to fail');
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterEach(() => {
  setAppLanguage('en');
});

describe('a request that never reached PSIRS', () => {
  it('arrives as the kind of error every handler already catches', async () => {
    noNetwork();
    const refusal = await refusalFrom(() => api.get('/agents/me/application'));
    expect(refusal.error.code).toBe('NETWORK');
  });

  /*
   * The property the whole platform turns on. A read that never arrived moved
   * no money whichever way it failed; a write to a payment that never got an
   * answer moved money or did not, and nobody on this side knows which.
   */
  it('says the money is unconfirmed when a payment got no answer', async () => {
    noNetwork();
    const refusal = await refusalFrom(() =>
      api.post('/payments/aa000000-0000-4000-8000-000000000001/confirm'),
    );
    expect(refusal.error.moneyStatus).toBe('UNCONFIRMED');
  });

  it('does not claim the money moved when nothing about money was asked', async () => {
    noNetwork();
    expect((await refusalFrom(() => api.get('/payments/transactions/TXN-1/status'))).error.moneyStatus)
      .toBe('NOT_APPLICABLE');
    expect((await refusalFrom(() => api.post('/support/tickets', { subject: 'x' }))).error.moneyStatus)
      .toBe('NOT_APPLICABLE');
  });

  /*
   * An applicant on a bad connection saw a blank page: no message, no retry,
   * nothing to distinguish "we could not reach PSIRS" from "you have no
   * application". This is that screen, on that connection.
   */
  it('leaves an applicant with something on the screen', async () => {
    noNetwork();
    setAppLanguage('ha');
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(ha.errNetwork!)).toBeTruthy();
  });
});

/*
 * The regression this file exists to stop.
 *
 * Wrapping the lost connection gave every screen something to show and, on the
 * way past, stopped `isConnectivityFailure` recognising it — which is the
 * function the offline queue, the draft capture and the background sync all
 * decide on. An agent in a market with no signal would have been shown an error
 * where their work should have been queued, which is the exact failure this
 * application was built to prevent.
 */
describe('the offline path still knows a lost connection when it sees one', () => {
  it('holds for a read', async () => {
    noNetwork();
    expect(isConnectivityFailure(await refusalFrom(() => api.get('/taxpayers/search?q=a')))).toBe(true);
  });

  it('holds for a write, which is what the draft queue catches', async () => {
    noNetwork();
    const refusal = await refusalFrom(() => api.post('/drafts/sync', { drafts: [] }));
    expect(isConnectivityFailure(refusal)).toBe(true);
  });

  it('still says no to a refusal the server actually sent', () => {
    const refused = new ApiRequestError(
      409,
      { code: 'DEVICE_NOT_REGISTERED', message: 'no', moneyStatus: 'NOT_APPLICABLE' },
      null,
    );
    expect(isConnectivityFailure(refused)).toBe(false);
  });
});
