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

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/**
 * Every error code the API can return, and how many of them each front end
 * says in Hausa.
 *
 * Counted rather than written down, because the first attempt at writing it
 * down was wrong. A sweep for `conflict('CODE'` on one line found 26 and
 * missed every multi-line call and every `new AppError({ code: … })` literal —
 * which is most of them. 26 went into the reviewer's index as the size of the
 * gap, understating it by a factor of six, on the page this script exists to
 * keep honest.
 *
 * `db/` is excluded: revenue items and notification templates carry a `code`
 * field too, and `PIT`, `ROAD` and `RECEIPT_GENERATED_SMS` are not refusals.
 */
function apiErrorCodes() {
  const codes = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests' && entry.name !== 'db') walk(path);
      } else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(/(?:conflict|refused)\(\s*'([A-Z_][A-Z_0-9]*)'/g)) {
          codes.add(match[1]);
        }
        // `paymentRefused({ code: 'X', … })` and anything else shaped like it:
        // a helper that takes the code as a named field rather than a first
        // positional argument. The count fell by five the moment the payment
        // refusals moved into one, and the guard caught it, which is the
        // argument for counting rather than writing the figure down.
        for (const match of source.matchAll(
          /[a-z][A-Za-z]*(?:Refused|Error|Conflict)\(\{\s*(?:\/\/[^\n]*\n\s*)*code:\s*'([A-Z_][A-Z_0-9]*)'/g,
        )) {
          codes.add(match[1]);
        }
        for (const match of source.matchAll(/code:\s*'([A-Z_][A-Z_0-9]*)'/g)) {
          // An `AppError` literal, not a catalogue row that happens to have a
          // `code` column.
          const window = source.slice(Math.max(0, match.index - 400), match.index + 400);
          if (window.includes('AppError') || window.includes('statusCode')) codes.add(match[1]);
        }
      }
    }
  };
  walk(join(ROOT, 'apps', 'api', 'src'));
  return codes;
}

/** How many of those codes an application translates, by reading its map. */
function translatedServerCodes(app, codes) {
  const source = readFileSync(join(ROOT, 'apps', app, 'src', 'ui.tsx'), 'utf8');
  const start = source.indexOf('const TRANSLATED_ERRORS');
  const block = source.slice(start, source.indexOf('\n};', start));
  return [...block.matchAll(/^  ([A-Z_][A-Z_0-9]*):/gm)]
    .map((match) => match[1])
    .filter((code) => codes.has(code));
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
  ['ofcAr', 'The officer portal — the arrears worklist'],
  ['ofcIg', 'The officer portal — assets and coverage leads'],
  ['ofcPr', 'The officer portal — employers and payroll returns'],
  ['ofcPs', 'The officer portal — the presumptive schedule'],
  ['ofcEn', 'The officer portal — enumeration queues'],
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
/*
 * The prose counts, which the markers do not cover.
 *
 * The sentences above the tables say how many strings the sheet carries, and
 * they are hand-written -- so they said 1,549 for a long time after the
 * dictionary passed two thousand. That is the exact failure this script exists
 * to prevent, one section higher up: a reviewer reads "all 1,549 strings" and
 * takes the sheet for complete. Only comma-formatted four-figure numbers are
 * checked, so the deliberate historical references ("it listed 78 strings")
 * are left alone.
 */
const claimed = [...sheet.matchAll(/\b(\d,\d{3}) (?:dictionary strings|keys|strings)\b/g)];
const total = (safety.length + rest.length).toLocaleString('en-US');
const wrong = claimed.filter((m) => m[1] !== total);
if (wrong.length > 0) {
  console.error(
    `docs/HAUSA-REVIEW.md says ${wrong[0][1]} where the dictionary holds ${total}.\n` +
      'The generated tables are right and the sentence above them is not, which is\n' +
      'the worst way round: the reviewer believes the smaller number.',
  );
  process.exit(1);
}

/*
 * And the same counts in the document the sheet tells the reviewer to read
 * first.
 *
 * `HAUSA-REVIEW-QUESTIONS.md` opens by saying how many strings the sheet
 * carries, and states the size of its biggest question — how many strings
 * address the reader as `ka` — in a headline, a table and a chain of
 * corrections. All of it is hand-written, none of it was checked, and every
 * figure in it was several hundred strings out of date: the index said 3,031
 * where the dictionary held 3,425, and 332 `ka` strings where there were 433.
 *
 * It is the worse of the two documents to have wrong. The sheet's own header
 * sends the reviewer here first — "If you are the Hausa reviewer, read this
 * instead" — so the understated figure is the one they see before anything
 * else, and the decision it understates is the one the sheet says blocks all
 * the others.
 *
 * The `ka` count is recomputed rather than trusted, by the same definition the
 * document sets out: the pronoun at a word boundary and case-insensitively,
 * because Hausa imperatives open sentences constantly; the possessive and
 * clitic forms beside it; and `kai` excluded, because every use of it in this
 * dictionary is something else.
 */
/*
 * Without the `g` flag, deliberately. `RegExp.prototype.test` on a global
 * pattern advances `lastIndex` and resumes from there on the next call, so
 * testing three thousand strings against a shared global regex skips most of
 * them: the first version of this counted 385 where the dictionary holds 433,
 * and the only reason that was caught is that it disagreed with a figure
 * measured another way.
 */
const KA_FORMS = [/\bka\b/i, /\w+nka\b/i, /\w+rka\b/i, /\b(?:dinka|maka|naka|kanka)\b/i];
const kaStrings = Object.values(ha).filter((value) =>
  KA_FORMS.some((form) => form.test(value)),
).length;

const QUESTIONS = join(ROOT, 'docs', 'HAUSA-REVIEW-QUESTIONS.md');
const questions = readFileSync(QUESTIONS, 'utf8');

const errorCodes = apiErrorCodes();
const portalTranslated = translatedServerCodes('portal', errorCodes);
const agentTranslated = translatedServerCodes('agent', errorCodes);

/*
 * Each figure this document states, and what it is supposed to be.
 *
 * `optional` is for the ones that may legitimately be absent -- the historical
 * references, and the `ka` table if somebody reflows it away. Everything else
 * MUST match at least once, because the first version of this guard matched
 * nothing at all: the sentence it was written for wraps between the number and
 * the words after it, the pattern found no occurrences, and no occurrences read
 * as no disagreements. A check that cannot fail is worse than no check, because
 * the page then looks guarded. `\s+` rather than a space for the same reason:
 * prose in this document is wrapped by hand and the wrap point moves.
 */
const FIGURES = [
  {
    what: 'the dictionary',
    pattern: /\b(\d,\d{3})\s+(?:dictionary strings|keys|strings)\b/g,
    actual: total,
  },
  {
    what: 'the `ka` count',
    pattern: /\*\*(\d{3})\s+strings\s+address\s+the\s+reader\s+as/g,
    actual: String(kaStrings),
  },
  {
    what: 'the `ka` count',
    pattern: /\|\s+\*\*Total\*\*\s+\|\s+\*\*(\d{3})\*\*\s+of/g,
    actual: String(kaStrings),
  },
  {
    what: 'the API',
    pattern: /raises\s+\*\*(\d+)\s+distinct\s+error\s+codes\*\*/g,
    actual: String(errorCodes.size),
  },
  {
    what: 'the portal map',
    pattern: /the\s+officer\s+portal\s+says\s+(\d+)\s+of\s+them/g,
    actual: String(portalTranslated.length),
  },
  {
    what: 'the agent application',
    pattern: /the\s+agent\s+application\s+says\s+(\d+)/g,
    actual: String(agentTranslated.length),
  },
];

const questionsWrong = [];
for (const { what, pattern, actual } of FIGURES) {
  const found = [...questions.matchAll(pattern)];
  if (found.length === 0) {
    console.error(
      `docs/HAUSA-REVIEW-QUESTIONS.md no longer states ${what}.\n` +
        'The figure was checked and the sentence carrying it is gone or reworded,\n' +
        'so nothing is checking it now. Restate it or drop the check deliberately.',
    );
    process.exit(1);
  }
  for (const match of found) {
    if (match[1] !== actual) questionsWrong.push([match[1], actual, what]);
  }
}

if (questionsWrong.length > 0) {
  const [said, actual, what] = questionsWrong[0];
  console.error(
    `docs/HAUSA-REVIEW-QUESTIONS.md says ${said} where ${what} holds ${actual}.\n` +
      'That is the page the sheet sends the reviewer to first, so its figure is the\n' +
      'one they see before anything else.',
  );
  process.exit(1);
}

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
