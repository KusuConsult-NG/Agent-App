/**
 * One refresh at a time.
 *
 * A refresh token is exchanged for a new one, so it may be spent exactly once.
 * The app fires several requests the moment it opens; when the access token was
 * gone — a cold start, where it lives in memory only — every one of them met a
 * 401 at the same instant, read the same token from storage, and sent its own
 * exchange. The server accepted whichever arrived first and refused the rest,
 * and the agent was signed out on the spot: mid-form, taxpayer waiting.
 *
 * These tests hold the app to one exchange per token. They are the client half
 * of the fix; the server half is in `apps/api/src/tests/refresh-rotation.test.ts`,
 * which stops the extra exchanges minting sessions even if some client sends
 * them.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getUser, request, restoreSession, setSession } from './api';

const USER = {
  id: 'u-1',
  fullName: 'Danladi Musa',
  phone: '+2347011000001',
  email: null,
  role: 'agent',
  permissions: ['taxpayer:create'],
  agentId: 'a-1',
};

const realFetch = globalThis.fetch;

/** Count of exchanges, and the tokens each was sent with. */
let refreshesSent: string[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const UNAUTHENTICATED = {
  error: { code: 'UNAUTHENTICATED', message: 'You need to sign in.', moneyStatus: 'NOT_APPLICABLE' },
};

/**
 * A server that rotates properly: a refresh token works once, and any later
 * presentation of a spent one is refused. That is what makes a second exchange
 * visible as a failure rather than silently tolerated.
 */
function rotatingServer(options: { refreshDelayMs?: number } = {}) {
  let currentToken = 'refresh-1';
  let issued = 1;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;

    if (url.endsWith('/auth/refresh')) {
      const presented = JSON.parse(String(init!.body)).refreshToken as string;
      refreshesSent.push(presented);

      // The delay is the whole point: without it the exchanges never overlap
      // and the race the test exists for cannot happen.
      if (options.refreshDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.refreshDelayMs));
      }

      if (presented !== currentToken) return jsonResponse(401, UNAUTHENTICATED);

      issued += 1;
      currentToken = `refresh-${issued}`;
      return jsonResponse(200, {
        accessToken: `access-${issued}`,
        refreshToken: currentToken,
        expiresIn: 900,
        user: USER,
      });
    }

    // Any other call needs a live access token. With none in memory — a cold
    // start — this is the 401 that sends the app to refresh.
    if (!headers.authorization) return jsonResponse(401, UNAUTHENTICATED);
    return jsonResponse(200, { ok: true, seenToken: headers.authorization });
  };
}

beforeEach(() => {
  localStorage.clear();
  setSession(null);
  refreshesSent = [];
  localStorage.setItem('psirs.refresh', 'refresh-1');
  localStorage.setItem('psirs.user', JSON.stringify(USER));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('several requests meeting a 401 together', () => {
  it('send one refresh between them, not one each', async () => {
    globalThis.fetch = vi.fn(rotatingServer({ refreshDelayMs: 20 })) as typeof fetch;

    const results = await Promise.all([
      request('/agents/me/home'),
      request('/agents/app-version'),
      request('/reference/lgas'),
      request('/agents/me/application'),
    ]);

    expect(refreshesSent).toEqual(['refresh-1']);
    for (const result of results) expect(result).toMatchObject({ ok: true });
  });

  it('leaves every one of them signed in', async () => {
    globalThis.fetch = vi.fn(rotatingServer({ refreshDelayMs: 20 })) as typeof fetch;

    await Promise.all([
      request('/agents/me/home'),
      request('/agents/app-version'),
      request('/reference/lgas'),
    ]);

    // The session survived. Before the fix the losing exchanges presented a
    // spent token, were refused, and cleared it.
    expect(localStorage.getItem('psirs.refresh')).toBe('refresh-2');
    expect(getUser()?.fullName).toBe('Danladi Musa');
  });

  it('lets them all through on the token the one refresh obtained', async () => {
    globalThis.fetch = vi.fn(rotatingServer({ refreshDelayMs: 20 })) as typeof fetch;

    const results = (await Promise.all([
      request<{ seenToken: string }>('/agents/me/home'),
      request<{ seenToken: string }>('/reference/lgas'),
    ])) as { seenToken: string }[];

    for (const result of results) expect(result.seenToken).toBe('Bearer access-2');
  });
});

describe('restoring a session on app start', () => {
  it('shares the one exchange with the requests firing beside it', async () => {
    // What a cold start actually looks like: the shell restores the session
    // while the first screen already asks for its data.
    globalThis.fetch = vi.fn(rotatingServer({ refreshDelayMs: 20 })) as typeof fetch;

    const [restored] = await Promise.all([
      restoreSession(),
      request('/agents/me/home'),
      request('/agents/app-version'),
    ]);

    expect(refreshesSent).toEqual(['refresh-1']);
    expect(restored?.user.fullName).toBe('Danladi Musa');
    expect(restored?.refreshToken).toBe('refresh-2');
  });
});

describe('a refresh that is genuinely refused', () => {
  it('signs the agent out once, and does not loop', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshesSent.push('refused');
        return jsonResponse(401, {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Your session has ended. Sign in again.',
            moneyStatus: 'NOT_APPLICABLE',
          },
        });
      }
      return jsonResponse(401, UNAUTHENTICATED);
    }) as typeof fetch;

    await expect(request('/agents/me/home')).rejects.toThrow();

    expect(localStorage.getItem('psirs.refresh')).toBe(null);
    expect(getUser()).toBe(null);
  });

  it('does not reuse a settled refresh for the next request', async () => {
    // The shared promise must be released when it settles. Holding it would
    // pin the agent to one outcome for the life of the app.
    globalThis.fetch = vi.fn(rotatingServer()) as typeof fetch;

    await request('/agents/me/home');
    setSession(null);
    localStorage.setItem('psirs.refresh', 'refresh-2');
    localStorage.setItem('psirs.user', JSON.stringify(USER));
    await request('/agents/me/home');

    expect(refreshesSent).toEqual(['refresh-1', 'refresh-2']);
  });
});
