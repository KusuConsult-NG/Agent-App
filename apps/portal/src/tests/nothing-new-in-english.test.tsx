/**
 * Nothing visible reaches a person in English without passing the dictionary.
 *
 * This began as a check on `Public.tsx` alone, on the reasoning that the
 * officer portal is government software and stays in English while the public
 * pages are a citizen's whole view of the platform. The officer portal has
 * since been translated too, so the check covers all of it — every screen, the
 * shell, and the shared primitives the screens are built out of.
 *
 * It is a lint rather than a proof: it reads source text and cannot tell you
 * what renders. What it holds is the boundary. The compiler holds the other
 * half — `Stat`, `Table`, `Alert` and `BarList` take `keyof
 * TranslationDictionary` rather than `string`, so a screen added with an
 * English label does not compile. Between them there is no quiet way for
 * English to arrive.
 *
 * The agent PWA carries the same check over its own screens, with the fuller
 * reasoning in `apps/agent/src/tests/nothing-new-in-english.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { translations } from '@psirs/shared';

const SOURCES: Record<string, string> = {
  ...(import.meta.glob('../screens/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../ui.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  /*
   * And `lib/`, which was outside this check until an untested screen led
   * back into it.
   *
   * The agent's copy of this file was extended to its own `lib/` earlier
   * today, after six English sentences were found being thrown from modules
   * and rendered in preference to the translation beside them. This one was
   * not, and `stepUp` — the guard on every consequential money decision an
   * officer makes — asked for its one-time code in an English `window.prompt`
   * and threw an English sentence when it did not get one.
   *
   * A screen cannot be trusted to be clean while the module it calls on its
   * most guarded path is not read at all.
   */
  ...(import.meta.glob(['../lib/*.ts', '!../lib/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
};

/**
 * A dictionary key is not English text.
 *
 * Half this portal passes labels as bare keys — `label="ofcFnVariance"` — so
 * without this the check would report the very thing it is asking for.
 */
const KEYS = new Set(Object.keys(translations.en));

/** Literals that are correct as they stand, each for a stated reason. */
const ALLOWED = new Set([
  // Shapes somebody copies off a piece of paper or types into a filter. A
  // translated example is an example that does not work.
  'PSIRS/2026/000123',
  'T7C72-QTUDN',
  '08012345678',
  'MARKET-LEVY',
  'payment.verified',
  'TIN',
  'PSIRS',
  'QR',
  'MDA',
  'KYC',
  'CSV',
  // Version numbers, amounts and sizes in sample data.
  '1.4.0',
  '15000.00',
  '5.00',
  '1250000.00',
  '500',
  '2',
  '#',
  'bytes',
]);

const RENDERED_PROPS =
  /\b(?:title|placeholder|aria-label|label|hint|empty|alt)="([^"]+)"/g;

/** The same props written as a JSX expression, which is equally valid. */
const BRACED_PROPS =
  /\b(?:title|placeholder|aria-label|label|hint|empty|patternHint|confirmLabel|alt)=\{'((?:[^'\\]|\\.)+)'\}/g;

/**
 * Object-literal fields that are rendered rather than used.
 *
 * `onSuccess` and `tooShort` were added after they were found holding fifteen
 * English messages between them — what an officer reads once a payout is
 * approved, a fraud flag is settled or an allocation is taken back, and why
 * the button refuses to move until they have said why. They are the fields
 * the step-up confirmation helper takes, so every screen that guards a money
 * decision passes its words through one of them.
 */
const RENDERED_FIELDS =
  /\b(?:label|hint|title|description|blurb|note|caption|help|onSuccess|tooShort)\s*:\s*'((?:[^'\\]|\\.){2,})'/g;

/**
 * Fragments of TypeScript the text-run pattern picks up by accident.
 *
 * Kept identical to the agent's copy, and narrow for the same reasons: an
 * earlier version treated any parenthesis as code, which would have let every
 * parenthesised label through, and treating a semicolon or equals sign as code
 * excluded prose containing one. What is matched is punctuation that appears
 * in expressions and not in writing.
 */
/*
 * A WORD IN CODE IS ALSO A WORD IN ENGLISH.
 *
 * This rule used to name the identifiers bare — `const`, `return`, `api` and
 * the rest — and a bare word matches prose. "…create a new account if they
 * return." contains `return`, so the whole paragraph above the button that
 * closes an officer's account was excused from the check and shipped in
 * English. Matching the shape instead — `const ` with its space, `useState(`
 * with its parenthesis, `Record<` with its angle bracket — keeps what the
 * rule was for and takes back what it never meant to cover.
 */
function looksLikeCode(text: string): boolean {
  return (
    /[{}[\]]|=>|\);|\(\{|\}\)|&&|\|\||\?\?/.test(text) ||
    text.startsWith(')') ||
    // A run that opens with a semicolon or a comma is the tail of a statement
    // the pattern walked into, never a sentence somebody wrote.
    /^[;,]/.test(text) ||
    /*
     * A bare pipe: the middle of a type union.
     *
     * `field: Record<string, unknown> | null; next: Record<…>` puts the union
     * tail between two angle brackets, which is exactly the shape the
     * between-tags pattern is looking for. Four of these appeared with the
     * transaction file and the case workspace, and none of them is a string an
     * officer will ever read.
     *
     * Matched as a standalone `|` rather than by naming `Record`, because the
     * next one will be a `string | null` or a `Date | undefined`. No sentence
     * in this application contains a pipe surrounded by spaces.
     */
    /(^|\s)\|(\s|$)/.test(text) ||
    text.endsWith('(') ||
    /^[a-z][A-Za-z0-9_]*$/.test(text) ||
    // `something.method(` — a call. No sentence contains one.
    /[A-Za-z_]\w*\.[A-Za-z_]\w*\(/.test(text) ||
    /\b(?:const|let|var)\s|\buseState\(|\buseRef\(|\bRecord<|\bPromise<|\bapi\.[a-z]/.test(text)
  );
}

/**
 * Text that is a direct child of a JSX element, in all four of its shapes.
 *
 * Kept identical to the agent's copy. The check began with one pattern — text
 * between `>` and `<` — which only sees a child that is wholly literal. As
 * soon as a value is interpolated the literal half is bounded by a brace:
 *
 *     <p>Showing the {rows.length} largest debts. Narrow by category…</p>
 *     <h2>Who is registered under {itemName}</h2>
 *
 * Both render English to an officer working in Hausa, and neither sits
 * between two angle brackets. Widening this found more than twenty strings in
 * the portal, most of them on screens added after the translation sweep.
 */
const BETWEEN_TAGS = /(?<![=!<>-])>([^<>{}]+)</g;
const BESIDE_AN_EXPRESSION = [
  /}([^<>{}]+)</g,
  /(?<![=!<>-])>([^<>{}]+)\{/g,
  /}([^<>{}]+)\{/g,
];

/**
 * Code the three brace-adjacent patterns pick up that the original cannot.
 *
 * Two JSX attributes in a row put ` className=` between `}` and `{`, and a
 * closing brace at the top of a file puts an `import` line before the next
 * `<`. Both carry punctuation that writing does not.
 *
 * The semicolon is why this is separate from `looksLikeCode` rather than part
 * of it: prose does contain semicolons, and the pattern between two angle
 * brackets has found such a sentence before. Applied only to the
 * brace-adjacent runs it costs nothing — a clause long enough to need a
 * semicolon is not a fragment beside an interpolation.
 */
function isSurroundingCode(text: string): boolean {
  return (
    /[;=]/.test(text) ||
    /^[:.]/.test(text) ||
    // The opening of an argument list: `(path, ` between a generic's `>` and
    // the object literal that follows it.
    /^\(\w+,/.test(text) ||
    /\.[A-Za-z_]\w*\(/.test(text) ||
    /\b(?:import|export|interface|type|function|catch|async|await|if|else|typeof|new|extends|null|undefined|void)\b/.test(
      text,
    )
  );
}

/**
 * The source with the inside of every string and template literal blanked.
 *
 * `${…}` inside a template literal puts a `}` next to ordinary prose, which
 * the patterns above would otherwise read as JSX text. Blanking the contents
 * and keeping the length leaves positions and surrounding punctuation intact,
 * and the strings that genuinely are shown to an officer are picked up by the
 * prop and field patterns, which read the original source.
 */
function withoutLiterals(code: string): string {
  const blank = (match: string) => ' '.repeat(match.length);
  return code
    .replace(/`(?:[^`\\]|\\.)*`/g, blank)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blank);
}

function englishIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  const jsx = withoutLiterals(code);
  for (const match of jsx.matchAll(BETWEEN_TAGS)) {
    found.push(match[1].replace(/\s+/g, ' ').trim());
  }
  for (const pattern of BESIDE_AN_EXPRESSION) {
    for (const match of jsx.matchAll(pattern)) {
      const text = match[1].replace(/\s+/g, ' ').trim();
      if (!isSurroundingCode(text)) found.push(text);
    }
  }
  for (const match of code.matchAll(RENDERED_PROPS)) found.push(match[1].trim());
  for (const match of code.matchAll(BRACED_PROPS)) found.push(match[1].trim());
  for (const match of code.matchAll(RENDERED_FIELDS)) found.push(match[1].trim());
  return found.filter(
    (text) =>
      /[A-Za-z]{2}/.test(text) && !KEYS.has(text) && !ALLOWED.has(text) && !looksLikeCode(text),
  );
}

describe('the portal stays translated', () => {
  it('has the screens to check', () => {
    // A glob that stopped matching would make the assertion below pass by
    // having nothing to look at.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(18);
  });

  it('routes every visible string through the dictionary', () => {
    /*
     * If this fails, the fix is almost never to add the string to ALLOWED.
     * It is to add a key to `packages/shared/src/i18n.ts` in both languages —
     * which is also what puts the string in front of the reviewer who checks
     * the Hausa.
     */
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      // The rules above read JSX — props, children, rendered object fields.
      // A `.ts` module has none, and pointing them at one makes them read
      // type annotations as prose: `( path: string, options:` is a signature.
      // The literal rules below cover those files, and cover them better.
      if (!path.endsWith('.tsx')) continue;
      for (const text of englishIn(source)) offenders.push(`${path}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The blind spot the check above has, now closed.
 *
 * `withoutLiterals` blanks the inside of every string before looking for JSX
 * text. That is right for the `${…}` in a template literal, and it means a
 * string literal rendered as an *expression child* is never examined:
 *
 *     {busy ? 'Searching…' : 'Check status'}
 *     [ 'Amount', <Money kobo={row.amountKobo} /> ]
 *     const FLOW_LABEL = { collection: 'Taking a collection' }
 *
 * None of those is a prop, a JSX child, or an object field the pattern above
 * names, and all three reach an officer in English. Two hundred and thirty-
 * seven of them were found across this portal and the agent app — and
 * fifty-three already had Hausa in the dictionary, and in the review sheet,
 * while the screen went on showing English. That is the worst shape this
 * failure takes, because the sheet says the work is done.
 *
 * So the rule here is blunt where the one above is careful: a capitalised
 * literal anywhere in a screen is a dictionary key, an example somebody
 * copies, or a bug. It is cheap to satisfy — the fix is always a key — and it
 * sees everything the other one cannot.
 */
const ALL_SOURCES = SOURCES;

/**
 * Declaration syntax, which a file of components never showed this check.
 *
 * Every rule above was tuned against `.tsx`, where the text between two angle
 * brackets is nearly always JSX. In a `.ts` module the angle brackets are
 * generics and the runs between them are signatures — `public getState():
 * PrinterDeviceState`, `(path: string, file: Blob): Promise`. They are not
 * prose and never were; the check had simply never been pointed at a file
 * that contains them.
 *
 * Matched on shape rather than on a list of names, for the reason the comment
 * above gives: a bare word matches prose, and `class` or `return` in a
 * sentence would excuse the sentence.
 */
function looksLikeTypeScript(text: string): boolean {
  return (
    /\b(?:public|private|protected|readonly|class|function|return|implements|extends)\s/.test(text) ||
    // A return type or a typed parameter: `): Promise`, `(path: string`.
    /\)\s*:\s*[A-Z]/.test(text) ||
    /\(\s*\w+\s*:\s*[A-Z]/.test(text) ||
    // `(path), post:` — an object literal of methods, caught mid-key.
    /^\(\w+\)/.test(text) ||
    /\|\s*null\b/.test(text)
  );
}

/**
 * A class, an error name, or a DOM interface — never a sentence.
 *
 * `AbortError`, `PushManager`, `CameraUnavailable`, `NotAllowedError`: names
 * compared against `error.name` or used to test for a browser feature. Matched
 * on shape — one word, no spaces, with a capital inside it — because that
 * shape is not one anybody writes on a screen, and a list of names would go
 * stale the first time somebody added an error class.
 */
function isIdentifier(text: string): boolean {
  return /^[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(text);
}

/**
 * Literals that are right as they stand, each for a stated reason.
 *
 * Kept deliberately short. If this list is growing, the check is being argued
 * with rather than answered, and the answer is nearly always a dictionary key.
 */
const ALLOWED_LITERALS = new Set([
  // Shapes somebody copies off a piece of paper. A translated example is an
  // example that does not work.
  'PSIRS/2026/000123',
  // A place, not a phrase. It is the name of the State in both languages.
  'Plateau State',
  // A keyboard event code, not a word. It was briefly turned into a key
  // during the sweep that added this rule, which would have compared a key
  // press against the Hausa word for it and stopped Enter working.
  'Enter',
  'Escape',
  /*
   * A reason written into the audit trail, not shown to the officer writing it.
   *
   * It is stored and read back later by somebody else — an auditor, possibly
   * reading in the other language — so translating it would record whichever
   * language the officer's browser happened to be in, and two identical actions
   * would be filed under two different words. Same reasoning as
   * `ofcOvActionPlaceholder` above.
   *
   * The better answer is a stable code the reading screen translates, the way
   * statuses work. That is a change to how sessions are ended rather than to
   * this list, and it is noted rather than done here.
   */
  'Ended by the officer',
  // Wire values and identifiers that happen to be capitalised.
  'Bearer ',
  // The same value as a template chunk, which arrives trimmed.
  'Bearer',
  'Content-Type',
]);

function capitalisedLiteralsIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  for (const match of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    const text = (match[1] ?? match[2] ?? '').trim();
    /*
     * A capitalised word followed by a lowercase one is how prose starts, and
     * is not how an enum value, a route or a CSS length is written — except
     * when the first word is a single letter. `A rate cannot be negative.`
     * fails that test on its second character, and three real refusals were
     * sitting behind it: two in `Configuration`, one in `Allocations`, each
     * telling an officer why the platform will not accept what they typed.
     * So a capital followed by a second word counts too.
     */
    if (!/^[A-Z][a-z]/.test(text) && !(/^[A-Z]/.test(text) && wordsIn(text) >= 2)) continue;
    if (KEYS.has(text) || ALLOWED_LITERALS.has(text)) continue;
    // `ApiRequestError` is a class and `Promise<Response>` a signature.
    // Neither is prose, and both open with a capital and a lower-case letter.
    if (isIdentifier(text) || looksLikeTypeScript(text)) continue;
    found.push(text);
  }
  return found;
}

/**
 * Words, for the purpose of telling prose from a class name.
 *
 * Counted as runs of two or more letters, so `flag(s)` and `10` do not pad a
 * fragment up to the threshold and a `card card--tight` never reaches it.
 */
function wordsIn(text: string): number {
  return text.split(/\s+/).filter((word) => /[A-Za-z]{2}/.test(word)).length;
}

/**
 * The static runs of a template literal, split on its interpolations.
 *
 * `split(/\$\{[^}]*\}/)` is the obvious way and is wrong on exactly the code
 * this project writes. `[^}]*` stops at the first `}`, so
 *
 *     `${t.ofcUaNowRole.replace('{{name}}', officer.fullName)} `
 *
 * is cut at the `}` inside `{{name}}`, and everything after it — a chain of
 * method calls — is handed to the prose test as though it were a sentence.
 * `{{name}}` is this dictionary's own interpolation convention, so the rule
 * reported a violation on every correctly composed message while finding
 * none of the literals it exists for.
 *
 * Depth-counted instead, which is what a `${...}` containing braces needs.
 */
function staticChunks(literal: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (let index = 0; index < literal.length; index += 1) {
    if (literal[index] === '$' && literal[index + 1] === '{') {
      chunks.push(current);
      current = '';
      let depth = 1;
      index += 2;
      while (index < literal.length && depth > 0) {
        if (literal[index] === '{') depth += 1;
        else if (literal[index] === '}') depth -= 1;
        index += 1;
      }
      index -= 1;
      continue;
    }
    current += literal[index];
  }
  chunks.push(current);
  return chunks;
}

/**
 * The static text inside a template literal.
 *
 * The blind spot both of these files shared. Every rule above reads `'...'`
 * and `"..."`; none of them read a backtick, and `withoutLiterals` blanks
 * template literals before the JSX scan so they were invisible twice over.
 * A backtick is exactly what somebody reaches for the moment a message has a
 * value in it — which is most messages worth reading:
 *
 *     setMessage(`Reversal executed as ${result.refundReference}.`)
 *
 * Nineteen of those were reaching officers in the portal and three in the
 * agent app, past a check that had been green the whole time.
 *
 * The interpolations are the split points, so each static run is tested on its
 * own: `${API}/auth/login` yields no capitalised run, and a real sentence does.
 */
function templateTextIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  for (const literal of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const chunks = staticChunks(literal[1]);
    /*
     * A template that opens in lower case is a developer's line, whole.
     *
     * The same convention the thrown-message rule uses, applied to the
     * literal rather than to each piece of it — because the pieces after an
     * interpolation are mid-sentence and carry no capital to judge them by.
     * `request failed with status ${status}` is exempt; so is a class name
     * like `alert alert--${kind}`. A literal that opens with its value, and
     * so has an empty first chunk, is not exempt: that is exactly the shape
     * this rule exists to catch.
     */
    if (/^[a-z]/.test(chunks[0])) continue;
    for (const chunk of chunks) {
      const text = chunk.trim();
      if (!/[A-Za-z]{2}/.test(text)) continue;
      if (KEYS.has(text) || ALLOWED_LITERALS.has(text)) continue;
      // A capital opens a sentence; three words in a row continue one. The
      // second half is not a refinement — it is most of the rule. A message
      // that begins with its value, `${name}'s account has been changed.`,
      // hands its opening capital to the interpolation and leaves a chunk
      // starting with an apostrophe, so the capital test alone reads the
      // remainder of a sentence as though it were a class name.
      if (!/^[A-Z][a-z]/.test(text) && wordsIn(text) < 3) continue;
      if (isIdentifier(text) || looksLikeTypeScript(text)) continue;
      found.push(text);
    }
  }
  return found;
}

describe('no screen has English of its own', () => {
  it('routes even its expression literals through the dictionary', () => {
    /*
     * If this fails, the fix is a key in `packages/shared/src/i18n.ts` in both
     * languages — which is also what puts the string in front of the reviewer
     * who checks the Hausa. Adding it to ALLOWED_LITERALS is almost never it.
     */
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(ALL_SOURCES)) {
      for (const text of capitalisedLiteralsIn(source)) offenders.push(`${path}: ${text}`);
      for (const text of templateTextIn(source)) offenders.push(`${path}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * And the language that hides in a helper rather than in a screen.
 *
 * `toLocaleDateString('en-NG')` is not a capitalised literal and no rule above
 * can see it, but it renders an English month on a Hausa screen just as surely
 * as an English button would. It was written out eighty times across the two
 * applications before anybody looked.
 *
 * A bare `toLocaleDateString()` is worse still. With no locale at all the order
 * of the day and the month is whatever the browser prefers, so one receipt
 * reads 9/8 in Jos and 8/9 in a browser set to American English — the same
 * date, two meanings, and no way for the reader to tell which they have. There
 * was one, on the citizen statement.
 *
 * The fix is `formatDate` / `formatDateIn`, which take the month from the
 * dictionary. A screen that needs a format those do not offer should widen
 * them rather than reach past them, because the next person to reach past will
 * pin a locale again.
 */
describe('no screen picks its own locale', () => {
  it('formats every date through the dictionary', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(ALL_SOURCES)) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const match of code.matchAll(
        /toLocale(?:Date|Time)String\(|toLocaleString\(\s*['"][^'"]+['"]/g,
      )) {
        offenders.push(`${path}: ${match[0].slice(0, 40)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
