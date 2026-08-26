/**
 * Taxpayer onboarding, duplicate control and TIN assignment (PRD §10-§13).
 *
 * Two obligations shape this module:
 *   * "The system must prevent duplicate taxpayer creation" (§11) — because
 *     duplicate registrations are both a data problem and a commission fraud
 *     (PRD §68 "Create duplicate taxpayers for commission purposes").
 *   * "The agent must not manually invent or type arbitrary TINs" (§11) — the
 *     TIN column is only ever written from an authoritative TIN service reply.
 */

import type { PoolClient } from 'pg';
import type { TaxpayerType } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { hashIdentityNumber, maskIdentityNumber } from '../lib/crypto';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { tinService } from '../integrations';
import { recordAudit } from './audit';
import { queueNotification } from './notifications';

export interface TaxpayerInput {
  taxpayerType: TaxpayerType;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
  businessName?: string;
  businessType?: string;
  registrationNumber?: string;
  natureOfBusiness?: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  address: string;
  lgaId: string;
  wardId?: string;
  community?: string;
  occupation?: string;
  businessActivity?: string;
  identityType?: string;
  identityNumber?: string;
  consentGiven: boolean;
  declarationAccepted: boolean;
  existingTin?: string;
}

export interface DuplicateMatch {
  taxpayerId: string;
  displayName: string;
  tin: string | null;
  phone: string;
  score: number;
  reasons: string[];
}

/**
 * Find taxpayers that may already be this person.
 *
 * Scoring is intentionally simple and explainable — an agent in the field is
 * told *why* a match was raised, and a reviewer can judge it. Weightings:
 *   identity number match  100 (decisive)
 *   TIN match              100
 *   phone + name match      85
 *   phone match             60
 *   exact name + LGA        55
 *   business name + LGA     70
 */
export async function findPotentialDuplicates(
  db: Db,
  input: Pick<
    TaxpayerInput,
    'taxpayerType' | 'firstName' | 'lastName' | 'businessName' | 'phone' | 'lgaId' | 'identityNumber'
  >,
): Promise<DuplicateMatch[]> {
  const identityHash = input.identityNumber ? hashIdentityNumber(input.identityNumber) : null;

  const rows = await query<{
    id: string;
    tin: string | null;
    phone: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    lga_id: string;
    identity_hash: string | null;
  }>(
    db,
    `SELECT id, tin, phone, first_name, last_name, business_name, lga_id, identity_hash
       FROM taxpayers
      WHERE status IN ('ACTIVE', 'DRAFT')
        AND (
          phone = $1
          OR ($2::text IS NOT NULL AND identity_hash = $2)
          OR ($3::text IS NOT NULL AND lower(business_name) = lower($3))
          OR ($4::text IS NOT NULL AND $5::text IS NOT NULL
              AND lower(first_name) = lower($4) AND lower(last_name) = lower($5))
        )
      LIMIT 25`,
    [
      input.phone,
      identityHash,
      input.businessName ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
    ],
  );

  const matches: DuplicateMatch[] = [];

  for (const row of rows) {
    const reasons: string[] = [];
    let score = 0;

    if (identityHash && row.identity_hash === identityHash) {
      score = Math.max(score, 100);
      reasons.push('The same identification number is already registered');
    }

    const namesMatch =
      input.firstName &&
      input.lastName &&
      row.first_name?.toLowerCase() === input.firstName.toLowerCase() &&
      row.last_name?.toLowerCase() === input.lastName.toLowerCase();

    const businessMatch =
      input.businessName && row.business_name?.toLowerCase() === input.businessName.toLowerCase();

    if (row.phone === input.phone && (namesMatch || businessMatch)) {
      score = Math.max(score, 85);
      reasons.push('Same phone number and same name');
    } else if (row.phone === input.phone) {
      score = Math.max(score, 60);
      reasons.push('This phone number is already registered to another taxpayer');
    }

    if (businessMatch && row.lga_id === input.lgaId) {
      score = Math.max(score, 70);
      reasons.push('A business with this name is already registered in this LGA');
    } else if (namesMatch && row.lga_id === input.lgaId) {
      score = Math.max(score, 55);
      reasons.push('A taxpayer with this name is already registered in this LGA');
    }

    if (score > 0) {
      matches.push({
        taxpayerId: row.id,
        displayName: row.business_name ?? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
        tin: row.tin,
        phone: row.phone,
        score,
        reasons,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

export interface RegistrationResult {
  taxpayerId: string;
  tin: string | null;
  tinStatus: string;
  duplicatesConsidered: DuplicateMatch[];
}

/**
 * Register a taxpayer, requesting a TIN from the authoritative service.
 *
 * A decisive duplicate (score 100) is refused outright: the agent is told to
 * open the existing record instead. Weaker matches are surfaced to the agent,
 * who may proceed with `acknowledgeDuplicates` — and that decision is recorded,
 * because a pattern of overriding warnings is itself a fraud signal (PRD §32).
 */
export async function registerTaxpayer(params: {
  input: TaxpayerInput;
  actorId: string;
  actorRole: string;
  agentId?: string | null;
  source?: 'AGENT';
  acknowledgeDuplicates?: boolean;
  ipAddress?: string | null;
  deviceId?: string | null;
}): Promise<RegistrationResult> {
  const { input } = params;

  if (!input.consentGiven || !input.declarationAccepted) {
    throw badRequest(
      'The taxpayer must give consent and accept the declaration before registration.',
      [
        ...(input.consentGiven ? [] : [{ field: 'consentGiven', issue: 'Consent is required' }]),
        ...(input.declarationAccepted
          ? []
          : [{ field: 'declarationAccepted', issue: 'Declaration must be accepted' }]),
      ],
    );
  }

  // Duplicate detection runs — and is journalled — outside the registration
  // transaction. A blocked attempt aborts that transaction, so recording the
  // check inside it would roll the evidence back with it, and a pattern of
  // repeated blocked attempts is precisely what fraud review needs to see
  // (PRD §32, §68).
  const duplicates = await findPotentialDuplicates(pool, input);
  const decisive = duplicates.find((match) => match.score >= 100);
  const blocked = decisive !== undefined || (duplicates.length > 0 && !params.acknowledgeDuplicates);

  if (blocked) {
    await withTransaction((client) =>
      recordDuplicateCheck(client, {
        input,
        duplicates,
        decision: 'BLOCKED',
        actorId: params.actorId,
        createdTaxpayerId: null,
      }),
    );

    if (decisive) {
      throw conflict(
        'TAXPAYER_ALREADY_EXISTS',
        `This person is already registered as ${decisive.displayName}` +
          `${decisive.tin ? ` (TIN ${decisive.tin})` : ''}. A second record would be a duplicate.`,
        'Open the existing taxpayer record and continue from there.',
      );
    }

    throw conflict(
      'POSSIBLE_DUPLICATE_TAXPAYER',
      'Possible existing taxpayer found. Review before creating a new record.',
      'Check the suggested matches. If none is the same person, resubmit with acknowledgeDuplicates set to true.',
    );
  }

  /*
   * Everything that has to be settled before a row is written.
   *
   * Validating the ward, and resolving the TIN with the authoritative service,
   * both used to happen inside the transaction that inserts the taxpayer — so
   * the busiest write path on the platform held a pooled connection open for
   * as long as the PSIRS TIN service took to answer. An agent registering
   * somebody in a market was holding a database connection hostage to a third
   * party's latency, and a queue of agents doing the same is how a pool runs
   * dry.
   *
   * The order is load-bearing and unchanged: the ward is checked first,
   * because a TIN minted for a registration that then fails validation is a
   * duplicate in a UNIQUE column on a row nobody can delete. Read-only work,
   * so it needs no transaction of its own — and the insert below is a single
   * statement, which is atomic without one being held open across the call.
   */
  /*
   * A ward has to be in the LGA it is filed under.
   *
   * The column took any ward id the caller sent. A foreign key made it a real
   * ward, and nothing made it a ward of this taxpayer's LGA — so a stale
   * selection left over from a changed LGA would file the registration, and
   * every subsequent collection, in the wrong place on the State → LGA →
   * Ward drill-down. Revenue attributed confidently to the wrong ward is
   * worse than the nothing that tier showed before.
   */
  if (input.wardId) {
    const ward = await queryOne<{ lga_id: string; name: string }>(
      pool,
      'SELECT lga_id, name FROM wards WHERE id = $1',
      [input.wardId],
    );
    if (!ward) {
      throw badRequest('That ward does not exist.', [
        { field: 'wardId', issue: 'Unknown ward' },
      ]);
    }
    if (ward.lga_id !== input.lgaId) {
      throw badRequest(
        `${ward.name} is not a ward of the selected Local Government Area. ` +
          'Choose the ward again after changing the LGA.',
        [{ field: 'wardId', issue: 'Ward belongs to a different LGA' }],
      );
    }
  }

  const identityHash = input.identityNumber ? hashIdentityNumber(input.identityNumber) : null;
  const identityMasked = input.identityNumber ? maskIdentityNumber(input.identityNumber) : null;

  let tin: string | null = null;
  let tinStatus = 'NOT_REQUESTED';
  let tinReference: string | null = null;
  let tinReason: string | null = null;

  if (input.existingTin) {
    /*
     * Normalise before looking it up.
     *
     * PSIRS prints a TIN with separators and people write them as they read
     * them — `12345678-0001`, `1234 5678 90`. Sent to the register exactly
     * as typed, those matched nothing and came back NOT_FOUND, so a
     * taxpayer holding a perfectly good TIN could not be registered against
     * it and the agent was told the number could not be found when the
     * number was fine.
     *
     * Only punctuation and spacing are removed. Nothing here decides what a
     * TIN looks like — that is the register's job, and inventing a format
     * check would refuse valid numbers the register would have accepted.
     */
    const normalisedTin = input.existingTin.replace(/[\s-]/g, '').toUpperCase();

    // An agent supplying an existing TIN does not get to assert it: it is
    // checked against the authoritative service first (PRD §11, §82).
    const lookup = await tinService.lookup(normalisedTin);

    if (lookup.outcome === 'UNAVAILABLE') {
      // The old message told the agent to "register the taxpayer as a new TIN
      // applicant" — advice that mints a duplicate TIN for someone who
      // already has one. During an outage that would happen to every existing
      // taxpayer an agent touched, and a duplicate in a UNIQUE column on an
      // undeletable row is permanent. So this stops instead.
      throw new AppError({
        statusCode: 503,
        code: 'TIN_SERVICE_UNAVAILABLE',
        message:
          'The PSIRS TIN service could not be reached, so this TIN cannot be confirmed. ' +
          'Nothing has been registered.',
        nextStep:
          'Try again in a few minutes. Do NOT register this taxpayer as a new TIN applicant — ' +
          'that would create a second TIN for someone who already has one.',
      });
    }

    if (lookup.outcome === 'NOT_FOUND') {
      /*
       * The advice here used to be "Check the number, or register the
       * taxpayer as a new TIN applicant" — which is the instruction that
       * mints a second TIN for somebody who already has one, and the exact
       * outcome the UNAVAILABLE branch above goes out of its way to
       * prevent. A duplicate in a UNIQUE column on an undeletable row is
       * permanent.
       *
       * The order matters: check the number first, because a mistyped digit
       * is far likelier than a taxpayer who has a TIN nobody has heard of.
       * Registering as new stays reachable, and is named as the answer only
       * to the question it actually answers.
       */
      throw new AppError({
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: `TIN ${input.existingTin} could not be found in the PSIRS TIN service.`,
        nextStep:
          'Check the number against the taxpayer’s own document first — a mistyped digit is ' +
          'the usual cause. Only if they have never had a TIN, go back and register them ' +
          'without one; the platform will apply for a new TIN for them.',
        details: [{ field: 'existingTin', issue: 'Not found in the authoritative TIN register' }],
      });
    }

    tin = lookup.tin ?? null;
    tinStatus = 'EXISTING';
  } else {
    const lgaRow = await queryOne<{ name: string }>(pool, 'SELECT name FROM lgas WHERE id = $1', [
      input.lgaId,
    ]);
    if (!lgaRow) throw badRequest('The selected Local Government Area is not valid.');

    const registration = await tinService.register({
      taxpayerType: input.taxpayerType,
      firstName: input.firstName,
      lastName: input.lastName,
      businessName: input.businessName,
      phone: input.phone,
      email: input.email ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      address: input.address,
      lgaName: lgaRow.name,
      identityType: input.identityType ?? null,
      identityNumber: input.identityNumber ?? null,
    });

    tinReference = registration.reference || null;
    tinReason = registration.message;

    // The registration itself is not blocked by an unreachable TIN service.
    // The taxpayer is real, the agent is standing in front of them, and the
    // taxpayer record is a fact this platform owns — unlike the TIN. An
    // assessment does not require a TIN, so they can be served today and the
    // number chased afterwards by `retryOutstandingTins`.
    //
    // What matters is that an outage lands in REQUESTED and not FAILED:
    // FAILED means the service considered this applicant and declined, which
    // is a dead end nothing retries.
    switch (registration.outcome) {
      case 'ASSIGNED':
        tin = registration.tin ?? null;
        tinStatus = tin ? 'ASSIGNED' : 'REQUESTED';
        break;
      case 'REJECTED':
        tinStatus = 'FAILED';
        break;
      default:
        tinStatus = 'REQUESTED';
    }
  }

  return withTransaction(async (client) => {
    const taxpayer = await queryOne<{ id: string }>(
      client,
      `INSERT INTO taxpayers (
         taxpayer_type, tin, tin_status, tin_requested_at, tin_assigned_at, tin_reference,
         first_name, middle_name, last_name, date_of_birth, gender,
         business_name, business_type, registration_number, nature_of_business,
         phone, alternate_phone, email, address, lga_id, ward_id, community,
         occupation, business_activity, identity_type, identity_hash, identity_masked,
         consent_given, consent_at, declaration_accepted,
         registered_by_agent_id, source, tin_reason, tin_attempts
       ) VALUES (
         $1,$2,$3, now(), $4, $5,
         $6,$7,$8,$9,$10,
         $11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,
         $22,$23,$24,$25,$26,
         $27, now(), $28,
         $29,$30,$31,$32
       ) RETURNING id`,
      [
        input.taxpayerType,
        tin,
        tinStatus,
        tinStatus === 'ASSIGNED' || tinStatus === 'EXISTING' ? new Date() : null,
        tinReference,
        input.firstName ?? null,
        input.middleName ?? null,
        input.lastName ?? null,
        input.dateOfBirth ?? null,
        input.gender ?? null,
        input.businessName ?? null,
        input.businessType ?? null,
        input.registrationNumber ?? null,
        input.natureOfBusiness ?? null,
        input.phone,
        input.alternatePhone ?? null,
        input.email ?? null,
        input.address,
        input.lgaId,
        input.wardId ?? null,
        input.community ?? null,
        input.occupation ?? null,
        input.businessActivity ?? null,
        input.identityType ?? null,
        identityHash,
        identityMasked,
        input.consentGiven,
        input.declarationAccepted,
        params.agentId ?? null,
        params.source ?? 'AGENT',
        tinReason,
        tinStatus === 'NOT_REQUESTED' || tinStatus === 'EXISTING' ? 0 : 1,
      ],
    );

    if (duplicates.length > 0) {
      await recordDuplicateCheck(client, {
        input,
        duplicates,
        decision: 'PROCEEDED',
        actorId: params.actorId,
        createdTaxpayerId: taxpayer!.id,
      });
    }

    await client.query(
      `INSERT INTO taxpayer_compliance (taxpayer_id, has_valid_tin)
       VALUES ($1, $2) ON CONFLICT (taxpayer_id) DO NOTHING`,
      [taxpayer!.id, tin !== null],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'taxpayer.registered',
      entityType: 'taxpayer',
      entityId: taxpayer!.id,
      newValue: {
        taxpayerType: input.taxpayerType,
        tin,
        tinStatus,
        lgaId: input.lgaId,
        agentId: params.agentId ?? null,
        duplicateWarnings: duplicates.length,
      },
      ipAddress: params.ipAddress ?? null,
      deviceId: params.deviceId ?? null,
    });

    return {
      taxpayerId: taxpayer!.id,
      tin,
      tinStatus,
      duplicatesConsidered: duplicates,
    };
  });
}

async function recordDuplicateCheck(
  client: PoolClient,
  params: {
    input: TaxpayerInput;
    duplicates: DuplicateMatch[];
    decision: 'BLOCKED' | 'PROCEEDED' | 'LINKED_EXISTING';
    actorId: string;
    createdTaxpayerId: string | null;
  },
): Promise<void> {
  const top = params.duplicates[0];
  await client.query(
    `INSERT INTO taxpayer_duplicate_checks
       (candidate_payload, matched_taxpayer_id, match_score, match_reasons,
        decision, created_taxpayer_id, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      JSON.stringify({
        taxpayerType: params.input.taxpayerType,
        name: params.input.businessName ?? `${params.input.firstName} ${params.input.lastName}`,
        phone: params.input.phone,
        lgaId: params.input.lgaId,
      }),
      top?.taxpayerId ?? null,
      top?.score ?? 0,
      params.duplicates.flatMap((match) => match.reasons),
      params.decision,
      params.createdTaxpayerId,
      params.actorId,
    ],
  );
}

/**
 * Retry TIN assignment for a taxpayer whose registration is pending or failed.
 * The TIN column can only ever be filled from the authoritative service.
 */
export async function requestTin(params: {
  taxpayerId: string;
  /** Null when a scheduled sweep runs it rather than a person. */
  actorId: string | null;
  actorRole: string;
}): Promise<{ tin: string | null; tinStatus: string }> {
  /*
   * Read, ask, then write — in that order, with nothing held open in between.
   *
   * All three used to happen inside one transaction, so every TIN request held
   * a pooled connection for as long as the PSIRS TIN service took to answer.
   * Splitting it opens a window in which somebody else could assign this
   * taxpayer a TIN: `retryOutstandingTins` sweeps in the background and calls
   * straight back into here. The write below re-reads `FOR UPDATE` and refuses
   * to overwrite a TIN that arrived while we were asking — which is a
   * guarantee the single transaction never actually made, because its read
   * took no lock either.
   */
  const taxpayer = await queryOne<{
    id: string;
    tin: string | null;
    tin_status: string;
    taxpayer_type: TaxpayerType;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    phone: string;
    email: string | null;
    date_of_birth: Date | null;
    address: string;
    lga_name: string;
  }>(
    pool,
    `SELECT t.id, t.tin, t.tin_status, t.taxpayer_type, t.first_name, t.last_name,
            t.business_name, t.phone, t.email, t.date_of_birth, t.address, l.name AS lga_name
       FROM taxpayers t JOIN lgas l ON l.id = t.lga_id
      WHERE t.id = $1`,
    [params.taxpayerId],
  );

  if (!taxpayer) throw notFound('That taxpayer');
  if (taxpayer.tin) {
    return { tin: taxpayer.tin, tinStatus: taxpayer.tin_status };
  }

  const registration = await tinService.register({
    taxpayerType: taxpayer.taxpayer_type,
    firstName: taxpayer.first_name ?? undefined,
    lastName: taxpayer.last_name ?? undefined,
    businessName: taxpayer.business_name ?? undefined,
    phone: taxpayer.phone,
    email: taxpayer.email,
    dateOfBirth: taxpayer.date_of_birth?.toISOString().slice(0, 10) ?? null,
    address: taxpayer.address,
    lgaName: taxpayer.lga_name,
  });

  return withTransaction(async (client) => {
    /*
     * Somebody may have got there while we were asking.
     *
     * The TIN column can only ever be filled from the authoritative service,
     * and it is a UNIQUE column — so overwriting one that arrived in the
     * meantime would either lose a real number or fail on the constraint. The
     * number we were just handed is recorded in the audit entry instead, so it
     * can be reconciled with the register rather than quietly dropped.
     */
    const current = await queryOne<{ tin: string | null; tin_status: string }>(
      client,
      'SELECT tin, tin_status FROM taxpayers WHERE id = $1 FOR UPDATE',
      [params.taxpayerId],
    );
    if (!current) throw notFound('That taxpayer');

    if (current.tin) {
      await recordAudit(client, {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: 'taxpayer.tin_request_superseded',
        entityType: 'taxpayer',
        entityId: params.taxpayerId,
        oldValue: { tin: current.tin },
        newValue: {
          discardedOutcome: registration.outcome,
          discardedReference: registration.reference || null,
          provider: registration.provider,
        },
      });
      return { tin: current.tin, tinStatus: current.tin_status };
    }

    // Only a REJECTED registration is a dead end. An unreachable service — and
    // an "assigned" reply carrying no usable number — stay REQUESTED, so
    // `retryOutstandingTins` picks them up instead of stranding the taxpayer.
    const assigned = registration.outcome === 'ASSIGNED' ? (registration.tin ?? null) : null;
    const status =
      assigned !== null ? 'ASSIGNED' : registration.outcome === 'REJECTED' ? 'FAILED' : 'REQUESTED';

    await client.query(
      `UPDATE taxpayers
          SET tin = COALESCE($2, tin), tin_status = $3,
              tin_reference = COALESCE($4, tin_reference),
              tin_reason = $5,
              tin_attempts = tin_attempts + 1,
              tin_assigned_at = CASE WHEN $2 IS NOT NULL THEN now() ELSE tin_assigned_at END
        WHERE id = $1`,
      [
        params.taxpayerId,
        assigned,
        status,
        registration.reference || null,
        registration.message,
      ],
    );

    if (assigned !== null) {
      await client.query(
        `UPDATE taxpayer_compliance SET has_valid_tin = true WHERE taxpayer_id = $1`,
        [params.taxpayerId],
      );
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'taxpayer.tin_requested',
      entityType: 'taxpayer',
      entityId: params.taxpayerId,
      newValue: {
        tinStatus: status,
        outcome: registration.outcome,
        reference: registration.reference || null,
        provider: registration.provider,
      },
    });

    return { tin: assigned, tinStatus: status };
  });
}

/**
 * Chase every taxpayer still waiting for a TIN (PRD §11, §82).
 *
 * This is the counterpart to the TIN service being allowed to say it could not
 * be reached. Without it, "we will ask again later" is a promise nothing keeps,
 * and a taxpayer registered during an outage would sit without a TIN for good.
 *
 * Safe to run repeatedly: a taxpayer who already holds a TIN is not selected,
 * and `requestTin` returns early for one who acquires it in between.
 */
export async function retryOutstandingTins(params: {
  /** Null when a scheduled sweep runs it rather than a person. */
  actorId: string | null;
  actorRole: string;
  limit?: number;
}): Promise<{ attempted: number; assigned: number; stillOutstanding: number }> {
  const waiting = await query<{ id: string }>(
    pool,
    `SELECT id FROM taxpayers
      WHERE tin IS NULL
        AND tin_status IN ('REQUESTED', 'FAILED')
        AND status IN ('ACTIVE', 'DRAFT')
      ORDER BY created_at
      LIMIT $1`,
    [params.limit ?? 100],
  );

  let assigned = 0;

  for (const taxpayer of waiting) {
    const result = await requestTin({
      taxpayerId: taxpayer.id,
      actorId: params.actorId,
      actorRole: params.actorRole,
    });
    if (result.tin) assigned += 1;
  }

  return {
    attempted: waiting.length,
    assigned,
    stillOutstanding: waiting.length - assigned,
  };
}

/** Taxpayers registered without a TIN, and why. */
export async function taxpayersAwaitingTin(db: Db, limit = 100) {
  return query(
    db,
    `SELECT id, tin_status, tin_reason, tin_reference, tin_attempts, created_at,
            COALESCE(business_name, trim(concat_ws(' ', first_name, last_name))) AS display_name,
            phone
       FROM taxpayers
      WHERE tin IS NULL
        AND tin_status IN ('REQUESTED', 'FAILED')
        AND status IN ('ACTIVE', 'DRAFT')
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );
}

export interface TaxpayerSearchParams {
  q?: string;
  tin?: string;
  phone?: string;
  vehicleRegistration?: string;
  receiptNumber?: string;
  transactionReference?: string;
  lgaId?: string;
  limit?: number;
}

/**
 * Taxpayer search (PRD §13). Every branch is a parameterised query — a search
 * box on a government system is the last place to build SQL by concatenation.
 */
export async function searchTaxpayers(db: Db, params: TaxpayerSearchParams) {
  const limit = Math.min(params.limit ?? 25, 100);
  const conditions: string[] = ["t.status IN ('ACTIVE','DRAFT')"];
  const values: unknown[] = [];

  const add = (clause: string, value: unknown) => {
    values.push(value);
    conditions.push(clause.replace('$$', `$${values.length}`));
  };

  if (params.tin) add('t.tin = $$', params.tin.trim());
  if (params.phone) add('t.phone = $$', params.phone.trim());
  if (params.lgaId) add('t.lga_id = $$', params.lgaId);

  if (params.vehicleRegistration) {
    add(
      't.id IN (SELECT taxpayer_id FROM vehicles WHERE registration_number = $$)',
      params.vehicleRegistration.trim().toUpperCase(),
    );
  }
  if (params.receiptNumber) {
    add('t.id IN (SELECT taxpayer_id FROM receipts WHERE receipt_number = $$)', params.receiptNumber.trim());
  }
  if (params.transactionReference) {
    add(
      't.id IN (SELECT taxpayer_id FROM transactions WHERE transaction_reference = $$)',
      params.transactionReference.trim(),
    );
  }
  if (params.q) {
    const term = `%${params.q.trim().toLowerCase()}%`;
    values.push(term);
    conditions.push(
      `(lower(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,'')) LIKE $${values.length}` +
        ` OR lower(coalesce(t.business_name,'')) LIKE $${values.length}` +
        ` OR t.phone LIKE $${values.length} OR t.tin LIKE $${values.length})`,
    );
  }

  values.push(limit);

  return query(
    db,
    `SELECT t.id, t.taxpayer_type, t.tin, t.tin_status, t.first_name, t.middle_name, t.last_name,
            t.business_name, t.phone, t.email, t.address, t.community, t.status,
            l.name AS lga_name, w.name AS ward_name, t.created_at
       FROM taxpayers t
       JOIN lgas l ON l.id = t.lga_id
       LEFT JOIN wards w ON w.id = t.ward_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.created_at DESC
      LIMIT $${values.length}`,
    values,
  );
}

/**
 * Taxpayer profile (PRD §12), scoped to who is asking (PRD §36).
 *
 * The §36 access matrix gives an agent "Assigned" access to taxpayers, not
 * "All". An agent legitimately needs to find a taxpayer and see what they owe —
 * that is the job. What they do not need is the taxpayer's whole financial life:
 * payments other agents collected, receipts from other transactions, and the
 * compliance score that drives incentive eligibility.
 *
 * So an agent sees the taxpayer's identity, their outstanding obligations, their
 * vehicles (needed for renewals) and the work that agent facilitated. A revenue
 * officer or auditor sees everything. The response says which view was served,
 * so a client can never mistake a partial history for a complete one.
 */
export async function getTaxpayerProfile(
  db: Db,
  taxpayerId: string,
  viewer: { role: string; agentId?: string | null } = { role: 'revenue_officer' },
) {
  const taxpayer = await queryOne(
    db,
    `SELECT t.*, l.name AS lga_name, w.name AS ward_name
       FROM taxpayers t
       JOIN lgas l ON l.id = t.lga_id
       LEFT JOIN wards w ON w.id = t.ward_id
      WHERE t.id = $1`,
    [taxpayerId],
  );
  if (!taxpayer) throw notFound('That taxpayer');

  // An agent's financial view is filtered to their own facilitated work; every
  // other role sees the full record. Passing NULL for agentId disables the
  // filter, so the same query serves both without a second code path.
  const agentFilter = viewer.role === 'agent' ? (viewer.agentId ?? null) : null;
  const limitedView = viewer.role === 'agent';

  const [assessments, transactions, receipts, vehicles, compliance, programmes] = await Promise.all([
    query(
      db,
      `SELECT a.id, a.assessment_number, a.amount_kobo, a.status, a.period_label, a.created_at,
              ri.name AS revenue_item, rc.name AS revenue_category
         FROM assessments a
         JOIN revenue_items ri ON ri.id = a.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
        WHERE a.taxpayer_id = $1
          AND ($2::boolean IS FALSE OR a.agent_id IS NOT DISTINCT FROM $3::uuid)
        ORDER BY a.created_at DESC LIMIT 50`,
      [taxpayerId, limitedView, agentFilter],
    ),
    query(
      db,
      `SELECT tr.id, tr.transaction_reference, tr.amount_kobo, tr.status, tr.created_at,
              ri.name AS revenue_item
         FROM transactions tr
         JOIN revenue_items ri ON ri.id = tr.revenue_item_id
        WHERE tr.taxpayer_id = $1
          AND ($2::boolean IS FALSE OR tr.agent_id IS NOT DISTINCT FROM $3::uuid)
        ORDER BY tr.created_at DESC LIMIT 50`,
      [taxpayerId, limitedView, agentFilter],
    ),
    query(
      db,
      `SELECT r.id, r.receipt_number, r.amount_kobo, r.status, r.issued_at, r.verification_code,
              d.id AS document_id
         FROM receipts r
         JOIN transactions tr ON tr.id = r.transaction_id
         LEFT JOIN documents d ON d.id = r.document_id
        WHERE r.taxpayer_id = $1
          AND ($2::boolean IS FALSE OR tr.agent_id IS NOT DISTINCT FROM $3::uuid)
        ORDER BY r.issued_at DESC LIMIT 50`,
      [taxpayerId, limitedView, agentFilter],
    ),
    query(
      db,
      `SELECT id, registration_number, vehicle_type, make, model, current_expiry_date, status
         FROM vehicles WHERE taxpayer_id = $1 ORDER BY created_at DESC`,
      [taxpayerId],
    ),
    // Compliance scoring and programme eligibility are taxpayer incentive data.
    // They belong to the taxpayer, government and the citizen portal — not to
    // the agent collecting a levy.
    limitedView
      ? Promise.resolve(null)
      : queryOne(db, 'SELECT * FROM taxpayer_compliance WHERE taxpayer_id = $1', [taxpayerId]),
    limitedView
      ? Promise.resolve([])
      : query(
          db,
          `SELECT p.id, p.name, p.benefit_type, p.benefit_description, p.linkage_mode,
                  e.eligible, e.reasons, e.benefit_tier
             FROM programme_eligibility e
             JOIN incentive_programmes p ON p.id = e.programme_id
            WHERE e.taxpayer_id = $1 AND p.status = 'ACTIVE'`,
          [taxpayerId],
        ),
  ]);

  return {
    scope: limitedView ? 'AGENT_LIMITED' : 'FULL',
    taxpayer,
    assessments,
    transactions,
    receipts,
    vehicles,
    compliance,
    programmes,
    ...(limitedView
      ? {
          note:
            'You are shown this taxpayer’s details, what they owe, and the transactions you ' +
            'facilitated. Their full payment history is held by PSIRS.',
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Correcting who a taxpayer record says somebody is
// ---------------------------------------------------------------------------
//
// A record captured in a market by an agent working from what somebody told
// them will sometimes be wrong: a misspelt surname, a date of birth a year
// out, an identity document replaced after it was lost. There was no way to
// correct any of it. The record was written at registration and the only
// fields that ever moved afterwards were the TIN and the compliance figures.
//
// `STEP_UP_ACTIONS` has always named `taxpayer.identity.change`, which is the
// shape of the answer: a correction is an ordinary act of administration, but
// it is not one to be made from a session somebody left open.
//
// TWO TIERS, BECAUSE TWO DIFFERENT THINGS ARE BEING CHANGED. Correcting a
// name or a date of birth fixes what the record says about a person. Changing
// the identity document changes *which person the record is about*: the
// identity hash is what duplicate detection blocks on, scoring a full 100
// where a shared phone reaches 85. So names and dates are within a revenue
// officer's ordinary work, and the identity document is not.
//
// Agents are excluded from both. An agent who notices a misspelling raises it
// through support, where somebody who did not capture the record decides. An
// agent who can rewrite the identity of a taxpayer they registered can point
// a compliance history, and the benefits that follow from it, at a different
// person.

export interface IdentityChangeInput {
  taxpayerId: string;
  actorId: string;
  actorRole: string;
  reason: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  businessName?: string;
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
  identityType?: string;
  identityNumber?: string;
}

/** The fields that say which person a record is about, rather than what it says about them. */
export function changesIdentityDocument(input: {
  identityType?: string;
  identityNumber?: string;
}): boolean {
  return input.identityType !== undefined || input.identityNumber !== undefined;
}

export async function changeTaxpayerIdentity(input: IdentityChangeInput): Promise<{
  changed: string[];
  message: string;
}> {
  return withTransaction(async (client) => {
    const current = await queryOne<{
      id: string;
      taxpayer_type: string;
      first_name: string | null;
      middle_name: string | null;
      last_name: string | null;
      business_name: string | null;
      date_of_birth: Date | null;
      gender: string | null;
      identity_type: string | null;
      identity_hash: string | null;
      identity_masked: string | null;
      phone: string;
      status: string;
    }>(
      client,
      `SELECT id, taxpayer_type, first_name, middle_name, last_name, business_name,
              date_of_birth, gender, identity_type, identity_hash, identity_masked, phone, status
         FROM taxpayers WHERE id = $1 FOR UPDATE`,
      [input.taxpayerId],
    );
    if (!current) throw notFound('That taxpayer');
    if (current.status !== 'ACTIVE') {
      throw conflict(
        'TAXPAYER_NOT_ACTIVE',
        `This taxpayer record is ${current.status.toLowerCase()}, so it cannot be corrected.`,
      );
    }

    const identityHash = input.identityNumber ? hashIdentityNumber(input.identityNumber) : null;
    const identityMasked = input.identityNumber ? maskIdentityNumber(input.identityNumber) : null;

    // The identity hash is what duplicate detection blocks on, so a change to
    // it must not walk this record onto somebody else's identity. Checked
    // before anything is written, and inside the transaction so a concurrent
    // registration cannot slip in behind it.
    if (identityHash && identityHash !== current.identity_hash) {
      const clash = await queryOne<{ id: string; tin: string | null }>(
        client,
        `SELECT id, tin FROM taxpayers
          WHERE identity_hash = $1 AND id <> $2 AND status = 'ACTIVE'`,
        [identityHash, input.taxpayerId],
      );
      if (clash) {
        throw conflict(
          'IDENTITY_ALREADY_REGISTERED',
          'Another active taxpayer is already registered with that identification number. ' +
            'If the same person has been registered twice, the duplicate has to be resolved ' +
            'rather than the number moved.',
        );
      }
    }

    const previousDob = current.date_of_birth?.toISOString().slice(0, 10) ?? null;

    /** Only what genuinely differs, so a no-op correction is refused rather than audited. */
    const changed: string[] = [];
    const differs = (field: string, before: unknown, after: unknown) => {
      if (after === undefined) return false;
      if ((before ?? null) === (after ?? null)) return false;
      changed.push(field);
      return true;
    };

    differs('firstName', current.first_name, input.firstName);
    differs('middleName', current.middle_name, input.middleName);
    differs('lastName', current.last_name, input.lastName);
    differs('businessName', current.business_name, input.businessName);
    differs('dateOfBirth', previousDob, input.dateOfBirth);
    differs('gender', current.gender, input.gender);
    differs('identityType', current.identity_type, input.identityType);
    if (identityHash && identityHash !== current.identity_hash) changed.push('identityNumber');

    if (changed.length === 0) {
      throw badRequest(
        'Nothing on this record would change. Check the values against what is already held.',
      );
    }

    await client.query(
      `UPDATE taxpayers
          SET first_name    = COALESCE($2, first_name),
              middle_name   = COALESCE($3, middle_name),
              last_name     = COALESCE($4, last_name),
              business_name = COALESCE($5, business_name),
              date_of_birth = COALESCE($6::date, date_of_birth),
              gender        = COALESCE($7, gender),
              identity_type = COALESCE($8, identity_type),
              identity_hash = COALESCE($9, identity_hash),
              identity_masked = COALESCE($10, identity_masked)
        WHERE id = $1`,
      [
        input.taxpayerId,
        input.firstName ?? null,
        input.middleName ?? null,
        input.lastName ?? null,
        input.businessName ?? null,
        input.dateOfBirth ?? null,
        input.gender ?? null,
        input.identityType ?? null,
        identityHash,
        identityMasked,
      ],
    );

    // The identity number itself is never written to the audit log — the
    // masked form is, which is enough to see that the document on file
    // changed and which one it now is, without putting the number in a table
    // more people can read than can read the taxpayer record.
    await recordAudit(client, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: 'taxpayer.identity_changed',
      entityType: 'taxpayer',
      entityId: input.taxpayerId,
      oldValue: {
        firstName: current.first_name,
        middleName: current.middle_name,
        lastName: current.last_name,
        businessName: current.business_name,
        dateOfBirth: previousDob,
        gender: current.gender,
        identityType: current.identity_type,
        identityMasked: current.identity_masked,
      },
      newValue: {
        firstName: input.firstName ?? current.first_name,
        middleName: input.middleName ?? current.middle_name,
        lastName: input.lastName ?? current.last_name,
        businessName: input.businessName ?? current.business_name,
        dateOfBirth: input.dateOfBirth ?? previousDob,
        gender: input.gender ?? current.gender,
        identityType: input.identityType ?? current.identity_type,
        identityMasked: identityMasked ?? current.identity_masked,
        changed,
      },
      reason: input.reason,
    });

    // Told on the number already on the record. A correction somebody else
    // asked for is then noticed by the person it was made to.
    await queueNotification(client, {
      event: 'TAXPAYER_RECORD_CORRECTED',
      taxpayerId: input.taxpayerId,
      variables: { fields: changed.length === 1 ? 'one detail' : `${changed.length} details` },
      entityType: 'taxpayer',
      entityId: input.taxpayerId,
    });

    return {
      changed,
      message:
        changed.length === 1
          ? 'One detail on this taxpayer record has been corrected. The change is on the audit trail.'
          : `${changed.length} details on this taxpayer record have been corrected. The change is on the audit trail.`,
    };
  });
}
