/**
 * The three capped answers an officer reads, and whether they say so.
 *
 * `deliver` computes whether a list hit its cap, puts `-PARTIAL` in the
 * filename of every file it writes, and records `complete: false` with the cap
 * in the export log. For `format: 'json'` it threw all of that away. Its own
 * comment said why, and said what that left:
 *
 *   "The screen, which is not a file. It is handed a bare array, and putting
 *    the flag in it would change the shape the two screens read. They still
 *    draw a capped list without saying so; that is a separate gap on a separate
 *    surface and is not closed here."
 *
 * So the export beside the transactions list has said it was partial since
 * `f24a1f6`, and the list above it said nothing — on the same query, in the
 * same card, for the same officer. And three of the six audit answers are
 * capped in their own SQL rather than through `deliver`: 500 entries of who has
 * touched a taxpayer's record, 500 searches of the register, 1000 receipts for
 * one revenue item. An auditor asking who had looked at a record was shown 500
 * rows and nothing to say there were four thousand.
 *
 * WHAT IS ASSERTED, AND WHY THE CAP IS DRIVEN DOWN
 *
 * A test that filled a table past a thousand rows to reach the real cap would
 * be slow and would prove the fixture more than the platform. The transactions
 * and audit endpoints take `limit` as a query parameter, so the cap is reached
 * by asking for a small one — which is the same code path, with the same
 * `limit + 1` read and the same slice.
 *
 * The two audit answers cap inside their own SQL rather than from a query
 * parameter, so the cap is a default argument there and these call the services
 * with a small one. That was not the first version: the first asserted only
 * that a short answer reports `truncated: false`, and the mutation check showed
 * that a service which reported `truncated: false` unconditionally passed it.
 * A test that cannot tell "not capped" from "never says it is capped" is not
 * testing the thing it is named after.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { registerTaxpayer } from '../services/taxpayers';
import * as reports from '../services/reports';
import { createAssessment } from '../services/revenue';

const ADMIN = { fullName: 'Cap Admin', phone: '+2348079400001', role: 'admin' } as const;

let token = '';
let taxpayerId = '';
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
  officerId = await createGovernmentUser(ADMIN);
  token = (await loginAs(ADMIN.phone)).accessToken;

  const lgaId = await firstLgaId();
  const registered = await registerTaxpayer({
    input: {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Capped',
      lastName: 'List',
      phone: '+2348079409999',
      address: '9 Ahmadu Bello Way, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    } as never,
    actorId: officerId,
    actorRole: 'revenue_officer',
  });
  taxpayerId = registered.taxpayerId;

  // Three transactions, so a limit of two leaves one behind.
  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT ri.id FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE r.rate_type = 'FIXED' AND ri.status = 'ACTIVE'
        AND 'INDIVIDUAL' = ANY (ri.applicable_taxpayer_types)
      ORDER BY ri.code LIMIT 1`,
  );
  for (let i = 0; i < 3; i += 1) {
    await createAssessment({
      taxpayerId,
      revenueItemId: item!.id,
      inputs: {},
      actorId: officerId,
      actorRole: 'revenue_officer',
      channel: 'OFFICER',
    });
  }
});

describe('a transactions list that hit its cap', () => {
  it('says so, and returns exactly the cap', async () => {
    const capped = await get('/government/transactions?limit=2', { token });
    assert.equal(capped.status, 200, JSON.stringify(capped.body));
    assert.equal(capped.body.rows.length, 2, 'the row read past the cap is never returned');
    assert.equal(capped.body.truncated, true);
    assert.equal(capped.body.cap, 2, 'and the officer is told the number to narrow against');
  });

  it('says nothing of the sort when the list is all of it', async () => {
    const whole = await get('/government/transactions?limit=50', { token });
    assert.equal(whole.status, 200, JSON.stringify(whole.body));
    assert.equal(whole.body.rows.length, 3);
    assert.equal(whole.body.truncated, false);
    assert.equal(whole.body.cap, null, 'a cap that was not reached is not a cap');
  });

  /*
   * The file and the screen agree.
   *
   * They are the same query in the same card, and the one thing worse than
   * neither of them disclosing the cap is one of them disclosing it: an officer
   * who exports a list they believe is complete, from a screen that told them
   * nothing, now has a file that says PARTIAL and no idea which to trust.
   */
  it('agrees with the file written from the same query', async () => {
    const onScreen = await get('/government/transactions?limit=2', { token });
    const asFile = await get('/government/transactions?limit=2&format=csv', { token });
    assert.equal(asFile.status, 200, JSON.stringify(asFile.body));
    assert.equal(onScreen.body.truncated, true);
    assert.match(
      asFile.headers.get('content-disposition') ?? '',
      /transactions-PARTIAL\.csv/,
      'the screen and the file say the same thing about the same rows',
    );
  });
});

describe('an audit log that hit its cap', () => {
  it('says so', async () => {
    const capped = await get('/government/audit?limit=1', { token });
    assert.equal(capped.status, 200, JSON.stringify(capped.body));
    assert.equal(capped.body.rows.length, 1);
    assert.equal(capped.body.truncated, true);
    assert.equal(capped.body.cap, 1);
  });
});

describe('the two audit answers capped in their own SQL', () => {
  it('answers through the route in an envelope', async () => {
    const answer = await get(
      `/government/audit/queries/taxpayer-access?taxpayerId=${taxpayerId}`,
      { token },
    );
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.ok(Array.isArray(answer.body.rows), 'rows, not a bare array');
    assert.ok(answer.body.rows.length >= 1, 'registering the taxpayer is on it');
    assert.equal(answer.body.truncated, false, 'and this record is not five hundred entries old');
    assert.equal(answer.body.cap, null);
  });

  /*
   * The arithmetic, with the cap driven down to one.
   *
   * The route does not take a cap — nobody should be able to ask the platform
   * for a shorter answer than it decided to give — so the service is called
   * directly. It is the same query, the same `cap + 1` read and the same slice.
   */
  it('reports the cap when the answer is longer than it', async () => {
    /*
     * A second entry first.
     *
     * Registering the taxpayer wrote one row and the three assessments wrote
     * none — they are transaction entries, not taxpayer ones — so the log holds
     * exactly one until somebody looks at the record. Opening it adds the read,
     * which is the whole point of the log and conveniently the second row this
     * needs. Found by the test failing with `truncated: false` against a cap of
     * one, which is the arithmetic being right about a fixture that was wrong.
     */
    const opened = await get(`/taxpayers/${taxpayerId}`, { token });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));

    const short = await reports.taxpayerAccessLog(pool, taxpayerId, 1);
    assert.equal(short.rows.length, 1, 'exactly the cap, never the row read past it');
    assert.equal(short.truncated, true, 'and it says the answer is short');
    assert.equal(short.cap, 1);

    const whole = await reports.taxpayerAccessLog(pool, taxpayerId, 500);
    assert.ok(whole.rows.length >= 2, 'the change and the look are both on it');
    assert.equal(whole.truncated, false);
    assert.equal(whole.cap, null, 'a cap that was not reached is not reported as one');
  });

  it('answers receipts for one item the same way', async () => {
    const answer = await get(
      '/government/audit/queries/receipts-by-item?revenueItemCode=SHOPS-KIOSKS',
      { token },
    );
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.ok(Array.isArray(answer.body.rows));
    assert.equal(answer.body.truncated, false);

    // And with a cap of zero, every receipt there is counts as left out.
    const none = await reports.receiptsByRevenueItem(pool, { revenueItemCode: 'SHOPS-KIOSKS' }, undefined, 0);
    assert.equal(none.rows.length, 0);
    assert.equal(
      none.truncated,
      await receiptsExist(),
      'truncated has to follow whether anything was actually dropped, not the cap alone',
    );
  });
});

/** Whether the item has any receipts at all, which decides the case above. */
async function receiptsExist(): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM receipts r
       JOIN transactions t ON t.id = r.transaction_id
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
      WHERE ri.code = 'SHOPS-KIOSKS'`,
  );
  return Number(row!.n) > 0;
}
