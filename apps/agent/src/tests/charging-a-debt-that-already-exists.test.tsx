/**
 * The second invoice for the same levy.
 *
 * `GET /revenue/taxpayers/:id/obligations` was built, permissioned on three
 * scopes, and called from nowhere — one of the reads recorded in
 * READ_WITHOUT_A_SCREEN. Its route comment states the case it exists for and
 * the harm of refusing it: "serving a walk-up taxpayer requires finding them
 * and knowing their obligations; that much is the job", and "refusing here
 * would push that agent into raising a second assessment for a debt that
 * already exists."
 *
 * The collection screen was pushed into exactly that. It went from choosing a
 * person straight to choosing a levy, with no sight of the invoices already
 * open against them. A trader who walks up to pay the market levy they were
 * invoiced for last month gets a fresh assessment for the same levy and now
 * owes it twice, and the platform holds two invoices with no way to know
 * which one the money was for.
 *
 * The panel sits BEFORE the levy list, because an agent who has already
 * picked an item and seen a figure is committed. And a read that failed must
 * say so rather than showing nothing: "they owe nothing" is the sentence that
 * tells an agent to go ahead and charge, and the charge that follows is a
 * real debt on a real person.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CollectScreen } from '../screens/Collect';
import { ApiRequestError, api } from '../lib/api';

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

const ITEM = {
  id: 'item-market',
  code: 'MARKET-LEVY',
  name: 'Market stall levy',
  category_name: 'Market and trade levies',
  rate_type: 'FIXED',
};

const OWED = [
  {
    invoice_id: 'inv-1',
    invoice_number: 'INV-2026-000412',
    total_amount_kobo: '500000',
    amount_paid_kobo: '0',
    status: 'UNPAID',
    expires_at: null,
    issued_at: '2026-08-01T09:00:00.000Z',
    assessment_number: 'ASM-2026-000411',
    period_label: 'August 2026',
    revenue_item: 'Market stall levy',
    revenue_item_ha: null,
    revenue_category: 'Market and trade levies',
    revenue_category_ha: null,
    transaction_id: 'txn-1',
    transaction_reference: 'TXN-2026-000182',
    transaction_status: 'PENDING',
  },
];

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'Upstream refused the obligations query.',
  moneyStatus: 'NOT_APPLICABLE',
});

const navigated: string[] = [];
let owes: () => unknown;

beforeEach(() => {
  cleanup();
  navigated.length = 0;
  owes = () => OWED;
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/taxpayers/search')) return [TRADER] as never;
    if (path.includes('/obligations')) return owes() as never;
    if (path.startsWith('/revenue/items')) return [ITEM] as never;
    return [] as never;
  });
});

afterEach(() => vi.restoreAllMocks());

/** Search for the trader and choose them, which is where the panel appears. */
async function chooseTheTrader() {
  render(<CollectScreen navigate={(path) => navigated.push(path)} connection="ONLINE" />);
  const box = document.querySelector('input') as HTMLInputElement;
  fireEvent.change(box, { target: { value: 'Ladi' } });
  fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
  await waitFor(() => screen.getByText(/Ladi Dung/));
  fireEvent.click(screen.getByText(/Ladi Dung/));
}

describe('an agent about to charge somebody', () => {
  it('is shown what that person already owes', async () => {
    await chooseTheTrader();

    await screen.findByText(/What they already owe/i);
    expect(screen.getByText(/INV-2026-000412/)).toBeTruthy();
    expect(screen.getByText(/₦5,000.00/)).toBeTruthy();
  });

  it('can take the existing payment instead of raising a second charge', async () => {
    await chooseTheTrader();
    await screen.findByText(/What they already owe/i);

    fireEvent.click(screen.getByRole('button', { name: /Take this payment/i }));

    expect(navigated).toEqual(['/transactions/TXN-2026-000182']);
  });

  it('says nothing at all when the taxpayer genuinely owes nothing', async () => {
    /*
     * An empty panel headed "What they already owe" on every clean taxpayer
     * is noise on the screen an agent uses forty times a day, and noise is
     * what gets scrolled past when it finally matters.
     */
    owes = () => [];
    await chooseTheTrader();

    await waitFor(() => expect(document.querySelector('select')).toBeTruthy());
    expect(screen.queryByText(/What they already owe/i)).toBeNull();
  });

  it('does not let a failed read look like a taxpayer who owes nothing', async () => {
    // The difference between "no open invoice" and "I could not find out" is
    // the difference between a correct charge and a duplicate one.
    owes = () => {
      throw REFUSED;
    };
    await chooseTheTrader();

    /*
     * The agent's sentence, from the dictionary, and not the server's. The
     * fixture's message is deliberately unlike it so this cannot pass by
     * matching whichever one happened to reach the screen.
     */
    await waitFor(() =>
      expect(screen.getByText(/Their open invoices could not be read/i)).toBeTruthy(),
    );
    expect(screen.getByText(/it says the platform could not tell you/i)).toBeTruthy();
    expect(screen.queryByText(/Upstream refused/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  it('comes back when the agent asks again', async () => {
    let attempt = 0;
    owes = () => {
      attempt += 1;
      if (attempt === 1) throw REFUSED;
      return OWED;
    };
    await chooseTheTrader();
    await screen.findByText(/Their open invoices could not be read/i);

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText(/INV-2026-000412/)).toBeTruthy());
  });
});
