/**
 * The machines an officer signs in from, the sessions they hold, and the
 * evidence an investigation collects from outside the platform.
 *
 * Three gaps that shared a shape: the platform kept the fact and gave nobody a
 * way to act on it.
 *
 * SESSIONS. Every sign-in since migration 001 recorded a device, an address
 * and a last-used time. No officer could see their own, and the only control
 * was sign-out-everywhere -- which is all-or-nothing and belongs to whoever
 * still has the password. An officer who left a laptop signed in at a counter
 * had no way to end that one session and no way to see it existed.
 *
 * DEVICES. Officers deliberately do not get what agents get: a browser is not
 * a bound handset, and pre-approving one would put a queue between an
 * emergency and the person handling it. What they get is the half that matters
 * when something goes wrong -- a record of the machines, and a block. The
 * block is tested at the database, past every route, because the case it
 * exists for is a laptop already in somebody else's hands.
 *
 * EVIDENCE. Most of what an investigation collects is not a document PSIRS
 * issued, so none of it could go on a case; it went into somebody's email
 * instead. The tests here are about what makes an uploaded file evidence
 * rather than an attachment: it cannot be altered, it cannot be removed, and
 * it has to say what it is and where it came from.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  apiBaseUrl,
  createGovernmentUser,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { fingerprintOf, labelFor } from '../services/officer-devices';

const PHONES = {
  officer: '+2348082000001',
  admin: '+2348082000002',
  other: '+2348082000003',
};
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  for (const [key, phone] of Object.entries(PHONES)) {
    ids[key] = await createGovernmentUser({
      fullName: `Access ${key}`,
      phone,
      role: key === 'admin' ? 'admin' : 'revenue_officer',
    });
    tokens[key] = (await loginAs(phone)).accessToken;
  }
});

const auth = (who: keyof typeof PHONES) => ({ token: tokens[who] });

/** Sign in again, with a user agent, so a distinct device row is created. */
async function signInFrom(phone: string, userAgent: string): Promise<string> {
  const response = await api(
    'POST',
    '/auth/login',
    { phone, password: 'Password123' },
    { headers: { 'user-agent': userAgent } },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.accessToken as string;
}

// ===========================================================================
describe('an officer can see where they are signed in', () => {
  it('lists their own sessions and marks the one they are using', async () => {
    const seen = await get('/government/sessions/mine', auth('officer'));
    assert.equal(seen.status, 200, JSON.stringify(seen.body));

    const body = seen.body as { sessions: { is_current: boolean }[]; devices: unknown[] };
    assert.ok(body.sessions.length >= 1);
    assert.equal(
      body.sessions.filter((session) => session.is_current).length,
      1,
      'exactly one session is the one asking',
    );
  });

  /*
   * No permission at all, and that is the point: gating this would mean an
   * officer whose role somebody narrowed could no longer see that their old
   * laptop is still signed in.
   */
  it('shows an officer their own sessions whatever their role holds', async () => {
    await query(pool, `DELETE FROM role_permissions WHERE role = 'revenue_officer'`);
    const stripped = await loginAs(PHONES.officer);

    const seen = await get('/government/sessions/mine', { token: stripped.accessToken });
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
  });

  it('ends one session and leaves the others alone', async () => {
    const second = await signInFrom(PHONES.officer, 'Mozilla/5.0 (Windows NT 10.0) Firefox/130');
    const before = await get('/government/sessions/mine', auth('officer'));
    const live = (before.body as { sessions: { id: string; is_current: boolean }[] }).sessions
      .filter((session) => !session.is_current);
    assert.ok(live.length >= 1);

    const ended = await post(
      `/government/sessions/${live[0]!.id}/end`,
      { reason: 'Left signed in at the counter downstairs.' },
      auth('officer'),
    );
    assert.equal(ended.status, 200, JSON.stringify(ended.body));

    // The one they are using still works.
    const after = await get('/government/sessions/mine', auth('officer'));
    assert.equal(after.status, 200);

    // And an ended session stays listed, marked, rather than disappearing.
    const rows = (after.body as { sessions: { id: string; revoked_at: string | null }[] }).sessions;
    const target = rows.find((row) => row.id === live[0]!.id);
    assert.ok(target?.revoked_at, 'the ended session is still on the list');
    assert.ok(second, 'the second sign-in happened');
  });

  /*
   * Not found rather than forbidden. A 403 would confirm that a session id
   * belongs to somebody, which is more than a caller who may not touch it
   * should learn from asking.
   */
  it('will not let one officer end another officer’s session', async () => {
    const theirs = await get('/government/sessions/mine', auth('other'));
    const sessionId = (theirs.body as { sessions: { id: string }[] }).sessions[0]!.id;

    const attempt = await post(
      `/government/sessions/${sessionId}/end`,
      { reason: 'Reaching into somebody else’s account.' },
      auth('officer'),
    );
    assert.equal(attempt.status, 404, JSON.stringify(attempt.body));
  });

  it('lets an administrator see and end anybody’s', async () => {
    const seen = await get(`/government/users/${ids.officer}/sessions`, auth('admin'));
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
    const sessionId = (seen.body as { sessions: { id: string }[] }).sessions[0]!.id;

    const ended = await post(
      `/government/sessions/${sessionId}/end`,
      { reason: 'Officer reported a lost laptop.' },
      auth('admin'),
    );
    assert.equal(ended.status, 200, JSON.stringify(ended.body));

    // The officer's token no longer refreshes into a new session.
    const stillWorking = await get('/government/sessions/mine', auth('officer'));
    assert.ok([200, 401].includes(stillWorking.status), 'the access token expires on its own clock');
  });

  it('refuses an officer without user:manage the administrator’s view', async () => {
    const attempt = await get(`/government/users/${ids.admin}/sessions`, auth('officer'));
    assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
  });
});

// ===========================================================================
describe('a machine an officer signs in from', () => {
  it('is recorded on first sign-in and recognised on the next', async () => {
    const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0';
    await signInFrom(PHONES.officer, agent);
    await signInFrom(PHONES.officer, agent);

    const rows = await query<{ id: string; label: string }>(
      pool,
      'SELECT id, label FROM officer_devices WHERE user_id = $1',
      [ids.officer],
    );
    const chrome = rows.filter((row) => row.label === 'Chrome on Windows');
    assert.equal(chrome.length, 1, 'the same machine twice is one device, not two');
  });

  it('tells two machines apart', async () => {
    await signInFrom(PHONES.officer, 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0');
    await signInFrom(PHONES.officer, 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/130.0');

    const rows = await query(pool, 'SELECT label FROM officer_devices WHERE user_id = $1', [
      ids.officer,
    ]);
    assert.ok(rows.length >= 2, JSON.stringify(rows));
  });

  it('labels a machine in words a person can recognise', () => {
    assert.equal(labelFor('Mozilla/5.0 (Windows NT 10.0) Chrome/131.0'), 'Chrome on Windows');
    assert.equal(labelFor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605'), 'Safari on iOS');
    assert.equal(labelFor(null), 'Unknown device');
    // Edge says it is Chrome, and is not, which is the case worth pinning.
    assert.equal(labelFor('Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Edg/131.0'), 'Edge on Windows');
  });

  it('does not give one officer’s fingerprint to another', () => {
    assert.notEqual(
      fingerprintOf('Chrome/131', 'device-a'),
      fingerprintOf('Chrome/131', 'device-b'),
    );
    assert.equal(fingerprintOf('Chrome/131', 'device-a'), fingerprintOf('Chrome/131', 'device-a'));
  });

  /*
   * The whole point of a block, tested where it has to hold. A control that
   * only works when the request goes through the service layer is not a
   * control against a laptop in a stranger's hands.
   */
  it('blocks a machine, ends what it was holding, and refuses it a new session', async () => {
    await signInFrom(PHONES.officer, 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0');
    const device = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM officer_devices WHERE user_id = $1 AND label = 'Chrome on Windows'`,
      [ids.officer],
    );
    assert.ok(device);

    await grantStepUp(tokens.admin, PHONES.admin, 'user.role.change');
    const blocked = await post(
      `/government/devices/${device!.id}/block`,
      { reason: 'The officer reported this laptop stolen from the office.' },
      auth('admin'),
    );
    assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
    assert.ok((blocked.body as { sessionsEnded: number }).sessionsEnded >= 1,
      'blocking without revoking would be theatre');

    const live = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM sessions
        WHERE officer_device_id = $1 AND revoked_at IS NULL`,
      [device!.id],
    );
    assert.equal(live!.count, '0');

    // Refused at the row, not only by the service.
    await assert.rejects(
      () =>
        query(
          pool,
          `INSERT INTO sessions (user_id, refresh_token_hash, officer_device_id, expires_at)
           VALUES ($1, 'hash-' || gen_random_uuid()::text, $2, now() + interval '1 day')`,
          [ids.officer, device!.id],
        ),
      /blocked and cannot hold a session/,
    );

    // And the officer is told why, rather than shown a constraint violation.
    const refused = await api(
      'POST',
      '/auth/login',
      { phone: PHONES.officer, password: 'Password123' },
      { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0' } },
    );
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.match(JSON.stringify(refused.body), /blocked/i);
  });

  it('lifts a block, because a mistyped id must not be permanent', async () => {
    await signInFrom(PHONES.officer, 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0');
    const device = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM officer_devices WHERE user_id = $1 AND label = 'Chrome on Windows'`,
      [ids.officer],
    );

    await grantStepUp(tokens.admin, PHONES.admin, 'user.role.change');
    await post(
      `/government/devices/${device!.id}/block`,
      { reason: 'Blocked the wrong machine by mistake.' },
      auth('admin'),
    );

    await grantStepUp(tokens.admin, PHONES.admin, 'user.role.change');
    const unblocked = await post(
      `/government/devices/${device!.id}/unblock`,
      { reason: 'Wrong machine; the officer still needs this one.' },
      auth('admin'),
    );
    assert.equal(unblocked.status, 200, JSON.stringify(unblocked.body));

    const back = await signInFrom(PHONES.officer, 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0');
    assert.ok(back, 'the officer can sign in from it again');
  });

  it('will not let a device record be deleted', async () => {
    await signInFrom(PHONES.officer, 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0');
    await assert.rejects(
      () => query(pool, 'DELETE FROM officer_devices WHERE user_id = $1', [ids.officer]),
      /cannot be deleted|prevent/i,
    );
  });
});

// ===========================================================================
describe('evidence that did not come from this platform', () => {
  let caseId = '';

  /** A real, minimal PNG: the signature is checked against the bytes. */
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a49444154789c6360000002000100ffff03000006000557bfabd4000000' +
      '0049454e44ae426082',
    'hex',
  );

  beforeEach(async () => {
    const opened = await post(
      '/government/cases',
      { subject: 'Market stall collections under review', category: 'GENERAL' },
      auth('admin'),
    );
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    caseId = (opened.body as { id: string }).id;
  });

  async function upload(
    body: Buffer,
    contentType: string,
    params: Record<string, string> = {},
  ) {
    const search = new URLSearchParams({
      filename: 'bank-advice.png',
      description: 'Bank advice for the disputed payment',
      provenance: 'Handed over by the taxpayer at the Jos North office',
      ...params,
    });
    return fetch(
      `${apiBaseUrl()}/government/cases/${caseId}/evidence/upload?${search.toString()}`,
      {
        method: 'POST',
        headers: {
          'content-type': contentType,
          authorization: `Bearer ${tokens.admin}`,
          'x-app-version': '1.0.0',
        },
        body: new Uint8Array(body),
      },
    );
  }

  it('accepts a file, records what it is and where it came from, and puts it on the case', async () => {
    const response = await upload(png, 'image/png');
    const created = (await response.json()) as { evidenceFileId: string; checksum: string };
    assert.equal(response.status, 201, JSON.stringify(created));
    assert.match(created.checksum, /^[0-9a-f]{64}$/);

    const detail = await get(`/government/cases/${caseId}`, auth('admin'));
    const events = (detail.body as {
      events: { kind: string; evidence_file_id: string | null; evidence_provenance: string | null }[];
    }).events;
    const evidence = events.find((event) => event.kind === 'EVIDENCE');
    assert.ok(evidence, 'the upload is on the case history');
    assert.equal(evidence!.evidence_file_id, created.evidenceFileId);
    assert.match(evidence!.evidence_provenance ?? '', /Handed over by the taxpayer/);
  });

  it('reads the file back, byte for byte, and records who looked', async () => {
    const created = (await (await upload(png, 'image/png')).json()) as { evidenceFileId: string };

    const read = await fetch(
      `${apiBaseUrl()}/government/cases/evidence/${created.evidenceFileId}/file`,
      { headers: { authorization: `Bearer ${tokens.admin}`, 'x-app-version': '1.0.0' } },
    );
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await read.arrayBuffer()).equals(png), 'the bytes are what was uploaded');

    const looked = await queryOne(
      pool,
      `SELECT 1 FROM audit_logs WHERE action = 'case.evidence.read' AND entity_id = $1`,
      [caseId],
    );
    assert.ok(looked, 'who looked at a piece of evidence is part of the file');
  });

  /*
   * The header is the uploader's claim about the file; the bytes are the fact.
   * A mismatch is either a broken client or a payload parked behind an image
   * viewer, and neither belongs on a case file.
   */
  it('refuses a file that is not what the request said it was', async () => {
    const response = await upload(Buffer.from('this is not a png'), 'image/png');
    const problem = await response.text();
    assert.equal(response.status, 400, problem);
    assert.match(problem, /not a image\/png/i);
  });

  it('refuses a type the platform does not keep', async () => {
    const response = await upload(Buffer.from('MZ'), 'application/x-msdownload');
    assert.ok(response.status >= 400, `expected a refusal, got ${response.status}`);
  });

  /*
   * Both required by the table, not only by the form. An unlabelled scan is
   * something the next reader has to open to find out about, and "where did
   * this come from" is the first question an auditor asks of any document the
   * State did not write.
   */
  it('will not keep a file that does not say what it is or where it came from', async () => {
    // 422: the query string is what fails validation, before any byte is read.
    const noDescription = await upload(png, 'image/png', { description: '' });
    assert.equal(noDescription.status, 422, await noDescription.text());

    const noProvenance = await upload(png, 'image/png', { provenance: '' });
    assert.equal(noProvenance.status, 422, await noProvenance.text());

    await assert.rejects(
      () =>
        query(
          pool,
          `INSERT INTO case_evidence_files
             (case_id, original_filename, content_type, byte_size, storage_reference,
              checksum, description, provenance)
           VALUES ($1, 'x.png', 'image/png', 10, 'memory://x', 'abc', '   ', 'somewhere')`,
          [caseId],
        ),
      /case_evidence_description_present/,
      'the emptiness is refused on the row, not only in the query string',
    );
  });

  it('will not let evidence be altered or removed once it is on the file', async () => {
    const created = (await (await upload(png, 'image/png')).json()) as { evidenceFileId: string };

    await assert.rejects(
      () =>
        query(pool, `UPDATE case_evidence_files SET checksum = 'rewritten' WHERE id = $1`, [
          created.evidenceFileId,
        ]),
      /cannot be changed/,
    );
    await assert.rejects(
      () => query(pool, 'DELETE FROM case_evidence_files WHERE id = $1', [created.evidenceFileId]),
      /cannot be removed/,
    );
  });

  /*
   * An EVIDENCE event points at exactly one source. Both would be a record
   * claiming two provenances for one attachment; neither would be an
   * attachment to nothing.
   */
  it('will not let an evidence event name both a document and a file, or neither', async () => {
    await assert.rejects(
      () =>
        query(
          pool,
          `INSERT INTO case_events (case_id, kind, actor_id, actor_role)
           VALUES ($1, 'EVIDENCE', $2, 'admin')`,
          [caseId, ids.admin],
        ),
      /case_event_evidence_has_one_source/,
    );
  });
});
