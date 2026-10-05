/**
 * An invoice on the public verification page.
 *
 * Every invoice read "a genuine government document" with its number labelled
 * "Receipt number" under a green tick — so an unpaid bill, or one replaced or
 * withdrawn, read as proof of payment. The server now answers an invoice by
 * the bill (see the API test of the same subject); this page has to say that
 * answer and not call the number a receipt's.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VerifyScreen } from '../screens/Public';
import * as apiModule from '../lib/api';

const answer = (over: Record<string, unknown>) =>
  vi.spyOn(apiModule.api, 'publicGet').mockResolvedValue({
    documentNumber: 'INV/2026/000777',
    documentType: 'INVOICE',
    revenueType: 'Shops and Kiosks Rates',
    revenueTypeHa: null,
    amountKobo: '300000',
    issuedAt: '2026-09-01T09:00:00.000Z',
    ...over,
  } as never);

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('an invoice checked before paying it', () => {
  it('says a lapsed bill cannot be paid as it stands, and does not call its number a receipt', async () => {
    answer({ status: 'INVALID', reason: 'INVOICE_LAPSED', message: 'x' });
    render(<VerifyScreen code="ABCD-EFGH" />);
    expect(await screen.findByText(/can issue it again for the same amount/i)).toBeTruthy();
    expect(screen.getByText(/^Document number$/)).toBeTruthy();
    expect(screen.queryByText(/^Receipt number$/)).toBeNull();
  });

  it('says a replaced bill is to be paid as the new invoice', async () => {
    answer({ status: 'INVALID', reason: 'INVOICE_REPLACED', message: 'x' });
    render(<VerifyScreen code="ABCD-EFGH" />);
    expect(await screen.findByText(/Pay against the new invoice/i)).toBeTruthy();
  });

  it('says a payable bill is genuine and can still be paid', async () => {
    answer({ status: 'VALID', reason: 'INVOICE_PAYABLE', message: 'x' });
    render(<VerifyScreen code="ABCD-EFGH" />);
    expect(await screen.findByText(/genuine PSIRS invoice, and it can still be paid/i)).toBeTruthy();
    expect(screen.queryByText(/^Receipt number$/)).toBeNull();
    // The mark carries it too: a demand, not proof of payment.
    expect(screen.getByText(/AN INVOICE, NOT A RECEIPT/)).toBeTruthy();
  });

  it('still calls a receipt’s number a receipt number', async () => {
    vi.spyOn(apiModule.api, 'publicGet').mockResolvedValue({
      status: 'VALID',
      receiptNumber: 'PSIRS/2026/000001',
      revenueType: 'Development Levy',
      amountKobo: '200000',
      issuedAt: '2026-08-18T12:00:00.000Z',
      reason: 'RECEIPT_GENUINE',
      message: 'x',
    } as never);
    render(<VerifyScreen code="PSIRS/2026/000001" />);
    expect(await screen.findByText(/^Receipt number$/)).toBeTruthy();
  });
});
