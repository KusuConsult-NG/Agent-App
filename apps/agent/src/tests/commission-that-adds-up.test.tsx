/**
 * The commission an agent earned, and the part of it they could not see.
 *
 * `getWallet` sums six mutually exclusive statuses — PENDING, ELIGIBLE,
 * ON_HOLD, APPROVED, PAID, REVERSED — into one row. The screen rendered
 * three of them: eligible as the headline, pending and paid beside it.
 *
 * Money sitting in the other three was not shown as anything at all. An
 * agent whose commission had been put on hold — which is what happens while
 * a collection of theirs is being checked — saw it in no figure on the page.
 * It was not eligible, not pending, not paid, and not owed back. It was
 * simply absent, and the screen offered no line that could account for it.
 *
 * The transaction count is the tell, and it is the thing an agent would
 * actually notice: it counts every commission row, held and approved ones
 * included, so the count and the money did not reconcile and nothing on the
 * screen explained the difference.
 *
 * `owedBackKobo` covers only the reversed commission that was already paid
 * and not yet recovered. Commission reversed before it was ever paid fell
 * through that gap too.
 *
 * These render the screen for an agent in each of those situations.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { CommissionScreen } from '../screens/More';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;

/** Every bucket zero unless the test says otherwise. */
function wallet(overrides: Record<string, string> = {}) {
  return {
    wallet: {
      pendingKobo: '0',
      eligibleKobo: '0',
      onHoldKobo: '0',
      approvedKobo: '0',
      paidKobo: '0',
      reversedKobo: '0',
      owedBackKobo: '0',
      lifetimeKobo: '0',
      transactionCount: 0,
      ...overrides,
    },
    entries: [],
    note: 'Ledger, not an account.',
  };
}

function show(overrides: Record<string, string> = {}) {
  vi.spyOn(api, 'get').mockResolvedValue(wallet(overrides) as never);
  return render(<CommissionScreen />);
}

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
  vi.restoreAllMocks();
});

afterEach(() => setAppLanguage('en'));

describe('commission an agent cannot see', () => {
  it('says when commission is on hold', async () => {
    show({ onHoldKobo: '1250000', eligibleKobo: '500000' });

    await waitFor(() => expect(screen.getByText(ha.moreSomeCommissionOnHold!)).toBeTruthy());
    expect(screen.getByText(new RegExp(ha.moreOnHoldBody!.slice(0, 30)))).toBeTruthy();
    expect(screen.getByText(/12,500/)).toBeTruthy();
  });

  it('says when commission is approved but not yet paid', async () => {
    show({ approvedKobo: '700000' });

    await waitFor(() => expect(screen.getByText(ha.moreCommissionApproved!)).toBeTruthy());
    expect(screen.getByText(/7,000/)).toBeTruthy();
  });

  /*
   * Reversed before payment. `owedBackKobo` is only the paid-and-not-yet-
   * recovered part, so the difference is money the agent will never receive
   * and had no line for.
   */
  it('says when commission was reversed before it was ever paid', async () => {
    show({ reversedKobo: '400000', owedBackKobo: '150000' });

    await waitFor(() => expect(screen.getByText(ha.moreSomeCommissionReversed!)).toBeTruthy());
    // 400,000 reversed less 150,000 already owed back = 250,000 kobo.
    expect(screen.getByText(/2,500/)).toBeTruthy();
    // And the owed-back line, which is a different claim, is still there.
    expect(screen.getByText(ha.moreSomeCommissionOwedBack!)).toBeTruthy();
  });

  /*
   * The state that must not get noisier. An agent whose commission is moving
   * normally sees the screen exactly as before.
   */
  it('says none of it when there is nothing to say', async () => {
    show({ eligibleKobo: '500000', pendingKobo: '200000', paidKobo: '1000000' });

    await waitFor(() => expect(screen.getByText(ha.moreAvailableForPayout!)).toBeTruthy());
    expect(screen.queryByText(ha.moreSomeCommissionOnHold!)).toBeNull();
    expect(screen.queryByText(ha.moreCommissionApproved!)).toBeNull();
    expect(screen.queryByText(ha.moreSomeCommissionReversed!)).toBeNull();
    expect(screen.queryByText(ha.moreSomeCommissionOwedBack!)).toBeNull();
  });
});
