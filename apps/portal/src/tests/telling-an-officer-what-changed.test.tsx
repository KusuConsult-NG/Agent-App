/**
 * What an administrator reads after changing somebody's access.
 *
 * This screen exists on a stated premise: "an access decision made from a
 * label alone is a guess." It shows the role in the words the platform uses
 * for it rather than the code, and one line about what the role is for,
 * because "auditor" and "finance officer" are not self-explanatory to
 * somebody choosing between them at speed.
 *
 * Then it rendered the server's `message` — an English sentence, on a screen
 * offering Hausa, naming the new role as `finance officer`: the code with its
 * underscores swapped for spaces. Not the label the picker above it had just
 * shown, and not a label at all. The same for a closed account, which read
 * `suspended`, the enum lowercased.
 *
 * The counts and the enum values are on the response either way, so the
 * sentence is composed here now, from the dictionary and the same `enumLabel`
 * the control uses. What this file holds is that an administrator is told
 * what happened, in their own language, in the platform's own words for it —
 * and that the sessions they ended are named, because that is the part with a
 * consequence for somebody else.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations, enumLabel } from '@psirs/shared';
import { UserAccessScreen } from '../screens/UserAccess';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

/**
 * A dictionary string as a literal to search for, not as a pattern.
 *
 * These strings say "session(s)", and `(s)` in a RegExp is a capture group —
 * so an unescaped one matches "sessions" and never the "session(s)" actually
 * on the screen. Escaped once here rather than remembered at five call sites.
 */
function literally(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

const USER = { id: 'u-1', phone: '+2348000000001', fullName: 'Ladi Dung', role: 'admin' };

const OFFICER = {
  id: 'u-2',
  full_name: 'Musa Bello',
  phone: '+2348000000002',
  role: 'revenue_officer',
  status: 'ACTIVE',
  last_login_at: '2026-09-09T09:00:00.000Z',
  isSelf: false,
};

/** What the role endpoint answers. The English `message` is still on the wire. */
let roleReply: Record<string, unknown> = {};

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  roleReply = {
    previousRole: 'revenue_officer',
    newRole: 'finance_officer',
    sessionsEnded: 2,
    message: 'Musa Bello is now finance officer. 2 open sessions ended, so they must sign in again.',
  };
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/users')) return { users: [OFFICER] } as never;
    return { assigned: [], available: [] } as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async () => roleReply as never);
  vi.spyOn(apiModule, 'stepUp').mockResolvedValue(undefined as never);
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

/** Open the panel for the one officer and fill in a valid change. */
async function changeTheirRole(to = 'finance_officer'): Promise<void> {
  render(<UserAccessScreen user={USER as never} />);
  fireEvent.click(await screen.findByText(en.ofcUaChangeAccess, { selector: 'button' }));
  fireEvent.change(await screen.findByLabelText(en.ofcUaNewRole), { target: { value: to } });
  fireEvent.change(screen.getByLabelText(en.ofcUaWhyChanging), {
    target: { value: 'Transferred to the finance department this month.' },
  });
  fireEvent.click(screen.getByText(en.ofcUaChangeAccessAndSign));
}

describe('telling an officer what changed', () => {
  it('names the new role the way the picker named it, not by its code', async () => {
    await changeTheirRole();

    const expected = en.ofcUaNowRole
      .replace('{{name}}', 'Musa Bello')
      .replace('{{role}}', enumLabel('finance_officer', translations.en));

    await waitFor(() => {
      expect(screen.getByText(literally(expected))).toBeTruthy();
    });
    // The code, de-underscored, which is what used to be shown.
    expect(screen.queryByText(/is now finance officer\./)).toBeNull();
  });

  /**
   * The sessions ended are named, because somebody else is affected.
   *
   * A role change signs the officer out everywhere. The administrator who did
   * it should know they have just interrupted somebody mid-task rather than
   * find out when the phone rings.
   */
  it('says how many sessions the change ended', async () => {
    await changeTheirRole();
    await waitFor(() => {
      expect(screen.getByText(literally(en.ofcUaSessionsEnded.replace('{{n}}', '2')))).toBeTruthy();
    });
  });

  it('says so plainly when nobody was signed out', async () => {
    roleReply = { ...roleReply, sessionsEnded: 0 };
    await changeTheirRole();
    await waitFor(() => {
      expect(screen.getByText(literally(en.ofcUaNoOpenSessions))).toBeTruthy();
    });
  });

  it('tells an administrator reading Hausa in Hausa', async () => {
    setPortalLanguage('ha');
    render(<UserAccessScreen user={USER as never} />);
    fireEvent.click(await screen.findByText(ha.ofcUaChangeAccess, { selector: 'button' }));
    fireEvent.change(await screen.findByLabelText(ha.ofcUaNewRole), {
      target: { value: 'finance_officer' },
    });
    fireEvent.change(screen.getByLabelText(ha.ofcUaWhyChanging), {
      target: { value: 'An canja shi zuwa sashen kudi a wannan watan.' },
    });
    fireEvent.click(screen.getByText(ha.ofcUaChangeAccessAndSign));

    await waitFor(() => {
      expect(screen.getByText(literally(ha.ofcUaSessionsEnded.replace('{{n}}', '2')))).toBeTruthy();
    });
    // The server's English sentence is on the wire and must not be on screen.
    expect(screen.queryByText(/must sign in again/)).toBeNull();
  });

  it('has real Hausa for every half of both confirmations', () => {
    const keys = [
      'ofcUaNowRole',
      'ofcUaSessionsEnded',
      'ofcUaNoOpenSessions',
      'ofcUaCanSignInAgain',
      'ofcUaAccountIsNow',
      'ofcUaSessionsEndedNow',
    ] as const;

    for (const key of keys) {
      expect(ha[key], `${key} has no Hausa`).toBeTruthy();
      expect(ha[key], `${key} was never translated`).not.toBe(en[key]);
      for (const token of en[key].match(/\{\{\w+\}\}/g) ?? []) {
        expect(ha[key], `${key} lost ${token}`).toContain(token);
      }
    }
    // "They had no open sessions" is a negative and has to stay one.
    // Case-insensitive: this one opens the sentence, so it is "Ba", and a
    // lower-case-only pattern silently fails a string that is perfectly good.
    expect(ha.ofcUaNoOpenSessions).toMatch(/\b(ba|babu|bai)\b/i);
  });
});
