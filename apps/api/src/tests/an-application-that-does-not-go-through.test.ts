/**
 * The clearance pipeline when it does not go through first time.
 *
 * Every test the platform had walked the happy path: NIN, one referee, all
 * modules passed, approve, activate. So the whole of the other half — the
 * applicant who tries a second identity document, fails an assessment, is
 * asked for more information, or is turned down — was code nobody had run.
 *
 * Three of the things found by running it:
 *
 * 1. A FAILED TRAINING ATTEMPT WAS NEVER RECORDED. The row went in and the
 *    refusal that followed was thrown inside the same transaction, so it rolled
 *    straight back out. `attempts` could not leave nought, and because
 *    `agents.training_status` is derived from the presence of a progress row,
 *    an applicant who had sat an assessed module three times and failed it
 *    three times looked exactly like one who had never opened it.
 *
 * 2. AN APPLICANT ASKED FOR A CLEARER PHOTOGRAPH WAS COUNTED NOWHERE. The KYC
 *    dashboard counts pending, cleared and failed; VERIFICATION_REQUIRED was in
 *    none of the three, so the figures did not add up to the applications
 *    received and the applicant waiting to be chased was on no officer's list.
 *
 * 3. FIVE OF THE SIX IDENTITY DOCUMENTS PSIRS ACCEPTS HAD NEVER BEEN SUBMITTED,
 *    and neither had a KYC submission carrying a selfie — so the liveness check,
 *    which is the reason the selfie is asked for at all, had never returned
 *    PASSED in any run of this suite.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBaseUrl,
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  territoryForLga,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

/** A real JPEG, so the upload's signature check has something true to accept. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(256, 0x5b),
  Buffer.from([0xff, 0xd9]),
]);

let adminToken = '';
let lgaId = '';
let applicant: { agentId: string; token: string; phone: string };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

let sequence = 0;

/** An applicant who has applied and done nothing else. */
async function applyAsNewAgent(): Promise<{ agentId: string; token: string; phone: string }> {
  sequence += 1;
  const phone = `+23480322${String(sequence).padStart(5, '0')}`;
  const application = await post('/agents/apply', {
    fullName: `Second Attempt ${sequence}`,
    phone,
    password: 'FieldAgent2026',
    address: '4 Rukuba Road, Jos',
    lgaId,
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: `Second Attempt ${sequence}`,
    accountNumber: `01234567${String(sequence).padStart(2, '0')}`,
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  const token = (await loginAs(phone, 'FieldAgent2026')).accessToken;
  return { agentId: application.body.agentId as string, token, phone };
}

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Clearance Admin', phone: '+2348032000001', role: 'admin' });
  adminToken = (await loginAs('+2348032000001')).accessToken;
  lgaId = await firstLgaId();
  applicant = await applyAsNewAgent();
});

const submitKyc = (identityType: string, identityNumber: string, selfieDocumentId?: string) =>
  post(
    '/agents/me/kyc',
    { identityType, identityNumber, ...(selfieDocumentId ? { selfieDocumentId } : {}) },
    { token: applicant.token },
  );

/** Upload a document the way the field application does: the file is the body. */
async function uploadSelfie(): Promise<string> {
  const response = await fetch(
    `${apiBaseUrl()}/agents/me/kyc/documents?type=SELFIE&captureSource=CAMERA`,
    {
      method: 'POST',
      headers: {
        'content-type': 'image/jpeg',
        'x-app-version': '1.0.0',
        authorization: `Bearer ${applicant.token}`,
      },
      body: JPEG,
    },
  );
  const body = (await response.json()) as { documentId: string };
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.documentId;
}

describe('An applicant who has to try more than one identity document', () => {
  /**
   * The mock provider decides from the last digit — ...9 fails, ...0 goes to
   * a human, ...7 asks for more, anything else clears — so an applicant can be
   * walked through the whole sequence a real one might live: a BVN that does
   * not match, a passport that does not either, a voter's card the provider
   * will not decide on, and finally a document that clears.
   */
  it('keeps every attempt, and clears on the one that finally matches', async () => {
    assert.equal((await submitKyc('BVN', '22200000009')).body.status, 'FAILED');
    assert.equal((await submitKyc('PASSPORT', 'A01234569')).body.status, 'FAILED');
    assert.equal((await submitKyc('VOTERS_CARD', 'PLA9012340')).body.status, 'UNDER_REVIEW');
    assert.equal((await submitKyc('DRIVERS_LICENCE', 'PLT099299')).body.status, 'FAILED');

    // The last one carries a selfie, which is the only way the liveness check
    // is performed at all.
    const selfie = await uploadSelfie();
    const cleared = await submitKyc('OTHER', 'REFNO-4455661', selfie);
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.status, 'CLEARED');

    const attempts = await query<{
      identity_type: string;
      verification_status: string;
      liveness_result: string;
      attempt_number: number;
      superseded_at: Date | null;
    }>(
      pool,
      `SELECT identity_type, verification_status, liveness_result, attempt_number, superseded_at
         FROM agent_kyc WHERE agent_id = $1 ORDER BY attempt_number`,
      [applicant.agentId],
    );
    assert.equal(attempts.length, 5, 'a resubmission supersedes rather than overwrites');
    assert.deepEqual(
      attempts.map((row) => row.identity_type),
      ['BVN', 'PASSPORT', 'VOTERS_CARD', 'DRIVERS_LICENCE', 'OTHER'],
      'each attempt keeps the document it was made with',
    );

    const live = attempts[attempts.length - 1]!;
    assert.equal(live.superseded_at, null, 'only the last attempt stands');
    assert.equal(live.verification_status, 'CLEARED');
    assert.equal(
      live.liveness_result,
      'PASSED',
      'a submission carrying a selfie is checked for liveness',
    );

    // Without the selfie there is nothing to check, and the platform says so
    // rather than reporting a liveness result it did not obtain.
    const withoutSelfie = attempts.find((row) => row.identity_type === 'VOTERS_CARD')!;
    assert.equal(withoutSelfie.liveness_result, 'MANUAL_REVIEW');
  });

  it('shows an applicant waiting on us on the officer’s dashboard', async () => {
    // ...7 is the provider saying it needs a clearer photograph — a verdict on
    // the submission, not on the person.
    const asked = await submitKyc('BVN', '22200000007');
    assert.equal(asked.body.status, 'VERIFICATION_REQUIRED');

    const dashboard = await get('/agents/kyc-dashboard', { token: adminToken });
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
    const counts = dashboard.body.counts;
    assert.equal(counts.kyc_action_required, '1', 'the applicant we are waiting on is counted');
    assert.equal(counts.kyc_pending, '1', 'and is not lost between pending, cleared and failed');
    assert.equal(
      Number(counts.kyc_pending) + Number(counts.kyc_cleared) + Number(counts.kyc_failed),
      Number(counts.applications_received),
      'every application received is in exactly one of the three',
    );
  });
});

describe('An applicant who fails an assessed module', () => {
  it('has the attempt recorded, so it is visible that they are trying', async () => {
    const failed = await post(
      '/agents/me/training/TRN-01',
      { score: 40 },
      { token: applicant.token },
    );
    assert.equal(failed.status, 400, JSON.stringify(failed.body));
    assert.match(failed.body.error.message, /You scored 40%/);

    const first = await queryOne<{ status: string; score: number; attempts: number }>(
      pool,
      `SELECT p.status, p.score, p.attempts FROM agent_training_progress p
         JOIN training_modules m ON m.id = p.module_id
        WHERE p.agent_id = $1 AND m.code = 'TRN-01'`,
      [applicant.agentId],
    );
    assert.equal(first?.status, 'FAILED', 'the attempt survives the refusal that followed it');
    assert.equal(first?.score, 40);
    assert.equal(first?.attempts, 1);

    await post('/agents/me/training/TRN-01', { score: 55 }, { token: applicant.token });
    const second = await queryOne<{ attempts: number; score: number }>(
      pool,
      `SELECT p.attempts, p.score FROM agent_training_progress p
         JOIN training_modules m ON m.id = p.module_id
        WHERE p.agent_id = $1 AND m.code = 'TRN-01'`,
      [applicant.agentId],
    );
    assert.equal(second?.attempts, 2, 'the second attempt is counted, not overwritten');
    assert.equal(second?.score, 55);

    // And the officer's view of the applicant changes: somebody who has failed
    // twice is not somebody who has not started.
    const agentRow = await queryOne<{ training_status: string }>(
      pool,
      'SELECT training_status FROM agents WHERE id = $1',
      [applicant.agentId],
    );
    assert.equal(agentRow?.training_status, 'IN_PROGRESS');

    const passed = await post('/agents/me/training/TRN-01', { score: 88 }, { token: applicant.token });
    assert.equal(passed.status, 200, JSON.stringify(passed.body));
    const done = await queryOne<{ status: string; attempts: number }>(
      pool,
      `SELECT p.status, p.attempts FROM agent_training_progress p
         JOIN training_modules m ON m.id = p.module_id
        WHERE p.agent_id = $1 AND m.code = 'TRN-01'`,
      [applicant.agentId],
    );
    assert.equal(done?.status, 'COMPLETED');
    assert.equal(done?.attempts, 3, 'and how many tries it took stays on the record');
  });
});

describe('An application the government does not simply approve', () => {
  const clearanceRow = (agentId: string) =>
    queryOne<{ clearance_status: string; rejection_reason: string | null; reviewed_by: string | null }>(
      pool,
      'SELECT clearance_status, rejection_reason, reviewed_by FROM agent_clearance WHERE agent_id = $1',
      [agentId],
    );

  const journalTypes = async (agentId: string) =>
    (
      await query<{ event_type: string }>(
        pool,
        'SELECT event_type FROM agent_clearance_events WHERE agent_id = $1 ORDER BY created_at',
        [agentId],
      )
    ).map((row) => row.event_type);

  it('can send it back for more information without turning it down', async () => {
    const sentBack = await post(
      `/agents/${applicant.agentId}/review`,
      {
        decision: 'REQUEST_INFO',
        reason: 'The address on the application does not match the utility bill supplied.',
      },
      { token: adminToken },
    );
    assert.equal(sentBack.status, 200, JSON.stringify(sentBack.body));

    const clearance = await clearanceRow(applicant.agentId);
    assert.equal(clearance?.clearance_status, 'ACTION_REQUIRED');
    assert.match(clearance!.rejection_reason!, /utility bill/);
    assert.ok(clearance!.reviewed_by, 'the officer who asked is on the record');

    const agentRow = await queryOne<{ clearance_status: string; rejection_reason: string | null }>(
      pool,
      'SELECT clearance_status, rejection_reason FROM agents WHERE id = $1',
      [applicant.agentId],
    );
    assert.equal(agentRow?.clearance_status, 'ACTION_REQUIRED');
    // Asking is not refusing: only a rejection writes a rejection reason
    // against the applicant themselves.
    assert.equal(agentRow?.rejection_reason, null);

    assert.ok((await journalTypes(applicant.agentId)).includes('INFO_REQUESTED'));

    // And the applicant can read what is being asked of them rather than
    // watching a status that never moves.
    const mine = await get('/agents/me/application', { token: applicant.token });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.statuses.clearance, 'ACTION_REQUIRED');
    assert.ok(
      (mine.body.history as { event_type: string; reason: string | null }[]).some(
        (event) => event.event_type === 'INFO_REQUESTED' && /utility bill/.test(event.reason ?? ''),
      ),
      'the applicant can read what is being asked of them',
    );
  });

  it('records a rejection with the reason it was rejected for', async () => {
    const rejected = await post(
      `/agents/${applicant.agentId}/review`,
      {
        decision: 'REJECT',
        reason: 'The identity document supplied belongs to a different person entirely.',
      },
      { token: adminToken },
    );
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));

    const clearance = await clearanceRow(applicant.agentId);
    assert.equal(clearance?.clearance_status, 'REJECTED');

    const agentRow = await queryOne<{
      clearance_status: string;
      operational_status: string;
      rejection_reason: string;
    }>(
      pool,
      'SELECT clearance_status, operational_status, rejection_reason FROM agents WHERE id = $1',
      [applicant.agentId],
    );
    assert.equal(agentRow?.clearance_status, 'REJECTED');
    assert.equal(agentRow?.operational_status, 'INACTIVE');
    assert.match(agentRow!.rejection_reason, /different person/);

    assert.ok((await journalTypes(applicant.agentId)).includes('GOVERNMENT_REJECTED'));

    // A rejected applicant is not an agent, whatever else is done to the row.
    const activation = await post(
      `/agents/${applicant.agentId}/activate`,
      { territoryId: await territoryForLga(lgaId) },
      { token: adminToken },
    );
    assert.equal(activation.status, 409, JSON.stringify(activation.body));
  });

  it('will not decide without a reason', async () => {
    const noReason = await post(
      `/agents/${applicant.agentId}/review`,
      { decision: 'REJECT', reason: '' },
      { token: adminToken },
    );
    assert.equal(noReason.status, 422, JSON.stringify(noReason.body));
    assert.equal((await clearanceRow(applicant.agentId))?.clearance_status, 'PENDING');
  });
});
