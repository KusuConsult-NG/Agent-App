/**
 * "Receipt details copied" — when nothing was copied.
 *
 * On a handset with no share sheet, the Share receipt button wrote the receipt
 * text to the clipboard and then said so:
 *
 *     await navigator.clipboard.writeText(text).catch(() => undefined);
 *     setNotice(t.colReceiptCopied);
 *
 * The `catch` discards the one fact the sentence depends on. `writeText` is
 * refused on an insecure origin, refused without clipboard permission, and
 * refused on some handsets once the click's user gesture has been awaited
 * away — all of which reach that `catch`, after which the screen says
 * "Receipt details copied. You can paste them into a message."
 *
 * So the agent opens WhatsApp and pastes whatever was on the clipboard
 * before. What does not go to the citizen is the receipt number and the
 * verification code — the only things that let anyone check later that the
 * money was paid. The citizen has handed over cash and has nothing.
 *
 * The recovery is the text itself. A refused copy now puts it on the screen
 * to be read out or typed, which is what an agent does anyway when the phone
 * in their hand is not the phone they are sending from.
 *
 * Dismissing the share sheet is the other half, and it is NOT a failure: it
 * arrives as an AbortError because the agent changed their mind, and the
 * screen must stay quiet about it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TransactionScreen } from '../screens/Collect';
import { api } from '../lib/api';

const REFERENCE = 'PSIRS-TX-2026-000144';

/** A transaction that has been paid, which is the only state that can share. */
const PAID = {
  id: 'tx-1',
  transaction_reference: REFERENCE,
  status: 'PAID',
  amount_kobo: '4500000',
  total_amount_kobo: '4500000',
  invoice_id: 'inv-1',
  invoice_number: 'INV-000144',
  expires_at: null,
  revenue_item: 'Direct Assessment / Self-Assessment',
  revenue_item_ha: null,
  revenue_category: 'Personal Income Tax',
  revenue_category_ha: null,
  first_name: 'Ladi',
  last_name: 'Dung',
  business_name: null,
  tin: 'P-0000001',
  preferred_language: 'en',
  payment_id: 'pay-1',
  payment_status: 'SUCCESS',
  payment_reference: 'PSIRS-PAY-1',
  gateway_reference: 'RMT-1',
  failure_reason: null,
  receipt_id: 'rcp-1',
  receipt_number: 'PSIRS/2026/000144',
  receipt_code: 'X7K2M9',
  document_id: 'doc-1',
  acknowledgement_id: null,
  acknowledgement_number: null,
  acknowledgement_code: null,
};

/** The original `navigator` members, restored between tests. */
const original = {
  share: (navigator as { share?: unknown }).share,
  clipboard: navigator.clipboard,
};

function setNavigator(parts: { share?: unknown; writeText?: () => Promise<void> }) {
  Object.defineProperty(navigator, 'share', {
    value: parts.share,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'clipboard', {
    value: parts.writeText ? { writeText: parts.writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  cleanup();
  vi.spyOn(api, 'get').mockImplementation(
    async () =>
      ({
        transaction: PAID,
        events: [{ to_status: 'PAID', reason: null, created_at: '2026-09-10T09:00:00Z' }],
      }) as never,
  );
});

afterEach(() => {
  setNavigator({ share: original.share, writeText: undefined });
  Object.defineProperty(navigator, 'clipboard', {
    value: original.clipboard,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});

async function pressShare() {
  render(<TransactionScreen reference={REFERENCE} navigate={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Share receipt/i }));
}

describe('sharing a receipt the handset will not copy', () => {
  it('does not say it was copied', async () => {
    setNavigator({ writeText: () => Promise.reject(new Error('Write permission denied.')) });

    await pressShare();

    await waitFor(() =>
      expect(screen.getByText(/The phone would not copy it/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Receipt details copied/i)).toBeNull();
  });

  it('puts the receipt number and the code on the screen to be read out', async () => {
    /*
     * The recovery has to carry both. The number identifies the receipt and
     * the code is what verification asks for; either one alone leaves the
     * citizen unable to prove anything.
     */
    setNavigator({ writeText: () => Promise.reject(new Error('Write permission denied.')) });

    await pressShare();

    await waitFor(() => expect(screen.getByText(/PSIRS\/2026\/000144/)).toBeTruthy());
    expect(screen.getByText(/X7K2M9/)).toBeTruthy();
  });

  it('says it was copied when it really was', async () => {
    // The control: the path that always worked must go on working.
    const writeText = vi.fn(() => Promise.resolve());
    setNavigator({ writeText });

    await pressShare();

    await waitFor(() => expect(screen.getByText(/Receipt details copied/i)).toBeTruthy());
    expect(writeText).toHaveBeenCalledOnce();
    expect(screen.queryByText(/The phone would not copy it/i)).toBeNull();
  });

  it('says nothing when the agent closes the share sheet themselves', async () => {
    /*
     * An AbortError is the agent deciding not to send it. Reporting that as a
     * problem would train them to ignore the one message that matters.
     */
    const abort = Object.assign(new Error('Share canceled'), { name: 'AbortError' });
    setNavigator({
      share: vi.fn(() => Promise.reject(abort)),
      writeText: vi.fn(() => Promise.resolve()),
    });

    await pressShare();

    await waitFor(() => expect(screen.queryByText(/The phone would not copy it/i)).toBeNull());
    expect(screen.queryByText(/Receipt details copied/i)).toBeNull();
  });

  it('falls back to the clipboard when the share sheet itself fails', async () => {
    /*
     * Not an AbortError: the sheet was asked and could not carry it. The
     * clipboard is the route a handset without `share` takes anyway, so try
     * it rather than leaving the agent with nothing.
     */
    const writeText = vi.fn(() => Promise.resolve());
    setNavigator({
      share: vi.fn(() => Promise.reject(new Error('Share target unavailable'))),
      writeText,
    });

    await pressShare();

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(screen.getByText(/Receipt details copied/i)).toBeTruthy();
  });
});
