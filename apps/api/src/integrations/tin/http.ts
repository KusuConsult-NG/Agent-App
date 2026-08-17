/**
 * HTTP TIN service adapter (PRD §11, §82).
 *
 * The PSIRS TIN service's interface is PSIRS's to specify, and this adapter
 * does not pretend to know it. It speaks one explicit contract and maps the
 * service's vocabulary and field names through configuration, the same way the
 * KYC adapter does — so the integration is a settings change plus, at worst, a
 * thin shim, rather than a rewrite when the specification arrives.
 *
 *   LOOKUP    GET  {TIN_SERVICE_URL}{TIN_LOOKUP_PATH}      ({tin} substituted)
 *   REGISTER  POST {TIN_SERVICE_URL}{TIN_REGISTER_PATH}
 *
 * WHAT THIS ADAPTER WILL NOT DO
 *
 * It will not report a TIN as assigned unless the response carries a usable
 * number. A service that answers "success" with a blank, null or malformed TIN
 * yields PENDING — chaseable — never ASSIGNED, because `taxpayers.tin` is
 * UNIQUE on an undeletable row and a junk value there is permanent.
 *
 * It will not report a lookup as NOT_FOUND on anything except a 404 or an
 * explicitly mapped not-found status. Every other unreadable answer is
 * UNAVAILABLE, because "this taxpayer has no TIN" is the answer that makes an
 * agent register a duplicate.
 */

import { config } from '../../config';
import {
  assignedTin,
  tinRegistrationUnavailable,
  tinUnavailable,
  type TaxpayerKind,
  type TinLookupResult,
  type TinRegistrationRequest,
  type TinRegistrationResult,
  type TinService,
} from './types';

function normalise(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

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

function text(body: unknown, path: string): string | undefined {
  const value = walk(body, path);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function taxpayerKind(value: unknown): TaxpayerKind | undefined {
  const kind = normalise(value);
  if (['individual', 'person', 'personal'].includes(kind)) return 'INDIVIDUAL';
  if (['business', 'company', 'corporate', 'organisation', 'organization'].includes(kind)) {
    return 'BUSINESS';
  }
  return undefined;
}

export interface HttpTinServiceOptions {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  lookupPath?: string;
  registerPath?: string;
  tinPath?: string;
  namePath?: string;
  typePath?: string;
  statusPath?: string;
  referencePath?: string;
  messagePath?: string;
  notFoundValues?: string[];
  assignedValues?: string[];
  pendingValues?: string[];
  rejectedValues?: string[];
  tinPattern?: string;
}

export class HttpTinService implements TinService {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly lookupPath: string;
  private readonly registerPath: string;
  private readonly tinPath: string;
  private readonly namePath: string;
  private readonly typePath: string;
  private readonly statusPath: string;
  private readonly referencePath: string;
  private readonly messagePath: string;
  private readonly notFoundValues: Set<string>;
  private readonly assignedValues: Set<string>;
  private readonly pendingValues: Set<string>;
  private readonly rejectedValues: Set<string>;
  private readonly tinPattern?: RegExp;

  constructor(options?: HttpTinServiceOptions) {
    const settings = config.integrations.tinHttp;
    this.name = options?.name ?? config.integrations.tinService;
    this.baseUrl = (options?.baseUrl ?? config.integrations.tinServiceUrl).replace(/\/+$/, '');
    this.apiKey = options?.apiKey ?? settings.apiKey;
    this.timeoutMs = options?.timeoutMs ?? settings.timeoutMs;
    this.lookupPath = options?.lookupPath ?? settings.lookupPath;
    this.registerPath = options?.registerPath ?? settings.registerPath;
    this.tinPath = options?.tinPath ?? settings.tinPath;
    this.namePath = options?.namePath ?? settings.namePath;
    this.typePath = options?.typePath ?? settings.typePath;
    this.statusPath = options?.statusPath ?? settings.statusPath;
    this.referencePath = options?.referencePath ?? settings.referencePath;
    this.messagePath = options?.messagePath ?? settings.messagePath;
    this.notFoundValues = new Set((options?.notFoundValues ?? settings.notFoundValues).map(normalise));
    this.assignedValues = new Set((options?.assignedValues ?? settings.assignedValues).map(normalise));
    this.pendingValues = new Set((options?.pendingValues ?? settings.pendingValues).map(normalise));
    this.rejectedValues = new Set((options?.rejectedValues ?? settings.rejectedValues).map(normalise));

    const pattern = options?.tinPattern ?? settings.tinPattern;
    this.tinPattern = pattern ? new RegExp(pattern) : undefined;
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async lookup(tin: string): Promise<TinLookupResult> {
    if (!this.baseUrl) {
      return tinUnavailable(this.name, 'No TIN service URL is configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let body: unknown;
    try {
      const response = await fetch(
        this.baseUrl + this.lookupPath.replace('{tin}', encodeURIComponent(tin.trim())),
        { method: 'GET', signal: controller.signal, headers: this.headers() },
      );

      // The one status that is genuinely an answer.
      if (response.status === 404) {
        return { outcome: 'NOT_FOUND', provider: this.name };
      }

      const raw = await response.text();
      if (!response.ok) {
        return tinUnavailable(this.name, `TIN service responded ${response.status}`);
      }
      body = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return tinUnavailable(
        this.name,
        error instanceof Error && error.name === 'AbortError'
          ? 'TIN service did not respond in time'
          : 'TIN service could not be reached',
      );
    } finally {
      clearTimeout(timer);
    }

    if (this.notFoundValues.has(normalise(walk(body, this.statusPath)))) {
      return { outcome: 'NOT_FOUND', provider: this.name };
    }

    const found = text(body, this.tinPath);
    if (!found) {
      // No number in the response is not the service saying there is no TIN.
      return tinUnavailable(
        this.name,
        'TIN service returned a response this platform could not read',
      );
    }

    return {
      outcome: 'FOUND',
      tin: found,
      fullName: text(body, this.namePath),
      taxpayerType: taxpayerKind(walk(body, this.typePath)),
      provider: this.name,
    };
  }

  async register(request: TinRegistrationRequest): Promise<TinRegistrationResult> {
    if (!this.baseUrl) {
      return tinRegistrationUnavailable(this.name, 'No TIN service URL is configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let body: unknown;
    try {
      const response = await fetch(this.baseUrl + this.registerPath, {
        method: 'POST',
        signal: controller.signal,
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          taxpayerType: request.taxpayerType,
          firstName: request.firstName ?? null,
          lastName: request.lastName ?? null,
          businessName: request.businessName ?? null,
          phone: request.phone,
          email: request.email ?? null,
          dateOfBirth: request.dateOfBirth ?? null,
          address: request.address,
          lga: request.lgaName,
          identityType: request.identityType ?? null,
          identityNumber: request.identityNumber ?? null,
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        return tinRegistrationUnavailable(
          this.name,
          `TIN service responded ${response.status}. No registration was recorded.`,
        );
      }
      body = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return tinRegistrationUnavailable(
        this.name,
        error instanceof Error && error.name === 'AbortError'
          ? 'TIN service did not respond in time'
          : 'TIN service could not be reached',
      );
    } finally {
      clearTimeout(timer);
    }

    const status = normalise(walk(body, this.statusPath));
    const reference = text(body, this.referencePath) ?? '';
    const message = text(body, this.messagePath);
    const tin = assignedTin(walk(body, this.tinPath), this.tinPattern);

    if (this.rejectedValues.has(status)) {
      return {
        outcome: 'REJECTED',
        reference,
        message: message ?? 'The TIN service declined this registration.',
        provider: this.name,
      };
    }

    if (this.assignedValues.has(status)) {
      if (!tin) {
        // "Success" with nothing usable in it. Recording ASSIGNED here would
        // put a taxpayer in the register as having a TIN that does not exist,
        // and the UNIQUE column would then refuse the real one.
        return {
          outcome: 'PENDING',
          reference,
          message:
            'The TIN service reported success but returned no usable TIN. ' +
            'The registration will be chased rather than recorded as complete.',
          provider: this.name,
        };
      }
      return {
        outcome: 'ASSIGNED',
        tin,
        reference,
        message: message ?? 'TIN assigned.',
        provider: this.name,
      };
    }

    if (this.pendingValues.has(status)) {
      return {
        outcome: 'PENDING',
        reference,
        message: message ?? 'Registration accepted; the TIN will follow.',
        provider: this.name,
      };
    }

    // An unmapped status is not a rejection of this applicant, and it is
    // certainly not an assignment. If the service handed back a usable number
    // anyway, take it; otherwise treat the registration as still in flight.
    if (tin) {
      return {
        outcome: 'ASSIGNED',
        tin,
        reference,
        message: message ?? 'TIN assigned.',
        provider: this.name,
      };
    }

    return {
      outcome: 'PENDING',
      reference,
      message:
        message ?? `The TIN service reported "${status || 'no status'}"; the registration will be chased.`,
      provider: this.name,
    };
  }
}
