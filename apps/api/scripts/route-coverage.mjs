/**
 * Which declared API routes no test reaches.
 *
 * D-21 closed on 156 routes exercised by 156 tests, and the finding recorded
 * beside it was that the counting tool had itself been wrong: it matched test
 * paths against a hardcoded list of mount prefixes, so every route on a newly
 * added router read as untested. A measurement that silently misreports new
 * work is worse than no measurement, because it is trusted. This one is
 * committed so the count can be retaken rather than remembered.
 *
 * Two things it derives rather than assumes:
 *
 *   * Mount prefixes come from what `app.ts` actually mounts, so a new router
 *     is counted the day it is added.
 *
 *   * A test path is attributed to the route Express would pick, preferring
 *     the most literal match. Without that, `/agents/apply` counts as coverage
 *     of `/agents/:id` and the number flatters itself.
 *
 * What it does not check is the method: a route is "reached" if any test names
 * its path. It answers "has anybody been here", which is the question D-21
 * asked, and not "is this route tested well".
 *
 *   node apps/api/scripts/route-coverage.mjs        (from the repository root)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const API = 'apps/api/src';

const appSrc = readFileSync(join(API, 'app.ts'), 'utf8');
const mounts = {};
for (const m of appSrc.matchAll(/api\.use\('(\/[^']*)',\s*(\w+)\)/g)) mounts[m[2]] = m[1];

const varToFile = {};
for (const f of readdirSync(join(API, 'routes')).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(API, 'routes', f), 'utf8');
  for (const m of src.matchAll(/export const (\w+)\s*[:=]/g)) varToFile[m[1]] = f;
}

const routes = [];
for (const [v, prefix] of Object.entries(mounts)) {
  const file = varToFile[v];
  if (!file) continue;
  const src = readFileSync(join(API, 'routes', file), 'utf8');
  const add = (method, p) =>
    routes.push({ method: method.toUpperCase(), path: p.replace(/\/$/, '') || prefix, file, hit: 0 });
  for (const m of src.matchAll(/\b(\w+)\.(get|post|put|patch|delete)\(\s*\n?\s*'([^']*)'/g))
    if (m[1] === v) add(m[2], prefix + m[3]);
  for (const s of src.matchAll(new RegExp(v + "\\.use\\('(\\/[^']*)',\\s*(\\w+)\\)", 'g')))
    for (const m of src.matchAll(
      new RegExp('\\b' + s[2] + "\\.(get|post|put|patch|delete)\\(\\s*\\n?\\s*'([^']*)'", 'g'),
    ))
      add(m[1], prefix + s[1] + m[2]);
}

const corpus = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) corpus.push(readFileSync(p, 'utf8'));
  }
};
walk(join(API, 'tests'));
const blob = corpus.join('\n');

const used = new Set();
for (const m of blob.matchAll(/['"`](\/[^'"`\s]*)['"`]/g)) {
  let p = m[1];
  if (p.startsWith('/api/v1')) p = p.slice('/api/v1'.length);
  p = p.split('?')[0].replace(/\$\{[^}]*\}/g, 'X').replace(/\/$/, '');
  if (p.startsWith('/')) used.add(p);
}

const segsOf = (p) => p.split('/').filter(Boolean);
const isParam = (s) => s.startsWith(':');

const byLen = new Map();
for (const r of routes) {
  const n = segsOf(r.path).length;
  if (!byLen.has(n)) byLen.set(n, []);
  byLen.get(n).push(r);
}

// Express picks the first matching route in declaration order, so a literal
// route beats a parametric sibling. Attribute each test path the same way,
// or /agents/apply would count as coverage of /agents/:id.
for (const u of used) {
  const us = segsOf(u);
  const cands = byLen.get(us.length) || [];
  const matches = cands.filter((r) =>
    segsOf(r.path).every((s, i) => (isParam(s) ? true : s === us[i])),
  );
  if (!matches.length) continue;
  const score = (r) => segsOf(r.path).filter((s) => !isParam(s)).length;
  const best = Math.max(...matches.map(score));
  for (const r of matches) if (score(r) === best) r.hit += 1;
}

const uncovered = routes.filter((r) => r.hit === 0);
console.log('declared routes:', routes.length);
console.log('exercised:', routes.length - uncovered.length);
console.log('uncovered:', uncovered.length);
for (const r of uncovered) console.log('  ', r.method.padEnd(6), r.path, '(' + r.file + ')');
