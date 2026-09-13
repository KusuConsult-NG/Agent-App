/**
 * Every refusal on the way to being paid, in the language the agent reads.
 *
 * `TRANSLATED_ERRORS` held thirteen codes — drafts, payments, devices, the
 * rate limit, the version gate. Not one of them was on the clearance path or
 * the bank-account path. So applying to become an agent, failing the mandatory
 * training, registering a handset, and changing the account the commission is
 * paid into all refused in English, in an application that has offered Hausa
 * since it was built.
 *
 * The comment above that map sets the test for what may be added: "the errors
 * whose meaning is fixed, and can therefore be translated". Every one of these
 * has one fixed meaning. They were simply never added.
 *
 * Five had no code specific enough to key on at all — raised as
 * `badRequest()` (INVALID_REQUEST) or `forbidden()` (FORBIDDEN), the two codes
 * this map deliberately does NOT translate, because a validation message names
 * a field and is generated from the schema. They were given a code first: a
 * sentence nobody can name is a sentence nobody can translate.
 *
 * THE TRAINING ONE CARRIES FIGURES
 *
 * "You scored 40%. You need at least 70%" is the sentence that tells an agent
 * why they cannot yet collect, and the numbers are what they are looking for.
 * They travel in `details` rather than being parsed back out of the server's
 * prose, which would break silently the moment somebody improved the English —
 * in the language nobody testing it reads.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ErrorAlert, errorText } from '../ui';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
});

afterEach(() => setAppLanguage('en'));

/** As the API raises it, English sentence and all. */
const refusal = (
  code: string,
  message: string,
  details?: { field?: string; issue: string }[],
) => ({ code, message, moneyStatus: 'NOT_APPLICABLE' as const, details });

describe('the refusals an agent meets on the way to being cleared', () => {
  /*
   * Named one at a time rather than looped, so a code that stops being
   * translated names itself in the failure instead of reporting "1 of 9".
   */
  const CASES: [string, string, string][] = [
    ['PHONE_ALREADY_REGISTERED', 'An account already exists with this phone number.', 'errPhoneAlreadyRegistered'],
    ['KYC_ALREADY_CLEARED', 'Your identity verification has already been completed.', 'errKycAlreadyCleared'],
    ['DEVICE_BEFORE_APPROVAL', 'Devices can only be registered after your application has been approved by PSIRS.', 'errDeviceBeforeApproval'],
    ['DEVICE_REVOKED_CANNOT_REREGISTER', 'This device has been revoked and cannot be registered again.', 'errDeviceRevokedCannotReregister'],
    ['NO_BANK_ACCOUNT_ON_RECORD', 'This agent has no bank account on record yet.', 'errNoBankAccountOnRecord'],
    ['BANK_DETAILS_UNCHANGED', 'Those are the details already on record. Nothing would change.', 'errBankDetailsUnchanged'],
    ['BANK_CHANGE_ALREADY_PENDING', 'A change to this bank account is already waiting for an officer.', 'errBankChangeAlreadyPending'],
    ['BANK_CHANGE_ALREADY_SETTLED', 'This change has already been approved.', 'errBankChangeAlreadySettled'],
    ['PAYOUT_IN_FLIGHT', 'Payout PSIRS-PO-14 has not been paid yet.', 'errPayoutInFlight'],
  ];

  for (const [code, english, key] of CASES) {
    it(`says ${code} in Hausa`, () => {
      render(<ErrorAlert error={refusal(code, english)} />);

      expect(screen.getByText(ha[key]!)).toBeTruthy();
      // And not the sentence the API composed, which is the whole point.
      expect(document.body.textContent).not.toContain(english);
    });
  }

  it('leaves a code nobody has translated in the server’s words', () => {
    /*
     * The control, and the policy this must not break. A validation message
     * names a field and is generated from the schema, so a guessed Hausa
     * sentence for one nobody has seen is worse than the English — the agent
     * cannot tell a guess from a translation.
     */
    render(
      <ErrorAlert error={refusal('INVALID_REQUEST', 'The phone number is not valid.')} />,
    );

    expect(screen.getByText('The phone number is not valid.')).toBeTruthy();
  });
});

describe('failing the training that stands between an agent and collecting', () => {
  const failed = refusal(
    'TRAINING_SCORE_BELOW_PASS_MARK',
    'You scored 40% on "Handling cash". You need at least 70% to pass. Review the module and try again.',
    [
      { field: 'score', issue: '40' },
      { field: 'passMark', issue: '70' },
      { field: 'module', issue: 'Handling cash' },
    ],
  );

  it('says it in Hausa, with the score and the pass mark in it', () => {
    render(<ErrorAlert error={failed} />);

    /*
     * Scoped to the heading, not to the page.
     *
     * `ErrorAlert` also lists `details` below the sentence, so "40" and "70"
     * are on screen whether or not the sentence was filled in — asserting on
     * `document.body.textContent` would have passed with every placeholder
     * still showing. The heading is where the sentence actually is.
     */
    const sentence = document.querySelector('.alert strong')!.textContent ?? '';
    expect(sentence).toContain('40');
    expect(sentence).toContain('70');
    expect(sentence).toContain('Handling cash');
    // The Hausa sentence, not the English one.
    expect(sentence).toContain('Kana bukatar akalla kashi');
    expect(document.body.textContent).not.toContain('You need at least');
  });

  it('fills every placeholder, in both languages', () => {
    /*
     * A sentence reading "You scored % on" is a bug an agent cannot describe.
     * Asserted on the text rather than by eye, in English too, because the
     * English is what a reviewer reads when checking the Hausa.
     */
    for (const lang of ['en', 'ha'] as const) {
      const text = errorText(failed, translations[lang]);
      expect(text, `${lang} left a placeholder`).not.toMatch(/\{\{\w+\}\}/);
      expect(text).toContain('40');
      expect(text).toContain('70');
    }
  });

  it('does not blank a placeholder the server did not send', () => {
    /*
     * A visible gap is a bug somebody reports. A silently emptied one reads
     * as a finished sentence that happens to be missing the number the agent
     * came for.
     */
    const partial = refusal(failed.code, failed.message, [{ field: 'score', issue: '40' }]);

    const text = errorText(partial, translations.en);
    expect(text).toContain('40');
    expect(text).toContain('{{passMark}}');
  });

  it('is not the English the server composed', () => {
    // The defect: `badRequest` meant INVALID_REQUEST, which this map does not
    // translate, so this sentence used to arrive exactly as written.
    render(<ErrorAlert error={failed} />);

    expect(
      screen.queryByText(/Review the module and try again/),
      'the server’s sentence reached the agent',
    ).toBeNull();
    expect(en.errTrainingScoreBelowPassMark).toBeTruthy();
  });
});
