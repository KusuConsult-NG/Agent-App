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
import { translations, DRAFT_REFUSALS, draftRefusalSentence, enumLabel } from '@psirs/shared';
import { ProfileScreen } from '../screens/More';
import { TRANSLATED_ERRORS, errorText } from '../ui';
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

  /*
   * The kind is a hole at this point, and that is `errorText` working as
   * specified: it fills placeholders from the refusal's `details`, and the
   * sync response carries none for this one. `refusalText` fills it from the
   * draft in hand, which is what the agent is shown — asserted on the
   * rendered list at the bottom of this file, because asserting it here is
   * asserting the hole.
   */
  it('leaves the kind for the screen to fill, having no field for it', () => {
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

  /*
   * THE HOLE IN THE SENTENCE.
   *
   * Three of these translations carry a placeholder and the API sends a value
   * for one. `reject()` in `routes/taxpayers.ts` says that is on purpose, and
   * says whose job the rest is: "The phone knows its own draft type and
   * reference and can fill those in itself; this is the one part of a refusal
   * it cannot work out."
   *
   * The phone filled `{{detail}}` and not the other two. So a capture refused
   * as the wrong kind read `shigarwa irin "{{type}}"`, and one PSIRS could not
   * process at all read `ka ba da lamba {{reference}} ga tallafi` — quote
   * reference {{reference}} to support, which is the only instruction in that
   * sentence and it named nothing. In English too, since the dictionary's
   * English carries the same placeholders and the filled sentence the API
   * composed is discarded the moment the code is in the map.
   *
   * Both languages are asserted because the English is what a reviewer reads
   * when checking the Hausa, and here it was wrong in the same way.
   */
  for (const lang of ['ha', 'en'] as const) {
    it(`names the kind of capture PSIRS cannot process, in ${lang}`, async () => {
      setAppLanguage(lang);
      vi.spyOn(api, 'get').mockResolvedValue({} as never);
      vi.mocked(drafts.listDrafts).mockResolvedValue([
        rejected('c-type', 'VEHICLE_CAPTURE', 'DRAFT_TYPE_UNSUPPORTED'),
      ] as never);

      render(<ProfileScreen onSignOut={() => {}} />);

      const line = await waitFor(() => meta());
      expect(line, 'the placeholder reached the agent').not.toMatch(/\{\{\w+\}\}/);
      expect(line).toContain(enumLabel('VEHICLE_CAPTURE', translations[lang]));
    });

    it(`gives the reference to quote to support, in ${lang}`, async () => {
      setAppLanguage(lang);
      vi.spyOn(api, 'get').mockResolvedValue({} as never);
      vi.mocked(drafts.listDrafts).mockResolvedValue([
        rejected('c-ref-7788', 'TAXPAYER_REGISTRATION', 'DRAFT_NOT_PROCESSED'),
      ] as never);

      render(<ProfileScreen onSignOut={() => {}} />);

      const line = await waitFor(() => meta());
      expect(line, 'the placeholder reached the agent').not.toMatch(/\{\{\w+\}\}/);
      expect(line, 'the one thing support can act on').toContain('c-ref-7788');
    });
  }

  /*
   * And the refusal whose hole this screen cannot fill at any later date.
   *
   * `TAXPAYER_ALREADY_EXISTS` names who the person is already registered as.
   * That travels as a `details` field on the direct request and the screen
   * that made it substitutes it; a sync response carries a code, a sentence
   * and at most `detail`, so the queue has no way to send it and never will.
   *
   * The stored English is a complete sentence naming the same person. It
   * loses to a translation and beats one with a gap where the name goes.
   */
  it('keeps the stored English rather than show a gap it cannot close', async () => {
    setAppLanguage('ha');
    const stored = 'This person is already registered as Rifkatu Bala (TIN 4810002). ' +
      'A second record would be a duplicate.';
    vi.spyOn(api, 'get').mockResolvedValue({} as never);
    vi.mocked(drafts.listDrafts).mockResolvedValue([
      { ...rejected('c-dup', 'TAXPAYER_REGISTRATION', 'TAXPAYER_ALREADY_EXISTS'), message: stored },
    ] as never);

    render(<ProfileScreen onSignOut={() => {}} />);

    const line = await waitFor(() => meta());
    expect(line).not.toMatch(/\{\{\w+\}\}/);
    expect(line, 'the name is the part the agent needs').toContain('Rifkatu Bala');
    // Not the Hausa with a hole in it, which is what it would otherwise be.
    expect(line).not.toContain('a matsayin .');
  });

  /*
   * WHICH REFUSALS LOSE THEIR TRANSLATION HERE, counted rather than assumed.
   *
   * The first version of this was a sweep asserting no placeholder reaches the
   * screen, and it could not fail. The fallback above guarantees it: a
   * translation with a hole left in it is replaced by the stored English,
   * which has no hole. Every mutation of the two `replace` calls left that
   * sweep green — the targeted tests above killed them, and the sweep was a
   * tautology sitting next to them looking like cover.
   *
   * So it asks the question the fallback actually answers: which codes, if
   * they arrive as a refused capture, are shown in English because their
   * translation names something this screen has not got. That set must be
   * exactly the one declared below. It fails if a new placeholder is added to
   * the map without a decision, if a placeholder stops being filled — the two
   * `replace` calls are covered by this as well as by the tests above — and if
   * a code declared here becomes fillable and the reason is left behind.
   */
  const FALLS_BACK_TO_ENGLISH: Record<string, string> = {
    TAXPAYER_ALREADY_EXISTS:
      'Names the record it collides with — who the person is already registered as — which ' +
      'only the server knows and which a sync response has no field for.',
    TIN_NOT_FOUND:
      'Names the TIN that was not found. It is in the draft payload, so this is not ' +
      'impossible, but reaching into a payload by draft type to fill one sentence is a ' +
      'different kind of thing from reading two fields off the draft, and the English names ' +
      'the number too.',
    TRAINING_SCORE_BELOW_PASS_MARK:
      'Names a score, a module and a pass mark. Not reachable as a capture at all — the ' +
      'queue carries taxpayer, vehicle and business captures, and training is none of them.',
    INVOICE_NOT_PAYABLE:
      'Names the state of a bill. Not reachable as a capture: there is no draft type for a ' +
      'payment, by Addendum §23, which is why offline cannot authorise one.',
    TRANSACTION_NOT_PAYABLE: 'The same, for a charge rather than a bill.',
  };

  for (const lang of ['ha', 'en'] as const) {
    it(`falls back to English on exactly the declared refusals, in ${lang}`, async () => {
      setAppLanguage(lang);
      const codes = Object.keys(TRANSLATED_ERRORS);
      expect(codes.length, 'the map was read as empty').toBeGreaterThanOrEqual(30);

      vi.spyOn(api, 'get').mockResolvedValue({} as never);
      vi.mocked(drafts.listDrafts).mockResolvedValue(
        codes.map((code, index) => ({
          ...rejected(`c-${index}`, 'TAXPAYER_REGISTRATION', code),
          // The one field the API does send, and only on the refusal it
          // sends it with, so this does not quietly fill a hole for a code
          // that would arrive without it.
          ...(code === 'DRAFT_INVALID' ? { detail: 'phone; identityNumber' } : {}),
        })) as never,
      );

      render(<ProfileScreen onSignOut={() => {}} />);

      await waitFor(() =>
        expect(document.querySelectorAll('.list__meta').length).toBe(codes.length),
      );
      const lines = [...document.querySelectorAll('.list__meta')].map(
        (node) => node.textContent ?? '',
      );

      // Nothing reaches the agent with a gap in it, whichever way it got there.
      expect(lines.filter((line) => /\{\{\w+\}\}/.test(line))).toEqual([]);

      const inEnglish = codes
        .filter((_, index) => lines[index]!.includes(storedEnglish(codes[index]!)))
        .sort();
      expect(inEnglish).toEqual(Object.keys(FALLS_BACK_TO_ENGLISH).sort());
    });
  }
});

/** The sentence PSIRS stored, as the fixture writes it. */
function storedEnglish(code: string): string {
  return `PSIRS refused this capture (${code}).`;
}

/** A refused capture, with the English PSIRS stores beside the code. */
function rejected(clientReference: string, draftType: string, code: string) {
  return {
    clientReference,
    draftType,
    payload: {},
    capturedAt: new Date().toISOString(),
    status: 'REJECTED' as const,
    code,
    message: storedEnglish(code),
  };
}

/** The one list line the screen printed, refusal and all. */
function meta(): string {
  const node = document.querySelector('.list__meta');
  if (!node) throw new Error('the saved-records list has not rendered yet');
  return node.textContent ?? '';
}

/** Regex-escape, so a dictionary sentence can be matched inside a longer line. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
