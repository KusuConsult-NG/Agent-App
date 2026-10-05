/**
 * A transaction that saved nothing does not get to report that it saved.
 *
 * PostgreSQL abandons a transaction at its first failed statement. Catching
 * the error in TypeScript does not un-fail it: the COMMIT that follows succeeds
 * as a command and performs a ROLLBACK, raising nothing. `withTransaction`
 * returned normally after that, so any callback that caught a database error
 * and carried on — which is what "best-effort" code inside a transaction looks
 * like — reported success for work that was thrown away.
 *
 * Measured before the fix: a row written, a failing statement caught, the
 * callback returned, `withTransaction` resolved, and the row was not there.
 * The support desk was the live case — `support-tickets.test.ts` has it end to
 * end — but the trap is in the helper, so it is held here, at the helper.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withSavepoint, withTransaction } from '../db/pool';

const count = async (): Promise<number> =>
  (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM savepoint_probe')).rows[0]!.n;
const values = async (): Promise<number[]> =>
  (await pool.query<{ v: number }>('SELECT v FROM savepoint_probe ORDER BY v')).rows.map((r) => r.v);

before(async () => {
  await pool.query('CREATE TABLE IF NOT EXISTS savepoint_probe (v int NOT NULL)');
});
beforeEach(async () => {
  await pool.query('TRUNCATE savepoint_probe');
});
after(async () => {
  await pool.query('DROP TABLE IF EXISTS savepoint_probe');
});

describe('a transaction PostgreSQL rolled back', () => {
  it('is an error, not a success, when the failure inside it was caught', async () => {
    await assert.rejects(
      withTransaction(async (client) => {
        await client.query('INSERT INTO savepoint_probe VALUES (1)');
        try {
          await client.query('SELECT 1/0');
        } catch {
          // The shape of best-effort code: carry on as if nothing happened.
        }
        return 'saved';
      }),
      /rolled the whole transaction back/,
    );
    assert.equal(await count(), 0, 'and it saved nothing, which is what the error says');
  });

  it('still commits an ordinary transaction', async () => {
    // The control: the check must not turn every commit into a refusal.
    const result = await withTransaction(async (client) => {
      await client.query('INSERT INTO savepoint_probe VALUES (1)');
      return 'saved';
    });
    assert.equal(result, 'saved');
    assert.equal(await count(), 1);
  });
});

describe('work allowed to fail inside a transaction', () => {
  it('undoes only itself, and the transaction around it is kept', async () => {
    await withTransaction(async (client) => {
      await client.query('INSERT INTO savepoint_probe VALUES (1)');
      try {
        await withSavepoint(client, async () => {
          await client.query('INSERT INTO savepoint_probe VALUES (2)');
          await client.query('SELECT 1/0');
        });
      } catch {
        // Best-effort, and now safely so.
      }
      await client.query('INSERT INTO savepoint_probe VALUES (3)');
    });
    assert.deepEqual(await values(), [1, 3], 'the failed work is undone and nothing else is');
  });

  it('hands its failure to the caller rather than hiding it', async () => {
    await withTransaction(async (client) => {
      await assert.rejects(
        withSavepoint(client, () => client.query('SELECT 1/0')),
        /division by zero/,
      );
    });
  });

  it('keeps what it did, and returns what it made, when it succeeds', async () => {
    const made = await withTransaction((client) =>
      withSavepoint(client, async () => {
        await client.query('INSERT INTO savepoint_probe VALUES (7)');
        return 'made';
      }),
    );
    assert.equal(made, 'made');
    assert.deepEqual(await values(), [7]);
  });
});
