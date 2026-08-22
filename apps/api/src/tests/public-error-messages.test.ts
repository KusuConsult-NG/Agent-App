/**
 * A stranger holding a broken link must be told what to do about it.
 *
 * Three surfaces hand a link to somebody with no account and no way to ask
 * anyone: the receipt a taxpayer verifies, the invitation a referee answers,
 * and the membership list a group's leader confirms. Each of them is
 * eventually followed by someone whose link is mistyped, forwarded, or a month
 * old.
 *
 * The referee surface was written for that person — "This verification link is
 * not valid. Ask the applicant to send a new request." The group attestation
 * surface, added later, used the generic `notFound()` output instead: "That
 * attestation request could not be found." Accurate, and useless to a
 * cooperative chairman who does not know what an attestation request is and is
 * given nothing to do next.
 *
 * That difference is invisible to every other kind of test. The status code is
 * right, the shape is right, nothing throws — the page just fails somebody
 * quietly. So this asserts the property directly: a public refusal names a
 * next step, in words its reader would use.
 */

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
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
});

/** Does this refusal tell the reader what to do next? */
function offersAWayForward(message: string): boolean {
  return /\b(ask|contact|request|check|try|visit|open|sign in|call)\b/i.test(message);
}

/** Words no member of the public should have to understand. */
const JARGON = /\b(null|undefined|uuid|token hash|constraint|record could not be found|entity|payload)\b/i;

describe('a public link that does not work', () => {
  /*
   * Two kinds of public surface, and they owe their reader different things.
   *
   * A *link* surface — a referee invitation, a membership list — fails because
   * the link is wrong or old. The holder wants a working one, so the refusal
   * has to say who can issue it.
   *
   * A *verdict* surface — receipt verification — has not failed at all. "No
   * government document matches that code" is the answer, and the most useful
   * thing it can do is be unambiguous. Bolting "ask someone" onto it would
   * offer false hope to a trader who has just been handed a forged receipt,
   * which is the one reading that must not survive.
   */
  const linkSurfaces: [string, string][] = [
    ['referee invitation', '/referee/not-a-real-token'],
    ['group membership list', '/group-attestation/not-a-real-token'],
  ];

  for (const [name, path] of linkSurfaces) {
    it(`tells the holder of a ${name} link what to do`, async () => {
      const response = await get(path);

      assert.ok(
        response.status >= 400 || response.body?.status === 'NOT_FOUND',
        `${path} should refuse an invented token, got ${response.status}`,
      );

      // Receipt verification answers a verdict rather than an error envelope.
      const message: string =
        response.body?.error?.message ?? response.body?.message ?? '';
      assert.ok(message.length > 0, `${path} refused with no message at all`);

      assert.doesNotMatch(
        message,
        JARGON,
        `${name}: a member of the public is shown internal vocabulary — "${message}"`,
      );
      assert.ok(
        offersAWayForward(message),
        `${name}: refusal gives the reader nothing to do — "${message}"`,
      );
    });
  }

  it('answers a forged receipt plainly, without offering false hope', async () => {
    const response = await get('/verify/AAAAA-BBBBB');

    const message: string = response.body?.message ?? response.body?.error?.message ?? '';
    assert.ok(message.length > 0, 'verification refused with no message');
    assert.doesNotMatch(message, JARGON, `internal vocabulary shown to the public — "${message}"`);

    // It must say the document was not issued, not merely that a lookup failed.
    assert.match(
      message,
      /not issued|no government document|does not match/i,
      `a forged receipt deserves a verdict, not a lookup failure — "${message}"`,
    );
    assert.doesNotMatch(
      message,
      /try again|check your connection|temporarily/i,
      'a forged receipt must not be described as a transient problem',
    );
  });

  it('tells a group leader whose link has expired that their answers survived', async () => {
    // The anxious question at that moment is whether the work was lost.
    const admin = await createGovernmentUser({
      role: 'admin',
      phone: '+2348030000150',
      fullName: 'Attestation Officer',
    });
    const token = (await loginAs('+2348030000150')).accessToken;

    const created = await post(
      '/groups',
      {
        name: 'Expiring Cooperative',
        groupType: 'FARMERS_COOPERATIVE',
        lgaId: await firstLgaId(),
        leaderName: 'Chairman Test',
        leaderPhone: '+2348099990009',
      },
      { token },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await post(
      `/groups/${created.body.groupId}/review`,
      { decision: 'APPROVE', reason: 'Verified against the ministry register.' },
      { token },
    );
    const invited = await post(
      `/groups/${created.body.groupId}/attestation-request`,
      undefined,
      { token },
    );
    const link = String(invited.body.invitationUrl).split('/group-attestation/')[1];

    await pool.query(
      `UPDATE group_attestation_invitations SET expires_at = now() - interval '1 day'
        WHERE group_id = $1`,
      [created.body.groupId],
    );

    const response = await get(`/group-attestation/${link}`);

    assert.equal(response.status, 410, JSON.stringify(response.body));
    const message: string = response.body.error.message;
    assert.ok(
      offersAWayForward(message),
      `an expired link must say who can issue another — "${message}"`,
    );
    assert.match(
      message,
      /still on record|not been lost|nothing.*lost/i,
      `a leader who has worked through a long list needs to know it survived — "${message}"`,
    );
  });
});
