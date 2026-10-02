/**
 * Every refusal a screen of the agent application can show, against what the
 * agent holding the phone can read.
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
 * So this reads the whole path a screen drives, and it reads it from source
 * rather than from a list, because a list of codes in a test file is a copy
 * and a copy goes stale the first time somebody adds a refusal without opening
 * this file — which is precisely the case worth catching, since the new
 * refusal is the one nobody remembered to translate.
 *
 * WHY IT IS A TABLE OF SCREENS AND NOT ONE SCREEN
 *
 * It started as the collect screen alone, and the collect screen is not the
 * first thing an agent uses. Registering a taxpayer is: nothing can be
 * assessed, collected or receipted against somebody who is not on the
 * register, so it is the one screen every other one is behind — and all four
 * of its refusals were in English, two of them with their next step already
 * translated and sitting underneath. One check over a table of screens finds
 * that; a check named after one screen does not, however carefully it reads
 * that screen.
 *
 * THE GENERIC CODES ARE DECLARED, NOT IGNORED
 *
 * `NOT_FOUND`, `FORBIDDEN` and `INVALID_REQUEST` are raised on these paths and
 * are not translated, each for a reason written down beside it below. A reader
 * can disagree with any of them; what they cannot do is miss that a decision
 * was made. The reasons are per screen because they are about what that screen
 * can reach — the same code is unreachable on one path and untranslatable on
 * another, and one shared excuse would hide both.
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

interface Screen {
  /** What the screen asks of the API, so the table below can be checked. */
  requests: string;
  /**
   * The code those requests run: function names, or `'*'` for a file whose
   * every refusal is on this path.
   *
   * Both are needed, and the difference is the subtle part.
   *
   * Naming functions is right for `revenue.ts` and `payments.ts`, which also
   * hold officer-only work: `setRevenueItemStatus` refuses things no agent can
   * ask for, and `handleWebhook` refuses a gateway rather than a person. It is
   * right for `taxpayers.ts` for the same reason — `setTaxpayerStatus` and
   * `changeTaxpayerIdentity` are an officer's. A slice runs from one `export
   * function` to the next, so a private helper sitting between two exported
   * functions is inside the earlier one's slice and is read.
   *
   * `rate-engine.ts` has to be the whole file, and discovering why is what
   * this test was for. Its twelve refusals live in helpers ABOVE its only
   * exported function, so they are before the first slice begins and would be
   * in none of them — the same one-level-down miss that this check exists to
   * catch, in the check itself. The file computes an amount for a quote or an
   * assessment and does nothing else, so every refusal in it reaches an agent.
   */
  code: Record<string, string[] | '*'>;
  /** Codes on this path kept in the server's English, each with its reason. */
  untranslated: Record<string, string>;
  /**
   * The fewest codes the extraction must find here.
   *
   * A check that finds nothing passes without checking anything, and the way
   * this one would come to find nothing is a rename that empties a slice.
   */
  atLeast: number;
}

const SCREENS: Record<string, Screen> = {
  /*
   * `Collect.tsx` posts to `/revenue/quote`, `/revenue/assessments` and
   * `/payments/initiate`, and polls `/payments/transactions/:id/status`.
   */
  collect: {
    requests: 'POST /revenue/quote, /revenue/assessments, /payments/initiate; GET /payments/transactions/:id/status',
    code: {
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
    },
    untranslated: {
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
    },
    atLeast: 9,
  },

  /*
   * `Taxpayers.tsx` is search, profile and registration in one file, reached
   * from the register tab and from the collect screen's "register a new one".
   * It posts `/taxpayers` and `/taxpayers/duplicate-check` and gets
   * `/taxpayers/search` and `/taxpayers/:id`.
   *
   * `POST /taxpayers/:id/tin` is NOT on it. That route exists and raises its
   * own NOT_FOUND, and no client calls it — neither application posts to it —
   * so including it would add a declared excuse for a refusal no screen can
   * show, which is the thing the second test below refuses to keep.
   */
  'taxpayer register': {
    requests: 'POST /taxpayers, /taxpayers/duplicate-check; GET /taxpayers/search, /taxpayers/:id',
    code: {
      'apps/api/src/services/taxpayers.ts': [
        'findPotentialDuplicates',
        'registerTaxpayer',
        'searchTaxpayers',
        'getTaxpayerProfile',
      ],
    },
    untranslated: {
      NOT_FOUND:
        'The same objection as on the collect path, raised by getTaxpayerProfile: the ' +
        'sentence names its subject and notFound() composes it everywhere in the platform.',
      /*
       * Not the collect path's reason. This one is a fixed sentence and could
       * be translated — it is unreachable instead, and that is a different
       * claim, which is why these reasons are per screen.
       */
      INVALID_REQUEST:
        'Raised once here, with a fixed sentence: consent and the declaration were not ' +
        'given. The screen will not submit without both — step 5 blocks Continue and says ' +
        'needConsent or needDeclaration, in Hausa — and a queued draft is only written by a ' +
        'submit that passed the same gate. So a translation would be for a refusal the ' +
        'application refuses first, in the agent’s own language.',
    },
    atLeast: 6,
  },
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
 * Every code one screen's path raises, mapped to where it was found.
 *
 * Fails rather than returns on a function that has moved: a function this
 * cannot find is a function whose refusals quietly stop being checked, which is
 * the failure mode of every check that reads source.
 */
function codesOnThePath(root: string, screen: Screen): Map<string, string> {
  const raised = new Map<string, string>();
  for (const [file, wanted] of Object.entries(screen.code)) {
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
      `${file} no longer exports ${missing.join(', ')}. If the path moved, ` +
        'SCREENS has to move with it',
    );
    for (const [name, body] of bodies) {
      for (const code of codesRaisedIn(body)) raised.set(code, `${file} ${name}`);
    }
  }
  return raised;
}

/** The codes the agent application can say in the reader's language. */
function translatedByTheAgent(root: string): Set<string> {
  const agent = readFileSync(join(root, 'apps/agent/src/ui.tsx'), 'utf8');
  const mapStart = agent.indexOf('TRANSLATED_ERRORS: Record');
  assert.ok(mapStart > 0, 'TRANSLATED_ERRORS is no longer in apps/agent/src/ui.tsx');
  const map = agent.slice(mapStart, agent.indexOf('\n};', mapStart));
  const translated = new Set([...map.matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!));
  assert.ok(
    translated.size >= 30,
    `only ${translated.size} codes read out of the agent's map; the shape has changed ` +
      'and an empty set would make this test pass without checking anything',
  );
  return translated;
}

describe('a refusal a screen can show', () => {
  for (const [name, screen] of Object.entries(SCREENS)) {
    it(`can be read by the agent who is shown it: ${name}`, () => {
      const root = workspaceRoot();
      const translated = translatedByTheAgent(root);
      const raised = codesOnThePath(root, screen);

      assert.ok(
        raised.size >= screen.atLeast,
        `only ${raised.size} codes found on the ${name} path, expected at least ` +
          `${screen.atLeast}; the extraction has stopped working, and a check that finds ` +
          'nothing passes without checking anything',
      );

      const unreadable = [...raised.entries()]
        .filter(([code]) => !translated.has(code) && !(code in screen.untranslated))
        .map(([code, where]) => `${code} (${where})`)
        .sort();

      assert.deepEqual(
        unreadable,
        [],
        `these refusals reach an agent from the ${name} screen and are not in the ` +
          "application's translation map, so a Hausa reader gets the server's English. " +
          'Translate each, or add it to this screen’s `untranslated` with the reason',
      );
    });
  }

  /*
   * And the other direction, for the codes that are declared.
   *
   * A reason left behind for a code that is no longer raised is an excuse for
   * nothing, and the next person to read it is misled about what the path does.
   */
  it('keeps no excuse for a code a path no longer raises', () => {
    const root = workspaceRoot();
    const stale: string[] = [];
    for (const [name, screen] of Object.entries(SCREENS)) {
      const raised = codesOnThePath(root, screen);
      for (const code of Object.keys(screen.untranslated)) {
        if (!raised.has(code)) stale.push(`${code} (${name})`);
      }
    }
    assert.deepEqual(
      stale.sort(),
      [],
      'these are declared untranslated and are not raised on that path any more',
    );
  });
});
