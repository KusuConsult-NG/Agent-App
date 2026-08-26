/**
 * Identity document capture.
 *
 * `kyc_documents` existed from the second migration and nothing ever wrote to
 * it, because there was no upload path anywhere in the platform: an agent's
 * identity was cleared on a number they typed. These tests cover the path that
 * now exists, and they are mostly about refusals, because what is stored here
 * is a photograph of somebody's national identity card or of their face.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  apiBaseUrl,
} from './helpers';
import { queryOne, query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

/** A real PNG, so the signature check has something true to accept. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080200000090775' +
    '3de0000000c4944415408d763f8cfc0000003010100b5d3a4b70000000049454e44ae426082',
  'hex',
);
/** A real PDF header, for the documents a scanner produces rather than a camera. */
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n', 'ascii'),
  Buffer.alloc(256, 0x20),
  Buffer.from('\n%%EOF\n', 'ascii'),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(512, 0x7a),
  Buffer.from([0xff, 0xd9]),
]);

let agentToken = '';
let agentId = '';
let adminToken = '';
let device = '';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Doc Test Admin', phone: '+2348000000001', role: 'admin' });

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  device = demo!.deviceIdentifier;
  agentId = (await queryOne<{ id: string }>(
    pool,
    'SELECT a.id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  ))!.id;
  adminToken = (await loginAs('+2348000000001')).accessToken;
});

/** Upload bytes exactly as the field application does: the file is the body. */
async function upload(
  bytes: Buffer,
  contentType: string,
  options: { type?: string; token?: string; source?: string } = {},
) {
  const response = await fetch(
    `${apiBaseUrl()}/agents/me/kyc/documents?type=${options.type ?? 'IDENTITY_DOCUMENT'}&captureSource=${options.source ?? 'CAMERA'}`,
    {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-device-id': device,
        'x-app-version': '1.0.0',
        ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? agentToken}` }),
      },
      body: bytes,
    },
  );
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

describe('An identity document is what it says it is', () => {
  it('accepts a genuine image and records what was stored', async () => {
    const result = await upload(PNG, 'image/png');
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.contentType, 'image/png');
    assert.equal(result.body.byteSize, PNG.length);
    assert.match(result.body.checksum, /^[0-9a-f]{64}$/, 'the checksum of the stored bytes');
  });

  it('refuses a payload wearing an image content type', async () => {
    // The header is the uploader's claim. Someone storing a script behind a
    // reviewer's image viewer would send exactly this.
    const result = await upload(Buffer.from('<?php system($_GET["c"]); ?>'), 'image/jpeg');
    assert.equal(result.status, 400);
    assert.match(result.body.error.message, /not a image\/jpeg/i);

    const stored = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM kyc_documents',
    );
    assert.equal(stored?.count, '0', 'and nothing was written');
  });

  it('refuses a type PSIRS does not accept, saying which are accepted', async () => {
    const result = await upload(PNG, 'application/zip');
    assert.equal(result.status, 400);
    assert.match(result.body.error.message, /image\/jpeg/, 'names what it will take');
  });

  it('refuses an empty capture', async () => {
    const result = await upload(Buffer.alloc(0), 'image/png');
    assert.equal(result.status, 400);
    assert.match(result.body.error.message, /empty/i);
  });

  it('refuses an unauthenticated upload', async () => {
    const result = await upload(PNG, 'image/png', { token: null as unknown as string });
    assert.equal(result.status, 401);
  });
});

describe('A captured document is evidence, so it is never overwritten', () => {
  it('supersedes the previous capture rather than replacing its bytes', async () => {
    const first = await upload(PNG, 'image/png');
    const second = await upload(JPEG, 'image/jpeg');
    assert.equal(second.status, 201);

    const rows = await query<{ id: string; superseded_at: Date | null; checksum: string }>(
      pool,
      'SELECT id, superseded_at, checksum FROM kyc_documents WHERE agent_id = $1 ORDER BY uploaded_at',
      [agentId],
    );
    assert.equal(rows.length, 2, 'both captures are kept');
    assert.ok(rows[0]!.superseded_at, 'the first is marked superseded');
    assert.equal(rows[1]!.superseded_at, null, 'the second is current');
    assert.notEqual(rows[0]!.checksum, rows[1]!.checksum, 'and the original bytes are untouched');
  });

  it('refuses to review a superseded capture', async () => {
    const first = await upload(PNG, 'image/png');
    await upload(JPEG, 'image/jpeg');

    const review = await post(
      `/agents/kyc/documents/${first.body.documentId}/review`,
      { decision: 'ACCEPT', reason: 'Looks fine to me.' },
      { token: adminToken },
    );
    assert.equal(review.status, 409);
    assert.equal(review.body.error.code, 'DOCUMENT_SUPERSEDED');
  });
});

describe('Who may see a citizen identity document', () => {
  it('lets government open it and records that they did', async () => {
    const uploaded = await upload(PNG, 'image/png');

    const file = await fetch(`${apiBaseUrl()}/agents/kyc/documents/${uploaded.body.documentId}/file`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(PNG), 'the exact bytes come back');

    const log = await query<{ access_type: string }>(
      pool,
      'SELECT access_type FROM kyc_document_access_logs WHERE document_id = $1 ORDER BY created_at',
      [uploaded.body.documentId],
    );
    assert.deepEqual(
      log.map((entry) => entry.access_type),
      ['UPLOAD', 'VIEW'],
      'every read is recorded, because NDPR requires the question to be answerable',
    );
  });

  it('does not let an agent approve their own document', async () => {
    const uploaded = await upload(PNG, 'image/png');
    const review = await post(
      `/agents/kyc/documents/${uploaded.body.documentId}/review`,
      { decision: 'ACCEPT', reason: 'Approving myself.' },
      { token: agentToken, deviceId: device },
    );
    assert.equal(review.status, 403);
  });

  it('requires a reason for every decision', async () => {
    const uploaded = await upload(PNG, 'image/png');
    const missing = await post(
      `/agents/kyc/documents/${uploaded.body.documentId}/review`,
      { decision: 'ACCEPT' },
      { token: adminToken },
    );
    assert.equal(missing.status, 422);

    const given = await post(
      `/agents/kyc/documents/${uploaded.body.documentId}/review`,
      { decision: 'REJECT', reason: 'The photograph is too dark to read the number.' },
      { token: adminToken },
    );
    assert.equal(given.status, 200);

    const row = await queryOne<{ verification_status: string; rejection_reason: string }>(
      pool,
      'SELECT verification_status, rejection_reason FROM kyc_documents WHERE id = $1',
      [uploaded.body.documentId],
    );
    assert.equal(row?.verification_status, 'REJECTED');
    assert.match(row!.rejection_reason, /too dark/, 'the applicant is told what to fix');
  });
});

describe('A rejection is the start of a loop, not a verdict into the void', () => {
  it('reaches the applicant with its reason, so they can submit another', async () => {
    // The officer's decision only means something if the person who submitted
    // the document finds out. The agent app renders verification_status and
    // rejection_reason against each document and offers a re-capture, so this
    // pins the half that carries the reason back.
    const uploaded = await upload(PNG, 'image/png');

    const rejected = await post(
      `/agents/kyc/documents/${uploaded.body.documentId}/review`,
      { decision: 'REJECT', reason: 'The photograph is too dark to read the number.' },
      { token: adminToken },
    );
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.status, 'REJECTED');

    const mine = await get('/agents/me/kyc/documents', { token: agentToken, deviceId: device });
    assert.equal(mine.status, 200);
    const doc = mine.body.documents.find((entry: { id: string }) => entry.id === uploaded.body.documentId);
    assert.equal(doc.verification_status, 'REJECTED');
    assert.match(
      doc.rejection_reason,
      /too dark/,
      'the applicant is told what was wrong, not only that it was refused',
    );
  });

  it('records the review in the access log alongside the reads', async () => {
    const uploaded = await upload(PNG, 'image/png');
    await post(
      `/agents/kyc/documents/${uploaded.body.documentId}/review`,
      { decision: 'ACCEPT', reason: 'Legible and matches the application.' },
      { token: adminToken },
    );

    const log = await query<{ access_type: string }>(
      pool,
      'SELECT access_type FROM kyc_document_access_logs WHERE document_id = $1 ORDER BY created_at',
      [uploaded.body.documentId],
    );
    assert.ok(
      log.some((entry) => entry.access_type === 'REVIEW'),
      'a decision is an access event too — the log answers "who handled this document"',
    );
  });
});

// ---------------------------------------------------------------------------

describe('Every kind of document PSIRS asks an applicant for', () => {
  /**
   * One of the six types was ever uploaded. The other five are asked for by
   * name — a selfie for the liveness check, proof of address, a passport
   * photograph for the identity card, a second identification, and whatever
   * else a reviewer asks for — and each goes through the same signature check
   * and the same supersede rule. A type nobody had stored once is a type
   * nobody knows the storing of, and the applicant would be the one to find
   * out.
   *
   * `captureSource` is walked here too. CAMERA is what the field application
   * sends; FILE is what a desktop browser sends when somebody uploads a scan
   * they already had, and it is the difference between a photograph taken now
   * and a file of unknown age — which is exactly what a reviewer looking at a
   * proof of address needs to know.
   */
  const KINDS = [
    { type: 'SELFIE', bytes: JPEG, contentType: 'image/jpeg', source: 'CAMERA' },
    { type: 'PASSPORT_PHOTOGRAPH', bytes: JPEG, contentType: 'image/jpeg', source: 'CAMERA' },
    { type: 'PROOF_OF_ADDRESS', bytes: PDF, contentType: 'application/pdf', source: 'FILE' },
    { type: 'ADDITIONAL_IDENTIFICATION', bytes: PNG, contentType: 'image/png', source: 'FILE' },
    { type: 'SUPPORTING_DOCUMENT', bytes: PDF, contentType: 'application/pdf', source: 'FILE' },
  ] as const;

  it('stores each one under its own type, alongside the others', async () => {
    for (const kind of KINDS) {
      const stored = await upload(kind.bytes, kind.contentType, {
        type: kind.type,
        source: kind.source,
      });
      assert.equal(stored.status, 201, `${kind.type} was refused: ${JSON.stringify(stored.body)}`);

      const row = await queryOne<{ document_type: string; capture_source: string }>(
        pool,
        'SELECT document_type, capture_source FROM kyc_documents WHERE id = $1',
        [stored.body.documentId],
      );
      assert.equal(row?.document_type, kind.type);
      assert.equal(row?.capture_source, kind.source);
    }

    // Different types stand side by side. Only a second document of the SAME
    // type supersedes, which is the rule a reviewer relies on when they open
    // an application and expect to find all of what was asked for.
    const mine = await get('/agents/me/kyc/documents', { token: agentToken });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    const live = (mine.body.documents as { document_type: string }[]).map((d) => d.document_type);
    for (const kind of KINDS) {
      assert.ok(live.includes(kind.type), `${kind.type} is not in the applicant's own list`);
    }
  });

  it('supersedes only the document of the same type', async () => {
    const first = await upload(JPEG, 'image/jpeg', { type: 'SELFIE' });
    const address = await upload(PDF, 'application/pdf', { type: 'PROOF_OF_ADDRESS', source: 'FILE' });
    const second = await upload(PNG, 'image/png', { type: 'SELFIE' });
    assert.equal(second.status, 201, JSON.stringify(second.body));

    const rows = await query<{ id: string; superseded_at: Date | null }>(
      pool,
      'SELECT id, superseded_at FROM kyc_documents WHERE agent_id = $1',
      [agentId],
    );
    const byId = new Map(rows.map((row) => [row.id, row.superseded_at]));
    assert.notEqual(byId.get(first.body.documentId), null, 'the earlier selfie is superseded');
    assert.equal(byId.get(second.body.documentId), null, 'the later selfie stands');
    assert.equal(byId.get(address.body.documentId), null, 'the proof of address is untouched by it');
  });
});
