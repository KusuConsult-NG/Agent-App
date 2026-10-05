/**
 * Two syncs of one capture, arriving together.
 *
 * `/drafts/sync` reads a draft by `(agent_id, client_reference)` and then
 * inserts, and `offline_drafts` carries `UNIQUE` on exactly that pair. Two
 * requests carrying the same draft both miss the lookup and both insert. One
 * wins.
 *
 * The loser's 23505 is not an `AppError`, so it fell to the `else` in the
 * per-draft catch and came back as DRAFT_NOT_PROCESSED. `syncDrafts` keeps a
 * REJECTED draft on the phone with that message against it -- so an agent was
 * shown a refusal for a capture the other request had just turned into a
 * taxpayer. The obvious thing to do about a refused registration is to key it
 * in again, and `Taxpayers.tsx` mints a fresh idempotency key per attempt, so
 * nothing would have deduplicated that against the draft already synced. The
 * cost of the race is a duplicate taxpayer, arrived at through a false
 * refusal.
 *
 * It needs nothing unusual to happen. `syncDrafts` has no in-flight guard, and
 * two things ask it to run: the connectivity effect in `App.tsx`, and -- now
 * that the worker's message has a receiver -- background sync.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { seedDemoAgent } from '../../db/seed-agent';

const REFERENCE = 'offline-draft-raced-01';
const TAXPAYER_PHONE = '+2347044000091';

let token = '';
let deviceId = '';
let lgaId = '';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  // `seedDemoAgent` returns null without an administrator to approve the agent.
  await createGovernmentUser({
    fullName: 'Draft Admin',
    phone: '+2348085000001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent did not seed');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  token = session.accessToken;
  deviceId = demo!.deviceIdentifier;
  lgaId = await firstLgaId();
});

/** One sync request carrying the same capture every time. */
const sync = () =>
  post(
    '/drafts/sync',
    {
      drafts: [
        {
          clientReference: REFERENCE,
          draftType: 'TAXPAYER_REGISTRATION',
          capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
          payload: {
            taxpayerType: 'INDIVIDUAL',
            firstName: 'Ladi',
            lastName: 'Dung',
            phone: TAXPAYER_PHONE,
            address: 'Village square, Kuru',
            lgaId,
            consentGiven: true,
            declarationAccepted: true,
          },
        },
      ],
    },
    { token, deviceId },
  );

type Result = { clientReference: string; status: string; code?: string; message: string };

const resultsOf = (responses: { status: number; body: Record<string, unknown> }[]): Result[] =>
  responses.flatMap((response) => (response.body.results as Result[] | undefined) ?? []);

async function taxpayerCount(): Promise<number> {
  const rows = await query<{ id: string }>(pool, 'SELECT id FROM taxpayers WHERE phone = $1', [
    TAXPAYER_PHONE,
  ]);
  return rows.length;
}

async function draftRows(): Promise<{ status: string }[]> {
  return query<{ status: string }>(
    pool,
    'SELECT status FROM offline_drafts WHERE client_reference = $1',
    [REFERENCE],
  );
}

describe('one capture, two syncs at once', () => {
  it('tells neither of them the capture was refused', async () => {
    const responses = await Promise.all([sync(), sync()]);

    for (const response of responses) {
      assert.equal(response.status, 200, JSON.stringify(response.body));
    }
    const refused = resultsOf(responses).filter((result) => result.status === 'REJECTED');
    assert.deepEqual(
      refused,
      [],
      'a sync was told the capture was refused while the other was registering it',
    );
  });

  it('registers the taxpayer once, and says so once', async () => {
    const responses = await Promise.all([sync(), sync()]);

    assert.equal(await taxpayerCount(), 1, 'the capture produced more than one taxpayer');
    const synced = resultsOf(responses).filter((result) => result.status === 'SYNCED');
    assert.equal(synced.length, 1, JSON.stringify(resultsOf(responses)));
    assert.equal((await draftRows()).length, 1, 'more than one draft row for one reference');
  });

  it('holds when eight arrive together', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => sync()));

    for (const response of responses) {
      assert.equal(response.status, 200, JSON.stringify(response.body));
    }
    assert.deepEqual(
      resultsOf(responses).filter((result) => result.status === 'REJECTED'),
      [],
    );
    assert.equal(await taxpayerCount(), 1);
    assert.equal((await draftRows()).length, 1);
  });

  it('leaves an unanswered draft alone rather than refusing it', async () => {
    /*
     * The honest answer when the winner is still in flight is nothing at all:
     * its outcome is unknown, and claiming DUPLICATE would let the phone drop
     * a capture that may yet fail. `syncDrafts` acts only on the results it is
     * given and `pendingDrafts` re-offers anything still PENDING_SYNC, so a
     * draft left out of the answer is simply sent again.
     *
     * So every result that does come back is one of the three the phone knows
     * what to do with, and the count may be short of the number of requests.
     */
    const responses = await Promise.all([sync(), sync(), sync()]);
    const results = resultsOf(responses);

    for (const result of results) {
      assert.ok(
        ['SYNCED', 'DUPLICATE', 'REJECTED'].includes(result.status),
        `the phone has no handling for status ${result.status}`,
      );
    }
    assert.ok(results.length >= 1, 'no request said anything about the capture');
    assert.ok(results.length <= 3);
  });

  it('still refuses when the number belongs to somebody else', async () => {
    /*
     * The other meaning of the same database error, which must not be
     * swallowed as a duplicate.
     *
     * The mock TIN service derives a TIN from `type|name|phone`, so the number
     * this capture will be assigned is computable. Given to a DIFFERENT
     * taxpayer first — different name, different phone, so the duplicate
     * control has nothing to match — the sync fails on `taxpayers_tin_key`
     * with nobody registered under this capture's phone. That is permanent,
     * and the agent has to be told rather than left retrying for ever.
     */
    const TIN = '214798901';
    const other = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers
         (taxpayer_type, first_name, last_name, phone, address, lga_id, tin, tin_status)
       VALUES ('INDIVIDUAL','Someone','Else','+2347044000777','Elsewhere',$1,$2,'ASSIGNED')
       RETURNING id`,
      [lgaId, TIN],
    );
    assert.ok(other, 'the fixture taxpayer was not created');

    const response = await sync();

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const result = (response.body.results as Result[])[0]!;
    assert.equal(
      result.status,
      'REJECTED',
      'a permanent TIN conflict was reported as something the phone can drop: ' +
        JSON.stringify(result),
    );
    assert.equal(await taxpayerCount(), 0, 'the capture must not have produced a taxpayer');
  });

  it('still tells a later sync it was already done', async () => {
    // The sequential path, which was always right and must stay so.
    const first = await sync();
    assert.equal((first.body.results as Result[])[0]!.status, 'SYNCED');

    const again = await sync();

    assert.equal((again.body.results as Result[])[0]!.status, 'DUPLICATE');
    assert.equal(await taxpayerCount(), 1);
  });
});
