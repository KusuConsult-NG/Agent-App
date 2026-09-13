/**
 * Closing a dispute: three questions, and nothing said back.
 *
 * A DISPUTED settlement is a batch of collections whose bank credit did not
 * cover them. Nothing in it is settled, so no commission on any of it is
 * payable, and the only way out is a second finance officer saying what the
 * variance turned out to be. `closeDispute` asks them three things — the
 * amount now credited, the bank reference for it, and what the shortfall was.
 *
 * Every one of those checks was `window.prompt(...) ?? ''` followed by a bare
 * `return`. An amount that did not parse, an empty bank reference, or a note
 * one character short abandoned the whole action without a word. The officer
 * had answered questions about missing money and been told nothing — on the
 * same screen where `record()` says "Enter the credited amount in naira" when
 * it cannot read one.
 *
 * `apps/portal/src/lib/justify.ts` was written for exactly this and its own
 * doc names the failure: "typing four characters into a box that wanted five
 * looked exactly like success". It takes one answer, this takes three, so
 * this call site never got the remedy.
 *
 * Cancel stays quiet, in all three. Somebody who changed their mind knows.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ReconciliationScreen } from '../screens/Finance';
import { ApiRequestError, api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const DISPUTED = {
  id: '22222222-2222-2222-2222-222222222222',
  settlement_reference: 'STL-2026-000045',
  settlement_date: '2026-09-08',
  bank_reference: 'ZEN-88123',
  transaction_count: 34,
  expected_amount_kobo: '128000000',
  received_amount_kobo: '119500000',
  status: 'DISPUTED',
};

const SETTLEMENTS = {
  totals: {
    total_expected_kobo: '128000000',
    total_received_kobo: '119500000',
    total_variance_kobo: '8500000',
  },
  awaitingSettlement: { amount_kobo: '4200000', count: 7 },
  recentSettlements: [DISPUTED],
};

const EXCEPTION = {
  id: '33333333-3333-3333-3333-333333333333',
  transaction_reference: 'PSIRS-TX-2026-000901',
  status: 'MISSING_IN_GATEWAY',
  expected_amount_kobo: '450000',
  gateway_amount_kobo: null,
  detected_at: '2026-09-09T08:00:00Z',
  resolution_note: null,
};

/**
 * The portal reads permissions from the signed-in user in session storage.
 * The real list rather than a hand-picked pair, so a permission being taken
 * away from finance officers surfaces here as a failing test rather than as a
 * screen that quietly loses its buttons.
 */
function signInAsFinanceOfficer() {
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000003',
      fullName: 'Finance Officer',
      role: 'finance_officer',
      permissions: permissionsForRole('finance_officer'),
    }),
  );
}

function mockLoads() {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/government/settlements') return SETTLEMENTS as never;
    if (path === '/government/reconciliation/exceptions') return [EXCEPTION] as never;
    return [] as never;
  });
}

let prompt: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAsFinanceOfficer();
  mockLoads();
  prompt = vi.fn();
  vi.stubGlobal('prompt', prompt);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render, wait for the settlement to arrive, and press Close dispute. */
async function pressCloseDispute() {
  render(<ReconciliationScreen />);
  await waitFor(() => expect(screen.getByText('STL-2026-000045')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Close dispute/i }));
}

const GOOD_NOTE = 'Bank returned 34 of 41 collections; seven never left the gateway.';

describe('an answer the screen cannot use', () => {
  it('says so when the credited amount does not parse', async () => {
    prompt.mockReturnValueOnce('one hundred thousand');
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    await pressCloseDispute();

    await waitFor(() => expect(screen.getByText(/credited amount in naira/i)).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
  });

  it('says so when the bank reference is left empty', async () => {
    prompt.mockReturnValueOnce('1195000.00').mockReturnValueOnce('   ');
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    await pressCloseDispute();

    await waitFor(() => expect(screen.getByText(/ties the settlement to the money/i)).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
  });

  it('says so when the variance note is too short to be a record', async () => {
    prompt
      .mockReturnValueOnce('1195000.00')
      .mockReturnValueOnce('ZEN-88124')
      .mockReturnValueOnce('short');
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    await pressCloseDispute();

    await waitFor(() => expect(screen.getByText(/at least 10 characters/i)).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
  });
});

describe('an officer who changes their mind', () => {
  /*
   * Cancel is the one silent case, and it has to stay silent at each of the
   * three questions — an officer who backs out at the second is not being
   * refused, and telling them so would train them to ignore the sentence that
   * means something.
   */
  it('is not scolded for cancelling at the amount', async () => {
    prompt.mockReturnValueOnce(null);
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    await pressCloseDispute();

    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByText(/credited amount in naira/i)).toBeNull();
  });

  it('is not scolded for cancelling at the bank reference', async () => {
    prompt.mockReturnValueOnce('1195000.00').mockReturnValueOnce(null);
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    await pressCloseDispute();

    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByText(/ties the settlement to the money/i)).toBeNull();
  });

  it('is not scolded for cancelling at the note', async () => {
    prompt
      .mockReturnValueOnce('1195000.00')
      .mockReturnValueOnce('ZEN-88124')
      .mockReturnValueOnce(null);
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    await pressCloseDispute();

    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByText(/at least 10 characters/i)).toBeNull();
  });
});

describe('three answers the screen can use', () => {
  it('sends them as they were given, in kobo', async () => {
    prompt
      .mockReturnValueOnce('1,195,000.00')
      .mockReturnValueOnce('  ZEN-88124  ')
      .mockReturnValueOnce(`  ${GOOD_NOTE}  `);
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ settlementReference: 'STL-2026-000045', transactionsSettled: 34 } as never);

    await pressCloseDispute();

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        `/government/settlements/${DISPUTED.id}/reconcile`,
        {
          receivedAmountKobo: '119500000',
          bankReference: 'ZEN-88124',
          note: GOOD_NOTE,
        },
      ),
    );
  });

  it('confirms with the reference and how many collections it settled', async () => {
    prompt
      .mockReturnValueOnce('1195000.00')
      .mockReturnValueOnce('ZEN-88124')
      .mockReturnValueOnce(GOOD_NOTE);
    vi.spyOn(api, 'post').mockResolvedValue({
      settlementReference: 'STL-2026-000045',
      transactionsSettled: 34,
    } as never);

    await pressCloseDispute();

    await waitFor(() => {
      const body = document.body.textContent ?? '';
      expect(body).toMatch(/STL-2026-000045/);
      expect(body).toMatch(/34/);
    });
  });

  it('shows the refusal when a second officer is required and this is the first', async () => {
    prompt
      .mockReturnValueOnce('1195000.00')
      .mockReturnValueOnce('ZEN-88124')
      .mockReturnValueOnce(GOOD_NOTE);
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(403, {
        code: 'FORBIDDEN',
        message: 'You cannot close a dispute you recorded yourself.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    await pressCloseDispute();

    await waitFor(() =>
      expect(screen.getByText(/cannot close a dispute you recorded yourself/i)).toBeTruthy(),
    );
  });
});

describe('the screen itself', () => {
  /*
   * A list that could not be read is not a list with nothing in it. An empty
   * exception table reads as "reconciliation is clean", which is the one
   * conclusion an officer must not draw from a request that failed.
   */
  it('does not report a refused read as a clean reconciliation', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/government/reconciliation/exceptions') {
        throw new ApiRequestError(403, {
          code: 'FORBIDDEN',
          message: 'Reconciliation exceptions are not visible to your role.',
          moneyStatus: 'NOT_APPLICABLE',
        });
      }
      if (path === '/government/settlements') return SETTLEMENTS as never;
      return [] as never;
    });

    render(<ReconciliationScreen />);

    await waitFor(() =>
      expect(screen.getByText(/not visible to your role/i)).toBeTruthy(),
    );
  });

  it('shows a settlement that is short, and offers the way to close it', async () => {
    render(<ReconciliationScreen />);

    await waitFor(() => expect(screen.getByText('STL-2026-000045')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Close dispute/i })).toBeTruthy();
    // The variance is the figure the whole screen turns on.
    expect(document.body.textContent).toMatch(/85,000/);
  });
});
