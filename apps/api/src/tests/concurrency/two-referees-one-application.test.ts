/**
 * Two referee nominations for one application, at the same moment.
 *
 * One referee at a time is a control, not a convenience. `nominateReferee`
 * reads `referees` for any row in an active state and refuses
 * `REFEREE_ALREADY_NOMINATED` if it finds one; replacing a referee is a
 * deliberate, recorded act — the old row is marked REPLACED and linked, by
 * PRD §29 — rather than a second invitation sent beside the first.
 *
 * That read takes no lock, and the row it looks for does not exist yet. Two
 * nominations submitted together both find nothing and both insert, so an
 * applicant ends up with two outstanding invitations and no record of a
 * replacement.
 *
 * WHY IT IS WORTH A LOCK
 *
 * The check immediately above this one is about an applicant answering their
 * own reference, and its comment says what that costs: "nominate a referee on
 * the alternate number, and the invitation goes to a handset the applicant is
 * holding, so they answer their own reference." Two invitations in flight is
 * two attempts at clearance from one nomination slot, and whichever clears
 * first satisfies the application. The one-at-a-time rule is what makes the
 * applicant choose.
 *
 * Nothing in the schema held the rule either: `referees` had indexes on
 * `agent_id` and on `status` and no uniqueness over the pair. Migration 080's
 * header is the principle — "a rule the service enforces and the database does
 * not is one UPDATE away from being undone" — so 087 writes it down and the
 * advisory lock is what lets the service keep answering by name.
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

const ACTIVE = ['INVITED', 'ACCEPTED', 'SUBMITTED', 'UNDER_REVIEW', 'CLEARED'];
let applicantToken = '';
let agentId = '';

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
    fullName: 'Referee Race Admin',
    phone: '+2348089700001',
    role: 'admin',
  });

  const phone = '+2348089701111';
  const application = await post('/agents/apply', {
    fullName: 'Referee Race Subject',
    phone,
    password: 'FieldAgent2026',
    address: '9 Yakubu Gowon Way, Jos',
    lgaId: await firstLgaId(),
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: 'Referee Race Subject',
    accountNumber: '0223456799',
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  agentId = application.body.agentId;
  applicantToken = (await loginAs(phone, 'FieldAgent2026')).accessToken;
});

/** One nomination, as the applicant's own screen sends it. */
const nominate = (phone: string, name: string) =>
  post(
    '/agents/me/referees',
    {
      fullName: name,
      phone,
      category: 'RECOGNISED_PROFESSIONAL',
      relationship: 'Has known the applicant for several years',
    },
    { token: applicantToken },
  );

async function activeCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM referees
      WHERE agent_id = $1 AND status = ANY($2::text[])`,
    [agentId, ACTIVE],
  );
  return Number.parseInt(row!.n, 10);
}

describe('two referee nominations submitted together', () => {
  it('leaves one outstanding invitation, not two', async () => {
    await Promise.all([
      nominate('+2348089702222', 'Bitrus Audu'),
      nominate('+2348089703333', 'Hauwa Danjuma'),
    ]);

    assert.equal(
      await activeCount(),
      1,
      'two invitations are outstanding for one nomination slot, with no replacement ' +
        'recorded against either — which is two attempts at clearance where the control ' +
        'is one at a time',
    );
  });

  it('refuses the second by name, not by constraint', async () => {
    const [first, second] = await Promise.all([
      nominate('+2348089704444', 'Grace Bitrus'),
      nominate('+2348089705555', 'Musa Garba'),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify([first.body, second.body]));

    const refused = first.status === 409 ? first : second;
    assert.equal(
      refused.body.error.code,
      'REFEREE_ALREADY_NOMINATED',
      'DUPLICATE_RECORD here means the pre-check lost to the index, and the applicant was ' +
        'told "that record already exists" rather than that a request is already outstanding',
    );
  });

  /*
   * And the rule at the database, not only in the service.
   *
   * The advisory lock makes 087's index unreachable through the only caller —
   * dropping the index fails none of the tests above, because the lock
   * serialises the two nominations before either insert is attempted. That is
   * the division of labour working, and it is also why the index needs a test
   * of its own: migration 080's principle is that "a rule the service enforces
   * and the database does not is one UPDATE away from being undone", and a
   * guard nothing exercises is a guard somebody deletes.
   *
   * Asserted the way this repository pins its other database-level rules — by
   * writing the row the rule forbids and expecting to be refused.
   */
  it('refuses a second active referee at the database', async () => {
    const first = await nominate('+2348089708888', 'Dauda Mwantiri');
    assert.equal(first.status, 201, JSON.stringify(first.body));

    await assert.rejects(
      () =>
        query(
          pool,
          `INSERT INTO referees
             (agent_id, reference_code, full_name, phone, category, relationship, status)
           VALUES ($1, 'REF-RACE-0001', 'A Second Referee', '+2348089709999',
                   'RECOGNISED_PROFESSIONAL', 'Knows the applicant', 'INVITED')`,
          [agentId],
        ),
      /idx_referees_one_active|duplicate key/i,
      'the schema permits two outstanding invitations for one application',
    );
  });

  /*
   * And the state that must not change: a replacement is still allowed, which
   * is the whole reason the rule is one ACTIVE referee rather than one referee.
   */
  it('still allows a recorded replacement', async () => {
    const first = await nominate('+2348089706666', 'Ladi Pam');
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const replacement = await post(
      '/agents/me/referees',
      {
        fullName: 'Saratu Gyang',
        phone: '+2348089707777',
        category: 'RECOGNISED_PROFESSIONAL',
        relationship: 'Has known the applicant for several years',
        replacesRefereeId: first.body.refereeId,
      },
      { token: applicantToken },
    );
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));

    assert.equal(await activeCount(), 1, 'a replacement must not leave two active referees');
    const replaced = await query<{ status: string }>(
      pool,
      `SELECT status FROM referees WHERE id = $1`,
      [first.body.refereeId],
    );
    assert.equal(replaced[0]!.status, 'REPLACED', 'the original record has to say so');
  });
});
