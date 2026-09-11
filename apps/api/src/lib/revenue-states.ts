/**
 * Which transaction statuses mean the State has the money, rendered for SQL.
 *
 * The definition itself is not here. `REVENUE_RECOGNISED_STATES` in
 * `@psirs/shared` is the platform's answer to "has the government actually
 * received this" and has been since the state machine was written. What was
 * missing was anybody using it: the constant was exported and had no callers,
 * while six queries in this API wrote the same list out again by hand.
 *
 * Four of those copies were right. The fifth and sixth were not.
 *
 * WHY A HAND-WRITTEN COPY GOES WRONG HERE IN PARTICULAR
 *
 * A collection moves through a fixed sequence. `verifyPayment` sets
 * PAYMENT_VERIFIED and then, inside the same database transaction,
 * RECONCILIATION_PENDING — "confirmed by the gateway; awaiting settlement into
 * a government account". It rests there until a bank statement covering it is
 * fetched and matched, which is when it becomes RECEIPT_GENERATED and finally
 * SETTLED.
 *
 * So PAYMENT_VERIFIED lasts milliseconds and holds almost no money, while
 * RECONCILIATION_PENDING holds everything collected since the last overnight
 * sweep. A list that keeps the first and drops the second reads as plausible
 * and understates the day — which is exactly what the audit workbench's
 * ('PAYMENT_VERIFIED','RECEIPT_GENERATED','SETTLED') did in three of its money
 * queries, with nothing failing to show for it. Its AGENT_ACTIVITY report
 * counted an agent's transactions against one predicate and their collections
 * against another, so an agent whose day had not yet been reconciled appeared
 * in a signed, checksummed report as having taken collections and remitted
 * nothing.
 *
 * NOT THE ONLY LEGITIMATE SET
 *
 * `payment-history.ts` and `incentives.ts` use a deliberately narrower one —
 * SETTLED, RECEIPT_GENERATED, RECONCILIATION_PENDING — because they answer
 * "has this citizen's payment been confirmed", and that answer must not turn
 * on a status which exists for a few milliseconds inside one transaction.
 * Those are documented where they are defined and are not copies of this.
 */

import { REVENUE_RECOGNISED_STATES } from '@psirs/shared';

/**
 * The recognised states as a SQL list, for interpolation into an `IN (...)`.
 *
 * Derived, never written out. The values are a closed set of upper-case
 * identifiers declared in the shared package, so there is no user input
 * anywhere near this and nothing to escape; what matters is that it cannot
 * say anything the shared constant does not.
 */
export const REVENUE_STATES_SQL = `(${REVENUE_RECOGNISED_STATES.map((state) => `'${state}'`).join(',')})`;
