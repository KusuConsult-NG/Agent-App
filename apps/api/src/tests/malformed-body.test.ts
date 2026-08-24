/**
 * A request body that is not JSON is the client's mistake, not the server's.
 *
 * Found by accident: a probe sent a body with an unescaped newline in it and
 * got back 500 INTERNAL_ERROR — "a problem on our side. No financial record
 * has been changed." Two things wrong with that, and neither is cosmetic.
 *
 * It is untrue. Nothing on our side went wrong; a client sent bytes that are
 * not JSON. PRD §60 forbids errors that leave a user unable to tell what
 * happened, and an error that misattributes the fault is worse than a vague
 * one — it sends somebody to look in the wrong place.
 *
 * And it pages the wrong people. A 500 on a government revenue platform is an
 * alert. A malformed body from one handset generating an out-of-hours page,
 * repeatedly, is how a team learns to ignore its alerts.
 *
 * The money status matters here too: nothing was read, so nothing was
 * debited, and the answer has to say so.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiBaseUrl, resetDatabase, startTestServer, stopTestServer } from './helpers';

before(async () => {
  await resetDatabase();
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

/** Post raw bytes, bypassing the helper's JSON.stringify. */
async function postRaw(path: string, body: string) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return { status: response.status, body: (await response.json()) as { error?: Record<string, unknown> } };
}

describe('a body that is not JSON', () => {
  it('is a client error, not a server error', async () => {
    const response = await postRaw('/auth/login', '{"phone": "brok');
    assert.equal(
      response.status,
      400,
      `unparseable JSON answered ${response.status}: ${JSON.stringify(response.body)}`,
    );
  });

  it('says the body could not be read, rather than blaming our side', async () => {
    const response = await postRaw('/auth/login', '{"phone": "line\nbreak"}');
    const message = String(response.body.error?.message ?? '');
    assert.ok(
      !/problem on our side/i.test(message),
      `misattributed to the server: ${message}`,
    );
    assert.match(message, /could not be read|not valid JSON/i);
  });

  it('carries a code a client can act on', async () => {
    const response = await postRaw('/auth/login', 'not json at all');
    assert.equal(response.body.error?.code, 'MALFORMED_BODY');
  });

  it('states that nothing was debited, because nothing was even read', async () => {
    // The body never parsed, so no handler ran. On a payment path an
    // ambiguous money status is what makes a taxpayer pay twice.
    const response = await postRaw('/payments/initiate', '{"transactionId": ');
    assert.equal(response.body.error?.moneyStatus, 'NOT_DEBITED');
  });

  it('still accepts a well-formed body', async () => {
    // The guard must not swallow ordinary requests.
    const response = await postRaw('/auth/login', JSON.stringify({ phone: '+2348000000009', password: 'nope' }));
    assert.notEqual(response.status, 400);
    assert.notEqual(response.body.error?.code, 'MALFORMED_BODY');
  });
});
