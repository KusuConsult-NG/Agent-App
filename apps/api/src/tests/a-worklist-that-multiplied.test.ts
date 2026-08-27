/**
 * The exception queue that showed the same job several times.
 *
 * Found by driving the platform in a browser rather than by reading it: the
 * finance officer's reconciliation screen listed TXN-2026-000027 twice, then
 * 000029 twice, then 000025 twice — six rows for three transactions, each with
 * its own Resolve button.
 *
 * `reconciliation_records` holds one row per transaction per run, which is
 * correct: an auditor asking what the sweep concluded on Tuesday needs
 * Tuesday's answer rather than today's written over it. The queue is not
 * history, though. It is a list of things somebody has to do, and it read every
 * unresolved row from every run — so a transaction still awaiting settlement,
 * re-recorded by each six-hourly sweep across a forty-eight-hour window,
 * appeared up to eight times. Resolving one left the others.
 *
 * A worklist that multiplies its own contents is worse than a long one: the
 * officer cannot tell how much money is actually unaccounted for, and every
 * count derived from it is wrong in the same direction.
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
import { exceptionQueue, resolveException } from '../services/reconciliation';

/**
 * Two real transactions to hang findings on.
 *
 * `reconciliation_records.transaction_id` has a foreign key, and inventing rows
 * to satisfy it would mean building a taxpayer, an assessment and an invoice by
 * hand — the seed-writes-what-the-platform-cannot mistake. Two collections
 * through the API cost a couple of seconds and are the real thing.
 */
let transactions: string[] = [];
let financeOfficerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  /*
   * An agent does not exist until an officer has approved the application, and
   * `seedDemoAgent` walks the real pipeline rather than inserting a row — so it
   * gives up quietly when there is nobody with the authority to approve. The
   * officer has to exist first.
   */
  await createGovernmentUser({ fullName: 'Queue Admin', phone: '+2348069000001', role: 'admin' });
  financeOfficerId = await createGovernmentUser({
    fullName: 'Queue Finance',
    phone: '+2348069000002',
    role: 'finance_officer',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  transactions = [];
  for (const index of [1, 2]) {
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Queue',
        lastName: `Subject${index}`,
        phone: `+234812900000${index}`,
        address: '7 Yakubu Gowon Way, Jos',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...auth, idempotencyKey: `queue-tp-${index}` },
    );
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
        inputs: {},
      },
      { ...auth, idempotencyKey: `queue-as-${index}` },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
    transactions.push(assessment.body.transactionId);
  }
});

/**
 * Record what a run concluded about one transaction.
 *
 * Written directly because the subject here is the queue's reading of many
 * runs, not the matching that produces them — and reproducing eight sweeps over
 * a trailing window through the API would take longer than the whole rest of
 * this file to say the same thing.
 */
async function record(params: {
  runId: string;
  transactionId?: string | null;
  gatewayReference?: string | null;
  status: string;
  minutesAgo: number;
}) {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO reconciliation_records
       (run_id, transaction_id, gateway_reference, status, created_at)
     VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)
     RETURNING id`,
    [
      params.runId,
      params.transactionId ?? null,
      params.gatewayReference ?? null,
      params.status,
      String(params.minutesAgo),
    ],
  );
  return row!.id;
}

const runId = () => crypto.randomUUID();
const other = () => transactions[1];

describe('One unresolved exception is one item of work', () => {
  it('shows a transaction once however many runs recorded it', async () => {
    const transactionId = transactions[0];
    // Eight sweeps across a forty-eight-hour window, which is what the schedule
    // actually produces for one transaction that stays unsettled.
    for (let sweep = 0; sweep < 8; sweep += 1) {
      await record({
        runId: runId(),
        transactionId,
        gatewayReference: 'MOCKGW-ONE',
        status: 'PENDING_SETTLEMENT',
        minutesAgo: sweep * 360,
      });
    }

    const queue = await exceptionQueue(pool);
    assert.equal(queue.length, 1, 'eight recordings of one problem are one job');
  });

  it('shows the newest verdict, not the first one', async () => {
    const transactionId = transactions[0];
    await record({ runId: runId(), transactionId, status: 'PENDING_SETTLEMENT', minutesAgo: 720 });
    await record({ runId: runId(), transactionId, status: 'AMOUNT_MISMATCH', minutesAgo: 10 });

    const queue = await exceptionQueue(pool);
    assert.equal(queue.length, 1);
    // The later run found something worse. Showing the earlier, milder verdict
    // would understate what the officer is looking at.
    assert.equal((queue[0] as any).status, 'AMOUNT_MISMATCH');
  });

  it('clears the item when the newest record is resolved', async () => {
    const transactionId = transactions[0];
    await record({ runId: runId(), transactionId, status: 'PENDING_SETTLEMENT', minutesAgo: 720 });
    const newest = await record({
      runId: runId(),
      transactionId,
      status: 'PENDING_SETTLEMENT',
      minutesAgo: 10,
    });

    await resolveException({
      recordId: newest,
      resolution: 'The bank confirmed the credit by telephone; settlement recorded separately.',
      actorId: financeOfficerId,
      actorRole: 'finance_officer',
    });

    assert.equal(
      (await exceptionQueue(pool)).length,
      0,
      'resolving the newest finding clears the job rather than revealing an older copy',
    );
  });

  it('keeps every run on the record even though the queue shows one', async () => {
    const transactionId = transactions[0];
    for (let sweep = 0; sweep < 4; sweep += 1) {
      await record({
        runId: runId(),
        transactionId,
        status: 'PENDING_SETTLEMENT',
        minutesAgo: sweep * 360,
      });
    }
    // The queue is a worklist; the table is the audit trail. Deduplicating the
    // first must not quietly delete the second — an auditor asking what the
    // sweep concluded on Tuesday still needs Tuesday's answer.
    const rows = await query(
      pool,
      `SELECT id FROM reconciliation_records WHERE transaction_id = $1`,
      [transactionId],
    );
    assert.equal(rows.length, 4);
  });

  it('marks a resolved record resolved in both places at once', async () => {
    /*
     * The queue tests status alone, which is only safe because resolving
     * writes the status and the timestamp in one statement. This holds that
     * invariant, so a future change that set one without the other fails here
     * rather than quietly putting settled work back on somebody's list.
     */
    const id = await record({
      runId: runId(),
      transactionId: transactions[0],
      status: 'AMOUNT_MISMATCH',
      minutesAgo: 5,
    });
    await resolveException({
      recordId: id,
      resolution: 'Duplicate charge refunded to the taxpayer and the receipt voided.',
      actorId: financeOfficerId,
      actorRole: 'finance_officer',
    });

    const row = await queryOne<{ status: string; reconciled_at: Date | null }>(
      pool,
      `SELECT status, reconciled_at FROM reconciliation_records WHERE id = $1`,
      [id],
    );
    assert.equal(row!.status, 'RESOLVED');
    assert.ok(row!.reconciled_at, 'and the time it was resolved, in the same write');
  });

  it('does not merge two different transactions', async () => {
    await record({ runId: runId(), transactionId: transactions[0], status: 'AMOUNT_MISMATCH', minutesAgo: 5 });
    await record({ runId: runId(), transactionId: other(), status: 'AMOUNT_MISMATCH', minutesAgo: 6 });

    assert.equal((await exceptionQueue(pool)).length, 2, 'two problems are two jobs');
  });

  it('keeps gateway lines with no platform transaction apart from each other', async () => {
    /*
     * Money the gateway received with nothing on the platform to match it has a
     * null transaction id, so grouping by transaction alone would collapse
     * every one of them into a single row — the worst possible direction for
     * this particular exception, which is unexplained money the State has
     * received.
     */
    await record({ runId: runId(), gatewayReference: 'MOCKGW-A', status: 'MISSING_PLATFORM_TRANSACTION', minutesAgo: 5 });
    await record({ runId: runId(), gatewayReference: 'MOCKGW-B', status: 'MISSING_PLATFORM_TRANSACTION', minutesAgo: 6 });
    await record({ runId: runId(), gatewayReference: 'MOCKGW-A', status: 'MISSING_PLATFORM_TRANSACTION', minutesAgo: 400 });

    const queue = await exceptionQueue(pool);
    assert.equal(queue.length, 2, 'two unexplained credits, not one and not three');
  });

  it('still filters by status when asked', async () => {
    await record({ runId: runId(), transactionId: transactions[0], status: 'AMOUNT_MISMATCH', minutesAgo: 5 });
    await record({ runId: runId(), transactionId: other(), status: 'PENDING_SETTLEMENT', minutesAgo: 6 });

    const mismatches = await exceptionQueue(pool, { status: 'AMOUNT_MISMATCH' });
    assert.equal(mismatches.length, 1);
    assert.equal((mismatches[0] as any).status, 'AMOUNT_MISMATCH');
  });

  it('leaves a matched transaction out of the worklist entirely', async () => {
    const transactionId = transactions[0];
    await record({ runId: runId(), transactionId, status: 'PENDING_SETTLEMENT', minutesAgo: 720 });
    await record({ runId: runId(), transactionId, status: 'MATCHED', minutesAgo: 5 });

    assert.equal(
      (await exceptionQueue(pool)).length,
      0,
      'a later run that matched it means there is nothing to chase',
    );
  });
});
