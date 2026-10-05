/**
 * Two captures of one identity document at the same moment.
 *
 * `storeKycDocument` supersedes the current capture of a document type and
 * inserts the new one, in one transaction. That is the shape `submitKyc` had
 * before `agent-kyc-race.test.ts`: under READ COMMITTED the second capture's
 * UPDATE waits on the row the first locked, finds it superseded once the first
 * commits, updates nothing, and inserts beside it. And here nothing refused
 * the result, because `idx_kyc_docs_current` is not unique.
 *
 * So an applicant who taps "use this photo" twice on a slow connection is left
 * with two current selfies, and the reviewer is shown both as the document to
 * decide on. Measured before the fix: two current rows in most rounds.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstLgaId,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import * as kycDocuments from '../../services/kyc-documents';

let agentId = '';
let applicantUserId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  const application = await post('/agents/apply', {
    fullName: 'Capture Race Applicant',
    phone: '+2348088209999',
    password: 'FieldAgent2026',
    address: '6 Rukuba Road, Jos',
    lgaId: await firstLgaId(),
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: 'Capture Race Applicant',
    accountNumber: '0123456788',
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  agentId = application.body.agentId as string;
  applicantUserId = (await queryOne<{ user_id: string }>(
    pool,
    'SELECT user_id FROM agents WHERE id = $1',
    [agentId],
  ))!.user_id;
});

/** A JPEG as far as the signature check is concerned, different each time. */
function photo(round: number, which: number): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`selfie-${round}-${which}`)]);
}

function capture(round: number, which: number) {
  return kycDocuments.storeKycDocument({
    agentId,
    documentType: 'SELFIE',
    declaredContentType: 'image/jpeg',
    bytes: photo(round, which),
    captureSource: 'CAMERA',
    actorId: applicantUserId,
  });
}

async function currentSelfies(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM kyc_documents
      WHERE agent_id = $1 AND document_type = 'SELFIE' AND superseded_at IS NULL`,
    [agentId],
  );
  return Number(row!.n);
}

describe('two captures of one document at once', () => {
  it('leaves one current capture, never two', async () => {
    for (let round = 0; round < 8; round += 1) {
      const outcomes = await Promise.allSettled([capture(round, 1), capture(round, 2)]);
      for (const outcome of outcomes) {
        assert.equal(
          outcome.status,
          'fulfilled',
          `a capture was refused: ${outcome.status === 'rejected' ? String(outcome.reason) : ''}`,
        );
      }
      assert.equal(await currentSelfies(), 1, `round ${round} left more than one current selfie`);
    }
  });

  it('keeps every capture, superseded, so what a reviewer saw stays readable', async () => {
    await Promise.all([capture(0, 1), capture(0, 2)]);
    const row = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM kyc_documents WHERE agent_id = $1 AND document_type = 'SELFIE'`,
      [agentId],
    );
    assert.equal(row!.n, '2');
  });

  /*
   * The lock is what makes the service right; this is what makes it true for
   * anything that writes the table without going through the service.
   */
  it('is refused at the database, for a second current capture written directly', async () => {
    await capture(0, 1);
    await assert.rejects(
      pool.query(
        `INSERT INTO kyc_documents
           (agent_id, document_type, storage_reference, content_type, byte_size, checksum,
            capture_source, uploaded_by)
         VALUES ($1, 'SELFIE', 'kyc/direct-write', 'image/jpeg', 10, repeat('0', 64), 'CAMERA', $2)`,
        [agentId, applicantUserId],
      ),
      /idx_kyc_docs_one_current_per_agent/,
    );
  });
});
