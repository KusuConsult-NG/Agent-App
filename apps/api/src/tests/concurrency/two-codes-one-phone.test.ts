/**
 * Two requests for a code to one phone, at the same moment.
 *
 * `requestOtp` sends a number at most one code a minute for each purpose
 * (`a-phone-asked-too-often`). It reads how recently the number was sent one
 * and then sends, so two requests together would both find the minute empty
 * and both send. The lock on the number makes the second wait and then see
 * the first.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase, startTestServer, stopTestServer } from '../helpers';
import { seedReferenceData } from '../../db/seed';
import { requestOtp } from '../../services/auth';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});
beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
});

describe('two requests for a code to one phone at once', () => {
  it('sends one code, never two', async () => {
    for (let round = 0; round < 8; round += 1) {
      const phone = `+23480310${String(round).padStart(5, '0')}`;
      const outcomes = await Promise.all([
        requestOtp({ destination: phone, purpose: 'CITIZEN_STATEMENT' }),
        requestOtp({ destination: phone, purpose: 'CITIZEN_STATEMENT' }),
      ]);
      assert.deepEqual(
        outcomes.map((outcome) => outcome.sent).sort(),
        [false, true],
        `round ${round}: ${JSON.stringify(outcomes.map((o) => o.sent))}`,
      );

      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM notifications WHERE recipient = $1 AND channel = 'SMS'`,
        [phone],
      );
      assert.equal(rows[0]!.n, '1', `round ${round} sent the phone ${rows[0]!.n} codes`);
    }
  });
});
