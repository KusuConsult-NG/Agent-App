/**
 * When an invoice is owed and can still be paid, rendered for SQL.
 *
 * An invoice stops being payable at `expires_at` — the payment path refuses it
 * with INVOICE_EXPIRED from that moment — and stops being UNPAID up to an hour
 * later, when `expireLapsedInvoices` reaches it and writes EXPIRED. That sweep
 * says of itself that it decides nothing: it "makes the record agree with the
 * answer the payment path was already giving". A query that reads the status
 * alone therefore gives one answer for the hour after a deadline and the
 * opposite answer for ever after, with nothing having happened in between.
 *
 * Measured with one ₦3,000 bill, read in date, lapsed, and swept. The
 * taxpayer's compliance score went 20, 20, 45, the last of them reading "No
 * unpaid invoices on record" beside "0 of 1 assessment period(s) settled" in
 * the same breakdown. Their obligations list and the only-unpaid search filter
 * kept them at the second reading and dropped them at the third. The officer's
 * home tile had been fixed for exactly this earlier the same day, one reader
 * at a time; ten other queries still asked the status.
 *
 * So every reader of "owed" asks this instead, and the sweep changes no
 * figure. `an-invoice-stops-being-owed.test.ts` reads each one three times —
 * in date, lapsed, swept — and holds the last two equal.
 *
 * WHICH WAY, AND WHAT IT COSTS
 *
 * It could have gone the other way: treat EXPIRED as owed everywhere. Five of
 * these call sites said they already did — "the debt does not lapse with the
 * paper" — and they were describing the hour before the sweep. They were
 * also describing something nothing can undo. An EXPIRED invoice is never
 * discharged: no route reissues it, none cancels it, and the payment path
 * refuses it. Counting it as owed would hold a citizen who paid the
 * replacement bill out of every `requires_no_arrears` programme for good, by
 * a score component no action of theirs could recover — and "a score that
 * cannot be earned by doing everything asked is not measuring compliance" is
 * this repository's own rule, in `incentives.ts`.
 *
 * The cost of this direction is real and is stated rather than hidden: a bill
 * left to lapse stops counting against the person who did not pay it. It
 * always did, an hour after the deadline; now it does at the deadline. The
 * fix for that is a reissue that supersedes the lapsed invoice — which now
 * exists, `reissueInvoice` and migration 091 — and not a figure that counts a
 * debt nobody can settle.
 *
 * WHERE LAPSED MONEY IS STILL COUNTED
 *
 * Two readers include EXPIRED on purpose, and each labels it: the arrears
 * worklist's lapsed figure, and the per-row `payable` flag on what a person
 * owes across the State (`connections.ts`). Lapsed money is reported there, as
 * money that needs a fresh assessment before anyone can collect it. Nothing
 * else should include it.
 *
 * Written against the alias `i`, like `UNDER_OPEN_OBJECTION_SQL`, so a caller
 * that names `invoices` something else fails in Postgres rather than matching
 * the wrong table. No user input goes anywhere near this.
 */
export const PAYABLE_INVOICE_SQL = `(i.status IN ('UNPAID', 'PARTIALLY_PAID')
  AND (i.expires_at IS NULL OR i.expires_at > now()))`;
