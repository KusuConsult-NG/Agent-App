/**
 * Agent commission (PRD §25, §26, §27, §28).
 *
 * The separation PRD §6 demands is structural here: commission is computed
 * *from* the government revenue figure and stored in its own ledger. There is
 * no code path that subtracts commission from what a taxpayer pays, because
 * commission never touches the transaction amount at all.
 *
 * Lifecycle (PRD §26):
 *   accrue (PENDING) -> hold period elapses on a settled transaction
 *     -> ELIGIBLE -> APPROVED -> PAID
 *   and at any point before payment, a reversal of the underlying transaction
 *   cascades to REVERSED.
 */

import type { PoolClient } from 'pg';
import {
  applyBasisPoints,
  assertCommissionTransition,
  parseKobo,
  type CommissionState,
  type Kobo,
} from '@psirs/shared';
import type { Db } from '../db/pool';
import { advisoryLock, LOCK_NAMESPACE, query, queryOne, withTransaction } from '../db/pool';
import { conflict, notFound, forbidden } from '../lib/errors';
import { nextPayoutReference } from '../lib/references';
import { recordAudit } from './audit';

interface CommissionPolicyRow {
  id: string;
  rate_basis_points: number;
  eligible_category_ids: string[];
  minimum_transaction_kobo: string;
  maximum_commission_kobo: string | null;
  hold_period_hours: number;
  requires_settlement_confirmation: boolean;
}

/**
 * Accrue commission for a verified transaction.
 *
 * Called only from the payment verification path, inside the same database
 * transaction. Returns null when no commission is due — which is a normal
 * outcome, not an error: taxpayer-portal payments have no agent, and some
 * revenue items are configured as commission-ineligible.
 */
export async function accrueCommission(
  client: PoolClient,
  params: { transactionId: string; actorId?: string | null },
): Promise<{ commissionId: string; amountKobo: Kobo } | null> {
  await advisoryLock(client, LOCK_NAMESPACE.COMMISSION, params.transactionId);

  const transaction = await queryOne<{
    id: string;
    agent_id: string | null;
    amount_kobo: string;
    status: string;
    revenue_item_id: string;
    category_id: string;
    commission_eligible: boolean;
    commission_policy_id: string | null;
  }>(
    client,
    `SELECT t.id, t.agent_id, t.amount_kobo, t.status, t.revenue_item_id,
            ri.category_id, ri.commission_eligible, a.commission_policy_id
       FROM transactions t
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       LEFT JOIN agents a ON a.id = t.agent_id
      WHERE t.id = $1`,
    [params.transactionId],
  );

  if (!transaction) throw notFound('That transaction');

  // No agent facilitated it, or the revenue item earns no incentive.
  if (!transaction.agent_id || !transaction.commission_eligible) return null;

  const existing = await queryOne<{ id: string }>(
    client,
    'SELECT id FROM commissions WHERE transaction_id = $1',
    [params.transactionId],
  );
  if (existing) return null; // Already accrued; accrual is idempotent.

  const policy = await queryOne<CommissionPolicyRow>(
    client,
    `SELECT id, rate_basis_points, eligible_category_ids, minimum_transaction_kobo,
            maximum_commission_kobo, hold_period_hours, requires_settlement_confirmation
       FROM commission_policies
      WHERE ($1::uuid IS NULL OR id = $1)
        AND status = 'ACTIVE'
        AND effective_from <= now()
        AND (effective_to IS NULL OR effective_to > now())
      ORDER BY (id = $1) DESC, effective_from DESC
      LIMIT 1`,
    [transaction.commission_policy_id],
  );

  if (!policy) return null;

  if (
    policy.eligible_category_ids.length > 0 &&
    !policy.eligible_category_ids.includes(transaction.category_id)
  ) {
    return null;
  }

  // Commission is calculated on government revenue only — never on the total
  // including any service charge (PRD §6).
  const basis = parseKobo(transaction.amount_kobo);
  if (basis < parseKobo(policy.minimum_transaction_kobo)) return null;

  let amount = applyBasisPoints(basis, policy.rate_basis_points);
  if (policy.maximum_commission_kobo !== null) {
    const cap = parseKobo(policy.maximum_commission_kobo);
    if (amount > cap) amount = cap;
  }

  const row = await queryOne<{ id: string }>(
    client,
    `INSERT INTO commissions
       (agent_id, transaction_id, policy_id, rate_basis_points, basis_amount_kobo, amount_kobo, status)
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING')
     RETURNING id`,
    [
      transaction.agent_id,
      transaction.id,
      policy.id,
      policy.rate_basis_points,
      basis.toString(),
      amount.toString(),
    ],
  );

  await recordAudit(client, {
    actorId: params.actorId ?? null,
    actorRole: 'system',
    action: 'commission.accrued',
    entityType: 'commission',
    entityId: row!.id,
    newValue: {
      agentId: transaction.agent_id,
      transactionId: transaction.id,
      basisAmountKobo: basis.toString(),
      rateBasisPoints: policy.rate_basis_points,
      amountKobo: amount.toString(),
      status: 'PENDING',
    },
  });

  return { commissionId: row!.id, amountKobo: amount };
}

async function transitionCommission(
  client: PoolClient,
  params: {
    commissionId: string;
    to: CommissionState;
    reason?: string;
    actorId?: string | null;
    payoutId?: string | null;
  },
): Promise<void> {
  const current = await queryOne<{ status: CommissionState }>(
    client,
    'SELECT status FROM commissions WHERE id = $1 FOR UPDATE',
    [params.commissionId],
  );
  if (!current) throw notFound('That commission record');

  assertCommissionTransition(current.status, params.to);

  await client.query(
    `UPDATE commissions
        SET status = $2,
            hold_reason   = CASE WHEN $2 = 'ON_HOLD' THEN $3 ELSE hold_reason END,
            eligible_at   = CASE WHEN $2 = 'ELIGIBLE' THEN now() ELSE eligible_at END,
            approved_at   = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END,
            approved_by   = CASE WHEN $2 = 'APPROVED' THEN $4 ELSE approved_by END,
            paid_at       = CASE WHEN $2 = 'PAID' THEN now() ELSE paid_at END,
            payout_id     = COALESCE($5, payout_id),
            reversed_at   = CASE WHEN $2 = 'REVERSED' THEN now() ELSE reversed_at END,
            reversal_reason = CASE WHEN $2 IN ('REVERSED','CANCELLED') THEN $3 ELSE reversal_reason END
      WHERE id = $1`,
    [params.commissionId, params.to, params.reason ?? null, params.actorId ?? null, params.payoutId ?? null],
  );

  await recordAudit(client, {
    actorId: params.actorId ?? null,
    actorRole: 'system',
    action: `commission.${params.to.toLowerCase()}`,
    entityType: 'commission',
    entityId: params.commissionId,
    oldValue: { status: current.status },
    newValue: { status: params.to },
    reason: params.reason ?? null,
  });
}

/**
 * Promote commissions whose hold period has elapsed on a settled transaction.
 *
 * PRD §26 makes settlement the gate: commission is payable only once the money
 * has actually reached government, not merely once a gateway said "success".
 */
export async function promoteEligibleCommissions(options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();

  return withTransaction(async (client) => {
    const due = await query<{ id: string }>(
      client,
      `SELECT c.id
         FROM commissions c
         JOIN transactions t ON t.id = c.transaction_id
         JOIN commission_policies p ON p.id = c.policy_id
        WHERE c.status = 'PENDING'
          AND t.status = 'SETTLED'
          AND t.settled_at IS NOT NULL
          AND t.settled_at + make_interval(hours => p.hold_period_hours) <= $1
          -- An open fraud investigation freezes the incentive (PRD §28).
          AND NOT EXISTS (
            SELECT 1 FROM fraud_flags f
             WHERE f.status IN ('OPEN', 'UNDER_REVIEW')
               AND (f.transaction_id = t.id OR (f.entity_type = 'AGENT' AND f.entity_id = c.agent_id))
               AND f.severity IN ('HIGH', 'CRITICAL')
          )
        FOR UPDATE OF c`,
      [now],
    );

    for (const row of due) {
      await transitionCommission(client, {
        commissionId: row.id,
        to: 'ELIGIBLE',
        reason: 'Hold period elapsed on a settled transaction',
      });
    }

    return due.length;
  });
}

/**
 * Reverse commission when its transaction is reversed or refunded (PRD §26,
 * §71, §88.27). An already-PAID commission is still marked REVERSED so the
 * overpayment is visible and recoverable — it is never quietly deleted.
 */
export async function reverseCommissionForTransaction(
  client: PoolClient,
  params: { transactionId: string; reason: string; actorId?: string | null },
): Promise<{ reversed: number; clawbackKobo: Kobo }> {
  const commissions = await query<{ id: string; status: CommissionState; amount_kobo: string }>(
    client,
    `SELECT id, status, amount_kobo FROM commissions
      WHERE transaction_id = $1 AND status <> 'REVERSED' FOR UPDATE`,
    [params.transactionId],
  );

  let clawback = 0n;

  for (const commission of commissions) {
    await transitionCommission(client, {
      commissionId: commission.id,
      to: 'REVERSED',
      reason: params.reason,
      actorId: params.actorId ?? null,
    });
    if (commission.status === 'PAID') {
      clawback += parseKobo(commission.amount_kobo);
    }
  }

  return { reversed: commissions.length, clawbackKobo: clawback };
}

/** Place commissions on hold, e.g. while a fraud flag is investigated. */
export async function holdCommissionsForAgent(
  client: PoolClient,
  params: { agentId: string; reason: string; actorId?: string | null },
): Promise<number> {
  const rows = await query<{ id: string }>(
    client,
    `SELECT id FROM commissions
      WHERE agent_id = $1 AND status IN ('PENDING', 'ELIGIBLE') FOR UPDATE`,
    [params.agentId],
  );

  for (const row of rows) {
    await transitionCommission(client, {
      commissionId: row.id,
      to: 'ON_HOLD',
      reason: params.reason,
      actorId: params.actorId ?? null,
    });
  }

  return rows.length;
}

export interface WalletSummary {
  pendingKobo: string;
  eligibleKobo: string;
  onHoldKobo: string;
  approvedKobo: string;
  paidKobo: string;
  reversedKobo: string;
  lifetimeKobo: string;
  transactionCount: number;
}

/**
 * Agent commission wallet (PRD §27).
 *
 * Explicitly a commission ledger, not a money account: it holds no government
 * revenue and cannot be spent from. PRD §27 — "It must not function as a
 * wallet for government revenue."
 */
export async function getWallet(db: Db, agentId: string): Promise<WalletSummary> {
  const row = await queryOne<Record<string, string>>(
    db,
    `SELECT
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'PENDING'), 0)::text  AS pending,
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'ELIGIBLE'), 0)::text AS eligible,
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'ON_HOLD'), 0)::text  AS on_hold,
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'APPROVED'), 0)::text AS approved,
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'PAID'), 0)::text     AS paid,
       COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'REVERSED'), 0)::text AS reversed,
       COALESCE(SUM(amount_kobo) FILTER (WHERE status <> 'REVERSED'), 0)::text AS lifetime,
       COUNT(*)::text AS transaction_count
     FROM commissions WHERE agent_id = $1`,
    [agentId],
  );

  return {
    pendingKobo: row?.pending ?? '0',
    eligibleKobo: row?.eligible ?? '0',
    onHoldKobo: row?.on_hold ?? '0',
    approvedKobo: row?.approved ?? '0',
    paidKobo: row?.paid ?? '0',
    reversedKobo: row?.reversed ?? '0',
    lifetimeKobo: row?.lifetime ?? '0',
    transactionCount: Number.parseInt(row?.transaction_count ?? '0', 10),
  };
}

/**
 * Request a payout of eligible commission (PRD §28).
 *
 * Every precondition in §28 is checked server-side: verified agent, verified
 * bank account, eligible commission, no fraud hold. The request then goes to
 * maker-checker approval; requesting does not pay anything.
 */
export async function requestPayout(params: {
  agentId: string;
  actorId: string;
  actorRole: string;
}): Promise<{ payoutId: string; payoutReference: string; amountKobo: Kobo; commissionCount: number }> {
  return withTransaction(async (client) => {
    const agent = await queryOne<{
      id: string;
      operational_status: string;
      bank_account_id: string | null;
      bank_verified: boolean;
    }>(
      client,
      `SELECT a.id, a.operational_status, a.bank_account_id,
              COALESCE(b.verification_status = 'VERIFIED', false) AS bank_verified
         FROM agents a
         LEFT JOIN bank_accounts b ON b.id = a.bank_account_id
        WHERE a.id = $1`,
      [params.agentId],
    );

    if (!agent) throw notFound('That agent');
    if (agent.operational_status !== 'ACTIVE') {
      throw forbidden('Commission cannot be paid out while the agent account is not active.');
    }
    if (!agent.bank_account_id || !agent.bank_verified) {
      throw conflict(
        'BANK_ACCOUNT_NOT_VERIFIED',
        'Your commission bank account has not been verified. Commission cannot be paid until it is.',
        'Open Profile > Bank account to submit it for verification.',
      );
    }

    const fraudHold = await queryOne<{ count: string }>(
      client,
      `SELECT count(*)::text AS count FROM fraud_flags
        WHERE entity_type = 'AGENT' AND entity_id = $1
          AND status IN ('OPEN','UNDER_REVIEW') AND severity IN ('HIGH','CRITICAL')`,
      [params.agentId],
    );
    if (Number.parseInt(fraudHold?.count ?? '0', 10) > 0) {
      throw conflict(
        'FRAUD_HOLD_ACTIVE',
        'Commission payout is on hold while a review of your account is completed.',
        'Your supervisor can tell you more.',
      );
    }

    const eligible = await query<{ id: string; amount_kobo: string }>(
      client,
      `SELECT id, amount_kobo FROM commissions
        WHERE agent_id = $1 AND status = 'ELIGIBLE' FOR UPDATE`,
      [params.agentId],
    );

    if (eligible.length === 0) {
      throw conflict(
        'NO_ELIGIBLE_COMMISSION',
        'You have no commission that is eligible for payout yet. ' +
          'Commission becomes eligible once the transaction has been settled and the hold period has passed.',
      );
    }

    const total = eligible.reduce((sum, row) => sum + parseKobo(row.amount_kobo), 0n);
    const payoutReference = await nextPayoutReference(client);

    const payout = await queryOne<{ id: string }>(
      client,
      `INSERT INTO commission_payouts
         (payout_reference, agent_id, bank_account_id, amount_kobo, commission_count, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,'REQUESTED',$6) RETURNING id`,
      [
        payoutReference,
        params.agentId,
        agent.bank_account_id,
        total.toString(),
        eligible.length,
        params.actorId,
      ],
    );

    const approval = await queryOne<{ id: string }>(
      client,
      `INSERT INTO approvals
         (approval_type, entity_type, entity_id, payload, requested_by, requested_reason)
       VALUES ('COMMISSION_PAYOUT','commission_payout',$1,$2,$3,$4) RETURNING id`,
      [
        payout!.id,
        JSON.stringify({
          payoutReference,
          agentId: params.agentId,
          amountKobo: total.toString(),
          commissionCount: eligible.length,
        }),
        params.actorId,
        'Agent requested payout of eligible commission',
      ],
    );

    await client.query('UPDATE commission_payouts SET approval_id = $2 WHERE id = $1', [
      payout!.id,
      approval!.id,
    ]);

    for (const commission of eligible) {
      await transitionCommission(client, {
        commissionId: commission.id,
        to: 'APPROVED',
        reason: `Included in payout ${payoutReference}`,
        actorId: params.actorId,
        payoutId: payout!.id,
      });
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'commission.payout_requested',
      entityType: 'commission_payout',
      entityId: payout!.id,
      newValue: {
        payoutReference,
        amountKobo: total.toString(),
        commissionCount: eligible.length,
      },
    });

    return {
      payoutId: payout!.id,
      payoutReference,
      amountKobo: total,
      commissionCount: eligible.length,
    };
  });
}

/**
 * Complete an approved payout by recording the bank transfer reference.
 * PRD §28: no commission is marked paid without one.
 */
export async function completePayout(params: {
  payoutId: string;
  bankReference: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const payout = await queryOne<{ id: string; status: string; approval_id: string | null }>(
      client,
      'SELECT id, status, approval_id FROM commission_payouts WHERE id = $1 FOR UPDATE',
      [params.payoutId],
    );
    if (!payout) throw notFound('That payout');

    if (payout.status !== 'APPROVED') {
      throw conflict(
        'PAYOUT_NOT_APPROVED',
        `This payout is ${payout.status.toLowerCase()} and cannot be marked as paid. ` +
          'It must be approved first.',
      );
    }

    await client.query(
      `UPDATE commission_payouts
          SET status = 'PAID', bank_reference = $2, paid_at = now()
        WHERE id = $1`,
      [params.payoutId, params.bankReference],
    );

    const commissions = await query<{ id: string }>(
      client,
      `SELECT id FROM commissions WHERE payout_id = $1 AND status = 'APPROVED' FOR UPDATE`,
      [params.payoutId],
    );

    for (const commission of commissions) {
      await transitionCommission(client, {
        commissionId: commission.id,
        to: 'PAID',
        actorId: params.actorId,
        payoutId: params.payoutId,
      });
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'commission.payout_paid',
      entityType: 'commission_payout',
      entityId: params.payoutId,
      newValue: { bankReference: params.bankReference, commissionCount: commissions.length },
    });
  });
}
