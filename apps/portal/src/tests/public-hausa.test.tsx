/**
 * The account-free screens, in the language the reader chose.
 *
 * The agent application has carried Hausa since it was built. These screens did
 * not, and they are the ones opened by people with no account and no training:
 * a community leader vouching for an applicant, a cooperative chairman
 * confirming who belongs, a citizen looking up what they owe.
 *
 * The referee is the sharpest case. They tick four declarations, one of which
 * says that providing false information may have consequences, and the API
 * records four booleans and nothing about the words. What the referee
 * understood themselves to be agreeing to is exactly what the screen showed
 * them — so those four sentences being in English regardless of the toggle was
 * not a cosmetic gap.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { getTranslation } from '@psirs/shared';
import { RefereePortalScreen } from '../screens/Public';
import { setPublicLanguage } from '../lib/i18n';
import { api } from '../lib/api';

const ha = getTranslation('ha');
const en = getTranslation('en');

const INVITATION = {
  refereeId: 'ref-1',
  referenceCode: 'REF/2026/000001',
  refereeName: 'Musa Danladi',
  applicantName: 'Ladi Dung',
  applicantLga: 'Jos North',
  relationship: 'Community leader who knows the applicant',
  category: 'COMMUNITY_LEADER',
  expiresAt: '2026-12-31T00:00:00.000Z',
  // What the API actually sends. The screen must not render these.
  declarations: [
    'I know this person.',
    'The information presented is reasonably accurate.',
    'I am willing to act as referee.',
    'I understand that providing false information may have consequences.',
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  setPublicLanguage('en');
  vi.spyOn(api, 'publicGet').mockResolvedValue(INVITATION as never);
  vi.spyOn(api, 'publicPost').mockResolvedValue({ message: 'Recorded.' } as never);
});

afterEach(() => {
  cleanup();
  setPublicLanguage('en');
});

describe('the referee can read the page in Hausa', () => {
  it('offers the choice on the screen, not behind a menu', async () => {
    render(<RefereePortalScreen token="tok-1" />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /hausa/i }).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: /english/i }).length).toBeGreaterThan(0);
  });

  it('switches the page when the choice is made', async () => {
    render(<RefereePortalScreen token="tok-1" />);
    await waitFor(() => expect(screen.getByText(en.pubRefereeConfirmEach)).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: /hausa/i })[0]!);

    await waitFor(() => expect(screen.getByText(ha.pubRefereeConfirmEach)).toBeTruthy());
    expect(screen.queryByText(en.pubRefereeConfirmEach)).toBeNull();
  });

  it('translates the four declarations rather than rendering the API’s English', async () => {
    setPublicLanguage('ha');
    render(<RefereePortalScreen token="tok-1" />);

    await waitFor(() => expect(screen.getByText(ha.pubDeclarationKnows)).toBeTruthy());
    expect(screen.getByText(ha.pubDeclarationAccurate)).toBeTruthy();
    expect(screen.getByText(ha.pubDeclarationWilling)).toBeTruthy();
    expect(screen.getByText(ha.pubDeclarationConsequences)).toBeTruthy();

    // The strings the API sent must not appear anywhere on the page.
    for (const english of INVITATION.declarations) {
      expect(screen.queryByText(english)).toBeNull();
    }
  });

  it('translates the decline confirmation, which is the irreversible one', async () => {
    setPublicLanguage('ha');
    render(<RefereePortalScreen token="tok-1" />);

    const declineButton = await screen.findByRole('button', { name: ha.pubRefereeDecline });
    fireEvent.click(declineButton);

    expect(await screen.findByText(ha.pubDeclineBody2)).toBeTruthy();
    expect(screen.getByRole('button', { name: ha.pubDeclineNo })).toBeTruthy();
    expect(screen.getByRole('button', { name: ha.pubDeclineYes })).toBeTruthy();
  });
});

describe('the Hausa the public screens carry', () => {
  /**
   * The tier whose absence costs something a person bears. Same reasoning as
   * the agent application's safety strings: a referee who cannot read what
   * they are agreeing to is agreeing to it anyway.
   */
  const MUST_BE_TRANSLATED = [
    'pubDeclarationKnows',
    'pubDeclarationAccurate',
    'pubDeclarationWilling',
    'pubDeclarationConsequences',
    'pubDeclineTitle',
    'pubDeclineBody2',
    'pubDeclineYes',
    'pubDeclineNo',
    'pubAttestIntro',
    'pubAttestYes',
    'pubAttestNo',
    'pubRefereeIdHint',
    'pubVerifyPrivacy',
  ] as const;

  it('is genuinely Hausa and not English copied across', () => {
    const copied = MUST_BE_TRANSLATED.filter((key) => en[key].trim() === ha[key].trim());
    expect(copied, `left in English: ${copied.join(', ')}`).toEqual([]);
  });

  it('says nothing in Hausa that is empty', () => {
    const blank = MUST_BE_TRANSLATED.filter((key) => !ha[key] || ha[key].trim().length < 3);
    expect(blank).toEqual([]);
  });
});
