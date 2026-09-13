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
