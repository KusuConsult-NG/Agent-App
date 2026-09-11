/**
 * The panel that shows whether the unattended controls are running.
 *
 * Every other screen in this portal shows work: invoices, flags, approvals. A
 * job that has stopped produces no work, so it shows up nowhere — which is why
 * the two states with no evidence anywhere else, never run and overdue, are the
 * ones asserted hardest here.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { statusSeverity } from '@psirs/shared';
import { BackgroundWorkPanel } from '../screens/Oversight';
import * as apiModule from '../lib/api';

const job = (over: Partial<Record<string, unknown>> = {}) => ({
  name: 'reminder-sweep',
  purpose: 'Warns taxpayers before an invoice lapses.',
  intervalMs: 6 * 60 * 60_000,
  state: 'HEALTHY',
  lastStartedAt: '2026-08-26T06:00:00.000Z',
  lastSucceededAt: '2026-08-26T06:00:00.000Z',
  lastFailedAt: null,
  flapping: false,
  lastDetail: '4 reminder(s) sent',
  lastError: null,
  consecutiveFailures: 0,
  runsTotal: 12,
  failuresTotal: 0,
  message: 'Running on schedule.',
  ...over,
});

describe('Unattended work', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  const serve = (body: unknown) =>
    vi.spyOn(apiModule.api, 'get').mockResolvedValue(body as never);

  /*
   * What the last run actually did.
   *
   * `jobHealth` has always sent `lastDetail` and the panel declared it in its
   * row type and drew no column for it — this fixture has carried "4
   * reminder(s) sent" for a value the screen dropped on the floor. A HEALTHY
   * row that says only "it ran" cannot distinguish a reminder sweep working
   * from a reminder sweep running over an empty queue because the query
   * behind it broke, and the second is the failure that looks like nothing.
   */
  it('says what the last run did, not only that it ran', async () => {
    serve({ jobs: [job()], healthy: true, needingAttention: 0 });

    render(<BackgroundWorkPanel />);

    expect(await screen.findByText('4 reminder(s) sent')).toBeTruthy();
  });

  it('distinguishes a run that found nothing from one that never succeeded', async () => {
    /*
     * Two rows with no detail and two different meanings. Blank for both
     * would make "the queue was empty" and "this has never worked" the same
     * reading, on the board whose whole purpose is telling them apart.
     */
    serve({
      jobs: [
        job({ name: 'idempotency-sweep', lastDetail: null }),
        job({
          name: 'connection-graph',
          lastDetail: null,
          lastSucceededAt: null,
          state: 'FAILING',
          consecutiveFailures: 3,
          lastError: 'relation "vehicle_register" does not exist',
        }),
      ],
      healthy: false,
      needingAttention: 1,
    });

    render(<BackgroundWorkPanel />);

    expect(await screen.findByText('Nothing needed doing')).toBeTruthy();
    // The failing row says nothing about what it did, and its reason is in
    // the column that exists for reasons.
    expect(screen.getByText(/vehicle_register/)).toBeTruthy();
  });

  it('says how many need attention rather than leaving it to be counted', async () => {
    serve({
      /*
       * The failure carries its count and its reason as fields.
       *
       * This used to set only `message`, the sentence `apps/api` composed
       * from them, and assert that the sentence reached the screen — which
       * pinned the very thing that was wrong. The column now builds it from
       * `consecutiveFailures` and `lastError`, which the response has always
       * carried, so the fixture supplies what the screen actually reads.
       */
      jobs: [
        job(),
        job({
          name: 'refund-retry',
          state: 'FAILING',
          consecutiveFailures: 3,
          lastError: 'Gateway unreachable',
          message: 'Failed 3 times in a row: Gateway unreachable',
        }),
      ],
      healthy: false,
      needingAttention: 1,
    });
    render(<BackgroundWorkPanel />);
    await screen.findByText(/1 of 2 scheduled jobs need attention/i);
    expect(screen.getByText(/Gateway unreachable/i)).toBeTruthy();
  });

  it('shows when a job last succeeded, not merely when it last ran', async () => {
    // A job throwing since Tuesday has a recent run and no recent success.
    serve({
      jobs: [job({ state: 'FAILING', lastSucceededAt: null, message: 'Failed 9 times in a row: no statement' })],
      healthy: false,
      needingAttention: 1,
    });
    render(<BackgroundWorkPanel />);
    await screen.findByText(/Last succeeded/i);
    expect(screen.getByText(/^Never$/)).toBeTruthy();
  });

  it('names a job that has never run at all', async () => {
    serve({
      jobs: [job({ state: 'NEVER_RUN', lastSucceededAt: null, message: 'Has not run once since this database was created.' })],
      healthy: false,
      needingAttention: 1,
    });
    render(<BackgroundWorkPanel />);
    await screen.findByText(/Has not run once/i);
  });

  it('reads six hours and thirty seconds both at a glance', async () => {
    serve({
      jobs: [job(), job({ name: 'notification-dispatch', intervalMs: 30_000 })],
      healthy: true,
      needingAttention: 0,
    });
    render(<BackgroundWorkPanel />);
    await screen.findByText('every 6 h');
    expect(screen.getByText('every 30s')).toBeTruthy();
  });

  it('does not render a stopped control in the colour of a working one', () => {
    /*
     * Every job state was landing on neutral grey before the shared classifier
     * learned these words — including the three that mean a control is not
     * operating. Asserted against the classifier itself rather than the
     * rendered class, because it is the classifier that both front ends share.
     */
    expect(statusSeverity('HEALTHY')).toBe('success');
    expect(statusSeverity('RUNNING')).toBe('pending');
    for (const stopped of ['FAILING', 'STALLED', 'OVERDUE', 'NEVER_RUN']) {
      expect(statusSeverity(stopped)).toBe('danger');
    }
  });
});

/**
 * The failure this board could not report.
 *
 * `state` is FAILING only while `consecutiveFailures > 0`, and the SQL behind
 * it reads `consecutive_failures = CASE WHEN $2 = 'FAILED' THEN
 * consecutive_failures + 1 ELSE 0 END` — one success and the counter is zero
 * again. So a job that fails every other run is HEALTHY, `needingAttention`
 * counts it as nothing, and the line above the table says every scheduled job
 * has run on schedule.
 *
 * `runsTotal` and `failuresTotal` have been in the payload all along and were
 * declared in the panel's own row type with no column to draw them, exactly as
 * `lastDetail` was before it. For the reconciliation sweep, a failure every
 * other run is money not reconciled, on the one board whose purpose is to say
 * whether unattended work is happening.
 */
describe('a job that fails and recovers and fails again', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  const serve = (body: unknown) =>
    vi.spyOn(apiModule.api, 'get').mockResolvedValue(body as never);

  /** Healthy by state, because the most recent run happened to succeed. */
  const flapping = job({
    name: 'reconciliation-sweep',
    state: 'HEALTHY',
    consecutiveFailures: 0,
    runsTotal: 900,
    failuresTotal: 446,
    lastSucceededAt: '2026-08-26T06:00:00.000Z',
    lastFailedAt: '2026-08-26T00:00:00.000Z',
    lastError: 'Remita returned 503 for the statement.',
    flapping: true,
  });

  it('shows the lifetime record rather than only the last run', async () => {
    serve({ jobs: [flapping], healthy: true, needingAttention: 0 });

    render(<BackgroundWorkPanel />);

    expect(await screen.findByText(/446 of 900 run\(s\) failed/)).toBeTruthy();
  });

  it('says it is failing on and off, even though its state is healthy', async () => {
    serve({ jobs: [flapping], healthy: true, needingAttention: 0 });

    render(<BackgroundWorkPanel />);

    expect(await screen.findByText(/Failing on and off/i)).toBeTruthy();
  });

  it('says what the intermittent failure was', async () => {
    /*
     * The other half, and the reason `last_error` no longer clears on success.
     * "Something went wrong at 00:00" is not something anybody can act on.
     */
    serve({ jobs: [flapping], healthy: true, needingAttention: 0 });

    render(<BackgroundWorkPanel />);

    expect(await screen.findByText(/Remita returned 503 for the statement/)).toBeTruthy();
  });

  it('says nothing of the sort about a job that has never failed', async () => {
    // The first control: a clean record must read as clean.
    serve({ jobs: [job({ runsTotal: 900, failuresTotal: 0 })], healthy: true, needingAttention: 0 });

    render(<BackgroundWorkPanel />);

    expect(await screen.findByText(/900 run\(s\), none failed/)).toBeTruthy();
    expect(screen.queryByText(/Failing on and off/i)).toBeNull();
  });

  it('says nothing of the sort about a failure that is long past', async () => {
    /*
     * The second control, and the one that stops this becoming noise. A job
     * that failed a year ago and has been perfect since carries a permanent
     * mark on its lifetime record and is not flapping.
     *
     * WHERE THAT IS DECIDED. This screen used to work the window out for
     * itself, from `lastFailedAt` and the interval, with the clock moved
     * forward to test it. It does not any more: the API sends `flapping`,
     * because the same rule also decides whether an administrator is woken,
     * and a board that disagrees with the inbox is worse than either alone.
     * The window itself is asserted in `a-job-that-did-not-run.test.ts`,
     * against real rows rather than a moved clock.
     *
     * What is held here is that the screen believes the flag rather than
     * inferring from the lifetime record — 446 failures and no current
     * problem must read as a history, not an alarm.
     */
    serve({
      jobs: [job({ runsTotal: 900, failuresTotal: 446, lastFailedAt: '2025-08-26T00:00:00.000Z', flapping: false })],
      healthy: true,
      needingAttention: 0,
    });

    render(<BackgroundWorkPanel />);

    expect(await screen.findByText(/446 of 900 run\(s\) failed/)).toBeTruthy();
    expect(screen.queryByText(/Failing on and off/i)).toBeNull();
  });
});
