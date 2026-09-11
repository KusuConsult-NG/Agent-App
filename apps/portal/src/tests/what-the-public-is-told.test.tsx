/**
 * The one part of this platform built for people who do not work here.
 *
 * A citizen checking their own status, and a referee vouching for somebody
 * who wants to collect revenue, meet PSIRS here with nobody standing beside
 * them to translate. The page offers Hausa. Six sentences on it were composed
 * in `apps/api` and rendered exactly as they arrived.
 *
 * What makes these different from the blockers, the duplicate reasons, the
 * verification answers and the chain verdicts — all of which needed a code
 * inventing and a server change — is that nothing had to be sent. In every
 * case the value the sentence was built from was already on the wire beside
 * it: the referee's resulting status, the confirmed and rejected counts, the
 * number of name matches. The screen was reaching past the data for the
 * prose.
 *
 * The referee ones are the sharpest. A referee is not a taxpayer and not
 * staff; they are doing an applicant a favour and may never deal with PSIRS
 * again. "Your identity could not be verified" is the worst sentence in the
 * set to hand somebody in a language they did not choose.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { CitizenPortalScreen } from '../screens/Public';
import { api } from '../lib/api';
import { setPublicLanguage } from '../lib/i18n';

const ha = translations.ha;
const en = translations.en;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  setPublicLanguage('ha');
});

afterEach(() => {
  cleanup();
  setPublicLanguage('en');
});

function answering(body: unknown) {
  vi.spyOn(api, 'publicGet').mockResolvedValue(body as never);
}

/** Pick a search mode, type something, and submit. */
async function searchBy(mode: 'tin' | 'phone' | 'name', value: string) {
  const label =
    mode === 'tin' ? ha.pubCitizenModeTin
    : mode === 'phone' ? ha.pubCitizenModePhone
    : ha.pubCitizenModeName;
  fireEvent.click(await screen.findByRole('button', { name: label }));
  fireEvent.change(screen.getByLabelText(/./, { selector: '#citizen-input' }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: ha.pubCitizenCheck }));
}

describe('a citizen who finds nothing', () => {
  /*
   * The server sent one of two sentences depending on what was searched. The
   * screen ran the search, so it knows which — no round trip was ever needed
   * to say this.
   */
  it('names the TIN search that came back empty, in Hausa', async () => {
    answering({ found: false, message: 'No taxpayer record found for that TIN.' });
    render(<CitizenPortalScreen />);
    await searchBy('tin', 'P1234567890');

    await waitFor(() => expect(screen.getByText(ha.pubCitizenNoTinMatch)).toBeTruthy());
    expect(screen.queryByText('No taxpayer record found for that TIN.')).toBeNull();
  });

  it('names the phone search instead, when that is what was searched', async () => {
    answering({ found: false, message: 'No taxpayer record found for that phone number.' });
    render(<CitizenPortalScreen />);
    await searchBy('phone', '08012345678');

    await waitFor(() => expect(screen.getByText(ha.pubCitizenNoPhoneMatch)).toBeTruthy());
    // And not the TIN sentence, which is the whole point of knowing the mode.
    expect(screen.queryByText(ha.pubCitizenNoTinMatch)).toBeNull();
  });
});

describe('a citizen whose name matches several people', () => {
  /*
   * THE HINT THAT COULD NOT RENDER.
   *
   * `pubCitizenTooMany` — "use your TIN or exact phone number" — sat behind
   * `!result.found && result.count > 1`. The API answers a name search with
   * `found: count > 0`, so more than one match makes `found` true and that
   * whole block is skipped. The one string telling somebody how to reach
   * their own record was unreachable for every person who needed it.
   */
  it('tells them how to reach their own record', async () => {
    answering({ found: true, count: 5, message: '5 records found with a similar name.' });
    render(<CitizenPortalScreen />);
    await searchBy('name', 'Danjuma');

    await waitFor(() =>
      expect(screen.getByText(ha.pubCitizenManyMatches.replace('{{count}}', '5'))).toBeTruthy(),
    );
    expect(screen.getByText(ha.pubCitizenTooMany)).toBeTruthy();
  });

  it('counts one match as one, not as five', async () => {
    answering({ found: true, count: 1, message: 'One matching record found.' });
    render(<CitizenPortalScreen />);
    await searchBy('name', 'Danjuma');

    await waitFor(() => expect(screen.getByText(ha.pubCitizenOneMatch)).toBeTruthy());
    // Still worth telling them how to see the record itself.
    expect(screen.getByText(ha.pubCitizenTooMany)).toBeTruthy();
  });

  it('says it in English for a citizen reading English', async () => {
    setPublicLanguage('en');
    answering({ found: true, count: 3, message: '3 records found with a similar name.' });
    render(<CitizenPortalScreen />);

    fireEvent.click(await screen.findByRole('button', { name: en.pubCitizenModeName }));
    fireEvent.change(screen.getByLabelText(/./, { selector: '#citizen-input' }), {
      target: { value: 'Danjuma' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.pubCitizenCheck }));

    await waitFor(() =>
      expect(screen.getByText(en.pubCitizenManyMatches.replace('{{count}}', '3'))).toBeTruthy(),
    );
  });
});

describe('the sentences themselves', () => {
  it('has both languages for every outcome a member of the public reads', () => {
    const keys = [
      'pubRefereeThankYouCleared',
      'pubRefereeCouldNotVerify',
      'pubRefereeUnderReview',
      'pubRefereeDeclineRecorded',
      'pubGroupAllConfirmed',
      'pubGroupSomeConfirmed',
      'pubCitizenNoTinMatch',
      'pubCitizenNoPhoneMatch',
      'pubCitizenNoNameMatch',
      'pubCitizenOneMatch',
      'pubCitizenManyMatches',
    ] as const;
    for (const key of keys) {
      for (const lang of ['en', 'ha'] as const) {
        const text = (translations[lang] as unknown as Record<string, string>)[key];
        expect(typeof text, `${key} missing in ${lang}`).toBe('string');
        expect(text.trim().length, `${key} empty in ${lang}`).toBeGreaterThan(0);
      }
      // The two must differ, or one of them is untranslated English.
      expect(
        (en as unknown as Record<string, string>)[key],
        `${key} is identical in both languages`,
      ).not.toBe((ha as unknown as Record<string, string>)[key]);
    }
  });

  it('carries the placeholders the screens fill in', () => {
    for (const lang of [en, ha] as const) {
      const d = lang as unknown as Record<string, string>;
      expect(d.pubGroupAllConfirmed).toContain('{{confirmed}}');
      expect(d.pubGroupSomeConfirmed).toContain('{{confirmed}}');
      expect(d.pubGroupSomeConfirmed).toContain('{{rejected}}');
      expect(d.pubCitizenManyMatches).toContain('{{count}}');
    }
  });

  /*
   * A referee reads one of three, and which one depends on a status the
   * response already carried. Held here rather than by rendering the referee
   * screen, which needs a live invitation to reach the form at all.
   */
  it('has a distinct sentence for each way a referee check can end', () => {
    const outcomes = [
      ha.pubRefereeThankYouCleared,
      ha.pubRefereeCouldNotVerify,
      ha.pubRefereeUnderReview,
    ];
    expect(new Set(outcomes).size).toBe(3);
  });
});
