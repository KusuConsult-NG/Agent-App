/**
 * Only an actual exception can be resolved.
 *
 * `exceptionQueue` states exactly what an exception is — five statuses, and
 * only rows not already reconciled:
 *
 *   AND r.reconciled_at IS NULL
 *   AND r.status IN ('MISSING_PAYMENT','MISSING_PLATFORM_TRANSACTION',
 *                    'AMOUNT_MISMATCH','DUPLICATE_PAYMENT','PENDING_SETTLEMENT')
 *
 * `resolveException` enforced neither half. It looked the record up, read its
 * status only to quote in the audit entry, and then set RESOLVED on whatever
 * it had found. The read side knew what an exception was; the write side took
 * any record id at all.
 *
 * Three things that let through, in rising order of harm:
 *
 * A MATCHED record — one the sweep positively reconciled — could be relabelled
 * RESOLVED, which is a worse description of the same row.
 *
 * A record already RESOLVED could be resolved again, overwriting
 * `resolution_note`, `reconciled_by` and `reconciled_at`. The first officer's
 * name and reason are then gone from the record itself. The audit chain still
 * holds the change, but the row no longer shows who answered for it.
 *
 * An UNCHECKED record could be marked RESOLVED. UNCHECKED exists because the
 * gateway statement could not be fetched, so nothing about that row was ever
 * compared to anything. Resolving it converts "never examined" into "examined
 * and settled", and it will not appear in any queue again. That is the same
 * failure the platform is built to refuse — making an unexamined period look
 * examined — and it is the per-record twin of the deletion gap already
 * recorded against `reconciliation_runs`.
 *
 * Nothing here says an officer may not close a stubborn exception. It says the
 * row has to be an exception first.
 */

import {
  createGovernmentUser,
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

let financeToken = '';
let financeUserId = '';
let runId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  financeUserId = await createGovernmentUser({
    role: 'finance_officer',
    phone: '+2348030000091',
    fullName: 'Reconciliation Officer',
  });
  financeToken = (await loginAs('+2348030000091')).accessToken;

  const run = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO reconciliation_runs (period_start, period_end, gateway, status)
     VALUES (now() - interval '1 day', now(), 'mock', 'COMPLETED') RETURNING id`,
  );
  runId = run!.id;
});

/** A reconciliation record in a chosen state, with no transaction behind it. */
async function recordWith(status: string, extra: { reconciled?: boolean } = {}) {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO reconciliation_records
       (run_id, status, gateway_reference, expected_amount_kobo, received_amount_kobo,
        variance_kobo, resolution_note, reconciled_by, reconciled_at)
     VALUES ($1, $2, $3, 500000, 500000, 0, $4, $5, $6)
     RETURNING id`,
    [
      runId,
      status,
      `REF-${status}-${Date.now()}`,
      extra.reconciled ? 'Closed by the first officer after checking the bank statement.' : null,
      extra.reconciled ? financeUserId : null,
      extra.reconciled ? new Date() : null,
    ],
  );
  return row!.id;
}

const resolve = (id: string) =>
  post(
    `/government/reconciliation/exceptions/${id}/resolve`,
    { resolution: 'Checked against the bank statement and closed.' },
    { token: financeToken },
  );

const statusOf = async (id: string) =>
  (await queryOne<{ status: string; resolution_note: string | null; reconciled_by: string | null }>(
    pool,
    'SELECT status, resolution_note, reconciled_by FROM reconciliation_records WHERE id = $1',
    [id],
  ))!;

describe('resolving a reconciliation exception', () => {
  it('resolves a genuine exception', async () => {
    const id = await recordWith('AMOUNT_MISMATCH');
    const response = await resolve(id);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const after = await statusOf(id);
    assert.equal(after.status, 'RESOLVED');
    assert.equal(after.reconciled_by, financeUserId);
  });

  it('resolves each of the statuses the queue calls an exception', async () => {
    for (const status of [
      'MISSING_PAYMENT',
      'MISSING_PLATFORM_TRANSACTION',
      'AMOUNT_MISMATCH',
      'DUPLICATE_PAYMENT',
      'PENDING_SETTLEMENT',
    ]) {
      const id = await recordWith(status);
      const response = await resolve(id);
      assert.equal(response.status, 200, `${status}: ${JSON.stringify(response.body)}`);
      assert.equal((await statusOf(id)).status, 'RESOLVED', status);
    }
  });

  it('refuses a record that was never compared to anything', async () => {
    // UNCHECKED means the gateway statement could not be fetched, so this row
    // was never matched against anything. Resolving it would turn "never
    // examined" into "examined and settled" and remove it from every queue.
    const id = await recordWith('UNCHECKED');
    const response = await resolve(id);

    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(
      (await statusOf(id)).status,
      'UNCHECKED',
      'an unexamined record must stay unexamined',
    );
  });

  it('refuses a record the sweep positively matched', async () => {
    const id = await recordWith('MATCHED');
    const response = await resolve(id);

    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal((await statusOf(id)).status, 'MATCHED');
  });

  it('will not overwrite the officer who already answered for it', async () => {
    const id = await recordWith('AMOUNT_MISMATCH', { reconciled: true });
    const before = await statusOf(id);

    const response = await resolve(id);

    assert.equal(response.status, 409, JSON.stringify(response.body));
    const after = await statusOf(id);
    assert.equal(after.resolution_note, before.resolution_note, 'the first reason must survive');
    assert.equal(after.reconciled_by, before.reconciled_by, 'the first officer must survive');
  });

  it('says which record it could not find', async () => {
    const response = await resolve('00000000-0000-0000-0000-000000000000');
    assert.equal(response.status, 404, JSON.stringify(response.body));
  });
});
