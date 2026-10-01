/**
 * A page size the schema accepted and the database would not.
 *
 * Three officer-facing lists take `?limit=` as a ceiling with no floor —
 * `z.coerce.number().int().max(500).default(100)` — and the value goes
 * straight into `LIMIT $n`. Postgres refuses a negative LIMIT outright, so the
 * refusal arrived as a 500: the platform telling an officer something had gone
 * wrong on the server, when the request was simply not one it accepts. A 500
 * is also the one status an officer cannot act on — it says nothing about what
 * to change — and on this platform it is the status that gets escalated.
 *
 * `limit=0` was worse, because it worked. An empty list came back, and an
 * empty list is indistinguishable from a period in which nothing happened. On
 * the audit log that produced an exported file of no rows, recorded in the
 * audit trail as an export.
 *
 * Which three, and why each matters: the audit log, the reconciliation
 * exception queue, and the fraud flag list. All three are read when somebody
 * is already looking for something that went wrong.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';

const PHONE = '+2348082000001';
let token: string;

/** An auditor holds all three permissions these endpoints ask for. */
const PATHS = [
  '/government/audit',
  '/government/reconciliation/exceptions',
  '/government/fraud/flags',
];

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'List Reader', phone: PHONE, role: 'auditor' });
  token = (await loginAs(PHONE)).accessToken;
});

describe('a page size that is not a page size', () => {
  /*
   * Refused the way a word is refused, rather than against a number written
   * down here.
   *
   * `?limit=abc` has always been a validation failure on these routes, so it
   * is the reference: a page size of minus one is the same kind of wrong, and
   * saying so this way means the test holds if the platform ever changes which
   * status it refuses validation with. It is 422 today, and the first version
   * of this test asserted 400 and failed against a working fix.
   */
  async function refusalFor(path: string, limit: string) {
    const response = await get(`${path}?limit=${limit}`, { token });
    return { status: response.status, code: (response.body as any)?.error?.code };
  }

  for (const path of PATHS) {
    it(`refuses a negative limit on ${path} rather than failing on it`, async () => {
      // Before this, Postgres refused `LIMIT -1` and the refusal reached the
      // officer as a 500 with a support reference: the platform saying the
      // fault was its own, about a request it had simply never accepted.
      const word = await refusalFor(path, 'abc');
      const negative = await refusalFor(path, '-1');

      assert.equal(word.code, 'VALIDATION_FAILED', 'the reference case still holds');
      assert.deepEqual(negative, word, JSON.stringify(negative));
    });

    it(`refuses a limit of nothing on ${path}, rather than answering with nothing`, async () => {
      /*
       * `limit=0` was the worse of the two, because it succeeded. An empty
       * list came back, and an empty list is indistinguishable from a period
       * in which nothing happened — on the audit log, an exported file of no
       * rows, recorded in the trail as an export.
       */
      const zero = await refusalFor(path, '0');
      assert.deepEqual(zero, await refusalFor(path, 'abc'), JSON.stringify(zero));
    });

    it(`still answers a limit that is a limit on ${path}`, async () => {
      // The guard: a schema that refused everything would pass both checks
      // above and take three working screens away.
      const response = await get(`${path}?limit=5`, { token });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.ok(Array.isArray(response.body), 'and it is still a list');
    });
  }
});
