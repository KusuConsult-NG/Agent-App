/**
 * HTTP vehicle registry adapter (PRD §21, §22, §82).
 *
 * The authoritative vehicle record belongs to the state's vehicle registration
 * authority, reached through whatever interface that authority exposes. Rather
 * than hard-code one vendor's routes and field names, this adapter takes the
 * two paths as templates and reads each field through a list of the names the
 * Nigerian registries in circulation actually use.
 *
 *   LOOKUP    GET  {VEHICLE_REGISTRY_URL}{VEHICLE_REGISTRY_LOOKUP_PATH}
 *   RENEWAL   POST {VEHICLE_REGISTRY_URL}{VEHICLE_REGISTRY_RENEWAL_PATH}
 *
 * `{registration}` in either template is replaced with the URL-encoded
 * registration number, so both a path-parameter registry
 * (`/vehicles/{registration}`) and a query-parameter one
 * (`/search?plate={registration}`) are configuration, not code.
 *
 * WHAT COUNTS AS "NOT REGISTERED"
 *
 * Only two things: HTTP 404, or a body whose status field is in
 * `VEHICLE_REGISTRY_NOT_FOUND_VALUES`. Everything else that is not a readable
 * vehicle record — a 500, a 401 from a bad key, a timeout, a body this adapter
 * cannot parse — is UNAVAILABLE.
 *
 * That includes the case of a 200 whose shape we do not recognise, and the
 * choice is deliberate. Get it wrong in the UNAVAILABLE direction and vehicle
 * capture stops until someone fixes `VEHICLE_REGISTRY_RECORD_PATH` — loud, and
 * fixed the same day. Get it wrong in the NOT_FOUND direction and every vehicle
 * in Plateau State is quietly recorded as unregistered and manually captured,
 * and nobody finds out until the registers are compared. So an unreadable
 * answer is treated as no answer.
 */

import { config } from '../../config';
import {
  registryUnavailable,
  type RenewalNotification,
  type RenewalNotificationResult,
  type VehicleLookupResult,
  type VehicleRecord,
  type VehicleRegistry,
} from './types';

/**
 * Field aliases. The first name present in the record wins, so an authority
 * using any of these needs no shim; one using none of them needs
 * `VEHICLE_REGISTRY_RECORD_PATH` pointed at a nested object, or a thin proxy.
 */
const FIELD_ALIASES: Record<keyof VehicleRecord, string[]> = {
  registrationNumber: ['registrationNumber', 'registration_number', 'regNo', 'plateNumber', 'plate'],
  chassisNumber: ['chassisNumber', 'chassis_number', 'chassis', 'vin'],
  engineNumber: ['engineNumber', 'engine_number', 'engine'],
  make: ['make', 'manufacturer', 'brand'],
  model: ['model'],
  vehicleType: ['vehicleType', 'vehicle_type', 'type', 'usage'],
  vehicleClass: ['vehicleClass', 'vehicle_class', 'class', 'category'],
  colour: ['colour', 'color'],
  ownerName: ['ownerName', 'owner_name', 'owner'],
  ownerPhone: ['ownerPhone', 'owner_phone', 'phone', 'ownerMobile'],
  currentExpiryDate: ['currentExpiryDate', 'expiryDate', 'expiry_date', 'expires_at', 'validTo'],
  authorityReference: ['authorityReference', 'reference', 'recordId', 'id'],
};

function walk(body: unknown, path: string): unknown {
  if (!path) return body;
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      body,
    );
}

function text(record: Record<string, unknown>, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function normalise(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** ISO date, or the leading date part of an ISO timestamp; anything else is dropped. */
function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : undefined;
}

export interface HttpVehicleRegistryOptions {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  lookupPath?: string;
  renewalPath?: string;
  recordPath?: string;
  statusPath?: string;
  notFoundValues?: string[];
}

export class HttpVehicleRegistry implements VehicleRegistry {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly lookupPath: string;
  private readonly renewalPath: string;
  private readonly recordPath: string;
  private readonly statusPath: string;
  private readonly notFoundValues: Set<string>;

  constructor(options?: HttpVehicleRegistryOptions) {
    const settings = config.integrations.vehicleRegistryHttp;
    this.name = options?.name ?? config.integrations.vehicleRegistry;
    this.baseUrl = (options?.baseUrl ?? config.integrations.vehicleRegistryUrl).replace(/\/+$/, '');
    this.apiKey = options?.apiKey ?? settings.apiKey;
    this.timeoutMs = options?.timeoutMs ?? settings.timeoutMs;
    this.lookupPath = options?.lookupPath ?? settings.lookupPath;
    this.renewalPath = options?.renewalPath ?? settings.renewalPath;
    this.recordPath = options?.recordPath ?? settings.recordPath;
    this.statusPath = options?.statusPath ?? settings.statusPath;
    this.notFoundValues = new Set(
      (options?.notFoundValues ?? settings.notFoundValues).map((value) => value.toLowerCase()),
    );
  }

  private url(template: string, registrationNumber: string): string {
    return (
      this.baseUrl + template.replace('{registration}', encodeURIComponent(registrationNumber))
    );
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async lookup(registrationNumber: string): Promise<VehicleLookupResult> {
    if (!this.baseUrl) {
      return registryUnavailable(this.name, 'No vehicle registry URL is configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let body: unknown;
    try {
      const response = await fetch(this.url(this.lookupPath, registrationNumber), {
        method: 'GET',
        signal: controller.signal,
        headers: this.headers(),
      });

      // The one status that is genuinely an answer: the authority looked and
      // holds nothing.
      if (response.status === 404) {
        return { outcome: 'NOT_FOUND', provider: this.name };
      }

      const raw = await response.text();

      if (!response.ok) {
        return registryUnavailable(
          this.name,
          `Vehicle authority responded ${response.status}`,
        );
      }

      body = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return registryUnavailable(
        this.name,
        error instanceof Error && error.name === 'AbortError'
          ? 'Vehicle authority did not respond in time'
          : 'Vehicle authority could not be reached',
      );
    } finally {
      clearTimeout(timer);
    }

    if (this.notFoundValues.has(normalise(walk(body, this.statusPath)))) {
      return { outcome: 'NOT_FOUND', provider: this.name };
    }

    const record = walk(body, this.recordPath);
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      return registryUnavailable(
        this.name,
        'Vehicle authority returned a response this platform could not read',
      );
    }

    const source = record as Record<string, unknown>;
    const registration = text(source, FIELD_ALIASES.registrationNumber);
    if (!registration) {
      // No registration number means no vehicle record — which is not the same
      // as the authority telling us there is no such vehicle.
      return registryUnavailable(
        this.name,
        'Vehicle authority returned a record with no registration number',
      );
    }

    return {
      outcome: 'FOUND',
      provider: this.name,
      vehicle: {
        registrationNumber: registration.toUpperCase().replace(/\s+/g, ''),
        chassisNumber: text(source, FIELD_ALIASES.chassisNumber),
        engineNumber: text(source, FIELD_ALIASES.engineNumber),
        make: text(source, FIELD_ALIASES.make),
        model: text(source, FIELD_ALIASES.model),
        vehicleType: text(source, FIELD_ALIASES.vehicleType),
        vehicleClass: text(source, FIELD_ALIASES.vehicleClass),
        colour: text(source, FIELD_ALIASES.colour),
        ownerName: text(source, FIELD_ALIASES.ownerName),
        ownerPhone: text(source, FIELD_ALIASES.ownerPhone),
        currentExpiryDate: isoDate(text(source, FIELD_ALIASES.currentExpiryDate)),
        authorityReference: text(source, FIELD_ALIASES.authorityReference),
      },
    };
  }

  async recordRenewal(notification: RenewalNotification): Promise<RenewalNotificationResult> {
    if (!this.baseUrl) {
      return {
        accepted: false,
        reference: '',
        reason: 'No vehicle registry URL is configured',
        provider: this.name,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        this.url(this.renewalPath, notification.registrationNumber),
        {
          method: 'POST',
          signal: controller.signal,
          headers: { ...this.headers(), 'content-type': 'application/json' },
          body: JSON.stringify({
            registrationNumber: notification.registrationNumber,
            expiryDate: notification.expiryDate,
            documentNumber: notification.documentNumber,
          }),
        },
      );

      const raw = await response.text();

      if (!response.ok) {
        return {
          accepted: false,
          reference: '',
          reason: `Vehicle authority responded ${response.status}`,
          provider: this.name,
        };
      }

      let reference = '';
      try {
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const candidate = text(parsed, ['reference', 'acknowledgement', 'id', 'receiptNumber']);
        reference = candidate ?? '';
      } catch {
        // The authority accepted it; we simply have no reference to quote.
        reference = '';
      }

      return { accepted: true, reference, provider: this.name };
    } catch (error) {
      return {
        accepted: false,
        reference: '',
        reason:
          error instanceof Error && error.name === 'AbortError'
            ? 'Vehicle authority did not respond in time'
            : 'Vehicle authority could not be reached',
        provider: this.name,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
