/**
 * Whether the services this platform depends on are answering, and the alert
 * that arrives when one stops.
 *
 * `integrationStatus()` reported which adapter was configured -- a fact about
 * deployment that says nothing about whether the thing at the other end
 * responded this morning. So "system alert (integration down)" was an alert
 * the platform had no way to raise, and migration 064 removed an
 * `INTEGRATION_ALERT` notification kind rather than ship a state nothing could
 * write.
 *
 * WHAT IS BEING TESTED, AND WHAT IS NOT
 *
 * Not that a counter increments. The three properties that decide whether this
 * is monitoring or noise:
 *
 *   * An answer nobody likes is still an answer. "This taxpayer has no TIN" is
 *     the service working, and counting it as a failure would put an
 *     integration into alarm for doing its job.
 *   * One failure is not an outage. Three in a row with nothing in between is.
 *     A success resets the count, so a busy integration failing one call in
 *     twenty never alerts.
 *   * Recording must never break the thing it is recording. A taxpayer's
 *     registration must not fail because a monitoring table could not be
 *     written.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
import { query, queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import {
  integrationHealth,
  raiseIntegrationAlerts,
  recordCall,
} from '../services/integration-health';

const ADMIN_PHONE = '+2348084000001';
let adminToken = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Health Admin', phone: ADMIN_PHONE, role: 'admin' });
  adminToken = (await loginAs(ADMIN_PHONE)).accessToken;
});

const auth = () => ({ token: adminToken });
const sweep = () => withTransaction((client) => raiseIntegrationAlerts(client));

async function stateOf(name: string): Promise<string> {
  const { integrations } = await integrationHealth(pool);
  return integrations.find((one) => one.name === name)!.state;
}

// ===========================================================================
describe('the health of an integration is the shape of its real traffic', () => {
  it('starts as never called, which is not the same as down', async () => {
    const { integrations, healthy, needingAttention } = await integrationHealth(pool);
    assert.equal(healthy, true, 'a fresh deployment is not an outage');
    assert.equal(needingAttention, 0);
    for (const one of integrations) {
      assert.equal(one.state, 'NEVER_CALLED', `${one.name} has not been called`);
    }
  });

  /*
   * The distinction the whole integrations directory is built on, applied
   * here: "we could not ask" is not "the answer is no".
   */
  it('counts an unwelcome answer as the service working', async () => {
    await recordCall('tin', 'NOT_FOUND', { provider: 'psirs-tin' });
    await recordCall('banks', 'MISMATCH', { provider: 'nibss' });
    await recordCall('kyc', 'FAILED', { provider: 'identity' });

    assert.equal(await stateOf('tin'), 'HEALTHY');
    assert.equal(await stateOf('banks'), 'HEALTHY');
    assert.equal(await stateOf('kyc'), 'HEALTHY');
  });

  it('calls one failure degraded and three in a row down', async () => {
    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    assert.equal(await stateOf('tin'), 'DEGRADED', 'one dropped connection is not news');

    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    assert.equal(await stateOf('tin'), 'DOWN');
  });

  it('lets one answer clear the count, so a busy service never alerts on noise', async () => {
    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    await recordCall('tin', 'FOUND');
    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });

    assert.equal(await stateOf('tin'), 'DEGRADED');
    const row = await queryOne<{ calls_total: string; unavailable_total: string }>(
      pool,
      `SELECT calls_total, unavailable_total FROM integration_health WHERE name = 'tin'`,
    );
    assert.equal(row!.calls_total, '4', 'the history keeps every call');
    assert.equal(row!.unavailable_total, '3');
  });

  it('keeps the last error after a recovery, with the timestamps that date it', async () => {
    await recordCall('vehicles', 'UNAVAILABLE', { error: 'authority returned 503' });
    await recordCall('vehicles', 'FOUND', { provider: 'authority' });

    const row = await queryOne<{
      last_error: string;
      last_succeeded_at: string;
      last_unavailable_at: string;
    }>(pool, `SELECT * FROM integration_health WHERE name = 'vehicles'`);
    assert.match(row!.last_error, /503/, 'an incident review needs to know what it said');
    assert.ok(row!.last_succeeded_at > row!.last_unavailable_at, 'and that it is no longer current');
  });

  /*
   * A failure history that can be reduced is worth nothing in an incident
   * review, which is the only time anybody reads it.
   */
  it('will not let the history be reduced or deleted', async () => {
    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    await recordCall('tin', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });

    await assert.rejects(
      () => query(pool, `UPDATE integration_health SET unavailable_total = 0 WHERE name = 'tin'`),
      /do not go backwards/,
    );
    await assert.rejects(
      () => query(pool, `DELETE FROM integration_health WHERE name = 'tin'`),
      /cannot be deleted/,
    );
  });

  /*
   * Monitoring that can break the thing it monitors is monitoring that makes
   * the system worse. A taxpayer's registration must not fail because this
   * table could not be written.
   */
  it('never throws, whatever the table does', async () => {
    await query(pool, 'ALTER TABLE integration_health RENAME TO integration_health_hidden');
    try {
      await recordCall('tin', 'UNAVAILABLE', { error: 'the table is not there' });
    } finally {
      await query(pool, 'ALTER TABLE integration_health_hidden RENAME TO integration_health');
    }
  });
});

// ===========================================================================
describe('an integration that has stopped answering says so', () => {
  async function goDown(name: 'tin' | 'kyc'): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await recordCall(name, 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    }
  }

  it('raises one alert, to the administrator role', async () => {
    await goDown('tin');
    const { raised } = await sweep();
    assert.equal(raised, 1);

    const seen = await get('/government/inbox', auth());
    const rows = (seen.body as {
      notifications: { kind: string; severity: string; subject: string; addressed_to_role: string | null }[];
    }).notifications;
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0]!.kind, 'INTEGRATION_ALERT');
    assert.equal(rows[0]!.severity, 'CRITICAL');
    assert.equal(rows[0]!.addressed_to_role, 'admin');
    assert.match(rows[0]!.subject, /TIN service is not answering/);
  });

  it('says nothing about an integration that merely dropped one call', async () => {
    await recordCall('kyc', 'UNAVAILABLE', { error: 'connect ETIMEDOUT' });
    const { raised } = await sweep();
    assert.equal(raised, 0, 'a network being a network is not an alert');
  });

  it('does not raise it again while the last one is unread', async () => {
    await goDown('tin');
    await sweep();
    await sweep();
    await sweep();

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM officer_notifications WHERE kind = 'INTEGRATION_ALERT'`,
    );
    assert.equal(count!.count, '1');
  });

  it('raises it again once somebody has acknowledged it without fixing it', async () => {
    await goDown('tin');
    await sweep();
    await post('/government/inbox/read-all', {}, auth());
    await sweep();

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM officer_notifications WHERE kind = 'INTEGRATION_ALERT'`,
    );
    assert.equal(count!.count, '2');
  });

  it('tells two failing integrations apart', async () => {
    await goDown('tin');
    await goDown('kyc');
    const { raised } = await sweep();
    assert.equal(raised, 2, 'one alert each, not one for the pair');
  });
});

// ===========================================================================
describe('the platform screen shows both facts', () => {
  it('reports which adapter is configured and whether it is answering', async () => {
    await recordCall('tin', 'UNAVAILABLE', { provider: 'psirs-tin', error: 'connect ETIMEDOUT' });

    const seen = await get('/government/platform/integrations', auth());
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
    const body = seen.body as {
      tinService: string;
      integrations: { name: string; state: string; describes: string }[];
      healthy: boolean;
    };
    assert.ok(body.tinService, 'which adapter is configured');
    const tin = body.integrations.find((one) => one.name === 'tin');
    assert.equal(tin!.state, 'DEGRADED', 'and whether it answered');
    assert.equal(tin!.describes, 'The PSIRS TIN service', 'in words a person reads');
  });
});
