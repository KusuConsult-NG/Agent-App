/**
 * A date is a word and two numbers, and the word has to be translated.
 *
 * Both applications formatted every date with `toLocaleDateString('en-NG')`,
 * hardcoded — eighty call sites — so a citizen or an officer reading Hausa met
 * "08 Sept 2026" in the middle of a Hausa sentence. It is the same failure as
 * the untranslated buttons, hiding in a helper rather than in a screen.
 *
 * What this holds is that the month comes from the dictionary rather than from
 * the runtime's idea of Hausa. `toLocaleDateString('ha')` would look right on
 * this machine and render English on a browser built with a trimmed ICU, and
 * either way the twelve words would never reach the reviewer who checks the
 * Hausa. The dictionary is the only route that is both deterministic and
 * visible.
 */

import { describe, it, expect } from 'vitest';
import { formatDateIn, formatDateTimeIn, translations } from '@psirs/shared';

const SEPTEMBER = '2026-09-08T14:05:00';

describe('a date is read in the reader’s language', () => {
  it('names the month from the dictionary, not from the runtime', () => {
    expect(formatDateIn(SEPTEMBER, translations.en)).toBe('08 Sept 2026');
    expect(formatDateIn(SEPTEMBER, translations.ha)).toBe('08 Sat 2026');
  });

  it('differs between the two languages, which is the whole point', () => {
    const months = Array.from({ length: 12 }, (_, m) => new Date(2026, m, 15).toISOString());
    const changed = months.filter(
      (when) => formatDateIn(when, translations.en) !== formatDateIn(when, translations.ha),
    );
    /*
     * Not all twelve: January and March and May are spelt the same in both,
     * and inventing a difference to make a round number would be worse than
     * the English. Eight is what the dictionary actually says.
     */
    expect(changed.length).toBeGreaterThan(5);
  });

  it('keeps the clock on twenty-four hours in both', () => {
    // 14:05 and not "2:05 pm": am/pm is an English convention that would need
    // translating too, and a receipt timed 07:15 beside one timed 7:15 pm is
    // the kind of ambiguity that costs an argument at a counter.
    expect(formatDateTimeIn(SEPTEMBER, translations.en)).toBe('08 Sept 2026, 14:05');
    expect(formatDateTimeIn(SEPTEMBER, translations.ha)).toBe('08 Sat 2026, 14:05');
  });

  it('renders a dash for nothing, and for something that is not a date', () => {
    for (const t of [translations.en, translations.ha]) {
      expect(formatDateIn(null, t)).toBe('—');
      expect(formatDateIn(undefined, t)).toBe('—');
      expect(formatDateIn('', t)).toBe('—');
      // A table of dates with one gap reads better with a mark than with a
      // word repeated down the column — and better than "Invalid Date".
      expect(formatDateIn('not a date', t)).toBe('—');
      expect(formatDateTimeIn('not a date', t)).toBe('—');
    }
  });

  it('has a name for all twelve months in both languages', () => {
    const keys = ['monJan', 'monFeb', 'monMar', 'monApr', 'monMay', 'monJun',
      'monJul', 'monAug', 'monSep', 'monOct', 'monNov', 'monDec'] as const;
    for (const key of keys) {
      expect(translations.en[key], `English is missing ${key}`).toBeTruthy();
      expect(translations.ha[key], `Hausa is missing ${key}`).toBeTruthy();
    }
    // A month rendered as an empty string would silently produce "08  2026".
    const blank = Array.from({ length: 12 }, (_, m) =>
      formatDateIn(new Date(2026, m, 1).toISOString(), translations.ha),
    ).filter((rendered) => /\s\s/.test(rendered));
    expect(blank).toEqual([]);
  });
});
