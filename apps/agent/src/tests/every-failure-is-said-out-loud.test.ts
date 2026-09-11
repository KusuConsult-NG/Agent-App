/**
 * Nothing that fails does so in silence.
 *
 * Kept identical to the portal's copy, because the class is identical and a
 * rule enforced on one client and not the other is how it came back the
 * first time. What differs is the consequence: an agent's handset is in a
 * market on one bar of signal, so the failure this refuses is not the
 * unusual case there — it is the ordinary one.
 *
 * This class has been swept twice and grown back twice. The shape is always
 * the same: a handler that only knows what to do with an `ApiRequestError`.
 *
 *     if (caught instanceof ApiRequestError) setError(caught.error);
 *     setError(caught instanceof ApiRequestError ? caught.error : null);
 *
 * The first sets nothing; the second sets null. Either way a dropped
 * connection, a parse failure or a timeout reaches the person as nothing at
 * all: a button stops spinning and the screen is exactly as it was. On a
 * state-changing action that is the worst available answer, because they
 * cannot tell whether it went through — so they press it again, and the
 * taxpayer owes twice.
 *
 * It grew back because a three-line branch repeated at ninety call sites is
 * something people copy from the nearest example, and the nearest example was
 * often one of the wrong ones. `asApiError` replaced all ninety. This refuses
 * the raw shapes so the next one cannot be written.
 *
 * WHAT IS STILL ALLOWED, AND WHY
 *
 * A handler may branch on `ApiRequestError` as much as it likes PROVIDED it
 * also says something when the failure is not one — and several do better
 * than `asApiError` by naming a translated fallback of their own ("could not
 * reach the platform", "the access log could not be read"). Those are the
 * good shape and this must not push them towards the generic one, so the rule
 * is "has a fallback", not "uses the helper".
 *
 * Kept as a source lint rather than a type: TypeScript cannot object to a
 * branch that is merely incomplete.
 */

import { describe, it, expect } from 'vitest';

const SOURCES: Record<string, string> = {
  ...(import.meta.glob('../screens/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../ui.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  // The agent keeps shared controls in `components/`, and the step-up dialog
  // there is on the path of every guarded money decision an agent makes.
  ...(import.meta.glob('../components/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob(['../lib/*.ts', '!../lib/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
};

/**
 * `lib/api.ts` is where the distinction is defined, so it is the one file
 * that must test `instanceof ApiRequestError` without a fallback beside it —
 * `asApiError` IS the fallback.
 */
const DEFINES_THE_RULE = /lib\/api\.ts$/;

/** The ternary that sets null for anything that is not a refusal. */
const SETS_NULL = /\(\s*(\w+) instanceof ApiRequestError \? \1\.\w+ : null\s*\)/;

/**
 * An `if` on `ApiRequestError` whose statement ends without an `else`.
 *
 * Matched on the source text rather than parsed: the shapes this is looking
 * for are one-liners and simple blocks, and a parser here would be a second
 * thing to keep right.
 */
function branchesWithoutAFallback(source: string): string[] {
  const lines = source.split('\n');
  const found: string[] = [];

  lines.forEach((line, index) => {
    if (!/if \(\w+ instanceof ApiRequestError\)/.test(line)) return;
    // `} else if (...)` is the tail of a chain that began elsewhere; the
    // chain's own fallback is what matters and it is checked at its head.
    if (/\belse if \(/.test(line)) return;

    const rest = lines.slice(index + 1);
    // A single-statement branch: the fallback, if any, is the very next line.
    if (/;\s*$/.test(line)) {
      const next = rest.find((l) => l.trim() !== '');
      if (!next || !/^\s*\}?\s*else\b/.test(next)) found.push(`${index + 1}: ${line.trim()}`);
      return;
    }
    // A block branch: find the line that closes it at the same indent, and
    // look for `else` there.
    const indent = line.search(/\S/);
    const close = rest.findIndex((l) => l.search(/\S/) === indent && /^\s*\}/.test(l));
    if (close === -1) return;
    if (!/\belse\b/.test(rest[close]!)) found.push(`${index + 1}: ${line.trim()}`);
  });

  return found;
}

describe('the agent application never fails quietly', () => {
  it('has the files to check', () => {
    // A glob that stopped matching would make the assertions below pass by
    // reading nothing, which is this check's own version of the bug.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
  });

  it('leaves no handler that only understands an API refusal', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      if (DEFINES_THE_RULE.test(file)) continue;
      for (const hit of branchesWithoutAFallback(source)) offenders.push(`${file} ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('leaves no handler that turns anything else into null', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([file, source]) => !DEFINES_THE_RULE.test(file) && SETS_NULL.test(source))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
