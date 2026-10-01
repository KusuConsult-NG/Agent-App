/**
 * The reconciliation screen, when a read it needs does not come back.
 *
 * This is the screen PSIRS uses to check that money it collected actually
 * reached a government account. Three reads fill it — the settlement totals,
 * the exception queue, and what is still in transit — and any one of them
 * failing writes the same slot, deliberately, so a scoped refusal on one
 * endpoint is visible rather than reassuring.
 *
 * The label on that slot was fixed: "Settlement figures are not available to
 * your role". So a 500 from the settlement endpoint, or a request that never
 * left the browser, told a finance officer they lacked permission. That is the
 * one explanation they cannot act on and will not report — they stop looking,
 * and nobody learns the endpoint is down.
 *
 * The state's own comment already draws one distinction, between "this is not
 * yours to see" and "what you just did did not happen", and says that on a
 * reconciliation screen it is not a distinction to blur. This holds the third:
 * "nobody can see it right now".
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ReconciliationScreen } from '../screens/Finance';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const en = translations.en as unknown as Record<string, string>;

/** The shape `/government/settlements` returns, down to the nested figure. */
const SETTLEMENTS = {
  totals: {
    total_expected_kobo: '500000',
    total_received_kobo: '500000',
    total_variance_kobo: '0',
  },
  awaitingSettlement: { count: 0, amount_kobo: '0' },
  recentSettlements: [],
};

/** Everything loads except `/government/settlements`, which fails as given. */
function settlementsFailWith(error: unknown) {
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/government/settlements')) throw error;
    return [] as never;
  });
}

const refusal = (status: number, code: string, message: string) =>
  new ApiRequestError(status, { code, message, moneyStatus: 'NOT_APPLICABLE' });

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('a read the reconciliation screen could not make', () => {
  it('says it is a permission when it is a permission', async () => {
    settlementsFailWith(
      refusal(403, 'FORBIDDEN', 'Settlement figures are outside your territories.'),
    );
    render(<ReconciliationScreen />);

    await waitFor(() => expect(screen.getByText(en.ofcFnNotYourRole!)).toBeTruthy());
    expect(screen.getByText(/outside your territories/i)).toBeTruthy();
  });

  it('does not call a server fault a permission', async () => {
    settlementsFailWith(
      refusal(500, 'INTERNAL_ERROR', 'The request could not be completed because of a problem on our side.'),
    );
    render(<ReconciliationScreen />);

    await waitFor(() =>
      expect(screen.getByText(/a problem on our side/i)).toBeTruthy(),
    );
    expect(
      screen.queryByText(en.ofcFnNotYourRole!),
      'an officer told the figures are not available to their role stops looking',
    ).toBeNull();
  });

  it('does not call an unreachable server a permission either', async () => {
    /*
     * The failure with no response at all. `NETWORK` is in the portal's
     * translation map, so going through `ErrorAlert` also gets this one said
     * in the reader's language — which rendering `error.message` raw never
     * could.
     */
    settlementsFailWith(refusal(0, 'NETWORK', 'The request did not reach PSIRS.'));
    render(<ReconciliationScreen />);

    await waitFor(() => expect(screen.getByText(en.ofcLgCouldNotReachThe!)).toBeTruthy());
    expect(screen.queryByText(en.ofcFnNotYourRole!)).toBeNull();
  });

  it('shows the figures when every read comes back', async () => {
    // The guard: a screen that reported a fault on every load would satisfy
    // the checks above and take reconciliation away.
    vi.spyOn(apiModule, 'can').mockReturnValue(true);
    vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) =>
      (path.startsWith('/government/settlements') ? SETTLEMENTS : []) as never,
    );
    render(<ReconciliationScreen />);

    await waitFor(() => expect(screen.getByText(en.ofcFnTotalExpected!)).toBeTruthy());
    expect(screen.queryByText(en.ofcFnNotYourRole!)).toBeNull();
  });
});
