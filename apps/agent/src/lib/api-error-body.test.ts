/**
 * An answer from PSIRS must survive the HTTP status it arrives on.
 *
 * Receipt verification answers "no such receipt" as `404 {status:"NOT_FOUND",
 * message:"No government document matches that number or code. If you were
 * given a receipt bearing this number, it was not issued by PSIRS."}` — the
 * verdict a market trader is standing there waiting for, and the one case the
 * page exists to catch.
 *
 * Both API clients dropped it. Each looked for the standard `{error:{…}}`
 * envelope, found none on that body, and replaced the whole payload with
 * "The request failed (404)." So the screen that answers "is this receipt
 * real?" met a forged receipt with a transport error, which reads as "the
 * check did not work" rather than "this receipt was never issued" — the
 * opposite of what happened, and the reading that lets a forged receipt pass.
 *
 * Keeping the parsed body on the error lets a caller tell a domain verdict
 * from a transport failure. The synthesised message stays for genuinely
 * unrecognisable bodies, which is what it was for.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiRequestError, api } from './api';

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a rejection keeps the body PSIRS sent', () => {
  it('carries the verification verdict through a 404', async () => {
    const verdict = {
      status: 'NOT_FOUND',
      message:
        'No government document matches that number or code. If you were given a receipt ' +
        'bearing this number, it was not issued by PSIRS.',
    };
    respondWith(404, verdict);

    const caught = await api.get('/verify/AAAAA-BBBBB').then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiRequestError);
    const error = caught as ApiRequestError;
    expect(error.status).toBe(404);
    // The verdict itself, not a transport message invented in its place.
    expect(error.body).toEqual(verdict);
  });

  it('still describes a body it cannot recognise', async () => {
    respondWith(500, '<html>Bad Gateway</html>');

    const caught = await api.get('/anything').then(
      () => null,
      (error: unknown) => error,
    );

    const error = caught as ApiRequestError;
    expect(error.error.message).toMatch(/request failed \(500\)/);
    expect(error.body).toBeNull();
  });

  it('leaves the standard error envelope exactly as it was', async () => {
    const envelope = {
      error: { code: 'FORBIDDEN', message: 'Your role is not permitted.', moneyStatus: 'NOT_APPLICABLE' },
    };
    respondWith(403, envelope);

    const caught = await api.get('/government/dashboard').then(
      () => null,
      (error: unknown) => error,
    );

    const error = caught as ApiRequestError;
    expect(error.error.code).toBe('FORBIDDEN');
    expect(error.error.message).toBe('Your role is not permitted.');
    expect(error.body).toEqual(envelope);
  });
});
