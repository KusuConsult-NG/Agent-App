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
import { query, queryOne, withTransaction } from '../db/pool';
import { conflict, notFound, badRequest } from '../lib/errors';
import { generateVerificationCode } from '../lib/crypto';
import { vehicleRegistry } from '../integrations';
import { recordAudit } from './audit';
import { registerDocument, renderVehicleDocumentPdf } from './documents';
import { createAssessment } from './revenue';
import { queueNotification } from './notifications';

export interface VehicleLookup {
  source: 'PLATFORM' | 'AUTHORITY' | 'NOT_FOUND';
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
  if (!authority.found) {
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
    vehicle: authority as unknown as Record<string, unknown>,
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

export async function upsertVehicle(params: {
  input: VehicleCaptureInput;
  actorId: string;
  actorRole: string;
}): Promise<{ vehicleId: string; source: string; authorityConfirmed: boolean }> {
  const normalised = params.input.registrationNumber.trim().toUpperCase().replace(/\s+/g, '');

  return withTransaction(async (client) => {
    const authority = await vehicleRegistry.lookup(normalised);

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
                current_expiry_date = COALESCE($6, current_expiry_date)
          WHERE id = $1`,
        [
          existing.id,
          params.input.taxpayerId ?? null,
          params.input.ownerPhone ?? null,
          authority.authorityReference ?? null,
          authority.found,
          authority.currentExpiryDate ?? null,
        ],
      );
      return {
        vehicleId: existing.id,
        source: existing.source,
        authorityConfirmed: authority.found,
      };
    }

    // Registry data wins over agent-typed data wherever both exist.
    const vehicle = await queryOne<{ id: string }>(
      client,
      `INSERT INTO vehicles
         (taxpayer_id, registration_number, chassis_number, engine_number, make, model,
          year_of_manufacture, vehicle_type, vehicle_class, colour, owner_name, owner_phone,
          source, authority_reference, authority_verified_at, current_expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        params.input.taxpayerId ?? null,
        normalised,
        authority.chassisNumber ?? params.input.chassisNumber ?? null,
        authority.engineNumber ?? params.input.engineNumber ?? null,
        authority.make ?? params.input.make ?? null,
        authority.model ?? params.input.model ?? null,
        params.input.yearOfManufacture ?? null,
        authority.vehicleType ?? params.input.vehicleType,
        authority.vehicleClass ?? params.input.vehicleClass ?? null,
        authority.colour ?? params.input.colour ?? null,
        authority.ownerName ?? params.input.ownerName,
        params.input.ownerPhone ?? authority.ownerPhone ?? null,
        authority.found ? 'AUTHORITY_LOOKUP' : 'MANUAL_ENTRY',
        authority.authorityReference ?? null,
        authority.found ? new Date() : null,
        authority.currentExpiryDate ?? null,
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
        source: authority.found ? 'AUTHORITY_LOOKUP' : 'MANUAL_ENTRY',
        authorityConfirmed: authority.found,
      },
    });

    return {
      vehicleId: vehicle!.id,
      source: authority.found ? 'AUTHORITY_LOOKUP' : 'MANUAL_ENTRY',
      authorityConfirmed: authority.found,
    };
  });
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
    }>(
      client,
      `SELECT id, registration_number, vehicle_type, vehicle_class, taxpayer_id,
              owner_name, current_expiry_date
         FROM vehicles WHERE id = $1`,
      [params.vehicleId],
    ),
  );

  if (!vehicle) throw notFound('That vehicle');

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

  const periodStart = new Date();
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
  actorId: string;
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
    await vehicleRegistry.recordRenewal({
      registrationNumber: renewal.registration_number,
      expiryDate: renewal.expiry_date.toISOString().slice(0, 10),
      documentNumber: document.documentNumber,
    });

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

export { parseKobo };
