/**
 * What the collection screen shows an agent when the taxpayer owes nothing.
 *
 * Under the Fourth Schedule to the Nigeria Tax Act, 2025 the first ₦800,000
 * of annual income is exempt, so a nil liability is the ordinary outcome for
 * a grassroots trader rather than an edge case. The screen did not know that.
 * A quote of zero rendered:
 *
 *     You are about to collect
 *     ₦0.00
 *     [ Confirm and proceed to payment ]
 *
 * and the API then refused the assessment. The agent has walked a trader
 * through a calculation, announced a collection, pressed a button, and been
 * told no — with no point at which anyone said the trader is exempt.
 *
 * The agent is on commission. The one lever they have on that screen is the
 * income figure they typed, and the screen's own flow invites them back to it.
 *
 * So a nil liability has to be an answer the screen can give: say the tax is
 * nothing, show the working that proves it, and offer no payment.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CollectScreen } from '../screens/Collect';
import { api } from '../lib/api';

const TRADER = {
  id: 'tp-1',
  taxpayer_type: 'INDIVIDUAL',
  first_name: 'Ladi',
  last_name: 'Dung',
  business_name: null,
  tin: null,
  phone: '08031234567',
  lga_name: 'Jos North',
};

const PIT = {
  id: 'item-pit',
  code: 'PIT-DIRECT',
  name: 'Direct Assessment / Self-Assessment',
  category_name: 'Personal Income Tax',
  rate_type: 'TIERED',
};

/** The trace the Fourth Schedule produces for an income inside the exempt band. */
const EXEMPT_TRACE = [
  { step: 'Band 1', detail: '0.00% of the portion up to ₦800,000.00', amount: '0' },
  { step: 'Payable', detail: 'Amount payable to government', amount: '0' },
];

function mockApi(quote: Record<string, unknown>) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/taxpayers/search')) return [TRADER] as never;
    if (path.startsWith('/revenue/items')) return [PIT] as never;
    return [] as never;
  });
  vi.spyOn(api, 'post').mockResolvedValue(quote as never);
}

/** Drive the screen from search to the calculated amount. */
async function calculateFor(incomeNaira: string) {
  render(<CollectScreen navigate={() => {}} connection="ONLINE" />);

  const box = document.querySelector('input') as HTMLInputElement;
  fireEvent.change(box, { target: { value: 'Ladi' } });
  fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
  await waitFor(() => screen.getByText(/Ladi Dung/));

  fireEvent.click(screen.getByText(/Ladi Dung/));
  await waitFor(() => expect(document.querySelector('select')).toBeTruthy());

  fireEvent.change(document.querySelector('select') as HTMLSelectElement, {
    target: { value: PIT.id },
  });
  await waitFor(() => {
    const inputs = [...document.querySelectorAll('input')];
    expect(inputs.some((i) => i.getAttribute('inputmode') === 'decimal')).toBe(true);
  });
  const amountBox = [...document.querySelectorAll('input')].find(
    (i) => i.getAttribute('inputmode') === 'decimal',
  ) as HTMLInputElement;
  fireEvent.change(amountBox, { target: { value: incomeNaira } });

  fireEvent.click(screen.getByRole('button', { name: /Calculate amount/i }));
}

describe('a taxpayer the Schedule exempts, at the counter', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('is not announced as a collection the agent is about to take', async () => {
    mockApi({
      revenueItemId: PIT.id,
      revenueItemName: PIT.name,
      categoryName: PIT.category_name,
      rateVersionId: 'rv-1',
      rateVersion: 1,
      amountKobo: '0',
      serviceChargeKobo: '0',
      totalKobo: '0',
      trace: EXEMPT_TRACE,
    });

    await calculateFor('300000');

    // Wait for the quote to have actually arrived before asserting anything is
    // absent from it. Both outcomes render the working, so it is the anchor
    // that is true either way — without it these assertions pass while the
    // request is still in flight and prove nothing.
    await waitFor(() => screen.getByText(/How this amount was calculated/i));

    expect(screen.queryByText(/You are about to collect/i)).toBeNull();
  });

  it('offers no way to proceed to a payment of nothing', async () => {
    mockApi({
      revenueItemId: PIT.id,
      revenueItemName: PIT.name,
      categoryName: PIT.category_name,
      rateVersionId: 'rv-1',
      rateVersion: 1,
      amountKobo: '0',
      serviceChargeKobo: '0',
      totalKobo: '0',
      trace: EXEMPT_TRACE,
    });

    await calculateFor('300000');

    await waitFor(() => screen.getByText(/How this amount was calculated/i));

    expect(screen.queryByRole('button', { name: /proceed to payment/i })).toBeNull();
  });

  it('says the tax is nothing, in the language the agent is using', async () => {
    mockApi({
      revenueItemId: PIT.id,
      revenueItemName: PIT.name,
      categoryName: PIT.category_name,
      rateVersionId: 'rv-1',
      rateVersion: 1,
      amountKobo: '0',
      serviceChargeKobo: '0',
      totalKobo: '0',
      trace: EXEMPT_TRACE,
    });

    await calculateFor('300000');

    await waitFor(() => {
      expect(screen.getByText(/No tax is payable/i)).toBeTruthy();
    });
    // And it must not send the agent back to the income figure.
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/owes nothing|nothing to pay|do not increase/i);
  });

  it('still shows the working, so the agent can explain it to the trader', async () => {
    // A refusal without the calculation is an agent saying "the phone says
    // no" to somebody who wants to know why.
    mockApi({
      revenueItemId: PIT.id,
      revenueItemName: PIT.name,
      categoryName: PIT.category_name,
      rateVersionId: 'rv-1',
      rateVersion: 1,
      amountKobo: '0',
      serviceChargeKobo: '0',
      totalKobo: '0',
      trace: EXEMPT_TRACE,
    });

    await calculateFor('300000');

    await waitFor(() => {
      expect(screen.getByText(/How this amount was calculated/i)).toBeTruthy();
    });
    expect(document.body.textContent).toMatch(/800,000/);
  });

  it('leaves an ordinary chargeable assessment exactly as it was', async () => {
    // The change must not cost the screen its normal job.
    mockApi({
      revenueItemId: PIT.id,
      revenueItemName: PIT.name,
      categoryName: PIT.category_name,
      rateVersionId: 'rv-1',
      rateVersion: 1,
      amountKobo: '3000000',
      serviceChargeKobo: '0',
      totalKobo: '3000000',
      trace: [{ step: 'Payable', detail: 'Amount payable to government', amount: '3000000' }],
    });

    await calculateFor('1000000');

    await waitFor(() => {
      expect(screen.getByText(/You are about to collect/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /proceed to payment/i })).toBeTruthy();
  });
});
