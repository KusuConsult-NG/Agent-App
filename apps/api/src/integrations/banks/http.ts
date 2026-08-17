/**
 * HTTP bank account verification adapter (Addendum §16).
 *
 * Account name enquiry in Nigeria goes through NIBSS, reached in practice via
 * whichever licensed provider the institution contracts — including the payment
 * gateways. Since PSIRS already collects through Remita, the natural
 * configuration is Remita's own name-enquiry endpoint, but the adapter names no
 * vendor: it resolves an account and returns the name the bank holds.
 *
 *   GET {BANK_VERIFICATION_URL}{BANK_RESOLVE_PATH}
 *
 * with `{accountNumber}` and `{bankCode}` substituted, so both a path-style and
 * a query-style endpoint are configuration:
 *
 *   /resolve?account_number={accountNumber}&bank_code={bankCode}
 *   /banks/{bankCode}/accounts/{accountNumber}
 *
 * The adapter does not decide whether the resolved name is the agent's — that
 * is `matchesAccountName`, so the rule governing where commission is paid lives
 * in one tested place rather than once per vendor.
 */

import { config } from '../../config';
import {
  bankUnavailable,
  matchesAccountName,
  type BankVerificationRequest,
  type BankVerificationResult,
  type BankVerificationService,
} from './types';

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

export interface HttpBankVerificationOptions {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  resolvePath?: string;
  accountNamePath?: string;
  referencePath?: string;
  statusPath?: string;
  notFoundValues?: string[];
}

export class HttpBankVerification implements BankVerificationService {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly resolvePath: string;
  private readonly accountNamePath: string;
  private readonly referencePath: string;
  private readonly statusPath: string;
  private readonly notFoundValues: Set<string>;

  constructor(options?: HttpBankVerificationOptions) {
    const settings = config.integrations.bankHttp;
    this.name = options?.name ?? config.integrations.bankVerification;
    this.baseUrl = (options?.baseUrl ?? settings.url).replace(/\/+$/, '');
    this.apiKey = options?.apiKey ?? settings.apiKey;
    this.timeoutMs = options?.timeoutMs ?? settings.timeoutMs;
    this.resolvePath = options?.resolvePath ?? settings.resolvePath;
    this.accountNamePath = options?.accountNamePath ?? settings.accountNamePath;
    this.referencePath = options?.referencePath ?? settings.referencePath;
    this.statusPath = options?.statusPath ?? settings.statusPath;
    this.notFoundValues = new Set(
      (options?.notFoundValues ?? settings.notFoundValues).map((value) => value.toLowerCase()),
    );
  }

  async verify(request: BankVerificationRequest): Promise<BankVerificationResult> {
    if (!this.baseUrl) {
      return bankUnavailable(this.name, 'No bank verification URL is configured');
    }

    const url =
      this.baseUrl +
      this.resolvePath
        .replace('{accountNumber}', encodeURIComponent(request.accountNumber.trim()))
        .replace('{bankCode}', encodeURIComponent(request.bankCode.trim()));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let body: unknown;
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });

      // The bank looked and holds no such account — an answer, and one the
      // agent can act on by correcting the number.
      if (response.status === 404) {
        return {
          outcome: 'NOT_FOUND',
          reference: '',
          failureReason: 'The bank holds no account with that number.',
          provider: this.name,
        };
      }

      const raw = await response.text();
      if (!response.ok) {
        return bankUnavailable(this.name, `Bank verification service responded ${response.status}`);
      }
      body = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return bankUnavailable(
        this.name,
        error instanceof Error && error.name === 'AbortError'
          ? 'Bank verification service did not respond in time'
          : 'Bank verification service could not be reached',
      );
    } finally {
      clearTimeout(timer);
    }

    const status = (text(body, this.statusPath) ?? '').toLowerCase();
    if (this.notFoundValues.has(status)) {
      return {
        outcome: 'NOT_FOUND',
        reference: text(body, this.referencePath) ?? '',
        failureReason: 'The bank holds no account with that number.',
        provider: this.name,
      };
    }

    const accountName = text(body, this.accountNamePath);
    if (!accountName) {
      // Without a name there is nothing to compare, and an unverified account
      // must never pass as verified.
      return bankUnavailable(
        this.name,
        'Bank verification service returned no account name',
      );
    }

    const reference = text(body, this.referencePath) ?? '';

    if (!matchesAccountName(request.expectedName, accountName)) {
      return {
        outcome: 'MISMATCH',
        accountName,
        reference,
        failureReason:
          `The account is held by "${accountName}", which does not match the name on this ` +
          'application. Commission can only be paid to an account in the agent\'s own name.',
        provider: this.name,
      };
    }

    return { outcome: 'VERIFIED', accountName, reference, provider: this.name };
  }
}
