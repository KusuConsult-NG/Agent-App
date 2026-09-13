/**
 * The one machine an administrator could not block was somebody else's.
 *
 * Blocking a device ends every session it holds and stops it opening another.
 * It is the single control on this screen gated behind `user:manage`, and the
 * case its own comment gives for it is exact: "a laptop already in somebody
 * else's hands."
 *
 * `MyAccessScreen` fetched `/government/sessions/mine` and nothing else. So
 * the only devices ever loaded were the caller's own, and the only laptop an
 * administrator could block was the one they were sitting at — which is the
 * one case the control is not for.
 *
 * `GET /government/users/:id/sessions` existed the whole time, permissioned on
 * `user:manage` and listed in `API.md`. No screen called it. That is the third
 * endpoint found today built, guarded, documented and unreachable — after the
 * audit report's checksum recomputation and a distribution round's summary.
 *
 * And, as with those two, the screen's own doc comment said it was reachable:
 * "The same screen, for somebody else, when they hold `user:manage`."
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { MyAccessScreen } from '../screens/MyAccess';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

const ME = { id: 'u-1', phone: '+2348000000001', fullName: 'Ladi Dung', role: 'admin' };
const THEM = { id: 'u-2', full_name: 'Musa Bello' };

const MY_DEVICE = {
  id: 'dv-1',
  label: 'Chrome on Windows',
  user_agent: null,
  first_seen_at: '2026-01-04T09:00:00.000Z',
  last_seen_at: '2026-09-09T09:00:00.000Z',
  status: 'ACTIVE',
  blocked_at: null,
  block_reason: null,
  blocked_by_name: null,
  live_sessions: 1,
};
const THEIR_DEVICE = { ...MY_DEVICE, id: 'dv-2', label: 'Firefox on Ubuntu' };

/** Every path the screen asked for, so the test can say which it chose. */
let asked: string[] = [];

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  asked = [];
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    return (path.includes('/sessions/mine')
      ? { sessions: [], devices: [MY_DEVICE] }
      : { sessions: [], devices: [THEIR_DEVICE] }) as never;
  });
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

describe('blocking somebody else’s laptop', () => {
  it('asks for that officer’s sessions, not the caller’s', async () => {
    render(<MyAccessScreen user={ME as never} officer={THEM} />);

    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]).toBe('/government/users/u-2/sessions');
    expect(asked[0]).not.toContain('mine');
  });

  /**
   * The device that can be blocked is theirs.
   *
   * This is the whole finding in one assertion: before, an administrator
   * looking to block a colleague's machine was shown their own.
   */
  it('shows their machine, and not the administrator’s own', async () => {
    render(<MyAccessScreen user={ME as never} officer={THEM} />);

    await waitFor(() => expect(screen.getByText('Firefox on Ubuntu')).toBeTruthy());
    expect(screen.queryByText('Chrome on Windows')).toBeNull();
  });

  it('names whose access is on the screen', async () => {
    render(<MyAccessScreen user={ME as never} officer={THEM} />);
    await waitFor(() => {
      expect(screen.getByText(en.ofcUaAccessFor.replace('{{name}}', 'Musa Bello'))).toBeTruthy();
    });
  });

  /**
   * And an officer looking at their own is unchanged.
   *
   * The self-service case is the one that needs no permission, and it must
   * keep asking for `mine` — an officer whose role was narrowed still has to
   * be able to see their own open sessions.
   */
  it('still asks for the caller’s own when no officer is named', async () => {
    render(<MyAccessScreen user={ME as never} />);

    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]).toBe('/government/sessions/mine');
    await waitFor(() => expect(screen.getByText('Chrome on Windows')).toBeTruthy());
    expect(screen.getByText(en.ofcAcSessions)).toBeTruthy();
  });

  it('names them in Hausa too', async () => {
    setPortalLanguage('ha');
    render(<MyAccessScreen user={ME as never} officer={THEM} />);
    await waitFor(() => {
      expect(screen.getByText(ha.ofcUaAccessFor.replace('{{name}}', 'Musa Bello'))).toBeTruthy();
    });
    expect(screen.queryByText(en.ofcUaAccessFor.replace('{{name}}', 'Musa Bello'))).toBeNull();
  });
});
