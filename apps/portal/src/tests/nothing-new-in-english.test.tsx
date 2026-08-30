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

/** Object-literal fields that are rendered rather than used. */
const RENDERED_FIELDS =
  /\b(?:label|hint|title|description|blurb|note|caption|help)\s*:\s*'((?:[^'\\]|\\.){2,})'/g;

/**
 * Fragments of TypeScript the text-run pattern picks up by accident.
 *
 * Kept identical to the agent's copy, and narrow for the same reasons: an
 * earlier version treated any parenthesis as code, which would have let every
 * parenthesised label through, and treating a semicolon or equals sign as code
 * excluded prose containing one. What is matched is punctuation that appears
 * in expressions and not in writing.
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
    found.push(match[1].replace(/\s+/g, ' ').trim());
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
