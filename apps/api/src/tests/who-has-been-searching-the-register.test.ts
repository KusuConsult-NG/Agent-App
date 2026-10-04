/**
 * The bulk disclosure the record log did not cover.
 *
 * Migration 083 recorded who opened one taxpayer's record. The commit that
 * added it said it was leaving the search out, because a row per match would
 * put one officer's typo on twenty citizens' access logs. That was true and it
 * was half an argument: `GET /taxpayers/search` answers, per match, TIN, first
 * and last name, business name, phone, email, address, community, LGA and
 * ward. A name typed into the box returns the full contact details of
 * everybody who matches it.
 *
 * So the platform logged the targeted disclosure of one person and not the
 * bulk disclosure of twenty. Migration 085 is the log of its own: one row per
 * search, keyed to the query.
 *
 * WHAT THESE HOLD
 *
 * That a search writes exactly one row carrying what was typed and how many
 * came back; that the log can be read, because a safeguard nobody can look at
 * protects nobody; that reading it needs `audit:read`, which the officers who
 * run the searches do not hold; and that it cannot be edited or deleted, which
 * is what makes it evidence rather than a note.
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { registerTaxpayer } from '../services/taxpayers';
import * as reports from '../services/reports';

const ADMIN = { fullName: 'Search Log Admin', phone: '+2348091100001', role: 'admin' } as const;
const OFFICER = {
  fullName: 'Search Log Officer',
  phone: '+2348091100002',
  role: 'revenue_officer',
} as const;
const AUDITOR = {
  fullName: 'Search Log Auditor',
  phone: '+2348091100003',
  role: 'auditor',
} as const;

let adminToken = '';
let officerToken = '';
let auditorToken = '';
let officerId = '';

interface SearchRow {
  searched_by: string | null;
  actor_role: string | null;
  filters: Record<string, unknown>;
  matched: number;
  ip_address: string | null;
}

async function searches(): Promise<SearchRow[]> {
  return query<SearchRow>(
    pool,
    `SELECT searched_by, actor_role, filters, matched, ip_address::text
       FROM taxpayer_search_logs ORDER BY created_at`,
  );
}

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser(ADMIN);
  officerId = await createGovernmentUser(OFFICER);
  await createGovernmentUser(AUDITOR);
  adminToken = (await loginAs(ADMIN.phone)).accessToken;
  officerToken = (await loginAs(OFFICER.phone)).accessToken;
  auditorToken = (await loginAs(AUDITOR.phone)).accessToken;

  const lgaId = await firstLgaId();
  for (const [first, last] of [
    ['Musa', 'Danladi'],
    ['Musa', 'Pam'],
    ['Zainab', 'Audu'],
  ]) {
    await registerTaxpayer({
      input: {
        taxpayerType: 'INDIVIDUAL',
        firstName: first,
        lastName: last,
        phone: `+23480911${String(Math.random()).slice(2, 7)}`,
        address: '2 Yakubu Gowon Way, Jos',
        lgaId,
        consentGiven: true,
        declarationAccepted: true,
      } as never,
      actorId: officerId,
      actorRole: 'revenue_officer',
    });
  }
  // Registering writes no search rows; the log starts empty, which is what
  // makes the counts below mean something.
  assert.deepEqual(await searches(), []);
});

describe('a search of the register', () => {
  it('records what was typed and how many people it returned', async () => {
    const found = await get('/taxpayers/search?q=Musa', { token: adminToken });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.ok(Array.isArray(found.body));
    assert.ok(found.body.length >= 2, 'two of the three match');

    const rows = await searches();
    assert.equal(rows.length, 1, 'one search, one row — not one per match');
    assert.deepEqual(rows[0]!.filters, { q: 'Musa' }, 'what the officer typed, and only that');
    assert.equal(
      rows[0]!.matched,
      found.body.length,
      'and how many people it put in front of them, which is what separates a lookup ' +
        'of one known trader from a trawl',
    );
    assert.equal(rows[0]!.actor_role, 'admin', 'the role held at the time');
    assert.ok(rows[0]!.ip_address, 'and where from');
  });

  it('leaves the page size out of the record', async () => {
    await get('/taxpayers/search?q=Musa&limit=50', { token: adminToken });
    const rows = await searches();
    assert.deepEqual(
      Object.keys(rows[0]!.filters).sort(),
      ['q'],
      '`limit` is how much the platform would answer, not what was asked for',
    );
  });

  it('records a search that found nobody', async () => {
    const found = await get('/taxpayers/search?q=Nobodyhere', { token: adminToken });
    assert.equal(found.status, 200);
    const rows = await searches();
    assert.equal(rows.length, 1, 'a search that matched nothing is still a search');
    assert.equal(rows[0]!.matched, 0);
  });

  it('records each of several fields that were used', async () => {
    await get('/taxpayers/search?q=Musa&tin=P0000001', { token: adminToken });
    const rows = await searches();
    assert.deepEqual(Object.keys(rows[0]!.filters).sort(), ['q', 'tin']);
  });
});

describe('a search typed into the box at the top of every screen', () => {
  /*
   * `GET /government/search` searches the register as well, for anybody who
   * holds `taxpayer:read:all`: names, TINs, and a phone number typed in comes
   * back as whose phone it is. It logged nothing. Measured: "Musa" returned
   * two people, and the search log stayed empty.
   */
  it('is logged like any other search of the register, and says which box', async () => {
    const found = await get('/government/search?q=Musa', { token: officerToken });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    const people = (found.body.hits as { kind: string }[]).filter((hit) => hit.kind === 'taxpayer');
    assert.equal(people.length, 2, 'the fixture registers two people called Musa');

    const rows = await searches();
    assert.equal(rows.length, 1, 'a search of the register that left no trace');
    assert.equal(rows[0]!.searched_by, officerId);
    assert.deepEqual(rows[0]!.filters, { q: 'Musa', from: 'GLOBAL_SEARCH' });
    assert.equal(rows[0]!.matched, 2);
  });

  it('logs nothing for somebody whose box does not reach the register', async () => {
    // A supervisor holds `taxpayer:read:assigned`, not `:all`, so their box
    // returns no people and there is no search of the register to record.
    await createGovernmentUser({
      fullName: 'Search Log Supervisor',
      phone: '+2348091100004',
      role: 'supervisor',
    });
    const supervisor = (await loginAs('+2348091100004')).accessToken;
    const found = await get('/government/search?q=Musa', { token: supervisor });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(
      (found.body.hits as { kind: string }[]).filter((hit) => hit.kind === 'taxpayer').length,
      0,
    );
    assert.deepEqual(await searches(), []);
  });
});

describe('reading who has been searching', () => {
  it('answers an auditor', async () => {
    await get('/taxpayers/search?q=Musa', { token: adminToken });

    const answer = await get('/government/audit/queries/register-searches', {
      token: auditorToken,
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.rows.length, 1);
    assert.equal(answer.body.rows[0]!.full_name, ADMIN.fullName);
    assert.equal(answer.body.rows[0]!.matched, 2);
    assert.deepEqual(answer.body.rows[0]!.filters, { q: 'Musa' });
    assert.equal(answer.body.truncated, false);
  });

  /*
   * THE PERMISSION DOES NOT SEPARATE THE SEARCHER FROM THE READER, AND THIS
   * SAYS SO RATHER THAN PRETENDING OTHERWISE.
   *
   * I wrote this test first as `refuses the officer whose searches it records`,
   * expecting a 403, on the strength of the comment on the neighbouring
   * intelligence access log: "the officers who look at the graph should not be
   * the ones who decide what the log of their looking says." It answered 200.
   * `audit:read` is held by revenue_officer, finance_officer, auditor and
   * admin, so that route's claim has never been true either, and both comments
   * are corrected in the commit this test belongs to.
   *
   * So the assertion is the fact: an officer who runs searches can read the
   * log of them. The property that makes the log evidence is the one below —
   * nobody can change it — and conflating the two is how a control gets
   * believed in without existing. A gate that really separated them would need
   * a permission only auditors and administrators hold, and the three
   * auditor-only permissions all mean something else.
   */
  it('can be read by an officer who runs searches, which is a gap worth naming', async () => {
    await get('/taxpayers/search?q=Musa', { token: officerToken });

    const read = await get('/government/audit/queries/register-searches', {
      token: officerToken,
    });
    assert.equal(
      read.status,
      200,
      'if this ever becomes a 403, a permission has been added and the comments on this ' +
        'route and on /intelligence/taxpayers/:id/access-log should be updated to match',
    );
    assert.equal(read.body.rows.length, 1, 'including their own search');
  });

  it('cannot be edited or deleted afterwards', async () => {
    await get('/taxpayers/search?q=Musa', { token: adminToken });
    const row = await queryOne<{ id: string }>(pool, 'SELECT id FROM taxpayer_search_logs LIMIT 1');
    assert.ok(row, 'there is a row to try to change');

    await assert.rejects(
      pool.query('UPDATE taxpayer_search_logs SET matched = 0 WHERE id = $1', [row!.id]),
      /append-only|cannot be (updated|changed)/i,
    );
    await assert.rejects(
      pool.query('DELETE FROM taxpayer_search_logs WHERE id = $1', [row!.id]),
      /cannot be deleted/i,
    );
  });

  /*
   * The cap, driven down rather than reached.
   *
   * Five hundred searches to prove the five-hundred-and-first is reported would
   * prove the fixture. The lesson is from `a-list-that-said-how-much-it-left-
   * out.test.ts`, where asserting only `truncated: false` on a short answer
   * passed against a service that never reported a cap at all.
   */
  it('says when it has stopped short', async () => {
    await get('/taxpayers/search?q=Musa', { token: adminToken });
    await get('/taxpayers/search?q=Zainab', { token: adminToken });

    const short = await reports.registerSearches(pool, 1);
    assert.equal(short.rows.length, 1, 'exactly the cap, never the row read past it');
    assert.equal(short.truncated, true);
    assert.equal(short.cap, 1);

    const whole = await reports.registerSearches(pool, 500);
    assert.equal(whole.rows.length, 2);
    assert.equal(whole.truncated, false);
    assert.equal(whole.cap, null);
  });
});
