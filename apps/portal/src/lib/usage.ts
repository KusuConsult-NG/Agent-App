/**
 * Reporting how the application is used.
 *
 * THE RULE THAT SHAPES ALL OF THIS: telemetry must never delay, block or break
 * a collection. Everything below follows from it — nothing awaits a send,
 * every failure is swallowed, the queue is capped and drops rather than grows,
 * and no caller ever has to handle an error. An agent standing in a market
 * with a trader waiting must never be slowed by a metric.
 *
 * The queue is localStorage rather than IndexedDB, deliberately: the draft
 * queue owns IndexedDB and holds work that must not be lost. Telemetry that
 * is lost is telemetry that is lost. Keeping them in different stores means a
 * flood of events cannot compete for the space a queued registration needs.
 *
 * WHAT IS NOT SENT. No name, phone, TIN, taxpayer id, agent id or amount. The
 * shared vocabulary has no field that could carry one; `flowId` is a random id
 * per attempt that references nothing and lets three rows be recognised as one
 * registration without saying whose.
 */

import {
  USAGE_BATCH_LIMIT,
  type UsageEvent,
  type UsageEventInput,
  type UsageOutcome,
} from '@psirs/shared';
import { api } from './api';

const QUEUE_KEY = 'psirs_portal_usage_queue';
/** Beyond this the oldest are dropped. A device offline for a week must not
 *  fill its storage with metrics. */
const QUEUE_LIMIT = 200;

let appVersion = '';
let language = 'en';
let connection: 'ONLINE' | 'LIMITED' | 'OFFLINE' = 'ONLINE';
let lgaId: string | null = null;

export function configureUsage(context: {
  appVersion?: string;
  language?: string;
  connection?: 'ONLINE' | 'LIMITED' | 'OFFLINE';
  lgaId?: string | null;
}): void {
  if (context.appVersion !== undefined) appVersion = context.appVersion;
  if (context.language !== undefined) language = context.language;
  if (context.connection !== undefined) connection = context.connection;
  if (context.lgaId !== undefined) lgaId = context.lgaId;
}

function read(): UsageEventInput[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as UsageEventInput[]) : [];
  } catch {
    // A corrupt queue is not worth a line of recovery code. Telemetry is
    // disposable; that is most of the point of keeping it separate.
    return [];
  }
}

function write(events: UsageEventInput[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-QUEUE_LIMIT)));
  } catch {
    /* Storage full or unavailable. Dropping telemetry is the correct loss. */
  }
}

/** Record one event. Never throws, never awaits, never blocks. */
export function track(
  event: UsageEvent,
  details: { step?: string; outcome?: UsageOutcome; durationMs?: number; flowId?: string } = {},
): void {
  try {
    const queued = read();
    queued.push({
      event,
      occurredAt: new Date().toISOString(),
      step: details.step ?? null,
      outcome: details.outcome ?? null,
      durationMs: details.durationMs ?? null,
      flowId: details.flowId ?? null,
      language,
      connection,
      appVersion: appVersion || null,
      lgaId,
    });
    write(queued);
    if (connection !== 'OFFLINE' && queued.length >= 10) void flush();
  } catch {
    /* Nothing a caller could do, and nothing worth doing. */
  }
}

/**
 * Send whatever is queued.
 *
 * On failure the batch goes back, once. It is not retried in a loop and never
 * against the connection a payment is waiting on.
 */
export async function flush(): Promise<void> {
  let batch: UsageEventInput[] = [];
  try {
    const queued = read();
    if (queued.length === 0) return;
    batch = queued.slice(0, USAGE_BATCH_LIMIT);
    write(queued.slice(batch.length));
    await api.post('/usage', { surface: 'PORTAL', events: batch });
  } catch {
    try {
      write([...batch, ...read()]);
    } catch {
      /* Give up. */
    }
  }
}

/**
 * Follow one attempt at a multi-step flow.
 *
 * `flowId` is generated here and referenced nowhere else, so a funnel can be
 * drawn without the events being attributable to a person. `abandon` is the
 * one that matters: an abandoned registration creates no taxpayer, so without
 * it a form nobody can finish is indistinguishable from one nobody opens.
 */
export function startFlow(event: UsageEvent, step?: string) {
  const flowId = crypto.randomUUID();
  const startedAt = Date.now();
  let settled = false;

  track(event, { flowId, step, outcome: 'STARTED' });

  const settle = (outcome: UsageOutcome) => (finalStep?: string) => {
    if (settled) return;
    settled = true;
    track(event, { flowId, step: finalStep ?? step, outcome, durationMs: Date.now() - startedAt });
  };

  return {
    flowId,
    /** A step was reached. No outcome: this is the trail, not the verdict. */
    step: (name: string) => track(event, { flowId, step: name }),
    complete: settle('COMPLETED'),
    abandon: settle('ABANDONED'),
    fail: settle('FAILED'),
  };
}
