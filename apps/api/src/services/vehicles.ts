/**
 * Vehicle particulars renewal (PRD §21, §22).
 *
 * PRD §21: "The system must not rely solely on manually entered vehicle data."
 * A lookup always consults the authoritative registry first; a manually entered
 * vehicle is stored with `source = 'MANUAL_ENTRY'` and `owner_verified = false`
 * so downstream screens and reports can tell the difference.
 *
 * The renewal document is issued only after the transaction is paid and
 * verified — enforced by the `renewals_require_payment` trigger as well as by
 * this code.
 */

import { parseKobo } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { conflict, notFound, badRequest } from '../lib/errors';
import { generateVerificationCode } from '../lib/crypto';
import { vehicleRegistry, type VehicleLookupOutcome } from '../integrations';
import { recordAudit } from './audit';
import { registerDocument, renderVehicleDocumentPdf } from './documents';
import { createAssessment } from './revenue';
import { queueNotification } from './notifications';

export interface VehicleLookup {
  /**
   * Where the answer came from. `REGISTRY_UNAVAILABLE` is not an answer: the
   * authority could not be asked, and the agent is told that in those words
   * rather than "no such vehicle".
   */
  source: 'PLATFORM' | 'AUTHORITY' | 'NOT_FOUND' | 'REGISTRY_UNAVAILABLE';
  vehicle: Record<string, unknown> | null;
  authorityConfirmed: boolean;
  message: string;
}

/** Search the platform, then the authoritative registry (PRD §22 step 1-2). */
export async function lookupVehicle(db: Db, registrationNumber: string): Promise<VehicleLookup> {
  const normalised = registrationNumber.trim().toUpperCase().replace(/\s+/g, '');

  const local = await queryOne<Record<string, unknown>>(
    db,
    `SELECT v.*, tp.first_name, tp.last_name, tp.business_name, tp.tin, tp.phone AS taxpayer_phone
       FROM vehicles v LEFT JOIN taxpayers tp ON tp.id = v.taxpayer_id
      WHERE v.registration_number = $1`,
    [normalised],
  );

  if (local) {
    return {
      source: 'PLATFORM',
      vehicle: local,
      authorityConfirmed: local.authority_verified_at !== null,
      message:
        local.authority_verified_at !== null
          ? 'Vehicle found and confirmed against the vehicle authority record.'
          : 'Vehicle found on the platform. It has not been confirmed against the vehicle authority.',
    };
  }

  const authority = await vehicleRegistry.lookup(normalised);

  if (authority.outcome === 'UNAVAILABLE') {
    // Saying "not found" here would be a lie with consequences: the agent would
    // capture the vehicle manually and the platform would hold an unverified
    // record indistinguishable from one for a genuinely unregistered vehicle.
    return {
      source: 'REGISTRY_UNAVAILABLE',
      vehicle: null,
      authorityConfirmed: false,
      message:
        'The vehicle authority could not be reached, so we cannot say whether this vehicle ' +
        'is registered. Try again shortly. If the renewal cannot wait, capture the details ' +
        'manually — the record will be flagged for checking once the authority is back.',
    };
  }

  if (authority.outcome === 'NOT_FOUND') {
    return {
      source: 'NOT_FOUND',
      vehicle: null,
      authorityConfirmed: false,
      message:
        'No record of this vehicle was found on the platform or at the vehicle authority. ' +
        'Capture the vehicle details manually — the record will be marked as unverified.',
    };
  }

  return {
    source: 'AUTHORITY',
    vehicle: authority.vehicle as unknown as Record<string, unknown>,
    authorityConfirmed: true,
    message: 'Vehicle found at the vehicle authority. Confirm the owner before proceeding.',
  };
}

export interface VehicleCaptureInput {
  registrationNumber: string;
  chassisNumber?: string;
  engineNumber?: string;
  make?: string;
  model?: string;
  yearOfManufacture?: number;
  vehicleType: string;
  vehicleClass?: string;
  colour?: string;
  ownerName: string;
  ownerPhone?: string;
  taxpayerId?: string;
}

export interface VehicleCaptureResult {
  vehicleId: string;
  source: string;
  authorityConfirmed: boolean;
  /** What the authority actually said — or that it could not be asked. */
  authorityOutcome: VehicleLookupOutcome;
  message: string;
}

/**
 * Capture or update a vehicle, consulting the authority first (PRD §21).
 *
 * Three outcomes, and only one of them may set `authority_verified_at`:
 *
 *   FOUND        registry data wins over agent-typed data; record confirmed
 *   NOT_FOUND    the authority says it holds no such vehicle; manual entry
 *   UNAVAILABLE  we could not ask; manual entry, flagged for re-checking
 *
 * The last two both produce a MANUAL_ENTRY record, but they are not the same
 * fact and `authority_lookup_outcome` keeps them apart, so a record captured
 * during an outage can be found again and re-verified.
 */
export async function upsertVehicle(params: {
  input: VehicleCaptureInput;
  actorId: string;
  actorRole: string;
}): Promise<VehicleCaptureResult> {
  const normalised = params.input.registrationNumber.trim().toUpperCase().replace(/\s+/g, '');

  /*
   * Asked before the transaction opens, not inside it.
   *
   * This call used to be the first statement in the transaction below, which
   * meant every capture held a pooled connection and an open transaction for
   * as long as the vehicle authority took to answer — up to the registry
   * timeout, on a service the platform does not control. Under a slow registry
   * that is how a pool runs out of connections and a queue of agents in
   * markets stops being able to do anything at all.
   *
   * Nothing in the transaction feeds this call, so it simply moves out. Where
   * a call genuinely does depend on rows read inside a transaction, the fix is
   * the one `attemptRefund` uses — commit, then call — and it is a larger
   * change than moving a line.
   */
  const authority = await vehicleRegistry.lookup(normalised);

  return withTransaction(async (client) => {
    const found = authority.outcome === 'FOUND';
    const record = authority.vehicle;
    const source = found ? 'AUTHORITY_LOOKUP' : 'MANUAL_ENTRY';
    const message = captureMessage(authority.outcome);

    const existing = await queryOne<{ id: string; source: string }>(
      client,
      'SELECT id, source FROM vehicles WHERE registration_number = $1',
      [normalised],
    );

    if (existing) {
      await client.query(
        `UPDATE vehicles
            SET taxpayer_id = COALESCE($2, taxpayer_id),
                owner_phone = COALESCE($3, owner_phone),
                authority_reference = COALESCE($4, authority_reference),
                authority_verified_at = CASE WHEN $5 THEN now() ELSE authority_verified_at END,
                current_expiry_date = COALESCE($6, current_expiry_date),
                -- An outage must not downgrade a record the authority has
                -- already confirmed: only a real answer overwrites one.
                authority_lookup_outcome = CASE WHEN $7 = 'UNAVAILABLE'
                                                 AND authority_lookup_outcome = 'FOUND'
                                                THEN authority_lookup_outcome ELSE $7 END
          WHERE id = $1`,
        [
          existing.id,
          params.input.taxpayerId ?? null,
          params.input.ownerPhone ?? null,
          record?.authorityReference ?? null,
          found,
          record?.currentExpiryDate ?? null,
          authority.outcome,
        ],
      );
      return {
        vehicleId: existing.id,
        source: existing.source,
        authorityConfirmed: found,
        authorityOutcome: authority.outcome,
        message,
      };
    }

    // Registry data wins over agent-typed data wherever both exist.
    const vehicle = await queryOne<{ id: string }>(
      client,
      `INSERT INTO vehicles
         (taxpayer_id, registration_number, chassis_number, engine_number, make, model,
          year_of_manufacture, vehicle_type, vehicle_class, colour, owner_name, owner_phone,
          source, authority_reference, authority_verified_at, current_expiry_date,
          authority_lookup_outcome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        params.input.taxpayerId ?? null,
        normalised,
        record?.chassisNumber ?? params.input.chassisNumber ?? null,
        record?.engineNumber ?? params.input.engineNumber ?? null,
        record?.make ?? params.input.make ?? null,
        record?.model ?? params.input.model ?? null,
        params.input.yearOfManufacture ?? null,
        record?.vehicleType ?? params.input.vehicleType,
        record?.vehicleClass ?? params.input.vehicleClass ?? null,
        record?.colour ?? params.input.colour ?? null,
        record?.ownerName ?? params.input.ownerName,
        params.input.ownerPhone ?? record?.ownerPhone ?? null,
        source,
        record?.authorityReference ?? null,
        found ? new Date() : null,
        record?.currentExpiryDate ?? null,
        authority.outcome,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'vehicle.captured',
      entityType: 'vehicle',
      entityId: vehicle!.id,
      newValue: {
        registrationNumber: normalised,
        source,
        authorityConfirmed: found,
        authorityOutcome: authority.outcome,
        // Recorded so the audit trail says why a vehicle went in unverified.
        authorityReason: authority.reason ?? null,
        registryProvider: authority.provider,
      },
    });

    return {
      vehicleId: vehicle!.id,
      source,
      authorityConfirmed: found,
      authorityOutcome: authority.outcome,
      message,
    };
  });
}

function captureMessage(outcome: VehicleLookupOutcome): string {
  switch (outcome) {
    case 'FOUND':
      return 'Vehicle recorded and confirmed against the vehicle authority.';
    case 'NOT_FOUND':
      return 'Vehicle recorded from manual entry. The vehicle authority holds no record of it.';
    case 'UNAVAILABLE':
      return (
        'Vehicle recorded from manual entry. The vehicle authority could not be reached, ' +
        'so this record has NOT been confirmed and is flagged for checking.'
      );
  }
}

/**
 * Start a renewal: verify the owner, price it, raise the invoice.
 *
 * The renewal fee comes from the revenue catalogue like any other charge, so a
 * vehicle renewal is reconciled, receipted and commissioned by exactly the same
 * machinery as a market levy.
 */
export async function initiateRenewal(params: {
  vehicleId: string;
  revenueItemId: string;
  renewalPeriodMonths: number;
  taxpayerId: string;
  actorId: string;
  actorRole: string;
  agentId?: string | null;
  territoryId?: string | null;
  deviceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}) {
  if (![6, 12, 24].includes(params.renewalPeriodMonths)) {
    throw badRequest('Vehicle particulars can be renewed for 6, 12 or 24 months.');
  }

  const vehicle = await withTransaction(async (client) =>
    queryOne<{
      id: string;
      registration_number: string;
      vehicle_type: string;
      vehicle_class: string | null;
      taxpayer_id: string | null;
      owner_name: string;
      current_expiry_date: Date | null;
      status: string;
      status_reason: string | null;
    }>(
      client,
      `SELECT id, registration_number, vehicle_type, vehicle_class, taxpayer_id,
              owner_name, current_expiry_date, status, status_reason
         FROM vehicles WHERE id = $1`,
      [params.vehicleId],
    ),
  );

  if (!vehicle) throw notFound('That vehicle');

  /*
   * A vehicle that is out of service cannot have its particulars renewed.
   *
   * `vehicles.status` has declared ACTIVE, SUSPENDED and ARCHIVED since the
   * table was created, and until `setVehicleStatus` there was no way to leave
   * ACTIVE — so this check had nothing to catch and the column was decoration.
   * Both halves had to arrive together: a status nothing writes is a state
   * that never happens, and a status nothing reads is a state that means
   * nothing when it does.
   */
  if (vehicle.status !== 'ACTIVE') {
    throw conflict(
      'VEHICLE_NOT_IN_SERVICE',
      vehicle.status === 'ARCHIVED'
        ? `${vehicle.registration_number} has been taken off the register` +
          `${vehicle.status_reason ? ` — ${vehicle.status_reason}` : ''}. Papers cannot be ` +
          'renewed for it. Register the vehicle again if it is back on the road.'
        : `${vehicle.registration_number} is suspended` +
          `${vehicle.status_reason ? ` — ${vehicle.status_reason}` : ''}. PSIRS has to lift the ` +
          'suspension before its particulars can be renewed.',
    );
  }

  // PRD §22 step 3: verify owner. The vehicle must belong to the taxpayer who
  // is paying, so one person cannot renew another's papers by accident.
  if (vehicle.taxpayer_id && vehicle.taxpayer_id !== params.taxpayerId) {
    throw conflict(
      'VEHICLE_OWNER_MISMATCH',
      'This vehicle is registered to a different taxpayer on the platform. ' +
        'Confirm ownership before renewing.',
    );
  }

  const assessment = await createAssessment({
    taxpayerId: params.taxpayerId,
    revenueItemId: params.revenueItemId,
    inputs: {
      renewalPeriodMonths: params.renewalPeriodMonths,
      vehicleType: vehicle.vehicle_type,
      vehicleClass: vehicle.vehicle_class,
      registrationNumber: vehicle.registration_number,
    },
    periodLabel: `${params.renewalPeriodMonths} month vehicle renewal`,
    actorId: params.actorId,
    actorRole: params.actorRole,
    agentId: params.agentId ?? null,
    territoryId: params.territoryId ?? null,
    deviceId: params.deviceId ?? null,
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
  });

  /*
   * An early renewal carries the unexpired time forward.
   *
   * This used to be `new Date()` unconditionally, so the period always began
   * the day it was paid for. A motorist renewing a month before their papers
   * ran out lost that month: twelve months paid, eleven received. It compounds
   * over a vehicle's life, and it falls hardest on the owners who did the right
   * thing — renewing before expiry is exactly what this platform's own
   * reminders ask them to do.
   *
   * `current_expiry_date` was already selected here and simply never read.
   *
   * A vehicle that has lapsed, or that this platform has never renewed, still
   * starts today. There is nothing to carry forward, and back-dating cover
   * across a period the vehicle was driving unlicensed would be a worse answer
   * than starting now.
   */
  const now = new Date();
  const unexpired =
    vehicle.current_expiry_date && vehicle.current_expiry_date.getTime() > now.getTime()
      ? new Date(vehicle.current_expiry_date)
      : null;
  const periodStart = unexpired ?? now;
  const expiryDate = new Date(periodStart);
  expiryDate.setMonth(expiryDate.getMonth() + params.renewalPeriodMonths);

  const renewal = await withTransaction(async (client) => {
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO vehicle_renewals
         (vehicle_id, transaction_id, renewal_period_months, period_start, expiry_date,
          status, agent_id)
       VALUES ($1,$2,$3,$4,$5,'PENDING_PAYMENT',$6) RETURNING id`,
      [
        params.vehicleId,
        assessment.transactionId,
        params.renewalPeriodMonths,
        periodStart,
        expiryDate,
        params.agentId ?? null,
      ],
    );

    if (!vehicle.taxpayer_id) {
      await client.query('UPDATE vehicles SET taxpayer_id = $2 WHERE id = $1', [
        params.vehicleId,
        params.taxpayerId,
      ]);
    }

    return row!;
  });

  return {
    renewalId: renewal.id,
    ...assessment,
    periodStart,
    expiryDate,
    registrationNumber: vehicle.registration_number,
  };
}

/**
 * Issue the renewal document after payment has been verified (PRD §22).
 * Refuses if the transaction is not in a paid state — the same rule as receipts.
 */
export async function completeRenewal(params: {
  renewalId: string;
  /**
   * Null when a webhook drove the confirmation, which is the ordinary case: the
   * gateway told us the money arrived and no person was involved. The audit
   * entry then records the system rather than naming someone who did nothing.
   */
  actorId: string | null;
  actorRole: string;
}): Promise<{ documentId: string; documentNumber: string; verificationCode: string; expiryDate: Date }> {
  return withTransaction(async (client) => {
    const renewal = await queryOne<{
      id: string;
      vehicle_id: string;
      transaction_id: string | null;
      renewal_period_months: number;
      period_start: Date;
      expiry_date: Date;
      status: string;
      document_id: string | null;
      transaction_status: string | null;
      transaction_reference: string | null;
      registration_number: string;
      owner_name: string;
      make: string | null;
      model: string | null;
      chassis_number: string | null;
      engine_number: string | null;
      vehicle_type: string;
      colour: string | null;
      taxpayer_id: string | null;
    }>(
      client,
      `SELECT r.id, r.vehicle_id, r.transaction_id, r.renewal_period_months, r.period_start,
              r.expiry_date, r.status, r.document_id,
              t.status AS transaction_status, t.transaction_reference,
              v.registration_number, v.owner_name, v.make, v.model, v.chassis_number,
              v.engine_number, v.vehicle_type, v.colour, v.taxpayer_id
         FROM vehicle_renewals r
         JOIN vehicles v ON v.id = r.vehicle_id
         LEFT JOIN transactions t ON t.id = r.transaction_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [params.renewalId],
    );

    if (!renewal) throw notFound('That renewal');

    if (renewal.document_id) {
      const doc = await queryOne<{ document_number: string; verification_code: string }>(
        client,
        'SELECT document_number, verification_code FROM documents WHERE id = $1',
        [renewal.document_id],
      );
      return {
        documentId: renewal.document_id,
        documentNumber: doc!.document_number,
        verificationCode: doc!.verification_code,
        expiryDate: renewal.expiry_date,
      };
    }

    const paidStates = ['PAYMENT_VERIFIED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING', 'SETTLED'];
    if (!renewal.transaction_status || !paidStates.includes(renewal.transaction_status)) {
      throw conflict(
        'RENEWAL_NOT_PAID',
        'The renewal document cannot be issued until the payment has been confirmed. ' +
          `The transaction is currently ${renewal.transaction_status ?? 'not started'}.`,
        'Check the transaction status; the document is issued automatically once payment is verified.',
      );
    }

    const verificationCode = generateVerificationCode();
    const issuedAt = new Date();

    const pdf = await renderVehicleDocumentPdf({
      documentNumber: 'pending',
      registrationNumber: renewal.registration_number,
      ownerName: renewal.owner_name,
      make: renewal.make,
      model: renewal.model,
      chassisNumber: renewal.chassis_number,
      engineNumber: renewal.engine_number,
      vehicleType: renewal.vehicle_type,
      colour: renewal.colour,
      renewalPeriodMonths: renewal.renewal_period_months,
      periodStart: renewal.period_start,
      expiryDate: renewal.expiry_date,
      issuedAt,
      transactionReference: renewal.transaction_reference ?? '',
      verificationCode,
    });

    const document = await registerDocument(client, {
      documentType: 'VEHICLE_RENEWAL',
      ownerType: 'VEHICLE',
      ownerId: renewal.vehicle_id,
      entityType: 'vehicle_renewal',
      entityId: renewal.id,
      bytes: pdf,
      verificationCode,
      numberPrefix: 'PSIRS-VEH',
      expiresAt: renewal.expiry_date,
    });

    await client.query(
      `UPDATE vehicle_renewals
          SET document_id = $2, document_number = $3, status = 'COMPLETED'
        WHERE id = $1`,
      [renewal.id, document.documentId, document.documentNumber],
    );

    await client.query('UPDATE vehicles SET current_expiry_date = $2 WHERE id = $1', [
      renewal.vehicle_id,
      renewal.expiry_date,
    ]);

    // Tell the authoritative registry the renewal happened — the platform
    // records the service, the authority remains the source of truth (§82).
    //
    // The taxpayer has paid and is entitled to the document either way, so a
    // failure here does not fail the renewal. It is written down instead:
    // an unacknowledged renewal is a fact the government has to chase, and
    // `retryAuthorityNotifications` below is how it gets chased.
    const notification = await vehicleRegistry.recordRenewal({
      registrationNumber: renewal.registration_number,
      expiryDate: renewal.expiry_date.toISOString().slice(0, 10),
      documentNumber: document.documentNumber,
    });

    await client.query(
      `UPDATE vehicle_renewals
          SET authority_notification_status = $2,
              authority_notification_reference = $3,
              authority_notification_reason = $4,
              authority_notification_attempts = authority_notification_attempts + 1,
              authority_notified_at = CASE WHEN $2 = 'ACCEPTED' THEN now() ELSE NULL END
        WHERE id = $1`,
      [
        renewal.id,
        notification.accepted ? 'ACCEPTED' : 'FAILED',
        notification.reference || null,
        notification.reason ?? null,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'vehicle.renewal_completed',
      entityType: 'vehicle_renewal',
      entityId: renewal.id,
      newValue: {
        documentNumber: document.documentNumber,
        expiryDate: renewal.expiry_date.toISOString().slice(0, 10),
        registrationNumber: renewal.registration_number,
        authorityNotified: notification.accepted,
        authorityNotificationReason: notification.reason ?? null,
      },
    });

    if (renewal.taxpayer_id) {
      await queueNotification(client, {
        event: 'VEHICLE_RENEWAL_COMPLETED',
        taxpayerId: renewal.taxpayer_id,
        variables: {
          registration: renewal.registration_number,
          expiry: renewal.expiry_date.toISOString().slice(0, 10),
        },
        entityType: 'vehicle_renewal',
        entityId: renewal.id,
      });
    }

    return {
      documentId: document.documentId,
      documentNumber: document.documentNumber,
      verificationCode: document.verificationCode,
      expiryDate: renewal.expiry_date,
    };
  });
}

/** Renewals awaiting document issue once their payment lands. */
export async function pendingRenewals(db: Db, limit = 100) {
  return query<{ id: string }>(
    db,
    `SELECT r.id FROM vehicle_renewals r JOIN transactions t ON t.id = r.transaction_id
      WHERE r.document_id IS NULL
        AND t.status IN ('PAYMENT_VERIFIED','RECEIPT_GENERATED','RECONCILIATION_PENDING','SETTLED')
      LIMIT $1`,
    [limit],
  );
}

export async function listVehicles(db: Db, params: { taxpayerId?: string; q?: string; limit?: number }) {
  return query(
    db,
    `SELECT v.id, v.registration_number, v.make, v.model, v.vehicle_type, v.owner_name,
            v.current_expiry_date, v.source, v.authority_verified_at, v.status,
            tp.first_name, tp.last_name, tp.business_name
       FROM vehicles v LEFT JOIN taxpayers tp ON tp.id = v.taxpayer_id
      WHERE ($1::uuid IS NULL OR v.taxpayer_id = $1)
        AND ($2::text IS NULL OR v.registration_number ILIKE '%' || upper($2) || '%')
      ORDER BY v.created_at DESC LIMIT $3`,
    [params.taxpayerId ?? null, params.q ?? null, params.limit ?? 50],
  );
}

// ---------------------------------------------------------------------------
// Catching up with the authority after an outage
// ---------------------------------------------------------------------------
//
// Both of the functions below exist because the registry adapter can now say
// "I could not reach the authority" instead of guessing. That honesty is only
// worth having if something acts on it later, so these are the something.

/**
 * Re-send renewals the vehicle authority has not acknowledged (PRD §82).
 *
 * Safe to run repeatedly: a renewal that has already been ACCEPTED is not
 * selected, and the authority is expected to treat a repeated notification for
 * the same document number as the same renewal.
 */
export async function retryAuthorityNotifications(params: {
  /** Null when a scheduled sweep runs it rather than a person. */
  actorId: string | null;
  actorRole: string;
  limit?: number;
}): Promise<{ attempted: number; accepted: number; stillFailing: number }> {
  const outstanding = await query<{
    id: string;
    registration_number: string;
    expiry_date: Date;
    document_number: string;
  }>(
    pool,
    `SELECT r.id, v.registration_number, r.expiry_date, r.document_number
       FROM vehicle_renewals r JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.authority_notification_status <> 'ACCEPTED'
        AND r.status = 'COMPLETED'
        AND r.document_number IS NOT NULL
      ORDER BY r.created_at
      LIMIT $1`,
    [params.limit ?? 100],
  );

  let accepted = 0;

  for (const renewal of outstanding) {
    const notification = await vehicleRegistry.recordRenewal({
      registrationNumber: renewal.registration_number,
      expiryDate: renewal.expiry_date.toISOString().slice(0, 10),
      documentNumber: renewal.document_number,
    });
    if (notification.accepted) accepted += 1;

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE vehicle_renewals
            SET authority_notification_status = $2,
                authority_notification_reference = COALESCE($3, authority_notification_reference),
                authority_notification_reason = $4,
                authority_notification_attempts = authority_notification_attempts + 1,
                authority_notified_at = CASE WHEN $2 = 'ACCEPTED' THEN now() ELSE NULL END
          WHERE id = $1`,
        [
          renewal.id,
          notification.accepted ? 'ACCEPTED' : 'FAILED',
          notification.reference || null,
          notification.reason ?? null,
        ],
      );

      await recordAudit(client, {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: 'vehicle.authority_notification_retried',
        entityType: 'vehicle_renewal',
        entityId: renewal.id,
        newValue: {
          registrationNumber: renewal.registration_number,
          documentNumber: renewal.document_number,
          accepted: notification.accepted,
          reason: notification.reason ?? null,
        },
      });
    });
  }

  return {
    attempted: outstanding.length,
    accepted,
    stillFailing: outstanding.length - accepted,
  };
}

/** Completed renewals the vehicle authority has not acknowledged. */
export async function outstandingAuthorityNotifications(db: Db, limit = 100) {
  return query(
    db,
    `SELECT r.id, v.registration_number, r.document_number, r.expiry_date,
            r.authority_notification_status, r.authority_notification_reason,
            r.authority_notification_attempts, r.created_at
       FROM vehicle_renewals r JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.authority_notification_status <> 'ACCEPTED'
        AND r.status = 'COMPLETED'
      ORDER BY r.created_at
      LIMIT $1`,
    [limit],
  );
}

/**
 * Vehicles captured while the authority was unreachable.
 *
 * These are the records that were never actually checked. They are not the same
 * as vehicles the authority confirmed it holds no record of, and this is the
 * list that exists so nobody has to remember the difference.
 */
export async function vehiclesAwaitingAuthority(db: Db, limit = 100) {
  return query(
    db,
    `SELECT v.id, v.registration_number, v.owner_name, v.make, v.model,
            v.created_at, v.source
       FROM vehicles v
      WHERE v.authority_lookup_outcome = 'UNAVAILABLE'
      ORDER BY v.created_at
      LIMIT $1`,
    [limit],
  );
}

export { parseKobo };

/**
 * Take a vehicle out of service, or put it back (PRD §21).
 *
 * A vehicle record outlives the vehicle. It is sold and re-registered to
 * somebody else, it is written off in an accident, it is scrapped; or the
 * plate turns up on two chassis and PSIRS needs it frozen while that is
 * looked into. `vehicles.status` named all three situations — ACTIVE,
 * SUSPENDED, ARCHIVED — from the first migration, and nothing could move a
 * vehicle out of ACTIVE, so every vehicle ever captured was renewable for
 * ever. The owner of a car that no longer exists could still be sold
 * particulars for it.
 *
 * SUSPENDED is a hold: the vehicle is real and somebody will decide. ARCHIVED
 * is the end of this record. Neither touches the renewals already issued —
 * papers valid until next March stay valid until next March, because the
 * money for them was taken for a period, not for a record.
 *
 * Archiving is reversible here rather than terminal, unlike retiring a revenue
 * item, and the asymmetry is deliberate: a levy brought back is a new law with
 * a new rate, but a car wrongly written off is the same car.
 */
export async function setVehicleStatus(params: {
  vehicleId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<{ registrationNumber: string; from: string; to: string }> {
  return withTransaction(async (client) => {
    const vehicle = await queryOne<{ registration_number: string; status: string }>(
      client,
      'SELECT registration_number, status FROM vehicles WHERE id = $1 FOR UPDATE',
      [params.vehicleId],
    );
    if (!vehicle) throw notFound('That vehicle');

    if (vehicle.status === params.status) {
      throw conflict(
        'VEHICLE_STATUS_UNCHANGED',
        `${vehicle.registration_number} is already ${params.status.toLowerCase()}.`,
      );
    }

    await client.query(
      `UPDATE vehicles
          SET status = $2, status_reason = $3, status_changed_at = now(),
              status_changed_by = $4, updated_at = now()
        WHERE id = $1`,
      [params.vehicleId, params.status, params.reason, params.actorId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.status === 'ACTIVE' ? 'vehicle.returned_to_service' : 'vehicle.taken_out_of_service',
      entityType: 'vehicle',
      entityId: params.vehicleId,
      oldValue: { status: vehicle.status },
      newValue: { status: params.status, reason: params.reason },
    });

    return {
      registrationNumber: vehicle.registration_number,
      from: vehicle.status,
      to: params.status,
    };
  });
}
