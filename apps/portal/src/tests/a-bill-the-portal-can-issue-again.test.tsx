/**
 * An invoice that can no longer be paid, and the one thing to do about it.
 *
 * The invoice screen warned that a lapsed bill would be refused and said that
 * collecting meant "raising a fresh assessment first" — which officers cannot
 * do, and which would have billed the taxpayer a second time beside the first.
 * A bill owed again after a reversal by the taxpayer's bank was not marked at
 * all: it read as an ordinary unpaid invoice, with a transaction that could
 * never take a payment.
 *
 * Both can now be issued again (`POST /revenue/invoices/:id/reissue`), by an
 * officer holding `invoice:create`, and the screen offers that where — and
 * only where — the server will do it. A bill that was issued again says what
 * replaced it and opens the replacement, which is the one the money is taken
 * against.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvoiceScreen } from '../screens/Charge';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const FUTURE = new Date(Date.now() + 20 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

const INVOICE = {
  id: 'inv-7',
  invoice_number: 'INV/2026/000777',
  assessment_id: 'asm-7',
  amount_kobo: '300000',
  service_charge_kobo: '0',
  total_amount_kobo: '300000',
  amount_paid_kobo: '0',
  verification_code: 'PL-7Q2K9M',
  issued_at: '2026-09-01T09:00:00.000Z',
  expires_at: FUTURE as string | null,
  status: 'UNPAID',
  assessment_number: 'ASM/2026/000776',
  period_label: null,
  computation_trace: [],
  revenue_item: 'Shops and Kiosks Rates',
  revenue_item_ha: null,
  revenue_category: 'Local Government Rates',
  revenue_category_ha: null,
  transaction_reference: 'TXN-2026-000777',
  transaction_status: 'INVOICE_GENERATED' as string | null,
  reissued_as: null as string | null,
  reissued_as_number: null as string | null,
  period_closed: null as string | null,
};

let invoice: typeof INVOICE;
let mayIssue = true;
const navigated: string[] = [];
const posted: string[] = [];
let postAnswer: () => Promise<unknown>;

beforeEach(() => {
  cleanup();
  invoice = { ...INVOICE };
  mayIssue = true;
  navigated.length = 0;
  posted.length = 0;
  postAnswer = async () => ({ invoiceId: 'inv-8', reissued: true });
  vi.spyOn(apiModule, 'can').mockImplementation((permission: string) =>
    permission === 'invoice:create' ? mayIssue : true,
  );
  vi.spyOn(apiModule.api, 'get').mockImplementation(async () => invoice as never);
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string) => {
    posted.push(path);
    return (await postAnswer()) as never;
  });
});

afterEach(() => vi.restoreAllMocks());

const open = () => render(<InvoiceScreen id="inv-7" navigate={(path) => navigated.push(path)} />);
const reissueButton = () => screen.queryByRole('button', { name: /Issue this invoice again/i });

describe('a lapsed invoice', () => {
  it('is issued again, and the officer is taken to the bill that replaces it', async () => {
    invoice = { ...INVOICE, status: 'EXPIRED', expires_at: PAST, transaction_status: 'EXPIRED' };
    open();

    await screen.findByText(/has to be issued again/i);
    fireEvent.click(reissueButton()!);

    await waitFor(() => expect(navigated).toEqual(['/invoice/inv-8']));
    expect(posted).toEqual(['/revenue/invoices/inv-7/reissue']);
  });

  it('is treated as lapsed from its deadline, before the sweep has written EXPIRED', async () => {
    invoice = { ...INVOICE, status: 'UNPAID', expires_at: PAST };
    open();

    await screen.findByText(/deadline has passed/i);
    expect(reissueButton()).toBeTruthy();
  });

  it('is not offered to an officer who cannot issue bills', async () => {
    mayIssue = false;
    invoice = { ...INVOICE, status: 'EXPIRED', expires_at: PAST };
    open();

    await screen.findByText(/deadline has passed/i);
    expect(reissueButton()).toBeNull();
  });

  it('says why the server refused, rather than nothing', async () => {
    invoice = { ...INVOICE, status: 'EXPIRED', expires_at: PAST, transaction_status: 'PAYMENT_PENDING' };
    postAnswer = () =>
      Promise.reject(
        new ApiRequestError(409, {
          code: 'INVOICE_PAYMENT_IN_PROGRESS',
          message: 'A payment against invoice INV/2026/000777 is still being processed.',
          moneyStatus: 'NOT_APPLICABLE',
        }),
      );
    open();

    fireEvent.click((await screen.findByRole('button', { name: /Issue this invoice again/i })));
    expect(await screen.findByText(/still being processed/i)).toBeTruthy();
    expect(navigated).toEqual([]);
  });
});

describe('an invoice owed again after a reversal', () => {
  it('is marked as unpayable and can be issued again', async () => {
    invoice = { ...INVOICE, status: 'UNPAID', transaction_status: 'REVERSED' };
    open();

    expect(await screen.findByText(/Owed again after a reversal/i)).toBeTruthy();
    expect(reissueButton()).toBeTruthy();
  });
});

describe('an invoice raised in a month that has been closed', () => {
  it('says why it cannot be paid as it stands, and can be issued again', async () => {
    // In date, but paying it would add to a month whose figures have been
    // signed off; the payment path refuses it with INVOICE_PERIOD_CLOSED.
    invoice = { ...INVOICE, period_closed: '2026-08' };
    open();
    await screen.findByText(/Raised in a month that has been closed/i);
    expect(screen.getByText(/2026-08 has been closed/)).toBeTruthy();
    fireEvent.click(reissueButton()!);
    await waitFor(() => expect(posted).toEqual(['/revenue/invoices/inv-7/reissue']));
  });
});

describe('an invoice that can still be paid', () => {
  it('offers nothing to issue', async () => {
    open();
    await screen.findByText('INV/2026/000777');
    expect(reissueButton()).toBeNull();
    expect(screen.queryByText(/deadline has passed/i)).toBeNull();
  });
});

describe('an invoice that was issued again', () => {
  it('names its replacement and opens it, and is not issued a second time', async () => {
    invoice = {
      ...INVOICE,
      status: 'CANCELLED',
      expires_at: PAST,
      reissued_as: 'inv-8',
      reissued_as_number: 'INV/2026/000801',
    };
    open();

    expect(await screen.findByText(/replaced by INV\/2026\/000801/i)).toBeTruthy();
    expect(reissueButton()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open INV\/2026\/000801/i }));
    expect(navigated).toEqual(['/invoice/inv-8']);
  });
});
