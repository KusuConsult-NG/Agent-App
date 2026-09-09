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
import { installEnumObservers } from './enum-observation';
import { TRANSACTIONAL_TABLES } from './transactional-tables';
import { hashPassword } from '../lib/crypto';
import { recordSettlement } from '../services/reconciliation';
import { gateway } from '../integrations/gateway';
import { NOTIFICATION_TEMPLATES, seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let server: Server | null = null;
let baseUrl = '';


export async function startTestServer(): Promise<string> {
  if (server) return baseUrl;

  await runMigrations({ silent: true });
  // Watch what the suite writes to every enum column. Test-only, in its own
  // schema, and installed once per shard database.
  await installEnumObservers();
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
 * Every integration file calls this, and the files within one shard share a
 * database — so each shard runs with `--test-concurrency=1`. Node's runner
 * parallelises files by default, and two suites resetting the same database
 * mid-run destroy each other's fixtures. `scripts/run-tests.mjs` gets the
 * parallelism back by giving each shard a database of its own rather than by
 * relaxing this rule.
 *
 * ONLY THE TABLES THAT HOLD ANYTHING.
 *
 * TRUNCATE takes an ACCESS EXCLUSIVE lock and rewrites the relation whether or
 * not there is a row in it, so emptying all forty-nine of these cost about
 * 140ms even when every one was already empty — measured, not assumed. Asking
 * which of them hold a row costs 3ms in a single round trip, and most tests
 * touch a handful. The `EXISTS` probe is built once from the same list, so the
 * two cannot drift apart.
 *
 * What gets truncated is unchanged: a table with rows is emptied exactly as
 * before, and a table without rows is already in the state TRUNCATE would put
 * it in. The only thing not preserved is the identity-sequence restart on an
 * untouched table, which nothing depends on — sequences here feed reference
 * numbers that are asserted by shape, never by value.
 */
const NON_EMPTY_PROBE = TRANSACTIONAL_TABLES.map(
  (table) => `SELECT '${table}' AS t WHERE EXISTS (SELECT 1 FROM ${table})`,
).join(' UNION ALL ');

/**
 * Reference rows a test is allowed to change, restored to what the seed says.
 *
 * `notification_templates` is standing reference data: it is not truncated
 * between tests, and the seed inserts with `ON CONFLICT DO NOTHING`, so a row
 * whose status a test changed keeps that status for every later file in the
 * shard — and, because the shard databases outlive a run, for every later run
 * as well. One test with an unscoped `UPDATE ... SET status = 'ACTIVE'`
 * therefore poisons a database permanently, and the only recovery is to drop
 * it. That has happened here once already; the scoped WHERE that fixed the
 * offending test does nothing for the databases it had already spoiled.
 *
 * Restoring the statuses each reset makes the suite self-healing against the
 * whole class rather than against the one instance of it. It lives in the test
 * harness deliberately: the seed's `DO NOTHING` is correct for a real
 * deployment, where an operator who switches a template off means it.
 */
async function restoreSeededTemplateStatuses(): Promise<void> {
  const inactive = NOTIFICATION_TEMPLATES.filter(
    (template) => 'status' in template && template.status === 'INACTIVE',
  ).map((template) => template.code);

  await pool.query(
    `UPDATE notification_templates
        SET status = CASE WHEN code = ANY($1::text[]) THEN 'INACTIVE' ELSE 'ACTIVE' END
      WHERE status IS DISTINCT FROM
            CASE WHEN code = ANY($1::text[]) THEN 'INACTIVE' ELSE 'ACTIVE' END`,
    [inactive],
  );
}

export async function resetDatabase(): Promise<void> {
  const { rows } = await pool.query<{ t: string }>(NON_EMPTY_PROBE);
  if (rows.length > 0) {
    await pool.query(
      `TRUNCATE ${rows.map((row) => row.t).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  await pool.query(`DELETE FROM users WHERE phone LIKE '+234%'`);
  await restoreSeededTemplateStatuses();

  /*
   * Roles a test invented.
   *
   * `roles` cannot be truncated — `users.role` references it and the six the
   * platform ships with have to survive — but an administrator can now create
   * one, so a test that does leaves it behind for every file that runs
   * afterwards in the same shard database. That is the `app_versions` failure
   * again in a new place, and it is worth removing here rather than asking
   * every future test to remember.
   *
   * Only non-system roles, and only after the fixture users above are gone, so
   * nothing still holds them.
   */
  await pool.query(`DELETE FROM roles WHERE NOT is_system`);
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

/**
 * The same, for a response whose body is bytes.
 *
 * `api` reads every response as text, which is right for JSON and CSV and
 * silently corrupts a PDF or a workbook: the deflate streams inside one are
 * not valid UTF-8, and decoding them replaces whole bytes before any assertion
 * gets to look at them.
 */
export async function getBinary(
  path: string,
  options: RequestOptions = {},
): Promise<{ status: number; body: Buffer; headers: Headers }> {
  const headers: Record<string, string> = {
    'x-app-version': options.appVersion ?? '1.0.0',
    ...options.headers,
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.deviceId) headers['x-device-id'] = options.deviceId;

  const response = await fetch(`${baseUrl}${path}`, { method: 'GET', headers });
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
}
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

/**
 * Put the money in the government account, so a receipt can exist.
 *
 * A government receipt asserts that the State received the money, and the
 * database refuses one for a payment with no settlement. Every fixture that
 * needs a receipt therefore has to do what a finance officer does — record the
 * bank credit covering the collection — and this does it through the same
 * service the officer's screen calls rather than by writing rows.
 *
 * That now takes two steps rather than one, because `recordSettlement` will no
 * longer take an officer's word for it: the gateway's statement has to confirm
 * each reference first. So this imports the statement line the real gateway
 * would have produced, then records the credit against it — the same order
 * production runs in, where `runReconciliation` writes those lines from
 * `fetchStatement` before any officer sees the batch.
 *
 * A fixture that wants the *un*corroborated case — money the gateway will not
 * confirm — should skip this helper and call `recordSettlement` directly, which
 * is what the settlement tests do.
 */
let settlementOfficerId: string | null = null;
let settlementSeq = 0;

/**
 * The gateway's own account of what it paid out, as `runReconciliation` would
 * have imported it from `fetchStatement`.
 *
 * `recordSettlement` refuses a reference the statement does not confirm, so any
 * fixture that settles has to do this first — which is the order production
 * runs in. Each line carries the amount the platform recorded for that
 * reference, so settling the true figure is corroborated while settling a
 * different one still reaches the variance path and raises a dispute.
 *
 * A test that wants the refusal itself — money no statement confirms — simply
 * does not call this.
 */
export async function importStatementFor(
  gatewayReferences: string[],
  importedBy: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO gateway_statement_lines
       (gateway, gateway_reference, amount_kobo, status, paid_at, settlement_reference, raw_line, imported_by)
     SELECT $2, p.gateway_reference, p.amount_kobo, 'SUCCESS', now(), NULL, '{}'::jsonb, $3
       FROM payments p
      WHERE p.gateway_reference = ANY($1::text[])
     ON CONFLICT (gateway, gateway_reference) DO NOTHING`,
    [gatewayReferences, gateway.name, importedBy],
  );
}

export async function settleCollection(params: {
  gatewayReferences: string[];
  amountKobo: bigint;
  actorId?: string;
}): Promise<{ settlementReference: string; transactionsSettled: number }> {
  let actorId = params.actorId;
  if (!actorId) {
    const existing = settlementOfficerId
      ? await queryOne<{ id: string }>(pool, `SELECT id FROM users WHERE id = $1`, [settlementOfficerId])
      : null;
    if (!existing) {
      settlementSeq += 1;
      settlementOfficerId = await createGovernmentUser({
        fullName: 'Settlement Officer',
        phone: `+2348099${String(100000 + settlementSeq).slice(-6)}`,
        role: 'finance_officer',
      });
    }
    actorId = settlementOfficerId!;
  }

  settlementSeq += 1;

  await importStatementFor(params.gatewayReferences, actorId);

  const result = await recordSettlement({
    settlementDate: new Date(),
    gatewayReferences: params.gatewayReferences,
    receivedAmountKobo: params.amountKobo,
    bankReference: `TEST-CREDIT-${settlementSeq}`,
    governmentAccountId: null,
    actorId,
    actorRole: 'finance_officer',
  });
  return {
    settlementReference: result.settlementReference,
    transactionsSettled: result.transactionsSettled,
  };
}

/** What the gateway confirmed for a transaction, so a fixture can settle it. */
export async function confirmedCollection(transactionId: string): Promise<{
  gatewayReference: string;
  amountKobo: bigint;
}> {
  const row = await queryOne<{ gateway_reference: string; amount_kobo: string }>(
    pool,
    `SELECT gateway_reference, amount_kobo FROM payments
      WHERE transaction_id = $1 AND status = 'VERIFIED'
      ORDER BY verified_at DESC LIMIT 1`,
    [transactionId],
  );
  if (!row) throw new Error(`No verified payment for transaction ${transactionId}`);
  return { gatewayReference: row.gateway_reference, amountKobo: BigInt(row.amount_kobo) };
}

/**
 * Confirm-then-settle in one call: the shape most fixtures actually want.
 *
 * A test that was written when a receipt appeared at gateway confirmation now
 * needs one more step, and this is that step. It is deliberately a call the
 * test makes rather than something the platform does on its own — the whole
 * point of the change is that settlement is a separate event.
 */
/**
 * One collection, driven all the way through: taxpayer, assessment, payment,
 * settlement.
 *
 * Two test files were building this by hand, and a third would have made three
 * copies of a sequence that has to stay in step with the pipeline it exercises.
 * The demonstration agent needs an administrator to have approved it, so the
 * caller has to have created one before this is called.
 *
 * Returns the transaction id, which is all any caller has wanted from it.
 */
export async function seedOneCollection(label: string): Promise<string> {
  const demo = await seedDemoAgent();
  if (!demo) {
    throw new Error(
      'the demonstration agent could not be seeded — reference data and an admin user come first',
    );
  }
  const session = await loginAs(demo.phone, demo.password, demo.deviceIdentifier);
  const agentAuth = { token: session.accessToken, deviceId: demo.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Seeded',
      lastName: `Subject${label}`,
      phone: `+2348159${label.padStart(6, '0')}`,
      address: '11 Ledger Street, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `seed-tp-${label}` },
  );
  if (taxpayer.status !== 201) {
    throw new Error(`could not register a taxpayer: ${JSON.stringify(taxpayer.body)}`);
  }

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `seed-as-${label}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `seed-pay-${label}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );
  await settleTransaction(assessment.body.transactionId);
  return assessment.body.transactionId as string;
}

export async function settleTransaction(transactionId: string): Promise<void> {
  const collection = await confirmedCollection(transactionId);
  await settleCollection({
    gatewayReferences: [collection.gatewayReference],
    amountKobo: collection.amountKobo,
  });
}
