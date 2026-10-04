/**
 * "You can start the payment again", over a screen with no way to.
 *
 * When a payment attempt ends without money — a declined card, a USSD session
 * the citizen walked away from — the transaction screen shows the failure and
 * says, in the agent's language, "No money has been taken from the taxpayer.
 * You can start the payment again." The actions beneath were hidden for every
 * failed state alike, so the sentence named a button that was not drawn. The
 * server refused the attempt anyway, so drawing it would only have moved the
 * dead end. Both now agree: a failed attempt on a bill still in date can be
 * followed by another, and a bill that has ended — withdrawn, or past its
 * deadline — offers nothing.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransactionScreen } from '../screens/Collect';
import { api } from '../lib/api';

const REFERENCE = 'TXN-2026-000321';

const TRANSACTION = {
  id: 'tx-321',
  transaction_reference: REFERENCE,
  status: 'FAILED',
  amount_kobo: '300000',
  service_charge_kobo: '0',
  total_amount_kobo: '300000',
  invoice_id: 'inv-321',
  invoice_number: 'INV/2026/000321',
  invoice_status: 'UNPAID',
  expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString() as string | null,
  revenue_item: 'Shops and Kiosks Rates',
  revenue_item_ha: null,
  revenue_category: 'Local Government Rates',
  revenue_category_ha: null,
  first_name: 'Asabe',
  last_name: 'Gyang',
  business_name: null,
  tin: null,
  preferred_language: 'en',
  // The server joins only an attempt in flight, so a failed one leaves these empty.
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

const posted: string[] = [];

function show(overrides: Partial<typeof TRANSACTION>) {
  vi.spyOn(api, 'get').mockImplementation(
    async () =>
      ({
        transaction: { ...TRANSACTION, ...overrides },
        events: [{ to_status: overrides.status ?? 'FAILED', reason: null, created_at: '2026-10-01T09:00:00Z' }],
      }) as never,
  );
  vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
    posted.push(path);
    return { authorisationUrl: 'https://pay.example/x' } as never;
  });
  render(<TransactionScreen reference={REFERENCE} navigate={() => {}} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  posted.length = 0;
});

describe('a payment attempt that did not go through', () => {
  it('says so, and offers the attempt it says can be made', async () => {
    show({});
    expect(await screen.findByText(/You can start the payment again/i)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /Start the payment/i }));
    await waitFor(() => expect(posted).toContain('/payments/initiate'));
  });

  it('offers nothing once the bill is past its deadline, and does not promise it', async () => {
    show({ expires_at: new Date(Date.now() - 3_600_000).toISOString() });
    await screen.findByText(/This bill can no longer be paid/i);
    expect(screen.queryByText(/You can start the payment again/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Start the payment/i })).toBeNull();
  });

  it('offers nothing on a bill that is no longer owed', async () => {
    show({ invoice_status: 'CANCELLED' });
    await screen.findByText(/This bill can no longer be paid/i);
    expect(screen.queryByRole('button', { name: /Start the payment/i })).toBeNull();
  });
});

describe('a bill that has ended', () => {
  for (const status of ['CANCELLED', 'EXPIRED']) {
    it(`offers no payment on a ${status.toLowerCase()} transaction, and does not promise one`, async () => {
      show({ status });
      await screen.findByText(/This bill can no longer be paid/i);
      expect(screen.queryByText(/You can start the payment again/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Start the payment/i })).toBeNull();
    });
  }
});
