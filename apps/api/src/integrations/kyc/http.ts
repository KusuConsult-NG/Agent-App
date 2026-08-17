/**
 * HTTP identity verification provider.
 *
 * PSIRS's KYC vendor is a procurement decision, and the Nigerian market has
 * several (NIMC through a licensed aggregator, or a vendor offering NIN/BVN
 * verification). Rather than guess at one vendor's field names and ship an
 * adapter that needs rewriting the day the contract is signed, this adapter
 * speaks one explicit request/response contract and maps the vendor's status
 * vocabulary onto the platform's through configuration.
 *
 * The integrator therefore either points this at a vendor whose response
 * already fits, or stands up a thin shim — rather than waiting on a code change
 * here.
 *
 * REQUEST (POST to KYC_PROVIDER_URL, `Authorization: Bearer <KYC_PROVIDER_API_KEY>`)
 *
 *   { "identityType": "NIN", "identityNumber": "...", "firstName": "...",
 *     "lastName": "...", "dateOfBirth": "1992-04-11", "phone": "+234...",
 *     "selfieProvided": true }
 *
 * RESPONSE (any JSON object carrying these; field names are configurable)
 *
 *   { "status": "verified", "reference": "abc-123",
 *     "liveness": "passed", "livenessScore": 94, "reason": null }
 *
 * The status mapping is configuration because vendors disagree about
 * vocabulary — "verified", "success", "match", "found" all mean the same thing
 * and none of them is universal.
 *
 * Anything the mapping does not recognise is treated as UNDER_REVIEW, never as
 * cleared: an unmapped vocabulary must put a human in the loop, not admit an
 * agent to collecting government revenue.
 */

import { config } from '../../config';
import {
  kycUnavailable,
  type KycProvider,
  type KycVerificationRequest,
  type KycVerificationResult,
  type LivenessResult,
} from './types';

function normalise(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function pick(body: Record<string, unknown>, path: string): unknown {
  // Supports "data.status" so a vendor that nests its payload needs no shim.
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      body,
    );
}

function mapLiveness(value: unknown, selfieProvided: boolean): LivenessResult {
  const text = normalise(value);
  if (!text) return selfieProvided ? 'MANUAL_REVIEW' : 'NOT_PERFORMED';
  if (['passed', 'pass', 'success', 'true'].includes(text)) return 'PASSED';
  if (['failed', 'fail', 'false'].includes(text)) return 'FAILED';
  return 'MANUAL_REVIEW';
}

export class HttpKycProvider implements KycProvider {
  readonly name: string;

  private readonly url: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly statusPath: string;
  private readonly referencePath: string;
  private readonly livenessPath: string;
  private readonly reasonPath: string;
  private readonly clearedValues: Set<string>;
  private readonly failedValues: Set<string>;
  private readonly moreInfoValues: Set<string>;

  constructor(options?: {
    name?: string;
    url?: string;
    apiKey?: string;
    timeoutMs?: number;
    statusPath?: string;
    referencePath?: string;
    livenessPath?: string;
    reasonPath?: string;
    clearedValues?: string[];
    failedValues?: string[];
    moreInfoValues?: string[];
  }) {
    const settings = config.integrations.kycHttp;
    this.name = options?.name ?? config.integrations.kycProvider;
    this.url = options?.url ?? config.integrations.kycProviderUrl;
    this.apiKey = options?.apiKey ?? settings.apiKey;
    this.timeoutMs = options?.timeoutMs ?? settings.timeoutMs;
    this.statusPath = options?.statusPath ?? settings.statusPath;
    this.referencePath = options?.referencePath ?? settings.referencePath;
    this.livenessPath = options?.livenessPath ?? settings.livenessPath;
    this.reasonPath = options?.reasonPath ?? settings.reasonPath;
    this.clearedValues = new Set((options?.clearedValues ?? settings.clearedValues).map(normalise));
    this.failedValues = new Set((options?.failedValues ?? settings.failedValues).map(normalise));
    this.moreInfoValues = new Set(
      (options?.moreInfoValues ?? settings.moreInfoValues).map(normalise),
    );
  }

  async verify(request: KycVerificationRequest): Promise<KycVerificationResult> {
    if (!this.url) {
      return kycUnavailable(this.name, 'No KYC provider URL is configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let body: Record<string, unknown>;
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          identityType: request.identityType,
          identityNumber: request.identityNumber,
          firstName: request.firstName,
          lastName: request.lastName,
          dateOfBirth: request.dateOfBirth ?? null,
          phone: request.phone,
          selfieProvided: Boolean(request.selfieChecksum),
        }),
      });

      const text = await response.text();

      if (!response.ok) {
        // An upstream error is not a verdict about this applicant.
        return kycUnavailable(
          this.name,
          `Identity provider responded ${response.status}`,
        );
      }

      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch (error) {
      return kycUnavailable(
        this.name,
        error instanceof Error && error.name === 'AbortError'
          ? 'Identity provider did not respond in time'
          : 'Identity provider could not be reached',
      );
    } finally {
      clearTimeout(timer);
    }

    const statusValue = normalise(pick(body, this.statusPath));
    const reference =
      typeof pick(body, this.referencePath) === 'string'
        ? (pick(body, this.referencePath) as string)
        : '';
    const reason =
      typeof pick(body, this.reasonPath) === 'string'
        ? (pick(body, this.reasonPath) as string)
        : undefined;
    const liveness = mapLiveness(pick(body, this.livenessPath), Boolean(request.selfieChecksum));

    let status: KycVerificationResult['status'];
    if (this.clearedValues.has(statusValue)) {
      status = 'CLEARED';
    } else if (this.failedValues.has(statusValue)) {
      status = 'FAILED';
    } else if (this.moreInfoValues.has(statusValue)) {
      status = 'VERIFICATION_REQUIRED';
    } else {
      // Unmapped vocabulary puts a human in the loop rather than admitting
      // someone to revenue collection on a status nobody has read.
      status = 'UNDER_REVIEW';
    }

    // A clearance that depends on a liveness check the provider says failed is
    // not a clearance.
    if (status === 'CLEARED' && liveness === 'FAILED') {
      return {
        status: 'UNDER_REVIEW',
        reference,
        livenessResult: liveness,
        failureReason: 'Identity matched but the liveness check did not pass',
        provider: this.name,
      };
    }

    const scoreValue = pick(body, 'livenessScore');

    return {
      status,
      reference,
      livenessResult: liveness,
      livenessScore: typeof scoreValue === 'number' ? scoreValue : undefined,
      failureReason:
        status === 'CLEARED' ? undefined : (reason ?? `Provider reported "${statusValue}"`),
      provider: this.name,
    };
  }
}
