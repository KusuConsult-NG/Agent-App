/**
 * Every refusal the collect screen can show, against what the agent can read.
 *
 * The agent application translates a refusal by its code — deliberately, since
 * the server's wording changes and a translation matched on text would stop
 * applying the moment somebody improved an English sentence, silently and in
 * the language nobody testing it reads. A code absent from that map falls back
 * to the server's words, which is the right fallback and the wrong outcome.
 *
 * WHY THIS IS A CHECK AND NOT A LIST OF FIXES
 *
 * It has been closed by hand twice and reopened both times. The second attempt
 * was a commit called "Every refusal on the collect screen, in English", and
 * it was not: I had read the body of `createAssessmentIn`, named the six codes
 * it raises and translated all six. `NO_EFFECTIVE_RATE` is raised one level
 * down by `resolveRate`, which that function calls, and the five payment codes
 * are raised by `initiatePayment`, which the same screen reaches one tap
 * later. Reading one function body cannot see either.
 *
 * So this reads the whole path the screen drives, and it reads it from source
 * rather than from a list, because a list of codes in a test file is a copy
 * and a copy goes stale the first time somebody adds a refusal without opening
 * this file — which is precisely the case worth catching, since the new
 * refusal is the one nobody remembered to translate.
 *
 * WHAT THE PATH IS
 *
 * `Collect.tsx` posts to `/revenue/quote`, `/revenue/assessments` and
 * `/payments/initiate`, and polls `/payments/transactions/:id/status`. Those
 * resolve to the functions named in `COLLECT_PATH` below. The list is of
 * functions and not of files on purpose: `payments.ts` also holds
 * `handleWebhook`, whose refusals go to a gateway and not to a person.
 *
 * THE THREE GENERIC CODES ARE DECLARED, NOT IGNORED
 *
 * `NOT_FOUND`, `FORBIDDEN` and `INVALID_REQUEST` are raised on this path and
 * are not translated, each for a reason written down in `UNTRANSLATED` below.
 * A reader can disagree with any of the three; what they cannot do is miss
 * that the decision was made.
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

/**
 * The code the collect screen's four requests run.
 *
 * A list of function names, or `'*'` for a file whose every refusal is on this
 * path. Both are needed, and the difference is the subtle part.
 *
 * Naming functions is right for `revenue.ts` and `payments.ts`, which also hold
 * officer-only work: `setRevenueItemStatus` refuses things no agent can ask
 * for, and `handleWebhook` refuses a gateway rather than a person. A slice runs
 * from one `export function` to the next, so a private helper sitting between
 * two exported functions is inside the earlier one's slice and is read.
 *
 * `rate-engine.ts` has to be the whole file, and discovering why is what this
 * test was for. Its twelve refusals live in helpers ABOVE its only exported
 * function, so they are before the first slice begins and would be in none of
 * them — the same one-level-down miss that this check exists to catch, in the
 * check itself. The file computes an amount for a quote or an assessment and
 * does nothing else, so every refusal in it reaches the collect screen.
 */
const COLLECT_PATH: Record<string, string[] | '*'> = {
  'apps/api/src/services/revenue.ts': [
    'listItems',
    'resolveRate',
    'quote',
    'createAssessment',
    'createAssessmentIn',
  ],
  'apps/api/src/services/payments.ts': [
    'initiatePayment',
    'getTransactionStatus',
    'confirmPayment',
  ],
  'apps/api/src/services/rate-engine.ts': '*',
};

/**
 * Codes on this path that stay in the server's English, and why.
 *
 * Each line is a decision about one code, not a convenience. The first two are
 * the same objection in two shapes: the sentence differs every time the code is
 * raised, so a single translation would have to be vaguer than the English it
 * replaced.
 */
const UNTRANSLATED: Record<string, string> = {
  NOT_FOUND:
    'The message names its subject — "That taxpayer", "That revenue item" — and the ' +
    'subject varies. Translating it needs the subject sent as a field and a change to ' +
    'notFound() everywhere it is used, which is a larger thing than this path.',
  FORBIDDEN:
    'On this path it means one thing: a self-assessment of an item that is not ' +
    'self-assessable. The agent application cannot reach it — it posts ' +
    '/revenue/assessments from one place and never sends assessmentType — so a ' +
    'translation would be for a screen that cannot show it.',
  INVALID_REQUEST:
    'A validation message names a field and is generated from the schema, so there is ' +
    'nothing fixed to translate. This is the one code the agent map excludes on purpose.',
};

/** Every error code a function body raises, by name or as a named field. */
function codesRaisedIn(body: string): string[] {
  const codes = new Set<string>();
  for (const match of body.matchAll(/(?:conflict|refused)\(\s*'([A-Z][A-Z0-9_]*)'/g)) {
    codes.add(match[1]!);
  }
  for (const match of body.matchAll(/code:\s*'([A-Z][A-Z0-9_]*)'/g)) {
    // `code: 'STATE'` on an ErrorDetail is a field name, not a refusal.
    if (match[1] === 'STATE') continue;
    codes.add(match[1]!);
  }
  for (const match of body.matchAll(/throw (badRequest|notFound|forbidden)\(/g)) {
    codes.add(
      { badRequest: 'INVALID_REQUEST', notFound: 'NOT_FOUND', forbidden: 'FORBIDDEN' }[
        match[1] as 'badRequest' | 'notFound' | 'forbidden'
      ],
    );
  }
  return [...codes];
}

/** The bodies of the named top-level functions in a source file. */
function functionBodies(source: string, wanted: string[]): Map<string, string> {
  const lines = source.split('\n');
  const starts: { line: number; name: string }[] = [];
  lines.forEach((line, index) => {
    const match = /^export (?:async )?function (\w+)/.exec(line);
    if (match) starts.push({ line: index, name: match[1]! });
  });
  const bodies = new Map<string, string>();
  starts.forEach((start, index) => {
    if (!wanted.includes(start.name)) return;
    const end = starts[index + 1]?.line ?? lines.length;
    bodies.set(start.name, lines.slice(start.line, end).join('\n'));
  });
  return bodies;
}

/**
 * Every code the collect path raises, mapped to where it was found.
 *
 * Fails rather than returns on a function that has moved: a function this
 * cannot find is a function whose refusals quietly stop being checked, which is
 * the failure mode of every check that reads source.
 */
function codesOnTheCollectPath(root: string): Map<string, string> {
  const raised = new Map<string, string>();
  for (const [file, wanted] of Object.entries(COLLECT_PATH)) {
    const source = readFileSync(join(root, file), 'utf8');
    if (wanted === '*') {
      for (const code of codesRaisedIn(source)) raised.set(code, `${file} (whole file)`);
      continue;
    }
    const bodies = functionBodies(source, wanted);
    const missing = wanted.filter((name) => !bodies.has(name));
    assert.deepEqual(
      missing,
      [],
      `${file} no longer exports ${missing.join(', ')}. If the collect path moved, ` +
        'COLLECT_PATH has to move with it',
    );
    for (const [name, body] of bodies) {
      for (const code of codesRaisedIn(body)) raised.set(code, `${file} ${name}`);
    }
  }
  return raised;
}

describe('a refusal the collect screen can show', () => {
  it('can be read by the agent who is shown it', () => {
    const root = workspaceRoot();

    const agent = readFileSync(join(root, 'apps/agent/src/ui.tsx'), 'utf8');
    const mapStart = agent.indexOf('const TRANSLATED_ERRORS');
    assert.ok(mapStart > 0, 'TRANSLATED_ERRORS is no longer in apps/agent/src/ui.tsx');
    const map = agent.slice(mapStart, agent.indexOf('\n};', mapStart));
    const translated = new Set([...map.matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!));
    assert.ok(
      translated.size >= 25,
      `only ${translated.size} codes read out of the agent's map; the shape has changed ` +
        'and an empty set would make this test pass without checking anything',
    );

    const raised = codesOnTheCollectPath(root);

    assert.ok(
      raised.size >= 9,
      `only ${raised.size} codes found on the collect path; the extraction has stopped ` +
        'working, and a check that finds nothing passes without checking anything',
    );

    const unreadable = [...raised.entries()]
      .filter(([code]) => !translated.has(code) && !(code in UNTRANSLATED))
      .map(([code, where]) => `${code} (${where})`)
      .sort();

    assert.deepEqual(
      unreadable,
      [],
      'these refusals reach an agent from the screen they collect on and are not in ' +
        "the application's translation map, so a Hausa reader gets the server's " +
        'English. Translate each, or add it to UNTRANSLATED with the reason',
    );
  });

  /*
   * And the other direction, for the three that are declared.
   *
   * A reason left behind for a code that is no longer raised is an excuse for
   * nothing, and the next person to read it is misled about what the path does.
   */
  it('keeps no excuse for a code the path no longer raises', () => {
    const raised = codesOnTheCollectPath(workspaceRoot());
    assert.deepEqual(
      Object.keys(UNTRANSLATED).filter((code) => !raised.has(code)).sort(),
      [],
      'these are declared untranslated and are not raised on this path any more',
    );
  });
});
