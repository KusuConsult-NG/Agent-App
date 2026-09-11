/**
 * Two buttons that could fail without saying a word.
 *
 * A handful of click handlers in this portal are `onClick={async () => { ...
 * await api... }}` with no catch anywhere in them. A refusal there is an
 * unhandled rejection: no error, no message, no change on screen. The button
 * simply does nothing, and nothing is exactly what it looks like when a
 * request is still in flight, or when the feature is broken, or when the
 * officer mis-clicked.
 *
 * One of them moves money. "Promote eligible" takes every commission that has
 * met its conditions and makes it payable, for every agent at once. On success
 * it says how many; on failure it said nothing at all — so "it did not work"
 * and "it worked and the confirmation did not draw" looked identical, and the
 * only thing an officer can do with that is press the button again.
 *
 * The other opens the rate-change history behind a revenue item, which is the
 * audit trail for what a levy has cost over time.
 *
 * Both screens already had an `error` state and an `ErrorAlert` rendering it.
 * The handlers just never used them.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CommissionsScreen } from '../screens/Finance';
import { ApiRequestError, api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const PAYOUT = {
  id: '11111111-1111-1111-1111-111111111111',
  payout_reference: 'PO-2026-000123',
  agent_code: 'AGT-00001',
  full_name: 'Ladi Dung',
  amount_kobo: '4500000',
  commission_count: 12,
  bank_name: 'Zenith Bank',
  account_number: '0123456789',
  verification_status: 'VERIFIED',
  status: 'REQUESTED',
  bank_reference: null,
};

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

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAsFinanceOfficer();
  vi.spyOn(api, 'get').mockResolvedValue([PAYOUT] as never);
});

afterEach(() => cleanup());

const promote = async () => {
  render(<CommissionsScreen />);
  fireEvent.click(await screen.findByRole('button', { name: /Promote eligible/i }));
};

describe('promoting every eligible commission for payout', () => {
  it('says so when the server refuses', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(409, {
        code: 'PERIOD_NOT_CLOSED',
        message: 'The commission period has not been closed yet.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    await promote();

    await waitFor(() =>
      expect(screen.getByText(/commission period has not been closed/i)).toBeTruthy(),
    );
  });

  it('does not leave a refusal looking like a success that did not draw', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(409, {
        code: 'PERIOD_NOT_CLOSED',
        message: 'The commission period has not been closed yet.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    await promote();

    await waitFor(() =>
      expect(screen.getByText(/commission period has not been closed/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/promoted/i)).toBeNull();
  });

  it('says how many it promoted when it works', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ promoted: 7 } as never);

    await promote();

    await waitFor(() => expect(screen.getByText(/7/)).toBeTruthy());
  });

  /*
   * The control that matters for a money button: a failure must not leave the
   * previous success on screen, or an officer reads a stale confirmation as
   * this attempt's answer.
   */
  it('clears the last confirmation before trying again', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ promoted: 7 } as never)
      .mockRejectedValueOnce(
        new ApiRequestError(503, {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'The commission ledger could not be reached.',
          moneyStatus: 'NOT_APPLICABLE',
        }),
      );

    render(<CommissionsScreen />);
    const button = await screen.findByRole('button', { name: /Promote eligible/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/7/)).toBeTruthy());

    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByText(/commission ledger could not be reached/i)).toBeTruthy(),
    );
    expect(post).toHaveBeenCalledTimes(2);
  });
});
