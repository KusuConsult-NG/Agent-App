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
      const prefix = ROUTER_PREFIX[start[1]];
      if (prefix === undefined) {
        throw new Error(
          `${start[1]} is not mounted in app.ts, so ${path[1]} has no URL. ` +
            'Add the mount, or this row would name a path that does not exist.',
        );
      }
      for (const permission of named) {
        if (!byPermission.has(permission)) byPermission.set(permission, []);
        // `receiptRouter.get('/')` is `GET /receipts`, not `GET /receipts/`.
        const url = prefix + (path[1] === '/' ? '' : path[1]);
        const endpoint = `${start[2].toUpperCase()} ${url}`;
        // Once per endpoint: a route that names one permission for two of
        // the kinds it accepts is still one door.
        if (!byPermission.get(permission).includes(endpoint)) byPermission.get(permission).push(endpoint);
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
/**
 * Where each router is mounted, read from `app.ts` rather than kept by hand.
 *
 * This was a literal map, and a hand-kept map of something the code already
 * states drifts. Six routers were missing from it -- receipts, documents,
 * verification, webhooks, allocations and the group attestation link -- and
 * every one of those fell through `?? ''`, so their rows in the matrix named
 * a path with no prefix on it at all: `document:read:all` was published as
 * granting `GET /:id`, and `allocation:collect` as granting `POST
 * /collections`. A matrix of who may do what, naming endpoints that do not
 * exist, cannot be checked against anything.
 *
 * Two more were simply wrong: `/referees` for a router mounted at `/referee`,
 * and `/citizen` for one mounted at `/citizen-status`. Those were worse than
 * the blanks, because they looked right.
 *
 * A router with no mount now throws. Falling back to '' is how eight of these
 * stayed wrong through every regeneration of this document.
 */
const ROUTER_PREFIX = Object.fromEntries(
  [
    ...readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8').matchAll(
      /\bapi\.use\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/g,
    ),
  ].map((match) => [match[2], match[1]]),
);

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
    'names this permission**, and every dash states why beside it. That is ' +
    'the column to read first, because authority that looks real and confers ' +
    'nothing is the thing this table exists to expose. Generating it found ' +
    'one: `payment:reverse:request` was granted to two roles and checked ' +
    'nowhere, so any officer who could request an agent activation could ' +
    'request a payment reversal. It is enforced now.',
);
out.push('');
out.push(
  'The reasons are not interchangeable, which is why they are written out ' +
    'per row rather than once here. `agent:read:own` and its siblings are ' +
    'scoped by which agent is asking, so nothing consults them and nothing ' +
    'should. `invoice:create` used to be a different thing wearing the same ' +
    'dash — real authority, enforced by `assessment:create` instead — and ' +
    'now guards the one act that creates an invoice and nothing else: ' +
    'issuing a lapsed bill again. Raising a new assessment, which writes its ' +
    'first invoice, is still `assessment:create`. A dash nobody has explained ' +
    'now fails the generator rather than printing.',
);
out.push('');
out.push('| Permission | Verb | Held by | Endpoints |');
out.push('| --- | --- | --- | --- |');

/**
 * Every permission that no route guard and no service check names, and why.
 *
 * A dash in the endpoint column is the thing this table exists to expose, and
 * the paragraph under it already says so. What the paragraph could not say is
 * WHICH dash is which, and the two kinds are not alike:
 *
 *   - `agent:read:own` and its siblings are scoped by which agent is asking.
 *     The permission names a shape of access that the query enforces by
 *     actor, so nothing consults it and nothing should.
 *   - `invoice:create` was the other kind until it was given a route: real
 *     authority, enforced by `assessment:create` on the same role, so that
 *     revoking it achieved nothing. It now guards
 *     `POST /revenue/invoices/:id/reissue` and is no longer a dash.
 *
 * Sharing one disclaimer let the second kind read as the first. Each entry
 * now carries its own reason, printed beside the dash, and `--check` refuses
 * a dash nobody has explained — the same shape as the acknowledgement list in
 * `apps/api/scripts/check-dead-predicates.mjs`.
 *
 * Adding an entry here is a claim that nothing should consult the permission.
 * It is not a way to quieten the check: `payment:reverse:request` was once a
 * dash, and the answer was to enforce it rather than to explain it.
 */
const ACKNOWLEDGED_DASHES = new Map([
  ['agent:read:own', 'scoped by which agent is asking'],
  ['report:read:own', 'scoped by which agent is asking'],
  ['support:read:own', 'scoped by who raised the ticket'],
]);

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
  const reason = ACKNOWLEDGED_DASHES.get(permission);
  const cell = paths.length > 0 ? shown + more : `— ${reason ? `(${reason})` : ''}`.trim();
  out.push(
    `| \`${permission}\` | ${verbFor(permission)} | ` +
      `${holders.length === 0 ? '**nobody**' : holders.join(', ')} | ` +
      `${cell} |`,
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

/*
 * A dash nobody explained, and an explanation for something now enforced.
 *
 * Checked before the drift comparison, because regenerating the document
 * would make an unexplained dash look like ordinary drift and the remedy
 * printed would be "run the generator" — which would commit the gap rather
 * than report it.
 */
const unexplained = catalogue.filter(
  (permission) => (endpoints.get(permission) ?? []).length === 0 && !ACKNOWLEDGED_DASHES.has(permission),
);
const staleAcknowledgements = [...ACKNOWLEDGED_DASHES.keys()].filter(
  (permission) => (endpoints.get(permission) ?? []).length > 0,
);

if (unexplained.length > 0) {
  console.error(
    'These permissions are named by no route guard and no service check, and ' +
      'nothing in the generator explains why:\n' +
      unexplained.map((permission) => `  ${permission}`).join('\n') +
      '\n\nAuthority that looks real and confers nothing is what this table ' +
      'exists to expose. Either enforce it where it belongs, or add it to ' +
      'ACKNOWLEDGED_DASHES with the reason nothing should consult it.',
  );
  process.exit(1);
}

if (staleAcknowledgements.length > 0) {
  console.error(
    'These permissions are acknowledged as conferring nothing, and now have ' +
      'endpoints:\n' +
      staleAcknowledgements.map((permission) => `  ${permission}`).join('\n') +
      '\n\nRemove them from ACKNOWLEDGED_DASHES: an explanation left behind ' +
      'after the thing it explained changed is how a matrix starts lying.',
  );
  process.exit(1);
}

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
