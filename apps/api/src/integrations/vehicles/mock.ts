/**
 * Development vehicle registry.
 *
 * Outcomes are deterministic from the registration number so every branch —
 * including the two that are awkward to provoke against a real authority — can
 * be reached in a demo or a test:
 *
 *   ZZZ…   UNAVAILABLE  the registry could not be reached
 *   JOS…   FOUND        a Plateau plate the registry holds
 *   other  NOT_FOUND    the registry says it holds no such vehicle
 *
 * The `ZZZ` prefix is reserved rather than real: Nigerian plates issued in
 * Plateau State carry one of the town prefixes below, so no live registration
 * can collide with it.
 *
 * `config.ts` refuses to boot in production while this registry is selected.
 */

import { createHash } from 'node:crypto';
import {
  registryUnavailable,
  type RenewalNotification,
  type RenewalNotificationResult,
  type VehicleLookupResult,
  type VehicleRegistry,
} from './types';

/** Plateau State plate prefixes (Jos, Bukuru, Mangu, Pankshin, Shendam …). */
const PLATEAU_PREFIXES =
  /^(JOS|PLT|BKL|MNG|PKN|SHD|LNG|WSE|BSA|BKS|KNM|KNK|RYM|QNP|MKG|JSE|JSS)/;

/** Reserved for exercising the outage path; not a real prefix. */
const UNAVAILABLE_PREFIX = /^ZZZ/;

function normalise(registrationNumber: string): string {
  return registrationNumber.trim().toUpperCase().replace(/\s+/g, '');
}

export class MockVehicleRegistry implements VehicleRegistry {
  readonly name = 'mock';

  async lookup(registrationNumber: string): Promise<VehicleLookupResult> {
    const normalised = normalise(registrationNumber);

    if (UNAVAILABLE_PREFIX.test(normalised)) {
      return registryUnavailable(
        'mock',
        'Vehicle authority could not be reached (development stub).',
      );
    }

    if (!PLATEAU_PREFIXES.test(normalised)) {
      return { outcome: 'NOT_FOUND', provider: 'mock' };
    }

    return {
      outcome: 'FOUND',
      provider: 'mock',
      vehicle: {
        registrationNumber: normalised,
        chassisNumber: `CHS${createHash('sha1').update(normalised).digest('hex').slice(0, 14).toUpperCase()}`,
        engineNumber: `ENG${createHash('sha1').update(`e${normalised}`).digest('hex').slice(0, 12).toUpperCase()}`,
        make: 'Toyota',
        model: 'Hilux',
        vehicleType: 'PRIVATE',
        vehicleClass: 'SALOON',
        colour: 'White',
        ownerName: 'Registered Owner',
        currentExpiryDate: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
        authorityReference: `MOCK-VEH-${normalised}`,
      },
    };
  }

  async recordRenewal(notification: RenewalNotification): Promise<RenewalNotificationResult> {
    if (UNAVAILABLE_PREFIX.test(normalise(notification.registrationNumber))) {
      return {
        accepted: false,
        reference: '',
        reason: 'Vehicle authority could not be reached (development stub).',
        provider: 'mock',
      };
    }

    return {
      accepted: true,
      reference: `MOCK-RNW-${notification.documentNumber}`,
      provider: 'mock',
    };
  }
}
