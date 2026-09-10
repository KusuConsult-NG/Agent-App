/**
 * The answer to "is this real, and does the State have my money".
 *
 * It is the shortest exchange the platform has with the public and the one
 * where being wrong costs most: somebody types a number off a piece of paper
 * and is told what it is. There are thirteen answers, and the differences
 * between them are the entire point — a genuine receipt and a genuine
 * *acknowledgement* look alike on paper and mean opposite things about
 * whether the government has been paid.
 *
 * All thirteen were composed in `apps/api` as English sentences and rendered
 * as they arrived, on two screens that both offer Hausa: the agent's verify
 * screen, where an agent reads the answer out to the person in front of them,
 * and the public portal, where a citizen checks their own receipt. The
 * verdict above the sentence — VALID, NOT FOUND — had been translated. The
 * sentence saying what that means had not.
 *
 * Two of the thirteen are why this sits in the safety tier:
 * `ACKNOWLEDGEMENT_NOT_RECEIPT` says the money has *not* reached the
 * government yet, and `PAYMENT_REVERSED` says it is on its way back. Both
 * appear under a green tick, and both mean the opposite of what a green tick
 * on its own suggests.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { VERIFICATION_REASONS, VERIFICATION_TEXT, translations } from '@psirs/shared';
import { VerifyScreen } from '../screens/Verify';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

function answered(reason: string, extra: Record<string, unknown> = {}) {
  vi.spyOn(api, 'get').mockResolvedValue({
    status: reason.includes('GENUINE') || reason === 'ACKNOWLEDGEMENT_NOT_RECEIPT' ? 'VALID' : 'INVALID',
    reason,
    message: `English for ${reason}`,
    receiptNumber: 'PSIRS/2026/000182',
    ...extra,
  } as never);
}

async function verify(code = 'T7C72-QTUDN') {
  render(<VerifyScreen connection="ONLINE" />);
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(screen.getByLabelText(ha.verifyTypeCode!, { exact: false }), {
    target: { value: code },
  });
  // The button is `type="submit"`; firing the form directly is what actually
  // runs the handler under jsdom.
  fireEvent.submit(screen.getByRole('button', { name: ha.verifyCheckThisCode! }).closest('form')!);
}

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
  vi.restoreAllMocks();
});

afterEach(() => setAppLanguage('en'));

describe('the verification answer', () => {
  /*
   * The one that matters most. A green tick over "this is an acknowledgement,
   * NOT a receipt — the money has not reached the government account yet".
   */
  it('distinguishes an acknowledgement from a receipt, in Hausa', async () => {
    answered('ACKNOWLEDGEMENT_NOT_RECEIPT');
    await verify();

    await waitFor(() =>
      expect(screen.getByText(ha.verifyAcknowledgementNotReceipt!)).toBeTruthy(),
    );
    expect(document.body.textContent).not.toContain('English for');
    expect(document.body.textContent).not.toContain(en.verifyAcknowledgementNotReceipt!);
  });

  it('says the money is going back when the payment was reversed', async () => {
    answered('PAYMENT_REVERSED');
    await verify();

    await waitFor(() => expect(screen.getByText(ha.verifyPaymentReversed!)).toBeTruthy());
  });

  it('says a receipt nobody issued was not issued by PSIRS', async () => {
    answered('NOT_FOUND');
    await verify();

    await waitFor(() => expect(screen.getByText(ha.verifyNotFound!)).toBeTruthy());
  });

  it('fills the date in on an expired document', async () => {
    answered('DOCUMENT_EXPIRED', { expiresAt: '2026-03-31T00:00:00.000Z' });
    await verify();

    await waitFor(() => expect(screen.getByText(/2026/)).toBeTruthy());
    // The placeholder itself must never reach a reader.
    expect(document.body.textContent).not.toContain('{{date}}');
  });

  /*
   * Every answer, not just the four above. A code with no string would render
   * `undefined` to somebody asking whether their money arrived.
   */
  it('has a Hausa sentence for all thirteen answers', () => {
    expect(VERIFICATION_REASONS.length).toBe(13);
    for (const reason of VERIFICATION_REASONS) {
      const key = VERIFICATION_TEXT[reason];
      expect(key, `${reason} has no dictionary key`).toBeTruthy();
      for (const lang of ['en', 'ha'] as const) {
        const text = (translations[lang] as unknown as Record<string, string>)[key];
        expect(typeof text, `${reason} has no ${lang} string`).toBe('string');
        expect(text.trim().length, `${reason} is empty in ${lang}`).toBeGreaterThan(0);
      }
    }
  });
});
