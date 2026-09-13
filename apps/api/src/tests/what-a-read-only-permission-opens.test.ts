/**
 * What a permission the portal calls read-only actually opens.
 *
 * `apps/portal/src/lib/permissions.ts` sorts every permission into one of
 * three lists, and a test beside it checks that partition thoroughly: nothing
 * unclassified, nothing in two lists, nothing naming a permission the shared
 * catalogue has dropped. It even records a previous version of itself that was
 * tautological and could not fail.
 *
 * What none of that asks is the question the lists exist to answer. They are
 * checked against each other and against the catalogue, never against what a
 * permission *opens* — so a permission could sit in `READ_ONLY_PERMISSIONS`
 * while gating a route that writes, and every check would pass.
 *
 * One did. `POST /usage/expire` is `DELETE FROM usage_events WHERE occurred_at
 * < now() - interval` and was gated by `report:read:all`, which
 * revenue_officer, finance_officer, auditor and admin all hold. The auditor's
 * read-only standing is, in that file's own words, "part of the control
 * environment" and is advertised to them with `isReadOnly`. It was not true.
 *
 * This is the cross-check: a route whose method changes something must not be
 * reachable on a read-only permission alone. `requirePermission` grants on
 * *any* of the permissions it names, so one read-only entry in the list opens
 * the route however many mutating ones sit beside it.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PORTAL_PERMISSIONS = join(REPO_ROOT, 'apps', 'portal', 'src', 'lib', 'permissions.ts');
const ROUTES_DIR = join(REPO_ROOT, 'apps', 'api', 'src', 'routes');

/**
 * Routes that change nothing, or change only a copy of what the caller may
 * already read. Each is a judgement, and each says which.
 *
 * Keyed by file as well as path: a router's paths are relative to where it is
 * mounted, so `/:id/document` alone would not say which router's.
 *
 * The line is the one `READ_ONLY_PERMISSIONS` already draws for `data:export`:
 * producing a copy of a record you are entitled to read is a read, because it
 * changes nothing about what a taxpayer owes, what an agent earned or what a
 * receipt says.
 */
const ALLOWED: Record<string, string> = {
  'government.ts POST /presumptive/preview':
    'Computes what an assessment would come to. Touches no table; POST only because it takes a body.',
  'government.ts POST /presumptive/band':
    'Returns bandFor(facts). A pure function of the request, answered without a query.',
  'government.ts POST /programmes/:id/evaluate':
    'Computes eligibility against a programme. Writes nothing; the route also admits incentive:configure.',
  'revenue.ts POST /invoices/:id/document':
    'Renders the invoice the caller may already read, and records the access. The data:export judgement.',
  'vehicles.ts POST /renewals/:renewalId/document':
    'Renders the renewal certificate for a renewal the caller may already read. Same judgement.',
  /*
   * The uncomfortable one, left visible rather than quietly resolved.
   *
   * It asks the gateway whether the money arrived and records the answer —
   * "there is deliberately no parameter here through which a caller can assert
   * an outcome". So it cannot invent a payment, and what it writes is a
   * correction towards what the gateway already holds, which the reconciliation
   * sweep would make anyway. It is still a write, and the roles it admits on
   * `payment:read:all` include the auditor. Narrowing it is a decision about
   * who may chase a stuck payment, which belongs to PSIRS rather than here.
   */
  'payments.ts POST /:paymentId/confirm':
    'Polls the gateway and records its answer; cannot assert an outcome. Admits the auditor on payment:read:all — see the note in this file.',
};

/** The permissions the portal states are read-only. */
function readOnlyPermissions(): Set<string> {
  const source = readFileSync(PORTAL_PERMISSIONS, 'utf8');
  const start = source.indexOf('export const READ_ONLY_PERMISSIONS = [');
  assert.notEqual(start, -1, 'READ_ONLY_PERMISSIONS has moved; this test is reading nothing');
  const end = source.indexOf('] as const;', start);
  assert.ok(end > start, 'could not find the end of READ_ONLY_PERMISSIONS');
  const found = [...source.slice(start, end).matchAll(/'([a-z_]+:[a-z_:]+)'/g)].map((m) => m[1]!);
  assert.ok(found.length > 20, `expected the read-only list, found ${found.length} entries`);
  return new Set(found);
}

interface Guarded {
  method: string;
  path: string;
  file: string;
  permissions: string[];
}

/**
 * Every guarded route that is not a GET.
 *
 * Sliced per route rather than matched with a lookahead, for the reason
 * `scripts/build-action-matrix.mjs` records: a lookahead attached each route's
 * guard to the following route's path.
 */
function mutatingRoutes(): Guarded[] {
  const found: Guarded[] = [];
  for (const file of readdirSync(ROUTES_DIR).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(ROUTES_DIR, file), 'utf8');
    const starts = [...source.matchAll(/^(\w+)\.(get|post|put|patch|delete)\(/gm)];
    for (const [index, start] of starts.entries()) {
      const from = start.index!;
      const to = index + 1 < starts.length ? starts[index + 1]!.index! : source.length;
      const whole = source.slice(from, to);
      const closes = whole.indexOf('\n);');
      const slice = closes < 0 ? whole : whole.slice(0, closes + 3);

      const method = start[2]!.toUpperCase();
      if (method === 'GET') continue;
      const path = slice.match(/^\w+\.\w+\(\s*\n?\s*'([^']+)'/);
      const guard = slice.match(/requirePermission\(([^)]*)\)/);
      if (!path || !guard) continue;
      found.push({
        method,
        path: path[1]!,
        file,
        permissions: [...guard[1]!.matchAll(/'([a-z_]+:[a-z_:]+)'/g)].map((m) => m[1]!),
      });
    }
  }
  return found;
}

describe('what a read-only permission opens', () => {
  it('opens no route that changes something, except where that is written down', () => {
    const readOnly = readOnlyPermissions();
    const routes = mutatingRoutes();
    assert.ok(routes.length > 80, `expected the guarded write routes, found ${routes.length}`);

    const offenders: string[] = [];
    for (const route of routes) {
      const opened = route.permissions.filter((permission) => readOnly.has(permission));
      if (opened.length === 0) continue;
      const key = `${route.file} ${route.method} ${route.path}`;
      if (key in ALLOWED) continue;
      offenders.push(`${key} is opened by ${opened.join(', ')}`);
    }

    assert.deepEqual(
      offenders,
      [],
      'these change something and are reachable on a permission the portal calls read-only. ' +
        'Either the gate is wrong, or the permission is not read-only, or it belongs in ' +
        `ALLOWED with the reason:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('keeps every written-down exception pointing at a route that still exists', () => {
    // An excuse for a route that has been renamed or removed goes on excusing
    // nothing, and hides the next route to take that path.
    const live = new Set(
      mutatingRoutes().map((route) => `${route.file} ${route.method} ${route.path}`),
    );
    const stale = Object.keys(ALLOWED).filter((key) => !live.has(key));
    assert.deepEqual(stale, [], `ALLOWED names routes that no longer exist: ${stale.join(', ')}`);
  });
});
