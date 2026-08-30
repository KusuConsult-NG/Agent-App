/**
 * The same boundary, on the pages a citizen reads without an account.
 *
 * `apps/portal` is government software and stays in English — an officer's
 * revenue-intelligence screen is not a Hausa surface and pretending otherwise
 * would produce a translation nobody reads. `Public.tsx` is the exception, and
 * the important one: it is the receipt verification page, the citizen's own
 * compliance lookup, the referee's confirmation and the group leader's
 * attestation. None of those people work for PSIRS, none of them hold an
 * account, and for most of them this page is the entire platform.
 *
 * So the file is checked and its neighbours are not, which is a decision
 * rather than an oversight. It caught the verdict itself on the way in: every
 * word under the mark was translated, and the mark — VALID, NOT FOUND — was
 * the English left in the largest type on the page.
 *
 * The agent PWA carries the same check over its own twelve screens, with the
 * reasoning in `apps/agent/src/tests/nothing-new-in-english.test.tsx`.
 */

import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob('../screens/Public.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Literals that are correct as they stand, each for a stated reason. */
const ALLOWED = new Set([
  // Shapes a citizen copies off a piece of paper. A translated example
  // receipt number is a number somebody will type in and be refused on.
  'PSIRS/2026/000123',
  'T7C72-QTUDN',
  '08012345678',
  'TIN',
  'PSIRS',
  'QR',
]);

const RENDERED_PROPS = /\b(?:title|placeholder|aria-label|label|hint|alt)="([^"]+)"/g;

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
    /\b(?:const|return|useState|useRef|Record|Promise|api)\b/.test(text)
  );
}

function englishIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
    found.push(match[1].replace(/\s+/g, ' ').trim());
  }
  for (const match of code.matchAll(RENDERED_PROPS)) found.push(match[1].trim());
  return found.filter(
    (text) => /[A-Za-z]{2}/.test(text) && !ALLOWED.has(text) && !looksLikeCode(text),
  );
}

describe('the pages a citizen reads stay translated', () => {
  it('has the public screen to check', () => {
    // A glob that stopped matching would make the assertion below pass by
    // having nothing to look at.
    expect(Object.keys(SOURCES)).toHaveLength(1);
  });

  it('routes every visible string through the dictionary', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      for (const text of englishIn(source)) offenders.push(`${path}: ${text}`);
    }
    expect(offenders).toEqual([]);
  });
});
