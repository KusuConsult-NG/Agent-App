/**
 * State for the behavioural browser tests.
 *
 * The demonstration seed creates people and a catalogue but no activity: no
 * taxpayer, no payment, no approval waiting on anybody. That is right for a
 * demonstration — you are meant to do the work yourself — but it leaves the
 * workflow specs with nothing to drive.
 *
 * Rather than insert rows, this walks the real chain through the real API:
 * register a taxpayer, assess, invoice, pay, let the gateway webhook verify
 * it, then raise a reversal request and have a second officer approve it. The
 * fixture therefore cannot drift from what the application actually does, and
 * it cannot manufacture a state the application would refuse to reach — a
 * verified payment written straight into the table would sail past the
 * triggers that exist to say money is only verified by the gateway.
 *
 * It stops one step short of executing the reversal: that final step, with its
 * step-up prompt, is what the browser test performs. The approval is left
 * sitting where a real third officer would find it.
 *
 * Writes the identifiers to the path given as the first argument (default
 * /tmp/psirs-browser-fixtures.json) for the spec to read.
 */

import { writeFileSync } from 'node:fs';
import { pool } from './pool';
import { hashPassword } from '../lib/crypto';

const API = process.env.FIXTURE_API ?? 'http://localhost:4000/api/v1';

const AGENT = { phone: '+2347010000001', password: 'FieldAgent2026', device: 'demo-agent-device-000001' };
const REQUESTER = { phone: '+2348000000002', password: 'Password123' }; // revenue_officer
const APPROVER = { phone: '+2348000000003', password: 'Password123' }; // finance_officer

/**
 * A second finance officer, created here rather than in the demonstration seed.
 *
 * A reversal needs three distinct people and only `finance_officer` holds
 * `payment:reverse:approve`, so with one such officer the final step is
 * unreachable by anybody — the approver would have to execute their own
 * approval, which the platform correctly refuses. The browser test needs both
 * branches: the approver being turned away, and a genuine third officer
 * getting through.
 */
const EXECUTOR = {
  phone: '+2348000000006',
  password: 'Password123',
  fullName: 'Second Finance Officer',
};

interface Options {
  token?: string;
  device?: string;
  idempotencyKey?: string;
}

async function call<T = any>(
  method: string,
  path: string,
  body?: unknown,
  options: Options = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-app-version': '1.0.0',
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.device) headers['x-device-id'] = options.device;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (response.status >= 400) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
  }
  return parsed as T;
}

async function signIn(who: { phone: string; password: string }, device?: string): Promise<string> {
  const session = await call<{ accessToken: string }>(
    'POST',
    '/auth/login',
    { phone: who.phone, password: who.password },
    { device },
  );
  return session.accessToken;
}

/**
 * Create the third officer.
 *
 * By INSERT, because there is no other way. Writing this fixture turned up
 * that the platform has no route for creating a government user at all: `admin`
 * holds `user:manage`, but nothing implements it, and the only code paths that
 * write a `users` row are the seed and an agent's own application. Onboarding
 * a revenue officer today means someone with database credentials doing it by
 * hand. That is recorded as a finding; here it just means the fixture has to
 * do what an operator would have to do.
 */
async function ensureExecutor(): Promise<void> {
  await pool.query(
    `INSERT INTO users (full_name, phone, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'finance_officer', 'ACTIVE')
     ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'`,
    [
      EXECUTOR.fullName,
      EXECUTOR.phone,
      'finance2@psirs.demo',
      await hashPassword(EXECUTOR.password),
    ],
  );
}

async function main(): Promise<void> {
  const outputPath = process.argv[2] ?? '/tmp/psirs-browser-fixtures.json';
  const stamp = Date.now().toString().slice(-6);

  const agentToken = await signIn(AGENT, AGENT.device);
  const agentAuth: Options = { token: agentToken, device: AGENT.device };

  const lgas = await call<{ id: string; name: string }[]>('GET', '/reference/lgas');
  const lgaId = lgas[0]!.id;

  const taxpayer = await call<{ taxpayerId: string; tin: string }>(
    'POST',
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      // Unique per run: the duplicate guard refuses a second record with the
      // same name on the same phone, which is exactly what it is for.
      lastName: `Bulus${stamp}`,
      /*
       * The last digit is load-bearing.
       *
       * The development TIN stub branches on it: 7 means the number will
       * follow later, 8 that the service is unreachable, 9 that it declined.
       * Anything else is assigned immediately. A fixture phone ending in a
       * timestamp digit therefore had no TIN roughly a third of the time, and
       * the citizen-lookup test failed for a reason that had nothing to do
       * with citizen lookup. Ending it in 1 makes the fixture deterministic.
       */
      phone: `+23470550${stamp.slice(-4)}1`,
      address: '3 Murtala Mohammed Way, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `browser-tp-${stamp}` },
  );

  /*
   * A TIN is not guaranteed by registration.
   *
   * The TIN service is external and registration deliberately does not block
   * on it: the taxpayer is real whether or not the number came back, so an
   * outage lands the record in REQUESTED to be chased later rather than
   * refusing to enrol somebody standing in front of an agent. The fixture
   * phone is chosen so the stub assigns; this is the fallback if it does not.
   */
  const revenueToken = await signIn(REQUESTER);
  let tin: string | null = taxpayer.tin;
  if (!tin) {
    // Belt and braces: chase it the way the platform chases it.
    await call('POST', '/taxpayers/tin-retry', { limit: 50 }, { token: revenueToken });
    const refreshed = await call<{ tin: string | null }>(
      'GET',
      `/taxpayers/${taxpayer.taxpayerId}`,
      undefined,
      { token: revenueToken },
    );
    tin = refreshed.tin;
  }
  if (!tin) {
    throw new Error(
      'No TIN was assigned. The stub assigns unless the phone ends in 7, 8 or 9 — check the ' +
        'fixture phone number before looking anywhere else.',
    );
  }
  const assignedTin: string = tin;

  const items = await call<{ id: string; code: string }[]>('GET', '/revenue/items', undefined, {
    token: agentToken,
  });
  const item = items.find((candidate) => candidate.code === 'SHOPS-KIOSKS') ?? items[0]!;

  const assessment = await call<{ transactionId: string; transactionReference: string }>(
    'POST',
    '/revenue/assessments',
    { taxpayerId: taxpayer.taxpayerId, revenueItemId: item.id, inputs: {} },
    { ...agentAuth, idempotencyKey: `browser-as-${stamp}` },
  );

  const initiated = await call<{ gatewayReference: string }>(
    'POST',
    '/payments/initiate',
    { transactionId: assessment.transactionId },
    { ...agentAuth, idempotencyKey: `browser-pay-${stamp}` },
  );

  // The gateway confirms it. Nothing else in the platform can.
  await call('POST', '/payments/simulate', {
    gatewayReference: initiated.gatewayReference,
    outcome: 'SUCCESS',
    deliverWebhook: true,
  }, agentAuth);

  // A reversal, raised by one officer and approved by a second. The third
  // officer's execution is what the browser test does.
  const requesterToken = revenueToken;
  const approverToken = await signIn(APPROVER);
  await ensureExecutor();

  const approval = await call<{ approvalId: string }>(
    'POST',
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: assessment.transactionId,
      payload: {
        amountKobo: '100000',
        reason: 'Charged twice for the same kiosk in this period',
        refundType: 'REVERSAL',
      },
      reason: 'Duplicate assessment confirmed against the ward register.',
    },
    { token: requesterToken },
  );

  await call(
    'POST',
    `/government/approvals/${approval.approvalId}/decide`,
    { decision: 'APPROVE', reason: 'Duplicate confirmed against the record.' },
    { token: approverToken },
  );

  const fixtures = {
    taxpayerId: taxpayer.taxpayerId,
    tin: assignedTin,
    transactionId: assessment.transactionId,
    transactionReference: assessment.transactionReference,
    approvalId: approval.approvalId,
    approverPhone: APPROVER.phone,
    executorPhone: EXECUTOR.phone,
    password: EXECUTOR.password,
  };

  writeFileSync(outputPath, JSON.stringify(fixtures, null, 2));
  await pool.end();
  console.log(`[fixtures] wrote ${outputPath}`);
  console.log(`[fixtures] taxpayer ${fixtures.tin}, approval ${fixtures.approvalId} awaiting execution`);
}

main().catch((error) => {
  console.error('[fixtures] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
