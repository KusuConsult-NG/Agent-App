/**
 * The agent side of the cooperative pipeline has to exist in the agent app.
 *
 * `groups-and-allocations.test.ts` pins down the whole journey — "an agent
 * registers a farmers' cooperative; an officer approves it; the agent records
 * who says they belong" — and drives every step by calling the API with an
 * agent's token. It passes. It has always passed.
 *
 * The agent application had no way to do any of it. No screen, no route, not
 * one request to `/groups` anywhere in `apps/agent/src`. The RBAC table grants
 * an agent `group:register` and `group:read:all`; `POST /groups` carries
 * `requireActiveAgent()` with a comment written about an agent registering
 * cooperatives from a bound handset in a market; the officer portal implements
 * only the review half, because registering is not an officer's job. The
 * journey was reachable through curl and not through the product.
 *
 * That is a whole tier of the informal sector — market associations, transport
 * unions, artisan guilds — that the platform was designed to bring onto the
 * register and could not, because the field half was never built.
 *
 * This asserts the three field endpoints have a caller. It deliberately checks
 * the app source rather than mounting the UI: what went wrong was not a broken
 * screen, it was the absence of one, and only the source can say that.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AGENT_SRC = join(__dirname, '..', '..', '..', '..', 'apps', 'agent', 'src');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(readFileSync(full, 'utf8'));
  }
  return out;
}

/**
 * The endpoints only an agent in the field can usefully call.
 *
 * All three are gated on `group:register`, which outside this application is
 * held only by officers who are not standing in the market.
 */
const FIELD_ENDPOINTS: { pattern: RegExp; what: string; endpoint: string }[] = [
  {
    pattern: /api\.post[^(]*\(\s*['"`]\/groups['"`]/,
    endpoint: 'POST /groups',
    what: 'register a cooperative, market association or union met in the field',
  },
  {
    pattern: /api\.post[^(]*\(\s*[`'"]\/groups\/[^`'"]*\/members/,
    endpoint: 'POST /groups/:id/members',
    what: 'record a taxpayer who says they belong to it',
  },
  {
    pattern: /api\.post[^(]*\(\s*[`'"]\/groups\/[^`'"]*\/attestation-request/,
    endpoint: 'POST /groups/:id/attestation-request',
    what: 'ask the group leader to confirm the membership list',
  },
];

describe('the agent app can work a group in the field', () => {
  const all = sources(AGENT_SRC).join('\n');

  for (const { pattern, endpoint, what } of FIELD_ENDPOINTS) {
    it(`calls ${endpoint} — to ${what}`, () => {
      assert.ok(
        pattern.test(all),
        `Nothing in the agent app calls ${endpoint}. An agent holds the permission ` +
          `for it and the endpoint requires a bound handset, so no other application ` +
          `can do this on their behalf.`,
      );
    });
  }

  it('lists the groups an agent has registered', () => {
    assert.ok(
      /api\.get[^(]*\(\s*[`'"]\/groups(\?|['"`])/.test(all),
      'An agent can register a group and then never see it again: nothing reads GET /groups.',
    );
  });
});
