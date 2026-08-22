/**
 * When the server refuses to release money, the officer has to be told.
 *
 * The actions on the commissions and reconciliation screens each release money
 * or close a discrepancy, and each was written out longhand at the call site
 * with the `api.post` sitting outside any try/catch. A rejection became an
 * unhandled promise and the screen did not change at all.
 *
 * The case that matters is the server's separation-of-duties check. "You
 * cannot approve a payout you requested yourself" is a real refusal, correctly
 * implemented and carefully worded — and the officer it exists to stop saw a
 * button that did nothing. Pressed it, typed a reason, and nothing happened.
 * A control nobody is told about is a control that gets worked around, usually
 * by asking a colleague to press the button without explaining why.
 *
 * The second hole was the short answer: `if (!reason || reason.length < n)
 * return` abandoned the action without a word, so typing four characters into
 * a box that wanted five looked exactly like success. Pressing Cancel is the
 * one case that stays quiet, because the person changed their mind and knows
 * it.
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
  full_name: 'Demo Field Agent',
  amount_kobo: '4500000',
  commission_count: 12,
  bank_name: 'Zenith Bank',
  account_number: '0123456789',
  verification_status: 'VERIFIED',
  status: 'REQUESTED',
  bank_reference: null,
};

/**
 * The portal reads permissions from the signed-in user in session storage.
 * The real list is used rather than a hand-picked pair, so that a permission
 * being taken away from finance officers shows up here as a failing test
 * rather than as a screen that quietly loses its buttons.
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

let prompt: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAsFinanceOfficer();
  vi.spyOn(api, 'get').mockResolvedValue([PAYOUT] as never);
  prompt = vi.fn();
  vi.stubGlobal('prompt', prompt);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const clickApprove = async () => {
  await waitFor(() => expect(screen.getByText(/PO-2026-000123/)).toBeTruthy());
  const button = await waitFor(() => screen.getByRole('button', { name: /^Approve$/ }));
  fireEvent.click(button);
};

describe('approving a commission payout', () => {
  it('shows the refusal when the server will not allow it', async () => {
    prompt.mockReturnValue('Checked against the settlement statement');
    const post = vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(403, {
        code: 'FORBIDDEN',
        message: 'You cannot approve a payout you requested yourself.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    render(<CommissionsScreen />);
    await clickApprove();

    await waitFor(() => {
      expect(screen.getByText(/cannot approve a payout you requested yourself/i)).toBeTruthy();
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Payout approved/i)).toBeNull();
  });

  it('says why a too-short reason was not accepted, and does not call the server', async () => {
    prompt.mockReturnValue('abc');
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    render(<CommissionsScreen />);
    await clickApprove();

    await waitFor(() => expect(screen.getByText(/at least 5 characters/i)).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
  });

  it('stays quiet when the officer cancels', async () => {
    prompt.mockReturnValue(null);
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    render(<CommissionsScreen />);
    await clickApprove();

    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByText(/at least 5 characters/i)).toBeNull();
  });

  it('confirms the approval when the server accepts it', async () => {
    prompt.mockReturnValue('Checked against the settlement statement');
    const post = vi.spyOn(api, 'post').mockResolvedValue({ approved: true } as never);

    render(<CommissionsScreen />);
    await clickApprove();

    await waitFor(() => expect(screen.getByText(/Payout approved/i)).toBeTruthy());
    expect(post).toHaveBeenCalledWith(
      '/government/commissions/payouts/11111111-1111-1111-1111-111111111111/approve',
      { reason: 'Checked against the settlement statement' },
    );
  });
});
