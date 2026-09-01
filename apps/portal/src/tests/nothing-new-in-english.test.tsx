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
      for (const text of englishIn(source)) offenders.push(`${path}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });
});
