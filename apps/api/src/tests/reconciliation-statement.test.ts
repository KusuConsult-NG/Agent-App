/**
 * Reconciliation must not accuse the day's takings because it could not read
 * the gateway.
 *
 * PRD §46 makes three-way reconciliation mandatory, and it is the only control
 * that establishes government actually received the money rather than the
 * platform believing it did. Two things were wrong with it.
 *
 * 1. IT COULD NOT TELL AN OUTAGE FROM AN EMPTY GATEWAY. The matching loop
 *    reads a payment absent from the statement as money the gateway has no
 *    record of, and the Remita adapter's fetchStatement returned a bare `[]`.
 *    Not as an obvious stub — as a value that flows straight through and marks
 *    every successful payment in the window MISSING_PAYMENT, "Platform records
 *    a successful payment the gateway has no record of". The first production
 *    run would have accused everything at once, and a queue that is wrong
 *    about every entry is the reason people stop opening the queue.
 *
 * 2. NOTHING EVER RAN IT. Six background workers, none of them reconciliation.
 *    It happened when a finance officer remembered.
 *
 * `gateway_statement_lines` — the table built to hold the evidence a dispute
 * would be re-argued from — had never been written to by any code.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  settleTransaction,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { LOCK_NAMESPACE, query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { developmentGatewayControls } from '../integrations/gateway';
import { runReconciliation, runScheduledReconciliation } from '../services/reconciliation';
import type { StatementRequest, StatementResult } from '../integrations/gateways/types';

let agent: { token: string; device: string };
let finance = '';

const PERIOD = () => ({
  from: new Date(Date.now() - 86_400_000),
  to: new Date(Date.now() + 60_000),
});

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Recon Admin', phone: '+2348000000030', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Recon Finance',
    phone: '+2348000000031',
    role: 'finance_officer',
  });
  finance = (await loginAs('+2348000000031')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/**
 * A collection taken to a verified payment.
 *
 * `deliverWebhook: false` leaves the gateway holding the money while the
 * platform never hears about it — the missed-webhook case reconciliation
 * exists to catch.
 */
async function collect(suffix: string, options: { deliverWebhook?: boolean } = {}) {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Statement',
      lastName: `Subject${suffix}`,
      phone: `+23480222${suffix.padStart(5, '0')}`,
      address: '7 Rock Haven, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `rs-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `rs-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `rs-pay-${suffix}` },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

  await post(
    '/payments/simulate',
    {
      gatewayReference: initiated.body.gatewayReference,
      outcome: 'SUCCESS',
      deliverWebhook: options.deliverWebhook ?? true,
    },
    auth,
  );

  return {
    transactionId: assessment.body.transactionId as string,
    gatewayReference: initiated.body.gatewayReference as string,
  };
}

/** Stand a different statement in front of reconciliation for one call. */
async function withStatement(
  replacement: (params: StatementRequest) => Promise<StatementResult>,
  body: () => Promise<void>,
): Promise<void> {
  const original = developmentGatewayControls.fetchStatement.bind(developmentGatewayControls);
  developmentGatewayControls.fetchStatement = replacement;
  try {
    await body();
  } finally {
    developmentGatewayControls.fetchStatement = original;
  }
}

function recordsFor(runId: string) {
  return query<{ status: string; gateway_reference: string | null }>(
    pool,
    'SELECT status, gateway_reference FROM reconciliation_records WHERE run_id = $1',
    [runId],
  );
}

describe('A statement that could not be read is not a statement of nothing', () => {
  it('refuses to run, rather than accusing every payment in the window', async () => {
    const collected = await collect('1');

    await withStatement(
      async () => ({
        outcome: 'UNAVAILABLE' as const,
        lines: [],
        unavailableReferences: [],
        source: 'NONE' as const,
        provider: 'mock',
        reason: 'Gateway could not be reached',
      }),
      async () => {
        const summary = await runReconciliation({
          ...PERIOD(),
          actorId: null,
          actorRole: 'system',
        });

        assert.equal(summary.status, 'ABORTED');
        assert.equal(summary.exceptions, 0);

        const records = await recordsFor(summary.runId);
        assert.equal(records.length, 0, 'nothing was compared, so nothing may be recorded');

        // The specific thing that must never happen: a payment the gateway
        // confirmed, recorded as one the gateway has no record of, because we
        // could not ask.
        const accused = await queryOne<{ count: string }>(
          pool,
          `SELECT count(*)::text AS count FROM reconciliation_records
            WHERE gateway_reference = $1 AND status = 'MISSING_PAYMENT'`,
          [collected.gatewayReference],
        );
        assert.equal(
          accused?.count,
          '0',
          'a verified payment was accused of being missing because the gateway was down',
        );
      },
    );
  });

  it('records the aborted attempt, so a blind period is visible', async () => {
    await withStatement(
      async () => ({
        outcome: 'UNAVAILABLE' as const,
        lines: [],
        unavailableReferences: [],
        source: 'NONE' as const,
        provider: 'mock',
        reason: 'Remita statement endpoint returned 502',
      }),
      async () => {
        const summary = await runReconciliation({
          ...PERIOD(),
          actorId: null,
          actorRole: 'system',
        });

        const run = await queryOne<{ status: string; abort_reason: string; completed_at: Date }>(
          pool,
          'SELECT status, abort_reason, completed_at FROM reconciliation_runs WHERE id = $1',
          [summary.runId],
        );
        assert.equal(run?.status, 'ABORTED');
        assert.match(run!.abort_reason, /502/);
        assert.ok(run!.completed_at, 'an aborted run is finished, not left RUNNING forever');
      },
    );
  });

  it('reports the refusal to the officer instead of a clean bill of health', async () => {
    await collect('2');

    await withStatement(
      async () => ({
        outcome: 'UNAVAILABLE' as const,
        lines: [],
        unavailableReferences: [],
        source: 'NONE' as const,
        provider: 'mock',
        reason: 'Gateway unreachable',
      }),
      async () => {
        const period = PERIOD();
        const response = await post(
          '/government/reconciliation/run',
          { from: period.from.toISOString(), to: period.to.toISOString() },
          { token: finance },
        );

        assert.equal(response.status, 200);
        assert.equal(response.body.status, 'ABORTED');
        assert.ok(response.body.abortReason, 'the officer is told why nothing was checked');
        // 0 exceptions here must never be presentable as "everything matched".
        assert.equal(response.body.exceptions, 0);
        assert.equal(response.body.matched, 0);
      },
    );
  });
});

describe('A reference the gateway could not be asked about', () => {
  it('is unchecked, not missing', async () => {
    const collected = await collect('3');

    await withStatement(
      async () => ({
        outcome: 'RETRIEVED' as const,
        lines: [],
        // The statement arrived; this one reference could not be checked.
        unavailableReferences: [collected.gatewayReference],
        source: 'PER_REFERENCE' as const,
        provider: 'mock',
      }),
      async () => {
        const summary = await runReconciliation({
          ...PERIOD(),
          actorId: null,
          actorRole: 'system',
        });

        assert.equal(summary.status, 'COMPLETED');
        assert.equal(summary.unchecked, 1);
        assert.equal(summary.exceptions, 0, 'an unanswered question is not a discrepancy');

        const records = await recordsFor(summary.runId);
        const mine = records.find((row) => row.gateway_reference === collected.gatewayReference);
        assert.equal(mine?.status, 'UNCHECKED');
      },
    );
  });
});

describe('The gateway’s own words are kept', () => {
  it('stores each statement line as the evidence a dispute is argued from', async () => {
    const collected = await collect('4');

    const summary = await runReconciliation({ ...PERIOD(), actorId: null, actorRole: 'system' });
    assert.equal(summary.status, 'COMPLETED');
    assert.ok(summary.statementLines >= 1);

    const line = await queryOne<{ amount_kobo: string; status: string; raw_line: unknown }>(
      pool,
      'SELECT amount_kobo, status, raw_line FROM gateway_statement_lines WHERE gateway_reference = $1',
      [collected.gatewayReference],
    );
    assert.ok(line, 'the statement table was never written to before this');
    assert.equal(line!.status, 'SUCCESS');
    assert.equal(line!.amount_kobo, '300000');
  });

  it('re-importing a period updates the line rather than duplicating it', async () => {
    const collected = await collect('5');

    await runReconciliation({ ...PERIOD(), actorId: null, actorRole: 'system' });
    await runReconciliation({ ...PERIOD(), actorId: null, actorRole: 'system' });

    const count = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM gateway_statement_lines WHERE gateway_reference = $1',
      [collected.gatewayReference],
    );
    assert.equal(count?.count, '1');
  });
});

/**
 * The button an officer presses, and the lock it used to walk past.
 *
 * The scheduled sweep has two guards — a module-level flag for re-entrancy in
 * one process, and a cross-instance advisory lock — and the manual route
 * called `runReconciliation` directly, past both. `withJobLock` exists
 * because replicas meant "N reconciliation sweeps every six hours, each
 * asking the gateway about every payment reference in a 48-hour window", and
 * an officer's button is another door onto exactly that.
 *
 * What is asserted here is the refusal, not the absence of corruption. There
 * was no corruption to prevent: runs are keyed by their own `runId`, the
 * exception queue already takes the newest finding per transaction, and
 * `confirmPayment` re-reads under `FOR UPDATE`. The harm was gateway traffic,
 * and the fix is that a second caller is told what is already running rather
 * than being allowed to double it — or, worse, being silently skipped, which
 * is the right answer to a timer and the wrong one to a person.
 */
describe('Two reconciliations at once', () => {
  /** Hold the sweep's lock the way another instance would. */
  async function holdTheLock(): Promise<() => Promise<void>> {
    const client = await pool.connect();
    const held = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
      [LOCK_NAMESPACE.WORKER, 'reconciliation-sweep'],
    );
    assert.ok(held.rows[0]?.locked, 'the test could not take the lock it means to hold');
    return async () => {
      await client
        .query('SELECT pg_advisory_unlock($1, hashtext($2))', [
          LOCK_NAMESPACE.WORKER,
          'reconciliation-sweep',
        ])
        .catch(() => undefined);
      client.release();
    };
  }

  it('refuses the second, and says what is already running', async () => {
    const release = await holdTheLock();
    try {
      const period = PERIOD();
      const response = await post(
        '/government/reconciliation/run',
        { from: period.from.toISOString(), to: period.to.toISOString() },
        { token: finance },
      );

      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'RECONCILIATION_ALREADY_RUNNING');
      assert.ok(
        /already running/i.test(response.body.error.message),
        response.body.error.message,
      );
      /*
       * The next step is the point. "Skipped" tells an officer nothing; this
       * has to say why pressing again is not the answer.
       */
      assert.ok(
        /gateway/i.test(response.body.error.nextStep ?? ''),
        response.body.error.nextStep,
      );
    } finally {
      await release();
    }
  });

  it('refuses a manual recovery for the same reason', async () => {
    // The sweep recovers unverified payments immediately after reconciling,
    // so a manual recovery beside it is the same doubled gateway traffic.
    const release = await holdTheLock();
    try {
      const period = PERIOD();
      const response = await post(
        '/government/reconciliation/recover',
        { from: period.from.toISOString(), to: period.to.toISOString() },
        { token: finance },
      );

      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'RECONCILIATION_ALREADY_RUNNING');
    } finally {
      await release();
    }
  });

  it('runs normally once the lock is free, and releases it again', async () => {
    /*
     * The half that matters most: a lock taken and not given back would make
     * the button work once per process lifetime, which is a worse failure
     * than the one being fixed and would look identical to a busy platform.
     */
    const period = PERIOD();
    const first = await post(
      '/government/reconciliation/run',
      { from: period.from.toISOString(), to: period.to.toISOString() },
      { token: finance },
    );
    assert.equal(first.status, 200);

    const second = await post(
      '/government/reconciliation/run',
      { from: period.from.toISOString(), to: period.to.toISOString() },
      { token: finance },
    );
    assert.equal(second.status, 200, 'the lock was not released after the first run');
    assert.notEqual(second.body.runId, first.body.runId);
  });
});

describe('Reconciliation runs without anyone remembering', () => {
  it('sweeps on its own, attributed to the platform rather than a borrowed officer', async () => {
    await collect('6');

    const result = await runScheduledReconciliation({ windowHours: 24 });

    assert.equal(result.skipped, false);
    assert.equal(result.summary?.status, 'COMPLETED');

    const run = await queryOne<{ started_by: string | null; status: string }>(
      pool,
      'SELECT started_by, status FROM reconciliation_runs WHERE id = $1',
      [result.summary!.runId],
    );
    assert.equal(run?.status, 'COMPLETED');
    assert.equal(run?.started_by, null, 'a scheduled run has no human behind it');
  });

  it('recovers a payment the gateway took and no webhook ever reported', async () => {
    // The money is at the gateway; the platform never heard.
    const stranded = await collect('7', { deliverWebhook: false });

    const before = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE gateway_reference = $1',
      [stranded.gatewayReference],
    );
    assert.notEqual(before?.status, 'VERIFIED', 'fixture: the payment starts unverified');

    const result = await runScheduledReconciliation({ windowHours: 24 });
    assert.equal(result.summary?.status, 'COMPLETED');

    const after = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE gateway_reference = $1',
      [stranded.gatewayReference],
    );
    assert.equal(
      after?.status,
      'VERIFIED',
      'the sweep must close the missed-webhook gap, not just file it',
    );

    /*
     * And the taxpayer gets what they were owed at that moment, which is the
     * acknowledgement. The receipt is owed too, and comes when the settlement
     * covering this collection is reconciled — recovering a missed webhook
     * closes the verification gap, not the settlement one.
     */
    const acknowledgement = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM documents
        WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
      [stranded.transactionId],
    );
    assert.equal(acknowledgement?.count, '1');

    const beforeSettlement = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM receipts WHERE transaction_id = $1`,
      [stranded.transactionId],
    );
    assert.equal(beforeSettlement?.count, '0', 'the State has not been paid yet');

    await settleTransaction(stranded.transactionId);
    const receipt = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM receipts WHERE transaction_id = $1`,
      [stranded.transactionId],
    );
    assert.equal(receipt?.count, '1');
  });
});
