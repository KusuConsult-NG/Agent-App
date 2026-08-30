/**
 * Regenerate the string tables in `docs/HAUSA-REVIEW.md`.
 *
 * The prose in that document is written by hand and stays that way — it is an
 * argument addressed to a person, and a generator has nothing to say about it.
 * What a generator is good for is the part that goes stale: the tables. The
 * dictionary went from 78 strings to several hundred over a handful of days,
 * and a review sheet listing 78 of them is worse than none, because it looks
 * complete.
 *
 * So the prose lives between the markers and this fills in between them:
 *
 *   <!-- BEGIN:GENERATED --> … <!-- END:GENERATED -->
 *
 * Run it after adding strings, and commit the result:
 *
 *   node scripts/build-hausa-review.mjs
 *
 * `--check` rebuilds in memory and exits non-zero if the committed sheet does
 * not match, which is what `npm run verify` runs. Without it the promise this
 * document makes — that it cannot fall behind the app — would be a promise
 * nobody was keeping.
 *
 * The tables are grouped by surface rather than alphabetically, because a
 * reviewer reads a screen at a time and judging a label needs the labels
 * around it. Table A — where being wrong costs somebody money — is listed
 * first and separately, and its membership is a decision recorded in
 * `apps/agent/src/tests/hausa-safety-strings.test.tsx`, not a heuristic.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(ROOT, 'docs', 'HAUSA-REVIEW.md');

/** The dictionary, read from source so the build output is never stale. */
function readDictionary() {
  const source = readFileSync(join(ROOT, 'packages', 'shared', 'src', 'i18n.ts'), 'utf8');
  const langs = {};
  for (const lang of ['en', 'ha']) {
    // Each language is one object literal in `translations`. Slice it out by
    // its opening line and read entries with a tolerant key: value pattern —
    // this is a documentation build, and a string it cannot parse should be
    // reported rather than silently dropped.
    const start = source.indexOf(`\n  ${lang}: {\n`);
    if (start < 0) throw new Error(`no ${lang} block`);
    const end = source.indexOf('\n  },\n', start);
    const block = source.slice(start, end < 0 ? source.length : end);
    const entries = {};
    const pattern = /^\s{4}([A-Za-z0-9_]+):\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)(?:\s*\+\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))*),$/gm;
    for (const match of block.matchAll(pattern)) {
      entries[match[1]] = match[2]
        .split(/\s*\+\s*/)
        .map((part) => JSON.parse(part.startsWith("'") ? `"${part.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : part))
        .join('');
    }
    langs[lang] = entries;
  }
  return langs;
}

/** The safety tier, taken from the test that enforces it. */
function safetyKeys() {
  const source = readFileSync(
    join(ROOT, 'apps', 'agent', 'src', 'tests', 'hausa-safety-strings.test.tsx'),
    'utf8',
  );
  const block = source.slice(source.indexOf('SAFETY_KEYS'), source.indexOf('];', source.indexOf('SAFETY_KEYS')));
  return [...block.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
}

/** The Hausa notification templates, read out of the migration that inserts them. */
function templates() {
  const source = readFileSync(
    join(ROOT, 'apps', 'api', 'src', 'db', 'migrations', '048_the_thirty_messages_in_hausa.sql'),
    'utf8',
  );
  const rows = [];
  // The `E'…'` form appears on the two multi-paragraph email bodies, which
  // carry `\n`. Missing it silently dropped exactly those two from the sheet —
  // the receipt email and the acknowledgement email, which are the longest and
  // most consequential strings in the set.
  const pattern =
    /\('([A-Z0-9_]+_HA)',\s*'([A-Z_]+)',\s*'([A-Z]+)',\s*'ha',\s*(NULL|E?'(?:[^']|'')*'),\s*E?'((?:[^']|'')*)'/g;
  const literal = (value) =>
    value
      .replace(/^E?'|'$/g, '')
      .replace(/''/g, "'")
      .replace(/\\n/g, ' ');
  for (const match of source.matchAll(pattern)) {
    rows.push({
      code: match[1],
      event: match[2],
      channel: match[3],
      subject: match[4] === 'NULL' ? null : literal(match[4]),
      body: literal(`'${match[5]}'`),
    });
  }

  const declared = [...source.matchAll(/\('([A-Z0-9_]+_HA)',/g)].length;
  if (rows.length !== declared) {
    throw new Error(`parsed ${rows.length} of ${declared} templates — the sheet would be short`);
  }
  return rows;
}

/**
 * Which screen a key belongs to, by prefix.
 *
 * A reviewer works through one surface at a time, and a label is judged
 * against the labels beside it rather than against an alphabetical neighbour.
 */
const GROUPS = [
  ['ofcNav', 'The officer portal — navigation'],
  ['ofcGroup', 'The officer portal — menu headings'],
  ['ofcLogin', 'The officer portal — signing in'],
  ['ofcRh', 'The officer portal — the home screen per role'],
  ['ofcAg', 'The officer portal — agent clearance'],
  ['ofcKyc', 'The officer portal — identity documents'],
  ['ofcFa', 'The officer portal — the minimum app version'],
  ['ofcUa', 'The officer portal — officer access'],
  ['ofcDb', 'The officer portal — the collections dashboard'],
  ['ofcRv', 'The officer portal — revenue intelligence'],
  ['ofcFn', 'The officer portal — settlement and commission'],
  ['ofcOv', 'The officer portal — fraud and the audit trail'],
  ['ofcCf', 'The officer portal — the revenue catalogue'],
  ['ofcTr', 'The officer portal — correcting a record'],
  ['ofcOs', 'The officer portal — outstanding work'],
  ['ofcUs', 'The officer portal — product usage'],
  ['ofcSp', 'The officer portal — the support desk'],
  ['ofcGp', 'The officer portal — groups and distributions'],
  ['ofcLv', 'The officer portal — levies'],
  ['ofcAl', 'The officer portal — distribution rounds'],
  ['ofcPf', 'The officer portal — agent performance'],
  ['ofcTx', 'The officer portal — transactions'],
  ['ofcNone', 'The officer portal — empty states'],
  ['ofc', 'The officer portal — everything else'],
  ['home', 'The agent’s first screen'],
  ['nav', 'The tab bar'],
  ['col', 'Taking a payment'],
  ['tp', 'The taxpayer register'],
  ['app', 'Becoming an agent, and the clearance steps'],
  ['id', 'Kinds of identification'],
  ['ref', 'Kinds of referee'],
  ['grp', 'Groups: cooperatives, unions, associations'],
  ['alloc', 'Handing out an allocation'],
  ['verify', 'Checking a receipt'],
  ['sup', 'Reporting a problem'],
  ['more', 'The profile screen'],
  ['auth', 'Signing in'],
  ['stepUp', 'The one-time code'],
  ['shell', 'The frame around every screen'],
  ['cam', 'The camera'],
  ['err', 'What the platform says when it refuses'],
  ['money', 'What happened to the money'],
  ['ui', 'Shared controls'],
  ['pub', 'The pages a citizen reads without an account'],
];

function groupOf(key) {
  for (const [prefix, title] of GROUPS) {
    if (key.startsWith(prefix) && /[A-Z]/.test(key[prefix.length] ?? '')) return title;
  }
  return 'Everything else';
}

const escape = (value) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function table(rows, { en, ha }) {
  const lines = [
    '| Key | English | Hausa (draft) | OK? | Your correction |',
    '|---|---|---|:---:|---|',
  ];
  for (const key of rows) {
    lines.push(`| \`${key}\` | ${escape(en[key] ?? '')} | ${escape(ha[key] ?? '')} | ☐ | |`);
  }
  return lines.join('\n');
}

const { en, ha } = readDictionary();
const safety = safetyKeys().filter((key) => key in en);
const rest = Object.keys(en).filter((key) => !safety.includes(key));

const missing = Object.keys(en).filter((key) => !(key in ha));
if (missing.length) throw new Error(`untranslated keys: ${missing.join(', ')}`);

const out = [];
out.push('### A · The safety tier');
out.push('');
out.push(
  'Being wrong here costs somebody money. Read these first, and if your time',
  'runs out, stop after them. Membership of this tier is enforced by',
  '`apps/agent/src/tests/hausa-safety-strings.test.tsx` — a string cannot',
  'quietly leave it.',
);
out.push('');
out.push(table(safety, { en, ha }));
out.push('');
out.push('### B · The rest of the dictionary, by screen');
out.push('');
out.push(
  `${rest.length} strings, grouped by where an agent meets them. Lower stakes`,
  'than table A — these are labels, headings and status words rather than',
  'instructions — but they are what an agent reads all day.',
);
out.push('');

const grouped = new Map();
for (const key of rest) {
  const title = groupOf(key);
  if (!grouped.has(title)) grouped.set(title, []);
  grouped.get(title).push(key);
}
// Named groups in the declared order, then whatever is left over.
const order = [...GROUPS.map(([, title]) => title), 'Everything else'];
for (const title of order) {
  const keys = grouped.get(title);
  if (!keys?.length) continue;
  out.push(`#### ${title}`);
  out.push('');
  out.push(table(keys, { en, ha }));
  out.push('');
}

const rows = templates();
out.push('### C · The messages PSIRS sends');
out.push('');
out.push(
  `${rows.length} templates, and the highest-stakes strings in the project. A`,
  'citizen holds no account here: the SMS is the entire record of the',
  'transaction as far as they are concerned, and nobody is standing beside',
  'them to explain it. Read the acknowledgement wording especially closely —',
  'it has to be unmistakably **not** a receipt.',
);
out.push('');
out.push('| Code | Channel | Subject | Body | OK? | Your correction |');
out.push('|---|---|---|---|:---:|---|');
for (const row of rows) {
  out.push(
    `| \`${row.code}\` | ${row.channel} | ${escape(row.subject ?? '—')} | ${escape(row.body)} | ☐ | |`,
  );
}
out.push('');

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
      'docs/HAUSA-REVIEW.md is out of date with the dictionary.\n' +
        'Run `node scripts/build-hausa-review.mjs` and commit the result.\n' +
        'A review sheet that lists some of the strings is worse than none, because\n' +
        'it looks complete to the person reviewing it.',
    );
    process.exit(1);
  }
} else {
  writeFileSync(SHEET, rebuilt);
}

console.log(
  `HAUSA-REVIEW.md${check ? ' (checked)' : ''}: ${safety.length} safety strings, ` +
    `${rest.length} others, ${rows.length} templates`,
);
