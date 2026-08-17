/**
 * Integration adapters (PRD §81, §82).
 *
 * PRD §82 requires the architecture to state, explicitly, which system owns
 * which fact — "The grassroots platform should not silently become an
 * alternative source of truth."
 *
 * Every integration is a contract, a configurable HTTP adapter, and a labelled
 * development mock, selected by one environment variable. Mocks mark every
 * response they produce (`provider: 'mock'`) and `config.ts` refuses to start
 * in production while any of them is still selected.
 *
 *   ./tin       TIN assignment and lookup   — PSIRS TIN service
 *   ./kyc       identity verification       — government identity service
 *   ./vehicles  vehicle records             — vehicle registration authority
 *   ./banks     commission account names    — bank name enquiry
 *   ./gateways  payment collection          — see ../integrations/gateway.ts
 *
 * All four share one design decision, and it is the reason each has its own
 * directory rather than an interface inline here: every contract carries an
 * outcome that describes the *provider* rather than the subject.
 *
 *   "we could not ask"  is not  "the answer is no"
 *
 * Collapsing the two is what turns an upstream outage into a permanent, wrong
 * fact in a government register — a rejected applicant, a duplicated TIN, a
 * vehicle recorded as unregistered, an agent's account marked as someone
 * else's. Adapters therefore never throw for an upstream failure; they return
 * the unavailable outcome, and each caller decides what to do with a question
 * that was never answered.
 */

import { config } from '../config';

export const SOURCE_OF_TRUTH = {
  TIN: 'PSIRS TIN service',
  REVENUE_RATES: 'Government revenue configuration (this platform, under approval workflow)',
  PAYMENT_STATUS: 'Payment gateway, confirmed by reconciliation',
  RECEIPT: 'This platform (government revenue platform)',
  VEHICLE_RECORD: 'Authorised vehicle registration authority',
  IDENTITY: 'Government identity service',
  BANK_ACCOUNT_NAME: 'The agent’s bank, through account name enquiry',
} as const;

export {
  tinService,
  tinUnavailable,
  tinRegistrationUnavailable,
  assignedTin,
  HttpTinService,
  MockTinService,
  type TaxpayerKind,
  type TinLookupOutcome,
  type TinLookupResult,
  type TinRegistrationOutcome,
  type TinRegistrationRequest,
  type TinRegistrationResult,
  type TinService,
} from './tin';

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

export {
  bankVerification,
  bankUnavailable,
  matchesAccountName,
  HttpBankVerification,
  MockBankVerification,
  type BankVerificationOutcome,
  type BankVerificationRequest,
  type BankVerificationResult,
  type BankVerificationService,
} from './banks';

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
