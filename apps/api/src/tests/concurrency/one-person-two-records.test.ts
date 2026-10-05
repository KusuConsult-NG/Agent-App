/**
 * One person registered twice, at the same moment, with the same NIN.
 *
 * PRD §68 names this as a fraud vector in so many words — "Create duplicate
 * taxpayers for commission purposes" — and the platform's answer to it is
 * `findPotentialDuplicates`. An identity-number match scores 100, which is
 * decisive, and a decisive match is refused outright rather than warned about:
 * one human being gets one record, and nobody is paid twice for finding them.
 *
 * THE CHECK IS OUTSIDE THE TRANSACTION, ON PURPOSE
 *
 * `registerTaxpayer` runs the duplicate check, journals its outcome, and only
 * then opens the transaction that inserts the row. That is deliberate and the
 * comment above it says why: a blocked attempt aborts the transaction, so
 * recording the check inside it would roll back the evidence with it, and a
 * pattern of repeated blocked attempts is precisely what fraud review needs to
 * see.
 *
 * So the check takes no lock, and the row it is looking for does not exist yet.
 * Two agents registering one person both find nothing and both insert.
 *
 * WHAT THE DATABASE DOES NOT CATCH
 *
 * `taxpayers.tin` is UNIQUE, which is why this is not already blocked by
 * accident: the TIN service derives a number from the applicant's type, name
 * and PHONE, so the same person submitted with two phone numbers gets two
 * TINs. `identity_hash` had a plain partial index and `phone` a plain index.
 * Nothing in the schema said that one identity number belongs to one record —
 * only the application code did, and only when it won the race.
 *
 * Two phone numbers for one NIN is not an accident. It is what an agent paid
 * per registration would do.
 *
 * WHAT THESE ASSERT. One row for one identity hash, and the loser told so by
 * the refusal the sequential path gives rather than by a unique violation —
 * because `TAXPAYER_ALREADY_EXISTS` names the record it collided with and the
 * agent application says it in Hausa, and `DUPLICATE_RECORD` does neither.
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
import { seedDemoAgent } from '../../db/seed-agent';
import { hashIdentityNumber } from '../../lib/crypto';

const NIN = '77788899900';
let agent: { token: string; deviceId: string };
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
    fullName: 'Duplicate Race Officer',
    phone: '+2348089200001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demo agent needs an administrator to approve it');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  lgaId = await firstLgaId();
});

/**
 * One registration of one person, as an agent farming commission would send it.
 *
 * The NIN is the same both times and everything the TIN service seeds from is
 * not: a different phone means a different derived TIN, so `taxpayers_tin_key`
 * never sees the collision. The name differs too, so no name-and-LGA match can
 * stand in for the identity match being tested.
 */
const register = (phone: string, lastName: string, key: string) =>
  post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Danladi',
      lastName,
      phone,
      address: '12 Zaria Road, Jos',
      lgaId,
      identityType: 'NIN',
      identityNumber: NIN,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: key },
  );

async function rowsForTheNin(): Promise<string> {
  const counted = await queryOne<{ n: string }>(
    pool,
    'SELECT count(*)::text AS n FROM taxpayers WHERE identity_hash = $1',
    [hashIdentityNumber(NIN)],
  );
  return counted!.n;
}

describe('two agents registering one person at the same moment', () => {
  it('creates one record, not two', async () => {
    await Promise.all([
      register('+2348089201111', 'Musa', 'dup-race-1'),
      register('+2348089202222', 'Musa', 'dup-race-2'),
    ]);

    assert.equal(
      await rowsForTheNin(),
      '1',
      'one identity number, two records: the commission is payable twice and the ' +
        'control PRD §68 names is defeated by two agents pressing Register together',
    );
  });

  it('refuses the loser by name, not by unique violation', async () => {
    const [first, second] = await Promise.all([
      register('+2348089203333', 'Audu', 'dup-race-3'),
      register('+2348089204444', 'Audu', 'dup-race-4'),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409], JSON.stringify([first.body, second.body]));

    const refused = first.status === 409 ? first : second;
    assert.equal(
      refused.body.error.code,
      'TAXPAYER_ALREADY_EXISTS',
      'the refusal the sequential path gives names the record it collided with and is ' +
        'said in Hausa; a unique violation is DUPLICATE_RECORD and is neither',
    );
  });

  /*
   * The evidence, which is the half a fraud review reads.
   *
   * `taxpayer_duplicate_checks` is where a pattern of attempts on one identity
   * shows up, and PRD §32 makes that pattern a signal in its own right. An
   * attempt that lost a race is an attempt: if the loser were journalled as
   * PROCEEDED, or not journalled at all, the review would see one registration
   * where two people tried.
   */
  it('journals the loser as blocked, for the review that looks for a pattern', async () => {
    await Promise.all([
      register('+2348089207777', 'Bala', 'dup-race-7'),
      register('+2348089208888', 'Bala', 'dup-race-8'),
    ]);

    const blocked = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM taxpayer_duplicate_checks
        WHERE decision = 'BLOCKED' AND created_taxpayer_id IS NULL`,
    );
    assert.equal(
      blocked!.n,
      '1',
      'the attempt that lost the race left no trace, so a review of this identity sees ' +
        'one registration where two agents tried',
    );

    // And it names the record it collided with, which is what makes the row
    // worth reading rather than a count.
    const matched = await queryOne<{ matched_taxpayer_id: string | null }>(
      pool,
      `SELECT matched_taxpayer_id FROM taxpayer_duplicate_checks
        WHERE decision = 'BLOCKED' AND created_taxpayer_id IS NULL`,
    );
    assert.ok(matched!.matched_taxpayer_id, 'the blocked row points at nothing');
  });

  /*
   * And the state that must not change: one person registered once still goes
   * through, and a second person with a different NIN is not blocked by the
   * first. A constraint that refused the second would take registration away,
   * which is worse than the duplicate it prevents.
   */
  it('still registers a different person in the same moment', async () => {
    const [first, second] = await Promise.all([
      register('+2348089205555', 'Garba', 'dup-race-5'),
      post(
        '/taxpayers',
        {
          taxpayerType: 'INDIVIDUAL',
          firstName: 'Hauwa',
          lastName: 'Sule',
          phone: '+2348089206666',
          address: '3 Bauchi Road, Jos',
          lgaId,
          identityType: 'NIN',
          identityNumber: '11122233344',
          consentGiven: true,
          declarationAccepted: true,
        },
        { ...agent, idempotencyKey: 'dup-race-6' },
      ),
    ]);

    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
  });
});
