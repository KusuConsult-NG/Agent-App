/**
 * A payout queue, and the question it cannot answer.
 *
 * `GET /government/commissions/by-place` was written with its purpose in its
 * own one-line comment — "commission by place and by month, which is how a
 * Council asks about it" — and had no caller in either front end. One of the
 * reads recorded in READ_WITHOUT_A_SCREEN.
 *
 * The commissions screen is a payout queue: one row per agent per payout,
 * which answers "who is owed" and nothing about where the money is coming
 * from. A Council asking what its agents earned last quarter, or an officer
 * asking why the commission bill has moved, had nowhere to look.
 *
 * Reversed is a column of its own rather than a footnote. A place with high
 * accrual AND high reversal is not collecting well; it is raising charges
 * that do not stand up, and in a single total the two are the same number.
 *
 * The second thing here is the skeleton. The payout list caught its error
 * into an alert and left `payouts` at null, so the table below went on
 * drawing "still loading" underneath a sentence saying the read had been
 * refused. An officer reading both cannot tell whether to wait.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CommissionsScreen } from '../screens/Finance';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const PAYOUTS = [
  {
    id: 'po-1',
    payout_reference: 'PAY-2026-0001',
    agent_code: 'AG-0042',
    full_name: 'Ladi Bature',
    amount_kobo: '250000',
    commission_count: 12,
    bank_name: 'Zenith Bank',
    account_number: '1234567890',
    verification_status: 'VERIFIED',
    status: 'REQUESTED',
  },
];

const BY_PLACE = {
  byLga: [
    {
      lga: 'Jos North',
      commissions: '120',
      accrued_kobo: '4500000',
      paid_kobo: '3000000',
      outstanding_kobo: '1000000',
      reversed_kobo: '500000',
    },
  ],
  byPeriod: [
    {
      period: '2026-08',
      commissions: '40',
      accrued_kobo: '1500000',
      paid_kobo: '1000000',
      outstanding_kobo: '400000',
      reversed_kobo: '100000',
    },
  ],
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The commission report could not be built.',
  moneyStatus: 'NOT_APPLICABLE',
});

const PAYOUTS_REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The payout queue could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

let byPlace: () => unknown;
let payouts: () => unknown;

beforeEach(() => {
  cleanup();
  byPlace = () => BY_PLACE;
  payouts = () => PAYOUTS;
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/commissions/by-place')) return byPlace() as never;
    if (path.includes('/commissions/payouts')) return payouts() as never;
    return [] as never;
  });
});

afterEach(() => vi.restoreAllMocks());

describe('an officer asked where the commission went', () => {
  it('can see it by place and by month, which the payout queue cannot say', async () => {
    render(<CommissionsScreen />);

    await screen.findByText(/Where commission is being earned/i);
    expect(screen.getByText('Jos North')).toBeTruthy();
    expect(screen.getByText('2026-08')).toBeTruthy();
  });

  it('keeps reversed apart from accrued, because a total hides it', async () => {
    render(<CommissionsScreen />);
    await screen.findByText('Jos North');

    // ₦45,000 accrued against ₦5,000 reversed: one figure, not one number.
    expect(screen.getByText('₦45,000.00')).toBeTruthy();
    expect(screen.getByText('₦5,000.00')).toBeTruthy();
  });

  it('does not report a refused report as a place that earned nothing', async () => {
    byPlace = () => {
      throw REFUSED;
    };
    render(<CommissionsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/commission report could not be built/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No commission was accrued in this period/i)).toBeNull();
  });
});

describe('the payout queue when it cannot be read', () => {
  it('stops drawing a skeleton under the sentence saying it failed', async () => {
    /*
     * Both used to be on screen at once: an alert saying the read was
     * refused, and a table below it still claiming to be loading.
     */
    payouts = () => {
      throw PAYOUTS_REFUSED;
    };
    render(<CommissionsScreen />);

    await waitFor(() => expect(screen.getByText(/payout queue could not be read/i)).toBeTruthy());
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('offers a way to ask again', async () => {
    let attempt = 0;
    payouts = () => {
      attempt += 1;
      if (attempt === 1) throw PAYOUTS_REFUSED;
      return PAYOUTS;
    };
    render(<CommissionsScreen />);
    await screen.findByText(/payout queue could not be read/i);

    fireEvent.click(screen.getAllByRole('button', { name: /Try again/i })[0]!);

    await waitFor(() => expect(screen.getByText('PAY-2026-0001')).toBeTruthy());
  });
});
