/**
 * A lapsed bill at the stall, and the one thing that collects it.
 *
 * The trader's list of bills left out anything past its deadline, because
 * shown, its "Take this payment" led to INVOICE_EXPIRED and nothing could
 * replace the bill except a second assessment. Leaving it off was also what
 * let the agent raise that second assessment without being told the debt was
 * on file. A lapsed bill can now be issued again, so it is listed, marked,
 * and offered for that rather than for a payment the server would refuse —
 * and the transaction screen behind an old bill says the same thing.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CollectScreen, TransactionScreen } from '../screens/Collect';
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

const LAPSED = {
  invoice_id: 'inv-1',
  invoice_number: 'INV-2026-000412',
  total_amount_kobo: '500000',
  amount_paid_kobo: '0',
  status: 'EXPIRED',
  expires_at: '2026-09-01T09:00:00.000Z',
  issued_at: '2026-08-01T09:00:00.000Z',
  assessment_number: 'ASM-2026-000411',
  period_label: 'August 2026',
  revenue_item: 'Market stall levy',
  revenue_item_ha: null,
  revenue_category: 'Market and trade levies',
  revenue_category_ha: null,
  transaction_id: 'txn-1',
  transaction_reference: 'TXN-2026-000182',
  transaction_status: 'EXPIRED',
  under_objection: false,
  needs_reissue: true,
};

const navigated: string[] = [];
const posted: string[] = [];
let owes: unknown[];
let postAnswer: () => Promise<unknown>;

beforeEach(() => {
  cleanup();
  navigated.length = 0;
  posted.length = 0;
  owes = [LAPSED];
  postAnswer = async () => ({ transactionReference: 'TXN-2026-000999', reissued: true });
  vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
    posted.push(path);
    return (await postAnswer()) as never;
  });
});

afterEach(() => vi.restoreAllMocks());

describe("the trader's list of bills", () => {
  beforeEach(() => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/taxpayers/search')) return [TRADER] as never;
      if (path.includes('/obligations')) return owes as never;
      return [] as never;
    });
  });

  async function chooseTheTrader() {
    render(<CollectScreen navigate={(path) => navigated.push(path)} connection="ONLINE" />);
    fireEvent.change(document.querySelector('input') as HTMLInputElement, { target: { value: 'Ladi' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => screen.getByText(/Ladi Dung/));
    fireEvent.click(screen.getByText(/Ladi Dung/));
    await screen.findByText(/What they already owe/i);
  }

  it('shows a lapsed bill, and offers to issue it again rather than to take a payment', async () => {
    await chooseTheTrader();
    expect(screen.getByText(/INV-2026-000412/)).toBeTruthy();
    expect(screen.getByText(/has to be issued again/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Take this payment/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Issue this bill again/i }));
    await waitFor(() => expect(navigated).toEqual(['/transactions/TXN-2026-000999']));
    expect(posted).toEqual(['/revenue/invoices/inv-1/reissue']);
  });

  it('says why, in the agent’s language, when it cannot be issued again', async () => {
    postAnswer = () =>
      Promise.reject(
        new ApiRequestError(409, {
          code: 'INVOICE_PAYMENT_IN_PROGRESS',
          message: 'A payment against invoice INV-2026-000412 is still being processed.',
          moneyStatus: 'NOT_APPLICABLE',
        }),
      );
    await chooseTheTrader();
    fireEvent.click(screen.getByRole('button', { name: /Issue this bill again/i }));
    expect(await screen.findByText(/do not collect again/i)).toBeTruthy();
    expect(navigated).toEqual([]);
  });

  it('still offers the payment on a bill that can be paid', async () => {
    owes = [{ ...LAPSED, status: 'UNPAID', transaction_status: 'INVOICE_GENERATED', needs_reissue: false }];
    await chooseTheTrader();
    expect(screen.getByRole('button', { name: /Take this payment/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Issue this bill again/i })).toBeNull();
  });

  it('says a bill from a closed month has to be issued again, without calling it lapsed', async () => {
    // In date, but its month's figures have been signed off: the payment path
    // refuses it with INVOICE_PERIOD_CLOSED, and "Lapsed" would be untrue.
    owes = [
      {
        ...LAPSED,
        status: 'UNPAID',
        transaction_status: 'INVOICE_GENERATED',
        expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        needs_reissue: true,
        period_closed: 'August 2026',
      },
    ];
    await chooseTheTrader();
    expect(screen.getByText(/Raised in a month that has been closed/i)).toBeTruthy();
    expect(screen.queryByText(/^Lapsed/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Take this payment/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Issue this bill again/i }));
    await waitFor(() => expect(posted).toEqual(['/revenue/invoices/inv-1/reissue']));
  });

  it('offers neither on a bill under objection', async () => {
    owes = [{ ...LAPSED, under_objection: true }];
    await chooseTheTrader();
    expect(screen.queryByRole('button', { name: /Issue this bill again/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Take this payment/i })).toBeNull();
  });
});

describe('the transaction screen behind an old bill', () => {
  const TRANSACTION = {
    id: 'txn-1',
    transaction_reference: 'TXN-2026-000182',
    status: 'EXPIRED',
    amount_kobo: '500000',
    service_charge_kobo: '0',
    total_amount_kobo: '500000',
    invoice_id: 'inv-1',
    invoice_number: 'INV-2026-000412',
    invoice_status: 'EXPIRED',
    invoice_reissued_as: null as string | null,
    period_closed: null as string | null,
    expires_at: '2026-09-01T09:00:00.000Z' as string | null,
    revenue_item: 'Market stall levy',
    revenue_item_ha: null,
    revenue_category: 'Market and trade levies',
    revenue_category_ha: null,
    first_name: 'Ladi',
    last_name: 'Dung',
    business_name: null,
    tin: null,
    preferred_language: 'en',
    payment_id: null,
    payment_status: null,
    payment_reference: null,
    gateway_reference: null,
    failure_reason: null,
    receipt_id: null,
    receipt_number: null,
    receipt_code: null,
    document_id: null,
    acknowledgement_id: null,
    acknowledgement_number: null,
    acknowledgement_code: null,
  };

  function show(overrides: Partial<typeof TRANSACTION>) {
    vi.spyOn(api, 'get').mockImplementation(
      async () =>
        ({
          transaction: { ...TRANSACTION, ...overrides },
          events: [{ to_status: 'EXPIRED', reason: null, created_at: '2026-09-01T10:00:00Z' }],
        }) as never,
    );
    render(<TransactionScreen reference="TXN-2026-000182" navigate={(path) => navigated.push(path)} />);
  }

  it('says the bill has lapsed and issues it again', async () => {
    show({});
    await screen.findByText(/This bill has lapsed/i);
    expect(screen.queryByRole('button', { name: /Start the payment/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Issue this bill again/i }));
    await waitFor(() => expect(navigated).toEqual(['/transactions/TXN-2026-000999']));
    expect(posted).toEqual(['/revenue/invoices/inv-1/reissue']);
  });

  it('counts a bill as lapsed from its deadline, before the sweep has run', async () => {
    show({ status: 'INVOICE_GENERATED', invoice_status: 'UNPAID' });
    await screen.findByText(/This bill has lapsed/i);
    expect(screen.queryByRole('button', { name: /Start the payment/i })).toBeNull();
  });

  it('opens the bill that replaced one already issued again', async () => {
    show({ status: 'EXPIRED', invoice_status: 'CANCELLED', invoice_reissued_as: 'inv-2' });
    await screen.findByText(/This bill was issued again/i);
    expect(screen.queryByRole('button', { name: /Issue this bill again/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open the new bill/i }));
    await waitFor(() => expect(navigated).toEqual(['/transactions/TXN-2026-000999']));
  });

  it('says the month a bill was raised in has been closed, and issues it again', async () => {
    show({
      status: 'INVOICE_GENERATED',
      invoice_status: 'UNPAID',
      expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      period_closed: 'August 2026',
    });
    await screen.findByText(/This bill’s month has been closed/i);
    expect(screen.queryByText(/This bill has lapsed/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Start the payment/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Issue this bill again/i }));
    await waitFor(() => expect(navigated).toEqual(['/transactions/TXN-2026-000999']));
  });

  it('leaves a bill still in date to be paid', async () => {
    show({
      status: 'INVOICE_GENERATED',
      invoice_status: 'UNPAID',
      expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    await screen.findByRole('button', { name: /Start the payment/i });
    expect(screen.queryByText(/This bill has lapsed/i)).toBeNull();
  });
});
