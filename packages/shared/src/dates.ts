/**
 * A date as the reader reads it, without asking the runtime what Hausa is.
 *
 * Both applications formatted every date with `toLocaleDateString('en-NG')`,
 * hardcoded, so an officer or a citizen working in Hausa read "08 Sept 2026"
 * inside a Hausa sentence. Eighty call sites, every screen.
 *
 * THE OBVIOUS FIX IS THE WRONG ONE. Passing `'ha'` to `toLocaleDateString`
 * is one line and ICU does know Hausa — Janairu, Faburairu, Maris. It fails
 * this codebase twice over. It puts twelve Hausa words on every screen that
 * `HAUSA-REVIEW.md` never shows the reviewer, when the whole doctrine here is
 * that nothing visible reaches a person without passing the dictionary first;
 * and it depends on the runtime carrying full ICU. A browser built with a
 * trimmed one silently renders English, which is the failure this platform
 * keeps writing tests against: it looks fixed and is not.
 *
 * So the month names are dictionary strings like every other word, the twelve
 * of them are in the review sheet, and the output is the same on any runtime.
 *
 * The day and the year are digits and need no help. Only the month is a word.
 */

import type { TranslationDictionary } from './i18n';

const MONTH_KEYS = [
  'monJan', 'monFeb', 'monMar', 'monApr', 'monMay', 'monJun',
  'monJul', 'monAug', 'monSep', 'monOct', 'monNov', 'monDec',
] as const satisfies readonly (keyof TranslationDictionary)[];

/** A parsed date, or null for anything that is not one. */
function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * `08 Sept 2026`, or `08 Sat 2026` for a reader in Hausa.
 *
 * The em dash for a missing date is what every call site rendered before and
 * is deliberately not a word: a table of dates with one gap reads better with
 * a mark than with "unknown" repeated down the column.
 */
export function formatDateIn(
  value: string | Date | null | undefined,
  t: TranslationDictionary,
): string {
  const date = parse(value);
  if (!date) return '—';
  return `${pad(date.getDate())} ${t[MONTH_KEYS[date.getMonth()]!]} ${date.getFullYear()}`;
}

/**
 * The same, with the clock.
 *
 * Twenty-four hour, because a receipt timed "07:15" and another "7:15 pm" in
 * the same list is the kind of ambiguity that costs an argument at a counter,
 * and because am/pm is an English convention that would need translating too.
 */
export function formatDateTimeIn(
  value: string | Date | null | undefined,
  t: TranslationDictionary,
): string {
  const date = parse(value);
  if (!date) return '—';
  return `${formatDateIn(date, t)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DAY_KEYS = [
  'dowSun', 'dowMon', 'dowTue', 'dowWed', 'dowThu', 'dowFri', 'dowSat',
] as const satisfies readonly (keyof TranslationDictionary)[];

const LONG_MONTH_KEYS = [
  'monthJan', 'monthFeb', 'monthMar', 'monthApr', 'monthMay', 'monthJun',
  'monthJul', 'monthAug', 'monthSep', 'monthOct', 'monthNov', 'monthDec',
] as const satisfies readonly (keyof TranslationDictionary)[];

/**
 * `Tuesday, 8 September 2026` — the date across the top of every officer screen.
 *
 * Spelt out because it is the one date on the portal that is read rather than
 * scanned: it says what today is, once, at the top. That costs nineteen more
 * dictionary strings than the short form, seven of them weekdays, and they are
 * worth it — this is the most-seen date in the product.
 *
 * The Hausa was seeded from ICU and then corrected: it hands back `Jummaʼa`
 * with a modifier letter apostrophe, and every apostrophe in this dictionary is
 * `’`. That is the sort of thing the dictionary route shows a reviewer and
 * `toLocaleDateString('ha')` would have rendered silently for ever.
 */
export function formatLongDateIn(
  value: string | Date | null | undefined,
  t: TranslationDictionary,
): string {
  const date = parse(value);
  if (!date) return '—';
  const day = t[DAY_KEYS[date.getDay()]!];
  const month = t[LONG_MONTH_KEYS[date.getMonth()]!];
  return `${day}, ${date.getDate()} ${month} ${date.getFullYear()}`;
}
