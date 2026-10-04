/**
 * When an invoice can still be paid, and when it is owed, rendered for SQL.
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
 * So every reader asks a fragment from this file instead of the status, and
 * the sweep changes no figure.
 *
 * TWO QUESTIONS, TWO FRAGMENTS
 *
 * "What can be paid today" and "what is owed" were answered by this one
 * fragment, and for a while they were the same question: an EXPIRED invoice
 * could never be discharged — no route reissued it, none withdrew it, and the
 * payment path refused it — so counting it as owed would have held a citizen
 * out of every `requires_no_arrears` programme for good, by a figure no action
 * of theirs could clear. The choice was stated here, with its cost: a bill
 * left to lapse stopped counting against the person who did not pay it.
 *
 * Both reasons have gone. A lapsed bill is issued again by
 * `reissueInvoice` (migration 091), which cancels it and puts one payable
 * bill in its place, so paying clears it; and a bill raised in error is
 * withdrawn by two officers (migration 092), so a duplicate does not count for
 * ever either. So the questions now get different answers:
 *
 *   PAYABLE_INVOICE_SQL — can be paid today, by the deadline. For the places
 *   that send somebody to collect: the officer's unpaid tile (beside its own
 *   count of expired invoices), the arrears call list (which reports lapsed
 *   money on its own line, as needing to be issued again), and the payment
 *   path itself.
 *
 *   OWED_INVOICE_SQL — owed, whether or not its window is open: unpaid, part
 *   paid, or lapsed, and not withdrawn or replaced. For the places that judge
 *   or report what somebody owes: the compliance score and the no-arrears
 *   gate, the only-unpaid search, the debt left behind on a closed record,
 *   expected revenue, and the defaulters report. Letting a bill lapse no longer
 *   improves any of them.
 *
 * Either way, the sweep changes no figure: in date, lapsed and swept read the
 * same for every OWED reader, and lapsed and swept read the same for every
 * PAYABLE one. `an-invoice-stops-being-owed.test.ts` reads each one three
 * times.
 *
 * A replaced invoice is CANCELLED (migration 091 makes that a rule), so
 * neither fragment can count a debt and its replacement twice.
 *
 * Written against the alias `i`, like `UNDER_OPEN_OBJECTION_SQL`, so a caller
 * that names `invoices` something else fails in Postgres rather than matching
 * the wrong table. No user input goes anywhere near this.
 */
export const PAYABLE_INVOICE_SQL = `(i.status IN ('UNPAID', 'PARTIALLY_PAID')
  AND (i.expires_at IS NULL OR i.expires_at > now()))`;

/**
 * Owed, whatever the state of its payment window. See the header above for
 * which question each fragment answers. Same alias, same reason.
 */
export const OWED_INVOICE_SQL = `(i.status IN ('UNPAID', 'PARTIALLY_PAID', 'EXPIRED'))`;
