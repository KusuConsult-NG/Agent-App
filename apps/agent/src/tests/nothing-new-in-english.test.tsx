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
]);

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
    /\b(?:const|let|var)\s|\buseState\(|\buseRef\(|\bRecord<|\bPromise<|\bapi\.[a-z]/.test(text)
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

  return found.filter(
    (text) =>
      /[A-Za-z]{2}/.test(text) && !KEYS.has(text) && !ALLOWED.has(text) && !looksLikeCode(text),
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
