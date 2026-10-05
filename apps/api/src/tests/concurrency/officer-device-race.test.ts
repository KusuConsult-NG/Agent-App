/**
 * Two sign-ins from one computer, arriving together.
 *
 * `deviceForSignIn` used to look for the officer's device row, then insert one
 * if it found none. Between those two statements sits a unique constraint --
 * `UNIQUE (user_id, fingerprint)` on `officer_devices` -- and two requests
 * that both miss the lookup both insert. One wins. The other gets a 23505 and
 * the officer gets a 500 from the one screen whose job is to let them in.
 *
 * It needs no adversary and no unusual deployment: an officer double-clicking
 * sign-in, or two tabs restoring a session at once, is enough. And it heals on
 * a retry, because by then the row exists -- which is why a fault like this
 * gets reported as "it did something odd once" and never fixed.
 *
 * These call the service directly rather than through HTTP, the way the
 * payment race beside them does, because the contention is between two
 * database transactions and an HTTP client would only make the window harder
 * to hit.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, pool, resetDatabase } from '../helpers';
import { query } from '../../db/pool';
import { withTransaction } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { runMigrations } from '../../db/migrate';
import { deviceForSignIn, fingerprintOf } from '../../services/officer-devices';

const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0';
const DEVICE = 'portal-one-computer-0001';

let officerId = '';

before(async () => {
  await runMigrations();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Race Officer',
    phone: '+2348083000001',
    role: 'revenue_officer',
  });
});

/** One sign-in's worth of device resolution, in its own transaction. */
const resolve = (deviceId: string | null = DEVICE) =>
  withTransaction((client) =>
    deviceForSignIn(client, { userId: officerId, userAgent: UA, clientDeviceId: deviceId }),
  );

async function rowsFor(handle: string) {
  return query<{ id: string }>(
    pool,
    'SELECT id FROM officer_devices WHERE user_id = $1 AND fingerprint = $2',
    [officerId, handle],
  );
}

describe('one computer, two sign-ins at once', () => {
  it('gives both the same device and neither an error', async () => {
    const results = await Promise.allSettled([resolve(), resolve()]);

    const refused = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason));
    assert.deepEqual(refused, [], 'a sign-in failed because another arrived at the same time');

    const ids = new Set(
      results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value),
    );
    assert.equal(ids.size, 1, 'one computer became two devices: ' + JSON.stringify([...ids]));
    assert.equal((await rowsFor(fingerprintOf(null, DEVICE))).length, 1);
  });

  it('holds when sixteen arrive together', async () => {
    // The two-request case can pass by luck. Sixteen does not.
    const results = await Promise.allSettled(Array.from({ length: 16 }, () => resolve()));

    const refused = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason));
    assert.deepEqual(refused, [], 'concurrent sign-ins from one computer were refused');
    assert.equal((await rowsFor(fingerprintOf(null, DEVICE))).length, 1);
  });

  it('still gives two computers two devices when both arrive together', async () => {
    // The fix must not have been bought by merging everything into one row.
    const results = await Promise.allSettled([
      resolve('portal-desktop-000001'),
      resolve('portal-laptop-0000001'),
    ]);

    assert.deepEqual(
      results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)),
      [],
    );
    assert.equal((await rowsFor(fingerprintOf(null, 'portal-desktop-000001'))).length, 1);
    assert.equal((await rowsFor(fingerprintOf(null, 'portal-laptop-0000001'))).length, 1);
  });

  it('holds for a client that sends no identifier at all', async () => {
    // Private browsing, or storage blocked: the handle is the user agent, and
    // two of those arriving together race over the same row just as readily.
    const results = await Promise.allSettled([resolve(null), resolve(null), resolve(null)]);

    assert.deepEqual(
      results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)),
      [],
    );
    assert.equal((await rowsFor(fingerprintOf(UA, null))).length, 1);
  });
});
