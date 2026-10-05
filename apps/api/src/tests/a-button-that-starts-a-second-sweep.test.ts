/**
 * Six buttons that run a background sweep, and the lock the sweep holds.
 *
 * Every one of these endpoints exists so an officer need not wait for a timer:
 * a refund the gateway refused, a taxpayer still without a TIN, a renewal the
 * vehicle authority never acknowledged, commissions waiting to become
 * eligible, the connection graph, the reminder ladder. Each has a scheduled
 * counterpart in `BACKGROUND_JOBS`, and the scheduled one runs under a
 * cross-instance advisory lock precisely so two of them cannot run at once.
 *
 * The buttons held nothing. `reminder-sweep` was fixed a commit earlier; the
 * other five called their sweep's function bare, so a press during a scheduled
 * run — or two presses, by an officer who had been given no feedback from the
 * first — ran a second full pass alongside it.
 *
 * WHAT A SECOND PASS ACTUALLY COSTS
 *
 * Not misposted money, and that was checked rather than assumed: commission
 * promotion selects `FOR UPDATE OF c` and transitions in the same transaction,
 * `requestTin` re-reads `FOR UPDATE` and refuses, and the rebuild and the
 * authority retry are idempotent. What it costs is the external call twice —
 * the payment gateway, the TIN service, the vehicle authority — which is the
 * harm the reconcile-now button in the same file names in its own words:
 * "What it does cost is the gateway, and that is precisely what the lock is
 * for."
 *
 * HOW THIS IS MEASURED
 *
 * Each case takes the job's lock the way a scheduled run would —
 * `pg_try_advisory_lock(LOCK_NAMESPACE.WORKER, hashtext('<job name>'))`, which
 * is exactly what `withJobLock` takes — and then presses the button. A 409 is
 * only possible if the route contends on *that* name, so this pins the pairing
 * of button to job and not merely the presence of some lock somewhere. The
 * second case in each pair releases the lock and presses again, because a
 * button that refuses unconditionally would pass the first case perfectly.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { LOCK_NAMESPACE } from '../db/pool';
import { BACKGROUND_JOBS, type JobName } from '../services/jobs';
import { seedReferenceData } from '../db/seed';

/**
 * The button, the job whose work it runs, and who may press it.
 *
 * `admin` holds every gate here except `payment:reconcile`, which belongs to
 * the finance officer — the refunds queue is money going out and the role
 * model keeps it there.
 */
const BUTTONS: { path: string; job: JobName; role: string; body: unknown }[] = [
  { path: '/government/refunds/retry', job: 'refund-retry', role: 'finance_officer', body: {} },
  { path: '/taxpayers/tin-retry', job: 'tin-catch-up', role: 'admin', body: {} },
  {
    path: '/vehicles/renewals/authority-retry',
    job: 'authority-catch-up',
    role: 'admin',
    body: {},
  },
  {
    path: '/government/commissions/promote',
    job: 'commission-promotion',
    role: 'admin',
    body: {},
  },
  {
    path: '/government/intelligence/rebuild',
    job: 'connection-graph',
    role: 'admin',
    body: {},
  },
  {
    path: '/government/reminders/send-due',
    job: 'reminder-sweep',
    role: 'admin',
    body: {},
  },
];

const PHONES: Record<string, string> = {
  admin: '+2348000000170',
  finance_officer: '+2348000000171',
};

const TOKENS: Record<string, string> = {};

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  for (const [role, phone] of Object.entries(PHONES)) {
    await createGovernmentUser({ fullName: `Sweep ${role}`, phone, role });
    TOKENS[role] = (await loginAs(phone)).accessToken;
  }
});

/** Hold one job's lock on a dedicated connection, as a scheduled run would. */
async function holdTheLock(job: JobName): Promise<() => Promise<void>> {
  const client = await pool.connect();
  const held = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
    [LOCK_NAMESPACE.WORKER, job],
  );
  assert.ok(held.rows[0]?.locked, `the test could not take the ${job} lock it means to hold`);
  return async () => {
    await client
      .query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_NAMESPACE.WORKER, job])
      .catch(() => undefined);
    client.release();
  };
}

describe('a sweep an officer can start by hand', () => {
  for (const { path, job, role, body } of BUTTONS) {
    it(`${path} waits for ${job} rather than running beside it`, async () => {
      const release = await holdTheLock(job);
      try {
        const response = await post(path, body, { token: TOKENS[role]! });

        assert.equal(
          response.status,
          409,
          `the button started a second ${job}: ${JSON.stringify(response.body)}`,
        );
        assert.equal(
          response.body.error.code,
          'SWEEP_ALREADY_RUNNING',
          'one code for every sweep, because a caller does nothing different per sweep',
        );
        assert.match(
          response.body.error.message,
          /is already running/,
          `the refusal should say what is running. Got: ${response.body.error.message}`,
        );
        assert.ok(
          response.body.error.nextStep,
          'a refusal an officer can act on says what to do next',
        );
      } finally {
        await release();
      }
    });

    it(`${path} runs when nothing holds the ${job} lock`, async () => {
      // The bound. Without this, a route that threw 409 unconditionally — or
      // one locked on the wrong name and contending with itself — would pass
      // the case above and have turned the button off.
      const response = await post(path, body, { token: TOKENS[role]! });
      assert.equal(
        response.status,
        200,
        `the button is refused with no sweep running: ${JSON.stringify(response.body)}`,
      );
    });
  }

  it('names a job that is actually scheduled, for every button', () => {
    /*
     * The pairing above is only worth anything if each `job` is a real entry
     * in `BACKGROUND_JOBS`. `JobName` makes that a compile-time fact today;
     * this says it at runtime too, so the table cannot be loosened to strings
     * without the suite noticing.
     */
    for (const { path, job } of BUTTONS) {
      assert.ok(
        job in BACKGROUND_JOBS,
        `${path} locks on "${job}", which no scheduled job declares — so it ` +
          'contends with nothing and the lock is decoration',
      );
    }
  });
});
