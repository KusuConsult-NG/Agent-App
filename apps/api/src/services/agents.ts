/**
 * Agent clearance pipeline (PRD Addendum §2-§41).
 *
 *   "No KYC + No Referee Clearance = No Agent Activation."
 *   "No Agent Activation = No Access to Revenue Collection Functions."
 *
 * Those rules are enforced in three independent places, so defeating one is
 * not enough:
 *   1. the CHECK constraint `agent_activation_requires_clearance` on `agents`;
 *   2. `activate()` below, which refuses while any checklist item is unmet;
 *   3. `requireActiveAgent` middleware on every revenue route.
 *
 * The single generic `status` field the addendum warns against (§31) does not
 * exist here: the six status axes are separate columns and the application
 * state shown to the applicant is always *derived* from them.
 */

import type { PoolClient } from 'pg';
import {
  activationBlockers,
  deriveAccessStage,
  deriveApplicationState,
  TRAINING_MODULES,
  type AgentClearanceFlags,
  type AgentStatusAxes,
  type ApplicationState,
} from '@psirs/shared';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { hashIdentityNumber, hashPassword, maskIdentityNumber } from '../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nextAgentCode, nextApplicationNumber } from '../lib/references';
import { bankVerification, kycProvider, type BankVerificationOutcome } from '../integrations';
import { recordAudit } from './audit';
import { queueNotification } from './notifications';

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

interface AgentStatusRow {
  id: string;
  account_status: string;
  kyc_status: string;
  referee_status: string;
  training_status: string;
  clearance_status: string;
  operational_status: string;
  application_submitted_at: Date | null;
  kyc_cleared: boolean;
  referee_cleared: boolean;
  training_completed: boolean;
  bank_verified: boolean;
  agreement_accepted: boolean;
  device_registered: boolean;
  government_approved: boolean;
}

function toAxes(row: AgentStatusRow): AgentStatusAxes {
  return {
    accountStatus: row.account_status as AgentStatusAxes['accountStatus'],
    kycStatus: row.kyc_status as AgentStatusAxes['kycStatus'],
    refereeStatus: row.referee_status as AgentStatusAxes['refereeStatus'],
    trainingStatus: row.training_status as AgentStatusAxes['trainingStatus'],
    clearanceStatus: row.clearance_status as AgentStatusAxes['clearanceStatus'],
    operationalStatus: row.operational_status as AgentStatusAxes['operationalStatus'],
    applicationSubmitted: row.application_submitted_at !== null,
    flags: {
      kycCleared: row.kyc_cleared,
      refereeCleared: row.referee_cleared,
      trainingCompleted: row.training_completed,
      bankVerified: row.bank_verified,
      agreementAccepted: row.agreement_accepted,
      deviceRegistered: row.device_registered,
      governmentApproved: row.government_approved,
    },
  };
}

const STATUS_SELECT = `
  SELECT a.id, a.account_status, a.kyc_status, a.referee_status, a.training_status,
         a.clearance_status, a.operational_status, a.application_submitted_at,
         COALESCE(c.kyc_cleared,false)         AS kyc_cleared,
         COALESCE(c.referee_cleared,false)     AS referee_cleared,
         COALESCE(c.training_completed,false)  AS training_completed,
         COALESCE(c.bank_verified,false)       AS bank_verified,
         COALESCE(c.agreement_accepted,false)  AS agreement_accepted,
         COALESCE(c.device_registered,false)   AS device_registered,
         COALESCE(c.government_approved,false) AS government_approved
    FROM agents a LEFT JOIN agent_clearance c ON c.agent_id = a.id`;

async function loadAxes(db: Db, agentId: string): Promise<AgentStatusAxes> {
  const row = await queryOne<AgentStatusRow>(db, `${STATUS_SELECT} WHERE a.id = $1`, [agentId]);
  if (!row) throw notFound('That agent');
  return toAxes(row);
}

/** The applicant-facing progress view (Addendum §25, §27). */
export async function getApplicationStatus(db: Db, agentId: string) {
  const axes = await loadAxes(db, agentId);
  const applicationState = deriveApplicationState(axes);

  const [referees, training, devices, kyc, events] = await Promise.all([
    query(
      db,
      `SELECT id, reference_code, full_name, category, relationship, status,
              invited_at, responded_at, cleared_at, rejection_reason
         FROM referees WHERE agent_id = $1 ORDER BY invited_at DESC`,
      [agentId],
    ),
    query(
      db,
      `SELECT m.code, m.title, m.assessed, m.pass_mark, m.mandatory,
              COALESCE(p.status,'NOT_STARTED') AS status, p.score, p.completed_at
         FROM training_modules m
         LEFT JOIN agent_training_progress p ON p.module_id = m.id AND p.agent_id = $1
        WHERE m.status = 'ACTIVE'
        ORDER BY m.sequence_no`,
      [agentId],
    ),
    query(
      db,
      `SELECT id, device_identifier, device_name, browser, operating_system, pwa_version,
              status, registered_at, last_seen_at
         FROM agent_devices WHERE agent_id = $1 ORDER BY registered_at DESC`,
      [agentId],
    ),
    queryOne(
      db,
      `SELECT identity_type, identity_number_masked, verification_status, liveness_result,
              submitted_at, verified_at, failure_reason
         FROM agent_kyc WHERE agent_id = $1 AND superseded_at IS NULL`,
      [agentId],
    ),
    query(
      db,
      `SELECT event_type, from_state, to_state, reason, created_at
         FROM agent_clearance_events WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [agentId],
    ),
  ]);

  return {
    applicationState,
    accessStage: deriveAccessStage(axes),
    statuses: {
      account: axes.accountStatus,
      kyc: axes.kycStatus,
      referee: axes.refereeStatus,
      training: axes.trainingStatus,
      clearance: axes.clearanceStatus,
      operational: axes.operationalStatus,
    },
    checklist: axes.flags,
    outstanding: activationBlockers(axes.flags),
    canCollectRevenue: axes.operationalStatus === 'ACTIVE' && activationBlockers(axes.flags).length === 0,
    kyc,
    referees,
    training,
    devices,
    history: events,
  };
}

async function journal(
  client: PoolClient,
  params: {
    agentId: string;
    eventType: string;
    fromState?: ApplicationState | null;
    toState?: ApplicationState | null;
    reason?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO agent_clearance_events
       (agent_id, event_type, from_state, to_state, reason, actor_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      params.agentId,
      params.eventType,
      params.fromState ?? null,
      params.toState ?? null,
      params.reason ?? null,
      params.actorId ?? null,
      JSON.stringify(params.metadata ?? {}),
    ],
  );
}

/**
 * Recompute the clearance checklist from the underlying evidence.
 *
 * Called after every step. Each flag is derived from a query against the real
 * records rather than being set by whichever handler last ran — so a referee
 * later failing verification withdraws `referee_cleared` automatically, and
 * the agent stops being activatable.
 */
async function refreshClearance(
  client: PoolClient,
  agentId: string,
): Promise<AgentClearanceFlags> {
  const evidence = await queryOne<{
    kyc_cleared: boolean;
    referee_cleared: boolean;
    training_completed: boolean;
    bank_verified: boolean;
    agreement_accepted: boolean;
    device_registered: boolean;
  }>(
    client,
    `SELECT
       EXISTS (SELECT 1 FROM agent_kyc
                WHERE agent_id = $1 AND superseded_at IS NULL AND verification_status = 'CLEARED')
         AS kyc_cleared,
       EXISTS (SELECT 1 FROM referees WHERE agent_id = $1 AND status = 'CLEARED')
         AS referee_cleared,
       NOT EXISTS (
         SELECT 1 FROM training_modules m
          WHERE m.status = 'ACTIVE' AND m.mandatory
            AND NOT EXISTS (
              SELECT 1 FROM agent_training_progress p
               WHERE p.agent_id = $1 AND p.module_id = m.id AND p.status = 'COMPLETED'))
         AS training_completed,
       EXISTS (SELECT 1 FROM agents a JOIN bank_accounts b ON b.id = a.bank_account_id
                WHERE a.id = $1 AND b.verification_status = 'VERIFIED')
         AS bank_verified,
       EXISTS (SELECT 1 FROM agent_agreements WHERE agent_id = $1)
         AS agreement_accepted,
       EXISTS (SELECT 1 FROM agent_devices
                WHERE agent_id = $1 AND status IN ('APPROVED','ACTIVE'))
         AS device_registered`,
    [agentId],
  );

  const current = await queryOne<{ government_approved: boolean }>(
    client,
    'SELECT government_approved FROM agent_clearance WHERE agent_id = $1',
    [agentId],
  );

  const flags: AgentClearanceFlags = {
    kycCleared: evidence!.kyc_cleared,
    refereeCleared: evidence!.referee_cleared,
    trainingCompleted: evidence!.training_completed,
    bankVerified: evidence!.bank_verified,
    agreementAccepted: evidence!.agreement_accepted,
    deviceRegistered: evidence!.device_registered,
    governmentApproved: current?.government_approved ?? false,
  };

  // Ready for review only once identity and referee clearance are both in
  // (Addendum §15).
  const readyForReview = flags.kycCleared && flags.refereeCleared;

  await client.query(
    `INSERT INTO agent_clearance
       (agent_id, kyc_cleared, referee_cleared, training_completed, bank_verified,
        agreement_accepted, device_registered, government_approved, clearance_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (agent_id) DO UPDATE SET
       kyc_cleared = EXCLUDED.kyc_cleared,
       referee_cleared = EXCLUDED.referee_cleared,
       training_completed = EXCLUDED.training_completed,
       bank_verified = EXCLUDED.bank_verified,
       agreement_accepted = EXCLUDED.agreement_accepted,
       device_registered = EXCLUDED.device_registered,
       clearance_status = CASE
         WHEN agent_clearance.clearance_status IN ('APPROVED','REJECTED')
           THEN agent_clearance.clearance_status
         WHEN EXCLUDED.kyc_cleared AND EXCLUDED.referee_cleared THEN 'READY_FOR_REVIEW'
         ELSE 'PENDING' END`,
    [
      agentId,
      flags.kycCleared,
      flags.refereeCleared,
      flags.trainingCompleted,
      flags.bankVerified,
      flags.agreementAccepted,
      flags.deviceRegistered,
      flags.governmentApproved,
      readyForReview ? 'READY_FOR_REVIEW' : 'PENDING',
    ],
  );

  await client.query(
    `UPDATE agents a
        SET referee_status = CASE
              WHEN $2 THEN 'CLEARED'
              WHEN EXISTS (SELECT 1 FROM referees r WHERE r.agent_id = a.id
                            AND r.status IN ('FAILED','REJECTED','EXPIRED'))
                   AND NOT EXISTS (SELECT 1 FROM referees r WHERE r.agent_id = a.id
                                    AND r.status IN ('INVITED','ACCEPTED','SUBMITTED','UNDER_REVIEW'))
                THEN 'FAILED'
              ELSE 'PENDING' END,
            training_status = CASE WHEN $3 THEN 'COMPLETED'
              WHEN EXISTS (SELECT 1 FROM agent_training_progress p
                            WHERE p.agent_id = a.id AND p.status <> 'NOT_STARTED')
                THEN 'IN_PROGRESS' ELSE 'PENDING' END,
            clearance_status = (SELECT clearance_status FROM agent_clearance WHERE agent_id = a.id)
      WHERE a.id = $1`,
    [agentId, flags.refereeCleared, flags.trainingCompleted],
  );

  return flags;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface AgentApplicationInput {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
  alternatePhone?: string;
  address: string;
  lgaId: string;
  wardId?: string;
  community?: string;
  occupation?: string;
  previousOccupation?: string;
  bankName: string;
  bankCode?: string;
  accountName: string;
  accountNumber: string;
}

export async function submitApplication(params: {
  input: AgentApplicationInput;
  ipAddress?: string | null;
}): Promise<{ agentId: string; userId: string; applicationNumber: string; applicationState: ApplicationState }> {
  const { input } = params;

  return withTransaction(async (client) => {
    const existing = await queryOne<{ id: string }>(client, 'SELECT id FROM users WHERE phone = $1', [
      input.phone,
    ]);
    if (existing) {
      throw conflict(
        'PHONE_ALREADY_REGISTERED',
        'An account already exists with this phone number. Sign in instead of applying again.',
      );
    }

    const user = await queryOne<{ id: string }>(
      client,
      `INSERT INTO users (full_name, phone, email, password_hash, role, status)
       VALUES ($1,$2,$3,$4,'agent','ACTIVE') RETURNING id`,
      [input.fullName, input.phone, input.email ?? null, await hashPassword(input.password)],
    );

    const applicationNumber = await nextApplicationNumber(client);

    const agent = await queryOne<{ id: string }>(
      client,
      `INSERT INTO agents
         (user_id, application_number, date_of_birth, gender, alternate_phone, address,
          lga_id, ward_id, community, occupation, previous_occupation,
          account_status, application_submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE', now())
       RETURNING id`,
      [
        user!.id,
        applicationNumber,
        input.dateOfBirth ?? null,
        input.gender ?? null,
        input.alternatePhone ?? null,
        input.address,
        input.lgaId,
        input.wardId ?? null,
        input.community ?? null,
        input.occupation ?? null,
        input.previousOccupation ?? null,
      ],
    );

    // The commission account is captured at application time but is worth
    // nothing until verified — and it can never receive government revenue
    // (Addendum §3).
    const bankAccount = await queryOne<{ id: string }>(
      client,
      `INSERT INTO bank_accounts
         (owner_type, owner_id, bank_name, bank_code, account_name, account_number, verification_status)
       VALUES ('AGENT',$1,$2,$3,$4,$5,'UNVERIFIED') RETURNING id`,
      [agent!.id, input.bankName, input.bankCode ?? null, input.accountName, input.accountNumber],
    );

    await client.query('UPDATE agents SET bank_account_id = $2 WHERE id = $1', [
      agent!.id,
      bankAccount!.id,
    ]);

    await client.query(
      `INSERT INTO agent_clearance (agent_id) VALUES ($1) ON CONFLICT (agent_id) DO NOTHING`,
      [agent!.id],
    );

    await journal(client, {
      agentId: agent!.id,
      eventType: 'APPLICATION_SUBMITTED',
      toState: 'APPLICATION_SUBMITTED',
      actorId: user!.id,
      metadata: { applicationNumber },
    });

    await recordAudit(client, {
      actorId: user!.id,
      actorRole: 'agent',
      action: 'agent.application_submitted',
      entityType: 'agent',
      entityId: agent!.id,
      newValue: { applicationNumber, lgaId: input.lgaId },
      ipAddress: params.ipAddress ?? null,
    });

    return {
      agentId: agent!.id,
      userId: user!.id,
      applicationNumber,
      applicationState: 'APPLICATION_SUBMITTED',
    };
  });
}

// ---------------------------------------------------------------------------
// KYC (Addendum §4-§7)
// ---------------------------------------------------------------------------

/**
 * Submit an applicant's identity for verification.
 *
 * The provider returns one of five outcomes, and four of them are verdicts
 * about this person: they are recorded, they move the application, and the
 * applicant is told where they stand.
 *
 * The fifth, UNAVAILABLE, is not about this person at all — it says the
 * provider could not be asked. Recording it would be recording a verdict nobody
 * reached: the `agent_kyc` row would take up the applicant's one live
 * submission slot, the previous attempt would already have been superseded, and
 * an outage would look in the clearance record exactly like a failed identity
 * check. So nothing is written. The exception below leaves the transaction to
 * roll back — including the supersede — and the applicant is asked to try again
 * rather than being turned away by an outage they had no part in.
 */
export async function submitKyc(params: {
  agentId: string;
  actorId: string;
  identityType: string;
  identityNumber: string;
  selfieDocumentId?: string | null;
  ipAddress?: string | null;
}): Promise<{ status: string; applicationState: ApplicationState; failureReason?: string }> {
  return withTransaction(async (client) => {
    const agent = await queryOne<{
      id: string;
      full_name: string;
      phone: string;
      date_of_birth: Date | null;
      kyc_status: string;
    }>(
      client,
      `SELECT a.id, u.full_name, u.phone, a.date_of_birth, a.kyc_status
         FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
      [params.agentId],
    );
    if (!agent) throw notFound('That agent');

    if (agent.kyc_status === 'CLEARED') {
      throw conflict('KYC_ALREADY_CLEARED', 'Your identity verification has already been completed.');
    }

    // Resubmission supersedes rather than overwrites, so a failed attempt stays
    // in the record (Addendum §28).
    await client.query(
      `UPDATE agent_kyc SET superseded_at = now() WHERE agent_id = $1 AND superseded_at IS NULL`,
      [params.agentId],
    );

    const attempt = await queryOne<{ next: string }>(
      client,
      `SELECT (COALESCE(MAX(attempt_number),0) + 1)::text AS next FROM agent_kyc WHERE agent_id = $1`,
      [params.agentId],
    );

    let selfieChecksum: string | null = null;
    if (params.selfieDocumentId) {
      const doc = await queryOne<{ checksum: string }>(
        client,
        'SELECT checksum FROM kyc_documents WHERE id = $1 AND agent_id = $2',
        [params.selfieDocumentId, params.agentId],
      );
      selfieChecksum = doc?.checksum ?? null;
    }

    const nameParts = agent.full_name.trim().split(/\s+/);
    const verification = await kycProvider.verify({
      identityType: params.identityType,
      identityNumber: params.identityNumber,
      firstName: nameParts[0] ?? agent.full_name,
      lastName: nameParts[nameParts.length - 1] ?? agent.full_name,
      dateOfBirth: agent.date_of_birth?.toISOString().slice(0, 10) ?? null,
      phone: agent.phone,
      selfieChecksum,
    });

    if (verification.status === 'UNAVAILABLE') {
      // Nothing is recorded and nothing is decided. Throwing here rolls the
      // supersede back with it, so the applicant's existing submission — if
      // they had one — survives untouched.
      throw new AppError({
        statusCode: 503,
        code: 'KYC_PROVIDER_UNAVAILABLE',
        message:
          'Your identity could not be checked because the verification service could not be ' +
          'reached. This is not a problem with your details and nothing has been recorded ' +
          'against your application.',
        nextStep: 'Try again in a few minutes. Your application is unchanged.',
      });
    }

    await client.query(
      `INSERT INTO agent_kyc
         (agent_id, verification_provider, verification_reference, identity_type,
          identity_number_hash, identity_number_masked, verification_status,
          liveness_result, liveness_score, verified_at, failure_reason, attempt_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        params.agentId,
        verification.provider,
        verification.reference,
        params.identityType,
        hashIdentityNumber(params.identityNumber),
        maskIdentityNumber(params.identityNumber),
        verification.status,
        verification.livenessResult,
        verification.livenessScore ?? null,
        verification.status === 'CLEARED' ? new Date() : null,
        verification.failureReason ?? null,
        Number.parseInt(attempt!.next, 10),
      ],
    );

    await client.query('UPDATE agents SET kyc_status = $2 WHERE id = $1', [
      params.agentId,
      verification.status,
    ]);

    await refreshClearance(client, params.agentId);

    await journal(client, {
      agentId: params.agentId,
      eventType:
        verification.status === 'CLEARED'
          ? 'KYC_CLEARED'
          : verification.status === 'FAILED'
            ? 'KYC_FAILED'
            : 'KYC_SUBMITTED',
      reason: verification.failureReason ?? null,
      actorId: params.actorId,
      metadata: { provider: verification.provider, reference: verification.reference },
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: 'agent',
      action: 'agent.kyc_submitted',
      entityType: 'agent',
      entityId: params.agentId,
      newValue: {
        status: verification.status,
        provider: verification.provider,
        reference: verification.reference,
        // The identity number itself is never written to the audit log.
        identityMasked: maskIdentityNumber(params.identityNumber),
      },
      ipAddress: params.ipAddress ?? null,
    });

    if (verification.status === 'FAILED' || verification.status === 'VERIFICATION_REQUIRED') {
      await queueNotification(client, {
        event: 'KYC_ACTION_REQUIRED',
        agentId: params.agentId,
        variables: { reason: verification.failureReason ?? 'Additional information is required' },
        entityType: 'agent',
        entityId: params.agentId,
      });
    }

    const axes = await loadAxes(client, params.agentId);

    return {
      status: verification.status,
      applicationState: deriveApplicationState(axes),
      failureReason: verification.failureReason,
    };
  });
}

// ---------------------------------------------------------------------------
// Training, agreement, bank, devices
// ---------------------------------------------------------------------------

export async function completeTrainingModule(params: {
  agentId: string;
  moduleCode: string;
  score?: number;
  actorId: string;
}): Promise<{ status: string; trainingCompleted: boolean }> {
  return withTransaction(async (client) => {
    const module = await queryOne<{ id: string; assessed: boolean; pass_mark: number; title: string }>(
      client,
      `SELECT id, assessed, pass_mark, title FROM training_modules
        WHERE code = $1 AND status = 'ACTIVE'`,
      [params.moduleCode],
    );
    if (!module) throw notFound('That training module');

    if (module.assessed && (params.score === undefined || params.score < module.pass_mark)) {
      await client.query(
        `INSERT INTO agent_training_progress (agent_id, module_id, status, score, attempts, started_at)
         VALUES ($1,$2,'FAILED',$3,1,now())
         ON CONFLICT (agent_id, module_id) DO UPDATE
           SET status = 'FAILED', score = EXCLUDED.score, attempts = agent_training_progress.attempts + 1`,
        [params.agentId, module.id, params.score ?? null],
      );
      throw badRequest(
        `You scored ${params.score ?? 0}% on "${module.title}". ` +
          `You need at least ${module.pass_mark}% to pass. Review the module and try again.`,
      );
    }

    await client.query(
      `INSERT INTO agent_training_progress
         (agent_id, module_id, status, score, attempts, started_at, completed_at)
       VALUES ($1,$2,'COMPLETED',$3,1,now(),now())
       ON CONFLICT (agent_id, module_id) DO UPDATE
         SET status = 'COMPLETED', score = EXCLUDED.score, completed_at = now(),
             attempts = agent_training_progress.attempts + 1`,
      [params.agentId, module.id, params.score ?? null],
    );

    const flags = await refreshClearance(client, params.agentId);

    if (flags.trainingCompleted) {
      await journal(client, {
        agentId: params.agentId,
        eventType: 'TRAINING_COMPLETED',
        actorId: params.actorId,
      });
    }

    return { status: 'COMPLETED', trainingCompleted: flags.trainingCompleted };
  });
}

export async function acceptAgreement(params: {
  agentId: string;
  agreementVersion: string;
  actorId: string;
  ipAddress?: string | null;
  deviceIdentifier?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await withTransaction(async (client) => {
    const version = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM agreement_versions WHERE version = $1 AND status = 'ACTIVE'`,
      [params.agreementVersion],
    );
    if (!version) throw notFound('That agreement version');

    const device = params.deviceIdentifier
      ? await queryOne<{ id: string }>(
          client,
          'SELECT id FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
          [params.agentId, params.deviceIdentifier],
        )
      : null;

    await client.query(
      `INSERT INTO agent_agreements
         (agent_id, agreement_version_id, ip_address, device_id, user_agent)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (agent_id, agreement_version_id) DO NOTHING`,
      [params.agentId, version.id, params.ipAddress ?? null, device?.id ?? null, params.userAgent ?? null],
    );

    await refreshClearance(client, params.agentId);
    await journal(client, {
      agentId: params.agentId,
      eventType: 'AGREEMENT_ACCEPTED',
      actorId: params.actorId,
      metadata: { version: params.agreementVersion },
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: 'agent',
      action: 'agent.agreement_accepted',
      entityType: 'agent',
      entityId: params.agentId,
      newValue: { version: params.agreementVersion },
      ipAddress: params.ipAddress ?? null,
    });
  });
}

/**
 * Verify an agent's commission account against the bank (Addendum §16).
 *
 * Government revenue never passes through this account — it settles to the
 * government account directly (PRD §6, §16). What is at stake is the agent's
 * own earnings reaching the right person, so the outcomes are kept apart:
 *
 *   VERIFIED     the bank resolved the account and the name matches
 *   MISMATCH     it exists but is held by someone else — FAILED, and the agent
 *   NOT_FOUND    the bank holds no such number — FAILED, and the agent
 *                is told exactly what to correct
 *   UNAVAILABLE  the bank could not be asked — PENDING, never FAILED
 *
 * That last distinction is the point. A FAILED bank account is a clearance
 * blocker that reads like the account belongs to someone else; an applicant
 * whose bank happened to be down must not carry that on their record.
 */
export interface BankVerificationResult {
  verified: boolean;
  outcome: BankVerificationOutcome;
  accountName?: string;
  failureReason?: string;
}

/**
 * Ask the bank about one specific account row and record what it said.
 *
 * Split out from `verifyBankAccount` so that a *proposed* account can be
 * checked before anybody is asked to approve it. The resolved account name is
 * the strongest control in the change flow — it is the one thing somebody
 * redirecting a payout cannot supply — so it has to be obtained while the
 * proposal is still a proposal, not after it is in use.
 */
async function verifyAccountRow(
  client: PoolClient,
  params: { accountId: string; agentId: string; actorId: string },
): Promise<BankVerificationResult> {
  const account = await queryOne<{
    id: string;
    bank_code: string | null;
    account_number: string;
    account_name: string;
  }>(
    client,
    `SELECT id, bank_code, account_number, account_name FROM bank_accounts WHERE id = $1`,
    [params.accountId],
  );
  if (!account) throw notFound('That bank account');

  if (!account.bank_code) {
    // Our own data is incomplete; there is nothing to ask the bank yet. Say
    // so before making a call that could only fail confusingly.
    throw badRequest(
      'This account has no bank code recorded, so it cannot be verified. ' +
        'Select the bank on the application and try again.',
      [{ field: 'bankCode', issue: 'Required to verify an account' }],
    );
  }

  const result = await bankVerification.verify({
    bankCode: account.bank_code,
    accountNumber: account.account_number,
    expectedName: account.account_name,
  });

  const verified = result.outcome === 'VERIFIED';
  const status = verified ? 'VERIFIED' : result.outcome === 'UNAVAILABLE' ? 'PENDING' : 'FAILED';

  await client.query(
    `UPDATE bank_accounts
        SET verification_status = $2,
            verification_reference = COALESCE($3, verification_reference),
            verification_reason = $4,
            verification_resolved_name = COALESCE($5, verification_resolved_name),
            verification_attempts = verification_attempts + 1,
            verified_at = CASE WHEN $2 = 'VERIFIED' THEN now() ELSE NULL END,
            verified_by = CASE WHEN $2 = 'VERIFIED' THEN $6 ELSE verified_by END
      WHERE id = $1`,
    [
      account.id,
      status,
      result.reference || null,
      result.failureReason ?? null,
      result.accountName ?? null,
      params.actorId,
    ],
  );

  await recordAudit(client, {
    actorId: params.actorId,
    actorRole: 'agent',
    action: 'agent.bank_verification_attempted',
    entityType: 'bank_account',
    entityId: account.id,
    newValue: {
      outcome: result.outcome,
      status,
      provider: result.provider,
      // The account number is not written to the audit log; the resolved name
      // is, because it is the evidence for a mismatch decision.
      resolvedName: result.accountName ?? null,
    },
  });

  if (verified) {
    await journal(client, {
      agentId: params.agentId,
      eventType: 'BANK_VERIFIED',
      actorId: params.actorId,
      metadata: { reference: result.reference, provider: result.provider },
    });
  }

  return {
    verified,
    outcome: result.outcome,
    accountName: result.accountName,
    failureReason: result.failureReason,
  };
}

export async function verifyBankAccount(params: {
  agentId: string;
  actorId: string;
}): Promise<BankVerificationResult> {
  return withTransaction(async (client) => {
    const account = await queryOne<{
      id: string;
      bank_code: string | null;
      account_number: string;
      account_name: string;
    }>(
      client,
      `SELECT b.id, b.bank_code, b.account_number, b.account_name
         FROM agents a JOIN bank_accounts b ON b.id = a.bank_account_id
        WHERE a.id = $1 AND b.status = 'ACTIVE'`,
      [params.agentId],
    );
    if (!account) throw notFound('A bank account for this agent');

    const result = await verifyAccountRow(client, {
      accountId: account.id,
      agentId: params.agentId,
      actorId: params.actorId,
    });
    await refreshClearance(client, params.agentId);
    return result;
  });
}

export async function registerDevice(params: {
  agentId: string;
  deviceIdentifier: string;
  deviceName?: string | null;
  browser?: string | null;
  operatingSystem?: string | null;
  pwaVersion?: string | null;
  actorId: string;
  ipAddress?: string | null;
}): Promise<{ deviceId: string; status: string }> {
  return withTransaction(async (client) => {
    const axes = await loadAxes(client, params.agentId);

    // Addendum §26 stage 3: device registration opens only after government
    // approval, so an unvetted applicant cannot bind devices.
    if (!axes.flags.governmentApproved) {
      throw forbidden(
        'Devices can only be registered after your application has been approved by PSIRS.',
        'You will be notified when the review is complete.',
      );
    }

    const existing = await queryOne<{ id: string; status: string }>(
      client,
      'SELECT id, status FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
      [params.agentId, params.deviceIdentifier],
    );

    if (existing) {
      if (existing.status === 'REVOKED') {
        throw forbidden(
          'This device has been revoked and cannot be registered again. Use a different device.',
        );
      }
      return { deviceId: existing.id, status: existing.status };
    }

    // The first device of an approved agent is auto-approved so onboarding can
    // complete; every subsequent device starts PENDING and needs an officer
    // (Addendum §21).
    const priorDevices = await queryOne<{ count: string }>(
      client,
      `SELECT count(*)::text AS count FROM agent_devices
        WHERE agent_id = $1 AND status IN ('APPROVED','ACTIVE')`,
      [params.agentId],
    );
    const isFirst = Number.parseInt(priorDevices?.count ?? '0', 10) === 0;

    const device = await queryOne<{ id: string; status: string }>(
      client,
      `INSERT INTO agent_devices
         (agent_id, device_identifier, device_name, browser, operating_system, pwa_version,
          status, approved_at, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, status`,
      [
        params.agentId,
        params.deviceIdentifier,
        params.deviceName ?? null,
        params.browser ?? null,
        params.operatingSystem ?? null,
        params.pwaVersion ?? null,
        isFirst ? 'ACTIVE' : 'PENDING',
        isFirst ? new Date() : null,
        isFirst ? params.actorId : null,
      ],
    );

    await refreshClearance(client, params.agentId);
    await journal(client, {
      agentId: params.agentId,
      eventType: 'DEVICE_REGISTERED',
      actorId: params.actorId,
      metadata: { deviceIdentifier: params.deviceIdentifier, autoApproved: isFirst },
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: 'agent',
      action: 'agent.device_registered',
      entityType: 'agent_device',
      entityId: device!.id,
      newValue: { deviceIdentifier: params.deviceIdentifier, status: device!.status },
      ipAddress: params.ipAddress ?? null,
    });

    return { deviceId: device!.id, status: device!.status };
  });
}

/** Immediate device revocation (PRD §34, Addendum §21). */
export async function revokeDevice(params: {
  deviceId: string;
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    const device = await queryOne<{ id: string; agent_id: string }>(
      client,
      'SELECT id, agent_id FROM agent_devices WHERE id = $1',
      [params.deviceId],
    );
    if (!device) throw notFound('That device');

    await client.query(
      `UPDATE agent_devices
          SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revocation_reason = $3
        WHERE id = $1`,
      [params.deviceId, params.actorId, params.reason],
    );

    // Sessions bound to the device die with it — revocation must be immediate,
    // not "at next login".
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'Device revoked'
        WHERE device_id = $1 AND revoked_at IS NULL`,
      [params.deviceId],
    );

    await refreshClearance(client, device.agent_id);

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'agent.device_revoked',
      entityType: 'agent_device',
      entityId: params.deviceId,
      reason: params.reason,
      newValue: { status: 'REVOKED' },
    });
  });
}

// ---------------------------------------------------------------------------
// Government review and activation (Addendum §15, §16, §40, §41)
// ---------------------------------------------------------------------------

export async function reviewApplication(params: {
  agentId: string;
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_INFO';
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<{ applicationState: ApplicationState }> {
  if (!params.reason?.trim()) {
    // Addendum §15: "Every decision must require a reason."
    throw badRequest('A reason is required for every clearance decision.');
  }

  return withTransaction(async (client) => {
    const axes = await loadAxes(client, params.agentId);
    const before = deriveApplicationState(axes);

    if (params.decision === 'APPROVE') {
      if (!axes.flags.kycCleared || !axes.flags.refereeCleared) {
        throw conflict(
          'CLEARANCE_INCOMPLETE',
          'This application cannot be approved: identity verification and referee clearance ' +
            'must both be complete first.',
        );
      }

      await client.query(
        `UPDATE agent_clearance
            SET government_approved = true, clearance_status = 'APPROVED',
                reviewed_by = $2, reviewed_at = now(), rejection_reason = NULL
          WHERE agent_id = $1`,
        [params.agentId, params.actorId],
      );
      await client.query(
        `UPDATE agents SET clearance_status = 'APPROVED', approved_by = $2, approved_at = now()
          WHERE id = $1`,
        [params.agentId, params.actorId],
      );
    } else if (params.decision === 'REJECT') {
      await client.query(
        `UPDATE agent_clearance
            SET government_approved = false, clearance_status = 'REJECTED',
                reviewed_by = $2, reviewed_at = now(), rejection_reason = $3
          WHERE agent_id = $1`,
        [params.agentId, params.actorId, params.reason],
      );
      await client.query(
        `UPDATE agents
            SET clearance_status = 'REJECTED', operational_status = 'INACTIVE', rejection_reason = $2
          WHERE id = $1`,
        [params.agentId, params.reason],
      );
    } else {
      await client.query(
        `UPDATE agent_clearance SET clearance_status = 'ACTION_REQUIRED',
                reviewed_by = $2, reviewed_at = now(), rejection_reason = $3
          WHERE agent_id = $1`,
        [params.agentId, params.actorId, params.reason],
      );
      await client.query(`UPDATE agents SET clearance_status = 'ACTION_REQUIRED' WHERE id = $1`, [
        params.agentId,
      ]);
    }

    const after = deriveApplicationState(await loadAxes(client, params.agentId));

    await journal(client, {
      agentId: params.agentId,
      eventType:
        params.decision === 'APPROVE'
          ? 'GOVERNMENT_APPROVED'
          : params.decision === 'REJECT'
            ? 'GOVERNMENT_REJECTED'
            : 'INFO_REQUESTED',
      fromState: before,
      toState: after,
      reason: params.reason,
      actorId: params.actorId,
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: `agent.review_${params.decision.toLowerCase()}`,
      entityType: 'agent',
      entityId: params.agentId,
      oldValue: { applicationState: before },
      newValue: { applicationState: after },
      reason: params.reason,
    });

    await queueNotification(client, {
      event: params.decision === 'APPROVE' ? 'AGENT_APPROVED' : 'AGENT_REJECTED',
      agentId: params.agentId,
      variables: { reason: params.reason },
      entityType: 'agent',
      entityId: params.agentId,
    });

    return { applicationState: after };
  });
}

/**
 * Activate an agent.
 *
 * Refuses while any checklist item is unmet. An override (Addendum §41) does
 * not skip the check — it requires an already-APPROVED override approval
 * record, and the unmet items are written into the clearance row and the audit
 * log so the exception stays visible for as long as the agent exists.
 */
export async function activate(params: {
  agentId: string;
  territoryId?: string | null;
  supervisorId?: string | null;
  actorId: string;
  actorRole: string;
  overrideApprovalId?: string | null;
}): Promise<{ agentCode: string; applicationState: ApplicationState }> {
  return withTransaction(async (client) => {
    const flags = await refreshClearance(client, params.agentId);
    const blockers = activationBlockers(flags);

    if (blockers.length > 0) {
      if (!params.overrideApprovalId) {
        throw conflict(
          'ACTIVATION_BLOCKED',
          `This agent cannot be activated yet: ${blockers.join('; ')}.`,
          'Complete the outstanding clearance requirements, or raise a government override request.',
        );
      }

      const approval = await queryOne<{ id: string; status: string; approved_by: string | null }>(
        client,
        `SELECT id, status, approved_by FROM approvals
          WHERE id = $1 AND approval_type = 'AGENT_OVERRIDE_ACTIVATION' AND entity_id = $2`,
        [params.overrideApprovalId, params.agentId],
      );

      if (!approval || approval.status !== 'APPROVED') {
        throw forbidden(
          'An approved government override is required to activate an agent with outstanding clearance items.',
        );
      }
      if (approval.approved_by === params.actorId) {
        // Segregation of duties: whoever approved the override may not also
        // execute it (PRD §70).
        throw forbidden('The officer who approved an override may not also apply it.');
      }

      await client.query(
        `UPDATE agent_clearance
            SET override_approval_id = $2,
                override_reason = $3
          WHERE agent_id = $1`,
        [params.agentId, params.overrideApprovalId, `Activated with outstanding: ${blockers.join('; ')}`],
      );
      await client.query(`UPDATE approvals SET status = 'EXECUTED', executed_at = now() WHERE id = $1`, [
        params.overrideApprovalId,
      ]);
    }

    const agent = await queryOne<{ agent_code: string | null; territory_id: string | null }>(
      client,
      'SELECT agent_code, territory_id FROM agents WHERE id = $1',
      [params.agentId],
    );
    if (!agent) throw notFound('That agent');

    const territoryId = params.territoryId ?? agent.territory_id;
    if (!territoryId) {
      throw conflict(
        'TERRITORY_REQUIRED',
        'An agent must be assigned a territory before activation so every transaction can be ' +
          'attributed to a location.',
      );
    }

    const agentCode = agent.agent_code ?? (await nextAgentCode(client));

    await client.query(
      `UPDATE agents
          SET agent_code = $2, territory_id = $3,
              supervisor_id = COALESCE($4, supervisor_id),
              operational_status = 'ACTIVE', account_status = 'ACTIVE',
              activated_at = now(), suspended_at = NULL, suspension_reason = NULL
        WHERE id = $1`,
      [params.agentId, agentCode, territoryId, params.supervisorId ?? null],
    );

    const after = deriveApplicationState(await loadAxes(client, params.agentId));

    await journal(client, {
      agentId: params.agentId,
      eventType: params.overrideApprovalId ? 'OVERRIDE_APPLIED' : 'ACTIVATED',
      toState: after,
      actorId: params.actorId,
      metadata: { agentCode, territoryId, blockersAtActivation: blockers },
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'agent.activated',
      entityType: 'agent',
      entityId: params.agentId,
      newValue: {
        agentCode,
        territoryId,
        overrideApprovalId: params.overrideApprovalId ?? null,
        outstandingAtActivation: blockers,
      },
    });

    return { agentCode, applicationState: after };
  });
}

/** Immediate suspension (PRD §88.28). */
export async function suspend(params: {
  agentId: string;
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE agents
          SET operational_status = 'SUSPENDED', account_status = 'SUSPENDED',
              suspended_at = now(), suspension_reason = $2
        WHERE id = $1`,
      [params.agentId, params.reason],
    );

    // Sessions and devices are cut immediately; a suspended agent must not be
    // able to complete a transaction already in progress.
    await client.query(
      `UPDATE sessions s SET revoked_at = now(), revoked_reason = 'Agent suspended'
         FROM agents a
        WHERE a.id = $1 AND s.user_id = a.user_id AND s.revoked_at IS NULL`,
      [params.agentId],
    );
    await client.query(
      `UPDATE agent_devices SET status = 'SUSPENDED'
        WHERE agent_id = $1 AND status IN ('ACTIVE','APPROVED','PENDING')`,
      [params.agentId],
    );

    await journal(client, {
      agentId: params.agentId,
      eventType: 'SUSPENDED',
      toState: 'SUSPENDED',
      reason: params.reason,
      actorId: params.actorId,
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'agent.suspended',
      entityType: 'agent',
      entityId: params.agentId,
      reason: params.reason,
      newValue: { operationalStatus: 'SUSPENDED' },
    });

    await queueNotification(client, {
      event: 'AGENT_SUSPENDED',
      agentId: params.agentId,
      variables: { reason: params.reason },
      entityType: 'agent',
      entityId: params.agentId,
    });
  });
}

/** Government KYC dashboard (Addendum §45). */
export async function kycDashboard(db: Db, filters: { lgaId?: string; reviewerId?: string } = {}) {
  const counts = await queryOne(
    db,
    `SELECT
       count(*) FILTER (WHERE a.application_submitted_at IS NOT NULL)::text AS applications_received,
       count(*) FILTER (WHERE a.kyc_status IN ('NOT_STARTED','SUBMITTED','UNDER_REVIEW'))::text AS kyc_pending,
       count(*) FILTER (WHERE a.kyc_status = 'CLEARED')::text AS kyc_cleared,
       count(*) FILTER (WHERE a.kyc_status = 'FAILED')::text AS kyc_failed,
       count(*) FILTER (WHERE a.referee_status = 'PENDING')::text AS referee_pending,
       count(*) FILTER (WHERE a.referee_status = 'CLEARED')::text AS referee_cleared,
       count(*) FILTER (WHERE a.referee_status = 'FAILED')::text AS referee_failed,
       count(*) FILTER (WHERE a.clearance_status = 'READY_FOR_REVIEW')::text AS ready_for_review,
       count(*) FILTER (WHERE a.clearance_status = 'APPROVED')::text AS approved,
       count(*) FILTER (WHERE a.clearance_status = 'REJECTED')::text AS rejected,
       count(*) FILTER (WHERE a.operational_status = 'SUSPENDED')::text AS suspended,
       count(*) FILTER (WHERE a.operational_status = 'ACTIVE')::text AS active
     FROM agents a
     WHERE ($1::uuid IS NULL OR a.lga_id = $1)`,
    [filters.lgaId ?? null],
  );

  const queue = await query(
    db,
    `${STATUS_SELECT}
      WHERE a.clearance_status = 'READY_FOR_REVIEW'
        AND ($1::uuid IS NULL OR a.lga_id = $1)
      ORDER BY a.application_submitted_at ASC LIMIT 100`,
    [filters.lgaId ?? null],
  );

  const enriched = await Promise.all(
    queue.map(async (row) => {
      const details = await queryOne(
        db,
        `SELECT u.full_name, u.phone, u.email, a.application_number, a.application_submitted_at,
                l.name AS lga_name
           FROM agents a JOIN users u ON u.id = a.user_id
           LEFT JOIN lgas l ON l.id = a.lga_id
          WHERE a.id = $1`,
        [(row as { id: string }).id],
      );
      return {
        ...(details ?? {}),
        agentId: (row as { id: string }).id,
        applicationState: deriveApplicationState(toAxes(row as unknown as AgentStatusRow)),
        checklist: toAxes(row as unknown as AgentStatusRow).flags,
      };
    }),
  );

  return { counts, reviewQueue: enriched };
}

export const trainingCurriculum = TRAINING_MODULES;

// ---------------------------------------------------------------------------
// Changing the account commission is paid into
// ---------------------------------------------------------------------------
//
// The destination of somebody else's money is the thing an attacker wants to
// move, so no single control is trusted with it. A request needs a step-up
// code (proving possession of the phone, not just a live session); the new
// account must come back VERIFIED from the bank before anyone may approve it;
// a second officer must authorise it, and never the one who asked; the agent
// is told on their existing number the moment a change is requested, so if it
// was not them they find out while it is still a proposal; and the old
// account is superseded rather than overwritten, so the trail of where money
// went is never lost.
//
// Two ordering rules are worth stating plainly, because both are easy to get
// wrong and expensive to get wrong:
//
//   A payout in flight blocks a change. `commission_payouts.bank_account_id`
//   is fixed when the payout is requested, so an approved change cannot
//   retarget money already authorised. Refusing the change anyway removes the
//   ambiguity entirely — settle first, then move the account — and spares an
//   officer having to reason about which account a half-finished payout meant.
//
//   An unverified account cannot be approved. Not "should not": the execution
//   path refuses it. Verification returning UNAVAILABLE is not a soft yes; it
//   leaves the proposal waiting, exactly as an unreachable TIN service leaves
//   a registration waiting rather than inventing a number.

export interface BankAccountChange {
  approvalId: string;
  proposedAccountId: string;
  status: string;
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
  verificationStatus: string;
  verificationResolvedName: string | null;
  verificationReason: string | null;
  requestedReason: string;
  requestedAt: string;
  requestedByRole: string | null;
  current: {
    bankName: string;
    accountNumberMasked: string;
    accountName: string;
  } | null;
}

/** Account numbers are never returned in full to a screen or a log. */
function maskAccountNumber(accountNumber: string): string {
  return accountNumber.length <= 4
    ? '····'
    : `····${accountNumber.slice(-4)}`;
}

async function payoutInFlight(client: PoolClient, agentId: string): Promise<string | null> {
  const row = await queryOne<{ payout_reference: string; status: string }>(
    client,
    `SELECT payout_reference, status FROM commission_payouts
      WHERE agent_id = $1 AND status IN ('REQUESTED', 'APPROVED')
      ORDER BY requested_at LIMIT 1`,
    [agentId],
  );
  return row ? `${row.payout_reference} (${row.status.toLowerCase()})` : null;
}

/**
 * Propose a new account, check it with the bank, and put it in front of an
 * officer. Nothing about where money goes changes here.
 */
export async function requestBankAccountChange(params: {
  agentId: string;
  actorId: string;
  actorRole: string;
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
  reason: string;
}): Promise<BankAccountChange> {
  return withTransaction(async (client) => {
    const agent = await queryOne<{
      id: string;
      full_name: string;
      bank_account_id: string | null;
    }>(
      client,
      `SELECT a.id, u.full_name, a.bank_account_id
         FROM agents a JOIN users u ON u.id = a.user_id
        WHERE a.id = $1 FOR UPDATE OF a`,
      [params.agentId],
    );
    if (!agent) throw notFound('That agent');

    const existing = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM bank_accounts
        WHERE owner_type = 'AGENT' AND owner_id = $1 AND status = 'PROPOSED'`,
      [params.agentId],
    );
    if (existing) {
      throw conflict(
        'BANK_CHANGE_ALREADY_PENDING',
        'A change to this bank account is already waiting for an officer. ' +
          'It has to be approved or refused before another can be requested.',
      );
    }

    const inFlight = await payoutInFlight(client, params.agentId);
    if (inFlight) {
      throw conflict(
        'PAYOUT_IN_FLIGHT',
        `Payout ${inFlight} has not been paid yet. ` +
          'Wait until it has been settled before changing the account it is going to.',
      );
    }

    const current = agent.bank_account_id
      ? await queryOne<{
          id: string;
          bank_name: string;
          account_number: string;
          account_name: string;
        }>(
          client,
          `SELECT id, bank_name, account_number, account_name
             FROM bank_accounts WHERE id = $1`,
          [agent.bank_account_id],
        )
      : null;
    if (!current) {
      throw badRequest(
        'This agent has no bank account on record yet, so there is nothing to change. ' +
          'The account is captured on the application.',
      );
    }

    const accountNumber = params.accountNumber.trim();
    if (
      accountNumber === current.account_number &&
      params.bankName.trim() === current.bank_name
    ) {
      throw badRequest(
        'Those are the details already on record. Nothing would change.',
        [{ field: 'accountNumber', issue: 'Same as the account already in use' }],
      );
    }

    const proposed = await queryOne<{ id: string }>(
      client,
      `INSERT INTO bank_accounts
         (owner_type, owner_id, bank_name, bank_code, account_name, account_number,
          status, replaces_account_id)
       VALUES ('AGENT', $1, $2, $3, $4, $5, 'PROPOSED', $6)
       RETURNING id`,
      [
        params.agentId,
        params.bankName.trim(),
        params.bankCode.trim(),
        params.accountName.trim(),
        accountNumber,
        current.id,
      ],
    );

    const approval = await queryOne<{ id: string }>(
      client,
      `INSERT INTO approvals
         (approval_type, entity_type, entity_id, payload, requested_by, requested_reason)
       VALUES ('BANK_ACCOUNT_CHANGE', 'bank_account', $1, $2, $3, $4)
       RETURNING id`,
      [
        proposed!.id,
        JSON.stringify({
          agentId: params.agentId,
          proposedAccountId: proposed!.id,
          replacesAccountId: current.id,
          // Masked in the payload too: an approval record is read by more
          // people than the account itself ever should be.
          proposedAccountMasked: maskAccountNumber(accountNumber),
          currentAccountMasked: maskAccountNumber(current.account_number),
          requestedByRole: params.actorRole,
        }),
        params.actorId,
        params.reason,
      ],
    );

    await client.query('UPDATE bank_accounts SET change_approval_id = $2 WHERE id = $1', [
      proposed!.id,
      approval!.id,
    ]);

    // Ask the bank now, while it is still only a proposal. An officer should
    // never be the first person to find out the name does not match.
    const verification = await verifyAccountRow(client, {
      accountId: proposed!.id,
      agentId: params.agentId,
      actorId: params.actorId,
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'agent.bank_account_change_requested',
      entityType: 'bank_account',
      entityId: proposed!.id,
      oldValue: { accountMasked: maskAccountNumber(current.account_number), bankName: current.bank_name },
      newValue: {
        accountMasked: maskAccountNumber(accountNumber),
        bankName: params.bankName.trim(),
        approvalId: approval!.id,
        verification: verification.outcome,
      },
      reason: params.reason,
    });

    await journal(client, {
      agentId: params.agentId,
      eventType: 'BANK_CHANGE_REQUESTED',
      actorId: params.actorId,
      reason: params.reason,
      metadata: { approvalId: approval!.id, verification: verification.outcome },
    });

    // Sent to the number already on the agent's record, never to anything
    // supplied with the request. If somebody else asked for this change, this
    // message is how the agent finds out — while it is still a proposal.
    await queueNotification(client, {
      event: 'AGENT_BANK_CHANGE_REQUESTED',
      agentId: params.agentId,
      variables: {
        bank: params.bankName.trim(),
        account: maskAccountNumber(accountNumber),
      },
      entityType: 'bank_account',
      entityId: proposed!.id,
    });

    return {
      approvalId: approval!.id,
      proposedAccountId: proposed!.id,
      status: 'PROPOSED',
      bankName: params.bankName.trim(),
      accountNumberMasked: maskAccountNumber(accountNumber),
      accountName: params.accountName.trim(),
      verificationStatus: verification.verified
        ? 'VERIFIED'
        : verification.outcome === 'UNAVAILABLE'
          ? 'PENDING'
          : 'FAILED',
      verificationResolvedName: verification.accountName ?? null,
      verificationReason: verification.failureReason ?? null,
      requestedReason: params.reason,
      requestedAt: new Date().toISOString(),
      requestedByRole: params.actorRole,
      current: {
        bankName: current.bank_name,
        accountNumberMasked: maskAccountNumber(current.account_number),
        accountName: current.account_name,
      },
    };
  });
}

/**
 * Put an approved change into effect, inside the caller's transaction.
 *
 * Called from the approvals decision rather than from a route of its own, so
 * that there is exactly one way for a bank change to be authorised and it is
 * the one carrying the separation-of-duties checks. An approval that says
 * APPROVED and an account that never moved would be the worst of both worlds:
 * the record claims a decision was carried out, and the money still goes
 * somewhere else.
 */
export async function executeBankAccountChange(
  client: PoolClient,
  params: { approvalId: string; actorId: string; actorRole: string },
): Promise<{ agentId: string; accountNumberMasked: string; bankName: string }> {
  const proposed = await queryOne<{
    id: string;
    owner_id: string;
    bank_name: string;
    account_number: string;
    account_name: string;
    status: string;
    verification_status: string;
    verification_reason: string | null;
    replaces_account_id: string | null;
  }>(
    client,
    `SELECT id, owner_id, bank_name, account_number, account_name, status,
            verification_status, verification_reason, replaces_account_id
       FROM bank_accounts WHERE change_approval_id = $1 FOR UPDATE`,
    [params.approvalId],
  );
  if (!proposed) throw notFound('The account this approval refers to');

  if (proposed.status !== 'PROPOSED') {
    throw conflict(
      'BANK_CHANGE_ALREADY_SETTLED',
      `This change has already been ${proposed.status.toLowerCase()}.`,
    );
  }

  // The control that does the real work. An account the bank has not
  // confirmed is not a destination for public money, and an officer cannot
  // wave it through — "unavailable" is not a soft yes.
  if (proposed.verification_status !== 'VERIFIED') {
    throw conflict(
      'BANK_ACCOUNT_NOT_VERIFIED',
      proposed.verification_status === 'PENDING'
        ? 'The bank has not confirmed this account yet, so the change cannot be approved. ' +
          'Try the verification again once the bank service is reachable.'
        : `The bank did not confirm this account${
            proposed.verification_reason ? `: ${proposed.verification_reason}` : ''
          }. The change cannot be approved until it does.`,
    );
  }

  const inFlight = await payoutInFlight(client, proposed.owner_id);
  if (inFlight) {
    throw conflict(
      'PAYOUT_IN_FLIGHT',
      `Payout ${inFlight} has not been paid yet. ` +
        'Settle it before moving the account it is going to.',
    );
  }

  const previous = proposed.replaces_account_id
    ? await queryOne<{ id: string; bank_name: string; account_number: string }>(
        client,
        'SELECT id, bank_name, account_number FROM bank_accounts WHERE id = $1 FOR UPDATE',
        [proposed.replaces_account_id],
      )
    : null;

  // Order matters: the old account gives up ACTIVE before the new one takes
  // it, because only one account per owner may hold that status.
  if (previous) {
    await client.query(
      `UPDATE bank_accounts SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1`,
      [previous.id],
    );
  }
  await client.query(`UPDATE bank_accounts SET status = 'ACTIVE' WHERE id = $1`, [proposed.id]);
  await client.query('UPDATE agents SET bank_account_id = $2 WHERE id = $1', [
    proposed.owner_id,
    proposed.id,
  ]);

  await refreshClearance(client, proposed.owner_id);

  await recordAudit(client, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: 'agent.bank_account_changed',
    entityType: 'bank_account',
    entityId: proposed.id,
    oldValue: previous
      ? { accountMasked: maskAccountNumber(previous.account_number), bankName: previous.bank_name }
      : null,
    newValue: {
      accountMasked: maskAccountNumber(proposed.account_number),
      bankName: proposed.bank_name,
      approvalId: params.approvalId,
    },
  });

  await journal(client, {
    agentId: proposed.owner_id,
    eventType: 'BANK_CHANGE_APPLIED',
    actorId: params.actorId,
    metadata: { approvalId: params.approvalId },
  });

  await queueNotification(client, {
    event: 'AGENT_BANK_CHANGE_APPLIED',
    agentId: proposed.owner_id,
    variables: {
      bank: proposed.bank_name,
      account: maskAccountNumber(proposed.account_number),
    },
    entityType: 'bank_account',
    entityId: proposed.id,
  });

  return {
    agentId: proposed.owner_id,
    accountNumberMasked: maskAccountNumber(proposed.account_number),
    bankName: proposed.bank_name,
  };
}

/** Refuse a proposed change. The account in use is untouched. */
export async function refuseBankAccountChange(
  client: PoolClient,
  params: { approvalId: string; actorId: string; actorRole: string; reason: string },
): Promise<void> {
  const proposed = await queryOne<{ id: string; owner_id: string; status: string }>(
    client,
    `SELECT id, owner_id, status FROM bank_accounts WHERE change_approval_id = $1 FOR UPDATE`,
    [params.approvalId],
  );
  if (!proposed || proposed.status !== 'PROPOSED') return;

  await client.query(`UPDATE bank_accounts SET status = 'REJECTED' WHERE id = $1`, [proposed.id]);

  await recordAudit(client, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: 'agent.bank_account_change_refused',
    entityType: 'bank_account',
    entityId: proposed.id,
    reason: params.reason,
  });

  await journal(client, {
    agentId: proposed.owner_id,
    eventType: 'BANK_CHANGE_REFUSED',
    actorId: params.actorId,
    reason: params.reason,
  });

  await queueNotification(client, {
    event: 'AGENT_BANK_CHANGE_REFUSED',
    agentId: proposed.owner_id,
    variables: { reason: params.reason },
    entityType: 'bank_account',
    entityId: proposed.id,
  });
}

/** Re-ask the bank about a proposal that could not be checked first time. */
export async function reverifyProposedAccount(params: {
  approvalId: string;
  actorId: string;
}): Promise<BankVerificationResult> {
  return withTransaction(async (client) => {
    const proposed = await queryOne<{ id: string; owner_id: string; status: string }>(
      client,
      `SELECT id, owner_id, status FROM bank_accounts WHERE change_approval_id = $1`,
      [params.approvalId],
    );
    if (!proposed) throw notFound('The account this approval refers to');
    if (proposed.status !== 'PROPOSED') {
      throw conflict(
        'BANK_CHANGE_ALREADY_SETTLED',
        `This change has already been ${proposed.status.toLowerCase()}.`,
      );
    }
    return verifyAccountRow(client, {
      accountId: proposed.id,
      agentId: proposed.owner_id,
      actorId: params.actorId,
    });
  });
}

/** The proposal outstanding for one agent, if there is one. */
export async function bankAccountChangeFor(
  db: Db,
  agentId: string,
): Promise<BankAccountChange | null> {
  const row = await queryOne<any>(
    db,
    `SELECT p.id, p.bank_name, p.account_number, p.account_name, p.status,
            p.verification_status, p.verification_resolved_name, p.verification_reason,
            p.change_approval_id, a.requested_reason, a.requested_at, a.payload,
            c.bank_name AS current_bank_name, c.account_number AS current_account_number,
            c.account_name AS current_account_name
       FROM bank_accounts p
       JOIN approvals a ON a.id = p.change_approval_id
       LEFT JOIN bank_accounts c ON c.id = p.replaces_account_id
      WHERE p.owner_type = 'AGENT' AND p.owner_id = $1 AND p.status = 'PROPOSED'`,
    [agentId],
  );
  if (!row) return null;
  return {
    approvalId: row.change_approval_id,
    proposedAccountId: row.id,
    status: row.status,
    bankName: row.bank_name,
    accountNumberMasked: maskAccountNumber(row.account_number),
    accountName: row.account_name,
    verificationStatus: row.verification_status,
    verificationResolvedName: row.verification_resolved_name,
    verificationReason: row.verification_reason,
    requestedReason: row.requested_reason,
    requestedAt: row.requested_at?.toISOString?.() ?? String(row.requested_at),
    requestedByRole: row.payload?.requestedByRole ?? null,
    current: row.current_bank_name
      ? {
          bankName: row.current_bank_name,
          accountNumberMasked: maskAccountNumber(row.current_account_number),
          accountName: row.current_account_name,
        }
      : null,
  };
}

/** Every proposal waiting on an officer. */
export async function pendingBankAccountChanges(db: Db): Promise<
  (BankAccountChange & { agentId: string; agentName: string; agentCode: string })[]
> {
  const rows = await query<any>(
    db,
    `SELECT p.id, p.owner_id, p.bank_name, p.account_number, p.account_name, p.status,
            p.verification_status, p.verification_resolved_name, p.verification_reason,
            p.change_approval_id, ap.requested_reason, ap.requested_at, ap.payload,
            u.full_name AS agent_name, ag.agent_code,
            c.bank_name AS current_bank_name, c.account_number AS current_account_number,
            c.account_name AS current_account_name
       FROM bank_accounts p
       JOIN approvals ap ON ap.id = p.change_approval_id
       JOIN agents ag ON ag.id = p.owner_id
       JOIN users u ON u.id = ag.user_id
       LEFT JOIN bank_accounts c ON c.id = p.replaces_account_id
      WHERE p.owner_type = 'AGENT' AND p.status = 'PROPOSED'
      ORDER BY ap.requested_at`,
  );
  return rows.map((row) => ({
    approvalId: row.change_approval_id,
    proposedAccountId: row.id,
    agentId: row.owner_id,
    agentName: row.agent_name,
    agentCode: row.agent_code,
    status: row.status,
    bankName: row.bank_name,
    accountNumberMasked: maskAccountNumber(row.account_number),
    accountName: row.account_name,
    verificationStatus: row.verification_status,
    verificationResolvedName: row.verification_resolved_name,
    verificationReason: row.verification_reason,
    requestedReason: row.requested_reason,
    requestedAt: row.requested_at?.toISOString?.() ?? String(row.requested_at),
    requestedByRole: row.payload?.requestedByRole ?? null,
    current: row.current_bank_name
      ? {
          bankName: row.current_bank_name,
          accountNumberMasked: maskAccountNumber(row.current_account_number),
          accountName: row.current_account_name,
        }
      : null,
  }));
}
