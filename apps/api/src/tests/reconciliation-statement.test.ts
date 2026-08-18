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
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
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

    // And the taxpayer gets the receipt they were owed.
    const receipt = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM receipts WHERE transaction_id = $1`,
      [stranded.transactionId],
    );
    assert.equal(receipt?.count, '1');
  });
});
