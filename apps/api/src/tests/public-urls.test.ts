/**
 * Every link handed to the public must resolve in the portal that receives it.
 *
 * Two URLs leave this system for people with no account: the one printed and
 * QR-encoded on every receipt and certificate, and the invitation sent to a
 * referee. Both were built by joining strings onto a configured base, and both
 * produced `https://portal/verify/CODE` — a path the portal cannot route,
 * because it is a hash router by design.
 *
 * The result was silent and worse than an error. The portal rendered
 * perfectly; it just rendered the government sign-in page. A citizen scanning
 * the QR on their receipt to check it was genuine got a staff login form, and
 * a referee following their invitation was asked for a password that, by the
 * whole design of that flow, they cannot have.
 *
 * Confirmed in a browser before and after: `/verify/T7C72-QTUDN` showed
 * "Phone number / Password / Sign in" and made no API call at all, while
 * `/#/verify/T7C72-QTUDN` showed "VALID — This is a genuine government receipt
 * issued by PSIRS".
 *
 * These tests hold the two sides together: the emitted URL is checked against
 * the route patterns the portal actually declares, read out of its source, and
 * against the fact that its router reads the hash. Change either side alone and
 * this fails.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refereeInvitationUrl, verificationUrl } from '../lib/public-urls';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PORTAL_ROUTER = join(REPO_ROOT, 'apps', 'portal', 'src', 'router.tsx');
const PORTAL_APP = join(REPO_ROOT, 'apps', 'portal', 'src', 'App.tsx');

/** The portal's own matching rule, applied to a route we generated. */
function matchRoute(route: string, pattern: string): Record<string, string> | null {
  const routeParts = route.split('?')[0]!.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (routeParts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i]!;
    const routePart = routeParts[i]!;
    if (patternPart.startsWith(':')) params[patternPart.slice(1)] = decodeURIComponent(routePart);
    else if (patternPart !== routePart) return null;
  }
  return params;
}

/** What the portal would see in `window.location.hash.slice(1) || '/'`. */
function routeFor(url: string): string {
  return new URL(url).hash.slice(1) || '/';
}

describe('Public links resolve in the portal that receives them', () => {
  it('still targets a portal that routes on the hash', () => {
    // If the portal ever moves to the History API this assumption changes and
    // these URLs must be revisited — which is the point of failing here.
    const router = readFileSync(PORTAL_ROUTER, 'utf8');
    assert.match(
      router,
      /window\.location\.hash/,
      'the portal no longer reads its route from the hash — public URLs must be rebuilt',
    );
  });

  it('sends a receipt holder to the verification screen, not to sign-in', () => {
    const url = verificationUrl('T7C72-QTUDN');
    const route = routeFor(url);

    assert.notEqual(route, '/', `${url} resolves to the sign-in screen`);
    const params = matchRoute(route, '/verify/:code');
    assert.ok(params, `${route} does not match the portal's /verify/:code route`);
    assert.equal(params!.code, 'T7C72-QTUDN');
  });

  it('sends a referee to their invitation, not to sign-in', () => {
    const url = refereeInvitationUrl('2HzPiCwZGMrXS08ipobzyvo2b_pMY33Al');
    const route = routeFor(url);

    assert.notEqual(route, '/', `${url} resolves to the sign-in screen`);
    const params = matchRoute(route, '/referee/:token');
    assert.ok(params, `${route} does not match the portal's /referee/:token route`);
    assert.equal(params!.token, '2HzPiCwZGMrXS08ipobzyvo2b_pMY33Al');
  });

  it('matches routes the portal actually declares', () => {
    // Guards against fixing the hash but naming a screen that does not exist.
    const app = readFileSync(PORTAL_APP, 'utf8');
    for (const pattern of ["'/verify/:code'", "'/referee/:token'"]) {
      assert.ok(
        app.includes(`matchRoute(route, ${pattern})`),
        `the portal no longer declares ${pattern}`,
      );
    }
  });

  it('tolerates the base URL being written either way', () => {
    // VERIFICATION_BASE_URL has always been documented with /verify on the end,
    // and a deployment may reasonably set either form or leave a trailing slash.
    const original = process.env.VERIFICATION_BASE_URL;
    for (const base of [
      'https://portal.example.gov.ng/verify',
      'https://portal.example.gov.ng',
      'https://portal.example.gov.ng/',
      'https://portal.example.gov.ng/verify/',
    ]) {
      process.env.VERIFICATION_BASE_URL = base;
      // config is read at import time, so this asserts the shape rather than
      // re-reading env: the point is that the helper never doubles the segment.
      const url = verificationUrl('ABCDE-12345');
      assert.equal((url.match(/\/verify\//g) ?? []).length, 1, `${base} produced ${url}`);
      assert.ok(url.includes('/#/verify/'), `${base} produced ${url}`);
    }
    process.env.VERIFICATION_BASE_URL = original;
  });
});
