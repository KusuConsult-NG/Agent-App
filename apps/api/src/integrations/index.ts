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

// ---------------------------------------------------------------------------
// Whether the outside world answered
// ---------------------------------------------------------------------------

import { tinService as rawTinService } from './tin';
import { kycProvider as rawKycProvider } from './kyc';
import { vehicleRegistry as rawVehicleRegistry } from './vehicles';
import { bankVerification as rawBankVerification } from './banks';
import { recordCall, type IntegrationName } from '../services/integration-health';

/**
 * Every outbound call, recorded, at the one place they are all handed out.
 *
 * The alternative was a line in each of the eight adapter methods, which is
 * eight places to forget and eight places for a future adapter to not know
 * about. Wrapping here means a service that calls `tinService.lookup` is
 * measured whether or not whoever wrote it had heard of this file, which is
 * the only version of monitoring that stays true.
 *
 * WHY A PROXY RATHER THAN FOUR TYPED WRAPPERS
 *
 * The four contracts have eight methods between them and no common shape, so
 * typed wrappers would be forty lines of forwarding that say nothing. What
 * they *do* share is the design decision this whole directory is built on:
 * every result carries an outcome, and `UNAVAILABLE` means the provider could
 * not be asked rather than that the answer was no. That one field is all this
 * needs, so the proxy reads it and passes everything else through untouched.
 *
 * KYC calls the field `status` where the other three call it `outcome`. That
 * is a wart in the contracts rather than here, and it is read rather than
 * fixed because renaming a field on a shipped provider interface to tidy a
 * monitoring wrapper is the wrong trade.
 */
function watched<T extends object>(name: IntegrationName, adapter: T): T {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;

      return async (...args: unknown[]) => {
        /*
         * A throw is a failure too, and a worse one.
         *
         * Adapters promise never to throw for an upstream problem, and an
         * adapter that breaks that promise is exactly the case worth
         * recording. The error is re-thrown untouched: swallowing it here
         * would turn a bug into silence.
         */
        try {
          const result = await (value as (...inner: unknown[]) => Promise<unknown>).apply(
            target,
            args,
          );
          const outcome = (result as { outcome?: string; status?: string } | null)?.outcome
            ?? (result as { status?: string } | null)?.status
            ?? 'ANSWERED';
          const provider = (result as { provider?: string } | null)?.provider ?? null;
          const reason =
            (result as { reason?: string; failureReason?: string } | null)?.reason ??
            (result as { failureReason?: string } | null)?.failureReason ??
            null;
          await recordCall(name, outcome, { provider, error: reason });
          return result;
        } catch (error) {
          await recordCall(name, 'UNAVAILABLE', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      };
    },
  });
}

/*
 * The adapters every service uses. Same names, same contracts, same behaviour
 * -- the wrapper adds a row and changes no answer.
 */
export const tinService = watched('tin', rawTinService);
export const kycProvider = watched('kyc', rawKycProvider);
export const vehicleRegistry = watched('vehicles', rawVehicleRegistry);
export const bankVerification = watched('banks', rawBankVerification);
