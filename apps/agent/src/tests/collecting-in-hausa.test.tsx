/**
 * Every refusal on the screen the application exists for, in the agent's language.
 *
 * `becoming-an-agent-in-hausa` closed this gap once, on the path to being
 * cleared and paid. The map it fixed then held twenty-four codes and still had
 * none on the collect path — so an agent standing in a market with a trader in
 * front of them, choosing a levy and pressing through, was refused in English.
 *
 * All six come out of `createAssessmentIn`. Three of them had no code specific
 * enough to key on and were raised as INVALID_REQUEST, the code a malformed
 * field gets; they were named in `services/revenue.ts` first, because a
 * sentence nobody can name is a sentence nobody can translate.
 *
 * ONE OF THEM IS IN THE SAFETY TIER AND FIVE ARE NOT
 *
 * `NO_TAX_PAYABLE` tells the agent there is nothing to charge, and its next
 * step tells them not to raise the figure to force the assessment through. An
 * agent who can read neither is exactly the agent who raises the figure, and
 * the trader pays a tax the schedule does not ask for. The other five stop the
 * collection — a closed record, a levy not collected in this LGA — and leave
 * the agent stuck rather than leaving somebody out of pocket, which is the line
 * `hausa-safety-strings` draws.
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

/** As the API raises it, English sentence and all. */
const refusal = (code: string, message: string, nextStep?: string) => ({
  code,
  message,
  moneyStatus: 'NOT_APPLICABLE' as const,
  nextStep,
});

describe('the refusals an agent meets while collecting', () => {
  /*
   * Named one at a time rather than looped over a list, so a code that stops
   * being translated names itself in the failure instead of reporting
   * "1 of 6". The English is quoted as `services/revenue.ts` composes it,
   * including the levy name it interpolates — which is the other half of why
   * these cannot be translated by matching on text.
   */
  const CASES: [string, string, string][] = [
    [
      'TAXPAYER_NOT_ACTIVE',
      'This taxpayer record is closed and cannot be assessed.',
      'errTaxpayerNotActive',
    ],
    [
      'REVENUE_ITEM_INACTIVE',
      '"Market Tax and Levy" is not currently collectable.',
      'errRevenueItemInactive',
    ],
    [
      'REVENUE_ITEM_NOT_FOR_TAXPAYER_TYPE',
      '"Gaming Tax" does not apply to individual taxpayers.',
      'errRevenueItemNotForTaxpayerType',
    ],
    [
      'REVENUE_ITEM_NOT_IN_LGA',
      '"Motor Park Levy" is not collected in this taxpayer’s Local Government Area.',
      'errRevenueItemNotInLga',
    ],
    [
      'ASSESSMENT_AMOUNT_ZERO',
      'The calculated amount is zero. Check the values entered before raising an invoice.',
      'errAssessmentAmountZero',
    ],
  ];

  for (const [code, english, key] of CASES) {
    it(`says ${code} in Hausa`, () => {
      render(<ErrorAlert error={refusal(code, english)} />);

      expect(screen.getByText(ha[key]!)).toBeTruthy();
      // And not the sentence the API composed, which is the whole point.
      expect(document.body.textContent).not.toContain(english);
    });
  }

  it('leaves a refusal nobody has translated in the server’s words', () => {
    /*
     * The control, and the policy this must not break. A validation message
     * names a field and is generated from the schema, so a guessed Hausa
     * sentence for one nobody has seen is worse than the English — the agent
     * cannot tell a guess from a translation.
     */
    render(<ErrorAlert error={refusal('INVALID_REQUEST', 'The turnover is not a number.')} />);

    expect(screen.getByText('The turnover is not a number.')).toBeTruthy();
  });
});

describe('the one that costs the trader money if it is not read', () => {
  const nothingToPay = refusal(
    'NO_TAX_PAYABLE',
    'No tax is payable on ₦40,000.00 under the rate in force for "Personal Income Tax", so there is no invoice to raise.',
    'The figures are not wrong — this taxpayer is below the threshold. Do not increase the amount to make the assessment go through.',
  );

  it('says both halves in Hausa, not only the explanation', () => {
    /*
     * The instruction is the half that matters. A Hausa reader was getting the
     * heading in Hausa, the explanation in Hausa, and "Do not increase the
     * amount" in English — which is the failure `nextStepText` was written to
     * end, on a path its own map had excluded by a rule that was too broad.
     */
    render(<ErrorAlert error={nothingToPay} />);

    expect(screen.getByText(ha.errNoTaxPayable!)).toBeTruthy();
    expect(screen.getByText(ha.nsNoTaxPayable!)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Do not increase the amount');
  });

  it('says not to raise the figure, in both languages', () => {
    // The sentence is the control on the whole tier: if either language stops
    // saying it, an agent is left to decide what to do about a zero bill.
    expect(en.nsNoTaxPayable).toMatch(/do not increase the amount/i);
    expect(ha.nsNoTaxPayable).toMatch(/kada ka kara/i);
  });

  it('is not left to the reader to work out from the English', () => {
    expect(errorText(nothingToPay, translations.ha)).toBe(ha.errNoTaxPayable);
    expect(nextStepText(nothingToPay, translations.ha)).toBe(ha.nsNoTaxPayable);
    // And an English reader still reads English, which is the guard on both.
    expect(errorText(nothingToPay, translations.en)).toBe(en.errNoTaxPayable);
  });
});
