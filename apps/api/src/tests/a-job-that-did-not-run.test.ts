/**
 * The sweep nobody watches, and no way to tell whether it ran.
 *
 * Nine jobs run on timers with nobody looking at them: reminders before an
 * invoice lapses, retirement of the ones that did, refunds a taxpayer is still
 * owed, commission becoming payable, TINs chased after an outage, renewals the
 * authority never acknowledged, notifications, the fraud sweep, and
 * reconciliation. Eight of them left no trace whatsoever. A sweep that ran and
 * found nothing to do wrote exactly as many rows as a sweep that never ran, so
 * "are we still sending reminders?" had no answer anywhere in the platform.
 *
 * WHAT THE ABSENCE COSTS. The platform keeps asserting things that rest on
 * machinery nobody can confirm is running. It expires an invoice whose owner
 * was never warned, because the expiry sweep and the reminder sweep fail
 * independently. It tells an agent they have no commission eligible for payout
 * when the promotion sweep is the only thing that would have made it eligible.
 * It leaves a refund PENDING, which reads exactly like one the bank refused
 * this morning. In each case nothing in the code is wrong and the platform is
 * still saying something untrue about money.
 *
 * The in-process Prometheus gauges were not an answer. They reset with the
 * process, and — in the multi-replica topology the advisory lock exists for —
 * they are set on whichever replica won the lock while the others record
 * nothing, so an alert on staleness fires on N-1 replicas every interval.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { BACKGROUND_JOBS, jobHealth, runJob, type JobName } from '../services/jobs';

let admin = '';
let agentless = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Worker Admin', phone: '+2348049000001', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Worker Agent Manager',
    phone: '+2348049000002',
    role: 'revenue_officer',
  });
  admin = (await loginAs('+2348049000001')).accessToken;
  agentless = (await loginAs('+2348049000002')).accessToken;
});

const stateOf = (body: any, name: string) =>
  body.jobs.find((job: any) => job.name === name);

const rowFor = (name: string) =>
  queryOne<{
    last_outcome: string;
    last_detail: string | null;
    last_error: string | null;
    last_succeeded_at: Date | null;
    last_failed_at: Date | null;
    consecutive_failures: number;
    runs_total: string;
    failures_total: string;
  }>(pool, `SELECT * FROM background_jobs WHERE name = $1`, [name]);

describe('A job leaves a record that it ran', () => {
  it('records a run that found nothing to do, which is the case that looked identical to never running', async () => {
    const outcome = await runJob('reminder-sweep', async () => null);
    assert.equal(outcome.ran, true);

    const row = await rowFor('reminder-sweep');
    assert.ok(row, 'the sweep is on the record');
    assert.equal(row!.last_outcome, 'SUCCEEDED');
    assert.ok(row!.last_succeeded_at, 'and the record says when it last actually worked');
    assert.equal(row!.consecutive_failures, 0);
    assert.equal(row!.runs_total, '1');
    // Nothing to report is not nothing to record. This is the whole defect:
    // the sweep had no reminders due and therefore wrote no reminders, which
    // is indistinguishable from a sweep that never started.
    assert.equal(row!.last_detail, null);
  });

  it('keeps what the job said it did', async () => {
    await runJob('invoice-expiry', async () => '3 invoice(s) passed their deadline');
    const row = await rowFor('invoice-expiry');
    assert.equal(row!.last_detail, '3 invoice(s) passed their deadline');
  });

  it('records a failure, and the failure does not take its own record down with it', async () => {
    /*
     * Three defects in this platform were a record rolled back by the very
     * refusal it was recording. A job-failure record that vanished when the job
     * failed would be the same defect again, in the one place whose entire
     * purpose is to survive the failure.
     */
    await assert.rejects(
      () => runJob('refund-retry', async () => {
        throw new Error('Gateway refused the refund request');
      }),
      /Gateway refused/,
    );

    const row = await rowFor('refund-retry');
    assert.ok(row, 'the failed run is on the record');
    assert.equal(row!.last_outcome, 'FAILED');
    assert.match(row!.last_error!, /Gateway refused the refund request/);
    assert.equal(row!.consecutive_failures, 1);
    assert.equal(row!.failures_total, '1');
    assert.equal(row!.last_succeeded_at, null, 'it has never succeeded');
    assert.ok(row!.last_failed_at);
  });

  it('separates when it last ran from when it last worked', async () => {
    await runJob('tin-catch-up', async () => '2 TIN(s) assigned');
    const afterSuccess = await rowFor('tin-catch-up');

    await assert.rejects(() => runJob('tin-catch-up', async () => {
      throw new Error('TIN service unreachable');
    }));
    await assert.rejects(() => runJob('tin-catch-up', async () => {
      throw new Error('TIN service unreachable');
    }));

    const row = await rowFor('tin-catch-up');
    assert.equal(row!.consecutive_failures, 2);
    assert.equal(row!.runs_total, '3');
    // The reading that tells a job failing since Tuesday from a job that is
    // fine: it has a recent finish either way, and only one of them has a
    // recent success.
    assert.equal(
      row!.last_succeeded_at?.toISOString(),
      afterSuccess!.last_succeeded_at?.toISOString(),
    );
  });

  it('clears the failure count when it works again', async () => {
    await assert.rejects(() => runJob('fraud-sweep', async () => {
      throw new Error('transient');
    }));
    await runJob('fraud-sweep', async () => null);

    const row = await rowFor('fraud-sweep');
    assert.equal(row!.consecutive_failures, 0, 'no longer needs attention');
    // But the total is not forgiven — a job that fails one tick in three is
    // healthy right now and is still worth knowing about.
    assert.equal(row!.failures_total, '1');
  });

  it('counts a run that started and never came back', async () => {
    /*
     * A pod evicted mid-sweep leaves the row at RUNNING and nothing else ever
     * notices: the run never ended, so no counter moved. The advisory lock
     * means one instance runs a given job at a time, so finding RUNNING when
     * the next run takes the lock is not a race — it is the previous holder
     * having died. Counting it at that moment is the only chance anything gets,
     * because the row is about to be overwritten.
     */
    await pool.query(
      `INSERT INTO background_jobs (name, last_started_at, last_outcome, runs_total)
       VALUES ('notification-dispatch', now() - interval '2 hours', 'RUNNING', 1)`,
    );

    await runJob('notification-dispatch', async () => '4 notification(s) delivered');

    const row = await rowFor('notification-dispatch');
    assert.equal(row!.last_outcome, 'SUCCEEDED');
    assert.equal(row!.failures_total, '1', 'the run that never returned is counted');
    assert.equal(row!.runs_total, '2');
    // Its success clears the consecutive count, which is right: it is working
    // now. The crash survives in the total rather than being erased by the
    // first success after it.
    assert.equal(row!.consecutive_failures, 0);
  });
});

describe('What the board says about work that is not happening', () => {
  it('reports a job that has never run at all, which no table of runs could', async () => {
    const { jobs, healthy, needingAttention } = await jobHealth();
    assert.equal(jobs.length, Object.keys(BACKGROUND_JOBS).length);
    assert.ok(jobs.every((job) => job.state === 'NEVER_RUN'));
    assert.equal(healthy, false);
    assert.equal(needingAttention, jobs.length);
    assert.match(jobs[0].message, /has not run once/i);
  });

  it('reports a job whose schedule has stopped, which nothing else could', async () => {
    // Late by more than twice its interval. There is no other evidence of this
    // anywhere: a job that is not running produces nothing to look at.
    await pool.query(
      `INSERT INTO background_jobs
         (name, last_started_at, last_finished_at, last_outcome, last_succeeded_at, runs_total)
       VALUES ('reminder-sweep', now() - interval '3 days', now() - interval '3 days',
               'SUCCEEDED', now() - interval '3 days', 40)`,
    );

    const { jobs, healthy } = await jobHealth();
    const sweep = jobs.find((job) => job.name === 'reminder-sweep')!;
    assert.equal(sweep.state, 'OVERDUE');
    assert.ok(sweep.overdueBy! > 0);
    assert.match(sweep.message, /schedule itself may have stopped/i);
    assert.equal(healthy, false);
  });

  it('does not call a job late while it is merely between ticks', async () => {
    await runJob('notification-dispatch', async () => null);
    const sweep = (await jobHealth()).jobs.find((job) => job.name === 'notification-dispatch')!;
    assert.equal(sweep.state, 'HEALTHY');
    assert.equal(sweep.overdueBy, null);
  });

  it('distinguishes a job that is running from one that stopped mid-run', async () => {
    await pool.query(
      `INSERT INTO background_jobs (name, last_started_at, last_outcome, runs_total)
       VALUES ('reconciliation-sweep', now(), 'RUNNING', 1),
              ('fraud-sweep', now() - interval '2 days', 'RUNNING', 9)`,
    );

    const { jobs } = await jobHealth();
    assert.equal(jobs.find((job) => job.name === 'reconciliation-sweep')!.state, 'RUNNING');
    const stalled = jobs.find((job) => job.name === 'fraud-sweep')!;
    assert.equal(stalled.state, 'STALLED');
    assert.match(stalled.message, /never finished/i);
  });

  it('reads the error out where somebody can see it, not just the count', async () => {
    await assert.rejects(() => runJob('authority-catch-up', async () => {
      throw new Error('Vehicle authority returned 503');
    }));

    const job = (await jobHealth()).jobs.find((j) => j.name === 'authority-catch-up')!;
    assert.equal(job.state, 'FAILING');
    assert.match(job.message, /Vehicle authority returned 503/);
    assert.match(job.message, /1 time/);
  });

  it('reports failing rather than overdue when a job is both', async () => {
    // A job that is failing is also, eventually, late — the interval keeps
    // passing. The error is the thing to read; late on top of it is the same
    // problem, not a second one.
    await pool.query(
      `INSERT INTO background_jobs
         (name, last_started_at, last_finished_at, last_outcome, last_failed_at,
          last_error, consecutive_failures, runs_total, failures_total)
       VALUES ('refund-retry', now() - interval '5 days', now() - interval '5 days',
               'FAILED', now() - interval '5 days', 'Gateway unreachable', 7, 20, 7)`,
    );
    const job = (await jobHealth()).jobs.find((j) => j.name === 'refund-retry')!;
    assert.equal(job.state, 'FAILING');
    assert.match(job.message, /7 times in a row/);
  });
});

describe('Every job the platform runs is on the board', () => {
  it('declares exactly the jobs the scheduler starts', async () => {
    /*
     * The registry is what makes a job that has never run visible, so a job
     * added to the scheduler and not to the registry would be invisible in
     * precisely the way this work exists to prevent — and a registry entry with
     * no scheduler is a job the board reports as NEVER RUN for ever, which is
     * an alarm nobody can clear.
     */
    const server = await readFile(join(__dirname, '..', 'server.ts'), 'utf8');
    const scheduled = [...server.matchAll(/schedule\('([a-z-]+)'/g)].map((match) => match[1]).sort();
    assert.deepEqual(scheduled, (Object.keys(BACKGROUND_JOBS) as JobName[]).sort());
  });

  it('gives every job a purpose somebody could act on', async () => {
    const { jobs } = await jobHealth();
    for (const job of jobs) {
      assert.ok(job.purpose.length > 20, `${job.name} says what it is for`);
      assert.ok(job.intervalMs > 0);
    }
  });
});

describe('Who may ask whether the controls ran', () => {
  it('answers an auditor, because whether reconciliation ran is an audit fact', async () => {
    await createGovernmentUser({
      fullName: 'Worker Auditor',
      phone: '+2348049000003',
      role: 'auditor',
    });
    const auditor = (await loginAs('+2348049000003')).accessToken;
    await runJob('reconciliation-sweep', async () => '12 matched, 0 exception(s)');

    const response = await get('/government/workers', { token: auditor });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(stateOf(response.body, 'reconciliation-sweep').state, 'HEALTHY');
    assert.equal(
      stateOf(response.body, 'reconciliation-sweep').lastDetail,
      '12 matched, 0 exception(s)',
    );
  });

  it('answers a revenue officer, who holds the permission too', async () => {
    const response = await get('/government/workers', { token: agentless });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it('refuses a supervisor, who runs a territory rather than the plumbing', async () => {
    await createGovernmentUser({
      fullName: 'Worker Supervisor',
      phone: '+2348049000004',
      role: 'supervisor',
    });
    const supervisor = (await loginAs('+2348049000004')).accessToken;
    const response = await get('/government/workers', { token: supervisor });
    assert.equal(response.status, 403, JSON.stringify(response.body));
  });

  it('says plainly how many need attention rather than making somebody count', async () => {
    await runJob('reminder-sweep', async () => null);
    const response = await get('/government/workers', { token: admin });
    assert.equal(response.body.healthy, false);
    assert.equal(
      response.body.needingAttention,
      Object.keys(BACKGROUND_JOBS).length - 1,
      'the eight that have never run',
    );
  });
});

describe('A tick another instance is already running', () => {
  it('is not recorded as a run, and is not a failure', async () => {
    /*
     * Under the advisory lock a second instance skips quietly. That is the job
     * running — elsewhere — so it must not be written as this replica's run and
     * must not count against it. Because the record is in the shared database
     * rather than in a process, the winning replica's row is the answer for the
     * whole cluster, which is what the Prometheus gauges could never be.
     */
    let inner: { ran: boolean } = { ran: true };
    await runJob('invoice-expiry', async () => {
      inner = await runJob('invoice-expiry', async () => 'the inner run should never happen');
      return 'outer';
    });

    assert.equal(inner.ran, false, 'the second attempt found the lock held');
    const rows = await query(pool, `SELECT name FROM background_jobs WHERE name = 'invoice-expiry'`);
    assert.equal(rows.length, 1);
    const row = await rowFor('invoice-expiry');
    assert.equal(row!.runs_total, '1', 'the skipped tick is not a run');
    assert.equal(row!.failures_total, '0', 'and it is not a failure');
    assert.equal(row!.last_detail, 'outer');
  });
});
