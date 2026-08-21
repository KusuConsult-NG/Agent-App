/**
 * Metrics, in Prometheus text exposition format.
 *
 * Deliberately hand-rolled and tiny. A metrics client is a dependency in the
 * hot path of every request, and what this platform needs monitored is a short,
 * specific list rather than a general-purpose instrumentation surface:
 *
 *   * money that was confirmed, and money that failed to confirm;
 *   * webhooks that arrived and webhooks that were refused;
 *   * whether each background worker has run recently and whether it succeeded;
 *   * how deep the queues of what the platform still owes have become.
 *
 * That last one is the point. This codebase is unusually careful about
 * recording what it owes — a taxpayer without their TIN, a renewal the vehicle
 * authority never acknowledged, money a citizen has not had back, a
 * reconciliation exception nobody has resolved. All of that honesty is worth
 * nothing if no one is watching, and until now nothing exported those depths
 * anywhere an alert could see them.
 *
 * Counters live in process memory, so they reset on deploy and are per-instance.
 * That is correct for counters — a scraper sums across instances and handles
 * resets. The queue depths are read from the database at scrape time instead,
 * because those are facts about the platform, not about this process.
 */

import type { Db } from '../db/pool';
import { query } from '../db/pool';

type Labels = Record<string, string>;

interface Series {
  help: string;
  type: 'counter' | 'gauge';
  values: Map<string, { labels: Labels; value: number }>;
}

const registry = new Map<string, Series>();

function keyFor(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${labels[name]}`)
    .join(',');
}

function series(name: string, help: string, type: 'counter' | 'gauge'): Series {
  let existing = registry.get(name);
  if (!existing) {
    existing = { help, type, values: new Map() };
    registry.set(name, existing);
  }
  return existing;
}

export function increment(name: string, help: string, labels: Labels = {}, by = 1): void {
  const target = series(name, help, 'counter');
  const key = keyFor(labels);
  const current = target.values.get(key);
  if (current) current.value += by;
  else target.values.set(key, { labels, value: by });
}

export function setGauge(name: string, help: string, value: number, labels: Labels = {}): void {
  const target = series(name, help, 'gauge');
  target.values.set(keyFor(labels), { labels, value });
}

/** Escape a label value per the exposition format. */
function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const rendered = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}="${escape(value)}"`)
    .join(',');
  return `{${rendered}}`;
}

/**
 * Facts about the platform rather than about this process, read fresh.
 *
 * Every one of these is a queue of something a person is waiting for. An alert
 * on any of them growing is the difference between "the platform records what
 * it owes" and "somebody finds out".
 */
export async function collectDatabaseGauges(db: Db): Promise<void> {
  const rows = await query<{
    outstanding_tins: string;
    unacknowledged_renewals: string;
    outstanding_refunds: string;
    open_exceptions: string;
    queued_notifications: string;
    failed_notifications: string;
    open_fraud_flags: string;
    unverified_payments: string;
    rejected_webhooks: string;
  }>(
    db,
    `SELECT
       (SELECT count(*) FROM taxpayers
         WHERE tin IS NULL AND tin_status NOT IN ('NOT_REQUESTED','REJECTED'))::text
         AS outstanding_tins,
       (SELECT count(*) FROM vehicle_renewals
         WHERE document_id IS NOT NULL AND authority_notified_at IS NULL)::text
         AS unacknowledged_renewals,
       (SELECT count(*) FROM refunds WHERE status NOT IN ('COMPLETED','FAILED'))::text
         AS outstanding_refunds,
       (SELECT count(*) FROM reconciliation_records
         WHERE status NOT IN ('MATCHED','RESOLVED') AND resolution_note IS NULL)::text
         AS open_exceptions,
       (SELECT count(*) FROM notifications WHERE status = 'QUEUED')::text
         AS queued_notifications,
       (SELECT count(*) FROM notifications WHERE status = 'FAILED')::text
         AS failed_notifications,
       (SELECT count(*) FROM fraud_flags WHERE status IN ('OPEN','UNDER_REVIEW'))::text
         AS open_fraud_flags,
       (SELECT count(*) FROM payments
         WHERE status IN ('INITIATED','PENDING','SUCCESSFUL')
           AND created_at < now() - interval '1 hour')::text
         AS unverified_payments,
       (SELECT count(*) FROM payment_webhook_events
         WHERE processing_status IN ('REJECTED','FAILED'))::text
         AS rejected_webhooks`,
  );

  const row = rows[0];
  if (!row) return;

  const gauges: [string, string, string][] = [
    ['psirs_outstanding_tins', 'Taxpayers registered but still without a TIN', row.outstanding_tins],
    [
      'psirs_unacknowledged_renewals',
      'Vehicle renewals issued but never acknowledged by the authority',
      row.unacknowledged_renewals,
    ],
    ['psirs_outstanding_refunds', 'Refunds a taxpayer is still owed', row.outstanding_refunds],
    [
      'psirs_open_reconciliation_exceptions',
      'Reconciliation exceptions nobody has resolved',
      row.open_exceptions,
    ],
    ['psirs_queued_notifications', 'Notifications waiting to be delivered', row.queued_notifications],
    ['psirs_failed_notifications', 'Notifications that could not be delivered', row.failed_notifications],
    ['psirs_open_fraud_flags', 'Fraud flags open or under review', row.open_fraud_flags],
    [
      'psirs_unverified_payments_over_1h',
      'Payments in flight for more than an hour without confirmation',
      row.unverified_payments,
    ],
    [
      'psirs_rejected_webhooks',
      'Webhook deliveries refused or failed in processing',
      row.rejected_webhooks,
    ],
  ];

  for (const [name, help, value] of gauges) {
    setGauge(name, help, Number(value));
  }
}

/** The whole registry, in the format a scraper expects. */
export function render(): string {
  const lines: string[] = [];
  for (const [name, entry] of [...registry.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`# HELP ${name} ${entry.help}`);
    lines.push(`# TYPE ${name} ${entry.type}`);
    for (const { labels, value } of entry.values.values()) {
      lines.push(`${name}${renderLabels(labels)} ${value}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Test isolation only. */
export function reset(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// The specific things worth counting
// ---------------------------------------------------------------------------

export const metrics = {
  paymentConfirmed(outcome: 'VERIFIED' | 'FAILED' | 'PENDING', source: string): void {
    increment(
      'psirs_payment_confirmations_total',
      'Payment confirmation attempts by outcome and the source that triggered them',
      { outcome, source },
    );
  },

  amountMismatch(): void {
    increment(
      'psirs_payment_amount_mismatch_total',
      'Gateway confirmations whose amount did not match the invoice',
    );
  },

  receiptIssued(): void {
    increment('psirs_receipts_issued_total', 'Government receipts issued');
  },

  webhookReceived(outcome: 'processed' | 'duplicate' | 'rejected' | 'unparseable'): void {
    increment('psirs_webhooks_total', 'Webhook deliveries by outcome', { outcome });
  },

  workerRun(worker: string, outcome: 'success' | 'failure', durationMs: number): void {
    increment('psirs_worker_runs_total', 'Background worker runs by outcome', { worker, outcome });
    setGauge(
      'psirs_worker_last_run_timestamp_seconds',
      'Unix time of the last completed run of each background worker',
      Math.floor(Date.now() / 1000),
      { worker },
    );
    setGauge(
      'psirs_worker_last_duration_seconds',
      'Duration of the last completed run of each background worker',
      durationMs / 1000,
      { worker },
    );
    setGauge(
      'psirs_worker_last_run_ok',
      '1 if the last run of this worker succeeded, 0 if it failed',
      outcome === 'success' ? 1 : 0,
      { worker },
    );
  },

  httpRequest(method: string, status: number): void {
    increment('psirs_http_requests_total', 'HTTP requests by method and status class', {
      method,
      status: `${Math.floor(status / 100)}xx`,
    });
  },

  reconciliationRun(status: string, exceptions: number): void {
    increment('psirs_reconciliation_runs_total', 'Reconciliation sweeps by status', { status });
    setGauge(
      'psirs_reconciliation_last_exceptions',
      'Exceptions raised by the most recent reconciliation sweep',
      exceptions,
    );
  },
};
