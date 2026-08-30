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
]);

/** Props whose value is rendered rather than used. */
const RENDERED_PROPS =
  /\b(?:title|placeholder|aria-label|label|hint|patternHint|confirmLabel|alt)="([^"]+)"/g;

/** The same props written as a JSX expression, which is equally valid. */
const BRACED_PROPS =
  /\b(?:title|placeholder|aria-label|label|hint|empty|patternHint|confirmLabel|alt)=\{'((?:[^'\\]|\\.)+)'\}/g;

/** Object-literal fields that are rendered rather than used. */
const RENDERED_FIELDS =
  /\b(?:label|hint|title|description|blurb|note|caption|help)\s*:\s*'((?:[^'\\]|\\.){2,})'/g;

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
function looksLikeCode(text: string): boolean {
  return (
    /[{}[\]]|=>|\);|\(\{|\}\)|&&|\|\||\?\?/.test(text) ||
    text.startsWith(')') ||
    text.endsWith('(') ||
    /^[a-z][A-Za-z0-9_]*$/.test(text) ||
    /\b(?:const|return|useState|useRef|Record|Promise|api)\b/.test(text)
  );
}

function englishIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];

  for (const match of code.matchAll(/(?<![=!<>-])>([^<>{}]+)</g)) {
    // Two or more consecutive letters is the cheapest test for "a word rather
    // than punctuation, an entity, or a fragment of an expression".
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]{2}/.test(text)) found.push(text);
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
