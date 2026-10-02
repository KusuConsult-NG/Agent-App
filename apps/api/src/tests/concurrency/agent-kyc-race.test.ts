/**
 * Two identity checks for one agent at the same moment, and a comment that
 * said it was already safe.
 *
 * `submitKyc` supersedes the agent's current `agent_kyc` row and inserts a new
 * one, numbered `MAX(attempt_number) + 1`. The comment above it read:
 *
 *   Numbered in the same transaction that supersedes, so two submissions
 *   racing cannot claim one attempt number.
 *
 * One transaction is not one lock. Under READ COMMITTED the second
 * submission's UPDATE blocks on the row the first locked; when the first
 * commits, the predicate `superseded_at IS NULL` is re-evaluated against a row
 * that is now superseded, so it matches nothing and updates nothing. The insert
 * that follows puts a second row with `superseded_at IS NULL` against one
 * agent, and `idx_agent_kyc_current` refuses it — which reaches the applicant
 * as an instruction to supersede the current check before recording another.
 *
 * An applicant tapping submit twice on a slow connection is the ordinary way
 * in. The provider call sits outside the transaction, so the window is as wide
 * as the identity service is slow.
 *
 * These are written to fail with the lock removed and pass with it, which is
 * the only way to tell a race that was fixed from a comment that was right.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import * as agents from '../../services/agents';

let agentId = '';
let officerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/*
 * An applicant who has applied and done nothing else.
 *
 * Not `seedDemoAgent`, which runs the whole clearance pipeline — including the
 * identity check — so `submitKyc` refuses it with `KYC_ALREADY_CLEARED`. That
 * is the pre-check doing its job, and it is not the race. The first version of
 * this test used the demonstration agent and read two of those refusals as the
 * race it was looking for.
 */
beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'KYC Race Admin',
    phone: '+2348088100001',
    role: 'admin',
  });
  const lgaId = await firstLgaId();
  const application = await post('/agents/apply', {
    fullName: 'Kyc Race Applicant',
    phone: '+2348088109999',
    password: 'FieldAgent2026',
    address: '4 Rukuba Road, Jos',
    lgaId,
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: 'Kyc Race Applicant',
    accountNumber: '0123456799',
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  agentId = application.body.agentId as string;
});

/** One submission, as the applicant's screen makes it. */
function submit(identityNumber: string) {
  return agents.submitKyc({
    agentId,
    actorId: officerId,
    identityType: 'BVN',
    identityNumber,
  });
}

async function liveChecks(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM agent_kyc
      WHERE agent_id = $1 AND superseded_at IS NULL`,
    [agentId],
  );
  return Number(row!.n);
}

describe('two identity checks submitted at once', () => {
  it('leaves exactly one current check and refuses neither', async () => {
    const results = await Promise.allSettled([submit('22200000001'), submit('22200000002')]);

    const rejected = results.filter((r) => r.status === 'rejected');
    assert.deepEqual(
      rejected.map((r) => String((r as PromiseRejectedResult).reason)),
      [],
      'an applicant tapping submit twice is not a duplicate record. A refusal here means ' +
        'the second submission reached `idx_agent_kyc_current` and was told to supersede ' +
        'the current check first, which is an instruction about a table',
    );
    assert.equal(await liveChecks(), 1, 'one agent, one current identity check');
  });

  it('gives the two attempts different numbers', async () => {
    await Promise.allSettled([submit('22200000003'), submit('22200000004')]);

    const attempts = await query<{ attempt_number: number }>(
      pool,
      'SELECT attempt_number FROM agent_kyc WHERE agent_id = $1 ORDER BY attempt_number',
      [agentId],
    );
    const numbers = attempts.map((row) => row.attempt_number);
    assert.equal(
      new Set(numbers).size,
      numbers.length,
      `two submissions claimed one attempt number: ${numbers.join(', ')}. This is what the ` +
        'comment above `submitKyc` claimed one transaction prevented',
    );
  });

  /*
   * Eight at once, past the pool size.
   *
   * The applicant's screen cannot produce eight, but a retry loop on a flaky
   * connection can, and a lock that orders two while deadlocking eight would
   * pass everything above.
   */
  it('holds when eight arrive together', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => submit(`2220000001${i}`)),
    );
    assert.deepEqual(
      results.filter((r) => r.status === 'rejected').map((r) =>
        String((r as PromiseRejectedResult).reason),
      ),
      [],
      'none of the eight is refused',
    );
    assert.equal(await liveChecks(), 1);

    const rows = await query<{ attempt_number: number }>(
      pool,
      'SELECT attempt_number FROM agent_kyc WHERE agent_id = $1',
      [agentId],
    );
    assert.equal(
      new Set(rows.map((r) => r.attempt_number)).size,
      rows.length,
      'and every attempt has its own number',
    );
  });
});
