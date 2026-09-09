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
    | 'SETTLEMENT'
    | 'USER'
    | 'DOCUMENT';
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
  /*
   * The four that watch the office rather than the field.
   *
   * All read a window measured in days, so a dismissal has to hold for at
   * least that long or the sweep re-raises the flag from evidence the officer
   * has already been shown. A regenerated document is the exception in kind
   * rather than in length: reissues accumulate and never fall out of the
   * count, so the hold is what stops a decided flag returning every quarter
   * of an hour for the rest of the document's life.
   */
  REPEATED_RECEIPT_REGENERATION: '90 days',
  UNUSUAL_TRANSACTION_TIMING: '7 days',
  UNUSUAL_OFFICER_ACTIVITY: '7 days',
  FREQUENT_MANUAL_INTERVENTION: '30 days',
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
  /*
   * Watching the office.
   *
   * Each of these is deliberately loose. A flag costs an officer's attention
   * and, where it lands on an agent, their commission; a threshold tight
   * enough to catch every wrongdoer catches the whole of a busy Monday with
   * it, and a queue that is mostly noise is a queue nobody reads. These are
   * set to fire on the shape that is hard to explain, not on the shape that is
   * merely above average.
   */

  // A receipt is issued once. Two documents for one entity is a reversal and a
  // reissue, which is ordinary; four is somebody producing copies.
  receiptReissues: 3,
  // The same person pulling the same document down again and again. A
  // legitimate reprint or two happens at a counter; twelve does not.
  receiptRetrievalsPerDay: 12,
  /*
   * Local night, in Africa/Lagos, which is where every one of these markets
   * is. Collections do happen in the evening -- a motor park at eight is a
   * working place -- so the window is the part of the night when a receipt
   * being written means somebody is at a keyboard rather than at a stall.
   */
  nightStartHour: 23,
  nightEndHour: 5,
  nightTransactionsPerWeek: 6,
  /*
   * An officer's own working rhythm, not a fleet average: a busy revenue
   * office legitimately writes ten times what a small one does, so the
   * comparison is against what this officer did over the preceding weeks.
   */
  officerActivityMultiple: 4,
  officerActivityFloor: 60,
  officerActivityBaselineDays: 28,
  // Reversals, corrections and adjustments by one officer in a month. Every
  // one is individually approved; the pattern is what nobody sees.
  manualInterventionsPerMonth: 15,
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

  raised += await sweepReceiptRegeneration(client);
  raised += await sweepTransactionTiming(client);
  raised += await sweepOfficerActivity(client);
  raised += await sweepManualIntervention(client);

  return { flagsRaised: raised };
}

/**
 * A document that is supposed to exist once, existing several times.
 *
 * Issuance on this platform is idempotent -- `issueReceipt` returns the
 * document already on file rather than rendering a second one -- so a receipt
 * cannot simply be regenerated at will. There are two ways more than one ends
 * up in circulation anyway, and this rule watches both.
 *
 * A reversal revokes the receipt; if the payment is later re-verified a fresh
 * one is issued, which is correct, and a taxpayer whose transaction has been
 * reversed and reissued four times is not having an ordinary week. And a
 * single document can be pulled down again and again, which is the same thing
 * from the other end: nothing about a PDF stops the eighth copy circulating as
 * though it were the first.
 *
 * Filed against the document rather than the transaction. The money may be
 * perfectly good; what is in question is how many pieces of paper claim it.
 */
async function sweepReceiptRegeneration(client: PoolClient): Promise<number> {
  let raised = 0;

  const reissued = await query<{
    entity_type: string;
    entity_id: string;
    latest_document_id: string;
    issues: string;
  }>(
    client,
    `SELECT entity_type,
            entity_id::text AS entity_id,
            (array_agg(id ORDER BY created_at DESC))[1]::text AS latest_document_id,
            count(*)::text AS issues
       FROM documents
      WHERE entity_type IS NOT NULL
        AND entity_id IS NOT NULL
        AND document_type IN ('RECEIPT', 'VEHICLE_RENEWAL')
      GROUP BY entity_type, entity_id
     HAVING count(*) >= $1`,
    [THRESHOLDS.receiptReissues],
  );

  for (const row of reissued) {
    await raiseFlag(client, {
      rule: 'REPEATED_RECEIPT_REGENERATION',
      severity: 'HIGH',
      entityType: 'DOCUMENT',
      entityId: row.latest_document_id,
      detail: {
        reason: 'REISSUED',
        documentsIssued: Number.parseInt(row.issues, 10),
        forEntityType: row.entity_type,
        forEntityId: row.entity_id,
        threshold: THRESHOLDS.receiptReissues,
      },
    });
    raised += 1;
  }

  /*
   * Retrievals are counted per person, not per document.
   *
   * A receipt a hundred citizens verify is a receipt doing its job; the same
   * officer fetching one document twelve times in a day is the signal. The
   * count excludes VERIFY, which is the public check anybody may run against a
   * verification code and carries no actor at all.
   */
  const retrieved = await query<{ document_id: string; accessed_by: string; retrievals: string }>(
    client,
    `SELECT document_id::text AS document_id,
            accessed_by::text AS accessed_by,
            count(*)::text AS retrievals
       FROM document_access_logs
      WHERE access_type IN ('DOWNLOAD', 'SHARE')
        AND accessed_by IS NOT NULL
        AND created_at > now() - interval '1 day'
      GROUP BY document_id, accessed_by
     HAVING count(*) > $1`,
    [THRESHOLDS.receiptRetrievalsPerDay],
  );

  for (const row of retrieved) {
    await raiseFlag(client, {
      rule: 'REPEATED_RECEIPT_REGENERATION',
      severity: 'MEDIUM',
      entityType: 'DOCUMENT',
      entityId: row.document_id,
      detail: {
        reason: 'RETRIEVED',
        retrievalsInLastDay: Number.parseInt(row.retrievals, 10),
        byUserId: row.accessed_by,
        threshold: THRESHOLDS.receiptRetrievalsPerDay,
      },
    });
    raised += 1;
  }

  return raised;
}

/**
 * Collections written in the middle of the night.
 *
 * The hour is read in Africa/Lagos, because the question is what the person
 * was doing at the time and not what UTC said. A single late transaction
 * proves nothing -- a motor park runs late, and a queue that closes at
 * midnight closes at midnight -- so the rule needs a habit: several, over a
 * week, by the same agent.
 *
 * What it is really asking is whether collections are being *entered* rather
 * than *taken*: a day's cash written up at three in the morning, from a
 * notebook, with the amounts decided afterwards.
 */
async function sweepTransactionTiming(client: PoolClient): Promise<number> {
  let raised = 0;

  const nightWorkers = await query<{ agent_id: string; night_count: string; total: string }>(
    client,
    `SELECT agent_id,
            count(*) FILTER (
              WHERE EXTRACT(HOUR FROM created_at AT TIME ZONE 'Africa/Lagos') >= $1
                 OR EXTRACT(HOUR FROM created_at AT TIME ZONE 'Africa/Lagos') < $2
            )::text AS night_count,
            count(*)::text AS total
       FROM transactions
      WHERE agent_id IS NOT NULL
        AND created_at > now() - interval '7 days'
      GROUP BY agent_id`,
    [THRESHOLDS.nightStartHour, THRESHOLDS.nightEndHour],
  );

  for (const row of nightWorkers) {
    const nightCount = Number.parseInt(row.night_count, 10);
    if (nightCount < THRESHOLDS.nightTransactionsPerWeek) continue;
    await raiseFlag(client, {
      rule: 'UNUSUAL_TRANSACTION_TIMING',
      severity: 'MEDIUM',
      entityType: 'AGENT',
      entityId: row.agent_id,
      agentId: row.agent_id,
      detail: {
        nightTransactionsInLastWeek: nightCount,
        transactionsInLastWeek: Number.parseInt(row.total, 10),
        nightBeginsAtHour: THRESHOLDS.nightStartHour,
        nightEndsAtHour: THRESHOLDS.nightEndHour,
        timeZone: 'Africa/Lagos',
      },
    });
    raised += 1;
  }

  return raised;
}

/**
 * An officer whose day does not look like their other days.
 *
 * Compared against the officer's own preceding four weeks rather than against
 * their colleagues, because revenue offices differ by an order of magnitude
 * and a fleet average would flag the busiest office every morning and never
 * notice a quiet one doubling.
 *
 * The floor matters as much as the multiple. Four times a baseline of two
 * actions is eight actions, which is a Tuesday; without it the rule would
 * spend its life reporting officers who normally do very little and today did
 * a little more. Both conditions have to hold.
 */
async function sweepOfficerActivity(client: PoolClient): Promise<number> {
  let raised = 0;

  const officers = await query<{ actor_id: string; today: string; baseline_per_day: string }>(
    client,
    `WITH recent AS (
       SELECT actor_id,
              count(*) FILTER (WHERE created_at > now() - interval '1 day')::numeric AS today,
              count(*) FILTER (
                WHERE created_at <= now() - interval '1 day'
                  AND created_at > now() - ($1 || ' days')::interval
              )::numeric AS earlier
         FROM audit_logs
        WHERE actor_id IS NOT NULL
          AND result = 'SUCCESS'
          AND created_at > now() - ($1 || ' days')::interval
        GROUP BY actor_id
     )
     SELECT r.actor_id::text AS actor_id,
            r.today::text AS today,
            (r.earlier / GREATEST($1::numeric - 1, 1))::text AS baseline_per_day
       FROM recent r
       JOIN users u ON u.id = r.actor_id
      WHERE u.role <> 'agent'`,
    [THRESHOLDS.officerActivityBaselineDays],
  );

  for (const row of officers) {
    const today = Number(row.today);
    const baseline = Number(row.baseline_per_day);
    if (today < THRESHOLDS.officerActivityFloor) continue;
    /*
     * A baseline of zero is a new officer's first working day, not a spike.
     * Dividing by it would make every joiner's first afternoon an anomaly and
     * teach the queue's readers to dismiss the rule.
     */
    if (baseline <= 0) continue;
    if (today < baseline * THRESHOLDS.officerActivityMultiple) continue;

    await raiseFlag(client, {
      rule: 'UNUSUAL_OFFICER_ACTIVITY',
      severity: 'MEDIUM',
      entityType: 'USER',
      entityId: row.actor_id,
      detail: {
        actionsInLastDay: today,
        usualActionsPerDay: Number(baseline.toFixed(2)),
        baselineDays: THRESHOLDS.officerActivityBaselineDays,
        multiple: Number((today / baseline).toFixed(2)),
      },
    });
    raised += 1;
  }

  return raised;
}

/**
 * How often one officer has had to step in and change the record by hand.
 *
 * Every one of these is individually legitimate: each was requested with a
 * reason, approved by somebody else, and written to the audit log. That is
 * exactly why the pattern is invisible -- nobody is looking at the fifteen
 * together, because each was looked at once, alone, weeks apart.
 *
 * A high count is not an accusation. It is as likely to mean a broken upstream
 * process, or an officer covering for one, as anything else; either way it is
 * the thing PSIRS would want to know about and currently could not see.
 */
async function sweepManualIntervention(client: PoolClient): Promise<number> {
  let raised = 0;

  const interveners = await query<{ requested_by: string; count: string; kinds: string[] }>(
    client,
    `SELECT requested_by::text AS requested_by,
            count(*)::text AS count,
            array_agg(DISTINCT approval_type) AS kinds
       FROM approvals
      WHERE approval_type IN (
              'MANUAL_CORRECTION', 'TAXPAYER_ADJUSTMENT', 'PAYMENT_REVERSAL',
              'REFUND', 'COMMISSION_ADJUSTMENT')
        AND status IN ('APPROVED', 'EXECUTED')
        AND requested_at > now() - interval '30 days'
      GROUP BY requested_by
     HAVING count(*) > $1`,
    [THRESHOLDS.manualInterventionsPerMonth],
  );

  for (const row of interveners) {
    await raiseFlag(client, {
      rule: 'FREQUENT_MANUAL_INTERVENTION',
      severity: 'MEDIUM',
      entityType: 'USER',
      entityId: row.requested_by,
      detail: {
        interventionsInLastMonth: Number.parseInt(row.count, 10),
        kinds: row.kinds,
        threshold: THRESHOLDS.manualInterventionsPerMonth,
      },
    });
    raised += 1;
  }

  return raised;
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
