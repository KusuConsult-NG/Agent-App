/**
 * The four things that can have happened to a payment, said in the market.
 *
 * An agent presses "confirm" with the person who just handed over money
 * standing in front of them. Four answers come back and they are not
 * interchangeable: a receipt was issued, the gateway confirmed it but the
 * money has not reached a government account yet, the gateway has not
 * answered, or it failed and no money was received at all.
 *
 * All four arrived as the API's English — including "The payment did not
 * succeed. No money has been received and no receipt has been issued." An
 * agent who cannot read that sentence cannot tell the person in front of them
 * what happened to their money, and the two outcomes they would most likely
 * confuse are the two that differ by whether the citizen has paid.
 *
 * The status and the receipt number are on the response. They are what
 * actually distinguish the four, and they read the same in either language.
 */

import { describe, it, expect } from 'vitest';
import { translations } from '@psirs/shared';
import { paymentOutcomeText } from '../screens/Collect';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

/*
 * The screen's own branch, imported rather than repeated.
 *
 * The first version of this file copied the four-way decision into the test.
 * That decides nothing about the screen — `Collect` could stop calling it and
 * every assertion here would stay green. Exported from the screen instead, so
 * there is one rule and this file reads it.
 */
function saidTo(
  t: Record<string, string>,
  result: { status: string; receiptNumber?: string },
): string {
  return paymentOutcomeText(t as never, result);
}

describe('what happened to the money', () => {
  it('tells them apart, and none of the four repeats another', () => {
    const outcomes = [
      { status: 'VERIFIED', receiptNumber: 'PSIRS/2026/000123' },
      { status: 'VERIFIED' },
      { status: 'PENDING' },
      { status: 'FAILED' },
    ];
    const said = outcomes.map((outcome) => saidTo(ha, outcome));
    expect(new Set(said).size).toBe(4);
  });

  it('carries the receipt number a citizen is given to trace the payment', () => {
    expect(saidTo(ha, { status: 'VERIFIED', receiptNumber: 'PSIRS/2026/000123' })).toContain(
      'PSIRS/2026/000123',
    );
  });

  /**
   * The two that must never be confused.
   *
   * "Confirmed, receipt to follow" and "it failed, no money was received" are
   * opposite answers to the only question the citizen is asking. Each has to
   * carry the negative or the positive that distinguishes it.
   */
  it('does not let a failure read like a success', () => {
    // The failure says no money arrived, in both languages.
    expect(en.colPayFailed).toMatch(/\bno money\b/i);
    expect(ha.colPayFailed).toMatch(/\b(ba|babu)\b/i);
    // The confirmation-without-receipt says the money is confirmed, and does
    // not claim a receipt exists.
    expect(en.colPayAwaitingSettlement).not.toMatch(/receipt has been issued/i);
    expect(ha.colPayAwaitingSettlement).not.toBe(ha.colPayFailed);
  });

  /**
   * "Do not take this payment again" is the instruction, not the news.
   *
   * A pending gateway answer is the case where an agent's instinct — collect
   * it again — takes the money twice from somebody who has already paid.
   */
  it('tells the agent not to collect again while the gateway is silent', () => {
    expect(en.colPayStillPending).toMatch(/\bnot\b/i);
    expect(ha.colPayStillPending).toMatch(/\bkada\b/i);
  });

  it('has real Hausa for all four, with the placeholder intact', () => {
    for (const key of [
      'colPayReceipted',
      'colPayAwaitingSettlement',
      'colPayStillPending',
      'colPayFailed',
    ] as const) {
      expect(ha[key], `${key} has no Hausa`).toBeTruthy();
      expect(ha[key], `${key} was never translated`).not.toBe(en[key]);
      for (const token of en[key].match(/\{\{\w+\}\}/g) ?? []) {
        expect(ha[key], `${key} lost ${token}`).toContain(token);
      }
    }
  });
});
