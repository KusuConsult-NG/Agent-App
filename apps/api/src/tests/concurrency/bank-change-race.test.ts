/**
 * Two requests to change where an agent's commission is paid, at once.
 *
 * `bank_accounts` carries two partial unique indexes — one ACTIVE account per
 * owner, one PROPOSED account per owner — and `70fd48e` gave both a message,
 * on the reasoning that a Hausa-reading agent would otherwise be shown the
 * generic duplicate sentence in English. That reasoning assumed the constraint
 * could be reached. This establishes whether it can, because a message on an
 * unreachable constraint is exactly the thing this branch keeps finding: words
 * nobody will ever read, which no test fails for.
 *
 * WHY IT MIGHT NOT BE REACHABLE. `requestBankAccountChange` runs in one
 * transaction that opens with `SELECT ... FROM agents ... FOR UPDATE OF a`,
 * then looks for an existing PROPOSED row and refuses with
 * `BANK_CHANGE_ALREADY_PENDING` if it finds one. If the lock orders two
 * requests, the second one's pre-check sees the first one's row and refuses
 * before reaching the index.
 *
 * TWO CALLERS, NOT ONE REPEATED. The agent's own route and an officer's route
 * both reach the same function, so the race is an ordinary Tuesday: an agent
 * taps the button while an officer raises the same change on their behalf after
 * a phone call. Both are driven directly rather than through HTTP, because the
 * step-up code each route requires is not what is under test.
 *
 * WHAT THE ASSERTION IS. Not "one of them failed" — the refund race on this
 * branch taught that a test which commits one side and then awaits the other
 * proves only its own scheduling. Here both run concurrently and the
 * assertions are on the invariant and on WHICH refusal the loser got: one
 * PROPOSED row, and a refusal that names the pending change rather than a
 * duplicate record. Those two differ exactly when the lock stops working.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { seedDemoAgent } from '../../db/seed-agent';
import * as agents from '../../services/agents';
import { AppError } from '../../lib/errors';

let agentId = '';
let officerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Bank Race Admin',
    phone: '+2348086100001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent did not seed');
  agentId = demo!.agentId;
});

/** One request to move the account, as either route would make it. */
function request(accountNumber: string, actorRole: 'agent' | 'admin') {
  return agents.requestBankAccountChange({
    agentId,
    actorId: officerId,
    actorRole,
    bankName: 'Zenith Bank',
    bankCode: '057',
    accountName: 'DEMO AGENT',
    accountNumber,
    reason: 'The bank closed the account the commission was going to.',
  });
}

async function proposals(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM bank_accounts
      WHERE owner_type = 'AGENT' AND owner_id = $1 AND status = 'PROPOSED'`,
    [agentId],
  );
  return Number(row!.n);
}

describe('two requests to move one agent’s account', () => {
  it('leaves one proposal, and refuses the other by name', async () => {
    const [a, b] = await Promise.allSettled([
      request('0123456701', 'agent'),
      request('0123456702', 'admin'),
    ]);

    assert.equal(await proposals(), 1, 'exactly one change can be waiting at a time');

    const settled = [a, b];
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'one of the two was accepted');
    assert.equal(rejected.length, 1, 'and one was refused');

    /*
     * One assertion carrying the whole story, because the two outcomes differ
     * in kind and not only in wording.
     *
     * With the lock, the loser's pre-check sees the winner's row and raises
     * `BANK_CHANGE_ALREADY_PENDING` — an AppError that names the pending change
     * and what to do about it.
     *
     * Without it, both pre-checks pass and the partial unique index refuses the
     * second insert. Measured, by removing `FOR UPDATE OF a` and running this:
     * the loser gets the raw PostgreSQL 23505, because this test drives the
     * service and the error handler that would turn it into DUPLICATE_RECORD is
     * upstream. So an agent would meet "that record already exists" and an
     * `instanceof` check alone would report only that something else happened.
     * Reporting the code puts the cause in the failure.
     */
    const reason = (rejected[0] as PromiseRejectedResult).reason as {
      code?: string;
      message?: string;
    };
    assert.equal(
      reason?.code,
      'BANK_CHANGE_ALREADY_PENDING',
      `the loser was refused with ${reason?.code ?? String(reason)} — ${
        reason?.message ?? ''
      }. Anything else means the row lock has stopped ordering the two requests and ` +
        'the partial unique index is the only thing left refusing, which reaches the ' +
        'agent as a duplicate record rather than as a change already waiting',
    );
    assert.ok(reason instanceof AppError, 'and it is a refusal the platform composed');
  });

  it('still refuses a second request once the first has committed', async () => {
    await request('0123456703', 'agent');
    await assert.rejects(
      request('0123456704', 'admin'),
      (error: unknown) =>
        error instanceof AppError && error.code === 'BANK_CHANGE_ALREADY_PENDING',
    );
    assert.equal(await proposals(), 1);
  });

  /*
   * And the account the money is going to has not moved.
   *
   * The refusal matters because of this: a proposal is not a change, and
   * neither of the two requests may touch the ACTIVE account. An agent whose
   * commission went to a new account on the strength of a refused request is
   * the failure this whole flow exists to prevent.
   */
  it('does not move the active account', async () => {
    const before = await queryOne<{ id: string; account_number: string }>(
      pool,
      `SELECT id, account_number FROM bank_accounts
        WHERE owner_type = 'AGENT' AND owner_id = $1 AND status = 'ACTIVE'`,
      [agentId],
    );
    assert.ok(before, 'the demonstration agent has an active account to begin with');

    await Promise.allSettled([
      request('0123456705', 'agent'),
      request('0123456706', 'admin'),
    ]);

    const active = await query<{ id: string; account_number: string }>(
      pool,
      `SELECT id, account_number FROM bank_accounts
        WHERE owner_type = 'AGENT' AND owner_id = $1 AND status = 'ACTIVE'`,
      [agentId],
    );
    assert.equal(active.length, 1, 'still exactly one account in use');
    assert.equal(active[0]!.id, before!.id, 'and it is the one that was in use before');
    assert.equal(active[0]!.account_number, before!.account_number);
  });
});
