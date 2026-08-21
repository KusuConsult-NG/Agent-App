/**
 * Tax due-date reminder sweep (PRD §44).
 *
 * Sends reminders at three windows before an invoice's `expires_at` date:
 *
 *   6 weeks (42 days)  — TAX_REMINDER_6W
 *   4 weeks (28 days)  — TAX_REMINDER_4W
 *   2 weeks (14 days)  — TAX_REMINDER_2W
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

import { formatNaira } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, withTransaction } from '../db/pool';
import { queueNotification } from './notifications';
import type { NotificationEvent } from './notifications';

const PORTAL_URL = process.env.PUBLIC_PORTAL_URL ?? 'https://psirs.plateaustate.gov.ng/citizen';

interface ReminderWindow {
  event: NotificationEvent;
  minDays: number;
  maxDays: number;
  flagColumn: 'reminder_sent_6w' | 'reminder_sent_4w' | 'reminder_sent_2w';
}

const WINDOWS: ReminderWindow[] = [
  { event: 'TAX_REMINDER_6W', minDays: 41, maxDays: 43, flagColumn: 'reminder_sent_6w' },
  { event: 'TAX_REMINDER_4W', minDays: 27, maxDays: 29, flagColumn: 'reminder_sent_4w' },
  { event: 'TAX_REMINDER_2W', minDays: 13, maxDays: 15, flagColumn: 'reminder_sent_2w' },
];

interface DueInvoice {
  id: string;
  taxpayer_id: string;
  revenue_item_name: string;
  total_amount_kobo: string;
  expires_at: Date;
  tin: string | null;
}

export async function sendDueReminders(db: Db = pool): Promise<{ sent: number; skipped: number }> {
  let totalSent = 0;
  let totalSkipped = 0;

  for (const window of WINDOWS) {
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
       i.total_amount_kobo::text,
       i.expires_at,
       t.tin
     FROM invoices i
     JOIN assessments a ON a.id = i.assessment_id
     JOIN revenue_items ri ON ri.id = a.revenue_item_id
     JOIN taxpayers t ON t.id = i.taxpayer_id
    WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID')
      AND i.expires_at IS NOT NULL
      AND i.expires_at > now() + INTERVAL '2 days'
      AND i.expires_at BETWEEN now() + ($1 || ' days')::INTERVAL
                             AND now() + ($2 || ' days')::INTERVAL
      AND i.${window.flagColumn} = false
    ORDER BY i.expires_at
    LIMIT 500`,
    [window.minDays, window.maxDays],
  );

  let sent = 0;
  let skipped = 0;

  for (const invoice of invoices) {
    try {
      await withTransaction(async (client) => {
        // Mark the flag first, inside the transaction, so a crash mid-send
        // does not cause duplicate reminders (better to miss one than to spam).
        await client.query(
          `UPDATE invoices SET ${window.flagColumn} = true WHERE id = $1`,
          [invoice.id],
        );

        const dueDate = invoice.expires_at.toLocaleDateString('en-NG', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });

        await queueNotification(client, {
          event: window.event,
          taxpayerId: invoice.taxpayer_id,
          variables: {
            dueDate,
            amount: invoice.total_amount_kobo,
            revenueItem: invoice.revenue_item_name,
            tinNumber: invoice.tin ?? 'Pending',
            portalUrl: PORTAL_URL,
          },
          entityType: 'invoice',
          entityId: invoice.id,
        });
      });
      sent++;
    } catch (error) {
      // Do not let one failed invoice block the rest of the sweep.
      console.error(`[reminders] failed for invoice ${invoice.id}:`, error);
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
