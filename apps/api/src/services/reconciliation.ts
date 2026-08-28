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
import type { PoolClient } from 'pg';
import { issueReceipt } from './receipts';
import { parseKobo, type Kobo } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { gateway } from '../integrations/gateway';
import { conflict, forbidden, notFound } from '../lib/errors';
import { nextRefundReference, nextSettlementReference } from '../lib/references';
import { recordAudit } from './audit';
import { confirmPayment, issueRenewalsFor } from './payments';
import { reverseCommissionForTransaction } from './commission';
import { transitionTransaction } from './revenue';
import { queueNotification } from './notifications';
import { raiseFlag } from './fraud';
import { log } from '../lib/logger';

export interface ReconciliationSummary {
  runId: string;
  periodStart: Date;
  periodEnd: Date;
  /**
   * ABORTED means the gateway's statement could not be retrieved and nothing
   * was compared. Callers must not read `exceptions: 0` on an aborted run as
   * a clean bill of health — nothing was checked.
   */
  status: 'COMPLETED' | 'ABORTED';
  matched: number;
  exceptions: number;
  /** References the gateway could not be asked about. Not exceptions. */
  unchecked: number;
  totalPlatformKobo: string;
  totalGatewayKobo: string;
  byStatus: Record<string, number>;
  /** How the gateway's account was obtained, for the audit trail. */
  statementSource: string;
  statementLines: number;
  abortReason?: string;
}

/**
 * Run reconciliation for a period.
 *
 * Deliberately compares in both directions. Comparing only platform->gateway
 * would miss the most serious case: money the gateway holds for a transaction
 * the platform never recorded.
 *
 * The run refuses to proceed without the gateway's account of the period, and
 * that refusal is the most important line in this file. The matching loop
 * treats a payment absent from the statement as money the gateway has no
 * record of, so an empty statement caused by an outage does not produce a
 * quiet no-op — it produces a MISSING_PAYMENT exception against every
 * successful payment in the window. An exception queue that is wrong about
 * everything is worse than none, because it teaches the finance officer that
 * the queue is noise.
 */
export async function runReconciliation(params: {
  from: Date;
  to: Date;
  actorId: string | null;
  actorRole: string;
}): Promise<ReconciliationSummary> {
  const runId = randomUUID();

  // The references the platform issued in this window. A gateway without a
  // bulk statement endpoint answers by being asked about each one, so it needs
  // the list; a gateway with one ignores it.
  const issued = await query<{ gateway_reference: string }>(
    pool,
    `SELECT DISTINCT gateway_reference FROM payments
      WHERE created_at >= $1 AND created_at <= $2 AND gateway_reference IS NOT NULL`,
    [params.from, params.to],
  );

  const statement = await gateway.fetchStatement({
    from: params.from,
    to: params.to,
    references: issued.map((row) => row.gateway_reference),
  });

  if (statement.outcome === 'UNAVAILABLE') {
    const reason =
      statement.reason ?? `${gateway.name} did not return a statement for this period.`;

    // Recorded rather than merely thrown. An attempt that could not be made is
    // an operational fact a finance officer needs to see, and a run row that
    // says so is how they find out reconciliation has been blind since Tuesday.
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO reconciliation_runs
           (id, period_start, period_end, gateway, started_by, status,
            statement_source, abort_reason, completed_at)
         VALUES ($1,$2,$3,$4,$5,'ABORTED',$6,$7,now())`,
        [runId, params.from, params.to, gateway.name, params.actorId, statement.source, reason],
      );

      await recordAudit(client, {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: 'reconciliation.aborted',
        entityType: 'reconciliation_run',
        entityId: runId,
        newValue: { reason, gateway: gateway.name },
      });
    });

    return {
      runId,
      periodStart: params.from,
      periodEnd: params.to,
      status: 'ABORTED',
      matched: 0,
      exceptions: 0,
      unchecked: issued.length,
      totalPlatformKobo: '0',
      totalGatewayKobo: '0',
      byStatus: {},
      statementSource: statement.source,
      statementLines: 0,
      abortReason: reason,
    };
  }

  const byGatewayReference = new Map(statement.lines.map((line) => [line.gatewayReference, line]));
  const uncheckedReferences = new Set(statement.unavailableReferences);

  // Keep the gateway's own words. PRD §46 wants a dispute re-argued from the
  // source rather than from this platform's reading of it, which is what the
  // table was built for and what nothing had ever written to it.
  for (const line of statement.lines) {
    await pool.query(
      `INSERT INTO gateway_statement_lines
         (gateway, gateway_reference, amount_kobo, status, paid_at, settlement_reference,
          raw_line, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (gateway, gateway_reference) DO UPDATE
         SET amount_kobo = EXCLUDED.amount_kobo,
             status = EXCLUDED.status,
             paid_at = EXCLUDED.paid_at,
             settlement_reference = EXCLUDED.settlement_reference,
             raw_line = EXCLUDED.raw_line,
             imported_at = now()`,
      [
        gateway.name,
        line.gatewayReference,
        line.amountKobo.toString(),
        line.status,
        line.paidAt,
        line.settlementReference,
        JSON.stringify(line.raw ?? {}),
        params.actorId,
      ],
    );
  }

  /*
   * A run that could not finish says so, in the table runs are read from.
   *
   * The run row is written inside the same transaction as the matching, which
   * is right — a half-matched period must not be left looking reconciled. But
   * it meant that a run which threw part way rolled its own row back with
   * everything else, so a crashed run left no trace at all: the officer saw no
   * run for the period, which reads exactly like nobody having started one.
   * That is the same blindness `ABORTED` exists to prevent, and ABORTED was
   * only ever reached when the gateway declined to send a statement.
   *
   * So the failure is recorded afterwards, in a transaction of its own, and
   * the error goes on to the caller unchanged.
   */
  try {
    return await runMatching();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Reconciliation failed';
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO reconciliation_runs
           (id, period_start, period_end, gateway, started_by, status,
            statement_source, statement_line_count, abort_reason, completed_at)
         VALUES ($1,$2,$3,$4,$5,'FAILED',$6,$7,$8,now())`,
        [
          runId,
          params.from,
          params.to,
          gateway.name,
          params.actorId,
          statement.source,
          statement.lines.length,
          reason,
        ],
      );
      await recordAudit(client, {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: 'reconciliation.failed',
        entityType: 'reconciliation_run',
        entityId: runId,
        newValue: { reason, gateway: gateway.name },
      });
    }).catch((recordingError) =>
      // The original failure is what the caller needs; losing it behind a
      // second one would be the worse trade. Logged so a run that could not
      // even record its own failure is still visible somewhere.
      log.error('reconciliation failure could not be recorded', {
        component: 'reconciliation',
        runId,
        reason,
        recordingError: String(recordingError),
      }),
    );
    throw error;
  }

  async function runMatching(): Promise<ReconciliationSummary> {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO reconciliation_runs
         (id, period_start, period_end, gateway, started_by, statement_source, statement_line_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        runId,
        params.from,
        params.to,
        gateway.name,
        params.actorId,
        statement.source,
        statement.lines.length,
      ],
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
    let unchecked = 0;
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

      if (payment.gateway_reference && uncheckedReferences.has(payment.gateway_reference)) {
        // The gateway was not reachable for this particular reference. Falling
        // through to the branch below would read that silence as "the gateway
        // has no record of this payment", which is an accusation built out of
        // our own failure to ask.
        status = 'UNCHECKED';
        detail = {
          note: 'The gateway could not be asked about this reference on this run',
          platformPaymentStatus: payment.payment_status,
        };
      } else if (!line) {
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
      else if (status === 'UNCHECKED') unchecked += 1;
      else if (['MISSING_PAYMENT', 'AMOUNT_MISMATCH', 'DUPLICATE_PAYMENT'].includes(status)) {
        exceptions += 1;
      }
    }

    // Gateway lines with no platform payment at all (PRD §46
    // "Missing platform transaction").
    for (const line of statement.lines) {
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
              exception_count = $5, unchecked_count = $6,
              status = 'COMPLETED', completed_at = now()
        WHERE id = $1`,
      [
        runId,
        totalPlatform.toString(),
        totalGateway.toString(),
        matched,
        exceptions,
        unchecked,
      ],
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
        unchecked,
        statementSource: statement.source,
        statementLines: statement.lines.length,
        totalPlatformKobo: totalPlatform.toString(),
        totalGatewayKobo: totalGateway.toString(),
      },
    });

    return {
      runId,
      periodStart: params.from,
      periodEnd: params.to,
      status: 'COMPLETED' as const,
      matched,
      exceptions,
      unchecked,
      totalPlatformKobo: totalPlatform.toString(),
      totalGatewayKobo: totalGateway.toString(),
      byStatus,
      statementSource: statement.source,
      statementLines: statement.lines.length,
    };
  });
  }
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

/**
 * Move the collections a settlement paid for to SETTLED.
 *
 * Shared by the two moments a settlement can be complete: recorded with the
 * figures already matching, and disputed and later accounted for. Both must
 * settle the same collections in the same way, or the second route becomes a
 * quieter version of the first.
 *
 * Only a collection in RECEIPT_GENERATED or RECONCILIATION_PENDING moves. One
 * that has been reversed, refunded or put under review since the credit landed
 * is not settled by this batch arriving, and stepping over it here is what
 * keeps the two paths from disagreeing about which states are settleable.
 */
async function settleLinkedTransactions(
  client: PoolClient,
  params: {
    settlementId: string;
    settlementReference: string;
    bankReference: string | null;
    actorId: string;
  },
): Promise<string[]> {
  const linked = await query<{ transaction_id: string; payment_id: string; status: string }>(
    client,
    `SELECT DISTINCT ON (p.transaction_id) p.transaction_id, p.id AS payment_id, t.status
       FROM payments p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.settlement_id = $1
      ORDER BY p.transaction_id, p.verified_at DESC NULLS LAST`,
    [params.settlementId],
  );

  const settled: string[] = [];
  for (const row of linked) {
    if (!['RECEIPT_GENERATED', 'RECONCILIATION_PENDING'].includes(row.status)) continue;

    /*
     * This is the moment the receipt is earned.
     *
     * A receipt says the Plateau State Government received the money, and this
     * is the first point at which that is true: a bank credit covering this
     * collection has been reconciled, and a settlement whose credit does not
     * match the collections it covers settles none of them. Until now the
     * taxpayer has held an acknowledgement saying the gateway confirmed the
     * payment and the State had not yet received it.
     *
     * The database refuses a receipt for a payment with no `settlement_id`, so
     * the ordering here is not merely conventional — issuing before the payment
     * row carries its settlement would be rejected by the trigger.
     */
    if (row.status === 'RECONCILIATION_PENDING') {
      const receipt = await issueReceipt(client, {
        transactionId: row.transaction_id,
        paymentId: row.payment_id,
        actorId: params.actorId,
      });
      await transitionTransaction(client, {
        transactionId: row.transaction_id,
        to: 'RECEIPT_GENERATED',
        reason: `Money received under ${params.settlementReference}`,
        actorId: params.actorId,
        source: 'RECONCILIATION',
        metadata: { receiptNumber: receipt.receiptNumber },
      });

      /*
       * And tell the taxpayer, which nothing did.
       *
       * A citizen holds no account, so the message they were sent at
       * confirmation is their only copy of the transaction — and it names an
       * acknowledgement. Issuing the receipt silently left them holding a
       * document that is not one, with no way to learn the number of the
       * receipt they are actually entitled to.
       */
      const detail = await queryOne<{
        taxpayer_id: string;
        transaction_reference: string;
        amount_kobo: string;
      }>(
        client,
        `SELECT taxpayer_id, transaction_reference, amount_kobo
           FROM transactions WHERE id = $1`,
        [row.transaction_id],
      );
      if (detail) {
        await queueNotification(client, {
          event: 'RECEIPT_GENERATED',
          taxpayerId: detail.taxpayer_id,
          entityType: 'transaction',
          entityId: row.transaction_id,
          variables: {
            amount: detail.amount_kobo,
            reference: detail.transaction_reference,
            receiptNumber: receipt.receiptNumber,
          },
        });
      }
    }

    await transitionTransaction(client, {
      transactionId: row.transaction_id,
      to: 'SETTLED',
      reason: `Settled under ${params.settlementReference}`,
      actorId: params.actorId,
      source: 'RECONCILIATION',
      metadata: {
        settlementReference: params.settlementReference,
        bankReference: params.bankReference,
      },
    });
    settled.push(row.transaction_id);
  }
  return settled;
}

/**
 * Record a government settlement, and settle what it actually paid for
 * (PRD §47).
 *
 * SETTLED is the state the commission ledger waits for: an agent is paid for
 * work that settled and for no other work. This marked the whole batch SETTLED
 * first and compared the figures afterwards, so a gateway that paid ₦900,000
 * against ₦1,000,000 of confirmed collections left every transaction recorded
 * as settled and every commission on them payable. The variance was noticed —
 * a HIGH flag was raised beside it — but the flag carried neither an agent nor
 * a transaction, which are the two columns the commission guard reads, so it
 * held nothing back.
 *
 * That is the third inviolable rule read backwards. "No verified transaction,
 * no commission" exists so the State does not pay for money it did not
 * receive, and a batch that came up short is money the State did not receive.
 *
 * So a settlement that does not match settles nothing. It is recorded and
 * disputed, the collections in it stay where they are, and `reconcileSettlement`
 * is where a dispute goes once somebody has found the rest of the money.
 */
/**
 * Issue what a settlement paid for, once the settlement itself has committed.
 *
 * Vehicle particulars are announced to the vehicle authority over the network,
 * and a settlement must not hold a database transaction open across somebody
 * else's network. Wrapping it here rather than in each route means every caller
 * — the officer's screen, the scheduled sweep, a test — gets the same
 * behaviour without having to remember it, which is the mistake that left a
 * webhook-confirmed renewal unissued before.
 */
async function issueWhatWasBought(
  settledTransactionIds: string[],
  actorId: string,
  actorRole: string,
): Promise<void> {
  if (settledTransactionIds.length === 0) return;
  await issueRenewalsFor(settledTransactionIds, { actorId, actorRole });
}

export async function recordSettlement(params: {
  settlementDate: Date;
  gatewayReferences: string[];
  receivedAmountKobo: Kobo;
  bankReference: string;
  governmentAccountId?: string | null;
  actorId: string;
  actorRole: string;
}): Promise<{
  settlementId: string;
  settlementReference: string;
  status: 'RECONCILED' | 'DISPUTED';
  transactionsSettled: number;
  /** Ids of the transactions this settlement paid for, so the caller can issue
   * what they bought once this database transaction has committed. */
  settledTransactionIds: string[];
  varianceKobo: string;
}> {
  const outcome = await withTransaction(async (client) => {
    const settlementReference = await nextSettlementReference(client);

    /*
     * A collection settles once.
     *
     * `payments.settlement_id` records which batch banked a collection, and
     * nothing checked it: naming the same gateway references in a second
     * settlement re-counted every one of them, overwrote the link to the first
     * batch, and left the State's books showing the same money banked twice.
     * The second reference is usually a typo or a re-run of the same import,
     * and either way the answer is to refuse it and say which batch already
     * holds it.
     */
    const alreadySettled = await queryOne<{ gateway_reference: string; settlement_reference: string }>(
      client,
      `SELECT p.gateway_reference, s.settlement_reference
         FROM payments p JOIN settlements s ON s.id = p.settlement_id
        WHERE p.gateway_reference = ANY($1::text[])
        ORDER BY p.gateway_reference LIMIT 1`,
      [params.gatewayReferences],
    );
    if (alreadySettled) {
      throw conflict(
        'PAYMENT_ALREADY_SETTLED',
        `Payment ${alreadySettled.gateway_reference} was already banked under settlement ` +
          `${alreadySettled.settlement_reference}. Recording it again would count the same money twice.`,
        'Check the bank statement against that settlement, and record only the collections it does not cover.',
      );
    }

    const payments = await query<{ id: string; transaction_id: string; amount_kobo: string }>(
      client,
      `SELECT id, transaction_id, amount_kobo FROM payments
        WHERE gateway_reference = ANY($1::text[]) AND status = 'VERIFIED'`,
      [params.gatewayReferences],
    );

    const expected = payments.reduce((sum, row) => sum + parseKobo(row.amount_kobo), 0n);
    const matched = params.receivedAmountKobo === expected;

    const settlement = await queryOne<{ id: string }>(
      client,
      `INSERT INTO settlements
         (settlement_reference, gateway, bank_reference, government_account_id, settlement_date,
          expected_amount_kobo, received_amount_kobo, transaction_count, status, received_at,
          reconciled_at, reconciled_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11) RETURNING id`,
      [
        settlementReference,
        gateway.name,
        params.bankReference,
        params.governmentAccountId ?? null,
        params.settlementDate,
        expected.toString(),
        params.receivedAmountKobo.toString(),
        payments.length,
        matched ? 'RECONCILED' : 'DISPUTED',
        matched ? new Date() : null,
        matched ? params.actorId : null,
      ],
    );

    // The batch is linked whether or not it matched: which collections this
    // credit was meant to cover is exactly what an officer needs in order to
    // work out where the rest of it went.
    for (const payment of payments) {
      await client.query('UPDATE payments SET settlement_id = $2 WHERE id = $1', [
        payment.id,
        settlement!.id,
      ]);
    }

    let settledTransactionIds: string[] = [];
    if (matched) {
      settledTransactionIds = await settleLinkedTransactions(client, {
        settlementId: settlement!.id,
        settlementReference,
        bankReference: params.bankReference,
        actorId: params.actorId,
      });
    } else {
      // A settlement that does not match what was expected is a dispute, not a
      // rounding note — and a dispute settles nothing.
      await raiseFlag(client, {
        rule: 'SETTLEMENT_VARIANCE',
        severity: 'HIGH',
        entityType: 'SETTLEMENT',
        entityId: settlement!.id,
        detail: {
          settlementReference,
          expectedKobo: expected.toString(),
          receivedKobo: params.receivedAmountKobo.toString(),
          varianceKobo: (params.receivedAmountKobo - expected).toString(),
        },
      });
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
        status: matched ? 'RECONCILED' : 'DISPUTED',
      },
    });

    return {
      settlementId: settlement!.id,
      settlementReference,
      status: matched ? ('RECONCILED' as const) : ('DISPUTED' as const),
      transactionsSettled: settledTransactionIds.length,
      settledTransactionIds,
      varianceKobo: (params.receivedAmountKobo - expected).toString(),
    };
  });

  await issueWhatWasBought(outcome.settledTransactionIds, params.actorId, params.actorRole);
  return outcome;
}

/**
 * Close a disputed settlement once the money is accounted for.
 *
 * `settlements.status` offered RECONCILED and `reconciled_at`/`reconciled_by`
 * sat beside it, and nothing in the platform wrote any of the three. The
 * settlement dashboard counted PENDING, RECONCILED and DISPUTED — two states
 * nothing produced and one it did — so every clean settlement showed as
 * nothing at all, and the finance officer's home screen, which counts
 * `reconciled_at IS NULL`, reported every settlement ever recorded as
 * outstanding. A dispute had nowhere to go: DISPUTED was terminal by absence.
 *
 * Now that a variance holds its collections back, that absence stops being a
 * cosmetic problem and becomes the thing standing between an agent and their
 * commission, so the way out has to exist and has to be narrow.
 *
 * It is narrow in three ways. The officer states the total now received and
 * the bank reference that proves it, and the figures have to agree — this
 * closes a dispute where the money turned up, and refuses to paper over one
 * where it did not. It cannot be the officer who recorded the settlement:
 * settling a batch makes its commission payable, and the platform asks for a
 * second person everywhere else money is released. And the note is required,
 * because a year later the only question anyone will ask about this row is
 * what the first figure was doing wrong.
 */
export async function reconcileSettlement(params: {
  settlementId: string;
  receivedAmountKobo: Kobo;
  bankReference: string;
  note: string;
  actorId: string;
  actorRole: string;
}): Promise<{
  settlementReference: string;
  transactionsSettled: number;
  settledTransactionIds: string[];
  receivedAmountKobo: string;
}> {
  const outcome = await withTransaction(async (client) => {
    const settlement = await queryOne<{
      id: string;
      settlement_reference: string;
      status: string;
      expected_amount_kobo: string;
      received_amount_kobo: string;
      recorded_by: string | null;
    }>(
      client,
      `SELECT s.id, s.settlement_reference, s.status, s.expected_amount_kobo,
              s.received_amount_kobo,
              (SELECT a.actor_id FROM audit_logs a
                WHERE a.entity_type = 'settlement' AND a.entity_id = s.id::text
                  AND a.action = 'settlement.recorded'
                ORDER BY a.created_at ASC LIMIT 1) AS recorded_by
         FROM settlements s WHERE s.id = $1
         FOR UPDATE`,
      [params.settlementId],
    );
    if (!settlement) throw notFound('That settlement');

    if (settlement.status !== 'DISPUTED') {
      throw conflict(
        'SETTLEMENT_NOT_DISPUTED',
        `Settlement ${settlement.settlement_reference} is ${settlement.status.toLowerCase()}, ` +
          'so there is no variance to account for.',
      );
    }

    if (settlement.recorded_by === params.actorId) {
      throw forbidden(
        'You recorded this settlement, so another officer has to be the one to close it. ' +
          'Closing it releases the commission on every collection in the batch.',
        'Ask a colleague in the finance office to check the statement and close it.',
      );
    }

    const expected = parseKobo(settlement.expected_amount_kobo);
    if (params.receivedAmountKobo !== expected) {
      const variance = params.receivedAmountKobo - expected;
      throw conflict(
        'SETTLEMENT_STILL_SHORT',
        `The batch is still out by ${variance.toString()} kobo: the collections in it come to ` +
          `${expected.toString()} and this closes it at ${params.receivedAmountKobo.toString()}. ` +
          'A settlement is closed when the money is accounted for, not when the difference is accepted.',
        'Record the missing credit with the gateway, or reverse the collections it never covered.',
      );
    }

    await client.query(
      `UPDATE settlements
          SET status = 'RECONCILED', received_amount_kobo = $2, bank_reference = $3,
              reconciled_at = now(), reconciled_by = $4
        WHERE id = $1`,
      [settlement.id, params.receivedAmountKobo.toString(), params.bankReference, params.actorId],
    );

    const settledTransactionIds = await settleLinkedTransactions(client, {
      settlementId: settlement.id,
      settlementReference: settlement.settlement_reference,
      bankReference: params.bankReference,
      actorId: params.actorId,
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'settlement.reconciled',
      entityType: 'settlement',
      entityId: settlement.id,
      oldValue: {
        status: settlement.status,
        receivedKobo: settlement.received_amount_kobo,
      },
      newValue: {
        status: 'RECONCILED',
        receivedKobo: params.receivedAmountKobo.toString(),
        bankReference: params.bankReference,
        transactionsSettled: settledTransactionIds.length,
      },
      reason: params.note,
    });

    return {
      settlementReference: settlement.settlement_reference,
      transactionsSettled: settledTransactionIds.length,
      settledTransactionIds,
      receivedAmountKobo: params.receivedAmountKobo.toString(),
    };
  });

  await issueWhatWasBought(outcome.settledTransactionIds, params.actorId, params.actorRole);
  return outcome;
}

/** Finance officer exception queue (PRD §46). */
/**
 * The statuses that describe an outstanding exception.
 *
 * Named once and shared, because listing and resolving are two halves of the
 * same idea. They were written separately: the query below spelled the list
 * out, `resolveException` spelled out nothing, and set RESOLVED on whatever
 * record id it was handed. The other statuses are not lesser exceptions, they
 * are not exceptions — MATCHED is a row the sweep reconciled, and UNCHECKED is
 * a row that was never compared to anything because the gateway statement
 * could not be fetched.
 */
export const EXCEPTION_STATUSES = [
  'MISSING_PAYMENT',
  'MISSING_PLATFORM_TRANSACTION',
  'AMOUNT_MISMATCH',
  'DUPLICATE_PAYMENT',
  'PENDING_SETTLEMENT',
] as const;

/**
 * How long the gateway has to hand the money over before it is a problem.
 *
 * A payment the gateway confirmed is money the *gateway* holds. It reaches the
 * government account in a batch a day or two later, and until the State can see
 * that credit in its own account the collection is legitimately unsettled —
 * that is the third leg of the three-way reconciliation, not a fault.
 *
 * Seventy-two hours covers a Friday collection settling on Monday, which is the
 * longest an ordinary weekend can make it. Past that the money should have
 * arrived and has not, and that *is* a fault: it is the State having taken a
 * citizen's money and not received it.
 */
const SETTLEMENT_DUE_HOURS = 72;

/**
 * The finance officer's worklist: every unresolved exception, once each.
 *
 * `reconciliation_records` holds one row per transaction *per run*, which is
 * right — an auditor asking what the sweep concluded on Tuesday needs Tuesday's
 * answer, not today's overwritten on top of it. But the queue is not history.
 * It is a list of things somebody has to do, and it used to read every
 * unresolved row from every run.
 *
 * Reconciliation runs four times a day over a trailing forty-eight hours, so a
 * transaction still awaiting settlement was recorded afresh by each sweep that
 * covered it: the same item appeared in the queue up to eight times, each with
 * its own Resolve button, and resolving one left the rest. A worklist that
 * multiplies its own contents is worse than a long one — the officer cannot
 * tell how much work there actually is, and the count is wrong everywhere it is
 * shown.
 *
 * So the queue takes the newest finding per transaction — per gateway
 * reference, for the lines that have no platform transaction at all — and shows
 * it only if that newest finding is still unresolved. Resolving it therefore
 * clears the item, and an older run's stale verdict cannot bring it back.
 */
export async function exceptionQueue(
  db: Db,
  options: { status?: string; limit?: number; settlementDueHours?: number } = {},
) {
  return query(
    db,
    `WITH newest AS (
       SELECT DISTINCT ON (COALESCE(r.transaction_id::text, r.gateway_reference, r.id::text))
              r.id, r.run_id, r.status, r.expected_amount_kobo, r.received_amount_kobo,
              r.variance_kobo, r.gateway_reference, r.settlement_reference, r.detail,
              r.created_at, r.transaction_id
         FROM reconciliation_records r
        ORDER BY COALESCE(r.transaction_id::text, r.gateway_reference, r.id::text),
                 r.created_at DESC, r.id DESC
     )
     SELECT n.id, n.run_id, n.status, n.expected_amount_kobo, n.received_amount_kobo,
            n.variance_kobo, n.gateway_reference, n.settlement_reference, n.detail, n.created_at,
            t.transaction_reference, t.status AS transaction_status,
            tp.first_name, tp.last_name, tp.business_name,
            ag.agent_code
       FROM newest n
       LEFT JOIN transactions t ON t.id = n.transaction_id
       LEFT JOIN taxpayers tp ON tp.id = t.taxpayer_id
       LEFT JOIN agents ag ON ag.id = t.agent_id
      /*
       * Only the status is tested, not reconciled_at.
       *
       * resolveException sets both in one UPDATE — status to RESOLVED and
       * reconciled_at to now() — and nothing else writes either on this
       * table, so the two can never disagree and RESOLVED is not in the
       * exception list. Mutation-testing confirmed the extra condition could
       * not change the result of any query this platform can produce, and an
       * unreachable branch in a worklist is where a wrong belief about the
       * worklist hides. The test file holds the invariant it depends on.
       */
      WHERE ($1::text IS NULL OR n.status = $1)
        AND n.status = ANY($3::text[])
        /*
         * Money still inside the gateway's settlement window is not an
         * exception, and listing it as one had two costs. It made ordinary
         * business look like a fault, so the queue an officer scans for real
         * trouble was mostly routine; and it hid the case that is a fault — a
         * collection the gateway confirmed days ago and never handed over,
         * which looked exactly like one taken an hour before. Past the window
         * it appears here, which is the point at which somebody should be
         * asking the gateway where the money is.
         */
        AND (n.status <> 'PENDING_SETTLEMENT'
             OR n.created_at < now() - ($4 || ' hours')::interval)
      ORDER BY n.created_at DESC
      LIMIT $2`,
    [
      options.status ?? null,
      options.limit ?? 100,
      [...EXCEPTION_STATUSES],
      String(options.settlementDueHours ?? SETTLEMENT_DUE_HOURS),
    ],
  );
}

/**
 * Collections the gateway has confirmed and not yet handed over.
 *
 * Kept apart from the exception queue on purpose. This is the ordinary state of
 * money in transit and nobody has to do anything about it — but it is not
 * nothing either, because it is the difference between what the platform has
 * collected and what the State can actually spend. It is reported with an age
 * so the shape of the delay is visible, and anything past the settlement window
 * has already moved to the exception queue by the time it appears overdue here.
 */
export async function awaitingSettlement(
  db: Db,
  options: { limit?: number; settlementDueHours?: number } = {},
) {
  return query(
    db,
    `WITH newest AS (
       SELECT DISTINCT ON (COALESCE(r.transaction_id::text, r.gateway_reference, r.id::text))
              r.id, r.status, r.expected_amount_kobo, r.gateway_reference, r.created_at,
              r.reconciled_at, r.transaction_id
         FROM reconciliation_records r
        ORDER BY COALESCE(r.transaction_id::text, r.gateway_reference, r.id::text),
                 r.created_at DESC, r.id DESC
     )
     SELECT n.id, n.expected_amount_kobo, n.gateway_reference, n.created_at,
            ROUND(EXTRACT(EPOCH FROM (now() - n.created_at)) / 3600)::int AS age_hours,
            (n.created_at < now() - ($2 || ' hours')::interval) AS overdue,
            t.transaction_reference,
            tp.first_name, tp.last_name, tp.business_name,
            ag.agent_code
       FROM newest n
       LEFT JOIN transactions t ON t.id = n.transaction_id
       LEFT JOIN taxpayers tp ON tp.id = t.taxpayer_id
       LEFT JOIN agents ag ON ag.id = t.agent_id
      WHERE n.status = 'PENDING_SETTLEMENT'
        AND n.reconciled_at IS NULL
      ORDER BY n.created_at ASC
      LIMIT $1`,
    [options.limit ?? 100, String(options.settlementDueHours ?? SETTLEMENT_DUE_HOURS)],
  );
}

export async function resolveException(params: {
  recordId: string;
  resolution: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const record = await queryOne<{ id: string; status: string; reconciled_at: Date | null }>(
      client,
      'SELECT id, status, reconciled_at FROM reconciliation_records WHERE id = $1 FOR UPDATE',
      [params.recordId],
    );
    if (!record) throw notFound('That reconciliation record');

    // Resolving is for an exception that is still open. Anything else would be
    // recording an answer to a question nobody asked.
    if (record.reconciled_at !== null) {
      throw conflict(
        'ALREADY_RESOLVED',
        'This record has already been resolved.',
        'Open the record to see who resolved it and why.',
      );
    }
    if (!(EXCEPTION_STATUSES as readonly string[]).includes(record.status)) {
      throw conflict(
        'NOT_AN_EXCEPTION',
        record.status === 'UNCHECKED'
          ? 'This record was never compared against a gateway statement, so there is ' +
            'nothing to resolve. Re-run reconciliation for that period once the ' +
            'statement is available.'
          : `A record with status ${record.status} is not an outstanding exception.`,
        record.status === 'UNCHECKED'
          ? 'Marking it resolved would record an examination that never happened.'
          : undefined,
      );
    }

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
}): Promise<{
  refundReference: string;
  commissionReversed: number;
  clawbackKobo: string;
  refundStatus: string;
  refundMessage: string;
}> {
  const recorded = await recordReversal(params);

  // Now ask the gateway to return the money. Outside the transaction, because
  // it is a network call; after it, because the reversal of the transaction,
  // the receipt and the commission is government's decision and stands whether
  // or not a third party is reachable this minute. What must not happen is the
  // platform claiming the refund was made when nobody has made it.
  const settled = await attemptRefund({
    refundReference: recorded.refundReference,
    gatewayReference: recorded.gatewayReference,
    amountKobo: recorded.amountKobo,
    reason: recorded.reason,
    actorId: params.actorId,
    actorRole: params.actorRole,
  });

  return {
    refundReference: recorded.refundReference,
    commissionReversed: recorded.commissionReversed,
    clawbackKobo: recorded.clawbackKobo,
    refundStatus: settled.status,
    refundMessage: settled.message,
  };
}

/**
 * Ask the gateway for one outstanding refund and record what it said.
 *
 * Shared by the reversal itself and by the retry job, so a refund that could
 * not be made at the time is made later by the same code path rather than a
 * second one that might drift from it.
 */
export async function attemptRefund(params: {
  refundReference: string;
  gatewayReference: string | null;
  amountKobo: Kobo;
  reason: string;
  actorId: string | null;
  actorRole: string;
}): Promise<{ status: string; message: string }> {
  if (!params.gatewayReference) {
    await markRefund(params.refundReference, 'FAILED', 'The original payment has no gateway reference.');
    return {
      status: 'FAILED',
      message:
        'This payment has no gateway reference, so the money cannot be returned automatically. ' +
        'A finance officer must return it directly and record the reference.',
    };
  }

  let result: Awaited<ReturnType<typeof gateway.refund>>;
  try {
    result = await gateway.refund({
      gatewayReference: params.gatewayReference,
      amountKobo: params.amountKobo,
      refundReference: params.refundReference,
      reason: params.reason,
    });
  } catch (error) {
    // A gateway that threw has not refused; it did not answer.
    result = {
      outcome: 'UNAVAILABLE',
      reason: error instanceof Error ? error.message : 'The gateway could not be reached.',
      provider: gateway.name,
    };
  }

  if (result.outcome === 'ACCEPTED') {
    await markRefund(params.refundReference, 'COMPLETED', null, result.reference ?? null);
    // The second half of what the taxpayer was promised at the reversal. The
    // gap between "your money is coming back" and it arriving is the part they
    // cannot see for themselves, and it is the part that can take days.
    await announceRefundCompleted(params.refundReference, params.amountKobo);
    return { status: 'COMPLETED', message: 'The gateway has returned the money to the taxpayer.' };
  }

  // REJECTED is terminal for the automatic path; UNAVAILABLE is not, and the
  // retry job will ask again. Neither may leave the refund looking done.
  const status = result.outcome === 'REJECTED' ? 'FAILED' : 'PENDING';
  await markRefund(params.refundReference, status, result.reason ?? 'The gateway did not accept the refund.');

  return {
    status,
    message:
      status === 'FAILED'
        ? `The gateway refused the refund: ${result.reason ?? 'no reason given'}. ` +
          'The taxpayer is still owed this money and a finance officer must return it directly.'
        : 'The gateway could not be reached, so the taxpayer has NOT been refunded yet. ' +
          'This refund stays in the outstanding queue and will be retried.',
  };
}

async function announceRefundCompleted(refundReference: string, amountKobo: Kobo): Promise<void> {
  await withTransaction(async (client) => {
    const owed = await queryOne<{ taxpayer_id: string; transaction_reference: string; transaction_id: string }>(
      client,
      `SELECT t.taxpayer_id, t.transaction_reference, t.id AS transaction_id
         FROM refunds r JOIN transactions t ON t.id = r.transaction_id
        WHERE r.refund_reference = $1`,
      [refundReference],
    );
    if (!owed) return;
    await queueNotification(client, {
      event: 'REFUND_COMPLETED',
      taxpayerId: owed.taxpayer_id,
      entityType: 'transaction',
      entityId: owed.transaction_id,
      variables: {
        amount: amountKobo.toString(),
        reference: owed.transaction_reference,
        refundReference,
      },
    });
  });
}

async function markRefund(
  refundReference: string,
  status: string,
  failureReason: string | null,
  gatewayReference?: string | null,
): Promise<void> {
  await withTransaction((client) =>
    client.query(
      `UPDATE refunds
          SET status = $2,
              failure_reason = $3,
              attempts = attempts + 1,
              last_attempt_at = now(),
              gateway_reference = COALESCE($4, gateway_reference),
              completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END
        WHERE refund_reference = $1`,
      [refundReference, status, failureReason, gatewayReference ?? null],
    ),
  );
}

/** Refunds a taxpayer is still owed, oldest first. */
export async function outstandingRefunds(db: Db, limit = 100) {
  return query(
    db,
    `SELECT r.id, r.refund_reference, r.amount_kobo, r.status, r.attempts, r.failure_reason,
            r.last_attempt_at, r.created_at, t.transaction_reference, p.gateway_reference
       FROM refunds r
       JOIN transactions t ON t.id = r.transaction_id
       LEFT JOIN payments p ON p.id = r.payment_id
      WHERE r.status IN ('PENDING', 'PROCESSING', 'FAILED')
      ORDER BY r.created_at
      LIMIT $1`,
    [limit],
  );
}

/**
 * Retry every refund the gateway has not yet made (PRD §71).
 *
 * A taxpayer owed money must not depend on somebody remembering to press a
 * button, which is what the vehicle authority queue already learned.
 */
/**
 * The scheduled reconciliation sweep.
 *
 * PRD §46 makes reconciliation mandatory, and until now it happened only when
 * a finance officer remembered to press a button. A control nobody is rostered
 * to run is a control that runs on the days somebody happens to think of it,
 * which is not what "mandatory" means for the mechanism that proves government
 * received its money.
 *
 * The window trails rather than covering only since the last run, because
 * settlement references arrive days after the payment they belong to: a
 * transaction that was PENDING_SETTLEMENT on Monday becomes MATCHED on
 * Wednesday, and only a window that looks back finds that out. Re-running a
 * period is cheap and safe — each run writes its own rows and asserts nothing
 * about the last one.
 *
 * Recovery runs after a completed sweep, not inside it. Reconciliation's job
 * is to notice that the gateway confirmed money the platform never verified;
 * acting on that means confirming payments and issuing receipts, which each
 * need their own transaction. Doing it here is what makes the missed-webhook
 * path (PRD §66) self-healing instead of a queue waiting on a human.
 */
let sweepInFlight = false;

export async function runScheduledReconciliation(params: {
  windowHours?: number;
  actorId?: string | null;
  actorRole?: string;
} = {}): Promise<{
  skipped: boolean;
  summary?: ReconciliationSummary;
  recovery?: { attempted: number; verified: number; failures: string[] };
}> {
  // A sweep over a long window can outlast its interval. Starting a second one
  // on top of the first would double every status query to the gateway for no
  // new information.
  if (sweepInFlight) return { skipped: true };
  sweepInFlight = true;

  try {
    const to = new Date();
    const from = new Date(to.getTime() - (params.windowHours ?? 48) * 60 * 60_000);

    const summary = await runReconciliation({
      from,
      to,
      actorId: params.actorId ?? null,
      actorRole: params.actorRole ?? 'system',
    });

    if (summary.status === 'ABORTED') return { skipped: false, summary };

    const recovery = await recoverUnverifiedPayments({ from, to });
    return { skipped: false, summary, recovery };
  } finally {
    sweepInFlight = false;
  }
}

export async function retryOutstandingRefunds(params: {
  actorId: string | null;
  actorRole: string;
  limit?: number;
}): Promise<{ attempted: number; completed: number; stillOutstanding: number }> {
  const due = await query<{
    refund_reference: string;
    amount_kobo: string;
    reason: string;
    gateway_reference: string | null;
  }>(
    pool,
    `SELECT r.refund_reference, r.amount_kobo, r.reason, p.gateway_reference
       FROM refunds r
       LEFT JOIN payments p ON p.id = r.payment_id
      WHERE r.status IN ('PENDING', 'PROCESSING')
      ORDER BY r.created_at
      LIMIT $1`,
    [params.limit ?? 50],
  );

  let completed = 0;
  for (const row of due) {
    const result = await attemptRefund({
      refundReference: row.refund_reference,
      gatewayReference: row.gateway_reference,
      amountKobo: parseKobo(row.amount_kobo),
      reason: row.reason,
      actorId: params.actorId,
      actorRole: params.actorRole,
    });
    if (result.status === 'COMPLETED') completed += 1;
  }

  return { attempted: due.length, completed, stillOutstanding: due.length - completed };
}

/**
 * Who a reversal is attributable to.
 *
 * TAXPAYER is the only one that costs compliance points: the payment failed on
 * their side after the fact — a chargeback, a bank recall, an instrument that
 * did not clear. GOVERNMENT is PSIRS or its agent correcting its own error and
 * GATEWAY is the payment infrastructure settling something it should not have;
 * neither is the citizen's doing.
 */
const ATTRIBUTABLE = ['TAXPAYER', 'GOVERNMENT', 'GATEWAY'] as const;
type Attributable = (typeof ATTRIBUTABLE)[number];

async function recordReversal(params: {
  approvalId: string;
  actorId: string;
  actorRole: string;
}): Promise<{
  refundReference: string;
  commissionReversed: number;
  clawbackKobo: string;
  gatewayReference: string | null;
  amountKobo: Kobo;
  reason: string;
}> {
  return withTransaction(async (client) => {
    const approval = await queryOne<{
      id: string;
      status: string;
      entity_id: string;
      payload: { amountKobo?: string; reason?: string; refundType?: string; attributableTo?: string };
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

    const payment = await queryOne<{ id: string; gateway_reference: string | null; amount_kobo: string }>(
      client,
      `SELECT id, gateway_reference, amount_kobo FROM payments
        WHERE transaction_id = $1 AND status = 'VERIFIED'`,
      [transactionId],
    );
    if (!payment) {
      throw conflict(
        'NO_VERIFIED_PAYMENT',
        'There is no verified payment on this transaction to reverse.',
      );
    }

    /*
     * A reversal returns the payment, and the whole of it.
     *
     * The amount reaches this point through `approvals.payload`, which is a
     * free-form JSON column: whatever the requesting officer typed, unchecked
     * by anything between there and here. Nothing compared it to the payment,
     * so a request naming ten million naira against a two thousand naira
     * collection was well formed, and the State recorded that it owed the money
     * and asked the gateway to return it.
     *
     * Requiring the exact payment rather than merely a smaller one is the same
     * rule the rest of this function already follows without saying so.
     * Everything downstream is all-or-nothing — the receipt is voided, every
     * document revoked, the transaction reversed, the whole commission clawed
     * back — so a reversal that returned part of a payment would leave the
     * State holding the rest of money it had just declared reversed, with a
     * voided receipt as the only record that it was ever paid.
     *
     * PARTIAL is the type for that case and this path cannot honour it, so it
     * is refused in the officer's face rather than carried out as a full
     * reversal that happens to return less.
     */
    const paid = parseKobo(payment.amount_kobo);
    const refundType = approval.payload.refundType ?? 'REVERSAL';

    if (refundType !== 'FULL' && refundType !== 'REVERSAL') {
      throw conflict(
        'REFUND_TYPE_NOT_SUPPORTED',
        `This platform cannot carry out a ${String(refundType).toLowerCase()} refund. Reversing a ` +
          'payment voids its receipt, revokes its documents and reverses the whole commission, ' +
          'so it returns the whole payment or nothing.',
        'Reverse the payment in full and raise a fresh assessment for what is actually owed.',
      );
    }

    /*
     * Whose doing the reversal was, recorded when it is carried out.
     *
     * `refunds.attributable_to` was added so that the compliance score would
     * stop penalising a citizen for the State's own double charges, and it
     * defaults to GOVERNMENT for exactly that reason. But nothing ever wrote
     * anything else, so the half of the rule that still meant to bite — a
     * payment the taxpayer's own bank recalled — never bit either. A column
     * with one reachable value is not a classification, and the score's
     * reversal component was dead in both directions.
     *
     * The officer executing the reversal is the one who knows which it was,
     * so it comes in on the approval payload alongside the amount and the
     * type, and is checked here with them. An unrecognised value is refused
     * rather than quietly treated as GOVERNMENT: silently absolving the
     * taxpayer is still the platform deciding something it was told.
     */
    const attributableTo = (approval.payload.attributableTo ?? 'GOVERNMENT') as Attributable;
    if (!ATTRIBUTABLE.includes(attributableTo)) {
      throw conflict(
        'REVERSAL_ATTRIBUTION_UNKNOWN',
        `"${String(attributableTo)}" is not something a reversal can be attributed to.`,
        `Say who the reversal is down to: ${ATTRIBUTABLE.join(', ')}.`,
      );
    }

    const amount = parseKobo(approval.payload.amountKobo ?? payment.amount_kobo);
    if (amount !== paid) {
      throw conflict(
        'REFUND_AMOUNT_MISMATCH',
        `This reversal is for ${amount.toString()} kobo against a payment of ${paid.toString()} ` +
          'kobo. A reversal returns the payment it reverses, in full.',
        'Correct the amount on the approval, or reverse the payment in full and re-assess.',
      );
    }

    const refundReference = await nextRefundReference(client);

    // PENDING, not COMPLETED. The gateway has not been asked yet, and it is
    // asked after this transaction commits — a network call must not be made
    // while holding the row locks that the reversal cascade takes. COMPLETED
    // is a statement that a citizen has their money back; only the gateway
    // saying so may set it.
    await client.query(
      `INSERT INTO refunds
         (refund_reference, transaction_id, payment_id, amount_kobo, refund_type, reason,
          approval_id, requested_by, approved_by, approved_at, status, attributable_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'PENDING',$10)`,
      [
        refundReference,
        transactionId,
        payment.id,
        amount.toString(),
        refundType,
        approval.payload.reason ?? 'Approved reversal',
        approval.id,
        approval.requested_by,
        approval.approved_by,
        attributableTo,
      ],
    );

    await client.query(
      `UPDATE payments SET status = 'REVERSED', reversed_at = now() WHERE id = $1`,
      [payment.id],
    );

    await transitionTransaction(client, {
      transactionId,
      to: refundType === 'FULL' ? 'REFUNDED' : 'REVERSED',
      reason: approval.payload.reason ?? 'Approved reversal',
      actorId: params.actorId,
      source: 'OFFICER',
      metadata: { refundReference, approvalId: approval.id },
    });

    /*
     * And tell the person whose payment it was.
     *
     * Their receipt is about to stop being valid and their money is on its way
     * back, and until now nothing said so: they found out when a verification
     * told them the receipt was no good. Sent inside this transaction, so a
     * reversal that rolls back does not leave a citizen holding a message
     * about something that did not happen.
     */
    await queueNotification(client, {
      event: 'PAYMENT_REVERSED',
      taxpayerId: (
        await queryOne<{ taxpayer_id: string }>(
          client,
          'SELECT taxpayer_id FROM transactions WHERE id = $1',
          [transactionId],
        )
      )?.taxpayer_id,
      entityType: 'transaction',
      entityId: transactionId,
      variables: {
        amount: amount.toString(),
        reference: transaction.transaction_reference,
        reason: approval.payload.reason ?? 'Approved reversal',
      },
    });

    // The receipt stays in existence — it is evidence that a payment was once
    // made — but is marked so public verification reports it as reversed.
    await client.query(
      `UPDATE receipts SET status = 'REVERSED', void_reason = $2, voided_at = now(), voided_by = $3
        WHERE transaction_id = $1`,
      [transactionId, approval.payload.reason ?? 'Payment reversed', params.actorId],
    );

    // Marking the receipt row is not enough. Every issued document is a second
    // record of the same claim, with its own number that public verification
    // will answer to, and `documents.status` had never been written by any
    // code path — so a reversed receipt looked up by document number, and
    // vehicle papers looked up by any handle at all, went on reporting
    // "This is a genuine government document issued by PSIRS" for as long as
    // they existed. §95 in reverse: a reversed transaction must not still be
    // able to appear successful.
    //
    // Only documents that assert payment succeeded are revoked. An invoice is
    // a demand notice, not evidence of payment, and the reversal puts the
    // invoice back to UNPAID — it remains a legitimate thing to present.
    //
    // The acknowledgement is in that set now, and it is the one that matters
    // most in the window this reversal is most likely to be used in. Before
    // receipts waited for settlement, a reversal that beat the bank credit had
    // no document to worry about; now there is always one, from gateway
    // confirmation onwards. It says a receipt follows, which a reversal makes
    // permanently false, and it hangs off the transaction rather than off a
    // receipt — so the two entity types above do not reach it.
    await client.query(
      `UPDATE documents d
          SET status = 'REVOKED'
        WHERE d.status <> 'REVOKED'
          AND ((d.entity_type = 'receipt'
                AND d.entity_id IN (SELECT id FROM receipts WHERE transaction_id = $1))
            OR (d.entity_type = 'vehicle_renewal'
                AND d.entity_id IN (SELECT id FROM vehicle_renewals WHERE transaction_id = $1))
            OR (d.entity_type = 'transaction'
                AND d.document_type = 'PAYMENT_ACKNOWLEDGEMENT'
                AND d.entity_id = $1))`,
      [transactionId],
    );

    // A renewal whose payment was returned is not COMPLETED. The vehicle's
    // recorded expiry and the notification already sent to the authority are a
    // separate question — the registry is the source of truth for both and the
    // platform cannot unsend either — but the renewal's own status is ours.
    await client.query(
      `UPDATE vehicle_renewals
          SET status = 'CANCELLED', updated_at = now()
        WHERE transaction_id = $1 AND status <> 'CANCELLED'`,
      [transactionId],
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
      gatewayReference: payment.gateway_reference,
      amountKobo: amount,
      reason: approval.payload.reason ?? 'Approved reversal',
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
      `SELECT id, settlement_reference, gateway, bank_reference, settlement_date,
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
