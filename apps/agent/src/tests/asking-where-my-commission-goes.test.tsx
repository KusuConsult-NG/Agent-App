/**
 * The agent's side of the same question: is a change already waiting?
 *
 * `BankAccountScreen` reads `/agents/me/bank/change` before it decides what to
 * show. `undefined` means it has not answered yet, a change means one is
 * waiting, and `null` means PSIRS says there is none — at which point the
 * screen offers the form to ask for one.
 *
 * The catch wrote `null`. So a read that failed was indistinguishable from
 * "nothing is waiting", and the agent was handed the form. Five fields, a
 * one-time code, and then `BANK_CHANGE_ALREADY_PENDING` from the server —
 * which reads like the request was turned down, not like it was never sent.
 * An agent who has lost access to the account their commission is paid into
 * does not need to be told twice that they cannot move it.
 *
 * So the screen now says it could not find out, and offers to ask again.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BankAccountScreen } from '../screens/More';
import { ApiRequestError, api } from '../lib/api';

const WAITING = {
  approvalId: 'ap-1',
  bankName: 'Zenith Bank',
  accountNumberMasked: '······6789',
  accountName: 'LADI DUNG',
  verificationStatus: 'VERIFIED',
  verificationResolvedName: 'LADI DUNG',
  verificationReason: null,
  requestedReason: 'My old account was closed by the bank.',
  requestedAt: '2026-09-09T10:00:00Z',
  current: { bankName: 'First Bank', accountNumberMasked: '······1234', accountName: 'LADI DUNG' },
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'PSIRS could not be reached just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('when the screen cannot find out whether a change is waiting', () => {
  it('says so', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<BankAccountScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/could not be reached just now/i)).toBeTruthy());
  });

  it('does not offer the form, which would spend a step-up on a refusal', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<BankAccountScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/could not be reached just now/i)).toBeTruthy());
    expect(screen.queryByText(/Ask for a different account/i)).toBeNull();
  });

  it('offers to ask again, and shows the answer when it arrives', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(REFUSED)
      .mockResolvedValueOnce({ change: WAITING } as never);
    render(<BankAccountScreen navigate={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText(/A change is waiting/i)).toBeTruthy());
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('when PSIRS answers', () => {
  /*
   * The two controls. Both of these are the screen doing its job on an answer
   * it actually received, and the fix must not disturb either.
   */
  it('offers the form when nothing is waiting', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ change: null } as never);
    render(<BankAccountScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Ask for a different account/i)).toBeTruthy());
  });

  it('shows the waiting change instead of the form', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ change: WAITING } as never);
    render(<BankAccountScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/A change is waiting/i)).toBeTruthy());
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/First Bank/);
    expect(body).toMatch(/Zenith Bank/);
    expect(screen.queryByText(/Ask for a different account/i)).toBeNull();
  });
});
