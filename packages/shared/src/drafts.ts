/**
 * Why PSIRS would not take a capture made on a phone.
 *
 * This is read in the worst circumstances the platform has. An agent is in a
 * market or at a roadside, holding somebody's money or standing in front of
 * somebody who has just given them details, and the record they made will not
 * go. Retrying will not help — a refusal is not a lost signal, which the queue
 * already handles silently — so the sentence has to be enough for them to
 * decide what to do while the person is still there.
 *
 * It was the API's English, on an application that offers Hausa.
 *
 * Unlike the confirmations, this one could not be fixed by reading data
 * already on the wire: `reject()` both answers the request and writes the
 * sentence to `offline_drafts.rejection_reason`, where it is read back long
 * afterwards by anybody asking what happened to a capture. So the English
 * stays, as the record, and a code travels beside it.
 *
 * A refusal that PSIRS composed deliberately — "this person is already
 * registered as Rifkatu Bala" — arrives instead as the `AppError`'s own code,
 * which the agent application already translates. Only the three below have
 * no code of their own.
 */

export const DRAFT_REFUSALS = [
  /**
   * The capture did not pass validation.
   *
   * Carries the failing field paths in `detail`, because "something is wrong
   * with this capture" is not something an agent can act on and "phone, tin"
   * is. The paths are identifiers rather than prose, which is why they can
   * cross the language boundary unchanged.
   */
  'DRAFT_INVALID',
  /**
   * A capture of a kind this build of the API has no handler for.
   *
   * Rejected loudly rather than stored where nothing will look at it. Carries
   * `{{type}}`, which the phone already knows — it is the draft it made.
   */
  'DRAFT_TYPE_UNSUPPORTED',
  /**
   * Something failed that was nobody's decision.
   *
   * Deliberately vague about the cause: the alternative was the raw error,
   * which told an agent nothing they could use and told anybody reading over
   * their shoulder the names of our tables. Carries `{{reference}}`, which
   * the phone already knows.
   */
  'DRAFT_NOT_PROCESSED',
  /**
   * A capture of a kind this caller may not put through.
   *
   * The queue is a second entrance to three operations that each have a front
   * door of their own, and the two were gated differently: `/drafts/sync`
   * admits on `taxpayer:create`, while raising an observation online needs
   * `assessment:create` or `paye:file` and capturing a vehicle needs
   * `vehicle:renew`. Nobody can walk through today — `agent` is the only
   * holder of `taxpayer:create` and holds the other two — but that is a fact
   * about the seed and `role_permissions` is a table PSIRS can change without
   * a deployment.
   *
   * So the queue now asks the same question the front door asks, per capture,
   * and this is the answer when it comes back no. Refused one capture at a
   * time rather than the whole batch: a caller entitled to queue a taxpayer
   * registration and not an observation should have the registration go
   * through.
   */
  'DRAFT_NOT_PERMITTED',
] as const;

export type DraftRefusal = (typeof DRAFT_REFUSALS)[number];

/**
 * The same three in English, for `offline_drafts.rejection_reason`.
 *
 * This column is the record of what happened to a capture, read back by
 * support and by anybody reconciling what an agent says they collected
 * against what PSIRS holds. It stays in one language on purpose.
 */
export const DRAFT_REFUSAL_SENTENCES: Record<DraftRefusal, string> = {
  DRAFT_INVALID: 'Draft could not be accepted: {{detail}}',
  DRAFT_TYPE_UNSUPPORTED:
    'This version of the platform cannot process a "{{type}}" capture. It has not been ' +
    'discarded — quote this reference to support.',
  DRAFT_NOT_PROCESSED:
    'This capture could not be processed. It is still on your phone — quote reference ' +
    '{{reference}} to support.',
  DRAFT_NOT_PERMITTED:
    'Your account is not allowed to record a "{{type}}" capture. It has not been sent, and ' +
    'nothing else in this batch was affected.',
};

/** The English sentence for a refusal, with whatever it carries filled in. */
export function draftRefusalSentence(
  refusal: DraftRefusal,
  parts: { detail?: string; type?: string; reference?: string } = {},
): string {
  return DRAFT_REFUSAL_SENTENCES[refusal]
    .replace('{{detail}}', parts.detail ?? '')
    .replace('{{type}}', parts.type ?? '')
    .replace('{{reference}}', parts.reference ?? '');
}
