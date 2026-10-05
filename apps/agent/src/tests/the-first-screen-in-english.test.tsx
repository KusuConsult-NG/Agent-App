/**
 * The screen an agent who is not yet cleared lands on.
 *
 * `HomeScreen` returns early for AGENT_NOT_CLEARED and AGENT_SUSPENDED and
 * draws the refusal in its own frame — a heading, the sentence, and a button
 * to the application. The heading came from the dictionary and the sentence
 * came from `error.message`, printed exactly as the API composed it.
 *
 * So a Hausa-reading applicant got "Ana sarrafa bukatarka" over an English
 * paragraph, with `errAgentNotCleared` sitting in the dictionary — translated,
 * reviewed, and in the safety tier `hausa-safety-strings` keeps for the
 * strings whose meaning inverted leaves somebody out of pocket. It is the same
 * walk past the translation map that the sync banner in `App.tsx` made, on the
 * first screen of the application, for the agents who have not started yet.
 *
 * `errorText` exists for exactly this: it was lifted out of `ErrorAlert` so a
 * screen drawing a refusal in its own frame can still get the translation.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { HomeScreen } from '../screens/Home';
import { ApiRequestError, api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

/** As `notCleared` raises it, blockers and all. */
const NOT_CLEARED = new ApiRequestError(403, {
  code: 'AGENT_NOT_CLEARED',
  message:
    'You are not yet cleared to carry out revenue collection. ' +
    'Your application must be completed and approved first.',
  moneyStatus: 'NOT_APPLICABLE',
  nextStep: 'Open "My Application" to see what is still outstanding.',
});

/** The suspension beside it, which has no translation and must keep its own. */
const SUSPENDED = new ApiRequestError(403, {
  code: 'AGENT_SUSPENDED',
  message: 'Your account has been suspended pending a review.',
  moneyStatus: 'NOT_APPLICABLE',
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  setAppLanguage('ha');
});

afterEach(() => {
  setAppLanguage('en');
  cleanup();
});

describe('an applicant reading why they cannot collect yet', () => {
  it('reads it in Hausa, not only the heading', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(NOT_CLEARED);

    render(<HomeScreen navigate={vi.fn()} />);

    expect(await screen.findByText(ha.errAgentNotCleared!)).toBeTruthy();
    expect(document.body.textContent).not.toContain('not yet cleared to carry out');
  });

  it('still has the button that is the whole point of the screen', async () => {
    // The guard: a translation that lost the way forward would be worse than
    // the English, because this screen exists to send them to their
    // application.
    vi.spyOn(api, 'get').mockRejectedValue(NOT_CLEARED);

    render(<HomeScreen navigate={vi.fn()} />);

    expect(await screen.findByRole('button', { name: ha.homeViewApplication! })).toBeTruthy();
  });

  it('leaves an English reader reading English', async () => {
    setAppLanguage('en');
    vi.spyOn(api, 'get').mockRejectedValue(NOT_CLEARED);

    render(<HomeScreen navigate={vi.fn()} />);

    expect(await screen.findByText(en.errAgentNotCleared!)).toBeTruthy();
  });

  it('keeps the server’s words for the suspension, which has no translation', async () => {
    /*
     * The policy this must not break. A guessed Hausa sentence for a message
     * nobody has seen is worse than the English — the reader cannot tell a
     * guess from a translation — so AGENT_SUSPENDED keeps what the API said
     * until somebody writes and reviews one.
     */
    vi.spyOn(api, 'get').mockRejectedValue(SUSPENDED);

    render(<HomeScreen navigate={vi.fn()} />);

    expect(await screen.findByText('Your account has been suspended pending a review.')).toBeTruthy();
  });
});
