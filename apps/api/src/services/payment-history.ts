/**
 * What a person has paid, for what, and when.
 *
 * The platform could always answer "what do you owe". It could not answer the
 * question every taxpayer actually asks at a counter — *what have I already
 * paid you?* — and a revenue service that cannot answer that is asking people
 * to keep their own records and then disbelieving them. A market trader with a
 * shoebox of thermal receipts, half of them faded, was the only archive.
 *
 * WHAT COUNTS AS PAID.
 *
 * Money that reached a government account, or is on its way there under a
 * confirmed payment: SETTLED, RECEIPT_GENERATED and RECONCILIATION_PENDING.
 * The same three statuses the compliance score treats as paid, deliberately —
 * a history that disagreed with the score would have a taxpayer reading a
 * receipt on one screen and being told they had missed a payment on another.
 *
 * A reversal is shown, not hidden. Money that came back is part of what
 * happened, and a history that quietly dropped it would look like a mistake to
 * anybody holding the receipt.
 *
 * WHY THE PERIOD IS REQUIRED AND NOT DEFAULTED TO EVERYTHING.
 *
 * "What did I pay last year" is the question people ask for a reason — they
 * are reconciling against a bank statement, or proving standing to a bank, or
 * checking a levy they think they paid twice. An unbounded history is slower,
 * harder to read, and answers a question nobody asked. The caller says the
 * window; the range is inclusive of both ends because that is how a person
 * reading "1 January to 31 December" understands it.
 */

import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import { badRequest } from '../lib/errors';

/** The statuses that mean money arrived. Kept in step with the score. */
/** The day part of a DATE column, however the driver hands it over. */
function asDate(value: string | Date | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

const PAID_STATUSES = ['SETTLED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING'] as const;
const RETURNED_STATUSES = ['REVERSED', 'REFUNDED'] as const;

export interface PaymentHistoryRow {
  transactionReference: string;
  paidAt: string | null;
  revenueItem: string;
  revenueItemHa: string | null;
  category: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountKobo: string;
  channel: string;
  status: string;
  returned: boolean;
  receiptNumber: string | null;
  lgaName: string | null;
}

export interface PaymentHistory {
  from: string;
  to: string;
  summary: {
    payments: number;
    totalKobo: string;
    returnedKobo: string;
    /** What the money went to, largest first — the answer to "for what". */
    byItem: { revenueItem: string; revenueItemHa: string | null; payments: number; totalKobo: string }[];
  };
  rows: PaymentHistoryRow[];
}

export interface PaymentHistoryParams {
  taxpayerId: string;
  /** Inclusive, ISO dates. */
  from: string;
  to: string;
  limit?: number;
}

export async function paymentHistory(
  db: Db,
  params: PaymentHistoryParams,
): Promise<PaymentHistory> {
  if (params.from > params.to) {
    throw badRequest('The start of the period is after its end.');
  }

  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  /*
   * `to` is a date and `verified_at` a timestamp, so a plain `<=` would drop
   * everything paid after midnight on the closing day — the whole of the last
   * day of the window, silently. Compared against the start of the following
   * day instead.
   */
  const args = [params.taxpayerId, params.from, params.to, limit];

  const rows = await query<{
    transaction_reference: string;
    paid_at: Date | null;
    revenue_item: string;
    revenue_item_ha: string | null;
    category: string | null;
    period_label: string | null;
    period_start: string | Date | null;
    period_end: string | Date | null;
    amount_kobo: string;
    channel: string;
    status: string;
    receipt_number: string | null;
    lga_name: string | null;
  }>(
    db,
    `SELECT t.transaction_reference,
            COALESCE(t.settled_at, t.verified_at, t.created_at) AS paid_at,
            ri.name          AS revenue_item,
            ri.name_ha       AS revenue_item_ha,
            rc.name          AS category,
            a.period_label,
            a.period_start,
            a.period_end,
            t.total_amount_kobo::text AS amount_kobo,
            t.channel,
            t.status,
            r.receipt_number,
            l.name AS lga_name
       FROM transactions t
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       LEFT JOIN revenue_categories rc ON rc.id = ri.category_id
       LEFT JOIN assessments a ON a.id = t.assessment_id
       LEFT JOIN receipts r ON r.transaction_id = t.id AND r.status <> 'VOID'
       LEFT JOIN lgas l ON l.id = t.lga_id
      WHERE t.taxpayer_id = $1
        AND t.status = ANY($5::text[])
        AND COALESCE(t.settled_at, t.verified_at, t.created_at) >= $2::date
        AND COALESCE(t.settled_at, t.verified_at, t.created_at) < ($3::date + INTERVAL '1 day')
      ORDER BY paid_at DESC
      LIMIT $4`,
    [...args, [...PAID_STATUSES, ...RETURNED_STATUSES]],
  );

  const summary = await queryOne<{
    payments: string;
    total_kobo: string;
    returned_kobo: string;
  }>(
    db,
    `SELECT count(*) FILTER (WHERE t.status = ANY($5::text[]))::text AS payments,
            COALESCE(SUM(t.total_amount_kobo) FILTER (WHERE t.status = ANY($5::text[])), 0)::text
              AS total_kobo,
            COALESCE(SUM(t.total_amount_kobo) FILTER (WHERE t.status = ANY($6::text[])), 0)::text
              AS returned_kobo
       FROM transactions t
      WHERE t.taxpayer_id = $1
        AND t.status = ANY($4::text[])
        AND COALESCE(t.settled_at, t.verified_at, t.created_at) >= $2::date
        AND COALESCE(t.settled_at, t.verified_at, t.created_at) < ($3::date + INTERVAL '1 day')`,
    [
      params.taxpayerId,
      params.from,
      params.to,
      [...PAID_STATUSES, ...RETURNED_STATUSES],
      [...PAID_STATUSES],
      [...RETURNED_STATUSES],
    ],
  );

  /*
   * "For what" as a total, not only as a list of lines.
   *
   * Somebody checking a year of market levy wants one figure for market levy,
   * not forty rows to add up on a phone. Returned money is excluded from these
   * totals: it is visible in the rows, and counting it as spending on a levy
   * would overstate what the trade actually cost.
   */
  const byItem = await query<{
    revenue_item: string;
    revenue_item_ha: string | null;
    payments: string;
    total_kobo: string;
  }>(
    db,
    `SELECT ri.name AS revenue_item,
            ri.name_ha AS revenue_item_ha,
            count(*)::text AS payments,
            SUM(t.total_amount_kobo)::text AS total_kobo
       FROM transactions t
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
      WHERE t.taxpayer_id = $1
        AND t.status = ANY($4::text[])
        AND COALESCE(t.settled_at, t.verified_at, t.created_at) >= $2::date
        AND COALESCE(t.settled_at, t.verified_at, t.created_at) < ($3::date + INTERVAL '1 day')
      GROUP BY ri.name, ri.name_ha
      ORDER BY SUM(t.total_amount_kobo) DESC`,
    [params.taxpayerId, params.from, params.to, [...PAID_STATUSES]],
  );

  return {
    from: params.from,
    to: params.to,
    summary: {
      payments: Number.parseInt(summary?.payments ?? '0', 10),
      totalKobo: summary?.total_kobo ?? '0',
      returnedKobo: summary?.returned_kobo ?? '0',
      byItem: byItem.map((row) => ({
        revenueItem: row.revenue_item,
        revenueItemHa: row.revenue_item_ha,
        payments: Number.parseInt(row.payments, 10),
        totalKobo: row.total_kobo,
      })),
    },
    rows: rows.map((row) => ({
      transactionReference: row.transaction_reference,
      paidAt: row.paid_at ? row.paid_at.toISOString() : null,
      revenueItem: row.revenue_item,
      revenueItemHa: row.revenue_item_ha,
      category: row.category,
      periodLabel: row.period_label,
      /*
       * A date, not a timestamp.
       *
       * `period_start` and `period_end` are DATE columns, and node-pg hands
       * them back as JS Dates, which serialise through JSON as
       * `2026-09-08T00:00:00.000Z`. A statement showing a midnight and a
       * timezone for the day somebody's cover began is stating a precision
       * the column does not have.
       */
      periodStart: asDate(row.period_start),
      periodEnd: asDate(row.period_end),
      amountKobo: row.amount_kobo,
      channel: row.channel,
      status: row.status,
      returned: (RETURNED_STATUSES as readonly string[]).includes(row.status),
      receiptNumber: row.receipt_number,
      lgaName: row.lga_name,
    })),
  };
}
