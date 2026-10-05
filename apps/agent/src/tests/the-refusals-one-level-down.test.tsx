/**
 * The six refusals on the collect path that reading one function missed.
 *
 * `collecting-in-hausa.test.tsx` covers the six `createAssessmentIn` raises.
 * These are the six raised by the code it calls, and by the request the same
 * screen makes one tap later:
 *
 *   NO_EFFECTIVE_RATE comes from `resolveRate`, one level below
 *   `createAssessmentIn` and also below `quote`. It fires when government has
 *   ended a rate version without publishing a successor.
 *
 *   The other five come from `initiatePayment`. The sentence that decides
 *   whether a citizen is asked to pay twice was already in Hausa — `ErrorAlert`
 *   renders the money status from the dictionary, which is why it has only ever
 *   had three possible values — but the headline above it, which says *what*
 *   happened, was the server's English.
 *
 * TWO OF THEM NAME A STATE
 *
 * "This invoice is cancelled and can no longer be paid." The state is in the
 * prose, so a translation keyed on the code had nothing to put in the hole: the
 * choice was an English sentence or a Hausa one with a gap. `initiatePayment`
 * now sends the state as a detail with `code: 'STATE'`, and `errorText` puts it
 * through the dictionary — but only when the dictionary holds it, because
 * `enumLabel` always returns something and its fallback would damage a figure
 * or an unknown state rather than translate it.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ErrorAlert, errorText, nextStepText } from '../ui';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
});
afterEach(() => setAppLanguage('en'));

interface Detail {
  field?: string;
  issue: string;
  code?: string;
}

/** As the API raises it, English sentence and all. */
const refusal = (
  code: string,
  message: string,
  extra: { nextStep?: string; details?: Detail[]; moneyStatus?: string } = {},
) => ({
  code,
  message,
  moneyStatus: (extra.moneyStatus ?? 'NOT_APPLICABLE') as never,
  nextStep: extra.nextStep,
  details: extra.details,
});

describe('the refusals one level down', () => {
  /*
   * Named one at a time rather than looped, so a code that stops being
   * translated names itself in the failure instead of reporting "1 of 4". The
   * English is quoted as the services compose it.
   */
  const PLAIN: [string, string, string][] = [
    [
      'NO_EFFECTIVE_RATE',
      'This revenue item has no approved rate in force. It cannot be assessed until government sets one.',
      'errNoEffectiveRate',
    ],
    [
      'INVOICE_ALREADY_PAID',
      'This invoice has already been paid. Do not collect payment again.',
      'errInvoiceAlreadyPaid',
    ],
    [
      'PAYMENT_ALREADY_VERIFIED',
      'This transaction has already been paid and verified. Do not collect payment again.',
      'errPaymentAlreadyVerified',
    ],
    [
      'INVOICE_EXPIRED',
      'This invoice has expired. Raise a new assessment for the taxpayer.',
      'errInvoiceExpired',
    ],
  ];

  for (const [code, english, key] of PLAIN) {
    it(`says ${code} in Hausa`, () => {
      const text = errorText(refusal(code, english), translations.ha);
      expect(text).toBe(ha[key]);
      expect(text).not.toBe(english);
      // And the English build still says the English, so the key is a
      // translation rather than a replacement.
      expect(errorText(refusal(code, english), translations.en)).toBe(en[key]);
    });
  }

  it('says the next step in Hausa for the two that carry one', () => {
    expect(
      nextStepText(
        refusal('NO_EFFECTIVE_RATE', 'x', { nextStep: 'Contact PSIRS revenue configuration.' }),
        translations.ha,
      ),
    ).toBe(ha.nsNoEffectiveRate);
    expect(
      nextStepText(
        refusal('INVOICE_ALREADY_PAID', 'x', {
          nextStep: 'Open the receipt from the transaction history.',
        }),
        translations.ha,
      ),
    ).toBe(ha.nsInvoiceAlreadyPaid);
  });
});

describe('a refusal that names a state', () => {
  it('puts the state into the Hausa sentence, in Hausa', () => {
    const text = errorText(
      refusal(
        'INVOICE_NOT_PAYABLE',
        'This invoice is cancelled and can no longer be paid. Raise a new assessment.',
        { details: [{ field: 'state', issue: 'CANCELLED', code: 'STATE' }] },
      ),
      translations.ha,
    );
    expect(text).toBe(ha.errInvoiceNotPayable.replace('{{state}}', ha.enumCancelled));
    expect(text).not.toContain('{{state}}');
    expect(text).not.toContain('CANCELLED');
  });

  it('does the same for a transaction that cannot take a payment', () => {
    const text = errorText(
      refusal(
        'TRANSACTION_NOT_PAYABLE',
        'This transaction is in state ABANDONED and cannot accept a payment now.',
        { details: [{ field: 'state', issue: 'ABANDONED', code: 'STATE' }] },
      ),
      translations.ha,
    );
    expect(text).toBe(ha.errTransactionNotPayable.replace('{{state}}', ha.enumAbandoned));
    expect(text).not.toContain('ABANDONED');
  });

  /*
   * A state the dictionary does not know is left exactly as it is.
   *
   * `enumLabel`'s fallback takes the underscores out and lowercases, which
   * turns an unfamiliar state into something that is neither the state nor a
   * translation of it. Leaving it alone is the lesser of the two: an agent
   * reporting "it said SOMETHING_NEW" can be helped, and one reporting "it
   * said something new" cannot.
   */
  it('leaves a state it has no word for exactly as the server sent it', () => {
    const text = errorText(
      refusal('INVOICE_NOT_PAYABLE', 'x', {
        details: [{ field: 'state', issue: 'SOMETHING_NEW', code: 'STATE' }],
      }),
      translations.ha,
    );
    expect(text).toBe(ha.errInvoiceNotPayable.replace('{{state}}', 'SOMETHING_NEW'));
  });

  /*
   * A detail the server did not mark as a state is left alone even when its
   * value is a word the dictionary knows.
   *
   * This holds the narrower of the two conditions in `substituted`. Without it
   * the rule would be "translate anything that matches a key", which would
   * quietly take in every detail field added later — and `ACTIVE` is an
   * entirely plausible thing for a future field to carry as a datum rather
   * than as a stage something reached.
   */
  it('translates only what the server marked as a state', () => {
    const text = errorText(
      refusal('INVOICE_NOT_PAYABLE', 'x', {
        details: [{ field: 'state', issue: 'ACTIVE' }],
      }),
      translations.ha,
    );
    expect(text).toBe(ha.errInvoiceNotPayable.replace('{{state}}', 'ACTIVE'));
    expect(text).not.toContain(ha.enumActive);
  });

  /*
   * And a detail that is not a state is untouched whatever it looks like.
   *
   * The training refusal sends a score and a pass mark through this same path.
   * If those went through `enumLabel` as well, a figure would come back
   * lowercased and a reference number mangled.
   */
  it('does not put a figure through the dictionary', () => {
    const text = errorText(
      {
        code: 'TRAINING_SCORE_BELOW_PASS_MARK',
        message: 'x',
        details: [
          { field: 'score', issue: '41' },
          { field: 'passMark', issue: '80' },
        ],
      } as never,
      translations.ha,
    );
    expect(text).toContain('41');
    expect(text).toContain('80');
  });
});

describe('what the agent sees on the screen', () => {
  it('shows the Hausa headline, the money sentence and the next step together', () => {
    render(
      <ErrorAlert
        error={
          {
            code: 'INVOICE_ALREADY_PAID',
            message: 'This invoice has already been paid. Do not collect payment again.',
            moneyStatus: 'RECEIVED',
            nextStep: 'Open the receipt from the transaction history.',
          } as never
        }
      />,
    );
    expect(screen.getByText(ha.errInvoiceAlreadyPaid)).toBeTruthy();
    // The one sentence that was already right, and must stay right.
    expect(screen.getByText(ha.moneyReceived)).toBeTruthy();
    expect(screen.getByText(ha.nsInvoiceAlreadyPaid)).toBeTruthy();
    expect(screen.queryByText(/Do not collect payment again/)).toBeNull();
  });
});
