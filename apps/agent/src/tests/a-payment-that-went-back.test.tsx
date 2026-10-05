/**
 * A payment whose money went back, shown as a payment that succeeded.
 *
 * A reversal keeps the receipt row and marks it REVERSED, and the transaction
 * screen took any receipt number to mean paid. Measured: a settled payment,
 * reversed because the payer's bank recalled it, read "Payment successful"
 * with its receipt offered for download and sharing — over a bill owed again.
 * An agent shown that tells the trader they are settled.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransactionScreen } from '../screens/Collect';
import { api } from '../lib/api';

const REVERSED = {
  id: 'txn-5',
  transaction_reference: 'TXN-2026-000555',
  status: 'REVERSED',
  amount_kobo: '300000',
  service_charge_kobo: '0',
  total_amount_kobo: '300000',
  invoice_id: 'inv-5',
  invoice_number: 'INV-2026-000555',
  invoice_status: 'UNPAID',
  invoice_reissued_as: null as string | null,
  expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString() as string | null,
  revenue_item: 'Shops and Kiosks Rates',
  revenue_item_ha: null,
  revenue_category: 'Local Government Rates',
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
  receipt_id: 'rcp-5',
  receipt_number: 'PSIRS/2026/003902',
  receipt_code: 'RC-5',
  receipt_status: 'REVERSED' as string | null,
  document_id: 'doc-5',
  acknowledgement_id: null,
  acknowledgement_number: null,
  acknowledgement_code: null,
};

const navigated: string[] = [];
const posted: string[] = [];

beforeEach(() => {
  cleanup();
  navigated.length = 0;
  posted.length = 0;
  vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
    posted.push(path);
    return { transactionReference: 'TXN-2026-000556', reissued: true } as never;
  });
});
afterEach(() => vi.restoreAllMocks());

function show(overrides: Partial<typeof REVERSED>) {
  vi.spyOn(api, 'get').mockImplementation(
    async () =>
      ({
        transaction: { ...REVERSED, ...overrides },
        events: [{ to_status: overrides.status ?? 'REVERSED', reason: null, created_at: '2026-10-01T10:00:00Z' }],
      }) as never,
  );
  render(<TransactionScreen reference="TXN-2026-000555" navigate={(path) => navigated.push(path)} />);
}

describe('a reversed payment', () => {
  it('is not shown as a payment that succeeded, and offers no receipt to hand over', async () => {
    show({});
    await screen.findByText(/This payment was reversed/i);
    expect(screen.queryByText(/Payment successful/i)).toBeNull();
    expect(screen.queryByText(/Download receipt|Share receipt/i)).toBeNull();
  });

  it('says the bill is owed again, and issues it again', async () => {
    show({});
    await screen.findByText(/owed again/i);
    fireEvent.click(screen.getByRole('button', { name: /Issue this bill again/i }));
    await waitFor(() => expect(navigated).toEqual(['/transactions/TXN-2026-000556']));
    expect(posted).toEqual(['/revenue/invoices/inv-5/reissue']);
  });

  it('says nothing is owed when the State withdrew the bill', async () => {
    show({ invoice_status: 'CANCELLED' });
    await screen.findByText(/Nothing is owed on it/i);
    expect(screen.queryByRole('button', { name: /Issue this bill again/i })).toBeNull();
  });

  it('still reads a receipt that stands as paid', async () => {
    show({ status: 'SETTLED', receipt_status: 'VALID', invoice_status: 'PAID' });
    await screen.findByText(/Payment successful/i);
    expect(screen.queryByText(/This payment was reversed/i)).toBeNull();
  });
});
