/**
 * The public lookup refuses to enumerate, and one character undid that.
 *
 * `GET /citizen-status?name=` deliberately answers a name search with a COUNT
 * and the sentence "use your TIN or phone number to see your specific record".
 * It is rate limited to ten requests a minute per address for exactly one
 * reason: the register of who pays tax in Plateau State is not a list a
 * stranger may page through.
 *
 * The count was produced by `... LIKE $1` with the pattern built as
 * `%${name}%`. `%` and `_` are LIKE wildcards, so the term was not a term.
 * Observed against the database, on a register of five people:
 *
 *     a stranger searching name=Am:         1
 *     a stranger searching name=%%:         5    <- the whole active register
 *     a stranger searching name=_____ ____: 4    <- a length probe
 *
 * The second is the register's size, which is the one number this route exists
 * not to give. The third is worse in kind: `_` counts characters, so a caller
 * can ask how many people have a forename of exactly five letters and narrow
 * from there — a positional oracle a substring search cannot offer at all.
 * Neither needs an account, a TIN, or anything but a browser.
 *
 * The minimum length does not help. `name` requires two characters and `%%` is
 * two characters.
 *
 * These tests are written against the HTTP door rather than the query, because
 * the query is not what a stranger has.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { firstLgaId, get, pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { seedReferenceData } from '../db/seed';
import { escapeLike, likeContains } from '../lib/like';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/** Five people and two businesses whose names contain LIKE metacharacters. */
const REGISTER = [
  { first: 'Amina', last: 'Musa', business: null },
  { first: 'Bala', last: 'Musa', business: null },
  { first: 'Chinedu', last: 'Okafor', business: null },
  { first: 'Dauda', last: 'Bello', business: null },
  { first: 'Esther', last: 'Yakubu', business: null },
  { first: null, last: null, business: 'A_Z Traders' },
  { first: null, last: null, business: 'AXZ Traders' },
];

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  const lgaId = await firstLgaId();
  for (const [index, person] of REGISTER.entries()) {
    await pool.query(
      `INSERT INTO taxpayers (taxpayer_type, phone, address, lga_id, first_name, last_name, business_name)
       VALUES ($1, $2, 'Jos', $3, $4, $5, $6)`,
      [
        person.business ? 'BUSINESS' : 'INDIVIDUAL',
        `0800000${index}0`,
        lgaId,
        person.first,
        person.last,
        person.business,
      ],
    );
  }
});

async function lookup(name: string): Promise<{ found: boolean; count?: number }> {
  const response = await get(`/citizen-status?name=${encodeURIComponent(name)}`);
  assert.equal(response.status, 200, `lookup for ${JSON.stringify(name)} was refused`);
  return response.body;
}

describe('a search box is not a pattern', () => {
  it('does not hand a stranger the size of the register', async () => {
    const wildcard = await lookup('%%');
    assert.equal(
      wildcard.count ?? 0,
      0,
      'a name of two percent signs counted the whole active register',
    );
    assert.equal(wildcard.found, false);
  });

  it('does not answer a length probe', async () => {
    // `_____ ____` is "five characters, a space, four characters" as a pattern,
    // and nobody in the register is called that as a name.
    const probe = await lookup('_____ ____');
    assert.equal(probe.count ?? 0, 0, 'underscores were still counting characters');
  });

  it('still finds somebody by part of their name', async () => {
    const real = await lookup('Musa');
    assert.equal(real.found, true);
    assert.equal(real.count, 2, 'the ordinary substring search stopped working');
  });

  it('finds a name that contains a wildcard character, by typing it', async () => {
    // The other half of the fix: `A_Z Traders` is a real name, and somebody
    // searching for it should find it and not also find `AXZ Traders`.
    const literal = await lookup('A_Z');
    assert.equal(literal.count, 1, 'the underscore was read as a wildcard, not as itself');
  });
});

describe('escapeLike', () => {
  it('makes every metacharacter, and the escape itself, literal', () => {
    assert.equal(escapeLike('a%b'), 'a\\%b');
    assert.equal(escapeLike('a_b'), 'a\\_b');
    // The one investigation.ts missed: an unescaped backslash re-opened the
    // wildcard that followed it.
    assert.equal(escapeLike('a\\%b'), 'a\\\\\\%b');
    assert.equal(escapeLike('plain'), 'plain');
    assert.equal(likeContains('a%b'), '%a\\%b%');
  });

  it('leaves a term Postgres will read back as itself', async () => {
    // Asked of the database rather than asserted about it: the escape
    // character is a property of LIKE, not of this function.
    const { rows } = await pool.query<{ literal: boolean; wildcard: boolean }>(
      `SELECT 'xxa%bxx' LIKE $1 AS literal, 'xxaZZZbxx' LIKE $1 AS wildcard`,
      [likeContains('a%b')],
    );
    assert.equal(rows[0]!.literal, true, 'the literal text stopped matching');
    assert.equal(rows[0]!.wildcard, false, 'the percent sign was still a wildcard');
  });
});

/**
 * Every search that uses LIKE goes through the escaper.
 *
 * Five sites built a LIKE pattern out of a caller's term, in two different
 * shapes — three wrapped it in JavaScript, two concatenated it in SQL — and
 * one of the five had been given a partial escaper while the other four had
 * none. That is what a fix applied at the call site looks like a year later.
 *
 * So the rule is about the file, not the expression: a file whose SQL uses
 * LIKE must import the escaper. It cannot tell whether a particular pattern is
 * built from a caller's term or from a constant, which is why an exception is
 * a written-down reason rather than a silent exclusion.
 *
 * Comment lines are skipped. A guard that counts the word LIKE in prose is a
 * guard that fires on its own explanation, and this file's header is full of
 * it.
 */
const SRC = join(__dirname, '..');

/** `LIKE` or `ILIKE` as SQL: capitalised, on a word boundary. */
const USES_LIKE = /\b(?:I?LIKE)\b/;

/** Written down, with the reason, rather than quietly excluded. */
const ALLOWED: Record<string, string> = {
  'db/load-test.ts':
    'The load harness, which serves no request. Every pattern in it is built by the ' +
    'harness from its own fixture names and loop counter — `Fixture%`, `RECONGW-...-%` ' +
    '— and the trailing wildcard is the point: it is measuring what a prefix scan costs. ' +
    'No caller term reaches it.',
};

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests' || entry === 'node_modules') continue;
      found.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

function usesLike(file: string): boolean {
  return readFileSync(file, 'utf8')
    .split('\n')
    .some((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        return false;
      }
      return USES_LIKE.test(line);
    });
}

describe('every LIKE goes through the escaper', () => {
  it('leaves no file building a pattern without it', () => {
    const files = sourceFiles(SRC).filter((file) => !file.endsWith(`${sep}like.ts`));
    const offenders: string[] = [];

    for (const file of files) {
      const relative = file.slice(SRC.length + 1).split(sep).join('/');
      if (relative in ALLOWED || !usesLike(file)) continue;
      if (!/from '\.{1,2}\/(?:\.\.\/)*lib\/like'/.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'these use LIKE and do not import the escaper, so a term carrying % or _ ' +
        'is read as a pattern. Use escapeLike/likeContains from lib/like, or add the ' +
        `file to ALLOWED with the reason:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('keeps every written-down exception load-bearing', () => {
    const idle = Object.keys(ALLOWED).filter(
      (relative) => !usesLike(join(SRC, ...relative.split('/'))),
    );
    assert.deepEqual(idle, [], `ALLOWED excuses files that do not use LIKE: ${idle.join(', ')}`);
  });
});
