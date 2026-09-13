/**
 * What somebody who kept the message can read.
 *
 * Three doors on this platform take a token instead of a login, because the
 * person on the other side has no account and should not need one: a referee
 * answering a nomination, a cooperative's leader confirming who belongs to it,
 * and a citizen asking what they owe. `citizen.ts` states the standard they
 * are all held to — "every field here is read as though a stranger asked for
 * it, because one can" — and pays for it, having given up the TIN, the
 * compliance score, the obligation names and the officer's closure note.
 *
 * The attestation roster did not meet it. `GET /group-attestation/:token`
 * returned every member's telephone number in full:
 *
 *   { "full_name": "Nanribet Choji",   "phone": "+2348120000100" },
 *   { "full_name": "Nanribet Dachung", "phone": "+2348120000110" },
 *   { "full_name": "Nanribet Gyang",   "phone": "+2348120000120" }
 *
 * — a village cooperative's phone book, to anyone holding the link. And the
 * reasoning that should have caught it was already written down, one file
 * away: `attestation-replay.test.ts` narrowed the *write* side precisely
 * because "these arrive by SMS to a village chairman's handset; a forwarded
 * message is a forwarded capability", and in the same paragraph points at the
 * read it never revisited — "`openAttestation` hands out every member's id".
 * The link is deliberately reusable and never becomes spent, so it stays live
 * for its whole fourteen days.
 *
 * The number is masked rather than dropped: the screen's entire question is
 * whether the leader recognises this person, two members can share a name, and
 * three digits settle it for somebody who knows their own members.
 *
 * The second test here is the class rather than the instance. It walks the
 * public doors with one fixture and asserts that no telephone number the
 * database holds comes back from any of them. It can only cover the routes it
 * calls, which are named in it; what it buys is that the next field added to a
 * public response is measured against the same standard.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let officerToken = '';
let lgaId = '';

const LEADER_PHONE = '+2348030000210';
const MEMBER_PHONES = ['+2348120002101', '+2348120002102', '+2348120002103'];

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
    fullName: 'Attestation Officer',
    phone: '+2348000000210',
    role: 'revenue_officer',
  });
  officerToken = (await loginAs('+2348000000210')).accessToken;
  lgaId = await firstLgaId();
});

/**
 * A cooperative of three people whose names differ only in the second word —
 * which is the case the phone number is on the screen to settle.
 */
async function cooperativeAwaitingItsLeader(): Promise<string> {
  const created = await post(
    '/groups',
    {
      name: 'Farin Gada Traders Cooperative',
      groupType: 'FARMERS_COOPERATIVE',
      lgaId,
      leaderName: 'Musa Danladi',
      leaderPhone: LEADER_PHONE,
    },
    { token: officerToken, idempotencyKey: 'fwd-group' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const groupId = created.body.groupId as string;

  const approved = await post(
    `/groups/${groupId}/review`,
    { decision: 'APPROVE', reason: 'Verified against the ministry register of cooperatives.' },
    { token: officerToken },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  for (const [index, phone] of MEMBER_PHONES.entries()) {
    const taxpayer = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                              consent_given, declaration_accepted, economic_sector)
       VALUES ('INDIVIDUAL','Nanribet',$1,$2,'Village Road',$3,true,true,'AGRICULTURE')
       RETURNING id`,
      [['Choji', 'Dachung', 'Gyang'][index], phone, lgaId],
    );
    const member = await post(
      `/groups/${groupId}/members`,
      { taxpayerId: taxpayer!.id },
      { token: officerToken, idempotencyKey: `fwd-member-${index}` },
    );
    assert.equal(member.status, 201, JSON.stringify(member.body));
  }

  const invite = await post(`/groups/${groupId}/attestation-request`, {}, { token: officerToken });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  return (invite.body.invitationUrl as string).split('/group-attestation/')[1]!;
}

describe('the roster a membership link hands out', () => {
  it('carries enough of each number to tell two members apart', async () => {
    const token = await cooperativeAwaitingItsLeader();

    const view = await get(`/group-attestation/${token}`);
    assert.equal(view.status, 200, JSON.stringify(view.body));

    const members = view.body.members as { full_name: string; phone: string }[];
    assert.equal(members.length, 3, 'the fixture recorded three people');

    /*
     * Asserted against the property, not against `maskPhone`.
     *
     * `member.phone === maskPhone(real)` reads like the obvious check and is
     * a tautology: change `maskPhone` to return its argument and both sides
     * move together and the test still passes. This project has already found
     * one guard that could not fail (`!m && !(!m)` in the portal's permission
     * test, with six writes behind it), so the expectation here is written out
     * rather than computed by the code under test.
     */
    assert.equal(
      members[0]!.phone,
      '***********101',
      'the exact shape, once, so a change to the rule has to be deliberate',
    );

    for (const [index, member] of members.entries()) {
      const real = MEMBER_PHONES[index]!;
      assert.ok(
        member.phone.endsWith(real.slice(-3)),
        `two members can share a name, so ${member.full_name} must still be distinguishable`,
      );
      assert.ok(
        !member.phone.includes(real.slice(0, -3)),
        `everything before the last three digits must be gone, not shortened: ${member.phone}`,
      );
      assert.equal(
        member.phone.length,
        real.length,
        'the mask stands in the number\'s place rather than truncating it',
      );
    }
  });

  it('does not carry a number anyone could ring', async () => {
    const token = await cooperativeAwaitingItsLeader();
    const view = await get(`/group-attestation/${token}`);
    const body = JSON.stringify(view.body);

    for (const phone of MEMBER_PHONES) {
      assert.ok(
        !body.includes(phone),
        `a forwarded link must not be a phone book: ${phone} came back in full`,
      );
    }
  });

  it('still shows the leader who is already confirmed and who is not', async () => {
    // The control. Masking a field must not cost the screen the thing it is
    // for: the name, the group, and which of the two lists a person is in.
    const token = await cooperativeAwaitingItsLeader();
    const view = await get(`/group-attestation/${token}`);

    assert.equal(view.body.groupName, 'Farin Gada Traders Cooperative');
    assert.equal(view.body.leaderName, 'Musa Danladi');
    const members = view.body.members as { full_name: string; status: string }[];
    assert.deepEqual(
      members.map((m) => m.full_name.trim()),
      ['Nanribet Choji', 'Nanribet Dachung', 'Nanribet Gyang'],
    );
    assert.ok(members.every((m) => m.status === 'PENDING_ATTESTATION'));
  });
});

describe('the doors that take a token instead of a login', () => {
  it('hand back no telephone number that the database holds', async () => {
    /*
     * One fixture, then every public route that can answer about a person.
     * The referee door is not here because it is exercised the same way in
     * `a-referee-who-does-not-clear.test.ts` and returns no phone field at
     * all; what this covers is the three that return a record.
     */
    const token = await cooperativeAwaitingItsLeader();

    const responses: { where: string; body: string }[] = [];

    const roster = await get(`/group-attestation/${token}`);
    responses.push({ where: 'GET /group-attestation/:token', body: JSON.stringify(roster.body) });

    const byPhone = await post('/citizen-status/lookup', { phone: MEMBER_PHONES[0] });
    responses.push({ where: 'POST /citizen-status/lookup (phone)', body: JSON.stringify(byPhone.body) });

    const byName = await post('/citizen-status/lookup', { name: 'Nanribet' });
    responses.push({ where: 'POST /citizen-status/lookup (name)', body: JSON.stringify(byName.body) });

    const missing = await get('/verify/PSIRS-NOT-A-REAL-CODE');
    responses.push({ where: 'GET /verify/:code', body: JSON.stringify(missing.body) });

    // Every number the database holds, not only the ones this fixture wrote:
    // a seeded officer or agent leaking through a public response is the same
    // defect, and would be missed by a list written here.
    const held = await query<{ phone: string }>(
      pool,
      `SELECT phone FROM taxpayers WHERE phone IS NOT NULL
        UNION SELECT phone FROM users WHERE phone IS NOT NULL
        UNION SELECT leader_phone AS phone FROM taxpayer_groups WHERE leader_phone IS NOT NULL`,
    );
    assert.ok(held.length >= 4, 'the fixture wrote no numbers to look for');

    const leaks: string[] = [];
    for (const response of responses) {
      for (const row of held) {
        if (response.body.includes(row.phone)) {
          leaks.push(`${response.where} returned ${row.phone} in full`);
        }
      }
    }

    assert.deepEqual(
      leaks,
      [],
      `a token is not a login, and these answer whoever holds one:\n${leaks.join('\n')}`,
    );
  });
});
