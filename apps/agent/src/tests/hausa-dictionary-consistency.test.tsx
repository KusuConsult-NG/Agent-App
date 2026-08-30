/**
 * The mechanical half of the Hausa review.
 *
 * `HAUSA-REVIEW.md` asks a native speaker four questions, and only the first
 * three need a person: does it say the same thing, is a negative still
 * negative, would an agent in a Jos market use these words. The fourth —
 * "one word for one thing, throughout" — is a property a machine can hold,
 * and holding it here means the reviewer spends their attention on the parts
 * that need judgement instead of on a concordance.
 *
 * These are not a substitute for that review and cannot become one. What they
 * do is stop the dictionary drifting after it: a string added next month gets
 * the same vocabulary, the same spelling conventions, and — the one that
 * matters most — cannot quietly lose a negation the English still carries.
 */

import { describe, it, expect } from 'vitest';
import { translations } from '@psirs/shared';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;
const keys = Object.keys(en);

/**
 * The glossary `HAUSA-REVIEW.md` publishes, as an assertion.
 *
 * If a decision here changes — the sheet offers `lada` for commission as an
 * open question — change it in both places. That the test has to be edited is
 * the point: the vocabulary is a decision, and decisions should not be
 * possible to make by accident in one string.
 */
const GLOSSARY: { term: string; english: RegExp; hausa: RegExp }[] = [
  { term: 'taxpayer', english: /taxpayer/i, hausa: /mai biyan haraji|masu biyan haraji/i },
  { term: 'receipt', english: /receipt/i, hausa: /rasit/i },
  { term: 'confirm', english: /confirm/i, hausa: /tabbatar/i },
  { term: 'device', english: /\bdevice\b/i, hausa: /na.?ura/i },
  /*
   * The noun, not the verb. "A remittance run has to account for all
   * seventeen" is not a sentence about a bank account, and demanding `asusu`
   * in its translation would have forced a wrong word into the one place the
   * glossary exists to keep right.
   */
  { term: 'account', english: /\baccounts?\b(?!\s+for)/i, hausa: /asusu/i },
  { term: 'commission', english: /commission/i, hausa: /kwamishan/i },
  { term: 'cash', english: /\bcash\b/i, hausa: /kudi/i },
];

describe('the Hausa dictionary holds together', () => {
  it('translates every key, with nothing left over', () => {
    expect(Object.keys(ha).sort()).toEqual(keys.slice().sort());
  });

  /**
   * Strings still waiting on the native review, listed rather than tolerated.
   *
   * `navProfile` was an English literal hardcoded into the tab bar, where
   * nothing could see it. Naming it here does not translate it, but it makes
   * the gap a line in a file somebody can delete rather than a word nobody
   * knew was missing.
   */
  const AWAITING_REVIEW = ['navProfile'];

  /**
   * Words that are the same in both languages because they are the same word.
   *
   * Kept apart from AWAITING_REVIEW on purpose: that list is a debt, and an
   * entry on it should eventually be deleted by somebody translating the
   * string. These never will be. "Hausa" is what the language is called in
   * Hausa, and the toggle offering it has to be readable to somebody who
   * cannot yet read the page.
   */
  const SAME_IN_BOTH = [
    'pubHausa',
    // A literal an auditor types into the audit-log filter. It is the name of
    // an event the API emits, not a phrase — translating it would return no
    // rows.
    'ofcOvActionPlaceholder',
  ];

  it('passes no English off as Hausa', () => {
    const copied = keys.filter(
      (k) =>
        en[k].trim() === ha[k].trim() &&
        !AWAITING_REVIEW.includes(k) &&
        !SAME_IN_BOTH.includes(k),
    );
    expect(copied).toEqual([]);
  });

  it('keeps the waiting list honest', () => {
    // An entry that has since been translated should leave this list, or it
    // becomes permission that outlives its reason.
    const stillEnglish = AWAITING_REVIEW.filter((k) => en[k].trim() === ha[k].trim());
    expect(stillEnglish).toEqual(AWAITING_REVIEW);
  });

  it('reads every tab label from the dictionary', async () => {
    // Two of the six were English literals in App.tsx, so no dictionary and no
    // review could reach them.
    const app = (await import('../App.tsx?raw')).default;
    expect(app).not.toMatch(/label: 'Commission'/);
    expect(app).not.toMatch(/label: 'Profile'/);
    for (const key of ['navHome', 'navTaxpayers', 'navCollect', 'navReceipts', 'navCommission', 'navProfile']) {
      expect(app).toContain(`t.${key}`);
    }
  });

  it('never drops a negation the English carries', () => {
    // The review sheet calls this "the worst failure possible", because the
    // strings that turn on *not* are the ones that stop an agent taking cash
    // or telling a taxpayer to pay a second time.
    const englishNegative = /\b(not|never|no|cannot|can't|do not|don't|without|nothing|unless)\b/i;
    // `a’a` is the bare "no" — the answer to a yes/no question rather than a
    // negated sentence. It was missing here, and the first string that needed
    // it was the Yes/No pair asking whether a taxpayer already holds a TIN.
    const hausaNegative = /(\b(ba|kada|babu|bai|banda)\b|a’a)/i;
    const dropped = keys.filter((k) => englishNegative.test(en[k]) && !hausaNegative.test(ha[k]));
    expect(dropped).toEqual([]);
  });

  it('uses one word for one thing, throughout', () => {
    const inconsistent: string[] = [];
    for (const { term, english, hausa } of GLOSSARY) {
      for (const key of keys) {
        if (english.test(en[key]) && !hausa.test(ha[key])) inconsistent.push(`${term}: ${key}`);
      }
    }
    expect(inconsistent).toEqual([]);
  });

  it('keeps to the keyboard the agents actually have', () => {
    // The sheet's stated convention: no hooked letters, `kudi` not `kuɗi`,
    // because agents type on phone keyboards without them. It is a decision
    // and can be changed — but not one string at a time.
    const hooked = keys.filter((k) => /[ɗƙɓ]/.test(ha[k]));
    expect(hooked).toEqual([]);
  });

  it('writes apostrophes the one way the English does', () => {
    // `na’ura` in two strings and `Nau'in` in a third is the kind of drift
    // that makes a reviewer's correction fail to match what is in the file.
    const straight = keys.filter((k) => /\w'\w/.test(ha[k]));
    expect(straight).toEqual([]);
  });

  it('leaves the numbers and codes an agent reads off the screen alone', () => {
    // These are typed, not read. A translated example phone number is a
    // number somebody will dial.
    for (const key of keys) {
      for (const literal of ['08012345678', 'T7C72-QTUDN', 'PSIRS']) {
        if (en[key].includes(literal)) expect(ha[key]).toContain(literal);
      }
    }
  });
});
