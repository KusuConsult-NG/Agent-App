/**
 * Test harness.
 *
 * Starts the real Express app against a real PostgreSQL database — no mocked
 * repository layer. The integrity rules this platform depends on live in
 * database triggers and constraints, so a test that stubbed the database would
 * verify nothing that matters.
 */

// Must be first: it configures the environment before config.ts is loaded.
import './env';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { pool, closePool, queryOne } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { hashPassword } from '../lib/crypto';
import { seedReferenceData } from '../db/seed';

let server: Server | null = null;
let baseUrl = '';

/** Tables holding transactional state, cleared between suites. */
const TRANSACTIONAL_TABLES = [
  'document_access_logs',
  'verification_attempts',
  'reconciliation_records',
  'reconciliation_runs',
  'gateway_statement_lines',
  'refunds',
  'commission_payouts',
  'commissions',
  'receipts',
  'payment_webhook_events',
  'payments',
  'transaction_events',
  'transactions',
  'invoices',
  'assessments',
  'vehicle_renewals',
  'vehicles',
  'settlements',
  'fraud_flags',
  'referee_risk_flags',
  'offline_drafts',
  'programme_eligibility',
  'incentive_programmes',
  'taxpayer_compliance',
  'taxpayer_duplicate_checks',
  'taxpayers',
  'documents',
  'notifications',
  'support_tickets',
  'ticket_messages',
  'agent_clearance_events',
  'agent_clearance',
  'agent_training_progress',
  'agent_agreements',
  'agent_devices',
  'referee_invitations',
  'referee_kyc',
  'referees',
  'kyc_documents',
  'agent_kyc',
  'approvals',
  'agents',
  'bank_accounts',
  'sessions',
  'step_up_grants',
  'otp_codes',
  'idempotency_keys',
  'audit_logs',
  'mock_gateway_transactions',
];

export async function startTestServer(): Promise<string> {
  if (server) return baseUrl;

  await runMigrations({ silent: true });
  await resetDatabase();
  await seedReferenceData();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });

  const address = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  return baseUrl;
}

/** The running test server's base URL, for requests the helpers do not cover. */
export function apiBaseUrl(): string {
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  await closePool();
}

/**
 * TRUNCATE rather than DELETE: the append-only triggers block DELETE by design
 * (that is the point of them), and TRUNCATE does not fire row-level triggers.
 * Reference data is preserved and reseeded separately.
 *
 * Every integration file calls this, and they share one database — so the test
 * script runs with `--test-concurrency=1`. Node's runner parallelises files by
 * default, and two suites resetting the same database mid-run destroy each
 * other's fixtures.
 */
export async function resetDatabase(): Promise<void> {
  await pool.query(`TRUNCATE ${TRANSACTIONAL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await pool.query(`DELETE FROM users WHERE phone LIKE '+234%'`);
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export interface RequestOptions {
  token?: string;
  deviceId?: string;
  appVersion?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-app-version': options.appVersion ?? '1.0.0',
    ...options.headers,
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.deviceId) headers['x-device-id'] = options.deviceId;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: response.status, body: parsed as T, headers: response.headers };
}

export const get = <T = any>(path: string, options?: RequestOptions) =>
  api<T>('GET', path, undefined, options);
export const post = <T = any>(path: string, body?: unknown, options?: RequestOptions) =>
  api<T>('POST', path, body, options);
export const put = <T = any>(path: string, body?: unknown, options?: RequestOptions) =>
  api<T>('PUT', path, body, options);

/**
 * Sign in.
 *
 * `deviceId` binds the session to a registered device, which is what makes
 * device revocation end the session rather than merely block the next request.
 */
export async function loginAs(phone: string, password = 'Password123', deviceId?: string) {
  const response = await post('/auth/login', { phone, password }, { deviceId });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${phone}: ${JSON.stringify(response.body)}`);
  }
  return response.body as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; role: string; agentId?: string };
  };
}

/** Create a government user directly, for role-specific test fixtures. */
export async function createGovernmentUser(params: {
  fullName: string;
  phone: string;
  role: string;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (full_name, phone, email, password_hash, role, status)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE')
     ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [
      params.fullName,
      params.phone,
      `${params.phone.replace('+', '')}@psirs.test`,
      await hashPassword('Password123'),
      params.role,
    ],
  );
  return row!.id;
}

/** Obtain a step-up grant for a high-risk action (PRD §35). */
export async function grantStepUp(token: string, phone: string, action: string): Promise<void> {
  const otp = await post('/auth/otp/request', { destination: phone, purpose: 'STEP_UP' }, { token });
  const code = (otp.body as { developmentCode?: string }).developmentCode;
  if (!code) {
    throw new Error(
      `OTP request failed (${otp.status}): ${JSON.stringify(otp.body)}`,
    );
  }
  const result = await post('/auth/step-up', { action, destination: phone, code }, { token });
  if (result.status !== 200) {
    throw new Error(`Step-up failed: ${JSON.stringify(result.body)}`);
  }
}

export async function firstLgaId(): Promise<string> {
  const row = await queryOne<{ id: string }>(pool, `SELECT id FROM lgas ORDER BY name LIMIT 1`);
  return row!.id;
}

export async function territoryForLga(lgaId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(pool, `SELECT id FROM territories WHERE lga_id = $1 LIMIT 1`, [
    lgaId,
  ]);
  return row!.id;
}

export async function revenueItemByCode(code: string): Promise<string> {
  const row = await queryOne<{ id: string }>(pool, `SELECT id FROM revenue_items WHERE code = $1`, [code]);
  if (!row) throw new Error(`Revenue item ${code} not seeded`);
  return row.id;
}

export { pool };
