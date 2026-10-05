/**
 * The figures three comments state about the audit screen, recounted.
 *
 * `Oversight.tsx` normalises every audit answer into `{ rows, cap }` because
 * some endpoints cap in their own SQL and answer an envelope while the rest
 * answer a bare array. The comment above that function told a reader which was
 * which — "one of the five audit answers… two of them are capped" — and two
 * test headers repeated the same two numbers.
 *
 * All three were wrong. A sixth answer was added beside them, the register
 * search log, capped at 500 like the access log, and none of the three
 * sentences was touched. A reader checking whether the shape-normalising code
 * still needed to accept both shapes was counting from prose that had been
 * overtaken.
 *
 * WHY A TEST AND NOT A CAREFUL EDIT
 *
 * Because the careful edit is what failed. The numbers were right when they
 * were written and nothing recounted them, which is the same failure the Hausa
 * review figures had — "all three figures are now recomputed by
 * `scripts/build-hausa-review.mjs` and the build refuses when this sentence
 * disagrees with them". This is that, for the audit screen.
 *
 * It reads both sides from source: how many answers `AUDIT_QUERIES` lists, and
 * how many of the endpoints behind them cap in `reports.ts`. A seventh answer,
 * or a fourth cap, fails this until the sentences are brought with it.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function workspaceRoot(): string {
  let directory = __dirname;
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (parsed.workspaces) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`no workspace root above ${__dirname}`);
    directory = parent;
  }
}

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** The audit answers the officer's screen offers. */
function answerCount(root: string): number {
  const source = readFileSync(join(root, 'apps/portal/src/screens/Oversight.tsx'), 'utf8');
  const start = source.indexOf('AUDIT_QUERIES');
  assert.ok(start > 0, 'AUDIT_QUERIES is no longer in Oversight.tsx');
  const block = source.slice(start, source.indexOf('\n];', start));
  const keys = [...block.matchAll(/key: '([^']+)'/g)].map((m) => m[1]!);
  assert.ok(keys.length >= 4, `only ${keys.length} audit answers read; the shape has changed`);
  return keys.length;
}

/**
 * The report functions that cap in their own SQL.
 *
 * Counted by the `cap = <CONSTANT>` default rather than by name, because that
 * default IS the cap: a function that takes one answers an envelope, and one
 * that does not answers a bare array. Three today.
 */
function cappedCount(root: string): number {
  const source = readFileSync(join(root, 'apps/api/src/services/reports.ts'), 'utf8');
  const capped = [...source.matchAll(/cap = ([A-Z_]+_CAP)\b/g)].map((m) => m[1]!);
  assert.ok(capped.length >= 2, `only ${capped.length} capped answers read; the shape has changed`);
  return capped.length;
}

/** Every sentence that states these figures, and the numbers it states. */
const SENTENCES: { file: string; pattern: RegExp; what: 'answers' | 'capped' }[] = [
  {
    file: 'apps/portal/src/screens/Oversight.tsx',
    pattern: /One of the (\w+) audit answers/,
    what: 'answers',
  },
  {
    file: 'apps/portal/src/screens/Oversight.tsx',
    pattern: /(\w+) of them are capped/,
    what: 'capped',
  },
  {
    file: 'apps/api/src/tests/a-list-that-said-how-much-it-left-out.test.ts',
    pattern: /(\w+) of the \w+ audit answers are\s+\*?\s*capped/,
    what: 'capped',
  },
  {
    file: 'apps/api/src/tests/a-list-that-said-how-much-it-left-out.test.ts',
    pattern: /of the (\w+) audit answers/,
    what: 'answers',
  },
  {
    file: 'apps/portal/src/tests/a-list-that-said-how-much-it-left-out.test.tsx',
    pattern: /The (\w+) standard questions are different/,
    what: 'answers',
  },
  {
    file: 'apps/portal/src/tests/a-list-that-said-how-much-it-left-out.test.tsx',
    pattern: /(\w+) of them are capped in/,
    what: 'capped',
  },
];

describe('the figures the audit screen states about itself', () => {
  it('match what is actually there', () => {
    const root = workspaceRoot();
    const actual = { answers: answerCount(root), capped: cappedCount(root) };

    const wrong: string[] = [];
    for (const { file, pattern, what } of SENTENCES) {
      const source = readFileSync(join(root, file), 'utf8');
      const found = pattern.exec(source);
      assert.ok(
        found,
        `${file} no longer states how many ${what} there are. The figure was checked and ` +
          'the sentence carrying it is gone or reworded, so nothing is checking it now. ' +
          'Restate it or drop it from SENTENCES deliberately',
      );
      const stated = WORDS[found![1]!.toLowerCase()] ?? Number.parseInt(found![1]!, 10);
      if (stated !== actual[what]) {
        wrong.push(`${file}: says ${found![1]} ${what}, there are ${actual[what]}`);
      }
    }

    assert.deepEqual(
      wrong,
      [],
      'these sentences disagree with the code they describe, which is the state they were ' +
        'in when a sixth audit answer was added and none of them was recounted',
    );
  });
});
