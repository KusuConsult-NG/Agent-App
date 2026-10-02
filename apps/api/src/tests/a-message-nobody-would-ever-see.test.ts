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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import {
  OVERLAP_CONSTRAINT_MESSAGES,
  UNIQUE_CONSTRAINT_MESSAGES,
  UNIQUE_CONSTRAINT_NOT_SHOWN,
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

/**
 * Every unique index the live schema declares, excluding primary keys.
 *
 * Primary keys are left out, and it is worth saying why rather than leaving it
 * to be inferred: every one of them is a `uuid` with a `gen_random_uuid()`
 * default, so a violation is a collision in a random number and not something
 * anybody did. A message for it would be a message about an impossibility.
 */
async function liveUniqueIndexes(): Promise<string[]> {
  const rows = await query<{ relname: string }>(
    pool,
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE i.indisunique AND n.nspname = 'public'
        AND NOT i.indisprimary
      ORDER BY 1`,
  );
  return rows.map((row) => row.relname);
}

describe('a constraint nobody classified', () => {
  /*
   * The check that makes the figures in `error-handler.ts` countable.
   *
   * That file carried a sentence saying twelve named constraints fell back to
   * the generic duplicate message. There were seventy-one. It was wrong by a
   * factor of six for the same reason the "twenty-six refusals" figure in the
   * Hausa review was wrong by a factor of six: both were read off the code
   * rather than counted against the schema, and nothing could tell.
   *
   * So every unique index now has to be in one of two places — a message a
   * person can act on, or a written reason it will never be shown to one. A
   * new index is in neither until somebody decides, and this says so by name.
   */
  it('has a message or a written reason for every unique index in the schema', async () => {
    const live = await liveUniqueIndexes();
    assert.ok(
      live.length > 70,
      `only ${live.length} unique indexes found; the schema query is not working`,
    );

    const unclassified = live.filter(
      (name) => !(name in UNIQUE_CONSTRAINT_MESSAGES) && !(name in UNIQUE_CONSTRAINT_NOT_SHOWN),
    );
    assert.deepEqual(
      unclassified,
      [],
      'these unique indexes are in neither map, so a person colliding with one is told ' +
        '"that record already exists" and nothing more. Give each a message, or a reason ' +
        'in UNIQUE_CONSTRAINT_NOT_SHOWN saying who it is not shown to and why',
    );
  });

  it('does not both answer for a constraint and excuse it', async () => {
    const both = Object.keys(UNIQUE_CONSTRAINT_MESSAGES)
      .filter((name) => name in UNIQUE_CONSTRAINT_NOT_SHOWN)
      .sort();
    assert.deepEqual(
      both,
      [],
      'these have a message and a reason for having none. One of the two is wrong, and ' +
        'which one is a decision somebody has to make rather than a thing to leave ambiguous',
    );
  });

  it('keeps no reason for a constraint the schema does not have', async () => {
    const live = new Set(await liveUniqueIndexes());
    assert.deepEqual(
      Object.keys(UNIQUE_CONSTRAINT_NOT_SHOWN)
        .filter((name) => !live.has(name))
        .sort(),
      [],
      'these are excused and do not exist. A reason outliving its constraint is a reason ' +
        'for nothing, and it misleads the next person about what the schema enforces',
    );
  });

  /*
   * And that every reason says which kind it is.
   *
   * The four words carry the whole argument: ABSORBED means the constraint
   * cannot raise, SEEDED means no request reaches the table, GENERATED means a
   * clash is the platform's fault rather than the person's, and INTERNAL means
   * no person is involved. A reason with none of them is prose nobody can
   * check, and the GENERATED group in particular is a recorded decision to
   * leave something imperfect — the caller is told "that record already
   * exists" about a fault in a reference generator — which has to stay
   * visible rather than dissolve into a paragraph.
   */
  it('says which kind of reason each one is', () => {
    const KINDS = ['ABSORBED', 'SEEDED', 'GENERATED', 'INTERNAL'];
    const vague = Object.entries(UNIQUE_CONSTRAINT_NOT_SHOWN)
      .filter(([, reason]) => !KINDS.some((kind) => reason.startsWith(kind)))
      .map(([name]) => name)
      .sort();
    assert.deepEqual(vague, [], `each reason has to begin with one of ${KINDS.join(', ')}`);
  });
});

/*
 * One of the new messages, end to end, through the route an officer uses.
 *
 * The spelling checks above hold the keys against the schema and the schema
 * against the keys, which is the cheap half. This is the expensive half for one
 * of them: a revenue item created with a code that already belongs to a charge.
 * It is worth being the one chosen because the code appears on receipts and in
 * reports, so the clash is the single field the officer has to change — and the
 * generic sentence named none of the eleven fields on that form.
 */
describe('an officer naming a levy that already exists', () => {
  const ADMIN = { fullName: 'Catalogue Admin', phone: '+2348078300001', role: 'admin' } as const;
  let token = '';
  let categoryId = '';

  beforeEach(async () => {
    await resetDatabase();
    await seedReferenceData();
    await createGovernmentUser(ADMIN);
    token = (await loginAs(ADMIN.phone)).accessToken;
    const category = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM revenue_categories ORDER BY code LIMIT 1',
    );
    categoryId = category!.id;
  });

  it('says which field clashed, not that a record exists', async () => {
    const body = (code: string) => ({
      categoryId,
      code,
      name: 'A levy for the test',
    });

    const first = await post('/revenue/items', body('TEST-LEVY-01'), { token });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await post('/revenue/items', body('TEST-LEVY-01'), { token });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error.code, 'DUPLICATE_RECORD');
    assert.match(
      second.body.error.message,
      /already uses that code/,
      'the officer has eleven fields in front of them and is entitled to know it is the code',
    );
    assert.equal(second.body.error.moneyStatus, 'NOT_DEBITED');

    // And the first item is still the only one with that code.
    const rows = await query<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM revenue_items WHERE code = 'TEST-LEVY-01'",
    );
    assert.equal(rows[0]!.n, '1', 'no duplicate was created, which the message also says');
  });
});
