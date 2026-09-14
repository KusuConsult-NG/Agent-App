/**
 * What an agent reads when PSIRS refuses the work on their phone.
 *
 * Not a lost signal — that is caught above this path and stays deliberately
 * silent, because the queue is what a lost signal is for. This is the other
 * case: the captures reached PSIRS and were *refused*. A handset that is not
 * registered, a clearance that has lapsed. Retrying will not fix either, the
 * records are still on the device, and the agent has to understand why they
 * will not go before they can do anything about it.
 *
 * The banner took `message` and `nextStep` off the `ApiError` and printed
 * them raw, which walked straight past `ErrorAlert` and the
 * `TRANSLATED_ERRORS` map. The Hausa existed; the screen simply did not go
 * through the component that applies it. So an agent reading Hausa got a
 * Hausa heading — "Records not sent" — over an English explanation of why.
 *
 * The translation is now a function rather than something only a component
 * can reach, which is what let the banner keep its own frame and still say
 * the right thing.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { App } from '../App';
import { ApiRequestError, api } from '../lib/api';
import * as drafts from '../lib/drafts';
import { errorText } from '../ui';
import { setAppLanguage } from '../lib/i18n';

// The home screen renders behind the banner and needs a shaped payload, or it
// fails for a reason that has nothing to do with the refusal under test.
const HOME = {
  today: { collected_kobo: '0', successful: '0', total: '0', pending: '0' },
  commission: { lifetime_kobo: '0', available_kobo: '0', today_kobo: '0' },
  taxpayersOnboarded: { today: '0', total: '0' },
  recentTransactions: [],
};

vi.mock('../lib/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/drafts')>()),
  pendingDrafts: vi.fn(),
  syncDrafts: vi.fn(),
  requestBackgroundSync: vi.fn(),
}));

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;
const t = translations.ha;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  setAppLanguage('ha');
});

afterEach(() => {
  cleanup();
  setAppLanguage('en');
});

describe('a refusal the agent has to act on', () => {
  /*
   * The two that actually arrive here. Both are codes the app already
   * translates, and both were rendered in English by this banner.
   */
  it('says an unregistered handset in Hausa', () => {
    const refusal = {
      code: 'DEVICE_NOT_REGISTERED',
      message: 'This device is not registered to your account.',
      moneyStatus: 'NOT_APPLICABLE' as const,
    };
    expect(errorText(refusal as never, t)).toBe(ha.errDeviceNotRegistered);
    expect(errorText(refusal as never, t)).not.toBe(refusal.message);
  });

  it('says a lapsed clearance in Hausa', () => {
    const refusal = {
      code: 'AGENT_NOT_CLEARED',
      message: 'You are not yet cleared to carry out revenue collection.',
      moneyStatus: 'NOT_APPLICABLE' as const,
    };
    expect(errorText(refusal as never, t)).toBe(ha.errAgentNotCleared);
  });

  /*
   * A code the build has never met keeps the server's sentence. Guessing a
   * translation for a message nobody has seen is worse than the English,
   * because the agent cannot tell a guess from a translation.
   */
  it('keeps what the server said when it has no translation', () => {
    const refusal = {
      code: 'SOMETHING_NEW',
      message: 'A refusal this build has not met.',
      moneyStatus: 'NOT_APPLICABLE' as const,
    };
    expect(errorText(refusal as never, t)).toBe('A refusal this build has not met.');
  });

  /*
   * And the fallback the banner itself supplies when the throw was not an
   * `ApiRequestError` at all — it must be the dictionary's sentence, not a
   * bare code.
   */
  it('has a Hausa sentence for a sync that failed some other way', () => {
    expect(ha.shellSyncFailed).toBeTruthy();
    expect(ha.shellSyncFailed).not.toBe(en.shellSyncFailed);
  });
});

/*
 * The tests above hold the translation. This one holds the wiring.
 *
 * They would all still pass with the banner printing `syncProblem.message`
 * again, because they call `errorText` themselves rather than making the
 * screen call it — which is exactly the gap that let the defect live behind
 * a green suite in the first place. This one renders the real banner off a
 * real rejected sync, and fails if the screen stops going through the
 * dictionary.
 */
describe('the banner an agent actually sees', () => {
  it('carries the refusal in Hausa, not the server’s English', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(HOME as never);
    localStorage.setItem(
      'psirs.user',
      JSON.stringify({ id: 'u1', fullName: 'Demo Field Agent', role: 'agent' }),
    );
    vi.mocked(drafts.pendingDrafts).mockResolvedValue([{ clientReference: 'c1' }] as never);
    vi.mocked(drafts.syncDrafts).mockRejectedValue(
      new ApiRequestError(403, {
        code: 'DEVICE_NOT_REGISTERED',
        message: 'This device is not registered to your agent account.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(ha.appRecordsNotSent)).toBeTruthy();
    });
    // The explanation, in the language the heading above it is already in.
    expect(screen.getByText(ha.errDeviceNotRegistered)).toBeTruthy();
    expect(screen.queryByText(/not registered to your agent account/i)).toBeNull();
  });
});
