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
     * The policy this must not break, and the reason the other twenty-six are
     * left: a guessed Hausa sentence for a message nobody has seen is worse
     * than the English, because the reader cannot tell a guess from a
     * translation. Until somebody reviews them, the English stands.
     */
    render(
      <ErrorAlert
        error={{
          code: 'PERIOD_CLOSED',
          message: 'That period is closed and cannot be edited.',
          moneyStatus: 'NOT_APPLICABLE',
        }}
      />,
    );

    expect(screen.getByText('That period is closed and cannot be edited.')).toBeTruthy();
  });
});
