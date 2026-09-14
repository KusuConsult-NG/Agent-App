/**
 * The half of an error that says what to do about it.
 *
 * `ErrorAlert` translated the message and then printed `nextStep` — the line
 * naming the screen to open or the thing to check — exactly as the API had
 * composed it. So a reader working in Hausa got the heading in Hausa, the
 * explanation in Hausa, and the instruction in English. The actionable half
 * was the untranslated one.
 *
 * Fifteen sentences in `apps/api` reached both applications this way, and
 * neither guard could see any of them: both matched `.message` and nothing
 * ever looked at `.nextStep`. Widening the rule is what found the last one —
 * the sync banner, whose explanation had been moved into the dictionary
 * earlier today while the instruction under it was left alone.
 *
 * Nothing new is sent for this. The code has always travelled with the error.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ErrorAlert, nextStepText } from '../ui';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha;
const en = translations.en;

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
});

afterEach(() => {
  cleanup();
  setAppLanguage('en');
});

describe('what to do about an error', () => {
  it('renders the instruction in Hausa, not the API’s English', () => {
    render(
      <ErrorAlert
        error={{
          code: 'DEVICE_NOT_REGISTERED',
          message: 'This device is not registered to your agent account.',
          nextStep: 'Open Profile, then "View my application and clearance", to register it.',
          moneyStatus: 'NOT_APPLICABLE',
        }}
      />,
    );
    expect(screen.getByText(ha.nsDeviceNotRegistered)).toBeTruthy();
    expect(screen.queryByText(/Open Profile, then/)).toBeNull();
  });

  /*
   * The pair that matters most for money. A TIN service outage and a TIN the
   * register does not know both end with an agent holding a taxpayer's
   * document, and the instruction is what stops them minting a second TIN for
   * somebody who already has one — permanently, in a UNIQUE column on an
   * undeletable row.
   */
  it('says do NOT register a second TIN, in the language the agent reads', () => {
    expect(nextStepText({ code: 'TIN_SERVICE_UNAVAILABLE' }, ha)).toBe(ha.nsTinServiceUnavailable);
    expect(nextStepText({ code: 'TIN_NOT_FOUND' }, ha)).toBe(ha.nsTinNotFound);
    // The English still carries the warning in the shape it was written in.
    expect(en.nsTinServiceUnavailable).toMatch(/do NOT register/i);
    expect(en.nsTinNotFound).toMatch(/mistyped/i);
  });

  /*
   * A code that means something different every time it is raised keeps the
   * server's words. `VALIDATION_FAILED` and anything a caller passed to
   * `forbidden()` cannot carry one instruction, and a wrong instruction is
   * worse than an untranslated one.
   */
  it('keeps the server’s words for a code that has no single next step', () => {
    const supplied = 'Ask the officer who owns this case to reassign it.';
    expect(nextStepText({ code: 'FORBIDDEN', nextStep: supplied }, ha)).toBe(supplied);
    expect(nextStepText({ code: 'VALIDATION_FAILED', nextStep: 'Check the request.' }, ha)).toBe(
      'Check the request.',
    );
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(nextStepText({ code: 'SOMETHING_ELSE' }, ha)).toBeNull();
  });

  it('has both languages for every code it claims to translate', () => {
    const keys = [
      'nsStepUpRequired',
      'nsDeviceNotRegistered',
      'nsDeviceRevoked',
      'nsDeviceSuspended',
      'nsUpdateRequired',
      'nsUpdateRequiredToEnumerate',
      'nsTinServiceUnavailable',
      'nsTinNotFound',
      'nsKycProviderUnavailable',
      'nsPaymentUnconfirmed',
      'nsPaymentFailed',
      'nsAgentNotCleared',
    ] as const;
    for (const key of keys) {
      const e = (en as unknown as Record<string, string>)[key];
      const h = (ha as unknown as Record<string, string>)[key];
      expect(typeof h, `${key} missing in ha`).toBe('string');
      expect(h.trim().length, `${key} empty in ha`).toBeGreaterThan(0);
      expect(e, `${key} identical in both languages`).not.toBe(h);
    }
  });

  /*
   * `STEP_UP_REQUIRED` used to answer with `POST /api/v1/auth/step-up with
   * action "..."` — an API contract line, shown to whoever met the error. It
   * is a developer's sentence, and it was never a next step anybody could
   * take.
   */
  it('does not answer a person with an API route', () => {
    for (const lang of [en, ha] as const) {
      expect((lang as unknown as Record<string, string>).nsStepUpRequired).not.toMatch(/POST |\/api\//);
    }
  });
});
