/**
 * Runtime configuration.
 *
 * Every secret is read from the environment (PRD §54 "Secure secrets
 * management"). In production the process refuses to start if a security-
 * critical secret is missing or left at a development default — a platform that
 * moves government money must not boot with a placeholder signing key.
 */

import { randomBytes } from 'node:crypto';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Configuration error: ${name} is not set. Refusing to start without it.`,
    );
  }
  return value;
}

/**
 * Secrets get a random per-process value outside production so local runs and
 * tests work without setup, while production demands a real, explicitly
 * provisioned value.
 */
function secret(name: string): string {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (isProduction) {
    throw new Error(
      `Configuration error: ${name} must be set to at least 32 characters in production.`,
    );
  }
  return randomBytes(32).toString('hex');
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Configuration error: ${name} must be an integer, received "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProduction,
  isTest,
  port: int('PORT', 4000),

  database: {
    url:
      process.env.DATABASE_URL ??
      (isTest
        ? 'postgres://postgres:postgres@localhost:5432/psirs_test'
        : 'postgres://postgres:postgres@localhost:5432/psirs'),
    poolSize: int('DB_POOL_SIZE', 10),
    statementTimeoutMs: int('DB_STATEMENT_TIMEOUT_MS', 15_000),
  },

  auth: {
    jwtSecret: secret('JWT_SECRET'),
    accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 900), // 15 minutes
    refreshTokenTtlSeconds: int('REFRESH_TOKEN_TTL_SECONDS', 60 * 60 * 24 * 14),
    otpTtlSeconds: int('OTP_TTL_SECONDS', 300),
    otpLength: int('OTP_LENGTH', 6),
    stepUpTtlSeconds: int('STEP_UP_TTL_SECONDS', 600),
    maxFailedLogins: int('MAX_FAILED_LOGINS', 5),
    lockoutMinutes: int('LOCKOUT_MINUTES', 15),
    bcryptRounds: int('BCRYPT_ROUNDS', isTest ? 4 : 12),
  },

  /**
   * Salt for one-way hashing of national identity numbers before storage
   * (PRD §62 data minimisation, Addendum §33). Distinct from the JWT secret so
   * that rotating session signing keys does not invalidate identity matching.
   */
  identityHashSecret: secret('IDENTITY_HASH_SECRET'),

  payments: {
    gateway: process.env.PAYMENT_GATEWAY ?? 'mock',
    webhookSecret: secret('PAYMENT_WEBHOOK_SECRET'),
    publicKey: process.env.PAYMENT_PUBLIC_KEY ?? '',
    secretKey: process.env.PAYMENT_SECRET_KEY ?? '',
    baseUrl: process.env.PAYMENT_BASE_URL ?? '',
    callbackUrl: process.env.PAYMENT_CALLBACK_URL ?? 'http://localhost:5173/payment/return',
    /**
     * Maximum clock skew accepted on a signed webhook (PRD §54 replay
     * protection). A replayed delivery outside this window is rejected even if
     * its signature is valid.
     */
    webhookToleranceSeconds: int('WEBHOOK_TOLERANCE_SECONDS', 300),

    /**
     * Remita — the collection channel for PSIRS revenue.
     *
     * `serviceTypeId` is issued to PSIRS per revenue stream and must come from
     * their own merchant configuration. The status-code lists are configurable
     * because the exact code set varies by merchant setup: only codes listed in
     * `successStatusCodes` can ever mark money as received, and any code in
     * neither list is treated as still pending rather than guessed at.
     */
    remita: {
      baseUrl: process.env.REMITA_BASE_URL ?? 'https://remitademo.net',
      merchantId: process.env.REMITA_MERCHANT_ID ?? '',
      apiKey: process.env.REMITA_API_KEY ?? '',
      serviceTypeId: process.env.REMITA_SERVICE_TYPE_ID ?? '',
      successStatusCodes: (process.env.REMITA_SUCCESS_STATUS_CODES ?? '00')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean),
      // Empty by default: an unmapped code stays PENDING, so a mis-specified
      // list can never wrongly close a transaction the taxpayer did pay.
      failureStatusCodes: (process.env.REMITA_FAILURE_STATUS_CODES ?? '')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean),
      /** Optional shared secret on the notification endpoint. */
      notificationSecret: process.env.REMITA_NOTIFICATION_SECRET ?? '',
      /** Optional source-address allowlist for notifications. */
      notificationIpAllowlist: (process.env.REMITA_NOTIFICATION_IP_ALLOWLIST ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      requestTimeoutMs: int('REMITA_TIMEOUT_MS', 20_000),
    },
  },

  integrations: {
    /**
     * PRD §82 source-of-truth map. Each integration names the authoritative
     * system; `mock` adapters stand in during development so the platform never
     * silently becomes the source of truth for data it does not own.
     */
    tinService: process.env.TIN_SERVICE ?? 'mock',
    tinServiceUrl: process.env.TIN_SERVICE_URL ?? '',
    vehicleRegistry: process.env.VEHICLE_REGISTRY ?? 'mock',
    vehicleRegistryUrl: process.env.VEHICLE_REGISTRY_URL ?? '',
    kycProvider: process.env.KYC_PROVIDER ?? 'mock',
    kycProviderUrl: process.env.KYC_PROVIDER_URL ?? '',
    bankVerification: process.env.BANK_VERIFICATION ?? 'mock',
  },

  notifications: {
    smsProvider: process.env.SMS_PROVIDER ?? 'mock',
    emailProvider: process.env.EMAIL_PROVIDER ?? 'mock',
    fromEmail: process.env.FROM_EMAIL ?? 'no-reply@psirs.pl.gov.ng',
    smsSenderId: process.env.SMS_SENDER_ID ?? 'PSIRS',
  },

  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    localPath: process.env.STORAGE_PATH ?? './storage',
    bucket: process.env.STORAGE_BUCKET ?? '',
    signedUrlTtlSeconds: int('SIGNED_URL_TTL_SECONDS', 900),
  },

  commission: {
    /** PRD §25 default incentive: 1.5% = 150 basis points. */
    defaultBasisPoints: int('DEFAULT_COMMISSION_BASIS_POINTS', 150),
    defaultHoldPeriodHours: int('COMMISSION_HOLD_HOURS', 72),
  },

  security: {
    rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax: int('RATE_LIMIT_MAX', 120),
    authRateLimitMax: int('AUTH_RATE_LIMIT_MAX', 10),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: bool('TRUST_PROXY', false),
  },

  pwa: {
    /** Addendum §43: version floor enforced server-side for financial safety. */
    minimumAgentVersion: process.env.MIN_AGENT_VERSION ?? '1.0.0',
    recommendedAgentVersion: process.env.RECOMMENDED_AGENT_VERSION ?? '1.0.0',
  },

  branding: {
    stateName: 'Plateau State Government',
    agencyName: 'Plateau State Internal Revenue Service',
    agencyShortName: 'PSIRS',
    motto: 'Home of Peace and Tourism',
    verificationBaseUrl: process.env.VERIFICATION_BASE_URL ?? 'http://localhost:5174/verify',
  },
} as const;

export type Config = typeof config;

if (isProduction) {
  // Fail fast rather than run a government payment platform in a half-configured
  // state: a mock gateway in production would accept payments nobody ever made.
  const problems: string[] = [];
  if (config.payments.gateway === 'mock') problems.push('PAYMENT_GATEWAY is still "mock"');
  if (config.integrations.tinService === 'mock') problems.push('TIN_SERVICE is still "mock"');
  if (config.storage.driver === 'local') problems.push('STORAGE_DRIVER is still "local"');

  // A half-configured Remita is worse than none: every status query would fail,
  // every payment would sit unconfirmed, and agents would be told to wait on
  // money that was never going to be confirmable.
  if (config.payments.gateway === 'remita') {
    if (!config.payments.remita.merchantId) problems.push('REMITA_MERCHANT_ID is not set');
    if (!config.payments.remita.apiKey) problems.push('REMITA_API_KEY is not set');
    if (!config.payments.remita.serviceTypeId) problems.push('REMITA_SERVICE_TYPE_ID is not set');
    if (config.payments.remita.baseUrl.includes('remitademo.net')) {
      problems.push('REMITA_BASE_URL still points at the Remita demo environment');
    }
    if (config.payments.remita.successStatusCodes.length === 0) {
      problems.push('REMITA_SUCCESS_STATUS_CODES is empty — no payment could ever be confirmed');
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with development integrations: ${problems.join('; ')}`,
    );
  }
  required('DATABASE_URL');
}
