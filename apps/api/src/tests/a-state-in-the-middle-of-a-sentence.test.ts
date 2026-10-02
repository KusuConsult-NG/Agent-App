/**
 * A translated sentence with an untranslated state dropped into it.
 *
 * `ENUM_LABELS` exists because both front ends used to render a database state
 * by taking the underscores out — English however the app was set, and not
 * always good English either. Every screen now reads states through
 * `enumLabel`, which is checked from the schema end by
 * `every-state-has-a-name.test.ts`: a value the database allows and the
 * dictionary does not know fails the build.
 *
 * That guard cannot see the other half of the problem. A screen can hold a
 * perfectly translated sentence with `{{status}}` in it and fill the hole with
 * the raw value, and every check passes: the key exists, the Hausa exists, the
 * state has a label — and the label is not the thing on the screen.
 *
 * Two places were doing it. `Groups.tsx` filled `grpNotActiveYet` with
 * `group.status.toLowerCase()`, so an agent read "Wannan kungiya tana
 * pending." — and that alert renders only when the group is PENDING or
 * SUSPENDED, both of which have had Hausa all along, so it was never once
 * right. The same file has a `readable` wrapper around `enumLabel`, three lines
 * from the top, used elsewhere on the screen. `Agents.tsx` filled
 * `ofcAgBankStillNotConfirmed` with `result.outcome.toLowerCase()`.
 *
 * Eleven of the thirteen substitutions were already correct, which is the
 * reason for a guard rather than a fix: the convention is established and the
 * exceptions are the accidents.
 *
 * WHY THIS READS SOURCE TEXT. The thing being checked is the shape of a call,
 * not a value at runtime — a test that rendered every screen in every state
 * would be a far larger thing that still could not say it had covered them
 * all. Source is the right evidence here.
 *
 * WHY IT SCANS RATHER THAN MATCHING A REGEXP, WHICH IT DID FIRST.
 *
 * The first version found the call with one expression and captured the second
 * argument with `[\s\S]{0,120}?` up to the next `)`. Then the fix for the
 * third offender added a comment inside the call explaining itself — and the
 * comment pushed the argument past 120 characters, so the expression stopped
 * matching that call at all. The guard went blind to the very line it had
 * found, in the commit that fixed it, and the count floor did not notice
 * because the total only fell from thirteen to twelve.
 *
 * So the call is found by its FIRST argument, which is a short string literal
 * and cannot grow, and the second argument is taken by scanning to the
 * balanced close. A call this cannot parse is reported rather than skipped:
 * the only two outcomes are "checked" and "complained about", never "quietly
 * not looked at".
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        // Tests write raw states on purpose, as the thing under assertion.
        if (entry === 'tests' || entry === 'node_modules') continue;
        walk(path);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
    }
  };
  for (const app of ['apps/agent/src', 'apps/portal/src']) walk(join(root, app));
  return found;
}

/**
 * The placeholders that hold a state rather than a datum.
 *
 * Named rather than inferred: `{{n}}`, `{{name}}` and `{{when}}` are a count, a
 * person and a time, and running those through a dictionary of states would be
 * the opposite mistake.
 */
const STATE_PLACEHOLDERS = [
  'status',
  'state',
  'role',
  'decision',
  'outcome',
  'kind',
  'severity',
  'method',
  'frequency',
  'rule',
];

/**
 * Substitutions that fill a state-shaped placeholder with something that is
 * not a state, with the reason each one is not.
 *
 * `type` is in the placeholder list because a document type and a taxpayer type
 * are states; a MIME type is not.
 */
const NOT_A_STATE: Record<string, string> = {
  'apps/portal/src/screens/KycDocuments.tsx:ofcKycFileType':
    "doc.content_type is a MIME type — image/jpeg — which is data the browser " +
    'reported, not a stage the platform moved the document through.',
};

/**
 * The source with its comments removed.
 *
 * Two reasons. A comment inside a call must not change whether the call is
 * read — that is what defeated the first version of this check. And this file's
 * own prose, and other files', mention `{{status}}` while explaining the rule,
 * which would otherwise be found and reported as code.
 *
 * String contents are preserved, because the placeholder being matched lives in
 * a string. A `//` inside a string literal is therefore not treated as a
 * comment, which is the one case a naive strip gets wrong.
 */
function withoutComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      // Keep a space so tokens either side do not run together.
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

interface ReplaceCall {
  /** The first argument's string contents, when it is a plain literal. */
  first: string;
  /** The second argument's source text, or null if it could not be read. */
  second: string | null;
  /** The nearest `t.someKey` before the call, for a legible failure. */
  key?: string;
}

/**
 * Every `.replace(` call in the source, with its first two arguments.
 *
 * The first argument is required to be a plain string literal, which is what
 * a placeholder always is; anything else is not a call this check is about and
 * is skipped before the placeholder test. The second is taken by counting
 * brackets, so its length and its contents do not matter.
 */
function replaceCalls(source: string): ReplaceCall[] {
  const calls: ReplaceCall[] = [];
  const opener = /\.replace\(/g;
  for (const found of source.matchAll(opener)) {
    let i = found.index! + found[0].length;
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
    const quote = source[i];
    if (quote !== "'" && quote !== '"') continue;
    i += 1;
    let first = '';
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') {
        first += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      first += source[i];
      i += 1;
    }
    if (source[i] !== quote) continue;
    i += 1;
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
    if (source[i] !== ',') {
      calls.push({ first, second: null });
      continue;
    }
    i += 1;

    // The second argument, to the bracket that closes the call.
    let depth = 0;
    let second = '';
    let innerQuote: string | null = null;
    let closed = false;
    for (; i < source.length; i += 1) {
      const ch = source[i]!;
      if (innerQuote) {
        second += ch;
        if (ch === '\\') {
          second += source[i + 1] ?? '';
          i += 1;
          continue;
        }
        if (ch === innerQuote) innerQuote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        innerQuote = ch;
        second += ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      if (ch === ')' && depth === 0) {
        closed = true;
        break;
      }
      if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      second += ch;
    }

    const preceding = source.slice(Math.max(0, found.index! - 240), found.index!);
    const keys = [...preceding.matchAll(/\bt\.([a-zA-Z][a-zA-Z0-9]*)/g)];
    calls.push({
      first,
      second: closed ? second : null,
      key: keys.length > 0 ? keys[keys.length - 1]![1] : undefined,
    });
  }
  return calls;
}

describe('a state in the middle of a sentence', () => {
  it('fills every state-shaped placeholder through the dictionary', () => {
    const root = workspaceRoot();
    const files = sourceFiles(root);
    assert.ok(files.length > 50, `only ${files.length} front-end source files found`);

    const offenders: string[] = [];
    let substitutions = 0;

    for (const file of files) {
      const relative = file.slice(root.length + 1);
      const source = withoutComments(readFileSync(file, 'utf8'));

      for (const call of replaceCalls(source)) {
        const placeholder = /^\{\{([a-zA-Z]+)\}\}$/.exec(call.first);
        if (!placeholder) continue;
        if (!STATE_PLACEHOLDERS.includes(placeholder[1]!)) continue;
        substitutions += 1;

        if (call.second === null) {
          offenders.push(
            `${relative}: {{${placeholder[1]}}} — the second argument could not be read, ` +
              'so this call was not checked. Fix the scanner rather than leaving it unread',
          );
          continue;
        }
        if (/\benumLabel\s*\(|\breadable\s*\(/.test(call.second)) continue;
        if (`${relative}:${call.key ?? ''}` in NOT_A_STATE) continue;
        offenders.push(
          `${relative}${call.key ? ` (${call.key})` : ''}: {{${placeholder[1]}}} <- ` +
            call.second.replace(/\s+/g, ' ').trim(),
        );
      }
    }

    /*
     * A floor, because a scanner that finds nothing would pass for ever. It is
     * deliberately close to the real figure: the first version of this check
     * used a loose floor of ten and went on passing when it silently stopped
     * seeing one of the thirteen.
     */
    assert.ok(
      substitutions >= 12,
      `only ${substitutions} state substitutions found, and there are at least 12. ` +
        'The scanner has stopped seeing some of them, which is the failure this ' +
        'check is least able to notice about itself',
    );

    assert.deepEqual(
      offenders,
      [],
      'these fill a translated sentence with a raw database state, so the sentence ' +
        'arrives in the reader\u2019s language with an English word inside it. Pass the ' +
        'value through enumLabel, or — if it is not a state — add it to NOT_A_STATE ' +
        'with the reason',
    );
  });
});
