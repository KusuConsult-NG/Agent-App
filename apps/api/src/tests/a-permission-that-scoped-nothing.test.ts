/**
 * A permission named `:own` has to actually narrow something.
 *
 * `ownership.ts` was written after six routes were found admitting an agent on
 * `receipt:read:own`, `document:read:own` and the rest, and then scoping
 * nothing — so any agent could read any taxpayer's tax affairs by id, and on
 * `GET /documents/:id` receive a working download URL for the PDF. Its header
 * says why the narrowing lives in one place: "six hand-rolled versions is how
 * five of them end up subtly different and one ends up missing."
 *
 * A seventh was written anyway. `GET /receipts` decided its scope with
 * `req.auth!.role === 'agent'` and passed `null` for every other role, while
 * the gate above it was a permission — so the two could come apart. They come
 * apart the moment `receipt:read:own` is granted to a role not spelled
 * `agent`, which `role_permissions` exists to allow without a deployment, and
 * when they come apart this one fails OPEN: admitted on the narrow permission,
 * narrowed by nothing.
 *
 * This guard reads the route files. A source lint rather than a request test
 * because the failure is a route that forgot, and a request test can only
 * exercise routes somebody remembered to write one for — which is the same
 * hole one level up.
 *
 * WHAT IT DOES NOT CLAIM
 *
 * That every `:own` route narrows the same way. Three of them legitimately do
 * not narrow at all, and each says why in its own comment; they are listed
 * below with the argument, not silently skipped. What it refuses is a route
 * that neither narrows nor explains.
 */

import './env';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listScopeAgentId } from '../lib/ownership';

function repositoryRoot(): string {
  let at = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(join(at, 'apps', 'api', 'src', 'routes'))) return at;
    at = dirname(at);
  }
  throw new Error(`Could not find the repository root from ${process.cwd()}`);
}

const ROUTES = join(repositoryRoot(), 'apps', 'api', 'src', 'routes');

/**
 * The calls that count as narrowing.
 *
 * `ownAgentId` and `assertGroupVisible` are route-local helpers that resolve
 * the caller's own identity server-side and filter on it; they are as much a
 * narrowing as the shared ones, and excluding them would flag routes that are
 * correct.
 */
const NARROWS = [
  'assertOwnRecord',
  'assertOwnUserRecord',
  'listScopeAgentId',
  'seesEverything',
  'callerAgentId',
  'callerUserId',
  'ownAgentId',
  'assertGroupVisible',
];

/**
 * Routes that hold an `:own` permission and deliberately narrow nothing.
 *
 * Each needs the argument written out, because "this one is fine" is exactly
 * what was said about the six that were not.
 */
const NARROWS_NOTHING_ON_PURPOSE: Record<string, string> = {
  'revenue.ts /taxpayers/:id/obligations':
    'A taxpayer who walks up to a different agent must still be servable, or that agent ' +
    'raises a second assessment for a debt that already exists. What is withheld from ' +
    'another agent is the collection history, not what the citizen owes government. ' +
    'Stated at the route and held by agent-scope.test.ts.',
};

interface Guarded {
  key: string;
  permissions: string;
  narrows: string[];
}

/** Every route registration whose permission list contains an `:own` form. */
function ownScopedRoutes(): Guarded[] {
  const found: Guarded[] = [];
  for (const file of readdirSync(ROUTES).filter((n) => n.endsWith('.ts'))) {
    const lines = readFileSync(join(ROUTES, file), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (!line.includes('requirePermission(') || !line.includes(':own')) continue;

      // The path is the line above the permission, give or take the method line.
      let path = '';
      for (let back = i - 1; back >= Math.max(0, i - 3) && !path; back -= 1) {
        const quoted = /'(\/[^']*)'/.exec(lines[back]!);
        if (quoted) path = quoted[1]!;
      }

      // The handler runs to the close of the route registration.
      let depth = 0;
      const body: string[] = [];
      for (let j = i; j < Math.min(i + 140, lines.length); j += 1) {
        body.push(lines[j]!);
        depth += (lines[j]!.match(/\(/g) ?? []).length - (lines[j]!.match(/\)/g) ?? []).length;
        if (j > i && depth <= 0) break;
      }
      const chunk = body.join('\n');

      found.push({
        key: `${file} ${path}`,
        permissions: /requirePermission\(([^)]*)\)/.exec(line)?.[1]?.trim() ?? '',
        narrows: NARROWS.filter((helper) => chunk.includes(`${helper}(`)),
      });
    }
  }
  return found;
}

describe('every route admitted on an :own permission', () => {
  it('narrows by something, or says why it does not', () => {
    const bare = ownScopedRoutes()
      .filter((route) => route.narrows.length === 0)
      .filter((route) => !(route.key in NARROWS_NOTHING_ON_PURPOSE));

    assert.deepEqual(
      bare.map((route) => `${route.key}  [${route.permissions}]`),
      [],
      'these routes admit a caller on a permission that names a scope and then apply none',
    );
  });

  it('found the routes at all', () => {
    /*
     * Without this the guard passes by reading nothing — a rename of
     * `requirePermission`, a move of the routes directory, or a regex that
     * stopped matching would all leave an empty list comparing equal to an
     * empty list.
     */
    const routes = ownScopedRoutes();
    assert.ok(routes.length >= 12, `only found ${routes.length} :own routes`);
    assert.ok(
      routes.some((route) => route.key.startsWith('payments.ts')),
      'the receipt routes are not among them',
    );
  });

  it('carries no exemption for a route that does narrow', () => {
    // A stale reason nobody re-reads is how the exemption list stops being a
    // set of decisions and becomes a backlog.
    const narrowing = new Set(
      ownScopedRoutes().filter((route) => route.narrows.length > 0).map((route) => route.key),
    );
    for (const key of Object.keys(NARROWS_NOTHING_ON_PURPOSE)) {
      assert.equal(narrowing.has(key), false, `${key} narrows; its exemption is stale`);
    }
  });

  it('gives every exemption an actual argument', () => {
    for (const [key, reason] of Object.entries(NARROWS_NOTHING_ON_PURPOSE)) {
      assert.ok(reason.length > 80, `${key} is exempted without a reason worth reading`);
    }
  });
});

describe('the list scope in particular', () => {
  /*
   * A list cannot refuse a row, so its narrowing is a query parameter — and a
   * null parameter conventionally means "no filter". That is the shape that
   * fails open, so the two list routes that carry an `:own` permission are
   * held to the helper by name rather than to "narrows by something".
   */
  it('goes through listScopeAgentId rather than a role name', () => {
    const source = readFileSync(join(ROUTES, 'payments.ts'), 'utf8');
    assert.match(source, /listScopeAgentId\(req, 'receipt:read:all'\)/);
    assert.equal(
      /const agentScoped = req\.auth!\.role === 'agent'/.test(source),
      false,
      'the receipt list is deciding its scope from the role name again',
    );
  });
});

/**
 * The helper itself, at the three states a caller can be in.
 *
 * `agent-scope.test.ts` already drives the receipt list with a real agent and
 * proves another agent's receipts stay out of it; that is the regression
 * control for this change and it is left where it is. What it cannot reach is
 * the third state, because reaching it means granting `receipt:read:own` to a
 * role that holds no agent row — a thing `role_permissions` permits and the
 * fixtures do not do. That state is the whole reason the helper exists, so it
 * is asserted directly.
 */
describe('resolving the scope for a list', () => {
  const caller = (permissions: string[], agentId: string | null) =>
    ({
      auth: { permissions, agentId, userId: 'u-1', role: 'whatever' },
    }) as never;

  it('returns null for a caller who may see everything', () => {
    assert.equal(listScopeAgentId(caller(['receipt:read:all'], null), 'receipt:read:all'), null);
  });

  it('returns the agent to narrow to for a caller who may see their own', () => {
    assert.equal(listScopeAgentId(caller(['receipt:read:own'], 'ag-1'), 'receipt:read:all'), 'ag-1');
  });

  it('refuses rather than widening when there is no own to narrow to', () => {
    /*
     * The case the old code answered with `null` — which the query reads as
     * "apply no filter", so a caller entitled to their own receipts alone
     * received every receipt in the state. Null is a legitimate answer to this
     * question only for the caller above, and the two must never be spelled
     * the same way.
     */
    assert.throws(
      () => listScopeAgentId(caller(['receipt:read:own'], null), 'receipt:read:all'),
      (error: { statusCode?: number }) => error.statusCode === 403,
    );
  });

  it('prefers the device-bound agent context over the session claim', () => {
    // `callerAgentId` reads `req.agent` first; the old site read only
    // `req.auth.agentId`, so a device-bound request whose token predates the
    // agent link would have fallen through to no narrowing at all.
    const deviceBound = {
      auth: { permissions: ['receipt:read:own'], agentId: null, userId: 'u-1', role: 'agent' },
      agent: { agentId: 'ag-device' },
    } as never;
    assert.equal(listScopeAgentId(deviceBound, 'receipt:read:all'), 'ag-device');
  });
});
