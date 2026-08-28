/**
 * The strings it costs something to leave in English.
 *
 * The application carries a Hausa toggle, and a test asserts the dictionary
 * is complete. It is complete against itself — 43 terms, both languages,
 * matching — and it stayed green while roughly 247 further pieces of
 * user-visible English accumulated in the screens: field hints, refusals,
 * empty states, and every sentence explaining why a button will not work.
 *
 * A dictionary measured against itself cannot notice that. These tests
 * measure it against the two things that matter instead: that the
 * safety-critical strings are genuinely translated rather than copied, and
 * that the screens actually read them rather than holding English literals.
 *
 * The selection is deliberate and not exhaustive. Translating all 247 on the
 * assumption they matter is as unreasoned as translating none; the field
 * trial establishes the rest (UAT-FIELD-TRIAL.md §3.1). What is pinned here
 * is the tier where being untranslated has a cost somebody bears: an agent
 * who cannot read "Never collect cash" is exactly the agent who collects
 * cash.
 */

import { describe, it, expect } from 'vitest';
import { getTranslation, type TranslationDictionary } from '@psirs/shared';
// Vite's `?raw` rather than node's fs: this is a browser-target project, and
// pulling @types/node into it to read three files would be the larger change.
import authSource from '../screens/Auth.tsx?raw';
import collectSource from '../screens/Collect.tsx?raw';
import taxpayersSource from '../screens/Taxpayers.tsx?raw';
import appSource from '../App.tsx?raw';

const en = getTranslation('en');
const ha = getTranslation('ha');

/** The tier whose absence costs money, integrity, or the ability to proceed. */
const SAFETY_KEYS: (keyof TranslationDictionary)[] = [
  'neverCollectCash',
  'neverCollectCashBody',
  'cashChannelReminder',
  'commissionAccountOnly',
  'commissionAccountNote',
  'paymentFailed',
  'paymentFailedBody',
  'paymentUnconfirmed',
  'paymentUnconfirmedBody',
  'findTaxpayerFirst',
  'noTaxpayerMatch',
  'genuineReceipt',
  'receiptNotValid',
  'receiptNotValidBody',
  'receiptCodeShape',
  'needFirstName',
  'needLastName',
  'needPhone',
  'needAddress',
  'needLga',
  'needConsent',
  'needDeclaration',
  'needExistingTin',
  'birthDateFuture',
  'birthDateTooOld',
  'birthDateMalformed',
  'emailIncomplete',
  'deviceNotRegistered',
  'deviceAfterApproval',
  /*
   * Added when the app stopped running out of Hausa halfway down.
   *
   * The tier is not "strings on screens that touch money" — that is most of
   * the app now. It is the strings whose *meaning inverted* leaves somebody
   * out of pocket: a refusal read as a success, an unconfirmed payment read
   * as a confirmed one, an offline capture read as a completed collection,
   * or the sentence that keeps government revenue out of an agent's own
   * account.
   */
  'errPaymentUnconfirmed',
  'errPaymentPendingReconciliation',
  'errPaymentFailed',
  'errAgentNotCleared',
  'errDeviceNotRegistered',
  'errUpdateRequired',
  'errNetwork',
  'moneyNotDebited',
  'moneyUnconfirmed',
  'moneyReceived',
  'homePendingBody',
  'appCannotCollectUntil',
  'appDeviceOnlyRegistered',
  'appBankHint',
  'authRevenueNeverToAgent',
  'tpSavedOfflineBody',
  'tpNotYetSent',
  'tpConsent',
  'tpDeclaration',
  'tpTinPending',
  'allocOfflineBody',
  'allocFailed',
  'verifyCouldNotReach',
  'verifyNotAReceiptCode',
  'verifyOfflineBody',
  'grpNoAssessmentBody',
  'grpAskLeaderHint',
  'moreCommissionOnlyVerified',
  'moreVehicleSavedBody',
  'moreVehicleCaptureBody',
  'moreBankMustConfirm',
  'colInvoiceNoReference',
  // The verdict a citizen reads off the public verification page, in the
  // largest type on it. Every word underneath was translated and these were
  // not, which is the failure this tier exists to catch.
  'pubVerdictValid',
  'pubVerdictAcknowledgement',
  'pubVerdictReversed',
  'pubVerdictNotFound',
  'pubVerdictInvalid',
];

describe('the safety tier is really in Hausa', () => {
  it('has every key in both languages', () => {
    for (const key of SAFETY_KEYS) {
      expect(typeof en[key], `${key} missing from English`).toBe('string');
      expect(typeof ha[key], `${key} missing from Hausa`).toBe('string');
      expect(String(ha[key]).length, `${key} is empty in Hausa`).toBeGreaterThan(3);
    }
  });

  it('does not pass English off as Hausa', () => {
    // A copied string is the commonest way a translation file rots: the key
    // exists, the test counting keys passes, and the agent reads English.
    for (const key of SAFETY_KEYS) {
      expect(ha[key], `${key} is identical to the English`).not.toBe(en[key]);
    }
  });

  it('keeps the words an agent has to recognise', () => {
    // Not a translation check — a check that the Hausa uses the vocabulary
    // the platform uses elsewhere, so an agent meets one word for one thing.
    expect(ha.neverCollectCash.toLowerCase()).toContain('kudi');
    expect(ha.findTaxpayerFirst.toLowerCase()).toContain('mai biyan haraji');
    expect(ha.noTaxpayerMatch.toLowerCase()).toContain('mai biyan haraji');
    expect(ha.receiptNotValid.toLowerCase()).toContain('rasit');
  });

  it('keeps the example phone number and receipt code intact', () => {
    // These are read off a screen and typed. Translating the digits would be
    // worse than leaving the sentence in English.
    expect(ha.needPhone).toContain('08012345678');
    expect(ha.receiptCodeShape).toContain('T7C72-QTUDN');
  });
});

describe('the screens read the dictionary rather than holding English', () => {
  it('no longer hardcodes the cash warning', () => {
    const auth = authSource;
    const collect = collectSource;
    expect(auth).not.toContain('title="Never collect cash"');
    expect(collect).not.toContain('title="Never collect cash"');
    expect(auth).toContain('t.neverCollectCash');
    expect(collect).toContain('t.cashChannelReminder');
  });

  it('no longer hardcodes what happened to the money', () => {
    const collect = collectSource;
    expect(collect).not.toContain('title="Payment did not go through"');
    expect(collect).not.toContain('title="Payment not yet confirmed"');
    expect(collect).toContain('t.paymentFailed');
    expect(collect).toContain('t.paymentUnconfirmed');
  });

  it('no longer hardcodes the wizard refusals', () => {
    const taxpayers = taxpayersSource;
    expect(taxpayers).not.toContain("return 'Choose the Local Government Area.'");
    expect(taxpayers).toContain('t.needLga');
    expect(taxpayers).toContain('t.birthDateFuture');
  });
});

describe('a Hausa-first agent can choose Hausa before they need it', () => {
  it('offers the language switch on the signed-out screens', () => {
    // The toggle lived only in the signed-in header, which put it on the far
    // side of the sign-in screen and a twenty-seven-field application form —
    // the two things a prospective agent meets first.
    const auth = authSource;
    const app = appSource;
    expect(auth.match(/\{languageSwitch\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(app).toContain('languageSwitch={languageSwitch}');
  });
});
