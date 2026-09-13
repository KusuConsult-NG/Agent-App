/**
 * A notification may claim delivery only alongside whoever delivered it.
 *
 * This platform's worst failure so far was a record asserting something that
 * had not happened, and it happened here. `dispatchQueued` used to mark every
 * notification SENT with a fabricated reference — `mock-<id>` — whether or not
 * a provider had been configured, let alone contacted. Nothing reached a
 * citizen and the table said otherwise. For a person who holds no account and
 * whose only copy of their receipt is that SMS, the table saying otherwise is
 * the whole of the harm.
 *
 * Migration 011 was written to close it, and its header names the remedy in
 * one word:
 *
 *   "`provider` is what makes that UNREPRESENTABLE going forward: a row can
 *    only claim SENT alongside the name of the service that accepted it."
 *
 * It added `provider TEXT`. Nullable, with no CHECK and no trigger. Nothing
 * was unrepresentable: a row claiming SENT, with a `sent_at` and a plausible
 * gateway reference and no gateway at all, inserted cleanly against the UAT
 * database with no service involved. `PRD-TRACEABILITY.md` meanwhile relayed
 * the promise to a government as "`notifications.provider` NOT NULL for SENT",
 * a constraint no migration had written — and every other database control
 * that table names is real, which is what made this one worth finding.
 *
 * Migration 080 is that constraint. These tests issue SQL directly and go
 * nowhere near the service, because the service was never the problem: it sets
 * `provider` correctly on every path. A rule that holds only through one
 * function is one UPDATE away from being undone, and this table is a citizen's
 * evidence that they were told.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { query, queryOne } from '../db/pool';

const TRACEABILITY = join(__dirname, '..', '..', '..', '..', 'docs', 'PRD-TRACEABILITY.md');

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});
beforeEach(async () => {
  await resetDatabase();
});

/** Write a notification row straight in, bypassing the service entirely. */
async function insertRow(status: string, provider: string | null, phone: string) {
  return pool.query(
    `INSERT INTO notifications (recipient, event, channel, message, status, provider, sent_at,
                                provider_reference)
     VALUES ($1,'RECEIPT_GENERATED','SMS','PSIRS: your receipt is PSIRS/2026/000999.',$2,$3,
             CASE WHEN $2 = 'SENT' THEN now() ELSE NULL END,
             CASE WHEN $2 = 'SENT' THEN 'looks-real-000999' ELSE NULL END)`,
    [phone, status, provider],
  );
}

describe('what the database refuses, with the service bypassed', () => {
  it('refuses a row that claims it was sent and names nobody', async () => {
    await assert.rejects(
      () => insertRow('SENT', null, '+2348000009001'),
      (error: { constraint?: string; message: string }) => {
        assert.equal(
          error.constraint,
          'notifications_provider_named_when_delivered',
          `refused for the wrong reason: ${error.message}`,
        );
        return true;
      },
      'a citizen\'s only proof of payment must not be able to claim it arrived from nowhere',
    );
  });

  it('refuses the two states that are downstream of being sent', async () => {
    // Nothing writes DELIVERED or READ today. When something does, a message
    // cannot have been read without somebody having delivered it.
    for (const status of ['DELIVERED', 'READ']) {
      await assert.rejects(
        () => insertRow(status, null, `+234800000900${status === 'DELIVERED' ? 2 : 3}`),
        (error: { constraint?: string }) =>
          error.constraint === 'notifications_provider_named_when_delivered',
        `${status} is downstream of SENT and must carry the same obligation`,
      );
    }
  });

  it('allows every shape the delivery sweep actually produces', async () => {
    /*
     * The control, and it is not decoration: a constraint that also refused
     * these would stop the queue working. Each of the four is a real outcome
     * of `dispatchQueued`.
     */
    const shapes: [string, string | null, string][] = [
      ['QUEUED', null, 'nothing has been asked to deliver it yet'],
      ['QUEUED', 'termii', 'the provider was tried and could not be reached — still owed'],
      ['FAILED', null, 'no provider owns that channel, or one threw before answering'],
      ['FAILED', 'termii', 'the provider answered and refused it'],
    ];
    for (const [index, [status, provider, why]] of shapes.entries()) {
      await insertRow(status, provider, `+23480000091${String(index).padStart(2, '0')}`);
    }
    const rows = await query<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM notifications',
    );
    assert.equal(rows[0]!.count, String(shapes.length), shapes.map(([, , why]) => why).join('; '));
  });

  it('lets a row claim it was sent when it can say who sent it', async () => {
    await insertRow('SENT', 'termii', '+2348000009200');
    const row = await queryOne<{ status: string; provider: string }>(
      pool,
      'SELECT status, provider FROM notifications',
    );
    assert.equal(row!.status, 'SENT');
    assert.equal(row!.provider, 'termii');
  });
});

describe('what the traceability table tells a government about the database', () => {
  /*
   * PRD-TRACEABILITY.md is read by people deciding whether to rely on this
   * platform, and several of its rows answer "how is this enforced" by naming
   * a database object. A row naming one that does not exist is worse than a
   * row naming nothing, because it stops the reader looking further.
   *
   * This checks the two shapes the table actually uses. It cannot check prose,
   * and says so rather than implying a coverage it does not have — but the
   * claim that went wrong was of the second shape, and would have been caught
   * here on the day it was written.
   */
  const document = () => readFileSync(TRACEABILITY, 'utf8');

  it('names no trigger or constraint that the database does not have', async () => {
    const triggers = [...document().matchAll(/`([a-z][a-z0-9_]+)`\s+trigger/g)].map((m) => m[1]!);
    const constraints = [...document().matchAll(/`([a-z][a-z0-9_]+)`\s+CHECK/g)].map((m) => m[1]!);
    assert.ok(
      triggers.length + constraints.length >= 3,
      `expected the table to cite database objects, found ${triggers.length + constraints.length}`,
    );

    const present = new Set([
      ...(
        await query<{ name: string }>(
          pool,
          'SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal',
        )
      ).map((row) => row.name),
      ...(
        await query<{ name: string }>(pool, 'SELECT conname AS name FROM pg_constraint')
      ).map((row) => row.name),
    ]);

    const missing = [...triggers, ...constraints].filter((name) => !present.has(name));
    assert.deepEqual(
      missing,
      [],
      `cited by name and absent from the database: ${missing.join(', ')}`,
    );
  });

  it('claims NOT NULL only where the database actually refuses NULL', async () => {
    /*
     * The shape that went wrong: "`notifications.provider` NOT NULL for SENT",
     * against a nullable column with no constraint.
     *
     * "NOT NULL for <STATE>" is a conditional, so `information_schema` cannot
     * answer it — a column that is NOT NULL outright would satisfy the claim
     * and so would a CHECK conditioned on the state. Both are asked for here:
     * the column must exist, and either be NOT NULL or carry a constraint
     * naming it and the state.
     */
    const claims = [
      ...document().matchAll(/`([a-z_]+)\.([a-z_]+)`\s+NOT NULL(?:\s+for\s+([A-Z_]+))?/g),
    ].map((match) => ({ table: match[1]!, column: match[2]!, state: match[3] ?? null }));

    /*
     * Zero is allowed, and this test is kept anyway.
     *
     * The row that went wrong has since been rewritten to name the constraint
     * instead — which the test above checks, and which is the better shape —
     * so there may be no claim of this form left to check. Deleting the branch
     * would mean the next person to write "`x.y` NOT NULL" in prose gets no
     * check at all, which is precisely how the last one survived. The
     * non-vacuity assertion lives in the test above, on the total.
     */

    const unmet: string[] = [];
    for (const claim of claims) {
      const column = await queryOne<{ is_nullable: string }>(
        pool,
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [claim.table, claim.column],
      );
      if (!column) {
        unmet.push(`${claim.table}.${claim.column} does not exist`);
        continue;
      }
      if (column.is_nullable === 'NO') continue;

      const guarded = await queryOne<{ definition: string }>(
        pool,
        `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
          WHERE c.conrelid = $1::regclass AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) LIKE '%' || $2 || '%'
            AND ($3::text IS NULL OR pg_get_constraintdef(c.oid) LIKE '%' || $3 || '%')
          LIMIT 1`,
        [claim.table, claim.column, claim.state],
      );
      if (!guarded) {
        unmet.push(
          `${claim.table}.${claim.column} is nullable and no CHECK mentions it` +
            (claim.state ? ` together with ${claim.state}` : ''),
        );
      }
    }

    assert.deepEqual(
      unmet,
      [],
      `the table says the database enforces these and it does not:\n${unmet.join('\n')}`,
    );
  });
});
