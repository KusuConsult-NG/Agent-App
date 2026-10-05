/**
 * Tax due-date reminder sweep (PRD §44).
 *
 * Four windows are declared before an invoice's `expires_at` date:
 *
 *   6 weeks (42 days)  — TAX_REMINDER_6W
 *   4 weeks (28 days)  — TAX_REMINDER_4W
 *   2 weeks (14 days)  — TAX_REMINDER_2W
 *   1 week  (7 days)   — TAX_REMINDER_1W
 *
 * THREE OF THEM FIRE. THE FIRST CANNOT.
 *
 * `createAssessmentIn` gives every invoice thirty days to be paid.
 * `invoiceValidityDays` is a parameter on its own call that would change that
 * and no caller anywhere passes it, so thirty days is not a default, it is the
 * only value the platform issues. The gap between now and an invoice's expiry
 * therefore starts at thirty days and only shrinks, and a window whose floor
 * is forty-one days is a window no invoice can enter.
 *
 * So TAX_REMINDER_6W has never been sent to anybody. Its template is
 * approved, its flag column exists on every invoice and is false on all of
 * them. (This said its Hausa translation was written when none of the
 * reminders had one; migration 101 wrote them, for all four windows.) Two
 * suites appeared to cover it by moving an invoice's
 * expiry out to forty-two days first, which is a state the platform cannot
 * produce; both now use a window an invoice really passes through.
 *
 * TAX_REMINDER_4W fires, and fires early: a thirty-day invoice enters the
 * 27–29 day window one day after it is raised. A taxpayer assessed on the
 * Monday is told on the Tuesday that they have four weeks to pay, which is
 * true and is not what a ladder of three reminders was drawn for.
 *
 * TAX_REMINDER_1W is why a thirty-day invoice still gets three. Until
 * migration 098 the last word a taxpayer heard was at two weeks, with
 * fourteen days still to run and nothing after it. The final-week reminder
 * also says what happens when the date passes: the debt stays, but the bill
 * has to be issued again before it can be paid.
 *
 * The 6W entry stays rather than being deleted, for the reason the dead
 * predicate list gives in its own words: inert and correct beats absent and
 * wrong. If a revenue item is ever given a longer window to pay — and the
 * annual obligations are the obvious candidates — a sixty-day invoice should
 * get every reminder rather than silently miss the first. What is removed is
 * the claim that it works today, which is what `a-reminder-nothing-can-reach`
 * measures so that this comment cannot go quietly out of date.
 *
 * Safeguards:
 *
 *   - Each window has a dedicated flag column (`reminder_sent_6w`, etc.) on
 *     the invoice. The sweep sets the flag before queuing the notification and
 *     only operates on unflagged invoices, so re-running the sweep never sends
 *     a duplicate.
 *
 *   - Daily levies (expires_at within 2 days from now) are intentionally
 *     skipped — a market stall or abattoir levy that expires tomorrow is not
 *     the kind of obligation that benefits from multi-week reminders.
 *
 *   - The function is idempotent: it can be called any number of times safely
 *     and is designed to run as a scheduled background worker (server.ts) as
 *     well as on-demand via a government officer API endpoint.
 */

import { formatCalendarDayIn, formatNaira, translations } from '@psirs/shared';
import type { Db } from '../db/pool';
import { UNDER_OPEN_OBJECTION_SQL } from '../lib/enforcement-suspended';
import { chargePeriodShutSql } from '../lib/payable-invoice';
import { pool, query, withTransaction } from '../db/pool';
import { queueNotification } from './notifications';
import { citizenPortalUrl } from '../lib/public-urls';

/**
 * Another sweep has this invoice's window.
 *
 * Its own type rather than a bare Error, so the catch in the loop can count it
 * as skipped without logging it beside the failures that are faults. Two
 * sweeps racing is an ordinary outcome of the on-demand trigger existing; a
 * reminder that could not be queued is not.
 */
class ReminderAlreadyClaimed extends Error {
  constructor(invoiceId: string, event: string) {
    super(`${event} for invoice ${invoiceId} was already claimed by another sweep`);
    this.name = 'ReminderAlreadyClaimed';
  }
}
import type { NotificationEvent } from './notifications';

/*
 * The portal link is built by `lib/public-urls.ts` rather than here.
 *
 * This line used to be its own hand-rolled URL with no hash on it, which is
 * the mistake that module exists to prevent — and this is the only public link
 * a taxpayer receives without having asked for it.
 */

/**
 * Nigeria keeps West Africa Time all year — UTC+1, no daylight saving.
 *
 * The due date was rendered with `toLocaleDateString('en-NG')` and no zone,
 * which uses whichever zone the process runs in. Every container in this repo
 * runs UTC, so an invoice expiring in the first hour of a Lagos day was
 * announced to the taxpayer as the day before. The taxpayer is in Plateau
 * State; the date they are given has to be theirs.
 */
const NIGERIAN_DAY = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

/**
 * The due date in each language the reminder can go out in.
 *
 * The day is the Plateau day (above); the month is a word, so it comes from
 * the dictionary. This was one en-NG string, formatted before anything knew
 * the reader's language, and a Hausa reminder read "… a 20 October 2026".
 */
function dueDateIn(expiresAt: Date): { en: string; ha: string } {
  const parts = Object.fromEntries(
    NIGERIAN_DAY.formatToParts(expiresAt).map((part) => [part.type, part.value]),
  );
  const day = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
  return { en: formatCalendarDayIn(day, translations.en), ha: formatCalendarDayIn(day, translations.ha) };
}

interface ReminderWindow {
  event: NotificationEvent;
  minDays: number;
  maxDays: number;
  flagColumn: 'reminder_sent_6w' | 'reminder_sent_4w' | 'reminder_sent_2w' | 'reminder_sent_1w';
}

/**
 * Exported so the reachability of each window can be measured against the
 * invoices the platform actually issues, rather than asserted in a comment.
 * See the note at the top of this file: the first entry is inert today.
 */
export const REMINDER_WINDOWS: ReminderWindow[] = [
  { event: 'TAX_REMINDER_6W', minDays: 41, maxDays: 43, flagColumn: 'reminder_sent_6w' },
  { event: 'TAX_REMINDER_4W', minDays: 27, maxDays: 29, flagColumn: 'reminder_sent_4w' },
  { event: 'TAX_REMINDER_2W', minDays: 13, maxDays: 15, flagColumn: 'reminder_sent_2w' },
  { event: 'TAX_REMINDER_1W', minDays: 6, maxDays: 8, flagColumn: 'reminder_sent_1w' },
];

interface DueInvoice {
  id: string;
  taxpayer_id: string;
  revenue_item_name: string;
  revenue_item_name_ha: string | null;
  total_amount_kobo: string;
  expires_at: Date;
  tin: string | null;
}

export async function sendDueReminders(db: Db = pool): Promise<{ sent: number; skipped: number }> {
  let totalSent = 0;
  let totalSkipped = 0;

  for (const window of REMINDER_WINDOWS) {
    const result = await processWindow(db, window);
    totalSent += result.sent;
    totalSkipped += result.skipped;
  }

  return { sent: totalSent, skipped: totalSkipped };
}

async function processWindow(
  db: Db,
  window: ReminderWindow,
): Promise<{ sent: number; skipped: number }> {
  // Find invoices whose expiry falls within this window and have not yet had
  // a reminder for this window sent. Exclude daily-levy invoices (those that
  // expire within 2 days from now — they cycle too fast for multi-week notices).
  const invoices = await query<DueInvoice>(
    db,
    `SELECT
       i.id,
       i.taxpayer_id,
       ri.name AS revenue_item_name,
       ri.name_ha AS revenue_item_name_ha,
       i.total_amount_kobo::text,
       i.expires_at,
       t.tin
     FROM invoices i
     JOIN assessments a ON a.id = i.assessment_id
     JOIN revenue_items ri ON ri.id = a.revenue_item_id
     JOIN taxpayers t ON t.id = i.taxpayer_id
    WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID')
      -- Not a record somebody took off the register. The debt stays owed and
      -- stays in every total; what stops is the chasing, because the business
      -- has shut or the person has died and the number now belongs to somebody
      -- else. Ended records that still owe are worked from the
      -- ended-with-arrears queue instead, by a person rather than a sweep.
      AND t.status = 'ACTIVE'
      -- And nothing the State has agreed not to pursue.
      --
      -- The same reasoning as the clause above, which stops the sweep chasing
      -- an ended record: what stops is the chasing. An open objection suspends
      -- enforcement, and an automated SMS demanding payment is the most direct
      -- form of it there is — unsolicited, at scale, and arriving days after
      -- the trader was told the objection had been received. If the objection
      -- is dismissed the invoice becomes eligible again on its own, because
      -- this is a predicate and not a flag.
      AND NOT ${UNDER_OPEN_OBJECTION_SQL}
      -- And only a bill that can be paid as it stands.
      --
      -- A bill whose charge was ended by a reversal, or that was raised in a
      -- month since closed, is owed but has to be issued again before anybody
      -- can pay it. Every reminder ends "pay now" with a link, and for these
      -- that was a link to a payment that would be refused. They stay on the
      -- arrears worklist, marked as needing to be issued again, and once one
      -- is, the new bill is reminded about like any other.
      AND EXISTS (
            SELECT 1 FROM transactions tx
             WHERE tx.invoice_id = i.id
               AND tx.status IN ('INVOICE_GENERATED', 'FAILED', 'PAYMENT_INITIATED', 'PAYMENT_PENDING')
               AND ${chargePeriodShutSql('tx')} IS NULL)
      AND i.expires_at IS NOT NULL
      AND i.expires_at > now() + INTERVAL '2 days'
      AND i.expires_at BETWEEN now() + ($1 || ' days')::INTERVAL
                             AND now() + ($2 || ' days')::INTERVAL
      AND i.${window.flagColumn} = false
    ORDER BY i.expires_at
    LIMIT 500`,
    [window.minDays, window.maxDays],
  );

  if (invoices.length === 0) return { sent: 0, skipped: 0 };

  /*
   * One question asked once, rather than the same rollback five hundred times.
   *
   * If the wording for this window is out of service, every invoice below
   * would set its flag, queue nothing and roll back. That is handled — but it
   * is worth saying plainly and in one place, because the operational fact is
   * about the template, not about five hundred taxpayers.
   */
  const active = await query<{ channel: string }>(
    db,
    `SELECT channel FROM notification_templates WHERE event = $1 AND status = 'ACTIVE'`,
    [window.event],
  );
  if (active.length === 0) {
    console.error(
      `[reminders:${window.event}] no active notification template; ` +
        `${invoices.length} invoice(s) not reminded and left for the next sweep`,
    );
    return { sent: 0, skipped: invoices.length };
  }

  let sent = 0;
  let skipped = 0;

  for (const invoice of invoices) {
    try {
      await withTransaction(async (client) => {
        /*
         * Mark the flag first, inside the transaction, so a crash mid-send
         * does not cause duplicate reminders (better to miss one than to spam).
         *
         * AND ONLY IF IT IS STILL FALSE.
         *
         * Without that condition the claim in `server.ts` — "running it more
         * than once never duplicates a reminder" — held one sweep after
         * another and not two side by side. Both select the invoice while the
         * flag is false, the first takes the row lock and queues, and the
         * second unblocks, sets true to true, and queues the same unsolicited
         * demand for payment again.
         *
         * Two sweeps can run at once: the scheduled one holds a job lock, but
         * `POST /government/reminders/send-due` calls this directly, so an
         * officer pressing the button while the schedule runs — or two
         * officers pressing it together — is exactly that. The route now takes
         * the same lock, and this condition is what makes the sweep idempotent
         * whatever reaches it.
         *
         * `rowCount` of zero means another sweep has this invoice. Throwing
         * rolls back and counts it as skipped, which is what it is: nothing
         * for this sweep to do, because the work is already done.
         */
        const claimed = await client.query(
          `UPDATE invoices SET ${window.flagColumn} = true
            WHERE id = $1 AND ${window.flagColumn} = false`,
          [invoice.id],
        );
        if (claimed.rowCount === 0) {
          throw new ReminderAlreadyClaimed(invoice.id, window.event);
        }

        const dueDate = dueDateIn(invoice.expires_at);

        const queued = await queueNotification(client, {
          event: window.event,
          taxpayerId: invoice.taxpayer_id,
          variables: {
            dueDate: dueDate.en,
            amount: invoice.total_amount_kobo,
            revenueItem: invoice.revenue_item_name,
            revenueItemHa: invoice.revenue_item_name_ha ?? invoice.revenue_item_name,
            tinNumber: invoice.tin ?? 'Pending',
            portalUrl: citizenPortalUrl(),
          },
          localisedVariables: { dueDate },
          entityType: 'invoice',
          entityId: invoice.id,
        });

        /*
         * The flag above is what stops a second reminder, so setting it for a
         * message that was never queued costs this taxpayer the window
         * permanently. queueNotification returns zero when no ACTIVE template
         * exists for the event — which is not a fault but an intended
         * operation, the reason templates carry a status column at all.
         *
         * Throwing rolls the flag back with the rest of the transaction and
         * lands in the catch below, so the invoice is counted as skipped and
         * is picked up again by the next sweep.
         */
        if (queued === 0) {
          throw new Error(
            `no active notification template for ${window.event}; nothing was queued`,
          );
        }
      });
      sent++;
    } catch (error) {
      // Do not let one failed invoice block the rest of the sweep.
      //
      // A reminder another sweep had already claimed is not a failure and does
      // not belong in the error log beside the ones that are: it is counted as
      // skipped, which is the honest word for it.
      if (!(error instanceof ReminderAlreadyClaimed)) {
        console.error(`[reminders] failed for invoice ${invoice.id}:`, error);
      }
      skipped++;
    }
  }

  if (sent > 0 || skipped > 0) {
    console.log(
      `[reminders:${window.event}] sent=${sent} skipped=${skipped}`,
    );
  }

  return { sent, skipped };
}
