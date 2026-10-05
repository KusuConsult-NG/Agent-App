/**
 * Two read-then-insert pairs whose pre-check lost to the database.
 *
 * Both have the same shape, and it is the shape the vehicle capture had: read a
 * table for a value, refuse if it is there, insert if it is not. A plain SELECT
 * takes no lock and the row being looked for does not exist yet, so two callers
 * both find nothing, both insert, and the second meets a unique index instead
 * of the sentence the pre-check would have given it.
 *
 * They were found by sweeping for the pattern rather than by noticing them:
 * every `SELECT ... WHERE <column> = $n` followed by an `INSERT` into the same
 * table, with no `FOR UPDATE` between them and no `ON CONFLICT` after. That
 * found sixteen pairs, of which three were real — the other thirteen either
 * have no unique index on the column read, or take `FOR UPDATE` in a form the
 * pattern did not see. A ratio of three in sixteen is why this is a sweep
 * recorded in a commit message and not a check in the suite: a guard that
 * cries wolf thirteen times is deleted by the third person it interrupts.
 *
 * The third was `submitKyc`, which has its own file because the comment above
 * it claimed to be safe already.
 *
 * WHAT IS AT STAKE IN EACH
 *
 * An applicant tapping Apply twice got "This phone number is already
 * registered" from the duplicate handler rather than `PHONE_ALREADY_REGISTERED`
 * from the pre-check. The remedy is the same — sign in instead — but only one
 * of the two sentences can be said in Hausa, and it is not the one they got.
 *
 * Two administrators creating a department with one code got the generic
 * duplicate sentence rather than `DEPARTMENT_EXISTS`, which names the code back
 * to them.
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
import { queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';

let adminToken = '';
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
  await createGovernmentUser({
    fullName: 'Race Admin',
    phone: '+2348089100001',
    role: 'admin',
  });
  adminToken = (await loginAs('+2348089100001')).accessToken;
  lgaId = await firstLgaId();
});

describe('two applications against one phone number', () => {
  const PHONE = '+2348089109999';

  const apply = (accountNumber: string) =>
    post('/agents/apply', {
      fullName: 'Double Tap',
      phone: PHONE,
      password: 'FieldAgent2026',
      address: '4 Rukuba Road, Jos',
      lgaId,
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Double Tap',
      accountNumber,
    });

  it('answers the second with the pre-check, not the duplicate handler', async () => {
    const [first, second] = await Promise.all([apply('0123456801'), apply('0123456802')]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify([first.body, second.body]));

    const refused = first.status === 409 ? first : second;
    assert.equal(
      refused.body.error.code,
      'PHONE_ALREADY_REGISTERED',
      'DUPLICATE_RECORD here means the pre-check lost to `users_phone_key`, and the ' +
        'applicant was told by the duplicate handler instead — in English, because that ' +
        'is the one of the two sentences the agent application cannot translate',
    );
    assert.match(refused.body.error.message, /[Ss]ign in/, 'and it says what to do instead');
  });

  it('creates exactly one account', async () => {
    await Promise.all([apply('0123456803'), apply('0123456804')]);
    const users = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM users WHERE phone = $1',
      [PHONE],
    );
    assert.equal(users!.n, '1');
  });
});

describe('two departments created with one code', () => {
  const create = (name: string) =>
    post(
      '/government/departments',
      { code: 'RACE', name, function: 'FINANCE' },
      { token: adminToken },
    );

  it('answers the second with the pre-check, not the duplicate handler', async () => {
    const [first, second] = await Promise.all([create('Finance One'), create('Finance Two')]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify([first.body, second.body]));

    const refused = first.status === 409 ? first : second;
    assert.equal(
      refused.body.error.code,
      'DEPARTMENT_EXISTS',
      'DUPLICATE_RECORD here means `departments_code_key` answered instead of the ' +
        'pre-check, which names the code back to the administrator',
    );
    assert.match(refused.body.error.message, /RACE/, 'and it names the code');
  });

  it('creates exactly one department', async () => {
    await Promise.all([create('Finance One'), create('Finance Two')]);
    const departments = await queryOne<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM departments WHERE code = 'RACE'",
    );
    assert.equal(departments!.n, '1');
  });
});
