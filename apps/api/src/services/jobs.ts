/**
 * The unattended work, and whether it actually ran.
 *
 * Nine jobs run on timers with nobody watching them. Eight of the nine left no
 * durable trace at all: a sweep that ran and found nothing to do wrote exactly
 * as many rows as a sweep that never ran, so the question "are we still sending
 * reminders?" had no answer anywhere in the platform. The ninth,
 * reconciliation, keeps `reconciliation_runs` because its own audit position
 * needs it.
 *
 * That absence is the §95 shape one level up. The platform goes on asserting
 * things that rest on machinery nobody can confirm is running: it expires an
 * invoice whose owner was never warned, because the expiry sweep and the
 * reminder sweep fail independently; it tells an agent they have no commission
 * eligible for payout when the promotion sweep is the only thing that would
 * have made it eligible. Nothing is wrong in either code path. The platform is
 * simply saying something untrue about money.
 */

import { pool, query, withJobLock, type JobOutcome } from '../db/pool';

/**
 * Every job that is supposed to be running, declared rather than discovered.
 *
 * This is the half that a table of run records cannot supply on its own: a job
 * that has never run once since the platform was deployed has no row, and an
 * answer assembled only from rows would leave it out entirely — the worst case
 * reported as nothing at all. The health read starts from this list and looks
 * each one up, so a missing row reads as NEVER RUN rather than as silence.
 *
 * `purpose` is here because the operator reading this screen at seven in the
 * morning should not have to know what `authority-catch-up` is before deciding
 * whether it mattering.
 */
export const BACKGROUND_JOBS = {
  'commission-promotion': {
    intervalMs: 5 * 60_000,
    purpose: 'Makes settled commission payable to agents.',
  },
  'notification-dispatch': {
    intervalMs: 30_000,
    purpose: 'Sends the SMS and messages queued by everything else.',
  },
  'fraud-sweep': {
    intervalMs: 15 * 60_000,
    purpose: 'Raises flags on collection patterns worth looking at.',
  },
  /*
   * Chases TINs the PSIRS service had not issued when a taxpayer registered.
   *
   * This job and the one below it exist because the integration adapters can
   * say a service could not be reached. That honesty is only worth having if
   * something acts on it later — otherwise "we will ask again" is a promise
   * nothing keeps, and a taxpayer who registered during a TIN outage waits for
   * a number for ever. Both are also endpoints an officer can trigger; the
   * schedule is what makes them happen without anyone remembering.
   */
  'tin-catch-up': {
    intervalMs: 30 * 60_000,
    purpose: 'Chases TINs the PSIRS service had not issued when a taxpayer registered.',
  },
  'authority-catch-up': {
    intervalMs: 30 * 60_000,
    purpose: 'Re-sends vehicle renewals the authority never acknowledged.',
  },
  'refund-retry': {
    intervalMs: 10 * 60_000,
    purpose: 'Asks the gateway again for refunds a taxpayer is still owed.',
  },
  /*
   * Hourly rather than nightly. The window between an invoice lapsing and the
   * record saying so is a window in which the platform tells a citizen they owe
   * something it will refuse to take, and tells the State it is owed money
   * nobody can pay it.
   */
  'invoice-expiry': {
    intervalMs: 60 * 60_000,
    purpose: 'Retires invoices whose payment deadline has passed.',
  },
  /*
   * Four times a day over a trailing window rather than nightly (PRD §46): a
   * settlement reference can land at any hour, and the sooner an exception is
   * visible the cheaper it is to chase. The sweep skips itself if the previous
   * one is still running.
   */
  'reconciliation-sweep': {
    intervalMs: 6 * 60 * 60_000,
    purpose: 'Proves against the gateway statement that the money arrived.',
  },
  /*
   * The same cadence as reconciliation, so a reminder lands within hours of the
   * invoice entering a window rather than the next day. Each window is flagged
   * on the invoice after the first send, so re-running never duplicates one.
   */
  'reminder-sweep': {
    intervalMs: 6 * 60 * 60_000,
    purpose: 'Warns taxpayers before an invoice lapses.',
  },
  /*
   * The two tables nothing pruned.
   *
   * `idempotency_keys` gains a row carrying a full response body on every
   * taxpayer registration, assessment, payment initiation and vehicle renewal,
   * and nothing had ever deleted one — on the busiest write path in the system,
   * in a database whose running out of space stops collection statewide.
   * `usage_events` had a retention function and an endpoint to call it, and no
   * schedule, so telemetry was pruned only when somebody remembered to press a
   * button. Daily is right for both: neither is urgent, and both are
   * unbounded.
   */
  'idempotency-sweep': {
    intervalMs: 24 * 60 * 60_000,
    purpose: 'Deletes settled idempotency keys past their retention window.',
  },
  'usage-retention': {
    intervalMs: 24 * 60 * 60_000,
    purpose: 'Deletes product telemetry past its ninety-day retention window.',
  },
} as const;

export type JobName = keyof typeof BACKGROUND_JOBS;

/**
 * Run a job under its lock, and record that it ran whichever way it ends.
 *
 * The recording is deliberately not inside a transaction with the work. Three
 * separate defects in this platform were a record rolled back by the very
 * refusal it was recording — a failed training attempt, a crashed
 * reconciliation run, a refused group attestation — and a job failure record
 * that vanishes when the job fails would be the same defect a fourth time, in
 * the one place whose entire purpose is to survive the failure.
 *
 * A tick that finds another instance holding the lock writes nothing and is not
 * a failure: the job is running, elsewhere. Because the record lives in the
 * shared database rather than in a process, the winning replica's row is the
 * answer for the whole cluster — which is what the Prometheus gauges could
 * never be.
 */
export async function runJob<T>(
  name: JobName,
  task: () => Promise<T>,
): Promise<JobOutcome<T>> {
  return withJobLock(name, async () => {
    const startedAt = Date.now();
    await recordStart(name);
    try {
      const value = await task();
      await recordFinish(name, 'SUCCEEDED', Date.now() - startedAt, describe(value), null);
      return value;
    } catch (error) {
      await recordFinish(
        name,
        'FAILED',
        Date.now() - startedAt,
        null,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  });
}

/** What a job returned, as a line an operator can read. Jobs return null for "nothing to do". */
function describe(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 500);
}

/**
 * Open a run, closing out a previous one that never came back.
 *
 * Finding the row still at RUNNING is not a race — the advisory lock means one
 * instance runs a given job at a time — so it is evidence that whoever held the
 * lock last died mid-job. Counting it here is the only chance anything gets to
 * count it: the row is about to be overwritten with this run, and after the
 * first success the crash would be invisible.
 */
async function recordStart(name: string): Promise<void> {
  await pool.query(
    `INSERT INTO background_jobs (name, last_started_at, last_outcome, runs_total)
     VALUES ($1, now(), 'RUNNING', 1)
     ON CONFLICT (name) DO UPDATE SET
       last_started_at = now(),
       last_outcome = 'RUNNING',
       runs_total = background_jobs.runs_total + 1,
       failures_total = background_jobs.failures_total
         + CASE WHEN background_jobs.last_outcome = 'RUNNING' THEN 1 ELSE 0 END,
       consecutive_failures = CASE
         WHEN background_jobs.last_outcome = 'RUNNING' THEN background_jobs.consecutive_failures + 1
         ELSE background_jobs.consecutive_failures END,
       last_failed_at = CASE
         WHEN background_jobs.last_outcome = 'RUNNING' THEN background_jobs.last_started_at
         ELSE background_jobs.last_failed_at END,
       last_error = CASE
         WHEN background_jobs.last_outcome = 'RUNNING'
           THEN 'The previous run started and never returned.'
         ELSE background_jobs.last_error END`,
    [name],
  );
}

async function recordFinish(
  name: string,
  outcome: 'SUCCEEDED' | 'FAILED',
  durationMs: number,
  detail: string | null,
  error: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE background_jobs SET
       last_finished_at = now(),
       last_outcome = $2,
       last_duration_ms = $3,
       last_detail = $4,
       last_succeeded_at = CASE WHEN $2 = 'SUCCEEDED' THEN now() ELSE last_succeeded_at END,
       last_failed_at = CASE WHEN $2 = 'FAILED' THEN now() ELSE last_failed_at END,
       last_error = CASE WHEN $2 = 'FAILED' THEN $5 ELSE NULL END,
       failures_total = failures_total + CASE WHEN $2 = 'FAILED' THEN 1 ELSE 0 END,
       consecutive_failures = CASE WHEN $2 = 'FAILED' THEN consecutive_failures + 1 ELSE 0 END
     WHERE name = $1`,
    [name, outcome, Math.round(durationMs), detail, error],
  );
}

export type JobState =
  | 'NEVER_RUN'
  | 'HEALTHY'
  | 'RUNNING'
  | 'OVERDUE'
  | 'FAILING'
  | 'STALLED';

export interface JobReport {
  name: JobName;
  purpose: string;
  intervalMs: number;
  state: JobState;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastSucceededAt: Date | null;
  lastDetail: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  runsTotal: number;
  failuresTotal: number;
  overdueBy: number | null;
  message: string;
}

/**
 * How overdue a job has to be before saying so.
 *
 * Twice the interval plus a minute. One interval is not late — a tick that
 * started a second after the last one finished is on time — and a screen that
 * calls a healthy job late is a screen nobody keeps looking at. The extra
 * minute covers the jobs whose interval is measured in seconds, where the
 * scrape and the tick can genuinely cross.
 */
function overdueAfter(intervalMs: number): number {
  return intervalMs * 2 + 60_000;
}

/**
 * What every declared job is doing, whether or not it has ever run.
 *
 * Six states, and the distinctions between them are the whole point. FAILING
 * says it is running and throwing. STALLED says it started and never came back,
 * which no counter would show because the run never ended. OVERDUE says the
 * timer itself has stopped — the case that has no evidence anywhere else,
 * because a job that is not running produces nothing to look at.
 */
export async function jobHealth(now = new Date()): Promise<{
  jobs: JobReport[];
  healthy: boolean;
  needingAttention: number;
}> {
  const rows = await query<{
    name: string;
    last_started_at: Date;
    last_finished_at: Date | null;
    last_outcome: string;
    last_detail: string | null;
    last_succeeded_at: Date | null;
    last_error: string | null;
    consecutive_failures: number;
    runs_total: string;
    failures_total: string;
  }>(pool, `SELECT * FROM background_jobs`);
  const byName = new Map(rows.map((row) => [row.name, row]));

  const jobs = (Object.keys(BACKGROUND_JOBS) as JobName[]).map((name): JobReport => {
    const declared = BACKGROUND_JOBS[name];
    const row = byName.get(name);

    if (!row) {
      return {
        name,
        purpose: declared.purpose,
        intervalMs: declared.intervalMs,
        state: 'NEVER_RUN',
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSucceededAt: null,
        lastDetail: null,
        lastError: null,
        consecutiveFailures: 0,
        runsTotal: 0,
        failuresTotal: 0,
        overdueBy: null,
        message: 'Has not run once since this database was created.',
      };
    }

    const sinceStart = now.getTime() - row.last_started_at.getTime();
    const late = sinceStart - overdueAfter(declared.intervalMs);

    /*
     * Ordered by what the operator should act on first.
     *
     * A job that is both failing and overdue is reported as failing, because
     * the error is the thing to read; overdue on top of that is a consequence
     * of the same problem, not a second one.
     */
    const state: JobState = row.consecutive_failures > 0
      ? 'FAILING'
      : row.last_outcome === 'RUNNING' && late > 0
        ? 'STALLED'
        : late > 0
          ? 'OVERDUE'
          : row.last_outcome === 'RUNNING'
            ? 'RUNNING'
            : 'HEALTHY';

    return {
      name,
      purpose: declared.purpose,
      intervalMs: declared.intervalMs,
      state,
      lastStartedAt: row.last_started_at,
      lastFinishedAt: row.last_finished_at,
      lastSucceededAt: row.last_succeeded_at,
      lastDetail: row.last_detail,
      lastError: row.last_error,
      consecutiveFailures: row.consecutive_failures,
      runsTotal: Number(row.runs_total),
      failuresTotal: Number(row.failures_total),
      overdueBy: late > 0 ? late : null,
      message: describeState(state, row.last_error, row.consecutive_failures),
    };
  });

  const needingAttention = jobs.filter((job) => job.state !== 'HEALTHY' && job.state !== 'RUNNING').length;
  return { jobs, healthy: needingAttention === 0, needingAttention };
}

function describeState(state: JobState, error: string | null, failures: number): string {
  switch (state) {
    case 'HEALTHY':
      return 'Running on schedule.';
    case 'RUNNING':
      return 'Running now.';
    case 'OVERDUE':
      return 'Has not started when it should have. The schedule itself may have stopped.';
    case 'STALLED':
      return 'Started and never finished. Whichever instance was running it did not come back.';
    case 'FAILING':
      return `Failed ${failures} time${failures === 1 ? '' : 's'} in a row: ${error ?? 'no reason recorded'}`;
    default:
      return 'Has not run once since this database was created.';
  }
}
