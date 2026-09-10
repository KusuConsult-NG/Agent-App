/**
 * The half of the Hausa work that has to survive next month.
 *
 * Translating twelve screens is a day's work. Keeping them translated is the
 * hard part, because the failure is silent: somebody adds a button, ships it,
 * and an agent with the app set to Hausa meets one English word in the middle
 * of a Hausa sentence. Nothing breaks, no test fails, and the person who
 * notices is standing in a market holding somebody's money.
 *
 * So this reads the source of every translated surface and fails on a visible
 * English literal that has not gone through the dictionary. It is a lint
 * rather than a proof — it looks at text, not at what renders — and it is
 * deliberately blunt: the cost of a false positive is one line added to
 * ALLOWED below, with a reason, which is the conversation worth having.
 *
 * It earned its keep on the way in. The sweep that translated those twelve
 * screens was done by hand and by eye, and this found twelve strings it had
 * missed — five `hint=` props on the group form, both of the step-up prompt's
 * failure messages, and the sentence an agent sees when their offline
 * captures cannot be sent.
 *
 * What it deliberately does not do is check the *quality* of a translation.
 * `hausa-dictionary-consistency.test.tsx` holds the vocabulary; a native
 * speaker holds the meaning. This only holds the boundary: nothing visible
 * reaches an agent without passing through the dictionary first.
 */

import { describe, it, expect } from 'vitest';
import { translations } from '@psirs/shared';

/**
 * Every file whose output an agent reads, as source text.
 *
 * Read through Vite rather than `node:fs` so the test needs no filesystem
 * types and no assumption about the working directory — the same mechanism
 * the tab-label check already uses.
 */
const SURFACES: Record<string, string> = {
  ...(import.meta.glob('../screens/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../components/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../ui.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  /*
   * `lib/` is here because that is where the last one hid.
   *
   * The camera-failure messages were English sentences in `scanner.ts`, thrown
   * as an Error and rendered by two screens in preference to the translated
   * string sitting beside them. Every rule below would have caught them in a
   * screen. None of them looked at `lib/`, so a module with no JSX in it
   * became the one place an English sentence could reach an agent unopposed.
   *
   * Test files are excluded, and only test files: their fixtures are English
   * on purpose — a taxpayer called Danladi Musa, a server that answered
   * "Server problem" — and nobody reads them but us.
   */
  ...(import.meta.glob(['../lib/*.ts', '!../lib/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
};

/**
 * Strings that are correct as literals, each for a stated reason.
 *
 * Anything added here is a decision somebody can read and disagree with,
 * which is the point. "It was easier" is not one of the reasons below.
 */
/**
 * A dictionary key is not English text.
 *
 * The module-level arrays here hold keys rather than labels — the clearance
 * stages, the wizard steps, the support categories — so without this the check
 * would report the very thing it is asking for.
 */
const KEYS = new Set(Object.keys(translations.en));

const ALLOWED = new Set([
  // Sample values an agent types or dials. A translated phone number or
  // registration plate is a number somebody will actually use.
  '08012345678',
  'JOS123AB',
  'ABCDE-12345',
  'T7C72-QTUDN',
  '+234…',
  '0.00',
  // Printer paper sizes, which are the manufacturer's own designation.
  '58mm',
  '80mm',
  // Acronyms and marks that are the same word in both languages.
  'TIN',
  'PSIRS',
  'NIN',
  'BVN',
  'QR',
  'Bluetooth',
  // The identity documents are known by their acronyms in both languages, and
  // the words in front of them come from the dictionary.
  '(NIN)',
  '(BVN)',
  /*
   * A developer's line, and provably not a sentence anybody reads.
   *
   * `ApiError.message` is required, so the fallback error the upload path
   * builds has to carry one. Nothing renders it: `UPLOAD_FAILED` is in
   * `TRANSLATED_ERRORS`, and `ErrorAlert` prefers the dictionary whenever the
   * code is in that map. Written in lower case so it cannot be mistaken for
   * copy if the guarantee above ever changes.
   */
  'upload failed',
]);

/**
 * Nothing is owed here any more.
 *
 * This list held the twelve strings in `lib/bluetooth-printer.ts` — the
 * messages an agent reads while connecting a printer, and the lines the test
 * slip puts on paper. They were listed rather than fixed because `escpos.ts`
 * replaced every byte above ASCII with a question mark, so translating them
 * would have printed `na?ura`. The encoder folds now, the receipt and the slip
 * both read from the dictionary, and the list is empty.
 *
 * It is kept, empty, rather than deleted. A named place to record a string
 * that genuinely cannot go through the dictionary yet is worth having, and an
 * empty one says the honest thing: nothing currently qualifies. Anything added
 * to it needs the reason written next to it, and the reason has to be better
 * than "not yet".
 */
const NOT_YET_THROUGH_THE_DICTIONARY = new Set<string>([]);

/** Props whose value is rendered rather than used. */
const RENDERED_PROPS =
  /\b(?:title|placeholder|aria-label|label|hint|patternHint|confirmLabel|alt)="([^"]+)"/g;

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

/** Messages the agent is shown when something goes wrong or completes. */
const SHOWN_MESSAGES =
  /\b(?:message|setNotice|setError|setPrinterMsg|setPushMsg|setCameraError|setFailure)\s*[:(]\s*'([^']{6,})'/g;

/**
 * A sentence handed to an Error, which is a sentence somebody reads.
 *
 * This is the shape the camera bug had — `throw new CameraUnavailable('DENIED',
 * 'PSIRS does not have permission…')` — and no rule above described it, because
 * every one of them was written against a file of components, where errors are
 * caught rather than thrown. Screens render `caught.message`, so a literal
 * inside a `throw` is as visible as one inside a `<p>`.
 */
const THROWN_MESSAGES = /new\s+[A-Z]\w*\(\s*(?:'[A-Z_]+',\s*)?'([^']{6,})'/g;

/**
 * A discriminant is not a sentence, and neither is a developer's line.
 *
 * Two shapes are excluded, and the second is a convention this file enforces
 * rather than merely tolerates:
 *
 *   throw new CameraUnavailable('DENIED')          a reason code
 *   super('camera unavailable: DENIED')            a line for a stack trace
 *
 * The first has no space. The second opens in lower case, and **that is what
 * makes it a developer's line**: every sentence an agent reads in this
 * application starts with a capital, because it is a sentence. So a lower-case
 * opening is a deliberate mark meaning "nobody renders this", and the reviewer
 * of a diff can tell the two apart without reading the surrounding code.
 *
 * Getting it wrong in the safe direction costs nothing — a user-facing string
 * written in lower case is caught by `capitalisedLiteralsIn` the moment
 * somebody capitalises it, which is the first thing anybody would do.
 */
const isProse = (text: string) => /\s/.test(text) && /^[A-Z]/.test(text);

/**
 * Fragments of TypeScript the text-run pattern picks up by accident.
 *
 * `>` and `<` are comparison and generics as well as tags, so a run like
 * `= 0 && (index` sits between two of them. Filtering on syntax rather than
 * on a list of specific strings keeps the check from going quiet as the code
 * around it changes.
 *
 * The rules are deliberately narrow, and have been narrowed twice. Treating
 * any parenthesis as code would have excluded `Occupation (optional)` and
 * every other parenthesised label; treating any semicolon or equals sign as
 * code excluded prose that contains one — which is how a sentence ending
 * "...the revenue summary; this screen is the platform itself" sat unchecked.
 * What is matched now is punctuation that appears in expressions and not in
 * writing: braces, brackets, arrows, and the boolean operators. The one
 * prose-shaped leftover, the seam between two JSX branches, starts with a
 * close parenthesis or ends with an open one, which no visible string does.
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
    text.endsWith('(') ||
    /^[a-z][A-Za-z0-9_]*$/.test(text) ||
    // `something.method(` — a call. No sentence contains one.
    /[A-Za-z_]\w*\.[A-Za-z_]\w*\(/.test(text) ||
    /\b(?:const|let|var)\s|\buseState\(|\buseRef\(|\bRecord<|\bPromise<|\bapi\.[a-z]/.test(text) ||
    looksLikeTypeScript(text)
  );
}

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
 * Text that is a direct child of a JSX element, in all four of its shapes.
 *
 * The check began with one pattern — text between `>` and `<` — and that is
 * only the case where the whole child is literal. As soon as a value is
 * interpolated the literal half is bounded by a brace on one side:
 *
 *     <p>Expires in {minutes}:{seconds}</p>
 *     <button>{busy ? <Spinner /> : null} Search</button>
 *
 * Both of those render English to an agent whose app is set to Hausa, and
 * neither sits between two angle brackets, so the original pattern could not
 * see them however carefully it was tuned. It missed twelve strings in the
 * agent app and more in the portal, including whole sentences — the group
 * screen's explanation of why members cannot be recorded yet, and the
 * sentence above the button that changes where an agent's commission is paid.
 */
const BETWEEN_TAGS = /(?<![=!<>-])>([^<>{}]+)</g;
const BESIDE_AN_EXPRESSION = [
  /}([^<>{}]+)</g,
  /(?<![=!<>-])>([^<>{}]+)\{/g,
  /}([^<>{}]+)\{/g,
];

/**
 * Code the three patterns above pick up that the original one cannot.
 *
 * Text between two angle brackets is nearly always JSX. Text beside a brace
 * is not: two JSX attributes in a row put ` className=` between `}` and `{`,
 * and a closing brace at the top of a file puts an `import` line before the
 * next `<`. Both are noise, and both carry punctuation that writing does not.
 *
 * The semicolon is the reason this is a separate rule rather than an addition
 * to `looksLikeCode`. Prose does contain semicolons — a sentence ending
 * "...the revenue summary; this screen is the platform itself" was found by
 * the original pattern and would be lost if that pattern started excluding
 * them. Applied only to the brace-adjacent runs, it costs nothing: a sentence
 * long enough to need a semicolon is not a fragment beside an interpolation.
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
 * the patterns above would read as JSX text — so a URL built from a taxpayer
 * id would be reported as an untranslated sentence. Blanking the contents and
 * keeping the length means positions and the surrounding punctuation are
 * unchanged, and the strings that genuinely are shown to an agent are picked
 * up by the prop, field and message patterns, which read the original source.
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
    // Two or more consecutive letters is the cheapest test for "a word rather
    // than punctuation, an entity, or a fragment of an expression".
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]{2}/.test(text)) found.push(text);
  }
  for (const pattern of BESIDE_AN_EXPRESSION) {
    for (const match of jsx.matchAll(pattern)) {
      const text = match[1].replace(/\s+/g, ' ').trim();
      if (/[A-Za-z]{2}/.test(text) && !isSurroundingCode(text)) found.push(text);
    }
  }
  for (const match of code.matchAll(RENDERED_PROPS)) found.push(match[1].trim());
  for (const match of code.matchAll(BRACED_PROPS)) found.push(match[1].trim());
  for (const match of code.matchAll(RENDERED_FIELDS)) found.push(match[1].trim());
  for (const match of code.matchAll(SHOWN_MESSAGES)) found.push(match[1].trim());
  for (const match of code.matchAll(THROWN_MESSAGES)) {
    const text = match[1].trim();
    if (isProse(text)) found.push(text);
  }

  return found.filter(
    (text) =>
      /[A-Za-z]{2}/.test(text) &&
      !KEYS.has(text) &&
      !ALLOWED.has(text) &&
      !NOT_YET_THROUGH_THE_DICTIONARY.has(text) &&
      !looksLikeCode(text),
  );
}

describe('nothing new arrives in English', () => {
  it('has surfaces to check at all', () => {
    // Without this, a glob that stopped matching would make every assertion
    // below pass by having nothing to say.
    expect(Object.keys(SURFACES).length).toBeGreaterThan(12);
  });

  it('routes every visible string through the dictionary', () => {
    /*
     * If this fails, the fix is almost never to add the string to ALLOWED.
     * It is to add a key to `packages/shared/src/i18n.ts` in both languages
     * and render `{t.theKey}` — which is also what puts the string in front
     * of the reviewer who checks the Hausa.
     */
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SURFACES)) {
      for (const text of englishIn(source)) offenders.push(`${path}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The blind spot the check above shares with the portal's copy, now closed.
 *
 * `withoutLiterals` blanks the inside of every string before looking for JSX
 * text — right for a template literal's `${…}`, and it means a literal
 * rendered as an *expression child* is never examined:
 *
 *     {shown ? 'Hide' : 'Show'}
 *     const UNITS = [['LITRE', 'Litre']]
 *
 * Both reach an agent in English, and neither is a prop, a JSX child, or an
 * object field the pattern above names. So this rule is blunt where that one
 * is careful: a capitalised literal in a translated surface is a dictionary
 * key, an example somebody copies, or a bug. It is cheap to satisfy — the fix
 * is always a key.
 *
 * The `Enter` in the allow-list is the keyboard event code, not a word. It was
 * briefly turned into a dictionary key during the sweep that added this rule,
 * which would have compared a key press against the Hausa word for it and
 * stopped the Enter key working for anybody reading Hausa.
 */
const ALLOWED_LITERALS = new Set([
  'PSIRS/2026/000123',
  // A place, not a phrase; the same name in both languages.
  'Plateau State',
  // A keyboard event code. Translating it breaks the key.
  'Enter',
  'Escape',
  // Compared after trimming, so the trailing space is not part of it.
  'Bearer',
  'Content-Type',
  /*
   * The browser and platform the handset reports, and the two words used when
   * it reports nothing recognisable.
   *
   * These are not copy. `describeDevice` builds a `DeviceProfile` that is
   * POSTed to `/agents/me/devices` and stored, and an officer reviewing a
   * handset reads it back out of that record. Translating them would write
   * Hausa into a device fingerprint and leave the same phone recorded under
   * two different names depending on the language it was registered in. The
   * label beside the value comes from the dictionary, which is the right
   * arrangement — the same one a TIN gets.
   */
  'Chrome',
  'Firefox',
  'Safari',
  'Edge',
  'Opera',
  'Android',
  'Windows',
  'Linux',
  'Unknown',
  'Unknown browser',
  /*
   * `'Notification' in window` — a feature test naming a DOM interface. The
   * shape rule below covers the other identifiers; this one is a single
   * capitalised word with no internal capital, which is indistinguishable
   * from copy without knowing what it is.
   */
  'Notification',
  /*
   * The language switcher, which names each language in that language. `HA
   * (Hausa)` translated into Hausa would leave somebody who cannot read the
   * current setting no way back out of it.
   */
  'EN (English)',
  'HA (Hausa)',
]);

/**
 * SVG path data, which the widened rule above reads as a capitalised sentence.
 *
 * `M12 5v14M5 12h14` opens with a capital, contains spaces and lower-case
 * letters, and is a drawing. The icons in `ui.tsx` are full of them.
 */
const isPathData = (text: string) => /^[Mm][\s\d.-]/.test(text) && !/[A-Za-z]{3}/.test(text);

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

function capitalisedLiteralsIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  for (const match of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    const text = (match[1] ?? match[2] ?? '').trim();
    /*
     * `^[A-Z][a-z]` was the original test, and it let every sentence opening
     * with an acronym through — including "PSIRS does not have permission to
     * use the camera.", the string this whole rule exists to have caught. A
     * capital followed by a space and a lower-case word is prose whatever the
     * first word is; one token with no space is an identifier, and
     * `isIdentifier` below decides that case.
     */
    if (!/^[A-Z][a-z]/.test(text) && !/^[A-Z][^\s]*\s+\S*[a-z]/.test(text)) continue;
    if (KEYS.has(text) || ALLOWED_LITERALS.has(text) || isIdentifier(text) || isPathData(text)) continue;
    if (NOT_YET_THROUGH_THE_DICTIONARY.has(text)) continue;
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
      found.push(text);
    }
  }
  return found;
}

describe('no surface has English of its own', () => {
  it('routes even its expression literals through the dictionary', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SURFACES)) {
      for (const text of capitalisedLiteralsIn(source)) offenders.push(`${path}: ${text}`);
      for (const text of templateTextIn(source)) offenders.push(`${path}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The language that hides in a date rather than in a label.
 *
 * `toLocaleString('en-NG')` renders an English month to an agent working in
 * Hausa just as surely as an English button would, and no rule above can see
 * it. There were seven of them in this application, written inline because it
 * had no date helper at all.
 *
 * A bare `toLocaleDateString()` is worse still. With no locale at all the order
 * of the day and the month is whatever the browser prefers, so one receipt
 * reads 9/8 in Jos and 8/9 in a browser set to American English — the same
 * date, two meanings, and no way for the reader to tell which they have. There
 * was one, on the citizen statement.
 *
 * `formatDateIn` and `formatDateTimeIn` in @psirs/shared take the month from
 * the dictionary, so it is deterministic and the reviewer sees the twelve
 * words. A screen wanting a shape they do not offer should widen them rather
 * than reach past, because the next person to reach past will pin a locale.
 */
describe('no screen picks its own locale', () => {
  it('formats every date through the dictionary', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SURFACES)) {
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
