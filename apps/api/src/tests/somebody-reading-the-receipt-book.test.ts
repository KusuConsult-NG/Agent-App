/**
 * The public verification page, and the one visitor it could not see.
 *
 * `GET /verify/:code` answers without an account, by design — PRD §20 and §43
 * want a citizen or a roadside officer to confirm a piece of paper without
 * one. It matches a verification code, ten characters from a 27-letter
 * alphabet, which is not worth guessing. It ALSO matches the receipt number
 * and the document number, deliberately, so somebody holding a receipt with a
 * smudged code can still check it.
 *
 * Those numbers run in sequence. So the whole revenue book is walkable, one
 * number at a time, at sixty a minute: every receipt's amount, revenue type,
 * date, LGA and validity. Not who paid — no name, TIN or phone comes back —
 * but enough to reconstruct what the State collects, where, when, and which
 * receipts were reversed.
 *
 * Every attempt has always been recorded with its address. The only thing
 * reading that record was one figure on the leakage report counting `INVALID`
 * and `NOT_FOUND` — somebody mistyping a code. A person walking the numbers
 * gets `VALID` every time and appeared in no count anywhere.
 *
 * That is the shape this codebase keeps having to fix: a detection that exists
 * and cannot see the thing it is for. The checksum on a signed report was
 * computed, tested, and reached nobody. A job that failed every other run
 * reported itself healthy. This is the same defect on the one surface that
 * faces the public.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not narrow what the endpoint answers. Taking the receipt number away
 * would break the citizen it was added for, and that is a decision for PSIRS,
 * not a side effect of adding a detector.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, loginAs, pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { query, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { raiseSystemAlerts } from '../services/officer-inbox';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Alert Admin', phone: '+2348084000001', role: 'admin' });
  await loginAs('+2348084000001');
});

/**
 * Record `count` successful lookups of distinct identifiers from one address.
 *
 * Written straight into `verification_attempts` rather than driven through the
 * endpoint, because the endpoint is capped at sixty a minute and the point of
 * the rule is what happens over an hour.
 */
async function lookedUp(
  address: string,
  count: number,
  options: {
    result?: string;
    distinct?: boolean;
    agoMinutes?: number;
    kind?: 'RECEIPT' | 'TAXPAYER';
  } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO verification_attempts (lookup_type, lookup_value, result, ip_address, created_at)
     SELECT $7,
            $4 || '-' || (CASE WHEN $5::boolean THEN n::text ELSE '1' END),
            $3, $1::inet, now() - ($6 || ' minutes')::interval
       FROM generate_series(1, $2) AS n`,
    [
      address,
      count,
      options.result ?? 'VALID',
      `PSIRS-RCP-2026`,
      options.distinct ?? true,
      String(options.agoMinutes ?? 5),
      options.kind ?? 'RECEIPT',
    ],
  );
}

/** Run the sweep the way the scheduler does, and return what it raised. */
async function sweep(): Promise<Record<string, unknown>[]> {
  await withTransaction((client) => raiseSystemAlerts(client));
  return query(
    pool,
    `SELECT subject, body, severity, entity_id, entity_type
       FROM officer_notifications
      WHERE kind = 'SYSTEM_ALERT' AND entity_type = 'verification_source'`,
  );
}

describe('an address working through the receipt numbers', () => {
  it('is reported to somebody', async () => {
    await lookedUp('203.0.113.7', 600);

    const alerts = await sweep();

    assert.equal(alerts.length, 1, JSON.stringify(alerts));
    assert.equal(alerts[0]!.entity_id, '203.0.113.7');
    assert.match(String(alerts[0]!.subject), /600 different records/);
  });

  it('says the traffic may be a shared network, so nobody acts on it blind', async () => {
    /*
     * Nigerian mobile networks put thousands of subscribers behind one
     * address. An alert that reads as an accusation gets somebody's connection
     * blocked; one that says what it saw and what it cannot tell gets somebody
     * to look.
     */
    await lookedUp('203.0.113.7', 600);

    const alerts = await sweep();
    assert.match(String(alerts[0]!.body), /shared mobile network/i);
  });

  it('raises one row however long it runs for', async () => {
    // Deduped on the address, so a scraper working all afternoon is one unread
    // alert rather than one per sweep.
    await lookedUp('203.0.113.7', 600);
    await sweep();
    await sweep();

    const alerts = await sweep();
    assert.equal(alerts.length, 1, JSON.stringify(alerts));
  });
});

describe('the other door, which is a narrower one', () => {
  /*
   * Two unauthenticated surfaces write to this table and they are not
   * throttled alike: the receipt verifier admits 60 requests a minute, the
   * citizen status lookup 10. One threshold cannot serve both — five hundred
   * is a comfortable fraction of the first ceiling and 83% of the second,
   * which would have meant an enumerator sustaining nearly the maximum
   * possible rate for a full hour before anybody was told.
   *
   * That was the wrong way round. The citizen door is the one `citizen.ts`
   * says needs watching most — "a TIN is far more guessable than a receipt
   * number" — and what comes back there is about a person rather than about a
   * piece of paper.
   */
  it('reports a TIN sweep well below the receipt threshold', async () => {
    await lookedUp('203.0.113.11', 150, { kind: 'TAXPAYER' });

    const alerts = await sweep();
    assert.equal(alerts.length, 1, JSON.stringify(alerts));
    assert.match(String(alerts[0]!.subject), /150 different taxpayers/);
    assert.match(String(alerts[0]!.body), /TIN is far more guessable/);
  });

  it('does not report the same volume of receipt lookups', async () => {
    // The control that proves the two doors are judged apart rather than the
    // threshold simply having been lowered for everything.
    await lookedUp('203.0.113.12', 150, { kind: 'RECEIPT' });

    assert.deepEqual(await sweep(), []);
  });

  it('raises one alert per door when an address works both', async () => {
    /*
     * Two different exposures. An officer reading about the receipt book
     * should not have a TIN sweep folded into the same row and dismissed with
     * it.
     */
    await lookedUp('203.0.113.13', 600, { kind: 'RECEIPT' });
    await lookedUp('203.0.113.13', 150, { kind: 'TAXPAYER' });

    const alerts = await sweep();
    assert.equal(alerts.length, 2, JSON.stringify(alerts.map((a) => a.subject)));
  });
});

describe('the traffic that is not that', () => {
  /*
   * The controls. This rule watches an unauthenticated page that every citizen
   * is invited to use, so a false positive is somebody's honest lookup being
   * called an attack — and a rule that fires on ordinary use gets muted, which
   * is the same as not having it.
   */
  it('says nothing about a citizen checking one receipt', async () => {
    await lookedUp('203.0.113.9', 3);

    assert.deepEqual(await sweep(), []);
  });

  it('says nothing about one identifier retried many times', async () => {
    /*
     * Somebody with a smudged receipt typing the same number over and over is
     * the opposite of enumeration, and counting rows rather than distinct
     * identifiers would have called it one.
     */
    await lookedUp('203.0.113.9', 900, { distinct: false });

    assert.deepEqual(await sweep(), []);
  });

  it('says nothing about failed lookups, which the leakage report already counts', async () => {
    // `NOT_FOUND` at volume is a different finding with a different meaning,
    // and it has a home already. Folding it in here would double-report it.
    await lookedUp('203.0.113.9', 900, { result: 'NOT_FOUND' });

    assert.deepEqual(await sweep(), []);
  });

  it('says nothing about yesterday', async () => {
    // The window is an hour. Without it the rule fires forever on traffic
    // somebody has already looked at and dismissed.
    await lookedUp('203.0.113.9', 900, { agoMinutes: 24 * 60 });

    assert.deepEqual(await sweep(), []);
  });

  it('leaves the threshold above what a shared address plausibly does', async () => {
    /*
     * Just under the line. The number is a judgement — see the constant's own
     * note — and this pins it so that lowering it is a decision somebody makes
     * on purpose rather than a tweak that starts flagging a carrier.
     */
    await lookedUp('203.0.113.9', 500, { kind: 'RECEIPT' });

    assert.deepEqual(await sweep(), []);
  });
});
