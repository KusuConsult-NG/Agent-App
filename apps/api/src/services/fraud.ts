/**
 * Fraud and leakage detection (PRD §32, §72; Addendum §30).
 *
 * Every rule here raises a *flag*, never a block or a deletion — PRD §32:
 * "Suspicious transactions should be flagged rather than automatically
 * deleted." A legitimate market-day agent processing many small transactions
 * must not be cut off by a heuristic; a human reviews the flag.
 *
 * The one place a flag does bite automatically is commission: a HIGH or
 * CRITICAL open flag holds the agent's incentive until it is resolved (PRD
 * §28), which withholds reward without withholding service from taxpayers.
 */

import type { PoolClient } from 'pg';
import type { FraudRule, FraudSeverity } from '@psirs/shared';
import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import { log } from '../lib/logger';

interface FlagInput {
  rule: FraudRule | 'AMOUNT_MISMATCH';
  severity: FraudSeverity;
  entityType:
    | 'TRANSACTION'
    | 'AGENT'
    | 'TAXPAYER'
    | 'DEVICE'
    | 'REFEREE'
    | 'COMMISSION'
    | 'SETTLEMENT';
  entityId: string;
  agentId?: string | null;
  transactionId?: string | null;
  detail: Record<string, unknown>;
}

/**
 * How long an officer's decision covers.
 *
 * A flag asks for a human decision, and the sweep that raises it runs every
 * fifteen minutes. Declining to duplicate a flag that is still OPEN was not
 * enough: a flag that had been *decided* did not count, so an officer who
 * investigated a signal, found the explanation and dismissed it — releasing
 * the agent's frozen commission — was overruled minutes later by the same rule
 * reading the same unchanged evidence. The agent's money froze again, a fresh
 * flag appeared looking like a new detection, and the only way to make the
 * decision hold was to keep making it.
 *
 * So a decision covers the window of evidence it was made about. While the
 * rule is still looking at what the officer looked at, the answer is the one
 * they gave; once the window has rolled past, what the rule sees is new and
 * worth asking about again. A dismissal silences a signal for a stated period,
 * never for good.
 *
 * The windows are each rule's own, with one exception. RAPID_SUCCESSION reads
 * twenty seconds, and a decision that expires before the officer has closed
 * the page is not a decision; what they are judging is the agent's burst
 * pattern over the shift, so it takes the hour that the other velocity rules
 * do. The two standing conditions — several taxpayers on one phone, duplicate
 * details — are not windows at all but facts about a register that a human has
 * looked at and accepted, and they hold until there is reason to look again.
 *
 * Typed against the full rule set so that a rule added without a window fails
 * to compile rather than quietly inheriting somebody else's.
 */
const DECISION_HOLDS: Record<FraudRule | 'AMOUNT_MISMATCH', string> = {
  DEVICE_VELOCITY: '1 hour',
  UNUSUAL_VOLUME: '1 hour',
  RAPID_SUCCESSION: '1 hour',
  REPEATED_FAILED_PAYMENTS: '1 hour',
  OUT_OF_TERRITORY: '1 hour',
  REVERSAL_PATTERN: '30 days',
  COMMISSION_ANOMALY: '30 days',
  AMOUNT_MISMATCH: '30 days',
  SHARED_PHONE_NUMBER: '90 days',
  // A settlement is a single banking event: once an officer has accounted for
  // its variance, the same batch never produces new evidence.
  SETTLEMENT_VARIANCE: '90 days',
  DUPLICATE_TAXPAYER_DETAILS: '90 days',
};

type RaiseOutcome = 'RAISED' | 'ALREADY_OPEN' | 'ALREADY_DECIDED';

export async function raiseFlag(client: PoolClient, input: FlagInput): Promise<RaiseOutcome> {
  // Re-raising an identical open flag adds noise without adding information,
  // so an existing open flag for the same rule and entity is left alone — and
  // so is one an officer has already decided about this same evidence.
  const existing = await queryOne<{ id: string; status: string; decided: boolean }>(
    client,
    `SELECT id, status, (status NOT IN ('OPEN', 'UNDER_REVIEW')) AS decided
       FROM fraud_flags
      WHERE rule = $1 AND entity_type = $2 AND entity_id = $3
        AND (
          status IN ('OPEN', 'UNDER_REVIEW')
          OR (reviewed_at IS NOT NULL AND reviewed_at > now() - $4::interval)
        )
      ORDER BY created_at DESC LIMIT 1`,
    [input.rule, input.entityType, input.entityId, DECISION_HOLDS[input.rule]],
  );

  if (existing?.decided) {
    // Said out loud, because a rule that fires and leaves no flag is otherwise
    // indistinguishable from a rule that never fired.
    log.info('fraud signal deferred to an existing decision', {
      component: 'fraud',
      rule: input.rule,
      entityType: input.entityType,
      entityId: input.entityId,
      flagId: existing.id,
      decision: existing.status,
      holdsFor: DECISION_HOLDS[input.rule],
    });
    return 'ALREADY_DECIDED';
  }
  if (existing) return 'ALREADY_OPEN';

  await client.query(
    `INSERT INTO fraud_flags
       (rule, severity, entity_type, entity_id, agent_id, transaction_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.rule,
      input.severity,
      input.entityType,
      input.entityId,
      input.agentId ?? null,
      input.transactionId ?? null,
      JSON.stringify(input.detail),
    ],
  );
  return 'RAISED';
}

/** Thresholds, kept together so government can tune them in one place. */
const THRESHOLDS = {
  deviceTransactionsPerHour: 40,
  agentTransactionsPerHour: 60,
  rapidSuccessionSeconds: 20,
  rapidSuccessionCount: 5,
  sharedPhoneTaxpayers: 4,
  failedPaymentsPerHour: 8,
  reversalRatePercent: 15,
  reversalMinimumSample: 10,
  refereeAgentLimit: 5,
} as const;

/**
 * Evaluate risk signals around one transaction (PRD §32).
 * Runs inside the verification transaction so a flag is committed with the
 * transaction that provoked it.
 */
export async function evaluateTransactionRisk(
  client: PoolClient,
  params: { transactionId: string },
): Promise<void> {
  const transaction = await queryOne<{
    id: string;
    agent_id: string | null;
    device_id: string | null;
    lga_id: string;
    taxpayer_id: string;
    territory_id: string | null;
    created_at: Date;
    agent_territory_lga: string | null;
    // Names as well as ids. A signal is raised for a person to review, and
    // "out of territory" is a claim about which two territories — answering it
    // with a pair of UUIDs makes the reviewer query the database to learn the
    // one fact the flag exists to convey.
    lga_name: string | null;
    agent_territory_lga_name: string | null;
  }>(
    client,
    `SELECT t.id, t.agent_id, t.device_id, t.lga_id, t.taxpayer_id, t.territory_id, t.created_at,
            ter.lga_id AS agent_territory_lga,
            tl.name    AS lga_name,
            al.name    AS agent_territory_lga_name
       FROM transactions t
       LEFT JOIN agents a ON a.id = t.agent_id
       LEFT JOIN territories ter ON ter.id = a.territory_id
       LEFT JOIN lgas tl ON tl.id = t.lga_id
       LEFT JOIN lgas al ON al.id = ter.lga_id
      WHERE t.id = $1`,
    [params.transactionId],
  );

  if (!transaction || !transaction.agent_id) return;

  // Out of assigned territory (PRD §32, §74).
  if (transaction.agent_territory_lga && transaction.agent_territory_lga !== transaction.lga_id) {
    await raiseFlag(client, {
      rule: 'OUT_OF_TERRITORY',
      severity: 'MEDIUM',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      agentId: transaction.agent_id,
      transactionId: transaction.id,
      detail: {
        // Named first so the reviewer reads the fact before the identifiers.
        collectedIn: transaction.lga_name,
        agentAssignedTo: transaction.agent_territory_lga_name,
        transactionLgaId: transaction.lga_id,
        agentTerritoryLgaId: transaction.agent_territory_lga,
      },
    });
  }

  // Device velocity.
  if (transaction.device_id) {
    const count = await queryOne<{ count: string }>(
      client,
      `SELECT count(*)::text AS count FROM transactions
        WHERE device_id = $1 AND created_at > now() - interval '1 hour'`,
      [transaction.device_id],
    );
    const value = Number.parseInt(count?.count ?? '0', 10);
    if (value > THRESHOLDS.deviceTransactionsPerHour) {
      await raiseFlag(client, {
        rule: 'DEVICE_VELOCITY',
        severity: 'HIGH',
        entityType: 'DEVICE',
        entityId: transaction.device_id,
        agentId: transaction.agent_id,
        transactionId: transaction.id,
        detail: { transactionsInLastHour: value, threshold: THRESHOLDS.deviceTransactionsPerHour },
      });
    }
  }

  // Rapid succession — many transactions within seconds of each other.
  const rapid = await queryOne<{ count: string }>(
    client,
    `SELECT count(*)::text AS count FROM transactions
      WHERE agent_id = $1 AND created_at > now() - make_interval(secs => $2)`,
    [transaction.agent_id, THRESHOLDS.rapidSuccessionSeconds],
  );
  if (Number.parseInt(rapid?.count ?? '0', 10) >= THRESHOLDS.rapidSuccessionCount) {
    await raiseFlag(client, {
      rule: 'RAPID_SUCCESSION',
      severity: 'MEDIUM',
      entityType: 'AGENT',
      entityId: transaction.agent_id,
      agentId: transaction.agent_id,
      transactionId: transaction.id,
      detail: {
        windowSeconds: THRESHOLDS.rapidSuccessionSeconds,
        count: Number.parseInt(rapid?.count ?? '0', 10),
      },
    });
  }

  // Unusual hourly volume for this agent.
  const volume = await queryOne<{ count: string }>(
    client,
    `SELECT count(*)::text AS count FROM transactions
      WHERE agent_id = $1 AND created_at > now() - interval '1 hour'`,
    [transaction.agent_id],
  );
  if (Number.parseInt(volume?.count ?? '0', 10) > THRESHOLDS.agentTransactionsPerHour) {
    await raiseFlag(client, {
      rule: 'UNUSUAL_VOLUME',
      severity: 'MEDIUM',
      entityType: 'AGENT',
      entityId: transaction.agent_id,
      agentId: transaction.agent_id,
      transactionId: transaction.id,
      detail: { transactionsInLastHour: Number.parseInt(volume?.count ?? '0', 10) },
    });
  }
}

/** Signals around taxpayer registration (PRD §32). */
export async function evaluateRegistrationRisk(
  client: PoolClient,
  params: { taxpayerId: string; agentId?: string | null; phone: string },
): Promise<void> {
  const shared = await queryOne<{ count: string }>(
    client,
    `SELECT count(*)::text AS count FROM taxpayers WHERE phone = $1 AND status = 'ACTIVE'`,
    [params.phone],
  );

  const value = Number.parseInt(shared?.count ?? '0', 10);
  if (value >= THRESHOLDS.sharedPhoneTaxpayers) {
    await raiseFlag(client, {
      rule: 'SHARED_PHONE_NUMBER',
      severity: 'MEDIUM',
      entityType: 'TAXPAYER',
      entityId: params.taxpayerId,
      agentId: params.agentId ?? null,
      detail: { phoneUsedByTaxpayers: value, threshold: THRESHOLDS.sharedPhoneTaxpayers },
    });
  }

  if (params.agentId) {
    // Duplicate-warning overrides by the same agent (PRD §68).
    const overrides = await queryOne<{ count: string }>(
      client,
      `SELECT count(*)::text AS count FROM taxpayer_duplicate_checks c
         JOIN agents a ON a.user_id = c.performed_by
        WHERE a.id = $1 AND c.decision = 'PROCEEDED'
          AND c.created_at > now() - interval '7 days'`,
      [params.agentId],
    );
    if (Number.parseInt(overrides?.count ?? '0', 10) >= 5) {
      await raiseFlag(client, {
        rule: 'DUPLICATE_TAXPAYER_DETAILS',
        severity: 'HIGH',
        entityType: 'AGENT',
        entityId: params.agentId,
        agentId: params.agentId,
        detail: {
          duplicateWarningsOverriddenInLast7Days: Number.parseInt(overrides?.count ?? '0', 10),
        },
      });
    }
  }
}

/** Referee risk controls (Addendum §30, §46). */
export async function evaluateRefereeRisk(
  client: PoolClient,
  params: { refereeId: string },
): Promise<void> {
  const referee = await queryOne<{
    id: string;
    phone: string;
    agent_id: string;
    identity_hash: string | null;
  }>(
    client,
    `SELECT r.id, r.phone, r.agent_id, k.identity_number_hash AS identity_hash
       FROM referees r LEFT JOIN referee_kyc k ON k.referee_id = r.id
      WHERE r.id = $1`,
    [params.refereeId],
  );
  if (!referee) return;

  const insertFlag = async (rule: string, severity: FraudSeverity, detail: Record<string, unknown>) => {
    const existing = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM referee_risk_flags
        WHERE referee_id = $1 AND rule = $2 AND status IN ('OPEN','UNDER_REVIEW')`,
      [params.refereeId, rule],
    );
    if (existing) return;
    await client.query(
      `INSERT INTO referee_risk_flags (referee_id, rule, severity, detail) VALUES ($1,$2,$3,$4)`,
      [params.refereeId, rule, severity, JSON.stringify(detail)],
    );
  };

  // One person vouching for an unusual number of applicants.
  const supported = await queryOne<{ count: string }>(
    client,
    `SELECT count(DISTINCT agent_id)::text AS count FROM referees
      WHERE phone = $1 AND status <> 'REPLACED'`,
    [referee.phone],
  );
  const supportedCount = Number.parseInt(supported?.count ?? '0', 10);
  if (supportedCount > THRESHOLDS.refereeAgentLimit) {
    await insertFlag('REFEREE_SUPPORTS_MANY_AGENTS', 'HIGH', {
      agentsSupported: supportedCount,
      threshold: THRESHOLDS.refereeAgentLimit,
    });
  }

  // Referee and applicant sharing a phone number — they must be different people.
  const sharedWithApplicant = await queryOne<{ count: string }>(
    client,
    `SELECT count(*)::text AS count
       FROM agents a JOIN users u ON u.id = a.user_id
      WHERE a.id = $1 AND u.phone = $2`,
    [referee.agent_id, referee.phone],
  );
  if (Number.parseInt(sharedWithApplicant?.count ?? '0', 10) > 0) {
    await insertFlag('REFEREE_SHARES_APPLICANT_CONTACT', 'CRITICAL', {
      reason: 'The referee phone number is the same as the applicant phone number',
    });
  }

  if (referee.identity_hash) {
    const sameIdentity = await queryOne<{ count: string }>(
      client,
      `SELECT count(DISTINCT r.agent_id)::text AS count
         FROM referee_kyc k JOIN referees r ON r.id = k.referee_id
        WHERE k.identity_number_hash = $1`,
      [referee.identity_hash],
    );
    if (Number.parseInt(sameIdentity?.count ?? '0', 10) > THRESHOLDS.refereeAgentLimit) {
      await insertFlag('REFEREE_IDENTITY_REUSED', 'HIGH', {
        agentsSupported: Number.parseInt(sameIdentity?.count ?? '0', 10),
      });
    }
  }
}

/**
 * Periodic sweep for patterns that only appear in aggregate (PRD §72):
 * reversal-heavy agents, repeated failed payments, unreconciled money.
 */
export async function runFraudSweep(client: PoolClient): Promise<{ flagsRaised: number }> {
  let raised = 0;

  const reversalHeavy = await query<{ agent_id: string; total: string; reversed: string }>(
    client,
    `SELECT agent_id,
            count(*)::text AS total,
            count(*) FILTER (WHERE status IN ('REVERSED','REFUNDED'))::text AS reversed
       FROM transactions
      WHERE agent_id IS NOT NULL AND created_at > now() - interval '30 days'
      GROUP BY agent_id
     HAVING count(*) >= $1`,
    [THRESHOLDS.reversalMinimumSample],
  );

  for (const row of reversalHeavy) {
    const total = Number.parseInt(row.total, 10);
    const reversed = Number.parseInt(row.reversed, 10);
    const rate = (reversed / total) * 100;
    if (rate >= THRESHOLDS.reversalRatePercent) {
      await raiseFlag(client, {
        rule: 'REVERSAL_PATTERN',
        severity: 'HIGH',
        entityType: 'AGENT',
        entityId: row.agent_id,
        agentId: row.agent_id,
        detail: { reversalRatePercent: Number(rate.toFixed(2)), sample: total },
      });
      raised += 1;
    }
  }

  const failedPayments = await query<{ agent_id: string; count: string }>(
    client,
    `SELECT t.agent_id, count(*)::text AS count
       FROM payments p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.status IN ('FAILED','ABANDONED')
        AND p.created_at > now() - interval '1 hour'
        AND t.agent_id IS NOT NULL
      GROUP BY t.agent_id
     HAVING count(*) > $1`,
    [THRESHOLDS.failedPaymentsPerHour],
  );

  for (const row of failedPayments) {
    await raiseFlag(client, {
      rule: 'REPEATED_FAILED_PAYMENTS',
      severity: 'MEDIUM',
      entityType: 'AGENT',
      entityId: row.agent_id,
      agentId: row.agent_id,
      detail: { failedPaymentsInLastHour: Number.parseInt(row.count, 10) },
    });
    raised += 1;
  }

  return { flagsRaised: raised };
}

/** Revenue leakage dashboard (PRD §72). */
export async function leakageDashboard(db: Db) {
  const [unreconciled, missingSettlement, duplicatePayments, openFlags, highRiskAgents, verificationFailures] =
    await Promise.all([
      queryOne(
        db,
        `SELECT count(*)::text AS count, COALESCE(SUM(amount_kobo),0)::text AS amount_kobo
           FROM transactions
          WHERE status = 'RECONCILIATION_PENDING'
            AND created_at < now() - interval '48 hours'`,
      ),
      queryOne(
        db,
        `SELECT count(*)::text AS count, COALESCE(SUM(expected_amount_kobo - received_amount_kobo),0)::text AS variance_kobo
           FROM settlements WHERE status IN ('PENDING','DISPUTED')`,
      ),
      queryOne(
        db,
        `SELECT count(*)::text AS count FROM reconciliation_records WHERE status = 'DUPLICATE_PAYMENT'`,
      ),
      query(
        db,
        `SELECT rule, severity, count(*)::text AS count
           FROM fraud_flags WHERE status IN ('OPEN','UNDER_REVIEW')
          GROUP BY rule, severity ORDER BY count(*) DESC`,
      ),
      query(
        db,
        `SELECT a.id, a.agent_code, u.full_name, count(f.id)::text AS flag_count,
                max(f.severity) AS highest_severity
           FROM fraud_flags f
           JOIN agents a ON a.id = f.agent_id
           JOIN users u ON u.id = a.user_id
          WHERE f.status IN ('OPEN','UNDER_REVIEW')
          GROUP BY a.id, a.agent_code, u.full_name
          ORDER BY count(f.id) DESC LIMIT 20`,
      ),
      queryOne(
        db,
        `SELECT count(*)::text AS count FROM verification_attempts
          WHERE result IN ('INVALID','NOT_FOUND') AND created_at > now() - interval '30 days'`,
      ),
    ]);

  return {
    unreconciledOver48Hours: unreconciled,
    settlementsOutstanding: missingSettlement,
    duplicatePayments: duplicatePayments,
    openFlagsByRule: openFlags,
    highRiskAgents,
    failedReceiptVerifications: verificationFailures,
  };
}
