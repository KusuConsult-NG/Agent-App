/**
 * What changing how the platform addresses its reader would actually touch.
 *
 * The dictionary addresses whoever is reading as `ka` — second person,
 * masculine, singular. `HAUSA-REVIEW-QUESTIONS.md` asks PSIRS to decide
 * whether that is who it means to be talking to, and the honest answer to
 * "what would it cost to change" is not a number somebody guessed. This
 * generates it.
 *
 * Run it to see the scale:
 *
 *     node scripts/ka-address-preview.mjs
 *
 * Run it to produce the sheet a reviewer corrects, one file per option:
 *
 *     node scripts/ka-address-preview.mjs --write ku
 *     node scripts/ka-address-preview.mjs --write ki
 *
 * WHAT THIS IS NOT
 *
 * It is not a translation. Every rewrite it prints is a mechanical
 * substitution from the table below, applied by a program that does not speak
 * Hausa, and several of the rows in that table are the reviewer's to confirm
 * before any of it is believed — `maka` to `muku` is not the regular suffix
 * change the others are, and verb agreement beyond the pronoun is not
 * attempted at all. The output exists so somebody who does speak Hausa reads
 * 222 concrete lines instead of imagining them.
 *
 * Anything the table cannot explain is reported as UNHANDLED rather than
 * guessed at, because a silent miss in a file this size is worse than a gap
 * that names itself.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { translations } from '../packages/shared/dist/cjs/index.js';

const { en, ha } = translations;

/**
 * The forms that mark the reader as masculine singular.
 *
 * `kai` is deliberately absent. All 49 of its uses in this dictionary are
 * something else — `Kimanta kai` (self-assessment), `kai tsaye` (directly),
 * `ya kai` (reached), `hadin kai` (cooperation) — and counting them was how
 * an earlier figure of 216 came to be wrong. Bare words ending in -ka are out
 * for the same reason: `haka`, `aka`, `duka`, `dauka`, `bincika` are ordinary
 * vocabulary, not possessives.
 */
const MARKERS = [
  { name: 'ka (subject pronoun)', re: /(^|[^\p{L}’'])[Kk]a(?![\p{L}])/gu },
  { name: '-nka (your)', re: /(\p{L})nka(?![\p{L}])/gu },
  { name: '-rka (your)', re: /(\p{L})rka(?![\p{L}])/gu },
  { name: 'dinka (your)', re: /(^|[^\p{L}])[Dd]inka(?![\p{L}])/gu },
  { name: 'naka (yours)', re: /(^|[^\p{L}’'])[Nn]aka(?![\p{L}])/gu },
  { name: 'maka (to you)', re: /(^|[^\p{L}’'])[Mm]aka(?![\p{L}])/gu },
  { name: 'kanka (yourself)', re: /(^|[^\p{L}’'])[Kk]anka(?![\p{L}])/gu },
];

/**
 * The candidate paradigms, and which rows are safe to trust.
 *
 * `confident` rows are the regular pronoun and possessive substitutions.
 * `check` rows are the ones a reviewer has to look at: `maka` is suppletive
 * rather than suffixal, and `kanka` is a reflexive whose plural reading may
 * not be the one wanted on a screen addressing one person politely.
 */
const PARADIGMS = {
  ku: {
    label: 'polite plural (gender-neutral)',
    rules: [
      { from: /(^|[^\p{L}’'])[Kk]a(?![\p{L}])/gu, to: 'ku', confident: true },
      { from: /(\p{L})nka(?![\p{L}])/gu, to: '$1nku', literal: true, confident: true },
      { from: /(\p{L})rka(?![\p{L}])/gu, to: '$1rku', literal: true, confident: true },
      { from: /(^|[^\p{L}])[Dd]inka(?![\p{L}])/gu, to: 'dinku', confident: true },
      { from: /(^|[^\p{L}’'])[Nn]aka(?![\p{L}])/gu, to: 'naku', confident: true },
      { from: /(^|[^\p{L}’'])[Mm]aka(?![\p{L}])/gu, to: 'muku', confident: false },
      { from: /(^|[^\p{L}’'])[Kk]anka(?![\p{L}])/gu, to: 'kanku', confident: false },
    ],
  },
  ki: {
    label: 'feminine singular',
    rules: [
      { from: /(^|[^\p{L}’'])[Kk]a(?![\p{L}])/gu, to: 'ki', confident: true },
      { from: /(\p{L})nka(?![\p{L}])/gu, to: '$1nki', literal: true, confident: true },
      { from: /(\p{L})rka(?![\p{L}])/gu, to: '$1rki', literal: true, confident: true },
      { from: /(^|[^\p{L}])[Dd]inka(?![\p{L}])/gu, to: 'dinki', confident: true },
      { from: /(^|[^\p{L}’'])[Nn]aka(?![\p{L}])/gu, to: 'naki', confident: true },
      { from: /(^|[^\p{L}’'])[Mm]aka(?![\p{L}])/gu, to: 'miki', confident: false },
      { from: /(^|[^\p{L}’'])[Kk]anka(?![\p{L}])/gu, to: 'kanki', confident: false },
    ],
  },
};

/**
 * Substitute while keeping the capital.
 *
 * Hausa imperatives open sentences constantly -- "Ka nemo...", "Ka tabbatar
 * ...", "Ka yi..." -- so a case-sensitive rule walks past them, and worse,
 * leaves a string carrying both forms at once. The first draft of this script
 * did exactly that: it rewrote 182 lowercase occurrences, missed 144
 * capitalised ones across 103 further strings, and reported nothing unhandled
 * because the leftover check was blind the same way. `cashChannelReminder`
 * came out reading "Ka tabbatar ... kafin ku ci gaba", which is neither form.
 */
const swap = (replacement) => (match, lead) => {
  const head = lead ?? '';
  const body = match.slice(head.length);
  const capitalised = /^\p{Lu}/u.test(body);
  return head + (capitalised ? replacement[0].toUpperCase() + replacement.slice(1) : replacement);
};

const surfaceOf = (key) =>
  /^ofc/.test(key)
    ? 'The officer portal'
    : /^pub|^cit|^ref|^grp/.test(key)
      ? 'Citizens, referees and group leaders'
      : 'The agent app';

function markersIn(text) {
  const found = [];
  for (const { name, re } of MARKERS) {
    const n = [...text.matchAll(re)].length;
    if (n > 0) found.push({ name, n });
  }
  return found;
}

function rewrite(text, paradigm) {
  let out = text;
  let uncertain = false;
  for (const rule of paradigm.rules) {
    if (rule.from.test(out)) {
      rule.from.lastIndex = 0;
      if (!rule.confident) uncertain = true;
    }
    rule.from.lastIndex = 0;
    out = rule.literal ? out.replace(rule.from, rule.to) : out.replace(rule.from, swap(rule.to));
  }
  return { out, uncertain };
}

const affected = Object.keys(ha)
  .filter((k) => markersIn(ha[k]).length > 0)
  .sort();

const totals = {};
for (const { name } of MARKERS) totals[name] = 0;
for (const k of affected) for (const m of markersIn(ha[k])) totals[m.name] += m.n;

const bySurface = {};
for (const k of affected) (bySurface[surfaceOf(k)] ??= []).push(k);

const write = process.argv.indexOf('--write');
if (write === -1) {
  console.log('Strings addressing the reader as masculine singular\n');
  for (const [name, n] of Object.entries(totals)) {
    console.log(`  ${String(n).padStart(4)} occurrences  ${name}`);
  }
  console.log(`\n  ${String(affected.length).padStart(4)} distinct strings\n`);
  for (const [s, l] of Object.entries(bySurface).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(l.length).padStart(4)}  ${s}`);
  }
  for (const [name, p] of Object.entries(PARADIGMS)) {
    let clean = 0;
    let check = 0;
    let unhandled = 0;
    for (const k of affected) {
      const { out, uncertain } = rewrite(ha[k], p);
      if (markersIn(out).length > 0) unhandled += 1;
      else if (uncertain) check += 1;
      else clean += 1;
    }
    console.log(
      `\n  → ${name} (${p.label}): ${clean} mechanical, ${check} needing a look, ${unhandled} the rules cannot explain`,
    );
  }
  console.log('\nRun with --write ku (or ki) to produce the review sheet.');
  process.exit(0);
}

const choice = process.argv[write + 1];
const paradigm = PARADIGMS[choice];
if (!paradigm) {
  console.error(`Unknown paradigm "${choice}". Use one of: ${Object.keys(PARADIGMS).join(', ')}`);
  process.exit(1);
}

const lines = [
  `# Addressing the reader as \`${choice}\` — every string it would change`,
  '',
  '**Machine-generated, and not a translation.** Every "would become" below is a',
  'mechanical substitution applied by a program that does not speak Hausa. It',
  'exists so the decision is read rather than imagined. Correct it freely; the',
  'corrections are what get applied, not this.',
  '',
  `Paradigm: **${choice}** — ${paradigm.label}.`,
  '',
  '| From | To | Trust |',
  '|---|---|---|',
  ...paradigm.rules.map(
    (r) =>
      `| \`${r.from.source.replace(/\|/g, '\\|')}\` | \`${r.to}\` | ${r.confident ? 'regular' : '**confirm this one**'} |`,
  ),
  '',
  `${affected.length} strings, ${Object.values(totals).reduce((a, b) => a + b, 0)} occurrences.`,
  '',
];

for (const [surface, keys] of Object.entries(bySurface).sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`## ${surface} — ${keys.length} strings`, '');
  for (const k of keys) {
    const { out, uncertain } = rewrite(ha[k], paradigm);
    const left = markersIn(out);
    lines.push(`### \`${k}\`${uncertain ? ' — **confirm**' : ''}${left.length ? ' — **UNHANDLED**' : ''}`);
    lines.push('');
    lines.push(`- English: ${en[k]}`);
    lines.push(`- Now: ${ha[k]}`);
    lines.push(`- Would become: ${out}`);
    if (left.length) {
      lines.push(`- Still masculine after the rules ran: ${left.map((m) => m.name).join(', ')}`);
    }
    lines.push('');
  }
}

const path = `docs/HAUSA-ADDRESS-${choice.toUpperCase()}.md`;
writeFileSync(path, lines.join('\n'));
console.log(`${path}: ${affected.length} strings`);
