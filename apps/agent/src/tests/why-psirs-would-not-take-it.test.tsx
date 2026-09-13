/**
 * What an agent reads when PSIRS refuses a capture they already made.
 *
 * The worst circumstances the platform has. Somebody is standing in front of
 * the agent, has just handed over details or money, and the record will not
 * go. Retrying will not help — a refusal is not a lost signal, which the
 * queue already handles in silence — so this sentence has to be enough to
 * decide what to do while the person is still there.
 *
 * It was the API's English.
 *
 * This one could not be fixed the way the confirmations were. `reject()` does
 * not merely answer the request: it writes the sentence to
 * `offline_drafts.rejection_reason`, which is read back long afterwards by
 * support and by anybody reconciling what an agent says they collected
 * against what PSIRS holds. So the English stays as the record, and a code
 * travels beside it.
 *
 * The part worth noticing is what that bought for free. `reject(error.message)`
 * used to take an `AppError` and keep only its sentence, throwing away a code
 * the application already knew how to translate. Passing the code through
 * means every refusal PSIRS composes deliberately — an already-registered
 * taxpayer, a clearance that has lapsed — is translated by a map that existed
 * before any of this, with nothing invented for it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations, DRAFT_REFUSALS, draftRefusalSentence } from '@psirs/shared';
import { ProfileScreen } from '../screens/More';
import { errorText } from '../ui';
import * as drafts from '../lib/drafts';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

vi.mock('../lib/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/drafts')>()),
  listDrafts: vi.fn(),
}));

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

describe('a refusal an agent has to act on', () => {
  /*
   * The one that comes back most: a taxpayer already on the register. It is
   * an `AppError` in the API, so it arrives with its own code and is
   * translated by the same map `ErrorAlert` uses.
   */
  it('translates a refusal PSIRS composed, through the code it already had', () => {
    const said = errorText(
      {
        code: 'AGENT_NOT_CLEARED',
        message: 'You are not yet cleared to carry out revenue collection.',
      },
      ha,
    );
    expect(said).toBe(ha.errAgentNotCleared);
    expect(said).not.toBe('You are not yet cleared to carry out revenue collection.');
  });

  it('says a capture PSIRS cannot process yet, naming the kind', () => {
    const said = errorText(
      { code: 'DRAFT_TYPE_UNSUPPORTED', message: draftRefusalSentence('DRAFT_TYPE_UNSUPPORTED') },
      ha,
    );
    expect(said).toBe(ha.errDraftTypeUnsupported);
    expect(said).toContain('{{type}}');
  });

  it('says a capture that could not be processed at all', () => {
    const said = errorText(
      { code: 'DRAFT_NOT_PROCESSED', message: draftRefusalSentence('DRAFT_NOT_PROCESSED') },
      ha,
    );
    expect(said).toBe(ha.errDraftNotProcessed);
  });

  /*
   * The validation case carries its failing fields separately, because "there
   * is something wrong with this capture" is not something anybody can act on
   * and the list of fields is.
   */
  it('carries the failing fields into the sentence', () => {
    const said = errorText({ code: 'DRAFT_INVALID', message: '' }, ha).replace(
      '{{detail}}',
      'phone; tin',
    );
    expect(said).toContain('phone; tin');
    expect(said).not.toContain('{{detail}}');
  });

  /*
   * No code at all is how a refusal recorded before this existed comes back,
   * and how the one server path that replays a reason stored earlier answers
   * — its code cannot be recovered from the sentence it was written as. The
   * stored English is better than a blank where the reason belongs.
   */
  it('keeps the stored English when there is no code to translate', () => {
    const recorded = 'This person is already registered as Rifkatu Bala (TIN 481…).';
    expect(errorText({ code: 'SOMETHING_UNKNOWN', message: recorded }, ha)).toBe(recorded);
  });
});

describe('the record kept alongside', () => {
  /*
   * `rejection_reason` stays one language on purpose: it is read by support
   * and by reconciliation, not by the agent. What must not happen is a
   * placeholder reaching it.
   */
  it('composes a complete English sentence for the record', () => {
    expect(draftRefusalSentence('DRAFT_INVALID', { detail: 'phone is required' })).toContain(
      'phone is required',
    );
    for (const refusal of DRAFT_REFUSALS) {
      const sentence = draftRefusalSentence(refusal, {
        detail: 'x',
        type: 'taxpayer',
        reference: 'c-1',
      });
      expect(sentence, `${refusal} left a placeholder`).not.toContain('{{');
      expect(sentence.trim().length, `${refusal} is empty`).toBeGreaterThan(0);
    }
  });

  it('has a Hausa sentence for every refusal, and they differ from English', () => {
    const keys = [
      'errDraftInvalid',
      'errDraftTypeUnsupported',
      'errDraftNotProcessed',
      'errDraftNotPermitted',
    ] as const;
    /*
     * The count is pinned so a refusal added without a Hausa sentence fails
     * here rather than reaching an agent in English. It caught the fourth.
     */
    expect(DRAFT_REFUSALS.length).toBe(keys.length);
    for (const key of keys) {
      const e = (en as unknown as Record<string, string>)[key];
      const h = (ha as unknown as Record<string, string>)[key];
      expect(typeof h, `${key} missing in ha`).toBe('string');
      expect(h.trim().length, `${key} empty in ha`).toBeGreaterThan(0);
      expect(e, `${key} identical in both languages`).not.toBe(h);
    }
  });

  /*
   * Every refusal tells the agent the capture is still on the phone. That is
   * the sentence that stops somebody writing the details on paper and
   * starting again, and it has to survive translation.
   */
  it('tells the agent in both languages that the capture is not lost', () => {
    expect(en.errDraftInvalid).toMatch(/still on your phone/i);
    expect(en.errDraftNotProcessed).toMatch(/still on your phone/i);
    expect(ha.errDraftInvalid).toMatch(/wayarka/i);
    expect(ha.errDraftNotProcessed).toMatch(/wayarka/i);
    expect(ha.errDraftTypeUnsupported).toMatch(/rasa/i);
  });
});

/*
 * The tests above hold the translation. This one holds the wiring.
 *
 * Every one of them would still pass with the list printing `draft.message`
 * again, because they call `errorText` themselves rather than making the
 * screen call it — which is the gap that let this whole class of fault live
 * behind a green suite in the first place. This renders the real list.
 */
describe('the saved-records list an agent actually opens', () => {
  it('gives the refusal in Hausa, not the sentence PSIRS stored', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never);
    vi.mocked(drafts.listDrafts).mockResolvedValue([
      {
        clientReference: 'c-1',
        draftType: 'TAXPAYER',
        payload: {},
        capturedAt: new Date().toISOString(),
        status: 'REJECTED',
        code: 'AGENT_NOT_CLEARED',
        message: 'You are not yet cleared to carry out revenue collection.',
      },
    ] as never);

    render(<ProfileScreen onSignOut={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(new RegExp(escape(ha.errAgentNotCleared)))).toBeTruthy(),
    );
    expect(screen.queryByText(/not yet cleared to carry out/i)).toBeNull();
  });
});

/** Regex-escape, so a dictionary sentence can be matched inside a longer line. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
