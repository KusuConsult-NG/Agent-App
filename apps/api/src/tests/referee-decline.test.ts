/**
 * A used invitation cannot be used again — including to decline.
 *
 * `submitRefereeResponse` reads the invitation's status and expiry and refuses
 * a second response with INVITATION_ALREADY_USED, or a 410 once the link has
 * expired. `declineInvitation` selected neither column and checked neither. It
 * looked the invitation up by token hash and wrote REJECTED over whatever was
 * there.
 *
 * Both are unauthenticated and addressed only by the token, which lives in an
 * SMS or an email for as long as the referee keeps the message. So anyone
 * still holding a spent link could overturn what it had already said.
 *
 * The far end of that is the part that matters. A referee confirms; an officer
 * reviews the confirmation and clears it; the agent is cleared, activated, and
 * out collecting revenue. A POST to the old decline link then rewrote the
 * referee to REJECTED and ran `syncAgentRefereeStatus`, pulling the agent's
 * referee clearance back down — an officer's recorded decision undone through
 * a public endpoint by a message anyone might have forwarded. That is the
 * first inviolable rule, "no cleared agent, no revenue access", being operated
 * in reverse by whoever has an old link.
 *
 * Declining is still open while the request is genuinely outstanding, which is
 * the whole point of offering it.
 */

import {
  createGovernmentUser,
  firstLgaId,
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

let officerToken = '';
let applicantToken = '';
let token = '';
let refereeId = '';

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
    role: 'admin',
    phone: '+2348030000096',
    fullName: 'Clearance Officer',
  });
  officerToken = (await loginAs('+2348030000096')).accessToken;

  const phone = `+23480555${String(Date.now()).slice(-5)}`;
  const applied = await post('/agents/apply', {
    fullName: 'Amina Bala',
    phone,
    password: 'Applicant2026',
    address: '4 Zaria Road, Jos',
    lgaId: await firstLgaId(),
    bankName: 'Zenith Bank',
    accountName: 'Amina Bala',
    accountNumber: '1234567890',
  });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  applicantToken = (await loginAs(phone, 'Applicant2026')).accessToken;

  const nominated = await post(
    '/agents/me/referees',
    {
      fullName: 'Danladi Musa',
      phone: '+2348022221111',
      address: 'Jos North',
      occupation: 'Teacher',
      category: 'COMMUNITY_LEADER',
      relationship: 'Community leader who has known me for ten years',
    },
    { token: applicantToken },
  );
  assert.equal(nominated.status, 201, JSON.stringify(nominated.body));
  token = String(nominated.body.invitationUrl).split('/referee/')[1];
  assert.ok(token, `no token in ${nominated.body.invitationUrl}`);

  refereeId = nominated.body.refereeId;
});

const decline = (reason = 'I would rather not act as referee.') =>
  post(`/referee/${token}/decline`, { reason });

const confirm = () =>
  post(`/referee/${token}/respond`, {
    confirmsKnowsApplicant: true,
    confirmsInformationAccurate: true,
    willingToActAsReferee: true,
    understandsConsequences: true,
    identityType: 'NIN',
    identityNumber: '12345678901',
    occupation: 'Teacher',
  });

const refereeStatus = async () =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM referees WHERE id = $1', [refereeId]))!
    .status;

describe('declining a referee invitation', () => {
  it('declines a request that is still outstanding', async () => {
    const response = await decline();

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await refereeStatus(), 'REJECTED');
  });

  it('refuses to decline after the referee already confirmed', async () => {
    const confirmed = await confirm();
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const afterConfirm = await refereeStatus();

    const response = await decline();

    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(await refereeStatus(), afterConfirm, 'a spent link must not overwrite the answer');
  });

  it('cannot undo an officer clearance', async () => {
    await confirm();
    const reviewed = await post(
      `/agents/referees/${refereeId}/review`,
      { decision: 'CLEAR', reason: 'Referee response checked against the application.' },
      { token: officerToken },
    );
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(await refereeStatus(), 'CLEARED');

    const response = await decline();

    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(
      await refereeStatus(),
      'CLEARED',
      'a public link must not overturn a recorded officer decision',
    );
  });

  it('refuses an expired invitation', async () => {
    await pool.query(
      `UPDATE referee_invitations SET expires_at = now() - interval '1 day'
        WHERE referee_id = $1`,
      [refereeId],
    );

    const response = await decline();

    assert.equal(response.status, 410, JSON.stringify(response.body));
    assert.notEqual(await refereeStatus(), 'REJECTED');
  });
});
