/**
 * Product usage analytics: what the vocabulary is, and what it deliberately
 * cannot express.
 *
 * The platform knew, in detail, what money had moved and who had touched which
 * record. It knew nothing about the interface: which screens agents reach,
 * where a registration is abandoned, how long a collection takes on a handset
 * in a market, how many agents ever switch to Hausa. A team building for the
 * grassroots was flying blind on whether the grassroots could use the thing.
 *
 * THIS IS NOT THE AUDIT LOG, AND MUST NEVER BECOME IT. `audit_logs` is
 * evidence: hash-chained, append-only, tied to a person and a record, and
 * admissible. Usage analytics is operational telemetry: aggregate, disposable,
 * expired on a schedule, and about the software rather than about a
 * transaction. Conflating them would put disposable data in an evidentiary
 * chain and identity in a disposable one.
 *
 * NO IDENTITY. No user id, no agent id, no taxpayer id, no phone, no TIN.
 * Agents on this platform are paid commission and screened for fraud; adding
 * per-person interface surveillance on top of that is a different thing from
 * knowing whether a form is too long, and only the second one is being built.
 * Where per-agent numbers are legitimately wanted, `agentPerformance` already
 * answers them — from collections, which are the agent's actual work, rather
 * than from their keystrokes.
 *
 * A CLOSED VOCABULARY. Event names come from the list below and the server
 * refuses anything else. An open string field filled by a client becomes
 * unbounded cardinality, then a slow table, then junk nobody trusts — and it
 * is also the field through which a compromised client would write whatever it
 * liked into an operator's screen.
 */

/** Which application an event came from. */
export const USAGE_SURFACES = ['AGENT_PWA', 'PORTAL'] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];

/**
 * Where a multi-step attempt got to.
 *
 * ABANDONED is the one that pays for this whole module: a form nobody
 * finishes looks identical, in every other record the platform keeps, to a
 * form nobody started.
 */
export const USAGE_OUTCOMES = ['STARTED', 'COMPLETED', 'ABANDONED', 'FAILED'] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

/**
 * The events, chosen for questions somebody would act on.
 *
 * Each is here because an answer changes a decision: shorten a form, fix a
 * screen, translate a string, buy different handsets. An event nobody would
 * act on is a row that costs storage and buys nothing.
 */
export const USAGE_EVENTS = [
  /** Did the agent get through registering a taxpayer, and where did they stop? */
  'taxpayer.registration',
  /** Did a collection complete, and where did it break? */
  'collection',
  /** The clearance application — twenty-seven fields, and the first thing an
   *  agent ever does. Abandonment here is an agent the state never gets. */
  'agent.application',
  /** Vehicle capture, the other offline-capable flow. */
  'vehicle.capture',
  /** A screen was opened. `step` names it. */
  'screen.viewed',
  /** A draft went into the offline queue, came out of it, or failed to. */
  'draft.queued',
  'draft.synced',
  'draft.sync_failed',
  /** Someone switched language. The Hausa work is a large investment and
   *  nothing currently reports whether anybody uses it. */
  'language.changed',
  /** The app was opened — the denominator for everything above. */
  'app.opened',
  /** A report or receipt was exported from the portal. */
  'export.generated',
] as const;
export type UsageEvent = (typeof USAGE_EVENTS)[number];

export function isUsageEvent(value: string): value is UsageEvent {
  return (USAGE_EVENTS as readonly string[]).includes(value);
}

/**
 * One reported event.
 *
 * `flowId` groups the steps of a single attempt so a funnel can be built. It
 * is generated on the device per attempt and is not stored against anything
 * else — it says "these three rows are one registration", not "these rows are
 * this person".
 */
export interface UsageEventInput {
  event: UsageEvent;
  occurredAt: string;
  step?: string | null;
  outcome?: UsageOutcome | null;
  durationMs?: number | null;
  flowId?: string | null;
  language?: string | null;
  connection?: string | null;
  appVersion?: string | null;
  /** Coarse geography only. See the migration for why this is the LGA and not
   *  the ward, and why small groups are suppressed when it is reported. */
  lgaId?: string | null;
}

/**
 * The most events one request may carry.
 *
 * Batching exists so a handset on a bad connection sends one request rather
 * than forty. The cap exists so a broken client cannot post a megabyte.
 */
export const USAGE_BATCH_LIMIT = 50;

/**
 * How short a step name may be, and how long.
 *
 * `step` is the one free-text field, and it names a screen or a form section
 * rather than carrying content. Bounded here so the vocabulary stays legible
 * and the column stays small.
 */
export const USAGE_STEP_MAX_LENGTH = 64;

/**
 * Below this many events, a breakdown is suppressed rather than shown.
 *
 * Usage rows carry no identity, but a small enough group can still single
 * somebody out — one agent working one LGA on one afternoon is identifiable
 * from a count of three. Aggregates therefore drop groups smaller than this
 * instead of publishing them, which is a property worth having in the query
 * rather than in a guideline nobody reads.
 */
export const USAGE_MIN_GROUP_SIZE = 5;
