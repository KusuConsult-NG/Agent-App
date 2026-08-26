/**
 * The referee path when the referee is not simply cleared.
 *
 * Becoming an agent requires somebody to vouch for you, and every test the
 * platform had used the same referee: a community leader, a NIN, cleared on
 * the first answer. So four of the six categories PSIRS recognises, five of
 * the six identity documents, and every referee outcome other than "cleared"
 * were paths nothing had walked.
 *
 * The one that mattered was the risk flags. Four rules raise them — one person
 * vouching for a crowd of applicants, a referee using the applicant's own
 * phone number, one identity behind several referees — they are raised OPEN,
 * the referee dashboard lists OPEN and UNDER_REVIEW, and there was no path in
 * the platform to any other status. Nothing could ever close one. An officer
 * who investigated a pattern and found it innocent had no way to say so, and
 * the flag they had cleared sat above the next one for ever; a queue that only
 * grows is a queue that stops being read.
 *
 * Upholding one now means something as well as saying something: a referee
 * with a confirmed flag against them cannot be cleared until an officer
 * dismisses it on the record, so one officer cannot uphold a pattern in the
 * morning and another clear the referee it is about after lunch.
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

let adminToken = '';
let investigator = '';
let lgaId = '';
let sequence = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Referee Admin', phone: '+2348033000001', role: 'admin' });
  // `fraud:manage` and not `agent:approve`: triaging a risk flag and clearing
  // the referee it is about are deliberately different offices.
  await createGovernmentUser({
    fullName: 'Risk Investigator',
    phone: '+2348033000002',
    role: 'revenue_officer',
  });
  adminToken = (await loginAs('+2348033000001')).accessToken;
  investigator = (await loginAs('+2348033000002')).accessToken;
  lgaId = await firstLgaId();
  sequence = 0;
});

/** An applicant who has applied and nothing more. */
async function applicant(): Promise<{ agentId: string; token: string }> {
  sequence += 1;
  const phone = `+23480334${String(sequence).padStart(5, '0')}`;
  const application = await post('/agents/apply', {
    fullName: `Referee Subject ${sequence}`,
    phone,
    password: 'FieldAgent2026',
    address: '11 Yakubu Gowon Way, Jos',
    lgaId,
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: `Referee Subject ${sequence}`,
    accountNumber: `02234567${String(sequence).padStart(2, '0')}`,
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  return {
    agentId: application.body.agentId as string,
    token: (await loginAs(phone, 'FieldAgent2026')).accessToken,
  };
}

/** Nominate a referee and return the token from the link that is sent to them. */
async function nominate(
  agentToken: string,
  options: { category: string; phone: string; replaces?: string; name?: string },
): Promise<{ token: string; refereeId: string }> {
  const response = await post(
    '/agents/me/referees',
    {
      fullName: options.name ?? `Referee ${options.phone.slice(-4)}`,
      phone: options.phone,
      category: options.category,
      relationship: 'Has known the applicant for several years',
      ...(options.replaces ? { replacesRefereeId: options.replaces } : {}),
    },
    { token: agentToken },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return {
    token: (response.body.invitationUrl as string).split('/referee/')[1]!,
    refereeId: response.body.refereeId as string,
  };
}

/** Open the link and answer it, the way a referee does on their phone. */
async function respond(token: string, identityType?: string, identityNumber?: string) {
  await get(`/referee/${token}`);
  return post(`/referee/${token}/respond`, {
    confirmsKnowsApplicant: true,
    confirmsInformationAccurate: true,
    willingToActAsReferee: true,
    understandsConsequences: true,
    ...(identityType && identityNumber ? { identityType, identityNumber } : {}),
  });
}

const refereeRow = (id: string) =>
  queryOne<{ status: string; rejection_reason: string | null; category: string }>(
    pool,
    'SELECT status, rejection_reason, category FROM referees WHERE id = $1',
    [id],
  );

const kycRow = (id: string) =>
  queryOne<{ identity_type: string | null; verification_status: string }>(
    pool,
    'SELECT identity_type, verification_status FROM referee_kyc WHERE referee_id = $1',
    [id],
  );

describe('An applicant who has to go back for another referee', () => {
  /**
   * The mock provider decides from the last digit — ...9 fails, ...0 is
   * referred to a person, anything else clears — so a chain of replacements
   * walks the outcomes a real applicant might live through. §29 keeps the
   * earlier records rather than overwriting them, which is what makes this a
   * chain and not one row edited three times.
   */
  it('keeps every referee, their category and the document each one gave', async () => {
    const agent = await applicant();

    const employer = await nominate(agent.token, {
      category: 'EMPLOYER',
      phone: '+2348034000101',
      name: 'Danjuma Employer',
    });
    const failed = await respond(employer.token, 'BVN', '22200000009');
    assert.equal(failed.status, 200, JSON.stringify(failed.body));
    assert.equal((await refereeRow(employer.refereeId))?.status, 'FAILED');
    assert.equal((await kycRow(employer.refereeId))?.verification_status, 'FAILED');
    assert.equal((await kycRow(employer.refereeId))?.identity_type, 'BVN');

    const professional = await nominate(agent.token, {
      category: 'RECOGNISED_PROFESSIONAL',
      phone: '+2348034000102',
      replaces: employer.refereeId,
      name: 'Ngozi Surveyor',
    });
    await respond(professional.token, 'PASSPORT', 'A01234560');
    assert.equal(
      (await refereeRow(professional.refereeId))?.status,
      'UNDER_REVIEW',
      'a provider that will not decide sends it to a person, not to a refusal',
    );
    assert.equal((await kycRow(professional.refereeId))?.verification_status, 'UNDER_REVIEW');

    // The officer looks and says no. The applicant's journal records it.
    const rejected = await post(
      `/agents/referees/${professional.refereeId}/review`,
      { decision: 'REJECT', reason: 'The professional body has no record of this registration.' },
      { token: adminToken },
    );
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal((await refereeRow(professional.refereeId))?.status, 'REJECTED');
    assert.equal((await kycRow(professional.refereeId))?.verification_status, 'FAILED');

    const journal = await query<{ event_type: string }>(
      pool,
      'SELECT event_type FROM agent_clearance_events WHERE agent_id = $1',
      [agent.agentId],
    );
    assert.ok(journal.some((row) => row.event_type === 'REFEREE_FAILED'));

    const chief = await nominate(agent.token, {
      category: 'TRADITIONAL_AUTHORITY',
      phone: '+2348034000103',
      replaces: professional.refereeId,
      name: 'Mangu District Head',
    });
    const cleared = await respond(chief.token, 'VOTERS_CARD', 'PLA90123456');
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal((await refereeRow(chief.refereeId))?.status, 'CLEARED');

    // All three are still on the record, in the categories they were
    // nominated under, and each superseded one points at the one that replaced
    // it (§29). The outcome each of them reached was asserted above, as it
    // happened; nominating a replacement marks the previous referee REPLACED,
    // so that is what the chain reads as afterwards.
    const all = await query<{ category: string; status: string; replaced_by_referee_id: string | null }>(
      pool,
      `SELECT category, status, replaced_by_referee_id FROM referees
        WHERE agent_id = $1 ORDER BY created_at`,
      [agent.agentId],
    );
    assert.deepEqual(
      all.map((row) => `${row.category}:${row.status}`),
      ['EMPLOYER:REPLACED', 'RECOGNISED_PROFESSIONAL:REPLACED', 'TRADITIONAL_AUTHORITY:CLEARED'],
    );
    assert.equal(all[0]!.replaced_by_referee_id, professional.refereeId);
    assert.equal(all[1]!.replaced_by_referee_id, chief.refereeId);

    // And why each of them did not stand is still readable, which is the
    // reason the earlier records are kept at all.
    const reasons = await query<{ rejection_reason: string | null }>(
      pool,
      `SELECT rejection_reason FROM referees WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
      [[employer.refereeId, professional.refereeId]],
    );
    assert.ok(reasons.every((row) => row.rejection_reason), 'each failed referee kept its reason');
  });

  it('records the other two identity documents PSIRS accepts', async () => {
    const agent = await applicant();

    const first = await nominate(agent.token, {
      category: 'PUBLIC_SERVANT',
      phone: '+2348034000201',
      name: 'Aisha Clerk',
    });
    await respond(first.token, 'DRIVERS_LICENCE', 'PLT0993339');
    assert.equal((await kycRow(first.refereeId))?.identity_type, 'DRIVERS_LICENCE');
    assert.equal((await refereeRow(first.refereeId))?.status, 'FAILED');

    const second = await nominate(agent.token, {
      category: 'RELIGIOUS_LEADER',
      phone: '+2348034000202',
      replaces: first.refereeId,
      name: 'Imam Bala',
    });
    await respond(second.token, 'OTHER', 'STAFF-99881');
    assert.equal((await kycRow(second.refereeId))?.identity_type, 'OTHER');
    assert.equal((await refereeRow(second.refereeId))?.status, 'CLEARED');
  });
});

describe('A verification request nobody answered in time', () => {
  it('expires the request and the referee with it', async () => {
    const agent = await applicant();
    const invited = await nominate(agent.token, {
      category: 'COMMUNITY_LEADER',
      phone: '+2348034000301',
    });

    // The invitation's own clock, moved rather than waited out. Everything the
    // test is about — what the platform does when a referee arrives late — is
    // still the platform's own code.
    await pool.query(
      `UPDATE referee_invitations SET expires_at = now() - interval '1 day' WHERE referee_id = $1`,
      [invited.refereeId],
    );

    const late = await get(`/referee/${invited.token}`);
    assert.equal(late.status, 410, JSON.stringify(late.body));
    assert.equal(late.body.error.code, 'INVITATION_EXPIRED');
    assert.match(late.body.error.message, /ask the applicant to send you a new request/i);

    assert.equal((await refereeRow(invited.refereeId))?.status, 'EXPIRED');
    const invitation = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM referee_invitations WHERE referee_id = $1',
      [invited.refereeId],
    );
    assert.equal(invitation?.status, 'EXPIRED');

    // Expired is not outstanding, so the applicant may nominate somebody else
    // without asking for a replacement.
    const replacement = await nominate(agent.token, {
      category: 'COMMUNITY_LEADER',
      phone: '+2348034000302',
    });
    assert.ok(replacement.refereeId);

    const dashboard = await get('/agents/referee-dashboard', { token: adminToken });
    assert.equal(dashboard.body.counts.expired, '1');
  });
});

describe('A referee the platform has flagged', () => {
  /**
   * One phone number vouching for more applicants than the threshold allows.
   * Six of them, because the limit is five, and every one is a real applicant
   * who really nominated them.
   */
  async function refereeSupportingSix() {
    const shared = '+2348034000401';
    let last: { token: string; refereeId: string } | null = null;
    for (let index = 0; index < 6; index += 1) {
      const agent = await applicant();
      last = await nominate(agent.token, {
        category: 'COMMUNITY_LEADER',
        phone: shared,
        name: 'Everybody’s Referee',
      });
    }
    return last!;
  }

  it('raises the flag, and an officer can finally close it', async () => {
    const referee = await refereeSupportingSix();

    const flag = await queryOne<{ id: string; rule: string; severity: string; status: string }>(
      pool,
      `SELECT id, rule, severity, status FROM referee_risk_flags
        WHERE rule = 'REFEREE_SUPPORTS_MANY_AGENTS' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(flag, 'one person vouching for six applicants should be flagged');
    assert.equal(flag!.severity, 'HIGH');
    assert.equal(flag!.status, 'OPEN');

    const dashboard = await get('/agents/referee-dashboard', { token: adminToken });
    assert.ok(
      (dashboard.body.suspiciousReferees as { id: string }[]).some((row) => row.id === flag!.id),
      'and appear on the dashboard an officer reads',
    );

    // Picked up, then upheld.
    const picked = await post(
      `/agents/referees/flags/${flag!.id}/review`,
      { decision: 'UNDER_REVIEW', note: 'Calling the six applicants to ask how they know him.' },
      { token: investigator },
    );
    assert.equal(picked.status, 200, JSON.stringify(picked.body));

    const upheld = await post(
      `/agents/referees/flags/${flag!.id}/review`,
      { decision: 'CONFIRMED', note: 'Four of the six have never met him. He was paid to vouch.' },
      { token: investigator },
    );
    assert.equal(upheld.status, 200, JSON.stringify(upheld.body));
    assert.equal(
      (
        await queryOne<{ status: string; reviewed_by: string }>(
          pool,
          'SELECT status, reviewed_by FROM referee_risk_flags WHERE id = $1',
          [flag!.id],
        )
      )?.status,
      'CONFIRMED',
    );

    // Upheld means something, on both of the paths that can clear a referee.
    // The ordinary one first: the referee answers, their NIN matches, and that
    // is not an answer to the question the flag asks.
    const answered = await respond(referee.token, 'NIN', '12345678901');
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    const held = await refereeRow(referee.refereeId);
    assert.equal(held?.status, 'UNDER_REVIEW', 'a matching identity does not clear past an upheld flag');
    assert.match(held!.rejection_reason!, /risk flag against this referee has been upheld/i);
    assert.equal(
      (await kycRow(referee.refereeId))?.verification_status,
      'CLEARED',
      'and the provider’s own verdict is recorded as what it was',
    );

    const blocked = await post(
      `/agents/referees/${referee.refereeId}/review`,
      { decision: 'CLEAR', reason: 'Looks fine to me on the paperwork supplied.' },
      { token: adminToken },
    );
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error.code, 'REFEREE_RISK_FLAG_UPHELD');
    assert.notEqual((await refereeRow(referee.refereeId))?.status, 'CLEARED');

    // Dismissing it is an officer saying on the record that the pattern does
    // not disqualify this referee — and only then does the clearance go
    // through.
    const dismissed = await post(
      `/agents/referees/flags/${flag!.id}/review`,
      {
        decision: 'DISMISSED',
        note: 'He is the ward head; vouching for six applicants is his job, and all six confirmed it.',
      },
      { token: investigator },
    );
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));

    const closed = await post(
      `/agents/referees/${referee.refereeId}/review`,
      { decision: 'CLEAR', reason: 'Risk flag dismissed after enquiry; identity confirmed.' },
      { token: adminToken },
    );
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal((await refereeRow(referee.refereeId))?.status, 'CLEARED');

    // And the dashboard is readable again.
    const after = await get('/agents/referee-dashboard', { token: adminToken });
    assert.equal(
      (after.body.suspiciousReferees as { id: string }[]).filter((row) => row.id === flag!.id).length,
      0,
      'a closed flag leaves the queue',
    );
  });

  it('will not let just anyone close one', async () => {
    const referee = await refereeSupportingSix();
    const flag = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM referee_risk_flags WHERE referee_id = $1 LIMIT 1`,
      [referee.refereeId],
    );
    await createGovernmentUser({
      fullName: 'Reading Auditor',
      phone: '+2348033000003',
      role: 'auditor',
    });
    const auditor = (await loginAs('+2348033000003')).accessToken;

    const refused = await post(
      `/agents/referees/flags/${flag!.id}/review`,
      { decision: 'DISMISSED', note: 'Tidying up the queue before the quarterly report.' },
      { token: auditor },
    );
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(
      (
        await queryOne<{ status: string }>(
          pool,
          'SELECT status FROM referee_risk_flags WHERE id = $1',
          [flag!.id],
        )
      )?.status,
      'OPEN',
    );
  });
});
