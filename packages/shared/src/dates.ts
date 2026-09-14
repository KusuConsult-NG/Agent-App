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

/**
 * Today as `YYYY-MM-DD`, on the clock of whoever is looking at the screen.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day, and Nigeria is UTC+1
 * all year round. So for the first hour of every Plateau day that expression
 * answered "today" with yesterday's date — an officer recording a settlement at
 * 00:15 got a form prefilled with the day before, and a date range defaulting
 * to "up to today" ended before the collections already taken that morning.
 *
 * The parts are read off the local getters instead of going through UTC, so
 * the answer is the date on the wall behind the person reading it.
 *
 * Deliberately the DEVICE's clock rather than a named zone. This is a default
 * a person is shown and can change, so it should match the clock they can see;
 * the server never trusts it, which is the division `targets.ts` already draws
 * — "a client computing 'this month' from its own clock is a client that can be
 * wrong about it", so the server resolves the periods that decide anything.
 */
export function todayIsoLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The local calendar day `days` before today, same rules as `todayIsoLocal`. */
export function daysAgoIsoLocal(days: number, now: Date = new Date()): string {
  const then = new Date(now);
  then.setDate(then.getDate() - days);
  return todayIsoLocal(then);
}
