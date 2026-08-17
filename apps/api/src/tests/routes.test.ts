/**
 * Route shape guards.
 *
 * `middleware/validate.ts` narrows `req.params` from Express 5's
 * `string | string[]` down to `string`, once, at the wrapper boundary. That is
 * a claim about what the routes are, and a claim in a comment is one nobody
 * re-checks. These tests check it.
 *
 * They also catch a second thing the type system cannot: Express 5 removed the
 * `:name?` optional-parameter syntax and changed how `*` is written. A route
 * using the old form still compiles — it is just a string — and fails at
 * startup or, worse, silently stops matching.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = join(import.meta.dirname, '..', 'routes');

/** Every route path literal declared in the API, with where it came from. */
function declaredRoutePaths(): { file: string; path: string }[] {
  const found: { file: string; path: string }[] = [];

  for (const file of readdirSync(ROUTES_DIR).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(ROUTES_DIR, file), 'utf8');
    // router.get('/x/:id', …) and app.use('/x', …) alike.
    const pattern = /\.(get|post|put|patch|delete|all|use)\(\s*'([^']*)'/g;
    for (const match of source.matchAll(pattern)) {
      found.push({ file, path: match[2]! });
    }
  }

  return found;
}

describe('Route paths stay within what the param typing assumes', () => {
  it('finds the routes at all, so a passing run means something', () => {
    const paths = declaredRoutePaths();
    assert.ok(paths.length > 50, `expected the API's routes, found ${paths.length}`);
    assert.ok(paths.some((entry) => entry.path.includes(':')), 'and some with parameters');
  });

  it('declares no wildcard or repeated parameter', () => {
    // A wildcard is the only thing that makes Express hand back a string[], and
    // `RouteRequest` says that never happens. If one is added, this fails and
    // the narrowing in validate.ts has to be revisited — which is the point.
    for (const { file, path } of declaredRoutePaths()) {
      assert.ok(
        !/[*+]/.test(path),
        `${file} declares "${path}", which can yield an array parameter — ` +
          'RouteRequest in middleware/validate.ts assumes it cannot',
      );
    }
  });

  it('declares no optional parameter, which Express 5 removed', () => {
    // `:name?` compiles fine — it is just a string — and then fails to match.
    for (const { file, path } of declaredRoutePaths()) {
      assert.ok(
        !/:[A-Za-z_][A-Za-z0-9_]*\?/.test(path),
        `${file} declares "${path}" using the Express 4 optional-parameter syntax`,
      );
    }
  });

  it('declares no bare regular expression in a path', () => {
    // Express 5 no longer accepts sub-expressions like /:id(\\d+) in a string
    // path; they must be validated in the handler instead.
    for (const { file, path } of declaredRoutePaths()) {
      assert.ok(
        !/[()[\]]/.test(path),
        `${file} declares "${path}", which embeds a pattern Express 5 will not parse`,
      );
    }
  });
});
