/**
 * Registering one handset twice, at once.
 *
 * `registerDevice` counted the agent's existing devices, then inserted one.
 * `agent_devices` carries `UNIQUE (agent_id, device_identifier)`, so two
 * requests that both pass the count both insert: one wins, the other gets a
 * 23505, and the agent is shown a failure for something that in fact
 * succeeded -- on the screen that decides whether they can collect at all.
 *
 * It takes no adversary. A button on a bad connection, tapped twice, or
 * tapped once and retried by the app, is the whole of it.
 *
 * What a retry must NOT do is leave two records of one event. The agent
 * journal is the account of what happened to a handset, read by whoever is
 * deciding whether to trust it, so a second DEVICE_REGISTERED line against
 * the same handset would be a record of something that never happened. That
 * is why the conflict does nothing rather than updating, and why the count of
 * journal lines is asserted here and not only the count of rows.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, pool, resetDatabase } from '../helpers';
import { query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { seedDemoAgent } from '../../db/seed-agent';
import { runMigrations } from '../../db/migrate';
import { registerDevice } from '../../services/agents';

const REPLACEMENT = 'pwa-replacement-handset-01';

let agentId = '';
let userId = '';

before(async () => {
  await runMigrations();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  /*
   * An administrator first: `seedDemoAgent` needs one to approve the agent it
   * creates and returns null without it, which is how this fixture failed the
   * first time it ran.
   */
  await createGovernmentUser({
    fullName: 'Handset Admin',
    phone: '+2348084000001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent did not seed');
  agentId = demo!.agentId;
  const owner = await queryOne<{ user_id: string }>(
    pool,
    'SELECT user_id FROM agents WHERE id = $1',
    [agentId],
  );
  userId = owner!.user_id;
});

/** One registration request's worth of work. */
const register = (identifier = REPLACEMENT) =>
  registerDevice({ agentId, deviceIdentifier: identifier, actorId: userId });

async function rowsFor(identifier: string) {
  return query<{ id: string; status: string }>(
    pool,
    'SELECT id, status FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
    [agentId, identifier],
  );
}

async function journalLinesFor(identifier: string) {
  return query<{ id: string }>(
    pool,
    `SELECT id FROM agent_clearance_events
      WHERE agent_id = $1 AND event_type = 'DEVICE_REGISTERED'
        AND metadata->>'deviceIdentifier' = $2`,
    [agentId, identifier],
  );
}

describe('one handset, registered twice at once', () => {
  it('gives both the same device and neither an error', async () => {
    const results = await Promise.allSettled([register(), register()]);

    const refused = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason));
    assert.deepEqual(refused, [], 'a registration failed because another arrived at once');

    const ids = new Set(
      results
        .filter(
          (r): r is PromiseFulfilledResult<{ deviceId: string; status: string }> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value.deviceId),
    );
    assert.equal(ids.size, 1, 'one handset became two devices: ' + JSON.stringify([...ids]));
    assert.equal((await rowsFor(REPLACEMENT)).length, 1);
  });

  it('leaves one line in the journal, not two', async () => {
    await Promise.allSettled([register(), register()]);

    const lines = await journalLinesFor(REPLACEMENT);
    assert.equal(
      lines.length,
      1,
      'the retry was written into the agent journal as a second registration, ' +
        'which is a record of something that never happened',
    );
  });

  it('holds when eight arrive together', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => register()));

    assert.deepEqual(
      results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)),
      [],
    );
    assert.equal((await rowsFor(REPLACEMENT)).length, 1);
    assert.equal((await journalLinesFor(REPLACEMENT)).length, 1);
  });

  it('still registers two different handsets as two devices', async () => {
    // The fix must not have been bought by collapsing distinct handsets.
    const results = await Promise.allSettled([
      register('pwa-handset-alpha-00001'),
      register('pwa-handset-bravo-00001'),
    ]);

    assert.deepEqual(
      results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)),
      [],
    );
    assert.equal((await rowsFor('pwa-handset-alpha-00001')).length, 1);
    assert.equal((await rowsFor('pwa-handset-bravo-00001')).length, 1);
  });

  it('still returns the same device when the same handset registers again', async () => {
    /*
     * Sequential re-registration was never broken: the `if (existing)` branch
     * in `registerDevice` returns the row untouched and writes no journal
     * line. This pins it, because the conflict handler added for the race
     * has to behave the same way and an earlier draft of this file asserted
     * the opposite.
     */
    const first = await register();
    const again = await register();

    assert.equal(again.deviceId, first.deviceId);
    assert.equal(again.status, first.status);
    assert.equal((await journalLinesFor(REPLACEMENT)).length, 1);
  });

  it('still refuses a revoked handset rather than returning it', async () => {
    // The guard above the insert, and now also on the conflict path, so the
    // two cannot disagree about whether a revoked handset may come back.
    const first = await register();
    await query(pool, `UPDATE agent_devices SET status = 'REVOKED' WHERE id = $1`, [
      first.deviceId,
    ]);

    await assert.rejects(() => register(), /revoked and cannot be registered again/);
  });
});
