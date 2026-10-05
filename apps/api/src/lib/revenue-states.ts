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

import { RETURNED_STATES, REVENUE_RECOGNISED_STATES } from '@psirs/shared';

/**
 * A closed set of states, rendered for interpolation into an `IN (...)`.
 *
 * Derived, never written out. The values are a closed set of upper-case
 * identifiers declared in the shared package, so there is no user input
 * anywhere near this and nothing to escape; what matters is that these lists
 * cannot say anything the shared constants do not.
 */
const asSqlList = (states: readonly string[]) =>
  `(${states.map((state) => `'${state}'`).join(',')})`;

/** The states in which the State has the money. */
export const REVENUE_STATES_SQL = asSqlList(REVENUE_RECOGNISED_STATES);

/** The states that mean money went back to the payer, as a SQL list. */
export const RETURNED_STATES_SQL = asSqlList(RETURNED_STATES);

/**
 * Every transaction where money reached the State, returned or not.
 *
 * The denominator for "how much of what we took went back", and the reason
 * this constant exists at all. The fraud sweep's reversal rule divided its
 * reversals by every transaction an agent had touched in thirty days —
 * which is mostly assessments nobody paid, a thing no reversal can ever
 * happen to and a thing the agent raises as many of as they like.
 *
 * Measured: eight settled collections and two reversed is a twenty per cent
 * rate and raises the flag. The same eight, the same two, plus twenty
 * unpaid assessments is six point seven per cent and raises nothing. So an
 * agent reversing a fifth of their collections stayed under a fraud rule by
 * doing more of the ordinary part of their job.
 *
 * A rate needs both of its halves drawn from the same population. This is
 * that population: recognised, plus returned — because a reversed collection
 * was recognised once, and leaving it out would drop the numerator's own rows
 * from the denominator and overstate the rate instead.
 */
export const MONEY_TAKEN_STATES_SQL = asSqlList([
  ...REVENUE_RECOGNISED_STATES,
  ...RETURNED_STATES,
]);

/**
 * The recognised states in which the money has not yet reached a government
 * account: confirmed by the gateway, not yet matched to a bank credit.
 *
 * A collection becomes RECEIPT_GENERATED when a bank statement covering it is
 * matched, and SETTLED after that. Until then it is counted as collected and
 * is not an exception (settlement takes a day or two), but nobody can yet
 * point to it in the State's account. Closing a month waits for these
 * (`periods.ts`), because the month's settled figure, and the bank credits
 * that would complete it, freeze with the close.
 *
 * Written as the recognised set less the states a matched credit reaches, so
 * a recognised state added later lands here until somebody says otherwise:
 * the safe side for a question asked before a figure is frozen.
 */
const BANKED_STATES: readonly string[] = ['RECEIPT_GENERATED', 'SETTLED'];
export const AWAITING_SETTLEMENT_STATES_SQL = asSqlList(
  REVENUE_RECOGNISED_STATES.filter((state) => !BANKED_STATES.includes(state)),
);
