/**
 * The cells inside a usage group, and not only the group.
 *
 * The usage reports drop a group smaller than USAGE_MIN_GROUP_SIZE, because a
 * small enough count singles somebody out even without a name. The rule was
 * applied to each group's total and not to the counts inside it, and the
 * window is the reader's to choose. Measured over the last hour: Barkin Ladi
 * published with eight events, "1 started, 1 completed"; the vehicle-capture
 * funnel published "1 started, 1 completed" and a median completion time of
 * 90,000 ms — the exact duration of one agent's capture.
 *
 * A count between one and the minimum is now withheld (null). Zero is kept,
 * because it names nobody, and a median is published only over enough
 * completions to hide in.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { USAGE_MIN_GROUP_SIZE } from '@psirs/shared';
import * as usage from '../services/usage';

let lga: { id: string; name: string };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  // usage_events survives resetDatabase; these assertions count it.
  await query(pool, 'DELETE FROM usage_events');
  lga = (await queryOne<{ id: string; name: string }>(pool, 'SELECT id, name FROM lgas ORDER BY name LIMIT 1'))!;
});

const lastHour = () => ({ from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 60_000) });

/** Some app openings, so the LGA passes the group rule on its total. */
async function busyLga(openings = 8) {
  await usage.record(pool, {
    surface: 'AGENT_PWA',
    role: 'agent',
    events: Array.from({ length: openings }, () => ({
      event: 'app.opened' as const,
      occurredAt: new Date().toISOString(),
      lgaId: lga.id,
    })),
  });
}

/** Vehicle captures: `started` begun, the first `completed` of them finished. */
async function captures(started: number, completed: number) {
  const events = [];
  for (let i = 0; i < started; i += 1) {
    const flowId = randomUUID();
    const at = new Date().toISOString();
    events.push({ event: 'vehicle.capture' as const, occurredAt: at, lgaId: lga.id, flowId, outcome: 'STARTED' as const, step: 'plate' });
    if (i < completed) {
      events.push({ event: 'vehicle.capture' as const, occurredAt: at, lgaId: lga.id, flowId, outcome: 'COMPLETED' as const, step: 'done', durationMs: 60_000 + i * 1_000 });
    }
  }
  await usage.record(pool, { surface: 'AGENT_PWA', role: 'agent', events });
}

type Reach = { lga: string; started: string | null; completed: string | null; events: string };
type Funnel = {
  event: string;
  started: string | null;
  completed: string | null;
  abandoned: string | null;
  failed: string | null;
  median_completion_ms: string | null;
};

describe('reach by LGA', () => {
  it('withholds one start and one completion inside an LGA that passes on its total', async () => {
    await busyLga();
    await captures(1, 1);
    const row = ((await usage.reachByLga(pool, lastHour())) as unknown as Reach[]).find((r) => r.lga === lga.name);
    assert.ok(row, 'the LGA itself has enough events to be listed');
    assert.equal(row!.events, '10');
    assert.equal(row!.started, null, 'one start in one LGA in one hour was published');
    assert.equal(row!.completed, null);
  });

  it('shows the counts once there are enough to hide in', async () => {
    await busyLga();
    await captures(USAGE_MIN_GROUP_SIZE, USAGE_MIN_GROUP_SIZE);
    const row = ((await usage.reachByLga(pool, lastHour())) as unknown as Reach[]).find((r) => r.lga === lga.name);
    assert.equal(row!.started, String(USAGE_MIN_GROUP_SIZE));
    assert.equal(row!.completed, String(USAGE_MIN_GROUP_SIZE));
  });
});

describe('flow funnels', () => {
  it('withholds the counts and the median of a single flow, and keeps a zero', async () => {
    await captures(1, 1);
    const row = ((await usage.flowFunnels(pool, lastHour())) as unknown as Funnel[]).find((r) => r.event === 'vehicle.capture');
    assert.ok(row);
    assert.equal(row!.started, null);
    assert.equal(row!.completed, null);
    assert.equal(row!.median_completion_ms, null, 'one agent’s exact duration was published');
    assert.equal(row!.abandoned, '0', 'nobody gave up, and saying so names nobody');
  });

  it('publishes the median over enough completions', async () => {
    await captures(USAGE_MIN_GROUP_SIZE, USAGE_MIN_GROUP_SIZE);
    const row = ((await usage.flowFunnels(pool, lastHour())) as unknown as Funnel[]).find((r) => r.event === 'vehicle.capture');
    assert.equal(row!.completed, String(USAGE_MIN_GROUP_SIZE));
    assert.equal(row!.median_completion_ms, '62000');
  });

  it('withholds the median when the starts are enough and the completions are not', async () => {
    await captures(USAGE_MIN_GROUP_SIZE, USAGE_MIN_GROUP_SIZE - 1);
    const row = ((await usage.flowFunnels(pool, lastHour())) as unknown as Funnel[]).find((r) => r.event === 'vehicle.capture');
    assert.equal(row!.started, String(USAGE_MIN_GROUP_SIZE));
    assert.equal(row!.completed, null);
    assert.equal(row!.median_completion_ms, null);
  });
});
