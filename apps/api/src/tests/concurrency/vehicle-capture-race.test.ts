/**
 * Two agents capturing one vehicle at the same moment.
 *
 * `upsertVehicle` reads the plate and then either updates the row it found or
 * inserts a new one. That is a merge when one caller does it and a race when
 * two do: a plain SELECT takes no lock, and a vehicle nobody has captured yet
 * has no row to lock. So both callers found nothing, both inserted, and the
 * second was refused by `vehicles_registration_number_key`.
 *
 * THE REFUSAL IS THE SMALLER HALF
 *
 * The capture it refused was meant to be a merge. The whole point of the branch
 * above the insert is to fold a second sighting into the record rather than
 * reject it — the owner's phone, the expiry the registry returned, the
 * authority reference. The loser's details went on the floor with the request,
 * and the agent was told a vehicle with that number already exists, which is
 * both true and not what they needed to happen.
 *
 * Two agents at one motor park is not an unusual Tuesday. The same window is
 * open between a live capture and an offline draft syncing the same plate, and
 * `/drafts/sync` reaches this function too.
 *
 * WHAT THESE ASSERT. One row, both callers answered, and the second call's
 * details present on the row — which is what distinguishes a merge from a
 * refusal that happened to leave the first capture intact.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { upsertVehicle } from '../../services/vehicles';

const PLATE = 'PL999RACE';
let officerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Vehicle Race Officer',
    phone: '+2348087100001',
    role: 'revenue_officer',
  });
});

/** One capture, as either agent would make it. */
function capture(ownerPhone: string, ownerName: string) {
  return upsertVehicle({
    input: {
      registrationNumber: PLATE,
      vehicleType: 'COMMERCIAL',
      ownerName,
      ownerPhone,
    } as never,
    actorId: officerId,
    actorRole: 'revenue_officer',
  });
}

async function rows(): Promise<{ id: string; owner_phone: string | null }[]> {
  return query<{ id: string; owner_phone: string | null }>(
    pool,
    'SELECT id, owner_phone FROM vehicles WHERE registration_number = $1',
    [PLATE],
  );
}

describe('two agents capturing one vehicle', () => {
  it('records it once and refuses neither of them', async () => {
    const [a, b] = await Promise.allSettled([
      capture('+2348012345678', 'Zainab Pam'),
      capture('+2348087654321', 'Zainab Pam'),
    ]);

    const rejected = [a, b].filter((r) => r.status === 'rejected');
    assert.deepEqual(
      rejected.map((r) => String((r as PromiseRejectedResult).reason)),
      [],
      'a second sighting of the same vehicle is a merge, not a duplicate. A refusal here ' +
        "means the advisory lock has stopped ordering the two captures and the second " +
        "agent's details were dropped with their request",
    );

    const found = await rows();
    assert.equal(found.length, 1, 'one vehicle, one row');
  });

  /*
   * The merge the race was destroying, asserted where it can be asserted.
   *
   * Not concurrently: with the lock in place the two captures are ordered but
   * which one goes second is the scheduler's business, and `COALESCE` means the
   * later phone wins — so a concurrent assertion about WHICH number survives
   * would be asserting the scheduler. The first version of this test did assert
   * concurrently, that the row had *a* phone, and the mutation check showed it
   * passed with the lock removed: one insert still succeeds and still writes a
   * number. A test that passes either way is not holding anything.
   *
   * So the merge is held sequentially, which is deterministic, and the
   * concurrent tests hold what concurrency can decide: one row, nobody refused,
   * one audit entry.
   */
  it('folds a second sighting into the record rather than rejecting it', async () => {
    const first = await capture('+2348012345678', 'Zainab Pam');
    const second = await capture('+2348087654321', 'Zainab Pam');

    assert.equal(second.vehicleId, first.vehicleId, 'the same vehicle, not a second one');

    const found = await rows();
    assert.equal(found.length, 1);
    assert.equal(
      found[0]!.owner_phone,
      '+2348087654321',
      'the second capture\u2019s detail is on the record — which is what the race destroyed: ' +
        'the loser was refused and their number went on the floor with the request',
    );

    const audited = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_logs
        WHERE action = 'vehicle.captured' AND entity_type = 'vehicle'`,
    );
    assert.equal(audited!.n, '1', 'and a merge is not a capture, so only the first is recorded');
  });

  it('answers both callers with the same vehicle', async () => {
    const [a, b] = await Promise.all([
      capture('+2348012345678', 'Zainab Pam'),
      capture('+2348087654321', 'Zainab Pam'),
    ]);
    assert.equal(a.vehicleId, b.vehicleId, 'two agents looking at one vehicle, one record');
  });

  /*
   * And sixteen at once, well past the pool size.
   *
   * A lock that orders two callers and deadlocks sixteen would pass everything
   * above. The number is deliberately larger than the connection pool, which is
   * where the handset registration race in `9cdc684` stopped working at all.
   */
  it('holds when sixteen arrive together', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => capture(`+23480123456${10 + i}`, 'Zainab Pam')),
    );
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.deepEqual(
      rejected.map((r) => String((r as PromiseRejectedResult).reason)),
      [],
      'none of the sixteen is refused',
    );
    assert.equal((await rows()).length, 1);

    const audited = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_logs
        WHERE action = 'vehicle.captured' AND entity_type = 'vehicle'`,
    );
    assert.equal(
      audited!.n,
      '1',
      'and exactly one of them recorded a capture, because fifteen were merges',
    );
  });
});
