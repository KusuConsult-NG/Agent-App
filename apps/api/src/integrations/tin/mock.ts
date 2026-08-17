/**
 * Development stand-in for the authoritative PSIRS TIN service.
 *
 * It derives a deterministic TIN from the applicant's details, so repeated
 * registrations of the same person in a demo return the same number — mirroring
 * the real service's de-duplication rather than handing out a fresh TIN each
 * call, which would make the duplicate-control tests meaningless.
 *
 * Outcomes are reachable deterministically, so a demo or test can exercise the
 * paths that are awkward to provoke against a real service:
 *
 *   phone ending 8   UNAVAILABLE  the service could not be reached
 *   phone ending 9   REJECTED     the service declined this applicant
 *   phone ending 7   PENDING      accepted; the number follows
 *   otherwise        ASSIGNED
 *
 * `config.ts` refuses to boot in production while this service is selected.
 */

import { randomUUID, createHash } from 'node:crypto';
import {
  tinRegistrationUnavailable,
  tinUnavailable,
  type TinLookupResult,
  type TinRegistrationRequest,
  type TinRegistrationResult,
  type TinService,
} from './types';

export class MockTinService implements TinService {
  readonly name = 'mock';

  async lookup(tin: string): Promise<TinLookupResult> {
    const trimmed = tin.trim();

    if (trimmed.endsWith('8')) {
      return tinUnavailable('mock', 'TIN service could not be reached (development stub).');
    }

    if (!/^\d{8,12}$/.test(trimmed)) {
      return { outcome: 'NOT_FOUND', provider: 'mock' };
    }

    return {
      outcome: 'FOUND',
      tin: trimmed,
      fullName: 'Existing Taxpayer',
      taxpayerType: 'INDIVIDUAL',
      provider: 'mock',
    };
  }

  async register(request: TinRegistrationRequest): Promise<TinRegistrationResult> {
    const last = request.phone.trim().slice(-1);

    if (last === '8') {
      return tinRegistrationUnavailable(
        'mock',
        'TIN service could not be reached (development stub).',
      );
    }

    if (last === '9') {
      return {
        outcome: 'REJECTED',
        reference: `MOCK-TIN-${randomUUID().slice(0, 8).toUpperCase()}`,
        message: 'The TIN service declined this registration (development stub).',
        provider: 'mock',
      };
    }

    if (last === '7') {
      return {
        outcome: 'PENDING',
        reference: `MOCK-TIN-${randomUUID().slice(0, 8).toUpperCase()}`,
        message: 'Registration accepted; the TIN will follow (development stub).',
        provider: 'mock',
      };
    }

    const seed = [
      request.taxpayerType,
      request.businessName ?? `${request.firstName}${request.lastName}`,
      request.phone,
    ]
      .join('|')
      .toLowerCase();
    const digest = createHash('sha256').update(seed).digest('hex');
    const numeric = BigInt(`0x${digest.slice(0, 12)}`) % 900_000_000n;

    return {
      outcome: 'ASSIGNED',
      tin: (numeric + 100_000_000n).toString(),
      reference: `MOCK-TIN-${randomUUID().slice(0, 8).toUpperCase()}`,
      message: 'TIN assigned by mock TIN service (development only).',
      provider: 'mock',
    };
  }
}
