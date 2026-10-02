/**
 * The constraint messages, held to the constraints they are keyed to.
 *
 * When PostgreSQL refuses a write for a unique or an overlap rule, the error
 * handler looks the constraint's name up in a map and answers with a sentence
 * the person can act on: which field clashed, what to do about it. A name that
 * is not in the map falls back to "That record already exists. No duplicate
 * has been created." — true, reassuring about the duplicate, and naming
 * nothing.
 *
 * So the map's keys are strings compared against `error.constraint`, and that
 * is the whole of the coupling. Rename an index in a migration, or mistype a
 * key here, and nothing breaks: the lookup misses, the fallback answers, and
 * the specific sentence somebody wrote is a message nobody will ever see. No
 * test fails, because the request still gets a correct 409.
 *
 * This holds every key in both maps to the names the live schema has. It is
 * the cheap half. The expensive half — and the one that proves the path end to
 * end rather than the spelling — is the staff number at the bottom: two
 * officers given the same one, through the route an administrator actually
 * uses, asserting the refusal carries the specific sentence and not the
 * generic one.
 *
 * WHY THE TWO MAPS ARE CHECKED AGAINST DIFFERENT CATALOGUES
 *
 * A unique violation (23505) names an *index*, which is where a `UNIQUE`
 * constraint, a primary key and a bare `CREATE UNIQUE INDEX` all end up — and
 * eleven of these keys are partial indexes, which can only be written the
 * third way. An overlap violation (23P01) names a *constraint*, of type `x`.
 * Checking each map against its own catalogue also catches a key filed in the
 * wrong map, which a single combined query would not: an exclusion constraint
 * has a backing index of the same name, so it would satisfy both.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import {
  OVERLAP_CONSTRAINT_MESSAGES,
  UNIQUE_CONSTRAINT_MESSAGES,
} from '../middleware/error-handler';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

describe('a message nobody would ever see', () => {
  it('has no unique-constraint key that the schema does not have', async () => {
    const keys = Object.keys(UNIQUE_CONSTRAINT_MESSAGES);
    // A floor, not a count. The check below passes for free on an empty map,
    // so the import has to be shown to have worked; but pinning it to today's
    // eighteen would make legitimately dropping an index a test edit, which is
    // a different claim than the one this test is making.
    assert.ok(keys.length >= 10, `only ${keys.length} unique-constraint messages were imported`);

    const live = await query<{ relname: string }>(
      pool,
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_index i ON i.indexrelid = c.oid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE i.indisunique AND n.nspname = 'public'`,
    );
    const names = new Set(live.map((row) => row.relname));
    assert.ok(names.size > 100, `only ${names.size} unique indexes found; did the query change?`);

    assert.deepEqual(
      keys.filter((key) => !names.has(key)),
      [],
      'these keys name no unique index in the live schema, so the sentence written for each ' +
        'of them is dead and the caller gets the generic duplicate line instead',
    );
  });

  it('has no overlap-constraint key that the schema does not have', async () => {
    // No floor here: the two directions below pin the key set to the live set
    // exactly, so an empty import fails on the second of them.
    const keys = Object.keys(OVERLAP_CONSTRAINT_MESSAGES);

    const live = await query<{ conname: string }>(
      pool,
      `SELECT conname FROM pg_constraint WHERE contype = 'x'`,
    );
    const names = new Set(live.map((row) => row.conname));

    assert.deepEqual(
      keys.filter((key) => !names.has(key)),
      [],
      'these keys name no exclusion constraint in the live schema',
    );

    // And the other direction, which is small enough here to be worth holding:
    // every overlap constraint the schema has should have words, because the
    // generic overlap sentence does not say to end-date the current row and
    // that is the whole of what the officer needs to do next.
    assert.deepEqual(
      [...names].filter((name) => !(name in OVERLAP_CONSTRAINT_MESSAGES)).sort(),
      [],
      'these overlap constraints can fire and have no sentence of their own',
    );
  });
});

describe('two officers, one staff number', () => {
  const ONE = { fullName: 'Staff Number One', phone: '+2348076100001', role: 'admin' } as const;
  const TWO = { fullName: 'Staff Number Two', phone: '+2348076100002', role: 'finance_officer' };

  let adminToken = '';
  let firstId = '';
  let secondId = '';

  beforeEach(async () => {
    await resetDatabase();
    await seedReferenceData();
    firstId = await createGovernmentUser(ONE);
    secondId = await createGovernmentUser(TWO);
    adminToken = (await loginAs(ONE.phone)).accessToken;
  });

  it('tells the administrator which of the three identifiers clashed', async () => {
    const posting = (userId: string, staffNumber: string) =>
      post(
        `/government/users/${userId}/posting`,
        { staffNumber, reason: 'Issuing the service staff number.' },
        { token: adminToken },
      );

    const first = await posting(firstId, 'PS/2026/0417');
    assert.equal(first.status, 200, JSON.stringify(first.body));

    const second = await posting(secondId, 'PS/2026/0417');
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error.code, 'DUPLICATE_RECORD');
    assert.equal(
      second.body.error.message,
      'That staff number already belongs to another officer.',
      'the administrator was told a record exists without being told which of the ' +
        "officer's three identifiers — phone, email, staff number — it was",
    );
    assert.equal(second.body.error.moneyStatus, 'NOT_DEBITED');

    // And the second officer kept the staff number they had, which was none.
    const after = await query<{ staff_number: string | null }>(
      pool,
      'SELECT staff_number FROM users WHERE id = $1',
      [secondId],
    );
    assert.equal(after[0]!.staff_number, null, 'the refused write changed nothing');
  });

  /*
   * Most officers have no staff number, and they must not collide with each
   * other.
   *
   * The index gets this right twice over: it is partial on
   * `staff_number IS NOT NULL`, and PostgreSQL treats nulls as distinct in a
   * unique index anyway. So dropping the `WHERE` clause would change nothing
   * here — the mutation that breaks it is `NULLS NOT DISTINCT`, four
   * characters of a migration that reads as a tightening and would leave every
   * officer after the first unpostable until somebody issued them a number.
   */
  it('lets any number of officers have no staff number at all', async () => {
    for (const userId of [firstId, secondId]) {
      const moved = await post(
        `/government/users/${userId}/posting`,
        { staffNumber: null, reason: 'No staff number has been issued yet.' },
        { token: adminToken },
      );
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
    }
  });
});
