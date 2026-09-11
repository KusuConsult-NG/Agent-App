/**
 * Forty buttons that went dead without saying what was wrong.
 *
 * Actions that change a person's standing take a typed reason first — suspend
 * an agent, revoke somebody's access, reopen a closed period, reject an
 * identity document — and the button stays disabled until that reason reaches
 * a minimum length. The rule is real and worth having: the reason is the only
 * record of why, and four characters is not a record.
 *
 * Two boxes said so, in their label: "Reason (minimum 10 characters)". The
 * other eighteen did not. So an officer typed "Fraud" into the box, looked at
 * a grey Approve button, and had nothing anywhere telling them what was wrong
 * with what they had written. Nothing was. It was five characters long.
 *
 * `ReasonRule` belongs to the BOX rather than to the button, because several
 * buttons usually read one box — the agent detail screen has three. It names
 * the minimum while the box is short and disappears the moment the rule is
 * met, which is also the only confirmation an officer gets that the button
 * has come alive.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ReasonRule } from '../ui';
import { UserAccessScreen } from '../screens/UserAccess';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

const OFFICER = {
  id: 'u-2',
  full_name: 'Musa Bello',
  phone: '+2348000000002',
  role: 'revenue_officer',
  status: 'ACTIVE',
  last_login_at: '2026-09-09T09:00:00.000Z',
  isSelf: false,
};

const USER = { id: 'u-1', phone: '+2348000000001', fullName: 'Ladi Dung', role: 'admin' };

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.restoreAllMocks();
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

describe('the rule itself', () => {
  it('names the minimum while the box is short of it', () => {
    render(<ReasonRule value="Fraud" minimum={10} />);
    expect(screen.getByText(/At least 10 characters/i)).toBeTruthy();
  });

  it('says nothing once the rule is met', () => {
    render(<ReasonRule value="Suspended after the audit" minimum={10} />);
    expect(screen.queryByText(/At least/i)).toBeNull();
  });

  it('counts what is typed rather than what is padded', () => {
    // Whitespace is not a justification, and the button agrees: every one of
    // these rules is written against `.trim()`.
    render(<ReasonRule value={'         ' + 'ok'} minimum={10} />);
    expect(screen.getByText(/At least 10 characters/i)).toBeTruthy();
  });

  it('is exact at the boundary', () => {
    const { container } = render(<ReasonRule value={'x'.repeat(10)} minimum={10} />);
    expect(container.textContent).toBe('');
    cleanup();
    render(<ReasonRule value={'x'.repeat(9)} minimum={10} />);
    expect(screen.getByText(/At least 10 characters/i)).toBeTruthy();
  });

  it('speaks the language the officer is reading', () => {
    setPortalLanguage('ha');
    render(<ReasonRule value="" minimum={4} />);
    expect(screen.getByText(ha.ofcReasonAtLeastChars!.replace('{{n}}', '4'))).toBeTruthy();
    expect(en.ofcReasonAtLeastChars).not.toBe(ha.ofcReasonAtLeastChars);
  });
});

describe('on the screen that ends somebody’s access', () => {
  /*
   * Rendered rather than asserted about in isolation: "the component works"
   * and "the officer can see it" have been different claims in this codebase
   * often enough to test both.
   */
  const openAccountPanel = async () => {
    vi.spyOn(apiModule.api, 'get').mockResolvedValue({ users: [OFFICER] } as never);
    render(<UserAccessScreen user={USER as never} />);
    fireEvent.click(await screen.findByText(en.ofcUaAccount!, { selector: 'button' }));
  };

  it('tells the officer what the grey button is waiting for', async () => {
    await openAccountPanel();

    await waitFor(() => expect(screen.getByText(/At least 10 characters/i)).toBeTruthy());
  });

  it('stops saying it once the reason is long enough', async () => {
    await openAccountPanel();

    // Present first, so that its later absence means the rule was met rather
    // than that nothing was ever rendered.
    await waitFor(() => expect(screen.getByText(/At least 10 characters/i)).toBeTruthy());

    const box = document.querySelector('#status-reason') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Left the service at the end of August.' } });

    await waitFor(() => expect(screen.queryByText(/At least 10 characters/i)).toBeNull());
  });
});
