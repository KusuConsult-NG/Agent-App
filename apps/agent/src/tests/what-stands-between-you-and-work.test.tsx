/**
 * The list of what an applicant still has to do, in the language they read.
 *
 * This is the one screen a person sees between applying to be an agent and
 * earning anything, and the card headed "Sauran da ba a kammala ba" is the
 * whole of what it tells them to do next. It listed seven English sentences.
 * They came from `activationBlockers` in the shared package, which composed
 * prose the client could only print — by the time it reached the phone there
 * was nothing left to translate.
 *
 * The same seven reach the same person a second way. An applicant who tries
 * to collect anyway gets a 403 whose headline the PWA already translates and
 * whose `details` it printed as they arrived, so the alert read as a Hausa
 * sentence followed by seven English ones.
 *
 * Both are covered here, and both are rendered rather than asserted about:
 * the screen has to actually mount, because "the string exists in the
 * dictionary" is a claim about a file and "the applicant can read it" is a
 * claim about a screen, and this codebase has repeatedly found them to be
 * different claims.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { AGENT_BLOCKERS, BLOCKER_TEXT, translations, type AgentBlocker } from '@psirs/shared';
import { ApplicationScreen } from '../screens/Application';
import { ErrorAlert } from '../ui';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

/** Nothing cleared: every gate is outstanding, which is where an applicant starts. */
const NOTHING_DONE = {
  applicationState: 'APPLICATION_SUBMITTED',
  accessStage: 'APPLICANT',
  statuses: { account: 'PENDING', kyc: 'PENDING', referee: 'PENDING', training: 'PENDING', clearance: 'PENDING', operational: 'PENDING' },
  checklist: {},
  outstanding: [...AGENT_BLOCKERS] as AgentBlocker[],
  canCollectRevenue: false,
  kyc: null,
  referees: [],
  training: [],
  devices: [],
  history: [],
};

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
  vi.spyOn(api, 'get').mockResolvedValue(NOTHING_DONE as never);
});

afterEach(() => {
  setAppLanguage('en');
  vi.restoreAllMocks();
});

describe('what an applicant is told is still outstanding', () => {
  it('says all seven in Hausa on the application screen', async () => {
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(ha.appStillOutstanding!)).toBeTruthy());
    for (const code of AGENT_BLOCKERS) {
      const line = ha[BLOCKER_TEXT[code]]!;
      expect(screen.getByText(line), `${code} is missing from the screen`).toBeTruthy();
    }
  });

  /*
   * The negative half, and the one that fails if the codes are printed raw.
   *
   * Asserting the Hausa is present would still pass if the screen rendered
   * both — or if it rendered `GOVERNMENT_APPROVAL` and the dictionary lookup
   * happened somewhere the applicant never sees.
   */
  it('leaves no English and no bare code on the screen', async () => {
    const { container } = render(<ApplicationScreen navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(ha.appStillOutstanding!)).toBeTruthy());

    const rendered = container.textContent ?? '';
    for (const code of AGENT_BLOCKERS) {
      expect(rendered.includes(en[BLOCKER_TEXT[code]]!), `${code} is in English`).toBe(false);
      expect(rendered.includes(code), `${code} is on screen as a code`).toBe(false);
    }
  });

  it('says them in English when that is the language chosen', async () => {
    setAppLanguage('en');
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(en.appStillOutstanding!)).toBeTruthy());
    for (const code of AGENT_BLOCKERS) {
      expect(screen.getByText(en[BLOCKER_TEXT[code]]!)).toBeTruthy();
    }
  });
});

describe('the refusal an applicant meets if they try to collect anyway', () => {
  const refusal = {
    code: 'AGENT_NOT_CLEARED',
    message: 'You are not yet cleared to carry out revenue collection.',
    moneyStatus: 'NOT_APPLICABLE' as const,
    nextStep: 'Open "My Application" to see what is still outstanding.',
    details: AGENT_BLOCKERS.map((code) => ({ code, issue: `English for ${code}` })),
  };

  it('reads the codes, not the sentences the server composed', () => {
    const { container } = render(<ErrorAlert error={refusal as never} />);

    for (const code of AGENT_BLOCKERS) {
      expect(screen.getByText(ha[BLOCKER_TEXT[code]]!)).toBeTruthy();
    }
    expect(container.textContent).not.toContain('English for');
  });

  /*
   * A detail with no code, or one this build has never heard of, still says
   * something. The alternative is a blank bullet, which tells the agent less
   * than the English did.
   */
  it('falls back to what the server said when there is no code it knows', () => {
    render(
      <ErrorAlert
        error={
          {
            code: 'VALIDATION_FAILED',
            message: 'Check the form.',
            moneyStatus: 'NOT_APPLICABLE',
            details: [
              { field: 'accountNumber', issue: 'That account number is too short' },
              { code: 'SOMETHING_NEW', issue: 'A gate this build has not met' },
            ],
          } as never
        }
      />,
    );

    expect(screen.getByText(/That account number is too short/)).toBeTruthy();
    expect(screen.getByText(/A gate this build has not met/)).toBeTruthy();
  });
});
