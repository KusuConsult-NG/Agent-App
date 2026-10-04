/**
 * Opening a request for a second officer's decision.
 *
 * One place, because there are two ways in. An officer asks, from the
 * approvals endpoint. Or a decision leaves a request behind it: an objection
 * upheld on a bill already paid leaves a refund for somebody else to grant.
 * Either way the request is recorded, audited and put in front of the people
 * who review requests in the same way, so one arriving by the second route is
 * not quieter than one arriving by the first.
 */

import type { PoolClient } from 'pg';
import { query, queryOne } from '../db/pool';
import { recordAudit } from './audit';
import * as inbox from './officer-inbox';

export interface ApprovalRequest {
  approvalType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  requestedByRole: string;
  reason: string;
}

export async function openApprovalRequest(
  client: PoolClient,
  request: ApprovalRequest,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    client,
    `INSERT INTO approvals
       (approval_type, entity_type, entity_id, payload, requested_by, requested_reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      request.approvalType,
      request.entityType,
      request.entityId,
      JSON.stringify(request.payload),
      request.requestedBy,
      request.reason,
    ],
  );
  await recordAudit(client, {
    actorId: request.requestedBy,
    actorRole: request.requestedByRole,
    action: 'approval.requested',
    entityType: 'approval',
    entityId: row!.id,
    newValue: { approvalType: request.approvalType, entityId: request.entityId },
    reason: request.reason,
  });

  /*
   * Tell whoever reviews these, rather than waiting for them to look.
   *
   * Addressed to a role, not a person: an approval waiting on a named
   * officer waits through their leave, and a reversal or a refund
   * sitting unreviewed is money the platform is holding from somebody.
   *
   * Which role is derived from the permission rather than named here --
   * `approval:review` is what the reviewing endpoint requires, and since
   * migration 059 which roles hold it is PSIRS's decision rather than a
   * constant in this file.
   */
  const reviewers = await query<{ role: string }>(
    client,
    `SELECT DISTINCT role FROM role_permissions WHERE permission = 'approval:review'`,
  );
  for (const reviewer of reviewers) {
    await inbox.raise(client, {
      role: reviewer.role,
      kind: 'APPROVAL_WAITING',
      severity: 'WARNING',
      subject: `${request.approvalType} is waiting for a decision`,
      body: request.reason,
      entityType: 'approval',
      entityId: row!.id,
      dedupeKey: `approval:${row!.id}:${reviewer.role}`,
    });
  }

  return row!;
}

export interface RefundRequested {
  approvalId: string;
  transactionReference: string;
  amountKobo: string;
}

/**
 * Ask for the money back on a bill the State has withdrawn.
 *
 * Two decisions withdraw a bill (`withdrawUnpaidBill`): an objection upheld,
 * and a PAYE return withdrawn to be refiled. A bill already paid is left
 * PAID by both — rightly, because money that has reached a government
 * account comes back through a refund and its accountability, not through an
 * UPDATE — and then nothing asked for the refund.
 *
 * An objection can be raised after the bill is paid, and a payment can land
 * while one is open. Measured: a trader paid ₦48,000, objected, and the
 * objection was upheld. The assessment read WITHDRAWN, the bill read PAID,
 * there was no refund request and nothing in anybody's inbox, and the
 * objection queue the decision was made from had not said the bill was paid. The State kept the
 * money for an estimate it had agreed was wrong, which is the decision in the
 * taxpayer's favour costing them exactly what it would have cost to lose.
 *
 * And a PAYE return is withdrawn to be refiled, which is the instruction the
 * filing path gives for a wrong one. Measured: an employer paid ₦289,000 on a
 * return filed from the wrong column, the return was withdrawn and refiled at
 * ₦127,000, and they then owed the ₦127,000 with the ₦289,000 held and nothing
 * asking for it back — the doubling the instruction promised to prevent.
 *
 * So the decision opens the request, in full and attributed to the State.
 * It is a request and not a refund. A second officer still grants it and a
 * third still carries it out, under every check a refund asked for by hand
 * goes through; this only makes sure there is something for them to decide.
 * The requester is the officer whose decision it was, which keeps them
 * from also granting it. A payment already under a reversal or refund request
 * is left to that one.
 */
export async function askForRefundsOfWithdrawnBill(
  client: PoolClient,
  assessmentId: string,
  params: {
    actorId: string;
    actorRole: string;
    /** What was decided, in a few words: "Objection upheld". */
    headline: string;
    /** The same as the opening of a sentence a reviewer reads. */
    because: string;
    reason: string;
  },
): Promise<RefundRequested[]> {
  const paid = await query<{ id: string; transaction_reference: string; amount_kobo: string }>(
    client,
    `SELECT t.id, t.transaction_reference, p.amount_kobo::text AS amount_kobo
       FROM invoices i
       JOIN transactions t ON t.invoice_id = i.id
       JOIN payments p ON p.transaction_id = t.id AND p.status = 'VERIFIED'
      WHERE i.assessment_id = $1
        AND i.status = 'PAID'
        AND NOT EXISTS (
          SELECT 1 FROM approvals a
           WHERE a.entity_type = 'transaction' AND a.entity_id = t.id::text
             AND a.approval_type IN ('REFUND', 'PAYMENT_REVERSAL')
             AND a.status IN ('REQUESTED', 'REVIEWED', 'APPROVED'))
      ORDER BY t.created_at`,
    [assessmentId],
  );

  const requested: RefundRequested[] = [];
  for (const charge of paid) {
    const approval = await openApprovalRequest(client, {
      approvalType: 'REFUND',
      entityType: 'transaction',
      entityId: charge.id,
      payload: {
        amountKobo: charge.amount_kobo,
        refundType: 'FULL',
        attributableTo: 'GOVERNMENT',
        reason: `${params.headline}: ${params.reason}`,
      },
      requestedBy: params.actorId,
      requestedByRole: params.actorRole,
      reason:
        `${params.because} (${params.reason}), and ` +
        `${charge.transaction_reference} had already paid it. Refund the payment in full.`,
    });
    requested.push({
      approvalId: approval.id,
      transactionReference: charge.transaction_reference,
      amountKobo: charge.amount_kobo,
    });
  }
  return requested;
}
