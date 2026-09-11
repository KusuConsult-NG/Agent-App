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
