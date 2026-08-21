/**
 * Observability, tested as a control rather than a convenience.
 *
 * The platform records what it still owes in half a dozen queues — a taxpayer
 * without their TIN, a renewal the authority never acknowledged, money a
 * citizen has not had back, a reconciliation exception nobody resolved. That
 * honesty is worth nothing if the depths never leave the database, so these
 * tests treat "an operator can see it" as a requirement with the same standing
 * as the financial rules.
 *
 * They also pin the redactor. A log line is the easiest place to undo PRD §62
 * data minimisation by accident, and the call site that forgets is the one that
 * ships, so the guarantee has to live somewhere a test can hold it.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBaseUrl,
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { queryOne } from '../db/pool';
import { withJobLock } from '../db/pool';
import { __testing } from '../lib/logger';
import { collectDatabaseGauges, render, reset as resetMetrics, metrics } from '../lib/metrics';
import { MockErrorReporter, HttpErrorReporter } from '../services/error-reporting';

/**
 * `/health` and `/metrics` are mounted at the server root, not under the
 * versioned API prefix, because an orchestrator's probe and a metrics scraper
 * should not have to track an API version. The helpers point at `/api/v1`, so
 * these two go direct.
 */
async function root(path: string, init: RequestInit = {}) {
  const origin = apiBaseUrl().replace(/\/api\/v1$/, '');
  const response = await fetch(`${origin}${path}`, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* metrics is plain text */
  }
  return { status: response.status, body: body as any, text };
}

const AGENT_DEVICE = 'demo-agent-device-000001';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

// ===========================================================================
describe('Logging never carries what PRD §62 minimises away', () => {
  const { sanitise } = __testing;

  it('redacts every flavour of secret, however the key is spelled', () => {
    const redacted = sanitise({
      password: 'Password123',
      newPassword: 'Password123',
      password_hash: '$2b$12$abcdef',
      authorization: 'Bearer eyJhbGciOi',
      refreshToken: 'rt_secret',
      apiKey: 'sk_live_123',
      api_key: 'sk_live_123',
      otp: '123456',
      identityNumber: '12345678901',
      identity_hash: 'deadbeef',
      accountNumber: '0123456781',
      bvn: '22233344455',
      signature: 'abc123',
    }) as Record<string, unknown>;

    for (const [key, value] of Object.entries(redacted)) {
      assert.equal(value, '[redacted]', `${key} must be redacted`);
    }
  });

  it('keeps the fields an operator actually needs', () => {
    const kept = sanitise({
      requestId: 'req-1',
      transactionReference: 'TXN-2026-000001',
      amountKobo: '20000',
      status: 'VERIFIED',
    }) as Record<string, unknown>;

    assert.equal(kept.requestId, 'req-1');
    assert.equal(kept.transactionReference, 'TXN-2026-000001');
    assert.equal(kept.amountKobo, '20000');
    assert.equal(kept.status, 'VERIFIED');
  });

  it('survives a cycle, a deep object and a bigint rather than throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    assert.doesNotThrow(() => sanitise(cyclic));
    assert.equal((sanitise(cyclic) as Record<string, unknown>).self, '[circular]');

    assert.equal((sanitise({ big: 10n }) as Record<string, unknown>).big, '10');

    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    assert.doesNotThrow(() => sanitise(deep));
  });

  it('redacts inside a nested error context, not only at the top level', () => {
    const nested = sanitise({
      component: 'payments',
      request: { body: { phone: '+2348030000001', password: 'Password123' } },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    assert.equal(nested.request.body.password, '[redacted]');
    // The phone number is not a secret — it is how a citizen is identified in
    // a support call — so it stays.
    assert.equal(nested.request.body.phone, '+2348030000001');
  });
});

// ===========================================================================
describe('Metrics expose the queues of what the platform owes', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMetrics();
  });

  it('renders valid Prometheus exposition text', () => {
    metrics.paymentConfirmed('VERIFIED', 'WEBHOOK');
    metrics.paymentConfirmed('FAILED', 'POLL');
    metrics.receiptIssued();
    metrics.workerRun('reconciliation-sweep', 'success', 1234);

    const output = render();

    assert.match(output, /# HELP psirs_payment_confirmations_total/);
    assert.match(output, /# TYPE psirs_payment_confirmations_total counter/);
    assert.match(output, /psirs_payment_confirmations_total\{outcome="VERIFIED",source="WEBHOOK"\} 1/);
    assert.match(output, /psirs_payment_confirmations_total\{outcome="FAILED",source="POLL"\} 1/);
    assert.match(output, /psirs_receipts_issued_total 1/);
    assert.match(output, /psirs_worker_last_run_ok\{worker="reconciliation-sweep"\} 1/);

    // Every line is either a comment or `name{labels} value`.
    for (const line of output.trim().split('\n')) {
      assert.ok(
        line.startsWith('#') || /^[a-z_]+(\{[^}]*\})? -?[\d.]+$/.test(line),
        `malformed exposition line: ${line}`,
      );
    }
  });

  it('counts a real payment confirmation, end to end', async () => {
    await seedReferenceData();
    await createGovernmentUser({ fullName: 'Obs Admin', phone: '+2348000000001', role: 'admin' });
    const agent = await seedDemoAgent();
    const session = await loginAs(agent!.phone, agent!.password, AGENT_DEVICE);

    const lgaId = await firstLgaId();
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Metric',
        lastName: 'Subject',
        phone: '+2349077700001',
        gender: 'UNSPECIFIED',
        lgaId,
        address: '1 Metric Way',
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        revenueItemId: await revenueItemByCode('MARKET-LEVY'),
        inputs: {},
      },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );
    const initiation = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId, paymentMethod: 'CARD' },
      { token: session.accessToken, deviceId: AGENT_DEVICE, idempotencyKey: `obs-${Date.now()}` },
    );

    resetMetrics();
    await post(
      '/payments/simulate',
      { gatewayReference: initiation.body.gatewayReference, outcome: 'SUCCESS' },
      { token: session.accessToken, deviceId: AGENT_DEVICE },
    );

    const output = render();
    assert.match(
      output,
      /psirs_payment_confirmations_total\{outcome="VERIFIED",source="WEBHOOK"\} 1/,
      `a verified payment must be counted: ${output}`,
    );
    assert.match(output, /psirs_receipts_issued_total 1/);
    assert.match(output, /psirs_webhooks_total\{outcome="processed"\} 1/);
  });

  it('reads the outstanding queues from the database', async () => {
    await seedReferenceData();
    resetMetrics();
    await collectDatabaseGauges(pool);
    const output = render();

    // Every queue an operator must be able to alert on.
    for (const gauge of [
      'psirs_outstanding_tins',
      'psirs_unacknowledged_renewals',
      'psirs_outstanding_refunds',
      'psirs_open_reconciliation_exceptions',
      'psirs_queued_notifications',
      'psirs_failed_notifications',
      'psirs_open_fraud_flags',
      'psirs_unverified_payments_over_1h',
      'psirs_rejected_webhooks',
    ]) {
      assert.match(output, new RegExp(`^${gauge} \\d+$`, 'm'), `${gauge} must be exported`);
    }
  });

  it('serves /metrics as scrapeable text', async () => {
    const scrape = await root('/metrics');
    assert.equal(scrape.status, 200, 'no METRICS_TOKEN is set in tests, so the endpoint is open');
    assert.match(scrape.text, /psirs_/);
    // Production refuses to boot without a token; that is pinned in
    // certification-audit.test.ts alongside the other boot guards.
  });
});

// ===========================================================================
describe('Health endpoints separate liveness from readiness', () => {
  it('answers liveness without touching the database', async () => {
    const live = await root('/health/live');
    assert.equal(live.status, 200);
    assert.equal(live.body.status, 'ok');
    assert.equal(typeof live.body.uptimeSeconds, 'number');
  });

  it('answers readiness only when the database is reachable', async () => {
    const ready = await root('/health/ready');
    assert.equal(ready.status, 200);
    assert.equal(ready.body.database, 'connected');
  });

  it('keeps the original /health path working', async () => {
    const health = await root('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
  });
});

// ===========================================================================
describe('Error reporting is best-effort and never leaks', () => {
  it('redacts the context it sends', async () => {
    const posted: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body));
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    try {
      const reporter = new HttpErrorReporter('webhook', 'https://alerts.test/hook', 'k', 1000, 'production');
      await reporter.report({
        message: 'something failed',
        error: new Error('boom'),
        requestId: 'req-9',
        context: { identityNumber: '12345678901', transactionReference: 'TXN-1' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const body = posted[0] as { context: Record<string, unknown>; exception: { value: string } };
    assert.equal(body.context.identityNumber, '[redacted]');
    assert.equal(body.context.transactionReference, 'TXN-1');
    assert.equal(body.exception.value, 'boom');
  });

  it('never throws when the reporting endpoint is unreachable', async () => {
    const reporter = new HttpErrorReporter(
      'webhook',
      'http://127.0.0.1:1/nothing-listens-here',
      '',
      200,
      'test',
    );
    await assert.doesNotReject(() => reporter.report({ message: 'x', error: new Error('y') }));
  });

  it('records reports in the mock, for development and tests', async () => {
    const reporter = new MockErrorReporter();
    await reporter.report({ message: 'recorded' });
    assert.equal(reporter.reports.length, 1);
    assert.equal(reporter.reports[0].message, 'recorded');
  });
});

// ===========================================================================
describe('Background jobs run once across the fleet', () => {
  it('lets one caller hold a job lock and turns the other away', async () => {
    let secondRan = false;

    // Hold the lock, and while holding it try to take it again — which is what
    // a second replica reaching the same interval looks like.
    const held = await withJobLock('audit-test-job', async () => {
      const second = await withJobLock('audit-test-job', async () => {
        secondRan = true;
        return 'second';
      });
      assert.equal(second.ran, false, 'the second caller must be turned away, not queued');
      return 'first';
    });

    assert.deepEqual(held, { ran: true, value: 'first' });
    assert.equal(secondRan, false, 'the job body must not run twice');
  });

  /**
   * The distinction this pins is the one that broke worker monitoring.
   *
   * Most of these jobs return null to mean "ran, nothing worth reporting".
   * When the lock helper also used null for "another instance has it", a job
   * that did its work and found nothing to do was indistinguishable from one
   * that never ran — so the caller recorded no timing and no liveness for it,
   * and six of the seven workers reported nothing at all. CI caught it: a
   * single freshly booted instance logged "another instance holds it" for
   * every worker, with no other instance in existence.
   */
  it('tells a job that returned null apart from a lock it could not take', async () => {
    const ranAndFoundNothing = await withJobLock('audit-test-null-job', async () => null);
    assert.deepEqual(
      ranAndFoundNothing,
      { ran: true, value: null },
      'a job that ran and returned null must report that it ran',
    );

    // And while it is held, a second caller is distinguishable from that.
    await withJobLock('audit-test-null-job-2', async () => {
      const blocked = await withJobLock('audit-test-null-job-2', async () => null);
      assert.deepEqual(blocked, { ran: false }, 'a blocked caller must report that it did not run');
      return null;
    });
  });

  it('releases the lock when the job throws', async () => {
    await assert.rejects(
      withJobLock('audit-test-throwing-job', async () => {
        throw new Error('job failed');
      }),
      /job failed/,
    );

    // The next caller must be able to take it.
    const after = await withJobLock('audit-test-throwing-job', async () => 'acquired');
    assert.deepEqual(after, { ran: true, value: 'acquired' }, 'a thrown job must not strand its lock');
  });

  it('does not block a different job', async () => {
    const outcome = await withJobLock('audit-job-a', async () =>
      withJobLock('audit-job-b', async () => 'both'),
    );
    assert.deepEqual(outcome, { ran: true, value: { ran: true, value: 'both' } });
  });

  /**
   * The symptom as an operator would see it: every worker must leave a
   * liveness reading behind, including the ones that had nothing to do.
   */
  it('records liveness for a worker that ran and found nothing to do', async () => {
    resetMetrics();

    const outcome = await withJobLock('audit-quiet-worker', async () => null);
    assert.equal(outcome.ran, true);
    if (outcome.ran) metrics.workerRun('audit-quiet-worker', 'success', 12);

    const output = render();
    assert.match(output, /psirs_worker_last_run_ok\{worker="audit-quiet-worker"\} 1/);
    assert.match(output, /psirs_worker_last_run_timestamp_seconds\{worker="audit-quiet-worker"\} \d+/);
  });
});
