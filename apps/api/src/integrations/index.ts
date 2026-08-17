/**
 * Integration adapters (PRD §81, §82).
 *
 * PRD §82 requires the architecture to state, explicitly, which system owns
 * which fact — "The grassroots platform should not silently become an
 * alternative source of truth."
 *
 * Each integration is a contract plus at least one adapter, selected by an
 * environment variable. Development mocks label every response they produce
 * (`provider: 'mock'`) and `config.ts` refuses to start in production while any
 * of them is still selected.
 *
 * The two integrations that speak to a live external service live in their own
 * directories, because each has a contract worth reading on its own:
 *
 *   ./kyc       identity verification — five outcomes, one of which
 *               (UNAVAILABLE) is about the provider rather than the applicant
 *   ./vehicles  the vehicle registration authority — three outcomes, likewise
 *   ./gateways  payment collection (see ../integrations/gateway.ts)
 *
 * TIN assignment and bank account verification remain mocks: both need a
 * signed interface specification from PSIRS and the banks' verification
 * provider respectively, and guessing at one would be worse than being honest
 * that it is not built. The production guard in `config.ts` names both, so a
 * deployment cannot quietly go live on them.
 */

import { randomUUID, createHash } from 'node:crypto';
import { config } from '../config';

export const SOURCE_OF_TRUTH = {
  TIN: 'PSIRS TIN service',
  REVENUE_RATES: 'Government revenue configuration (this platform, under approval workflow)',
  PAYMENT_STATUS: 'Payment gateway, confirmed by reconciliation',
  RECEIPT: 'This platform (government revenue platform)',
  VEHICLE_RECORD: 'Authorised vehicle registration authority',
  IDENTITY: 'Government identity service',
} as const;

// ---------------------------------------------------------------------------
// Identity verification (Addendum §4, §7) and the vehicle registry (PRD §21)
// ---------------------------------------------------------------------------

export {
  kycProvider,
  kycUnavailable,
  HttpKycProvider,
  MockKycProvider,
  type KycOutcome,
  type KycProvider,
  type KycVerificationRequest,
  type KycVerificationResult,
  type LivenessResult,
} from './kyc';

export {
  vehicleRegistry,
  registryUnavailable,
  HttpVehicleRegistry,
  MockVehicleRegistry,
  type RenewalNotification,
  type RenewalNotificationResult,
  type VehicleLookupOutcome,
  type VehicleLookupResult,
  type VehicleRecord,
  type VehicleRegistry,
} from './vehicles';

// ---------------------------------------------------------------------------
// TIN service (PRD §11)
// ---------------------------------------------------------------------------

export interface TinLookupResult {
  found: boolean;
  tin?: string;
  fullName?: string;
  taxpayerType?: 'INDIVIDUAL' | 'BUSINESS';
  provider: string;
}

export interface TinRegistrationRequest {
  taxpayerType: 'INDIVIDUAL' | 'BUSINESS';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  phone: string;
  email?: string | null;
  dateOfBirth?: string | null;
  address: string;
  lgaName: string;
  identityType?: string | null;
  identityNumber?: string | null;
}

export interface TinRegistrationResult {
  status: 'ASSIGNED' | 'PENDING' | 'FAILED';
  tin?: string;
  reference: string;
  message: string;
  provider: string;
}

export interface TinService {
  lookup(tin: string): Promise<TinLookupResult>;
  register(request: TinRegistrationRequest): Promise<TinRegistrationResult>;
}

/**
 * Development stand-in for the authoritative PSIRS TIN service.
 *
 * It derives a deterministic TIN from the applicant's details so repeated
 * registrations of the same person in a demo return the same number, mirroring
 * the real service's de-duplication rather than handing out a fresh TIN each
 * call.
 */
class MockTinService implements TinService {
  async lookup(tin: string): Promise<TinLookupResult> {
    if (!/^\d{8,12}$/.test(tin)) {
      return { found: false, provider: 'mock' };
    }
    return { found: true, tin, fullName: 'Existing Taxpayer', taxpayerType: 'INDIVIDUAL', provider: 'mock' };
  }

  async register(request: TinRegistrationRequest): Promise<TinRegistrationResult> {
    const seed = [
      request.taxpayerType,
      request.businessName ?? `${request.firstName}${request.lastName}`,
      request.phone,
    ]
      .join('|')
      .toLowerCase();
    const digest = createHash('sha256').update(seed).digest('hex');
    const numeric = BigInt(`0x${digest.slice(0, 12)}`) % 900_000_000n;
    const tin = `${(numeric + 100_000_000n).toString()}`;

    return {
      status: 'ASSIGNED',
      tin,
      reference: `MOCK-TIN-${randomUUID().slice(0, 8).toUpperCase()}`,
      message: 'TIN assigned by mock TIN service (development only).',
      provider: 'mock',
    };
  }
}

// ---------------------------------------------------------------------------
// Bank account verification (Addendum §16 — commission accounts only)
// ---------------------------------------------------------------------------

export interface BankVerificationResult {
  verified: boolean;
  accountName?: string;
  reference: string;
  failureReason?: string;
  provider: string;
}

export interface BankVerificationService {
  verify(params: {
    bankCode: string;
    accountNumber: string;
    expectedName: string;
  }): Promise<BankVerificationResult>;
}

class MockBankVerification implements BankVerificationService {
  async verify(params: {
    bankCode: string;
    accountNumber: string;
    expectedName: string;
  }): Promise<BankVerificationResult> {
    if (!/^\d{10}$/.test(params.accountNumber)) {
      return {
        verified: false,
        reference: `MOCK-BNK-${randomUUID().slice(0, 8)}`,
        failureReason: 'Nigerian account numbers are 10 digits.',
        provider: 'mock',
      };
    }
    return {
      verified: true,
      accountName: params.expectedName.toUpperCase(),
      reference: `MOCK-BNK-${randomUUID().slice(0, 8).toUpperCase()}`,
      provider: 'mock',
    };
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export const tinService: TinService = new MockTinService();
export const bankVerification: BankVerificationService = new MockBankVerification();

export function integrationStatus() {
  return {
    tinService: config.integrations.tinService,
    vehicleRegistry: config.integrations.vehicleRegistry,
    kycProvider: config.integrations.kycProvider,
    bankVerification: config.integrations.bankVerification,
    paymentGateway: config.payments.gateway,
    sourceOfTruth: SOURCE_OF_TRUTH,
  };
}
