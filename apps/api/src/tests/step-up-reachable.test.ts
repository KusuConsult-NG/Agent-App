/**
 * A step-up challenge the client cannot answer is a dead end.
 *
 * `requireStepUp` refuses a request with 403 STEP_UP_REQUIRED until the caller
 * holds a grant, and a grant comes from POST /auth/otp/request followed by
 * POST /auth/step-up. If the application that reaches the guarded route has no
 * code entry, the guard does not make the action safer — it makes it
 * impossible, and the failure looks like a broken button rather than a missing
 * screen.
 *
 * That is exactly what had happened to the commission payout. The endpoint was
 * guarded, the agent app had a "Request payout" button, the hint under it read
 * "A one-time code is required to request a payout", and nothing anywhere in
 * `apps/agent/src` mentioned the step-up endpoints. The portal had a `stepUp()`
 * helper from the beginning; the PWA never got one, so the last step of the
 * commission pipeline — the one where the agent is actually paid — could not
 * be completed in the only application an agent has.
 *
 * This test holds the two halves together. Guard a new action on an
 * agent-facing route without giving the agent app a way through it, and this
 * fails rather than the agent discovering it in a market.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const ROUTES_DIR = join(REPO_ROOT, 'apps', 'api', 'src', 'routes');

/** Everything under a directory, concatenated. */
function sourceUnder(...segments: string[]): string {
  const root = join(REPO_ROOT, ...segments);
  let out = '';
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) out += readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
}

/**
 * Step-up actions guarded on routes the agent app reaches.
 *
 * `agentRouter.use(authenticate)` covers the whole file, but only the `/me/`
 * routes are the agent acting on themselves — the rest of agents.ts is an
 * officer administering agents, and those belong to the portal.
 */
function agentFacingStepUpActions(): string[] {
  const source = readFileSync(join(ROUTES_DIR, 'agents.ts'), 'utf8');
  const actions: string[] = [];
  const pattern = /agentRouter\.(?:get|post|patch|put|delete)\(\s*'(\/me\/[^']*)'[\s\S]{0,400}?requireStepUp\('([^']+)'\)/g;
  for (const match of source.matchAll(pattern)) actions.push(match[2]!);
  return [...new Set(actions)];
}

/** Every step-up action guarded anywhere, with the file it is guarded in. */
function allStepUpActions(): { action: string; file: string }[] {
  const found: { action: string; file: string }[] = [];
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(join(ROUTES_DIR, file), 'utf8');
    for (const match of source.matchAll(/requireStepUp\('([^']+)'\)/g)) {
      found.push({ action: match[1]!, file });
    }
  }
  return found;
}

const OTP_REQUEST = '/auth/otp/request';
const STEP_UP_GRANT = '/auth/step-up';

describe('An application can answer every step-up challenge it can provoke', () => {
  it('finds the guards at all, so a passing run means something', () => {
    const guarded = allStepUpActions();
    assert.ok(guarded.length >= 3, `expected requireStepUp guards, found ${guarded.length}`);
    assert.ok(
      agentFacingStepUpActions().includes('commission.payout.request'),
      'the payout is the agent-facing step-up action this test exists for',
    );
  });

  it('gives the agent app a way through every guard it meets', () => {
    const pwa = sourceUnder('apps', 'agent', 'src');
    const actions = agentFacingStepUpActions();

    assert.ok(
      pwa.includes(OTP_REQUEST) && pwa.includes(STEP_UP_GRANT),
      'the agent app reaches a step-up-guarded route and cannot request or redeem a code — ' +
        `it must call ${OTP_REQUEST} and ${STEP_UP_GRANT}`,
    );

    for (const action of actions) {
      assert.ok(
        pwa.includes(action),
        `the agent app can reach a route guarded by "${action}" but never asks for a grant ` +
          'naming it, so the request answers 403 STEP_UP_REQUIRED with no way forward',
      );
    }
  });

  it('gives the portal a way through every guard it meets', () => {
    // The other half of the same claim. The portal was already right; this
    // stops it drifting the way the agent app had.
    const portal = sourceUnder('apps', 'portal', 'src');
    assert.ok(portal.includes(OTP_REQUEST) && portal.includes(STEP_UP_GRANT));

    for (const { action, file } of allStepUpActions()) {
      if (file === 'agents.ts' && agentFacingStepUpActions().includes(action)) continue;
      assert.ok(
        portal.includes(action),
        `the portal can reach a route guarded by "${action}" (${file}) and never asks for a grant naming it`,
      );
    }
  });

  it('never lets a client choose where the code is sent', () => {
    // A step-up whose destination is caller-supplied is not a second factor.
    // Both apps must take it from the signed-in session.
    const pwa = readFileSync(
      join(REPO_ROOT, 'apps', 'agent', 'src', 'lib', 'step-up.ts'),
      'utf8',
    );
    assert.match(
      pwa,
      /getUser\(\)\?\.phone/,
      'the agent app must send the code to the session’s own number',
    );
  });
});
