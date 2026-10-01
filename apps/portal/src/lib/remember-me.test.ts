/**
 * The officer portal forgets by default, and that is the decision.
 *
 * `api.ts` states it: the refresh token goes to `sessionStorage` so closing
 * the browser ends an officer's session rather than leaving a durable
 * credential on a shared government workstation (PRD §62, §54).
 *
 * A tick box now allows the other choice, and the default must stay the safe
 * one — the shared desk is the common case here, and a preference that
 * remembered itself would carry one officer's decision to the next person to
 * sit down, who never made it. So: unticked every time, and nothing persists
 * the box's own state.
 *
 * What the choice does not touch is what the server enforces: the absolute
 * session bound, rotation with reuse detection, and central revocation apply
 * either way. It decides only how long this computer holds the credential.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { setSession, getUser, hasStoredSession } from './api';

const REFRESH_KEY = 'psirs.portal.refresh';
const USER_KEY = 'psirs.portal.user';

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'u1', fullName: 'Revenue Officer', role: 'revenue_officer' },
} as unknown as Parameters<typeof setSession>[0];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setSession(null);
});

describe('an officer at a shared desk', () => {
  it('leaves nothing that survives the browser closing', () => {
    setSession(session);
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-token');
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('gets that without asking — the safe answer is the default', () => {
    // If this ever flips, every shared workstation in the state changes
    // behaviour silently.
    setSession(session);
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
  });
});

describe('an officer on their own machine', () => {
  it('may choose to stay signed in', () => {
    setSession(session, true);
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-token');
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('is signed in straight away, not only after a reload', () => {
    setSession(session, true);
    expect(hasStoredSession()).toBe(true);
    expect(getUser()?.fullName).toBe('Revenue Officer');
  });
});

describe('changing the answer', () => {
  it('does not leave the previous choice behind', () => {
    setSession(session, true);
    setSession(session, false);
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-token');
  });

  it('signs out of both stores at once', () => {
    setSession(session, true);
    setSession(null);
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
    expect(sessionStorage.getItem(USER_KEY)).toBeNull();
  });
});
