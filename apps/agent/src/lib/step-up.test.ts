/**
 * The agent can satisfy a step-up challenge.
 *
 * The payout endpoint is guarded by `requireStepUp('commission.payout.request')`,
 * and this application had no way to answer it. The button was there, the hint
 * under it said "A one-time code is required to request a payout", and nothing
 * in `apps/agent/src` referenced `/auth/otp/request`, `/auth/otp/verify` or
 * `/auth/step-up`. So the request answered 403 STEP_UP_REQUIRED and the agent
 * had no path forward — the last step of the commission pipeline, the one
 * where they actually get paid, was unreachable in the only application they
 * use. The portal had a `stepUp()` helper the whole time.
 *
 * What these tests pin is mostly about the destination. The code must go to
 * the number on the signed-in session and never to one supplied by the caller:
 * a step-up whose destination can be chosen is not a second factor, it is a
 * form field.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { setSession } from './api';
import { grantStepUp, requestStepUpCode, stepUpDestination } from './step-up';

const USER = {
  id: 'u-1',
  fullName: 'Danladi Musa',
  phone: '+2347011000001',
  email: null,
  role: 'agent',
  permissions: ['commission:payout:request'],
  agentId: 'a-1',
};

const realFetch = globalThis.fetch;
let calls: { url: string; body: Record<string, unknown> }[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-1', user: USER });

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, body });

    if (url.includes('/auth/otp/request')) {
      return jsonResponse(200, { sent: true, expiresInSeconds: 300, developmentCode: '123456' });
    }
    if (url.includes('/auth/step-up')) {
      if (body.code !== '123456') {
        return jsonResponse(400, {
          error: {
            code: 'BAD_REQUEST',
            message: 'That verification code is not correct.',
            moneyStatus: 'NOT_APPLICABLE',
          },
        });
      }
      return jsonResponse(200, { granted: true, expiresAt: new Date().toISOString() });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no', moneyStatus: 'NOT_APPLICABLE' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setSession(null);
  vi.restoreAllMocks();
});

describe('Requesting a code', () => {
  it('sends it to the number on the session, not one passed in', async () => {
    await requestStepUpCode();

    const request = calls.find((call) => call.url.includes('/auth/otp/request'));
    expect(request?.body.destination).toBe(USER.phone);
    expect(request?.body.purpose).toBe('STEP_UP');
  });

  it('reports how long the code lasts, so the screen can say so', async () => {
    const result = await requestStepUpCode();
    expect(result.expiresInSeconds).toBe(300);
  });

  it('passes through the development code only when the server sent one', async () => {
    const result = await requestStepUpCode();
    expect(result.developmentCode).toBe('123456');
  });

  it('refuses to ask when nobody is signed in', async () => {
    setSession(null);
    await expect(requestStepUpCode()).rejects.toThrow(/sign in/i);
    expect(calls).toHaveLength(0);
  });
});

describe('Exchanging the code for a grant', () => {
  it('names the action being authorised', async () => {
    await grantStepUp('commission.payout.request', '123456');

    const grant = calls.find((call) => call.url.includes('/auth/step-up'));
    expect(grant?.body.action).toBe('commission.payout.request');
    expect(grant?.body.destination).toBe(USER.phone);
    expect(grant?.body.code).toBe('123456');
  });

  it("surfaces the server's own words when the code is wrong", async () => {
    // "that code is not correct" and "that code has expired" mean different
    // things to the person holding the phone: one is try again, the other is
    // ask for a new one. A generic failure message loses that.
    await expect(grantStepUp('commission.payout.request', '000000')).rejects.toThrow(
      /not correct/i,
    );
  });
});

describe('The destination', () => {
  it('is the signed-in agent, and nothing when signed out', () => {
    expect(stepUpDestination()).toBe(USER.phone);
    setSession(null);
    expect(stepUpDestination()).toBeNull();
  });
});
