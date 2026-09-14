/**
 * Rules about a person's recorded identity.
 *
 * A date of birth is the one identity field a registration form invites
 * someone to type freely, and the one the platform never re-derives from
 * anything else. A typed date can therefore be wrong in ways no other field
 * can: a slipped year gives a taxpayer who has not been born yet. The rule
 * below is deliberately narrow — it rejects only dates that cannot describe a
 * living person, and takes no view on how old a taxpayer must be, because the
 * platform has no such policy to enforce.
 */

/** The earliest year the platform will accept as a birth year. */
export const EARLIEST_BIRTH_YEAR = 1900;

export type BirthDateProblem = 'MALFORMED' | 'IN_THE_FUTURE' | 'TOO_LONG_AGO';

/**
 * Why a birth date cannot be recorded, or `null` when it can.
 *
 * `today` is a parameter so that callers on either side of the network agree
 * on the boundary: the API passes the server's date, the form passes the
 * device's, and neither has to guess at the other's clock.
 */
export function birthDateProblem(value: string, today: Date = new Date()): BirthDateProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'MALFORMED';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'MALFORMED';
  // Reject a date the calendar rewrote, such as 2025-02-30 becoming 2025-03-02.
  if (parsed.toISOString().slice(0, 10) !== value) return 'MALFORMED';

  const endOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (parsed.getTime() > endOfToday) return 'IN_THE_FUTURE';
  if (parsed.getUTCFullYear() < EARLIEST_BIRTH_YEAR) return 'TOO_LONG_AGO';
  return null;
}

/** Whether a birth date can describe a living person. */
export function isRecordableBirthDate(value: string, today?: Date): boolean {
  return birthDateProblem(value, today) === null;
}

/** What to show the person holding the form, in words they can act on. */
export function birthDateMessage(problem: BirthDateProblem): string {
  switch (problem) {
    case 'IN_THE_FUTURE':
      return 'That date of birth is in the future. Check the year.';
    case 'TOO_LONG_AGO':
      return `That date of birth is before ${EARLIEST_BIRTH_YEAR}. Check the year.`;
    case 'MALFORMED':
      return 'Enter the date of birth as a day, month and year.';
  }
}

/**
 * Why the platform thinks a registration may already exist.
 *
 * Codes rather than sentences, for the reason the clearance blockers are
 * codes: these are read by an agent standing in front of the person being
 * registered, on a device that offers Hausa, and a sentence composed in
 * `apps/api` is a sentence in English by the time it arrives. The agent is
 * being asked to decide whether two records are the same human being, and
 * that decision is made on exactly these five lines.
 */
export const DUPLICATE_REASONS = [
  'IDENTITY_NUMBER',
  'PHONE_AND_NAME',
  'PHONE',
  'BUSINESS_NAME_IN_LGA',
  'NAME_IN_LGA',
] as const;

export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

/**
 * The same five in English, for `taxpayer_duplicate_checks.match_reasons`.
 *
 * That column is the record of why an agent was warned and what they decided,
 * read back by whoever investigates a duplicate months later. It must not
 * depend on what a dictionary says at the time it is read.
 */
export const DUPLICATE_REASON_SENTENCES: Record<DuplicateReason, string> = {
  IDENTITY_NUMBER: 'The same identification number is already registered',
  PHONE_AND_NAME: 'Same phone number and same name',
  PHONE: 'This phone number is already registered to another taxpayer',
  BUSINESS_NAME_IN_LGA: 'A business with this name is already registered in this LGA',
  NAME_IN_LGA: 'A taxpayer with this name is already registered in this LGA',
};

/** The English for a match reason, for the record rather than the screen. */
export function duplicateReasonSentence(code: DuplicateReason): string {
  return DUPLICATE_REASON_SENTENCES[code];
}
