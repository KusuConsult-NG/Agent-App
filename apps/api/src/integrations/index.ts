/**
 * Integration adapters (PRD §81, §82).
 *
 * PRD §82 requires the architecture to state, explicitly, which system owns
 * which fact — "The grassroots platform should not silently become an
 * alternative source of truth."
 *
 * Each adapter below is an interface plus a development mock. The mock is
 * clearly labelled in every response it produces (`provider: 'mock'`), and
 * config.ts refuses to start in production while any of them is still selected.
 * Replacing a mock with the real PSIRS, VIO or NIMC integration is an
 * implementation of the interface; no calling code changes.
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
// Identity/KYC provider (Addendum §4, §7)
// ---------------------------------------------------------------------------

export interface KycVerificationRequest {
  identityType: string;
  identityNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  phone: string;
  selfieChecksum?: string | null;
}

export interface KycVerificationResult {
  status: 'CLEARED' | 'FAILED' | 'UNDER_REVIEW' | 'VERIFICATION_REQUIRED';
  reference: string;
  livenessResult: 'PASSED' | 'FAILED' | 'MANUAL_REVIEW' | 'NOT_PERFORMED';
  livenessScore?: number;
  failureReason?: string;
  provider: string;
}

export interface KycProvider {
  verify(request: KycVerificationRequest): Promise<KycVerificationResult>;
}

class MockKycProvider implements KycProvider {
  async verify(request: KycVerificationRequest): Promise<KycVerificationResult> {
    // Deterministic outcome so demo and test runs are reproducible: identity
    // numbers ending in 0 are routed to manual review, in 9 to failure.
    const last = request.identityNumber.trim().slice(-1);
    const reference = `MOCK-KYC-${randomUUID().slice(0, 8).toUpperCase()}`;

    if (last === '9') {
      return {
        status: 'FAILED',
        reference,
        livenessResult: 'FAILED',
        failureReason: 'Identity number could not be matched to the national record.',
        provider: 'mock',
      };
    }
    if (last === '0') {
      return {
        status: 'UNDER_REVIEW',
        reference,
        livenessResult: 'MANUAL_REVIEW',
        livenessScore: 62,
        provider: 'mock',
      };
    }
    return {
      status: 'CLEARED',
      reference,
      livenessResult: request.selfieChecksum ? 'PASSED' : 'NOT_PERFORMED',
      livenessScore: request.selfieChecksum ? 94 : undefined,
      provider: 'mock',
    };
  }
}

// ---------------------------------------------------------------------------
// Vehicle registry (PRD §21)
// ---------------------------------------------------------------------------

export interface VehicleLookupResult {
  found: boolean;
  registrationNumber?: string;
  chassisNumber?: string;
  engineNumber?: string;
  make?: string;
  model?: string;
  vehicleType?: string;
  vehicleClass?: string;
  colour?: string;
  ownerName?: string;
  ownerPhone?: string;
  currentExpiryDate?: string;
  authorityReference?: string;
  provider: string;
}

export interface VehicleRegistry {
  lookup(registrationNumber: string): Promise<VehicleLookupResult>;
  recordRenewal(params: {
    registrationNumber: string;
    expiryDate: string;
    documentNumber: string;
  }): Promise<{ accepted: boolean; reference: string; provider: string }>;
}

class MockVehicleRegistry implements VehicleRegistry {
  async lookup(registrationNumber: string): Promise<VehicleLookupResult> {
    const normalised = registrationNumber.trim().toUpperCase().replace(/\s+/g, '');
    // Plateau plate prefixes; anything else is treated as unknown to the
    // registry so the "not found" path is exercised in development.
    if (!/^(JOS|PLT|BKL|MNG|PKN|SHD|LNG|WSE|BSA|BKS|KNM|KNK|RYM|QNP|MKG|JSE|JSS)/.test(normalised)) {
      return { found: false, provider: 'mock' };
    }
    return {
      found: true,
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
      provider: 'mock',
    };
  }

  async recordRenewal(params: {
    registrationNumber: string;
    expiryDate: string;
    documentNumber: string;
  }): Promise<{ accepted: boolean; reference: string; provider: string }> {
    return {
      accepted: true,
      reference: `MOCK-RNW-${params.documentNumber}`,
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
export const kycProvider: KycProvider = new MockKycProvider();
export const vehicleRegistry: VehicleRegistry = new MockVehicleRegistry();
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
