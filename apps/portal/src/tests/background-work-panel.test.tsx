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
