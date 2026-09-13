/**
 * A connection that dropped for a second deleted a perfectly good session.
 *
 * Four places in the portal's client end a session in a bare `catch`: the
 * refresh-and-retry inside `request`, the same refresh inside `fetchFile` and
 * `uploadFile`, and `restoreSession` on page load. None of them asked the one
 * question that decides it — did the platform refuse, or did we never reach
 * it?
 *
 * Only the first can end a session. A refresh that never arrived tells us
 * nothing about whether the session is still good, and acting on that guess
 * does real damage, because `setSession(null)` does not merely hide the
 * officer's session: it deletes the refresh token out of sessionStorage. The
 * session is gone, not suspended.
 *
 * `restoreSession` is the worst of the four because it runs on load. Open the
 * portal, have the connection hiccup for the second that request takes, and
 * you are at the login screen needing a password — on a connection that has
 * just proved unreliable, with a session that was never in question.
 *
 * The agent app decided this already, in as many words: "Only a refusal ends
 * the session. If the refresh could not reach PSIRS we know nothing about
 * whether the session is still good, and throwing the agent out on a guess
 * would strand them: signing back in needs the very connection that is
 * missing." The portal had the same code and never got the same treatment.
 *
 * Keeping the token is not the same as keeping the officer at their desk.
 * `restoreSession` still answers null and the App still draws the login
 * screen; what changes is that a reload once the connection returns restores
 * them, instead of the session having been thrown away.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchFile,
  hasStoredSession,
  logout,
  restoreSession,
  setSession,
  uploadFile,
  api,
} from '../lib/api';
import type { User } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const USER = {
  id: 'u1',
  phone: '+2348000000001',
  fullName: 'Revenue Officer',
  email: null,
  role: 'revenue_officer',
  permissions: permissionsForRole('revenue_officer'),
} as unknown as User;

function signedIn() {
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-1', user: USER });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const EXPIRED = {
  error: { code: 'TOKEN_EXPIRED', message: 'expired', moneyStatus: 'NOT_APPLICABLE' },
};
const REFUSED_REFRESH = {
  error: { code: 'UNAUTHENTICATED', message: 'refresh rejected', moneyStatus: 'NOT_APPLICABLE' },
};

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  setSession(null);
});

describe('restoring a session on load, with the connection gone', () => {
  it('keeps the refresh token rather than throwing the session away', async () => {
    signedIn();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(restoreSession()).resolves.toBeNull();

    // The officer is still at the login screen — that has not changed. What
    // changes is that a reload once the connection is back brings them in.
    expect(hasStoredSession()).toBe(true);
  });

  it('still ends the session when the platform actually refuses the refresh', async () => {
    // The control that matters most. A refresh token that has been revoked,
    // or expired, must still sign somebody out.
    signedIn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(REFUSED_REFRESH, 401));

    await expect(restoreSession()).resolves.toBeNull();
    expect(hasStoredSession()).toBe(false);
  });
});

describe('a token that expired mid-session', () => {
  it('does not sign an officer out because the refresh never arrived', async () => {
    signedIn();
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return json(EXPIRED, 401);
      // The refresh itself: the connection is gone by now.
      throw new TypeError('Failed to fetch');
    });

    await expect(api.get('/government/cases')).rejects.toThrow();
    expect(hasStoredSession()).toBe(true);
  });

  it('does not sign an officer out when the retried request is the one that drops', async () => {
    // The refresh succeeded. The `try` covers the retry too, so a connection
    // lost between the two used to take the session with it.
    signedIn();
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return json(EXPIRED, 401);
      if (call === 2) {
        return json({ accessToken: 'access-2', refreshToken: 'refresh-2', user: USER });
      }
      throw new TypeError('Failed to fetch');
    });

    await expect(api.get('/government/cases')).rejects.toThrow();
    expect(hasStoredSession()).toBe(true);
  });

  it('still signs an officer out when the refresh is refused', async () => {
    signedIn();
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      return call === 1 ? json(EXPIRED, 401) : json(REFUSED_REFRESH, 401);
    });

    await expect(api.get('/government/cases')).rejects.toThrow();
    expect(hasStoredSession()).toBe(false);
  });
});

describe('fetching a document behind the same refresh', () => {
  it('does not sign a reviewer out because the refresh never arrived', async () => {
    // A reviewer part-way through a long identity application, opening one
    // more image. Losing the session here loses the review.
    signedIn();
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return json(EXPIRED, 401);
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchFile('/government/kyc/doc-1/file')).rejects.toThrow();
    expect(hasStoredSession()).toBe(true);
  });
});

describe('uploading a document behind the same refresh', () => {
  it('does not sign an officer out because the refresh never arrived', async () => {
    // The fourth of the four. An officer part-way through attaching evidence
    // to a case, on the one request that found the token stale.
    signedIn();
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return json(EXPIRED, 401);
      throw new TypeError('Failed to fetch');
    });

    const file = new File(['bytes'], 'evidence.pdf', { type: 'application/pdf' });
    await expect(uploadFile('/government/cases/c1/documents', file)).rejects.toThrow();
    expect(hasStoredSession()).toBe(true);
  });
});

describe('signing out on purpose', () => {
  it('still ends the session, whatever the connection is doing', async () => {
    // An officer who pressed sign-out on a shared machine gets signed out.
    // This one is meant to be unconditional and must stay that way.
    signedIn();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await logout();

    expect(hasStoredSession()).toBe(false);
  });
});
