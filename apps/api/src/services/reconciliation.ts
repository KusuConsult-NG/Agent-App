/**
 * Revenue reconciliation (PRD §46, §47, §71).
 *
 * PRD §46 makes this a mandatory MVP feature. Three-way matching:
 *
 *   platform transaction  <->  gateway transaction  <->  government settlement
 *
 * Anything that does not match becomes an exception in a finance officer's
 * queue rather than being quietly written off. Reconciliation is also the last
 * safety net that catches money the gateway received but no webhook ever
 * reported — it verifies those payments and issues their receipts.
 */

import { randomUUID } from 'node:crypto';
import { parseKobo, type Kobo } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { gateway } from '../integrations/gateway';
import { conflict, notFound } from '../lib/errors';
import { nextRefundReference, nextSettlementReference } from '../lib/references';
import { recordAudit } from './audit';
import { confirmPayment } from './payments';
import { reverseCommissionForTransaction } from './commission';
import { transitionTransaction } from './revenue';

export interface ReconciliationSummary {
  runId: string;
  periodStart: Date;
  periodEnd: Date;
  matched: number;
  exceptions: number;
  recoveredPayments: number;
  totalPlatformKobo: string;
  totalGatewayKobo: string;
  byStatus: Record<string, number>;
}

/**
 * Run reconciliation for a period.
 *
 * Deliberately compares in both directions. Comparing only platform->gateway
 * would miss the most serious case: money the gateway holds for a transaction
 * the platform never recorded.
 */
export async function runReconciliation(params: {
  from: Date;
  to: Date;
  actorId: string;
  actorRole: string;
}): Promise<ReconciliationSummary> {
  const runId = randomUUID();
  const statement = await gateway.fetchStatement({ from: params.from, to: params.to });
  const byGatewayReference = new Map(statement.map((line) => [line.gatewayReference, line]));

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO reconciliation_runs (id, period_start, period_end, gateway, started_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [runId, params.from, params.to, gateway.name, params.actorId],
    );

    const payments = await query<{
      payment_id: string;
      transaction_id: string;
      gateway_reference: string | null;
      amount_kobo: string;
      payment_status: string;
      transaction_status: string;
      transaction_reference: string;
      settlement_id: string | null;
      settlement_reference: string | null;
    }>(
      client,
      `SELECT p.id AS payment_id, p.transaction_id, p.gateway_reference, p.amount_kobo,
              p.status AS payment_status, t.status AS transaction_status,
              t.transaction_reference, p.settlement_id, s.settlement_reference
         FROM payments p
         JOIN transactions t ON t.id = p.transaction_id
         LEFT JOIN settlements s ON s.id = p.settlement_id
        WHERE p.created_at >= $1 AND p.created_at <= $2`,
      [params.from, params.to],
    );

    const byStatus: Record<string, number> = {};
    const bump = (status: string) => {
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    };

    let matched = 0;
    let exceptions = 0;
    let recovered = 0;
    let totalPlatform = 0n;
    let totalGateway = 0n;

    const seenGatewayReferences = new Set<string>();

    for (const payment of payments) {
      const expected = parseKobo(payment.amount_kobo);
      const line = payment.gateway_reference
        ? byGatewayReference.get(payment.gateway_reference)
        : undefined;

      if (payment.gateway_reference) seenGatewayReferences.add(payment.gateway_reference);

      let status: string;
      let detail: Record<string, unknown> = {};
      let received = 0n;

      if (!line) {
        // The platform believes a payment exists that the gateway has no record
        // of. Only an exception if we thought it succeeded.
        if (['SUCCESSFUL', 'VERIFIED'].includes(payment.payment_status)) {
          status = 'MISSING_PAYMENT';
          detail = { note: 'Platform records a successful payment the gateway has no record of' };
        } else {
          status = 'PENDING';
          detail = { note: 'Payment never completed at the gateway' };
        }
      } else if (line.status !== 'SUCCESS') {
        if (['SUCCESSFUL', 'VERIFIED'].includes(payment.payment_status)) {
          status = line.status === 'REVERSED' ? 'REVERSED' : 'MISSING_PAYMENT';
          detail = { gatewayStatus: line.status };
        } else {
          status = 'PENDING';
          detail = { gatewayStatus: line.status };
        }
      } else {
        received = line.amountKobo;
        totalGateway += received;

        if (received !== expected) {
          status = 'AMOUNT_MISMATCH';
          detail = { expectedKobo: expected.toString(), gatewayKobo: received.toString() };
        } else if (payment.payment_status !== 'VERIFIED') {
          // The gateway took the money but the platform never verified it —
          // usually a lost webhook. Flagged for recovery, which verifies the
          // payment and issues the receipt the taxpayer is owed.
          status = 'MISSING_PLATFORM_TRANSACTION';
          detail = {
            recoverable: true,
            note: 'Gateway confirmed this payment but the platform has not verified it',
            platformPaymentStatus: payment.payment_status,
          };
        } else {
          // The third leg is the government's own settlement record, not the
          // gateway's word for it: money is only reconciled once government
          // can see it in its own account (PRD §46).
          status = payment.settlement_id ? 'MATCHED' : 'PENDING_SETTLEMENT';
          detail = {
            settlementReference: payment.settlement_reference,
            gatewaySettlementReference: line.settlementReference,
          };
        }
      }

      totalPlatform += ['SUCCESSFUL', 'VERIFIED'].includes(payment.payment_status) ? expected : 0n;

      await client.query(
        `INSERT INTO reconciliation_records
           (run_id, transaction_id, payment_id, gateway_reference, settlement_reference,
            expected_amount_kobo, received_amount_kobo, variance_kobo, status, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          runId,
          payment.transaction_id,
          payment.payment_id,
          payment.gateway_reference,
          line?.settlementReference ?? null,
          expected.toString(),
          received.toString(),
          (received - expected).toString(),
          status,
          JSON.stringify(detail),
        ],
      );

      bump(status);
      if (status === 'MATCHED') matched += 1;
      else if (['MISSING_PAYMENT', 'AMOUNT_MISMATCH', 'DUPLICATE_PAYMENT'].includes(status)) {
        exceptions += 1;
      }

      if (detail.recovered === true) recovered += 1;
    }

    // Gateway lines with no platform payment at all (PRD §46
    // "Missing platform transaction").
    for (const line of statement) {
      if (seenGatewayReferences.has(line.gatewayReference) || line.status !== 'SUCCESS') continue;

      await client.query(
        `INSERT INTO reconciliation_records
           (run_id, gateway_reference, settlement_reference, expected_amount_kobo,
            received_amount_kobo, variance_kobo, status, detail)
         VALUES ($1,$2,$3,0,$4,$4,'MISSING_PLATFORM_TRANSACTION',$5)`,
        [
          runId,
          line.gatewayReference,
          line.settlementReference,
          line.amountKobo.toString(),
          JSON.stringify({
            note: 'The gateway received money with no matching platform transaction',
          }),
        ],
      );
      bump('MISSING_PLATFORM_TRANSACTION');
      exceptions += 1;
      totalGateway += line.amountKobo;
    }

    await client.query(
      `UPDATE reconciliation_runs
          SET total_platform_kobo = $2, total_gateway_kobo = $3, matched_count = $4,
              exception_count = $5, status = 'COMPLETED', completed_at = now()
        WHERE id = $1`,
      [runId, totalPlatform.toString(), totalGateway.toString(), matched, exceptions],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'reconciliation.run',
      entityType: 'reconciliation_run',
      entityId: runId,
      newValue: {
        matched,
        exceptions,
        totalPlatformKobo: totalPlatform.toString(),
        totalGatewayKobo: totalGateway.toString(),
      },
    });

    return {
      runId,
      periodStart: params.from,
      periodEnd: params.to,
      matched,
      exceptions,
      recoveredPayments: recovered,
      totalPlatformKobo: totalPlatform.toString(),
      totalGatewayKobo: totalGateway.toString(),
      byStatus,
    };
  });
}

/**
 * Verify payments the gateway shows as successful but the platform never
 * confirmed — the missed-webhook recovery path (PRD §46, §66).
 */
export async function recoverUnverifiedPayments(params: {
  from: Date;
  to: Date;
  limit?: number;
}): Promise<{ attempted: number; verified: number; failures: string[] }> {
  const candidates = await query<{ id: string }>(
    // Uses the pool directly: each confirmation opens its own transaction.
    pool,
    `SELECT p.id
       FROM payments p
      WHERE p.status IN ('PENDING','SUCCESSFUL')
        AND p.gateway_reference IS NOT NULL
        AND p.created_at >= $1 AND p.created_at <= $2
      ORDER BY p.created_at
      LIMIT $3`,
    [params.from, params.to, params.limit ?? 200],
  );

  const failures: string[] = [];
  let verified = 0;

  for (const candidate of candidates) {
    try {
      const result = await confirmPayment({ paymentId: candidate.id, source: 'RECONCILIATION' });
      if (result.status === 'VERIFIED') verified += 1;
    } catch (error) {
      // A payment still pending at the gateway throws PAYMENT_UNCONFIRMED,
      // which is a normal outcome here rather than a failure.
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!message.includes('could not be confirmed yet')) {
        failures.push(`${candidate.id}: ${message}`);
      }
    }
  }

  return { attempted: candidates.length, verified, failures };
}

/** Record a government settlement and mark its transactions SETTLED (PRD §47). */
export async function recordSettlement(params: {
  settlementDate: Date;
  gatewayReferences: string[];
  receivedAmountKobo: Kobo;
  bankReference: string;
  governmentAccountId?: string | null;
  actorId: string;
  actorRole: string;
}): Promise<{ settlementId: string; settlementReference: string; transactionsSettled: number }> {
  return withTransaction(async (client) => {
    const settlementReference = await nextSettlementReference(client);

    const payments = await query<{ id: string; transaction_id: string; amount_kobo: string }>(
      client,
      `SELECT id, transaction_id, amount_kobo FROM payments
        WHERE gateway_reference = ANY($1::text[]) AND status = 'VERIFIED'`,
      [params.gatewayReferences],
    );

    const expected = payments.reduce((sum, row) => sum + parseKobo(row.amount_kobo), 0n);

    const settlement = await queryOne<{ id: string }>(
      client,
      `INSERT INTO settlements
         (settlement_reference, gateway, bank_reference, government_account_id, settlement_date,
          expected_amount_kobo, received_amount_kobo, transaction_count, status, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RECEIVED',now()) RETURNING id`,
      [
        settlementReference,
        gateway.name,
        params.bankReference,
        params.governmentAccountId ?? null,
        params.settlementDate,
        expected.toString(),
        params.receivedAmountKobo.toString(),
        payments.length,
      ],
    );

    for (const payment of payments) {
      await client.query('UPDATE payments SET settlement_id = $2 WHERE id = $1', [
        payment.id,
        settlement!.id,
      ]);
      const current = await queryOne<{ status: string }>(
        client,
        'SELECT status FROM transactions WHERE id = $1',
        [payment.transaction_id],
      );
      if (current && ['RECEIPT_GENERATED', 'RECONCILIATION_PENDING'].includes(current.status)) {
        await transitionTransaction(client, {
          transactionId: payment.transaction_id,
          to: 'SETTLED',
          reason: `Settled under ${settlementReference}`,
          actorId: params.actorId,
          source: 'RECONCILIATION',
          metadata: { settlementReference, bankReference: params.bankReference },
        });
      }
    }

    // A settlement that does not match what was expected is a dispute, not a
    // rounding note.
    if (params.receivedAmountKobo !== expected) {
      await client.query(`UPDATE settlements SET status = 'DISPUTED' WHERE id = $1`, [settlement!.id]);
      await client.query(
        `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, detail)
         VALUES ('SETTLEMENT_VARIANCE','HIGH','TRANSACTION',$1,$2)`,
        [
          settlement!.id,
          JSON.stringify({
            settlementReference,
            expectedKobo: expected.toString(),
            receivedKobo: params.receivedAmountKobo.toString(),
            varianceKobo: (params.receivedAmountKobo - expected).toString(),
          }),
        ],
      );
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'settlement.recorded',
      entityType: 'settlement',
      entityId: settlement!.id,
      newValue: {
        settlementReference,
        bankReference: params.bankReference,
        expectedKobo: expected.toString(),
        receivedKobo: params.receivedAmountKobo.toString(),
        transactions: payments.length,
      },
    });

    return {
      settlementId: settlement!.id,
      settlementReference,
      transactionsSettled: payments.length,
    };
  });
}

/** Finance officer exception queue (PRD §46). */
export async function exceptionQueue(db: Db, options: { status?: string; limit?: number } = {}) {
  return query(
    db,
    `SELECT r.id, r.run_id, r.status, r.expected_amount_kobo, r.received_amount_kobo,
            r.variance_kobo, r.gateway_reference, r.settlement_reference, r.detail, r.created_at,
            t.transaction_reference, t.status AS transaction_status,
            tp.first_name, tp.last_name, tp.business_name,
            ag.agent_code
       FROM reconciliation_records r
       LEFT JOIN transactions t ON t.id = r.transaction_id
       LEFT JOIN taxpayers tp ON tp.id = t.taxpayer_id
       LEFT JOIN agents ag ON ag.id = t.agent_id
      WHERE r.reconciled_at IS NULL
        AND ($1::text IS NULL OR r.status = $1)
        AND r.status IN ('MISSING_PAYMENT','MISSING_PLATFORM_TRANSACTION','AMOUNT_MISMATCH',
                         'DUPLICATE_PAYMENT','PENDING_SETTLEMENT')
      ORDER BY r.created_at DESC
      LIMIT $2`,
    [options.status ?? null, options.limit ?? 100],
  );
}

export async function resolveException(params: {
  recordId: string;
  resolution: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const record = await queryOne<{ id: string; status: string }>(
      client,
      'SELECT id, status FROM reconciliation_records WHERE id = $1',
      [params.recordId],
    );
    if (!record) throw notFound('That reconciliation record');

    await client.query(
      `UPDATE reconciliation_records
          SET status = 'RESOLVED', resolution_note = $2, reconciled_by = $3, reconciled_at = now()
        WHERE id = $1`,
      [params.recordId, params.resolution, params.actorId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'reconciliation.exception_resolved',
      entityType: 'reconciliation_record',
      entityId: params.recordId,
      oldValue: { status: record.status },
      newValue: { status: 'RESOLVED' },
      reason: params.resolution,
    });
  });
}

/**
 * Execute an approved reversal or refund (PRD §71).
 *
 * "A refund must automatically affect: Transaction status, Government
 * settlement, Agent commission, Financial reports." All four happen here, in
 * one transaction, and only against an approval that a different officer
 * granted.
 */
export async function executeReversal(params: {
  approvalId: string;
  actorId: string;
  actorRole: string;
}): Promise<{ refundReference: string; commissionReversed: number; clawbackKobo: string }> {
  return withTransaction(async (client) => {
    const approval = await queryOne<{
      id: string;
      status: string;
      entity_id: string;
      payload: { amountKobo?: string; reason?: string; refundType?: string };
      requested_by: string;
      approved_by: string | null;
    }>(
      client,
      `SELECT id, status, entity_id, payload, requested_by, approved_by
         FROM approvals
        WHERE id = $1 AND approval_type IN ('PAYMENT_REVERSAL','REFUND') FOR UPDATE`,
      [params.approvalId],
    );

    if (!approval) throw notFound('That approval');
    if (approval.status !== 'APPROVED') {
      throw conflict(
        'APPROVAL_NOT_GRANTED',
        `This reversal is ${approval.status.toLowerCase()} and cannot be executed.`,
      );
    }
    if (approval.approved_by === params.actorId) {
      throw conflict(
        'SEGREGATION_OF_DUTIES',
        'The officer who approved a reversal may not also execute it.',
      );
    }

    const transactionId = approval.entity_id;
    const transaction = await queryOne<{
      id: string;
      status: string;
      amount_kobo: string;
      transaction_reference: string;
    }>(
      client,
      'SELECT id, status, amount_kobo, transaction_reference FROM transactions WHERE id = $1',
      [transactionId],
    );
    if (!transaction) throw notFound('That transaction');

    const payment = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM payments WHERE transaction_id = $1 AND status = 'VERIFIED'`,
      [transactionId],
    );
    if (!payment) {
      throw conflict(
        'NO_VERIFIED_PAYMENT',
        'There is no verified payment on this transaction to reverse.',
      );
    }

    const refundReference = await nextRefundReference(client);
    const amount = parseKobo(approval.payload.amountKobo ?? transaction.amount_kobo);

    await client.query(
      `INSERT INTO refunds
         (refund_reference, transaction_id, payment_id, amount_kobo, refund_type, reason,
          approval_id, requested_by, approved_by, approved_at, status, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'COMPLETED',now())`,
      [
        refundReference,
        transactionId,
        payment.id,
        amount.toString(),
        approval.payload.refundType ?? 'REVERSAL',
        approval.payload.reason ?? 'Approved reversal',
        approval.id,
        approval.requested_by,
        approval.approved_by,
      ],
    );

    await client.query(
      `UPDATE payments SET status = 'REVERSED', reversed_at = now() WHERE id = $1`,
      [payment.id],
    );

    await transitionTransaction(client, {
      transactionId,
      to: approval.payload.refundType === 'FULL' ? 'REFUNDED' : 'REVERSED',
      reason: approval.payload.reason ?? 'Approved reversal',
      actorId: params.actorId,
      source: 'OFFICER',
      metadata: { refundReference, approvalId: approval.id },
    });

    // The receipt stays in existence — it is evidence that a payment was once
    // made — but is marked so public verification reports it as reversed.
    await client.query(
      `UPDATE receipts SET status = 'REVERSED', void_reason = $2, voided_at = now(), voided_by = $3
        WHERE transaction_id = $1`,
      [transactionId, approval.payload.reason ?? 'Payment reversed', params.actorId],
    );

    await client.query(
      `UPDATE invoices i
          SET amount_paid_kobo = 0, status = 'UNPAID'
         FROM transactions t
        WHERE t.id = $1 AND i.id = t.invoice_id`,
      [transactionId],
    );

    const commission = await reverseCommissionForTransaction(client, {
      transactionId,
      reason: `Transaction reversed under ${refundReference}`,
      actorId: params.actorId,
    });

    await client.query(`UPDATE approvals SET status = 'EXECUTED', executed_at = now() WHERE id = $1`, [
      approval.id,
    ]);

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'transaction.reversed',
      entityType: 'transaction',
      entityId: transactionId,
      oldValue: { status: transaction.status },
      newValue: {
        status: 'REVERSED',
        refundReference,
        amountKobo: amount.toString(),
        commissionsReversed: commission.reversed,
        commissionClawbackKobo: commission.clawbackKobo.toString(),
      },
      reason: approval.payload.reason ?? null,
    });

    return {
      refundReference,
      commissionReversed: commission.reversed,
      clawbackKobo: commission.clawbackKobo.toString(),
    };
  });
}

/** Settlement dashboard (PRD §47). */
export async function settlementDashboard(db: Db) {
  const [totals, recent, pendingByAge] = await Promise.all([
    queryOne(
      db,
      `SELECT
         COALESCE(SUM(expected_amount_kobo),0)::text AS total_expected_kobo,
         COALESCE(SUM(received_amount_kobo),0)::text AS total_received_kobo,
         COALESCE(SUM(expected_amount_kobo - received_amount_kobo),0)::text AS total_variance_kobo,
         count(*) FILTER (WHERE status = 'PENDING')::text AS pending_count,
         count(*) FILTER (WHERE status = 'RECONCILED')::text AS reconciled_count,
         count(*) FILTER (WHERE status = 'DISPUTED')::text AS disputed_count
       FROM settlements`,
    ),
    query(
      db,
      `SELECT settlement_reference, gateway, bank_reference, settlement_date,
              expected_amount_kobo, received_amount_kobo,
              (received_amount_kobo - expected_amount_kobo)::text AS variance_kobo,
              transaction_count, status, received_at
         FROM settlements ORDER BY settlement_date DESC LIMIT 30`,
    ),
    queryOne(
      db,
      `SELECT count(*)::text AS count, COALESCE(SUM(amount_kobo),0)::text AS amount_kobo
         FROM transactions
        WHERE status = 'RECONCILIATION_PENDING'`,
    ),
  ]);

  return { totals, recentSettlements: recent, awaitingSettlement: pendingByAge };
}
