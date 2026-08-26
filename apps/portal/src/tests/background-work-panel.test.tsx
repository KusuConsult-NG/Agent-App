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

  it('says how many need attention rather than leaving it to be counted', async () => {
    serve({
      jobs: [job(), job({ name: 'refund-retry', state: 'FAILING', message: 'Failed 3 times in a row: Gateway unreachable' })],
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
