/**
 * Regenerate `docs/ROLE-ACTION-MATRIX.md` from the code that enforces it.
 *
 * The brief this platform was built against asks for a role-based action
 * matrix -- which role may view, create, edit, approve, reverse, refund,
 * export and configure what. The platform *had* one: `ROLE_PERMISSIONS` in
 * `packages/shared/src/rbac.ts`, enforced on every route and asserted by
 * several tests. What it did not have was that matrix as a document PSIRS
 * could read, argue with and sign off, and the officer-readiness assessment
 * marked it partial for exactly that reason.
 *
 * WHY IT IS GENERATED RATHER THAN WRITTEN
 *
 * A hand-written matrix is a description of the system on the day somebody
 * wrote it. This one is derived from `ROLE_PERMISSIONS` and from the
 * `requirePermission(...)` calls in the route files, so it cannot describe a
 * delegation of authority the platform does not have -- and `--check` fails
 * the build when the two drift, which is what makes the document worth
 * signing.
 *
 * WHAT IT CANNOT SEE
 *
 * Permissions granted at runtime. Since migration 059 an administrator can
 * grant one from `/roles`, and this reads the shipped map from source. So the
 * document says what PSIRS was given, not what PSIRS has since decided -- and
 * says so on its face, because a matrix that quietly claimed otherwise would
 * be worse than none. The live map is at `GET /government/roles`.
 *
 * Also invisible: authority that is a fact about a row rather than about a
 * role. An officer may work a case they opened without holding `case:manage`,
 * which `services/cases.ts` decides and no permission list can express.
 *
 *   node scripts/build-action-matrix.mjs            regenerate
 *   node scripts/build-action-matrix.mjs --check    fail if it has drifted
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(ROOT, 'docs', 'ROLE-ACTION-MATRIX.md');

/**
 * The shipped delegation of authority, read from source.
 *
 * Parsed rather than imported because this is a documentation build and the
 * package would have to be compiled first -- which would make regenerating the
 * document depend on a build step that regenerating a document should not
 * need. The shapes here are simple and stable: a role name, then a list of
 * quoted permissions.
 */
function readRolePermissions() {
  const source = readFileSync(join(ROOT, 'packages', 'shared', 'src', 'rbac.ts'), 'utf8');

  const start = source.indexOf('export const ROLE_PERMISSIONS');
  if (start < 0) throw new Error('ROLE_PERMISSIONS not found in rbac.ts');
  const block = source.slice(start);

  const roles = {};
  const rolePattern = /^ {2}([a-z_]+): \[$/gm;
  let match;
  while ((match = rolePattern.exec(block)) !== null) {
    const name = match[1];
    const bodyStart = rolePattern.lastIndex;
    const bodyEnd = block.indexOf('\n  ],', bodyStart);
    if (bodyEnd < 0) throw new Error(`unterminated permission list for ${name}`);
    roles[name] = [...block.slice(bodyStart, bodyEnd).matchAll(/'([a-z_]+:[a-z_:]+)'/g)].map(
      (entry) => entry[1],
    );
  }
  if (Object.keys(roles).length === 0) throw new Error('no roles parsed from rbac.ts');
  return roles;
}

/** Every permission the catalogue declares, in the order it declares them. */
function readPermissionCatalogue() {
  const source = readFileSync(join(ROOT, 'packages', 'shared', 'src', 'rbac.ts'), 'utf8');
  const start = source.indexOf('export const PERMISSIONS');
  const end = source.indexOf('] as const;', start);
  return [...source.slice(start, end).matchAll(/'([a-z_]+:[a-z_:]+)'/g)].map((entry) => entry[1]);
}

/**
 * Which endpoints each permission opens.
 *
 * `requirePermission` grants on *any* of the permissions it names, so an
 * endpoint listing three appears against all three -- which is the truth about
 * who can reach it, and the thing a reader of a matrix most wants to know.
 */
function readEndpoints() {
  const routesDir = join(ROOT, 'apps', 'api', 'src', 'routes');
  const byPermission = new Map();

  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(routesDir, file), 'utf8');

    /*
     * Each route is the slice from its own `router.method(` to the next one.
     *
     * An earlier version matched the call and its middleware in one regular
     * expression with a lookahead, and quietly attached each route's
     * permission to the *following* route's path -- so the matrix said
     * `taxpayer:create` opened `POST /taxpayers/:id/tin`, which it does not.
     * Cutting the file into slices first makes the path and the guard come
     * from the same route by construction rather than by a lookahead being
     * right.
     */
    const starts = [...source.matchAll(/^(\w+)\.(get|post|put|patch|delete)\(/gm)];
    for (const [index, start] of starts.entries()) {
      const from = start.index;
      const to = index + 1 < starts.length ? starts[index + 1].index : source.length;
      /*
       * Cut at the route's own closing `);`, not at the next route.
       *
       * Between two routes there is often a helper function, and this file's
       * helpers check permissions too -- `deliver()` reads `data:export`. Left
       * in the preceding route's slice, that helper's check was attributed to
       * whatever route happened to sit above it, and the matrix reported that
       * exporting was a permission on `GET /reference/territories`. A route
       * call in this codebase always closes on a line that is exactly `);`,
       * which is a delimiter rather than a guess.
       */
      const whole = source.slice(from, to);
      const closes = whole.indexOf('\n);');
      const slice = closes < 0 ? whole : whole.slice(0, closes + 3);

      const path = slice.match(/^\w+\.\w+\(\s*\n?\s*'([^']+)'/);
      if (!path) continue;

      const guard = slice.match(/requirePermission\(([^)]*)\)/);
      const named = guard
        ? [...guard[1].matchAll(/'([a-z_]+:[a-z_:]+)'/g)].map((entry) => entry[1])
        : [];

      /*
       * And the checks that cannot be middleware.
       *
       * Two kinds of authority are decided inside the handler rather than in
       * front of it, and both would be invisible to a matrix that only read
       * `requirePermission`. Exporting depends on a query parameter, so the
       * gate cannot sit on the route without taking the screen away to stop
       * the file. Requesting a payment reversal depends on which of eleven
       * approval types was asked for.
       *
       * A permission that shows no endpoint at all is the finding this exists
       * to surface -- authority that looks real and confers nothing -- so it
       * matters that the ones which *are* enforced do not look like that.
       */
      for (const inline of slice.matchAll(/permissions\.includes\('([a-z_]+:[a-z_:]+)'\)/g)) {
        named.push(inline[1]);
      }
      for (const inline of slice.matchAll(/^\s*[A-Z_]+: '([a-z_]+:[a-z_:]+)',$/gm)) {
        named.push(inline[1]);
      }

      if (named.length === 0) continue;
      const prefix = ROUTER_PREFIX[start[1]] ?? '';
      for (const permission of named) {
        if (!byPermission.has(permission)) byPermission.set(permission, []);
        byPermission.get(permission).push(`${start[2].toUpperCase()} ${prefix}${path[1]}`);
      }
    }
  }
  /*
   * And the permissions no route names, because a service decides them.
   *
   * `case:manage` is the clearest: an officer may work a case they opened
   * without holding it, so the gate is a fact about the row and lives in
   * `services/cases.ts`. `support:read:all` is the same shape. A matrix that
   * showed these as opening nothing would read as "authority nobody checks",
   * which is the opposite of the truth and precisely the confident wrong
   * answer a signed document must not contain.
   */
  const servicesDir = join(ROOT, 'apps', 'api', 'src', 'services');
  for (const file of readdirSync(servicesDir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(servicesDir, file), 'utf8');
    for (const found of source.matchAll(/(?:includes|holds)\(\s*(?:viewer|actor)?[^)]*?'([a-z_]+:[a-z_:]+)'/g)) {
      const permission = found[1];
      if (!byPermission.has(permission)) byPermission.set(permission, []);
      const note = `decided in \`services/${file}\``;
      if (!byPermission.get(permission).includes(note)) byPermission.get(permission).push(note);
    }
  }

  return byPermission;
}

/**
 * Where each router is mounted.
 *
 * Read from `app.ts` would be better and is not worth it: these five have not
 * moved since the platform's first week, and a wrong prefix in a document is
 * visible to any reader who tries the path.
 */
const ROUTER_PREFIX = {
  governmentRouter: '/government',
  draftRouter: '/drafts',
  agentRouter: '/agents',
  taxpayerRouter: '/taxpayers',
  revenueRouter: '/revenue',
  paymentRouter: '/payments',
  vehicleRouter: '/vehicles',
  groupRouter: '/groups',
  usageRouter: '/usage',
  supportRouter: '/support',
  refereeRouter: '/referees',
  citizenRouter: '/citizen',
  authRouter: '/auth',
  referenceRouter: '/reference',
  pushRouter: '/push',
};

/**
 * The eight verbs the brief asks about, and what counts as each.
 *
 * Matched on the permission's own verb segment rather than guessed from its
 * subject: `payment:reverse` is a reversal whatever it is about, and
 * `report:financial` is a view however financial it sounds. Anything that
 * matches none of them is listed under "other" rather than being forced into
 * the nearest -- a matrix that files a permission under the wrong verb is
 * worse than one that admits the verb does not fit.
 */
const VERBS = [
  ['View', /(^|:)(read|list)(:|$)|^(report|dashboard):/],
  ['Create', /(^|:)(create|register|apply|open|draw|generate|initiate|renew|nominate)(:|$)/],
  ['Edit', /(^|:)(update|edit|manage|assign|assign_territory|contribute|correct|sync|tin_sync)(:|$)/],
  ['Approve', /(^|:)(approve|authorise|review|sign|clear|activate)(:|$)/],
  /*
   * `payment:reverse:request` and `payment:reverse:approve` are both
   * reversals, so the verb is matched as a segment rather than as a suffix. An
   * earlier version anchored on the end of the string and reported that no
   * role on the platform could reverse anything, which is the opposite of the
   * truth and exactly the kind of confident wrong answer a signed document
   * must not contain.
   */
  ['Reverse', /(^|:)(reverse|void|cancel)(:|$)/],
  ['Refund', /(^|:)refund(:|$)/],
  ['Export', /^data:export$/],
  ['Configure', /(^|:)(configure|close|reopen|suspend|reconcile|promote|retire|sample|report)(:|$)/],
];

function verbFor(permission) {
  for (const [verb, pattern] of VERBS) {
    if (pattern.test(permission)) return verb;
  }
  return 'Other';
}

// ===========================================================================

const roles = readRolePermissions();
const catalogue = readPermissionCatalogue();
const endpoints = readEndpoints();
const roleNames = Object.keys(roles);

const out = [];

out.push('## A. What each role may do, by verb');
out.push('');
out.push(
  'Counted from the shipped map. A role holding no permission of a verb is ' +
    'shown as `—`, which is a statement rather than an absence of data.',
);
out.push('');
out.push(`| Verb | ${roleNames.join(' | ')} |`);
out.push(`| --- | ${roleNames.map(() => '---').join(' | ')} |`);

const verbNames = [...VERBS.map(([verb]) => verb), 'Other'];
for (const verb of verbNames) {
  const cells = roleNames.map((role) => {
    const held = roles[role].filter((permission) => verbFor(permission) === verb);
    return held.length === 0 ? '—' : String(held.length);
  });
  out.push(`| ${verb} | ${cells.join(' | ')} |`);
}
out.push('');

out.push('## B. Every permission, who holds it, and what it opens');
out.push('');
out.push(
  'One row per permission in the catalogue. A permission no role holds is ' +
    'still listed: an authority nobody has is a decision, and one worth seeing.',
);
out.push('');
out.push(
  '**A dash in the last column means no route guard and no service check ' +
    'names this permission.** That is not the same as it doing nothing — an ' +
    'agent reading their own records is scoped by which agent is asking ' +
    'rather than by a permission — but it is the column to read first, ' +
    'because authority that looks real and confers nothing is the thing this ' +
    'table exists to expose. Generating it found one: ' +
    '`payment:reverse:request` was granted to two roles and checked nowhere, ' +
    'so any officer who could request an agent activation could request a ' +
    'payment reversal. It is enforced now.',
);
out.push('');
out.push('| Permission | Verb | Held by | Endpoints |');
out.push('| --- | --- | --- | --- |');

for (const permission of catalogue) {
  const holders = roleNames.filter((role) => roles[role].includes(permission));
  const paths = endpoints.get(permission) ?? [];
  /*
   * Endpoints are capped and counted rather than listed in full. A permission
   * like `report:read:all` opens forty of them, and a table cell containing
   * forty paths is a cell nobody reads.
   */
  const shown = paths
    .slice(0, 4)
    .map((path) => (path.startsWith('decided in') ? path : `\`${path}\``))
    .join('<br>');
  const more = paths.length > 4 ? `<br>…and ${paths.length - 4} more` : '';
  out.push(
    `| \`${permission}\` | ${verbFor(permission)} | ` +
      `${holders.length === 0 ? '**nobody**' : holders.join(', ')} | ` +
      `${paths.length === 0 ? '—' : shown + more} |`,
  );
}
out.push('');

out.push('## C. Actions that need a second factor');
out.push('');
out.push(
  'Holding the permission is not enough for these: the officer confirms a ' +
    'one-time code first, and the grant is spent on one request.',
);
out.push('');
const stepUpSource = readFileSync(join(ROOT, 'packages', 'shared', 'src', 'rbac.ts'), 'utf8');
const stepUpStart = stepUpSource.indexOf('export const STEP_UP_ACTIONS');
const stepUpEnd = stepUpSource.indexOf('] as const;', stepUpStart);
const stepUps = [...stepUpSource.slice(stepUpStart, stepUpEnd).matchAll(/'([a-z_.]+)'/g)].map(
  (entry) => entry[1],
);
for (const action of stepUps) out.push(`- \`${action}\``);
out.push('');

// ===========================================================================

const check = process.argv.includes('--check');
const sheet = readFileSync(SHEET, 'utf8');
const begin = '<!-- BEGIN:GENERATED -->';
const end = '<!-- END:GENERATED -->';
if (!sheet.includes(begin) || !sheet.includes(end)) {
  throw new Error(`${SHEET} is missing the ${begin} / ${end} markers`);
}
const rebuilt =
  sheet.slice(0, sheet.indexOf(begin) + begin.length) +
  '\n\n' +
  out.join('\n').trimEnd() +
  '\n\n' +
  sheet.slice(sheet.indexOf(end));

if (check) {
  if (rebuilt !== sheet) {
    console.error(
      'docs/ROLE-ACTION-MATRIX.md is out of date with the code that enforces it.\n' +
        'Run `node scripts/build-action-matrix.mjs` and commit the result.\n' +
        'A matrix PSIRS has signed off which no longer describes the platform is\n' +
        'worse than no matrix, because somebody is relying on it.',
    );
    process.exit(1);
  }
} else {
  writeFileSync(SHEET, rebuilt);
}

console.log(
  `ROLE-ACTION-MATRIX.md${check ? ' (checked)' : ''}: ${roleNames.length} roles, ` +
    `${catalogue.length} permissions, ${stepUps.length} step-up actions`,
);
