/**
 * The document a government reads to answer "what proves this".
 *
 * `docs/PRD-TRACEABILITY.md` maps every acceptance criterion from PRD §84 and
 * Addendum §47 to the code that implements it and the test that proves it. The
 * third column is quoted test names, and nothing checked that any of them
 * existed.
 *
 * One did not, and it is the reason this file exists. Against **View audit
 * logs** the table cited:
 *
 *     verifies the audit hash chain end to end
 *
 * No test of that name has ever existed. The real one is *replays the audit
 * hash chain and says how far it reached*, and it is named that deliberately:
 * its own body records that the earlier assertion of "No tampering detected"
 * was something "the replay cannot establish", because entries cut from the
 * end of the log leave a shorter chain that verifies perfectly.
 * `services/audit.ts` puts it plainly — the function "has no way to know how
 * long the log used to be".
 *
 * So the code stopped claiming end-to-end verification, the test was renamed to
 * stop claiming it, and the document a government reads went on claiming it.
 * That is the gap a citation nobody checks leaves open.
 *
 * WHAT THIS CANNOT DO. It checks that a cited test exists — not that the test
 * proves the criterion beside it. Those are different questions and only the
 * first is mechanical. Saying so here is the point: a guard that implies the
 * second would be the same defect one level up.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const TABLE = join(REPO_ROOT, 'docs', 'PRD-TRACEABILITY.md');

/**
 * The three suites a citation may come from.
 *
 * The offline and session criteria are proved in the agent application,
 * because that is where the behaviour lives. The table's header used to say
 * every name came from `apps/api/src/tests/`, which quietly excluded five
 * citations that were perfectly real.
 */
const SUITES = [
  join(REPO_ROOT, 'apps', 'api', 'src', 'tests'),
  join(REPO_ROOT, 'apps', 'agent', 'src'),
  join(REPO_ROOT, 'apps', 'portal', 'src', 'tests'),
];

/**
 * Compare on meaning, not on typography.
 *
 * A first pass at this check reported five tests missing that were all there,
 * differing only by a curly apostrophe; a sixth differed only by `→` against
 * `->`. A guard that fails on a quotation mark trains its reader to ignore it.
 */
const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—→]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Every test name each suite declares, and the templates it builds names from.
 *
 * NOT the file contents. A first version of this check searched the raw source
 * of every test file, and passed on the very citation it was written to catch
 * — because this file's own header quotes that citation while explaining it.
 * A guard that reads its own prose as evidence is worse than no guard: it
 * cannot fail for the one input that matters, and it reports success.
 *
 * So names are parsed out of `it`, `test` and `describe` declarations. A
 * template name — ``it(`refuses ${label}`)`` — contributes its literal prefix
 * and the file's quoted strings, which is how `agent-scope.test.ts` declares
 * one test per forbidden route.
 */
interface SuiteNames {
  literal: Set<string>;
  templates: { prefix: string; labels: Set<string> }[];
}

function namesIn(directory: string): SuiteNames {
  const literal = new Set<string>();
  const templates: { prefix: string; labels: Set<string> }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;

      const source = readFileSync(full, 'utf8');
      const labels = new Set(
        [...source.matchAll(/'([^'\n]{4,120})'/g)].map((match) => normalise(match[1]!)),
      );

      /*
       * Delimiter-aware: the body may contain the *other* quote character.
       * A character class of `[^'"`]` truncated `telling "unreachable" apart
       * from "refused"` at its first double quote and reported a real test as
       * missing.
       */
      for (const match of source.matchAll(/\b(?:it|test|describe)\(\s*'([^'\n]*)'/g)) {
        literal.add(normalise(match[1]!));
      }
      for (const match of source.matchAll(/\b(?:it|test|describe)\(\s*"([^"\n]*)"/g)) {
        literal.add(normalise(match[1]!));
      }
      for (const match of source.matchAll(/\b(?:it|test|describe)\(\s*`([^`]*)`/g)) {
        const body = match[1]!;
        if (!body.includes('${')) {
          literal.add(normalise(body));
          continue;
        }
        templates.push({ prefix: normalise(body.slice(0, body.indexOf('${'))), labels });
      }
    }
  };
  walk(directory);
  return { literal, templates };
}

/**
 * Does any suite declare a test this citation names?
 *
 * Matched as a fragment of a declared name rather than the whole of it,
 * because the table quotes the distinctive part of a long one — *reverses
 * transaction, receipt and commission together* for a test that goes on to say
 * "under approval", and *a TIN is never invented* for the `describe` that
 * prefixes it with "TIN service:". Requiring equality would force the document
 * to be padded to match the code, which is the wrong way round.
 *
 * The anchor that matters is unchanged and is the whole point of this file:
 * the fragment must occur in a name a suite DECLARES, not merely somewhere in
 * a test file's text.
 */
function declared(suites: SuiteNames[], needle: string, abbreviated: boolean): boolean {
  for (const suite of suites) {
    for (const name of suite.literal) {
      if (abbreviated ? name.startsWith(needle) : name.includes(needle)) return true;
    }
    for (const template of suite.templates) {
      if (!needle.startsWith(template.prefix)) continue;
      const rest = needle.slice(template.prefix.length).trim();
      if (rest && template.labels.has(rest)) return true;
    }
  }
  return false;
}

/** Every italicised citation in the table's rightmost column. */
function citations(): string[] {
  const found = new Set<string>();
  for (const line of readFileSync(TABLE, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const column = cells[cells.length - 2] ?? '';
    for (const match of column.matchAll(/\*([^*]+)\*/g)) found.add(match[1]!.trim());
  }
  return [...found];
}

/**
 * Citations that name something other than a test, each with its reason.
 *
 * Kept short on purpose. An entry here is the table declining to claim a test
 * proves a thing, which is worth far more than a citation that points at
 * nothing — but a long list would be this check quietly switching itself off.
 */
const NOT_A_TEST_NAME: Record<string, string> = {
  Limited: 'a cell in the role matrix, italicised as a verdict rather than a citation',
  No: 'the same — the role matrix writes its answers in italics',
  Yes: 'the same',
};

describe('the traceability table', () => {
  it('cites no test that does not exist', () => {
    const cited = citations();
    assert.ok(cited.length > 50, `expected the table to cite tests, found ${cited.length}`);

    const suites = SUITES.map(namesIn);
    const declaredCount = suites.reduce((total, suite) => total + suite.literal.size, 0);
    assert.ok(declaredCount > 500, `parsed too few test names to trust: ${declaredCount}`);

    const missing: string[] = [];
    for (const citation of cited) {
      if (citation in NOT_A_TEST_NAME) continue;

      /*
       * An abbreviation ends in an ellipsis and is matched on its prefix; the
       * table uses them where a full name would swamp the cell.
       */
      const abbreviated = citation.includes('…');
      const needle = normalise(abbreviated ? citation.split('…')[0]! : citation);
      if (needle.length < 6) continue;

      if (!declared(suites, needle, abbreviated)) missing.push(citation);
    }

    assert.deepEqual(
      missing,
      [],
      'cited as the test that proves a criterion, and no suite has it:\n' +
        missing.map((name) => `  *${name}*`).join('\n'),
    );
  });

  it('does not claim the audit replay reaches the end of the log', () => {
    /*
     * The specific claim, held separately from the general check above,
     * because it is the one that was false rather than merely unverifiable —
     * and because a future edit could reintroduce the wording against a test
     * name that does exist, which the check above would pass.
     *
     * A replay of the log against itself cannot see its own tail being cut
     * off. Every document that describes it has to stop short of saying it
     * can.
     */
    const table = readFileSync(TABLE, 'utf8');
    const overclaims = table
      .split('\n')
      .filter((line) => /audit.{0,40}chain|chain.{0,40}audit/i.test(line))
      .filter((line) => /end to end|end-to-end|no tampering|proves the log is complete/i.test(line))
      // The paragraph in the header that records the correction has to be able
      // to quote the wording it corrected.
      .filter((line) => !/used to|went on making|cited \*/i.test(line));

    assert.deepEqual(
      overclaims,
      [],
      'the replay cannot establish this, and services/audit.ts says so:\n' + overclaims.join('\n'),
    );
  });
});
