/**
 * A search box should match what somebody typed, not what LIKE reads it as.
 *
 * `%` and `_` are wildcards in a SQL LIKE pattern, and every search on this
 * platform builds its pattern by wrapping a term the caller supplied:
 * `'%' || term || '%'`. A term carrying either character therefore stops being
 * a term and becomes a pattern.
 *
 * On an authenticated list that is a nuisance — an officer looking for a
 * business called `A_Z Motors` gets `AxZ Motors` too. On the public taxpayer
 * lookup it was a control failure. That route deliberately refuses to
 * enumerate: a name search returns a COUNT and the sentence "use your TIN or
 * phone number to see your specific record", and the whole surface is rate
 * limited to ten requests a minute per address to stop exactly this. Observed
 * against the database, on a register of five:
 *
 *     a stranger searching name=Am:       1
 *     a stranger searching name=%%:       5     <- the whole active register
 *     a stranger searching name=_____ ____: 4   <- a length probe
 *
 * The second is the size of the register, which the route exists not to give.
 * The third is a positional oracle a substring search cannot offer at all:
 * `_` counts characters, so a caller can ask how many people have a forename
 * of exactly five letters, and narrow from there. Neither needs an account.
 *
 * THE BACKSLASH IS PART OF THE JOB. `investigation.ts` already escaped `%` and
 * `_`, and stopped there, so a term containing a backslash re-opened the
 * wildcard it was meant to close: `a\%b` became the pattern `%a\\%b%`, where
 * `\\` is a literal backslash and the `%` after it is live again. Confirmed in
 * Postgres — `'xxa\ZZZbxx' LIKE '%a\\%b%'` is true, so a search for the literal
 * text `a\%b` matched `a`, a backslash, anything, `b`. Not an enumeration hole
 * on an authenticated surface, and not exploitable to widen a match to
 * everything, because the pattern still requires a backslash in the data. It
 * is simply an escaper that did not escape its own escape character.
 *
 * Postgres takes backslash as the default LIKE escape character, so these
 * three are the whole set; the terms travel as bound parameters, never as SQL
 * literals, so `standard_conforming_strings` does not come into it.
 */

/** A term as itself: every LIKE metacharacter, and the escape, made literal. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** The `%term%` pattern a "contains" search wants, with the term made literal. */
export function likeContains(term: string): string {
  return `%${escapeLike(term)}%`;
}
