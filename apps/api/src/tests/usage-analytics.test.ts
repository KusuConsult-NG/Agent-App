/**
 * Product usage analytics, and the two things it must not become.
 *
 * The platform recorded what money had moved and who had touched which record,
 * and nothing about the interface — so a form agents could not finish was
 * indistinguishable from one nobody opened, and a screen nobody could reach
 * looked the same as one nobody needed.
 *
 * The feature is small. The properties worth testing are not about whether a
 * count is right; they are about the two ways this kind of table goes wrong.
 *
 *   1. IT BECOMES SURVEILLANCE. Agents here are paid on commission and
 *      screened for fraud. A usage table with a user id in it is a per-person
 *      record of their keystrokes, which is a different product from finding
 *      out whether a form is too long. The schema has no such column and the
 *      service has no parameter that could fill one; these tests hold both.
 *
 *   2. IT BECOMES A DUMPING GROUND. An open string field filled by a client is
 *      unbounded cardinality, then a slow table, then junk nobody trusts — and
 *      it is the field through which a compromised client would write into an
 *      operator's screen. The vocabulary is closed, and the server is where it
 *      closes.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { USAGE_BATCH_LIMIT, USAGE_MIN_GROUP_SIZE } from '@psirs/shared';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import * as usage from '../services/usage';

let adminToken: string;

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  // usage_events is not in resetDatabase's truncate list — it is neither
  // transactional nor reference data — so it survives between runs, and the
  // suppression assertions below count rows. Clear it explicitly.
  await query(pool, 'DELETE FROM usage_events');
  await startTestServer();
  await createGovernmentUser({
    fullName: 'Usage Test Admin',
    phone: '+2348096500001',
    role: 'admin',
  });
  adminToken = (await loginAs('+2348096500001')).accessToken;
});

after(async () => {
  // Before stopping the server, which closes the pool this needs.
  await query(pool, 'DELETE FROM usage_events');
  await stopTestServer();
});

describe('the table cannot hold identity', () => {
  it('has no column for a user, an agent or a taxpayer', async () => {
    /*
     * Asserted against the live schema rather than by reading the migration,
     * because the danger is a *later* migration adding one. The failure
     * message has to explain itself: somebody hitting this test is probably
     * midway through adding exactly such a column for a plausible reason.
     */
    const columns = await query<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'usage_events'`,
    );
    const names = columns.map((c) => c.column_name);
    const identifying = names.filter((name) =>
      /user_id|agent_id|taxpayer_id|phone|tin|email|device_id|ip_address|session/.test(name),
    );
    assert.deepEqual(
      identifying,
      [],
      'usage_events must not identify a person: it is telemetry about the software, ' +
        'not evidence about a person. Per-agent questions belong in agentPerformance, ' +
        'which answers them from collections. See migration 024.',
    );
  });

  it('records the role but not who', async () => {
    await usage.record(pool, {
      surface: 'AGENT_PWA',
      role: 'agent',
      events: [{ event: 'app.opened', occurredAt: new Date().toISOString() }],
    });
    const row = await queryOne<Record<string, unknown>>(
      pool,
      `SELECT * FROM usage_events ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(row!.role, 'agent');
    assert.equal(row!.surface, 'AGENT_PWA');
  });

  it('is not the audit log, and does not pretend to be', async () => {
    // audit_logs is hash-chained evidence tied to a person and a record. This
    // table is disposable. Writing to one must never write to the other.
    const before = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_logs`,
    );
    await usage.record(pool, {
      surface: 'PORTAL',
      role: 'admin',
      events: [{ event: 'screen.viewed', occurredAt: new Date().toISOString(), step: '/usage' }],
    });
    const after_ = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_logs`,
    );
    assert.equal(after_!.n, before!.n, 'telemetry wrote into the evidentiary chain');
  });
});

describe('the vocabulary is closed', () => {
  it('drops an event name it does not recognise', async () => {
    const result = await usage.record(pool, {
      surface: 'AGENT_PWA',
      role: 'agent',
      events: [
        { event: 'app.opened', occurredAt: new Date().toISOString() },
        { event: 'whatever.i.like' as never, occurredAt: new Date().toISOString() },
      ],
    });
    assert.equal(result.accepted, 1, 'an unknown event name was stored');
  });

  it('refuses a batch larger than the limit rather than truncating it', async () => {
    // Truncating silently would make a client that is over the limit look
    // like one that is working.
    await assert.rejects(
      () =>
        usage.record(pool, {
          surface: 'AGENT_PWA',
          role: 'agent',
          events: Array.from({ length: USAGE_BATCH_LIMIT + 1 }, () => ({
            event: 'app.opened' as const,
            occurredAt: new Date().toISOString(),
          })),
        }),
      (error: { code?: string }) => {
        assert.equal(error.code, 'INVALID_REQUEST');
        return true;
      },
    );
  });

  it('refuses an unknown event name at the edge too, not only in the service', async () => {
    const response = await post(
      '/usage',
      {
        surface: 'AGENT_PWA',
        events: [{ event: 'nonsense', occurredAt: new Date().toISOString() }],
      },
      { token: adminToken },
    );
    // 422 is this platform's answer to a body that fails its schema; the point
    // here is that the closed vocabulary is enforced at the edge as well as in
    // the service, not which 4xx it is.
    assert.equal(response.status, 422, JSON.stringify(response.body));
  });

  it('accepts a well-formed batch and says how many it kept', async () => {
    const response = await post(
      '/usage',
      {
        surface: 'PORTAL',
        events: [
          { event: 'app.opened', occurredAt: new Date().toISOString() },
          { event: 'screen.viewed', occurredAt: new Date().toISOString(), step: '/transactions' },
        ],
      },
      { token: adminToken },
    );
    assert.equal(response.status, 202, JSON.stringify(response.body));
    assert.equal(response.body.accepted, 2);
  });

  it('will not take telemetry from an unauthenticated caller', async () => {
    // Not because the events are sensitive — they carry no identity — but
    // because an open write endpoint is a free way to fill the database.
    const response = await post('/usage', {
      surface: 'AGENT_PWA',
      events: [{ event: 'app.opened', occurredAt: new Date().toISOString() }],
    });
    assert.equal(response.status, 401);
  });
});

describe('aggregates withhold groups too small to be anonymous', () => {
  it('does not report an LGA with only a handful of events', async () => {
    /*
     * The rows carry no identity, but one agent working one LGA on one
     * afternoon is identifiable from a count of three. This is the property
     * most likely to be removed by somebody debugging an empty screen, so it
     * is asserted rather than documented.
     */
    const lga = await queryOne<{ id: string; name: string }>(
      pool,
      'SELECT id, name FROM lgas ORDER BY name LIMIT 1',
    );
    await usage.record(pool, {
      surface: 'AGENT_PWA',
      role: 'agent',
      events: Array.from({ length: USAGE_MIN_GROUP_SIZE - 1 }, () => ({
        event: 'app.opened' as const,
        occurredAt: new Date().toISOString(),
        lgaId: lga!.id,
      })),
    });

    const reach = (await usage.reachByLga(pool)) as unknown as { lga: string }[];
    assert.equal(
      reach.some((row) => row.lga === lga!.name),
      false,
      `an LGA with fewer than ${USAGE_MIN_GROUP_SIZE} events was published`,
    );
  });

  it('reports it once there are enough to hide in', async () => {
    const lga = await queryOne<{ id: string; name: string }>(
      pool,
      'SELECT id, name FROM lgas ORDER BY name LIMIT 1',
    );
    await usage.record(pool, {
      surface: 'AGENT_PWA',
      role: 'agent',
      events: Array.from({ length: USAGE_MIN_GROUP_SIZE + 2 }, () => ({
        event: 'app.opened' as const,
        occurredAt: new Date().toISOString(),
        lgaId: lga!.id,
      })),
    });

    const reach = (await usage.reachByLga(pool)) as unknown as { lga: string }[];
    assert.ok(reach.some((row) => row.lga === lga!.name));
  });
});

describe('the funnel answers the question it exists for', () => {
  it('separates a flow nobody finishes from a flow nobody starts', async () => {
    /*
     * This is the whole point of the module. An abandoned registration
     * creates no taxpayer, so before this table the two were the same fact:
     * no new taxpayer.
     */
    const abandoned = '11111111-1111-4111-8111-111111111111';
    const completed = '22222222-2222-4222-8222-222222222222';
    const now = new Date().toISOString();

    await usage.record(pool, {
      surface: 'AGENT_PWA',
      role: 'agent',
      events: [
        { event: 'taxpayer.registration', occurredAt: now, flowId: abandoned, outcome: 'STARTED', step: 'step-0' },
        { event: 'taxpayer.registration', occurredAt: now, flowId: abandoned, step: 'step-2' },
        { event: 'taxpayer.registration', occurredAt: now, flowId: abandoned, outcome: 'ABANDONED', step: 'step-2' },
        { event: 'taxpayer.registration', occurredAt: now, flowId: completed, outcome: 'STARTED', step: 'step-0' },
        { event: 'taxpayer.registration', occurredAt: now, flowId: completed, outcome: 'COMPLETED', step: 'step-4', durationMs: 90_000 },
      ],
    });

    const funnels = (await usage.flowFunnels(pool)) as unknown as {
      event: string;
      started: string;
      completed: string;
      abandoned: string;
      median_completion_ms: string;
    }[];
    const registration = funnels.find((row) => row.event === 'taxpayer.registration')!;

    assert.equal(registration.started, '2');
    assert.equal(registration.completed, '1');
    assert.equal(registration.abandoned, '1');
    assert.equal(registration.median_completion_ms, '90000');
  });

  it('is readable through the portal endpoint', async () => {
    const response = await get('/usage/overview', { token: adminToken });
    assert.equal(response.status, 200);
    for (const key of ['funnels', 'abandonment', 'offline', 'language', 'reach', 'screens']) {
      assert.ok(key in response.body, `the overview is missing ${key}`);
    }
  });
});

describe('telemetry is disposable, and says so', () => {
  it('deletes events past the retention window', async () => {
    await query(
      pool,
      `INSERT INTO usage_events (occurred_at, surface, event)
       VALUES (now() - interval '200 days', 'AGENT_PWA', 'app.opened')`,
    );
    const { deleted } = await usage.expireOldEvents(pool, 90);
    assert.ok(deleted >= 1, 'nothing was expired');

    const stale = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM usage_events WHERE occurred_at < now() - interval '90 days'`,
    );
    assert.equal(stale!.n, '0');
  });

  it('leaves recent events alone', async () => {
    const before = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM usage_events`,
    );
    await usage.expireOldEvents(pool, 90);
    const after_ = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM usage_events`,
    );
    assert.equal(after_!.n, before!.n);
  });
});
