/**
 * Where a session is kept, and who decided.
 *
 * The two apps default differently and both defaults are deliberate:
 *
 *   - The agent PWA keeps the refresh token in `localStorage`, because a
 *     field agent whose phone restarts with no signal must be able to keep
 *     collecting and signing in again needs the connection that is missing.
 *   - The officer portal keeps it in `sessionStorage`, because closing the
 *     browser should end a session on a shared government workstation.
 *
 * A tick box now lets either be overridden, and the risk in adding one is not
 * the storage choice — it is forgetting that eight other places read the
 * session back. Changing only the write would sign an agent out the instant
 * the app re-read its own state, which is the feature working precisely
 * backwards, and would look like a broken sign-in rather than a setting.
 *
 * What the choice does not touch is what the server enforces: device binding,
 * the absolute session bound that refreshing cannot move, rotation with reuse
 * detection, and central revocation. It decides only how long this device
 * holds the credential.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { setSession, clearStoredSession, hasStoredSession, getUser } from './api';

const REFRESH_KEY = 'psirs.refresh';
const USER_KEY = 'psirs.user';

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'u1', fullName: 'Amina Bulus', role: 'agent' },
} as unknown as Parameters<typeof setSession>[0];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearStoredSession();
});

describe('an agent who stays signed in', () => {
  it('keeps the refresh token where closing the app does not reach it', () => {
    setSession(session, true);
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-token');
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('is the default, because it always was', () => {
    setSession(session);
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-token');
  });
});

describe('an agent on a borrowed handset', () => {
  it('keeps the refresh token only for as long as the app is open', () => {
    setSession(session, false);
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-token');
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('is still signed in while the app is open', () => {
    // The bug this guards: reading the session back from localStorage alone
    // would report no session at all, one line after a successful sign-in.
    setSession(session, false);
    expect(hasStoredSession()).toBe(true);
    expect(getUser()?.fullName).toBe('Amina Bulus');
  });
});

describe('changing the answer', () => {
  it('does not leave the previous choice behind', () => {
    // A token left in the other store would outlive the decision and defeat
    // it: the agent unticks the box and the old durable token still restores.
    setSession(session, true);
    setSession(session, false);
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('refresh-token');

    setSession(session, true);
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-token');
  });

  it('signs out of both stores at once', () => {
    setSession(session, true);
    clearStoredSession();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
    expect(sessionStorage.getItem(USER_KEY)).toBeNull();
    expect(hasStoredSession()).toBe(false);
  });
});
