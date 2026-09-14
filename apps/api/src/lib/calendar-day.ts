/**
 * A calendar day is not an instant, and the two get compared anyway.
 *
 * Postgres DATE columns on this platform name a whole day: the day a
 * certificate is valid until, the day an amnesty closes, the day a period
 * ends. `pg` hands each one back as a JS `Date` at midnight at the START of
 * that day, because that is the only instant it can pick. So any code that
 * writes such a value into a TIMESTAMPTZ, or compares it against `now`,
 * silently reads the day as having already finished before anybody was awake
 * in it.
 *
 * The failure is always the same shape and always lands on the last day, which
 * is the day that matters: the day printed on the paper, the day the notice
 * said to come in by. It has now been found twice — vehicle certificates and
 * incentive programmes — so the reasoning lives here rather than beside one of
 * them.
 *
 * Note the asymmetry this exists to remove. A window's opening end needs no
 * help: `start_date > now` is false from midnight, so the first day is already
 * included. Only the closing end has to be widened to the day it names, and an
 * interval that is inclusive at one end and exclusive at the other is a bug
 * whichever way round it is written.
 */

/**
 * The last instant of the calendar day `date` falls in, in local time.
 *
 * The end of that day rather than the start of the next one, deliberately.
 * These values are formatted back to a reader — "expired on 5 March" beside a
 * certificate printed 4 March trades one disagreement for another.
 */
export function endOfDay(date: Date): Date {
  const last = new Date(date);
  last.setHours(23, 59, 59, 999);
  return last;
}

/*
 * ON WHOSE CLOCK
 *
 * `setHours` works in the process's local zone, and so does the midnight `pg`
 * parsed the DATE into. Both skews are therefore the same one, and cancel: the
 * window this produces is [local midnight, local end of day], which is the
 * whole of the day whatever the process is set to.
 *
 * It is not the whole of the day in Africa/Lagos unless the process is. This
 * platform never assumes that — everywhere the question is genuinely "what
 * time was it for the person", the zone is named outright (`AT TIME ZONE
 * 'Africa/Lagos'` in fraud.ts and officer-inbox.ts, `timeZone` in the
 * reminders' Intl options) — so on a UTC process this window runs from 01:00
 * on the day to 00:59 the next morning, Plateau time.
 *
 * That hour is deliberately left alone. It errs late: a certificate lapses an
 * hour after the day it names rather than an hour before, and the only instant
 * it excludes is between midnight and 01:00 on the opening day, when nobody is
 * presenting papers to anybody. Naming the zone here would mean also naming it
 * at the parse, and the honest fix for that is a date layer that never makes a
 * `Date` out of a DATE at all — worth doing deliberately, not as a side effect
 * of this.
 *
 * The one deployment where the cancellation fails is a process at a NEGATIVE
 * UTC offset, where `toISOString().slice(0, 10)` on the result prints the
 * following day. Plateau State is UTC+1.
 */

/*
 * WHICH YEAR IT IS, AND WHOSE YEAR
 *
 * The note above is about a DATE column read back. This is the other half of
 * the same question, asked forwards: code that wants to know what the date is
 * *now*, in order to stamp it onto something.
 *
 * `new Date().getUTCFullYear()` answers it in UTC whatever zone the process is
 * set to — the `getUTC*` getters ignore `TZ` — so deploying the containers as
 * `Africa/Lagos` would not have corrected a single one of these sites. Nigeria
 * keeps West Africa Time all year, UTC+1 with no daylight saving, so between
 * midnight and 01:00 on any Plateau day the two disagree, and on 1 January
 * they disagree about the year.
 *
 * That hour is not hypothetical for a revenue platform. Agents collect at
 * markets and motor parks, receipts are minted whenever money arrives, and the
 * year on a government receipt number is what the receipt is filed under.
 *
 * `reminders.ts` already reached this conclusion for the date a taxpayer is
 * told ("the date they are given has to be theirs") and named the zone. These
 * helpers are the same decision for the date the State writes down.
 */

/** Nigeria keeps West Africa Time all year: UTC+1, no daylight saving. */
export const PLATEAU_TIME_ZONE = 'Africa/Lagos';

const PLATEAU_CALENDAR = new Intl.DateTimeFormat('en-GB', {
  timeZone: PLATEAU_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface CalendarParts {
  year: number;
  /** 0-11, so the parts drop straight into `Date.UTC`. */
  month: number;
  day: number;
}

/**
 * The calendar date `instant` falls on in Plateau State.
 *
 * Returned as parts rather than a `Date` deliberately: a calendar date is not
 * an instant, and handing back a `Date` invites exactly the re-interpretation
 * the top of this file exists to warn about. Build the window you want from
 * the parts — `Date.UTC(year, month, day)` gives a value whose
 * `toISOString().slice(0, 10)` is the day these parts name.
 */
export function plateauParts(instant: Date = new Date()): CalendarParts {
  const parts = PLATEAU_CALENDAR.formatToParts(instant);
  const value = (type: 'year' | 'month' | 'day'): number => {
    const found = parts.find((part) => part.type === type);
    // Unreachable with the options above; a throw beats a silent NaN year
    // ending up in a receipt number.
    if (!found) throw new Error(`Africa/Lagos calendar produced no ${type}`);
    return Number.parseInt(found.value, 10);
  };
  return { year: value('year'), month: value('month') - 1, day: value('day') };
}

/**
 * The year it is in Plateau State.
 *
 * The year component of a government reference number, and of anything else
 * the State stamps with "this year". Takes the server clock, never a
 * client-supplied date: a field device with a wrong clock must not be able to
 * mint next year's receipt numbers.
 */
export function currentYearInPlateau(instant: Date = new Date()): number {
  return plateauParts(instant).year;
}

/**
 * The calendar day it is in Plateau State, as `YYYY-MM-DD`.
 *
 * The form a DATE column and a date filter both take, so it can be compared
 * without ever becoming an instant again.
 */
export function todayInPlateau(instant: Date = new Date()): string {
  const { year, month, day } = plateauParts(instant);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
