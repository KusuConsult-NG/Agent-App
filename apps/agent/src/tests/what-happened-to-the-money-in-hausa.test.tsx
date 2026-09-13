/**
 * The sentences an agent must not misread, in the language they read.
 *
 * The agent application has carried Hausa since it was built. Every error the
 * API returns arrives in English and is rendered verbatim, including the three
 * that decide whether a citizen is asked to pay a second time:
 *
 *   PAYMENT_UNCONFIRMED             the money has NOT been marked received
 *   PAYMENT_PENDING_RECONCILIATION  it has been received; do not collect again
 *   PAYMENT_FAILED                  it did not go through; nothing was taken
 *
 * And beneath every one of them `ErrorAlert` printed a hardcoded English money
 * line — "The payment has NOT been confirmed. Do not collect again." — which is
 * the single most consequential sentence in the application and was reachable
 * by no dictionary and no review.
 *
 * An agent who cannot read it does one of two things: collects again from
 * somebody who has already paid, or walks away from money the State is owed.
 * The first is the one that ends up in a newspaper.
 *
 * WHAT IS NOT TRANSLATED, AND WHY. Only codes with a fixed meaning get a Hausa
 * rendering. A validation message names a field and is generated server-side
 * from the schema; inventing a Hausa sentence for a message we have not seen
 * would be worse than showing the English one. So the fallback is the server's
 * own text, and the money line — which has only three possible values — is
 * always in the agent's language.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ErrorAlert } from '../ui';
import { setAppLanguage } from '../lib/i18n';

function inHausa(ui: React.ReactElement) {
  setAppLanguage('ha');
  return render(ui);
}

beforeEach(() => {
  cleanup();
  setAppLanguage('en');
});
afterEach(() => {
  setAppLanguage('en');
});

const ha = translations.ha as unknown as Record<string, string>;

describe('what happened to the money', () => {
  it('says the payment is unconfirmed in Hausa, not in English', () => {
    inHausa(
      <ErrorAlert
        error={{
          code: 'PAYMENT_UNCONFIRMED',
          message: 'Payment could not be confirmed yet.',
          moneyStatus: 'UNCONFIRMED',
        }}
      />,
    );
    expect(screen.getByText(ha.moneyUnconfirmed)).toBeTruthy();
    expect(screen.queryByText(/Do not collect again/)).toBeNull();
  });

  it('says no money was taken in Hausa', () => {
    inHausa(
      <ErrorAlert
        error={{ code: 'PAYMENT_FAILED', message: 'The payment did not go through.', moneyStatus: 'NOT_DEBITED' }}
      />,
    );
    expect(screen.getByText(ha.moneyNotDebited)).toBeTruthy();
  });

  it('says the money has been received in Hausa', () => {
    inHausa(
      <ErrorAlert
        error={{
          code: 'PAYMENT_PENDING_RECONCILIATION',
          message: 'Payment received but reconciliation is pending.',
          moneyStatus: 'RECEIVED',
        }}
      />,
    );
    expect(screen.getByText(ha.moneyReceived)).toBeTruthy();
  });

  it('renders the whole message in Hausa for a code with a fixed meaning', () => {
    inHausa(
      <ErrorAlert
        error={{
          code: 'PAYMENT_UNCONFIRMED',
          message: 'Payment could not be confirmed yet. The money has NOT been marked as received.',
          moneyStatus: 'UNCONFIRMED',
        }}
      />,
    );
    expect(screen.getByText(ha.errPaymentUnconfirmed)).toBeTruthy();
  });

  it('keeps the negation, which is the whole content of the sentence', () => {
    // The review sheet calls a dropped negative the worst failure available,
    // and these are the strings it had in mind.
    for (const key of ['moneyUnconfirmed', 'errPaymentUnconfirmed', 'errPaymentFailed']) {
      expect(ha[key], key).toMatch(/\b(ba|bai|babu|kada)\b/);
    }
  });
});

describe('an error with no fixed meaning', () => {
  it('shows what the server said rather than inventing Hausa for it', () => {
    /*
     * A validation message names a field and is generated from the schema. A
     * Hausa sentence guessed for a message we have not seen would be worse
     * than the English one, because the agent cannot tell that it is a guess.
     */
    inHausa(
      <ErrorAlert
        error={{
          code: 'VALIDATION_FAILED',
          message: 'Some of the information supplied is not valid.',
          moneyStatus: 'NOT_APPLICABLE',
        }}
      />,
    );
    expect(screen.getByText('Some of the information supplied is not valid.')).toBeTruthy();
  });

  it('still translates the money line, because that has only three values', () => {
    inHausa(
      <ErrorAlert
        error={{ code: 'INVALID_REQUEST', message: 'Something the schema refused.', moneyStatus: 'NOT_DEBITED' }}
      />,
    );
    expect(screen.getByText(ha.moneyNotDebited)).toBeTruthy();
  });
});

describe('an agent working in English', () => {
  it('is unchanged', () => {
    render(
      <ErrorAlert
        error={{
          code: 'PAYMENT_UNCONFIRMED',
          message: 'Payment could not be confirmed yet.',
          moneyStatus: 'UNCONFIRMED',
        }}
      />,
    );
    expect(screen.getByText(/NOT been confirmed/i)).toBeTruthy();
  });
});
