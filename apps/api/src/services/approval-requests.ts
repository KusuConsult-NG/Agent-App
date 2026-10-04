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
