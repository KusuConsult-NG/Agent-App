/**
 * The reference a government integrates against must name things that exist.
 *
 * `docs/API.md` is hand-written. Nothing held it to the code, and the
 * step-up table -- seven rows, the contract for the seven most consequential
 * actions the platform offers -- had three of them wrong:
 *
 *   `POST /government/payments/:id/reverse` is not a route. The reversal flow
 *   is three steps under segregation of duties: raise a PAYMENT_REVERSAL
 *   approval, have a second officer decide it, have a third execute it at
 *   `/government/approvals/:id/execute-reversal`. The row collapsed all of
 *   that into one endpoint that answers 404 -- and the same document states
 *   the real route correctly thirty rows further down, so it contradicted
 *   itself.
 *
 *   `payment:reverse` is not a permission. The catalogue has
 *   `payment:reverse:request` and `payment:reverse:approve`.
 *
 *   `catalogue:manage` is not a permission either; the route checks
 *   `catalogue:configure`.
 *
 * And one that was wrong in the direction that costs something. The suspend
 * row named `agent:manage`, which administrators alone hold. The route checks
 * `agent:suspend`, which supervisors and revenue officers hold too. So the
 * reference told a supervisor to go and find an administrator before an agent
 * could be stopped from collecting -- for a control whose whole value is how
 * quickly it can be used.
 *
 * WHAT THIS CHECKS
 *
 * Two things, both mechanical, neither needing a list anybody maintains.
 *
 * Every path the document writes out in full must be a route. Not every path
 * it mentions: the reference uses two abbreviations a scan reads as broken
 * links -- a `·` joining a full path to a sibling named only by its last
 * segment, and `[/:id]` for an optional one. Requiring a known router mount
 * prefix drops those without guessing what they expand to, and it is the
 * fully-written ones an integrator copies anyway.
 *
 * Every permission-shaped token must be a permission.
 *
 * It does NOT check that every route is documented. 144 of 281 are not, and
 * that is not a defect: the reference is prose about the surfaces that matter,
 * it claims completeness nowhere, and a check demanding it would be a
 * standard this repository never set.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PERMISSIONS } from '@psirs/shared';

/** The repository root, found by walking up to the workspace manifest. */
function workspaceRoot(): string {
  let directory = process.cwd();
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (parsed.workspaces) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('no workspace root above ' + process.cwd());
    directory = parent;
  }
}

const ROOT = workspaceRoot();
const REFERENCE = readFileSync(join(ROOT, 'docs', 'API.md'), 'utf8');

/** Where each router is mounted, read from `app.ts` rather than assumed. */
function mounts(): Record<string, string> {
  const app = readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8');
  const found: Record<string, string> = {};
  for (const m of app.matchAll(/api\.use\('([^']+)',\s*(\w+)\)/g)) found[m[2]!] = m[1]!;
  return found;
}

/** Every route the API actually serves, as `METHOD /full/path`. */
function routes(): Set<string> {
  const mount = mounts();
  const dir = join(ROOT, 'apps/api/src/routes');
  const all = new Set<string>();
  for (const file of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(
      /(\w*Router)\.(get|post|put|patch|delete)\(\s*\n?\s*'([^']+)'/g,
    )) {
      const prefix = mount[m[1]!];
      if (prefix === undefined) continue;
      all.add(`${m[2]!.toUpperCase()} ${(prefix + m[3]!).replace(/\/$/, '')}`);
    }
  }
  return all;
}

/** `:id` and `:approvalId` are the same route; a query string is not part of one. */
const normalise = (entry: string): string =>
  entry
    .split('?')[0]!
    .replace(/\[(\/[^\]]*)\]/g, '')
    .replace(/:[A-Za-z_]+/g, ':p')
    .replace(/\/$/, '');

/**
 * Every `METHOD path` pair the reference states.
 *
 * A table row carries its own method labels as often as it inherits the row's
 * first cell -- `| GET | /a · POST /b |` is as common as `| GET/POST | /a |`.
 * The first version of this took the method from the first cell and applied it
 * to every path in the row, which reported four perfectly good rows as broken.
 * So each path takes the nearest method named before it anywhere in the row.
 */
function promised(): { entry: string; line: number }[] {
  const out: { entry: string; line: number }[] = [];
  REFERENCE.split('\n').forEach((line, index) => {
    if (!line.includes('|')) return;
    const row = line.slice(line.indexOf('|') + 1);
    const tokens = [...row.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\b|`(\/[^`]*)`/g)];
    let method: string | null = null;
    const pending: string[] = [];
    for (const token of tokens) {
      if (token[1]) {
        // A fresh run of methods after some paths starts a new pairing.
        if (pending.length > 0) pending.length = 0;
        method = token[1];
        // `GET`/`POST` on one cell: remember every method named before a path.
        pending.push(token[1]);
      } else if (token[2] !== undefined) {
        for (const each of pending.length > 0 ? pending : method ? [method] : []) {
          out.push({ entry: `${each} ${token[2]}`, line: index + 1 });
        }
      }
    }
  });
  for (const m of REFERENCE.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^`\s]*)`/g)) {
    out.push({ entry: `${m[1]} ${m[2]}`, line: REFERENCE.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('what the API reference promises', () => {
  it('is a route, for every path it writes out in full', () => {
    const served = new Set([...routes()].map(normalise));
    const prefixes = Object.values(mounts());
    const stated = promised();

    /*
     * A floor, because a scan that stops matching passes in silence. The canary
     * below is the stronger half: it names one entry that must be found, so a
     * pattern that breaks in a way that still matches something is caught too.
     */
    assert.ok(stated.length >= 100, `only ${stated.length} route mentions found in API.md`);
    assert.ok(
      stated.some((s) => s.entry === 'POST /auth/login'),
      'the scan did not find `POST /auth/login`, which the reference certainly states',
    );

    const fullyWritten = stated.filter(({ entry }) => {
      const path = entry.slice(entry.indexOf(' ') + 1).split('?')[0]!;
      return prefixes.some((prefix) => path === prefix || path.startsWith(prefix + '/'));
    });

    /*
     * A trailing `*` stands for a family the prose names one by one -- the
     * five `/government/audit/queries/...` reads are written that way. It is
     * satisfied by any route under the prefix, which still fails if the whole
     * family is removed, and is honest about what the notation claims.
     */
    const exists = (entry: string): boolean => {
      const wanted = normalise(entry);
      if (!wanted.endsWith('/*')) return served.has(wanted);
      // Both sides carry the method, so comparing the whole string is enough:
      // "GET /government/audit/queries/" against "GET /…/queries/rate-changes".
      const prefix = wanted.slice(0, -1);
      return [...served].some((route) => route.startsWith(prefix));
    };

    const missing = [...new Set(
      fullyWritten
        .filter(({ entry }) => !exists(entry))
        .map(({ entry, line }) => `API.md:${line}: ${entry}`),
    )].sort();

    assert.deepEqual(
      missing,
      [],
      'the reference sends a reader to these, and the API serves none of them:\n  ' +
        missing.join('\n  '),
    );
  });

  it('is a permission, for every permission-shaped name it uses', () => {
    const real = new Set<string>(PERMISSIONS);

    /*
     * Backticked, lower-case, colon-separated: the shape every permission in
     * the catalogue is written in. Action names like `user.role.change` use
     * dots and are not matched; a header like `Authorization: Bearer` has a
     * space and is not matched either.
     */
    const named = new Map<string, number>();
    REFERENCE.split('\n').forEach((line, index) => {
      for (const m of line.matchAll(/`([a-z][a-z_]*(?::[a-z][a-z_]*)+)`/g)) {
        if (!named.has(m[1]!)) named.set(m[1]!, index + 1);
      }
    });

    assert.ok(named.size >= 20, `only ${named.size} permission-shaped names found in API.md`);

    const invented = [...named.entries()]
      .filter(([name]) => !real.has(name))
      .map(([name, line]) => `API.md:${line}: ${name}`)
      .sort();

    assert.deepEqual(
      invented,
      [],
      'the reference tells an officer they need these, and no such permission exists:\n  ' +
        invented.join('\n  '),
    );
  });
});
