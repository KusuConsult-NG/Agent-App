/**
 * What the officer portal says when PSIRS refuses something.
 *
 * The portal is translated — three thousand interface strings — and its
 * language toggle sits in the sidebar of every signed-in page, deliberately,
 * so an officer who finds they want Hausa does not have to sign out to say so.
 * Its error component translated six codes, all of them raised by the api
 * client rather than by the server: a request that never arrived, an upload
 * that failed, a step-up the officer walked away from. So every refusal PSIRS
 * itself raised reached a Hausa-reading officer in English.
 *
 * AND THE NEXT-STEP MAP WAS POINTING AT THE WRONG APPLICATION.
 *
 * Eleven of its twelve entries named a refusal only the agent guard can raise.
 * The version gate opens `if (req.auth?.role !== 'agent') return next()`;
 * `requireActiveAgent` raises the device and clearance ones and this portal
 * calls no route behind it; the TIN ones come out of `registerTaxpayer`, which
 * is one of those routes; the KYC one is the applicant's own submission and is
 * worded for them; and the payment ones come from a confirmation path the
 * portal does not call.
 *
 * That cost an officer nothing directly. What it cost was the map's only other
 * use — the record of which refusals the portal expects — and with eleven
 * wrong entries it was no record at all, which is why the twenty-six an
 * officer does receive went unnoticed for as long as they did.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ErrorAlert } from '../ui';
import { setPortalLanguage } from '../lib/i18n';
// The maps are module-private, and the point of this file is what is in them.
// Read as source, the way `nothing-new-in-english` reads the screens.
import uiSource from '../ui.tsx?raw';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

/** As `requireStepUp` raises it, English sentence and developer next step. */
const stepUpRefusal = {
  code: 'STEP_UP_REQUIRED',
  message:
    'This action needs extra verification. Request a one-time code and confirm it, then try again.',
  moneyStatus: 'NOT_APPLICABLE' as const,
  nextStep: 'POST /api/v1/auth/step-up with action "user.role.change".',
};

beforeEach(() => {
  cleanup();
  setPortalLanguage('ha');
});

afterEach(() => setPortalLanguage('en'));

describe('which refusals this portal says it expects', () => {
  /** The keys of a map literal in `ui.tsx`, as written. */
  function keysOf(mapName: string): string[] {
    const start = uiSource.indexOf(`const ${mapName}: Record<string, keyof TranslationDictionary> = {`);
    expect(start, `${mapName} not found`).toBeGreaterThan(-1);
    const block = uiSource.slice(start, uiSource.indexOf('\n};', start));
    return [...block.matchAll(/^\s{2}([A-Z_]+):/gm)].map((match) => match[1]!);
  }

  it('names only the one its officers can actually be refused with', () => {
    /*
     * Eleven of the twelve entries here were for refusals only the agent guard
     * raises, and a map that is eleven-twelfths wrong is no record of anything.
     * Each is named in the failure rather than counted, so re-adding one says
     * which.
     */
    expect(keysOf('TRANSLATED_NEXT_STEPS')).toEqual(['STEP_UP_REQUIRED']);

    for (const agentOnly of [
      'DEVICE_NOT_REGISTERED',
      'DEVICE_REVOKED',
      'DEVICE_SUSPENDED',
      'AGENT_NOT_CLEARED',
      'UPDATE_REQUIRED',
      'UPDATE_REQUIRED_TO_ENUMERATE',
      'TIN_SERVICE_UNAVAILABLE',
      'TIN_NOT_FOUND',
      'KYC_PROVIDER_UNAVAILABLE',
      'PAYMENT_UNCONFIRMED',
      'PAYMENT_FAILED',
    ]) {
      expect(keysOf('TRANSLATED_NEXT_STEPS'), `${agentOnly} cannot reach an officer`).not.toContain(
        agentOnly,
      );
    }
  });

  it('translates the server refusal it does receive, and says so in the map', () => {
    expect(keysOf('TRANSLATED_ERRORS')).toContain('STEP_UP_REQUIRED');
  });
});

describe('the refusal every money action in this portal can produce', () => {
  it('says both halves in Hausa, not the instruction alone', async () => {
    render(<ErrorAlert error={stepUpRefusal} />);

    expect(screen.getByText(ha.ofcStepUpNeeded!)).toBeTruthy();
    expect(screen.getByText(ha.nsStepUpRequired!)).toBeTruthy();
    expect(document.body.textContent).not.toContain('needs extra verification');
  });

  it('never shows an officer the route they are meant to call', async () => {
    /*
     * The server's own `nextStep` here is `POST /api/v1/auth/step-up with
     * action "…"` — a note to whoever is writing a client, not a next step for
     * a person. The map is what replaces it, and if the entry were ever
     * removed an officer would read that line.
     */
    render(<ErrorAlert error={stepUpRefusal} />);

    expect(document.body.textContent).not.toContain('/api/v1/auth/step-up');
  });

  it('leaves an English reader reading English', async () => {
    setPortalLanguage('en');
    render(<ErrorAlert error={stepUpRefusal} />);

    expect(screen.getByText(en.ofcStepUpNeeded!)).toBeTruthy();
    expect(screen.getByText(en.nsStepUpRequired!)).toBeTruthy();
  });

  it('keeps the server’s words for a refusal nobody has translated', async () => {
    /*
     * The policy this must not break, and the reason most of the rest are
     * left: a guessed Hausa sentence for a message nobody has seen is worse
     * than the English, because the reader cannot tell a guess from a
     * translation. Until somebody reviews them, the English stands.
     *
     * This used to use PERIOD_CLOSED and then ALREADY_SIGNED, and both are now
     * translated — they are the two rows `HAUSA-REVIEW-QUESTIONS.md` §7 calls
     * the tier. `ROLE_RETIRED` is in the row that section calls mostly
     * administrative and says can stay in English.
     */
    render(
      <ErrorAlert
        error={{
          code: 'ROLE_RETIRED',
          message: 'That role has been retired and cannot be granted.',
          moneyStatus: 'NOT_APPLICABLE',
        }}
      />,
    );

    expect(screen.getByText('That role has been retired and cannot be granted.')).toBeTruthy();
  });
});

/*
 * CLOSING A FINANCIAL MONTH, IN THE LANGUAGE THE OFFICER READS.
 *
 * Three refusals, and the first ones in this map that name a subject. The
 * portal had no substitution at all — `ErrorAlert` rendered `t[translated]`
 * as it stood — so writing these without building it would have put
 * `{{period}}` on the screen that closes a revenue month.
 *
 * Both languages are asserted, because the English is what a reviewer reads
 * when checking the Hausa, and a hole would have been in both.
 */
describe('a revenue month an officer cannot close twice', () => {
  const refusal = (
    code: string,
    message: string,
    details: { field?: string; issue: string; code?: string }[],
  ) => ({ code, message, moneyStatus: 'NOT_APPLICABLE' as const, details });

  /*
   * The headline, not the whole alert.
   *
   * `ErrorAlert` lists `details` underneath, so "January 2026" and "CLOSING"
   * are on screen whether or not the sentence was filled in — asserting on the
   * alert's full text would pass with every placeholder still showing, which
   * is the mistake the agent's own Hausa test records having made. The
   * sentence is in the `<strong>`.
   */
  const said = () => document.querySelector('.alert strong')?.textContent ?? '';

  for (const lang of ['ha', 'en'] as const) {
    it(`names the month it will not close again, in ${lang}`, async () => {
      setPortalLanguage(lang);
      /*
       * A server sentence deliberately unlike the dictionary's.
       *
       * The English translation of this code is word for word what the API
       * composes — "{{period}} is already closed." — so a test that sends the
       * API's own wording cannot tell whether the map was consulted at all.
       * Removing the map entry left the English half of this passing, which is
       * a test that cannot fail. Sending something else makes the two
       * distinguishable in both languages.
       */
      render(
        <ErrorAlert
          error={refusal('PERIOD_CLOSED', 'Untranslated server wording.', [
            { field: 'period', issue: 'January 2026' },
          ])}
        />,
      );

      const text = said();
      expect(text, 'the placeholder reached the officer').not.toMatch(/\{\{\w+\}\}/);
      expect(text, 'the month is what the officer is looking for').toContain('January 2026');
      expect(text, 'the dictionary did not decide the sentence').not.toContain(
        'Untranslated server wording',
      );
      if (lang === 'ha') expect(text).toContain('An riga an rufe');
    });

    it(`names the month it will not open again, in ${lang}`, async () => {
      setPortalLanguage(lang);
      render(
        <ErrorAlert
          error={refusal('PERIOD_OPEN', 'Untranslated server wording.', [
            { field: 'period', issue: 'January 2026' },
          ])}
        />,
      );

      const text = said();
      expect(text).not.toMatch(/\{\{\w+\}\}/);
      expect(text).toContain('January 2026');
      expect(text).not.toContain('Untranslated server wording');
    });

    /*
     * The one that names a state as well. It arrives as the value the schema
     * holds — CLOSING — and is read through the shared enum table, which has
     * a name for it in both languages. The server's English lowercases it,
     * and "closing" is not something that table can look up, which is why the
     * field carries the schema's value rather than the printed word.
     */
    it(`names the state the month is actually in, in ${lang}`, async () => {
      setPortalLanguage(lang);
      render(
        <ErrorAlert
          error={refusal('PERIOD_NOT_OPEN', 'Untranslated server wording.', [
            { field: 'period', issue: 'January 2026' },
            { field: 'state', issue: 'CLOSING', code: 'STATE' },
          ])}
        />,
      );

      const text = said();
      expect(text).not.toMatch(/\{\{\w+\}\}/);
      expect(text).toContain('January 2026');
      expect(
        text,
        'the state has to be the enum table\'s name for it, not the raw value',
      ).toContain(translations[lang].enumClosing);
      expect(text).not.toContain('CLOSING');
    });
  }

  /*
   * THE OTHER HALF OF THE TIER: an audit report an officer's name goes on.
   *
   * Both of these reached an officer as the DATABASE's English until the read
   * in `signReport` took a lock — two officers signing one report both passed
   * the pre-check, migration 062's trigger refused the second, and the handler
   * turned the P0001 into FINANCIAL_CONTROL_BLOCKED carrying "who signed an
   * audit report, and when, cannot be rewritten". The service can say what
   * actually happened, and now does.
   */
  for (const lang of ['ha', 'en'] as const) {
    it(`names the report already signed, in ${lang}`, async () => {
      setPortalLanguage(lang);
      render(
        <ErrorAlert
          error={refusal('ALREADY_SIGNED', 'Untranslated server wording.', [
            { field: 'report', issue: 'PSIRS-AR/2026/00014' },
          ])}
        />,
      );

      const text = said();
      expect(text).not.toMatch(/\{\{\w+\}\}/);
      expect(text, 'the report number is how the officer finds it').toContain(
        'PSIRS-AR/2026/00014',
      );
      expect(text).not.toContain('Untranslated server wording');
      if (lang === 'ha') expect(text).toContain('sa hannu');
    });

    it(`names the report already withdrawn, in ${lang}`, async () => {
      setPortalLanguage(lang);
      render(
        <ErrorAlert
          error={refusal('ALREADY_WITHDRAWN', 'Untranslated server wording.', [
            { field: 'report', issue: 'PSIRS-AR/2026/00015' },
          ])}
        />,
      );

      const text = said();
      expect(text).not.toMatch(/\{\{\w+\}\}/);
      expect(text).toContain('PSIRS-AR/2026/00015');
      expect(text).not.toContain('Untranslated server wording');
      if (lang === 'ha') expect(text).toContain('janye');
    });
  }

  /*
   * And the third row of that tier, which is NOT translated and must not be.
   *
   * `SAMPLE_COMPLETED` is raised from two sites with two different sentences —
   * one carrying advice, one not — so a single translation would have to be
   * vaguer than the longer of the two. Consolidating them is a decision about
   * what an auditor is told on two screens, and until it is made the English
   * stands. Pinned so nobody translates it without making that decision.
   */
  it('keeps the English for a code raised with two different sentences', async () => {
    setPortalLanguage('ha');
    render(
      <ErrorAlert
        error={refusal('SAMPLE_COMPLETED', 'This sample is already complete.', [])}
      />,
    );

    expect(said()).toBe('This sample is already complete.');
  });

  /*
   * And a state the enum table has no name for is printed as it arrived.
   *
   * A state quietly turned into prose by the substitution would be a state
   * nobody could trace back to the schema; a raw value on the screen is one
   * somebody reports.
   */
  it('passes through a state nothing has a name for', async () => {
    setPortalLanguage('ha');
    render(
      <ErrorAlert
        error={refusal('PERIOD_NOT_OPEN', 'January 2026 is frozen.', [
          { field: 'period', issue: 'January 2026' },
          { field: 'state', issue: 'NOT_A_STATE_ANYTHING_DECLARES', code: 'STATE' },
        ])}
      />,
    );

    expect(said()).toContain('NOT_A_STATE_ANYTHING_DECLARES');
  });
});
