/**
 * Closing a month, so the figure PSIRS reported cannot move afterwards.
 *
 * A settled month was still writable. Everything the Service reported to the
 * Accountant-General for March could be changed in April by a reversal, a
 * backdated settlement or a commission adjustment, and nothing anywhere said it
 * had happened after the books were reported.
 *
 * The readiness assessment calls this a control rather than a feature, and that
 * is the right word: what was missing is not a screen, it is a guarantee.
 *
 * WHERE THE GUARANTEE LIVES
 *
 * In the database, not here. Migration 058 puts a BEFORE trigger on the four
 * tables that decide what a month collected, and this module opens and closes
 * periods and explains the refusals. A period lock enforced in TypeScript is a
 * lock a compromised service account, a future endpoint or a psql prompt walks
 * straight through — and the entire value of a closed month is that nobody can.
 *
 * WHAT CLOSING STORES
 *
 * The figures as they stood at the moment of closing, rather than a promise to
 * recompute them later. The point of a closed month is to have a number that
 * cannot move, and a number you recompute is a number that can.
 */

import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound } from '../lib/errors';
import { recordAudit } from './audit';

/** Revenue is recognised only after independent verification (PRD §17, §95). */
const REVENUE_STATES = `('PAYMENT_VERIFIED','RECEIPT_GENERATED','RECONCILIATION_PENDING','SETTLED')`;

export type PeriodStatus = 'OPEN' | 'CLOSING' | 'CLOSED';

export interface Actor {
  userId: string;
  role: string;
}

/**
 * The label for a calendar month, derived once and stored.
 *
 * Stored rather than recomputed so a period can be quoted in a report without
 * every caller re-deriving it and one of them getting it wrong.
 */
export function monthLabel(start: Date): string {
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function listPeriods(db: Db, params: { limit?: number } = {}) {
  return query(
    db,
    `SELECT p.id, p.label, p.period_start, p.period_end, p.status,
            p.closed_at, p.closing_note, p.reopened_at, p.reopen_reason,
            p.collected_kobo::text, p.settled_kobo::text, p.commission_kobo::text,
            p.transaction_count,
            closer.full_name AS closed_by_name,
            reopener.full_name AS reopened_by_name
       FROM financial_periods p
       LEFT JOIN users closer ON closer.id = p.closed_by
       LEFT JOIN users reopener ON reopener.id = p.reopened_by
      ORDER BY p.period_start DESC
      LIMIT $1`,
    [params.limit ?? 36],
  );
}

/**
 * What a period holds right now, so an officer can see it before closing it.
 *
 * Deliberately the same query the close writes down, so the preview and the
 * stored figure cannot disagree — which they would if closing recomputed with
 * slightly different predicates, and nobody would notice until an auditor
 * compared the two.
 */
export async function periodFigures(
  db: Db,
  periodStart: Date,
  periodEnd: Date,
): Promise<{
  collected_kobo: string;
  settled_kobo: string;
  commission_kobo: string;
  transaction_count: string;
  unreconciled: string;
  pending_payments: string;
}> {
  const row = await queryOne<{
    collected_kobo: string;
    settled_kobo: string;
    commission_kobo: string;
    transaction_count: string;
    unreconciled: string;
    pending_payments: string;
  }>(
    db,
    `SELECT
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM transactions
         WHERE status IN ${REVENUE_STATES}
           AND created_at::date BETWEEN $1 AND $2) AS collected_kobo,
       (SELECT COALESCE(SUM(received_amount_kobo),0)::text FROM settlements
         WHERE settlement_date BETWEEN $1 AND $2) AS settled_kobo,
       (SELECT COALESCE(SUM(amount_kobo),0)::text FROM commissions
         WHERE created_at::date BETWEEN $1 AND $2 AND status <> 'REVERSED')
         AS commission_kobo,
       (SELECT count(*)::text FROM transactions
         WHERE status IN ${REVENUE_STATES}
           AND created_at::date BETWEEN $1 AND $2) AS transaction_count,
       /*
        * The two figures that say whether the month is ready to close.
        *
        * An unresolved exception is money the platform and the bank disagree
        * about; a pending payment is money that has not landed either way.
        * Closing over either freezes a figure that is known to be wrong, so
        * the close refuses unless the officer says in writing why they are
        * doing it anyway.
        */
       (SELECT count(*)::text FROM reconciliation_records rr
         LEFT JOIN transactions t ON t.id = rr.transaction_id
        WHERE rr.reconciled_at IS NULL
          AND rr.status IN ('MISSING_PAYMENT','MISSING_PLATFORM_TRANSACTION',
                            'AMOUNT_MISMATCH','DUPLICATE_PAYMENT')
          AND t.created_at::date BETWEEN $1 AND $2) AS unreconciled,
       (SELECT count(*)::text FROM payments
         WHERE status IN ('INITIATED','PENDING')
           AND initiated_at::date BETWEEN $1 AND $2) AS pending_payments`,
    [periodStart, periodEnd],
  );
  return row!;
}

export async function openPeriod(
  actor: Actor,
  input: { periodStart: Date; periodEnd: Date; label?: string },
): Promise<{ id: string; label: string }> {
  if (input.periodEnd < input.periodStart) {
    throw badRequest('A period cannot end before it starts.');
  }
  const label = input.label?.trim() || monthLabel(input.periodStart);

  return withTransaction(async (client) => {
    /*
     * The overlap is refused by the database; this is so the officer gets a
     * sentence rather than an exclusion-constraint name.
     */
    const clash = await queryOne<{ label: string }>(
      client,
      `SELECT label FROM financial_periods
        WHERE daterange(period_start, period_end, '[]')
              && daterange($1::date, $2::date, '[]')
        LIMIT 1`,
      [input.periodStart, input.periodEnd],
    );
    if (clash) {
      throw conflict(
        'PERIOD_OVERLAPS',
        `Those dates overlap ${clash.label}.`,
        'Periods cannot overlap, because a write on a shared day would be both refused and allowed.',
      );
    }

    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO financial_periods (label, period_start, period_end)
       VALUES ($1,$2,$3) RETURNING id`,
      [label, input.periodStart, input.periodEnd],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'period.open',
      entityType: 'financial_period',
      entityId: row!.id,
      newValue: { label, periodStart: iso(input.periodStart), periodEnd: iso(input.periodEnd) },
    });
    return { id: row!.id, label };
  });
}

/**
 * Close a period, freezing what it collected.
 *
 * Refuses over an unreconciled exception or a pending payment unless the
 * officer supplies an override reason — because closing over either freezes a
 * figure already known to be wrong, and the point of a closed month is a figure
 * somebody stands behind.
 */
export async function closePeriod(
  actor: Actor,
  periodId: string,
  input: { note: string; overrideReason?: string },
): Promise<{ label: string; collectedKobo: string; overridden: boolean }> {
  return withTransaction(async (client) => {
    const period = await queryOne<{
      id: string;
      label: string;
      period_start: Date;
      period_end: Date;
      status: string;
    }>(
      client,
      `SELECT id, label, period_start, period_end, status
         FROM financial_periods WHERE id = $1 FOR UPDATE`,
      [periodId],
    );
    if (!period) throw notFound('That period');
    if (period.status === 'CLOSED') {
      throw conflict('PERIOD_CLOSED', `${period.label} is already closed.`);
    }

    const figures = await periodFigures(client, period.period_start, period.period_end);
    const outstanding = Number(figures.unreconciled) + Number(figures.pending_payments);
    if (outstanding > 0 && !input.overrideReason?.trim()) {
      throw conflict(
        'PERIOD_NOT_SETTLED',
        `${period.label} has ${figures.unreconciled} unresolved exception(s) and ` +
          `${figures.pending_payments} payment(s) still pending.`,
        'Resolve them, or say in writing why the month is being closed over them.',
      );
    }

    await client.query(
      `UPDATE financial_periods
          SET status = 'CLOSED', closed_at = now(), closed_by = $2, closing_note = $3,
              collected_kobo = $4, settled_kobo = $5, commission_kobo = $6,
              transaction_count = $7, updated_at = now()
        WHERE id = $1`,
      [
        periodId,
        actor.userId,
        input.overrideReason?.trim()
          ? `${input.note.trim()} — closed over ${outstanding} outstanding item(s): ${input.overrideReason.trim()}`
          : input.note.trim(),
        figures.collected_kobo,
        figures.settled_kobo,
        figures.commission_kobo,
        figures.transaction_count,
      ],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'period.close',
      entityType: 'financial_period',
      entityId: periodId,
      oldValue: { status: period.status },
      newValue: {
        status: 'CLOSED',
        collectedKobo: figures.collected_kobo,
        settledKobo: figures.settled_kobo,
        commissionKobo: figures.commission_kobo,
        unreconciledAtClose: figures.unreconciled,
        pendingAtClose: figures.pending_payments,
      },
      reason: input.overrideReason?.trim() || input.note.trim(),
    });

    return {
      label: period.label,
      collectedKobo: figures.collected_kobo,
      overridden: outstanding > 0,
    };
  });
}

/**
 * Reopen a closed period.
 *
 * Because a genuine error found in June has to be correctable in the March
 * books rather than smuggled into June's. Separate authority, a reason
 * required, and recorded — so "March was reopened on the 9th of June by Bala,
 * because the Kanam settlement was misposted" is a sentence the platform can
 * produce.
 */
export async function reopenPeriod(
  actor: Actor,
  periodId: string,
  reason: string,
): Promise<{ label: string }> {
  return withTransaction(async (client) => {
    const period = await queryOne<{ id: string; label: string; status: string }>(
      client,
      'SELECT id, label, status FROM financial_periods WHERE id = $1 FOR UPDATE',
      [periodId],
    );
    if (!period) throw notFound('That period');
    if (period.status === 'OPEN') {
      throw conflict('PERIOD_OPEN', `${period.label} is already open.`);
    }

    await client.query(
      `UPDATE financial_periods
          SET status = 'OPEN', reopened_at = now(), reopened_by = $2,
              reopen_reason = $3, updated_at = now()
        WHERE id = $1`,
      [periodId, actor.userId, reason.trim()],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'period.reopen',
      entityType: 'financial_period',
      entityId: periodId,
      oldValue: { status: period.status },
      newValue: { status: 'OPEN' },
      reason: reason.trim(),
    });

    return { label: period.label };
  });
}

/** Mark a period as being closed: it stops taking entries while work finishes. */
export async function beginClosing(
  actor: Actor,
  periodId: string,
): Promise<{ label: string }> {
  return withTransaction(async (client) => {
    const period = await queryOne<{ label: string; status: string }>(
      client,
      'SELECT label, status FROM financial_periods WHERE id = $1 FOR UPDATE',
      [periodId],
    );
    if (!period) throw notFound('That period');
    if (period.status !== 'OPEN') {
      throw conflict('PERIOD_NOT_OPEN', `${period.label} is ${period.status.toLowerCase()}.`);
    }

    await client.query(
      `UPDATE financial_periods SET status = 'CLOSING', updated_at = now() WHERE id = $1`,
      [periodId],
    );
    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'period.begin_closing',
      entityType: 'financial_period',
      entityId: periodId,
      oldValue: { status: 'OPEN' },
      newValue: { status: 'CLOSING' },
    });
    return { label: period.label };
  });
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
