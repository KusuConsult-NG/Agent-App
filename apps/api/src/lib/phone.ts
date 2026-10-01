/**
 * One phone number, written the way whoever is holding it writes it.
 *
 * A Nigerian number has three ordinary spellings and they are the same number:
 *
 *     08012345678       what a citizen reads off their own handset
 *     2348012345678     what a gateway hands back
 *     +2348012345678    what this platform stores
 *
 * Everything that WRITES a phone number goes through `phoneSchema`, which
 * settles on the last of those. Three doors that LOOK ONE UP compared the
 * string as typed, so the platform canonicalised on the way in and did not on
 * the way out. Observed against the database, on a taxpayer stored the way
 * registration stores them:
 *
 *     stored as:                           +2348012345678
 *     citizen types +2348012345678 -> hits 1
 *     citizen types 08012345678   -> hits 0
 *     citizen types 2348012345678 -> hits 0
 *
 * The middle line is the one that matters: `08012345678` is the form the
 * portal's own placeholder tells a citizen to use, and it is the only form
 * most people know their own number in. It found nothing, and the citizen was
 * told there was no record — on the public status page, and on the door that
 * sends the one-time code, which is their only way to their full record.
 *
 * MATCHING EVERY FORM RATHER THAN NORMALISING THE INPUT. Normalising the
 * question would fix the citizen typing a local number against a stored
 * international one, and would leave the reverse — a row imported or seeded
 * before `phoneSchema` covered that path, stored as `0803…`, unreachable by
 * somebody typing `+234803…`. The column has no format constraint, so both
 * directions are real. Asking for every spelling at once costs one array
 * parameter and settles both.
 *
 * A number that is not a Nigerian one at all still matches itself, so nothing
 * that could be found before becomes unfindable.
 */

/** A Nigerian mobile number, in any of the three spellings people use. */
export const NIGERIAN_PHONE = /^(?:\+?234|0)[789]\d{9}$/;

/** Strip the punctuation people put in a number they are writing down. */
export function stripPhonePunctuation(value: string): string {
  return value.trim().replace(/[\s-()]/g, '');
}

/**
 * `+234XXXXXXXXXX`, or null when this is not a Nigerian number.
 *
 * The form the platform stores, so that what is written and what is looked up
 * agree without either side having to know about the other.
 */
export function normaliseNigerianPhone(value: string): string | null {
  const bare = stripPhonePunctuation(value);
  if (!NIGERIAN_PHONE.test(bare)) return null;
  if (bare.startsWith('+234')) return bare;
  if (bare.startsWith('234')) return `+${bare}`;
  return `+234${bare.slice(1)}`;
}

/**
 * Every spelling that should find the same person.
 *
 * Ordered with the canonical form first so a query that stops at the first hit
 * prefers it, and always including the caller's own string so a stored value
 * this function cannot parse is still reachable by typing it exactly.
 */
export function phoneLookupForms(value: string): string[] {
  const raw = value.trim();
  const canonical = normaliseNigerianPhone(raw);
  if (!canonical) return [raw];
  const national = canonical.slice(4);
  return [...new Set([canonical, `0${national}`, `234${national}`, raw])];
}

/**
 * The canonical form where one exists, and the caller's own string where it
 * does not.
 *
 * For a column that is *matched against* rather than merely displayed, and
 * whose value arrives from somewhere `phoneSchema` cannot stand — a vehicle
 * authority's record, an agent typing an owner's number into a free-text box.
 * Refusing is not available there: an owner may hold a number that is not
 * Nigerian at all, and a vehicle capture that fails because of the owner's
 * dialling code is a worse outcome than a number stored as given.
 *
 * So this narrows what it can and leaves the rest alone, which is the
 * difference between it and `normaliseNigerianPhone`.
 */
export function canonicalPhoneOrRaw(value: string): string;
export function canonicalPhoneOrRaw(value: string | null | undefined): string | null;
export function canonicalPhoneOrRaw(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return normaliseNigerianPhone(trimmed) ?? trimmed;
}
