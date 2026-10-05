/**
 * A look at somebody's record, and whether anything records the look.
 *
 * The oversight screen has a button labelled "Who has looked at one taxpayer's
 * record". `docs/API.md` lists the endpoint behind it as "All users who
 * accessed taxpayer record X". The officer readiness assessment cites it as the
 * evidence that sensitive-data access is logged.
 *
 * It read `audit_logs` where `entity_type = 'taxpayer'`. All nine places that
 * write such a row write it when the record is CHANGED — registered, TIN
 * requested, TIN superseded, identity corrected, status changed, obligations
 * set, a draft synchronised. Nothing wrote one for a read. The only audit row a
 * read has ever produced is `access.denied`, filed under
 * `entity_type = 'permission'`: the platform recorded the reads it refused and
 * not the reads it allowed.
 *
 * So an officer who opened a neighbour's record — `SELECT t.*`, which is date of
 * birth, gender, phone, alternate phone, email, address, community, occupation
 * and TIN, plus the last fifty assessments, fifty transactions and fifty
 * receipts — read it and closed it appeared nowhere, and the auditor asking who
 * had looked was shown a list of changes under a heading promising looks.
 *
 * WHAT THESE TESTS HOLD
 *
 * That each of the four reads leaves a row naming what was disclosed; that the
 * auditor's endpoint returns those rows alongside the changes, each labelled;
 * that the row carries who, which role at the time, from which address and
 * which handset; that a refused read leaves nothing (a probe at an id must not
 * be able to write onto a stranger's access log); and that the log cannot be
 * edited or deleted afterwards, because an access log that can be tidied is not
 * evidence.
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

const OFFICER = {
  fullName: 'Access Log Officer',
  phone: '+2348077200001',
  role: 'revenue_officer',
} as const;
const AUDITOR = {
  fullName: 'Access Log Auditor',
  phone: '+2348077200002',
  role: 'auditor',
} as const;
const ADMIN = { fullName: 'Access Log Admin', phone: '+2348077200003', role: 'admin' } as const;

let officerToken = '';
let auditorToken = '';
let adminToken = '';
let taxpayerId = '';
let officerId = '';

interface AccessRow {
  taxpayer_id: string;
  accessed_by: string | null;
  actor_role: string | null;
  surface: string;
  ip_address: string | null;
  device_id: string | null;
}

async function looks(): Promise<AccessRow[]> {
  return query<AccessRow>(
    pool,
    `SELECT taxpayer_id, accessed_by, actor_role, surface, ip_address::text, device_id
       FROM taxpayer_record_access_logs ORDER BY created_at`,
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
  officerId = await createGovernmentUser(OFFICER);
  await createGovernmentUser(AUDITOR);
  await createGovernmentUser(ADMIN);
  officerToken = (await loginAs(OFFICER.phone)).accessToken;
  auditorToken = (await loginAs(AUDITOR.phone)).accessToken;
  adminToken = (await loginAs(ADMIN.phone)).accessToken;

  const lgaId = await firstLgaId();
  const registered = await registerTaxpayer({
    input: {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Looked',
      lastName: 'At',
      phone: '+2348077209999',
      address: '4 Rwang Pam Street, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    } as never,
    actorId: officerId,
    actorRole: 'revenue_officer',
  });
  taxpayerId = registered.taxpayerId;
  // Registration is a change, and it writes an `audit_logs` row. The access log
  // starts empty, which is the whole point: a record has been created and
  // nobody has looked at it.
  assert.deepEqual(await looks(), [], 'registering is not looking');
});

describe('a look at a record leaves a record of the look', () => {
  it('names the officer, the role they held and what was shown', async () => {
    const response = await get(`/taxpayers/${taxpayerId}`, { token: officerToken });
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const rows = await looks();
    assert.equal(rows.length, 1, 'one read, one row');
    assert.equal(rows[0]!.taxpayer_id, taxpayerId);
    assert.equal(rows[0]!.accessed_by, officerId);
    assert.equal(
      rows[0]!.actor_role,
      'revenue_officer',
      'the role held at the time, so a later promotion does not rewrite who read it',
    );
    assert.equal(rows[0]!.surface, 'TAXPAYER_RECORD');
    assert.ok(rows[0]!.ip_address, 'and where from');
  });

  it('distinguishes the five things an officer can be shown', async () => {
    const from = '2024-01-01';
    const to = '2024-12-31';
    const calls: [string, string, string][] = [
      [`/taxpayers/${taxpayerId}`, officerToken, 'TAXPAYER_RECORD'],
      [
        `/government/taxpayers/${taxpayerId}/payments?from=${from}&to=${to}`,
        adminToken,
        'PAYMENT_HISTORY',
      ],
      [`/taxpayers/${taxpayerId}/obligations`, officerToken, 'TAX_OBLIGATIONS'],
      [`/taxpayers/${taxpayerId}/incentives`, adminToken, 'INCENTIVE_STANDING'],
      // The fifth, and the one every agent in the State may read: what this
      // person owes now, invoice by invoice. It logged nothing.
      [`/revenue/taxpayers/${taxpayerId}/obligations`, officerToken, 'OUTSTANDING_BILLS'],
    ];

    for (const [path, token, expected] of calls) {
      const response = await get(path, { token });
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.body)}`);
      void expected;
    }

    assert.deepEqual(
      (await looks()).map((row) => row.surface),
      calls.map(([, , surface]) => surface),
      'each surface logged as itself: the register entry, the payment history, ' +
        'the obligations, the incentive standing and the unpaid bills are five ' +
        "different amounts of somebody's life",
    );
  });

  /*
   * The officer portal never calls `GET /taxpayers/:id`. It searches, then
   * opens the payment history, the obligations and the incentive standing on
   * separate tabs. Logging only the profile read would have recorded every
   * field agent's look and no officer's — and officers are the population the
   * audit question is usually about.
   */
  it('records the route the officer portal actually takes', async () => {
    const response = await get(
      `/government/taxpayers/${taxpayerId}/payments?from=2024-01-01&to=2024-12-31`,
      { token: adminToken },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const rows = await looks();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.surface, 'PAYMENT_HISTORY');
  });
});

describe('what the auditor is shown', () => {
  it('returns the looks and the changes, each saying which it is', async () => {
    await get(`/taxpayers/${taxpayerId}`, { token: officerToken });

    const response = await get(
      `/government/audit/queries/taxpayer-access?taxpayerId=${taxpayerId}`,
      { token: auditorToken },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const kinds = (response.body.rows as { kind: string; action: string }[]).map(
      (row) => row.kind,
    );
    assert.ok(kinds.includes('READ'), 'the look is in the answer');
    assert.ok(kinds.includes('CHANGE'), 'and so is the registration that created the record');

    const read = (
      response.body.rows as { kind: string; action: string; full_name: string }[]
    ).find((row) => row.kind === 'READ');
    assert.equal(read!.action, 'TAXPAYER_RECORD', 'the row says what was shown');
    assert.equal(read!.full_name, OFFICER.fullName, 'and who was shown it');
  });

  /*
   * Two looks are two rows.
   *
   * This is about the write path, not the SQL: I first wrote that UNION rather
   * than UNION ALL would have collapsed them, and that is not true —
   * `created_at` carries microseconds, so the two rows are not duplicates and
   * UNION would keep both. The property worth holding is the one the pattern
   * depends on: an officer opening the same record again and again shows up as
   * a count, so each read has to insert rather than touch a row it finds.
   */
  it('counts a second look as a second row', async () => {
    await get(`/taxpayers/${taxpayerId}`, { token: officerToken });
    await get(`/taxpayers/${taxpayerId}`, { token: officerToken });

    const response = await get(
      `/government/audit/queries/taxpayer-access?taxpayerId=${taxpayerId}`,
      { token: auditorToken },
    );
    assert.equal(
      (response.body.rows as { kind: string }[]).filter((row) => row.kind === 'READ').length,
      2,
      'and the answer says it is not capped, so two is two and not two of many',
    );
    assert.equal(response.body.truncated, false);
  });
});

describe('what the log refuses', () => {
  it('writes nothing for a read that was refused', async () => {
    // A taxpayer id that is not one. The read fails; nothing may be written,
    // and in particular a probe must not be able to leave an entry.
    const response = await get('/taxpayers/00000000-0000-0000-0000-000000000000', {
      token: officerToken,
    });
    assert.equal(response.status, 404, JSON.stringify(response.body));
    assert.deepEqual(await looks(), [], 'a refused read is not a disclosure');
  });

  it('cannot be edited or deleted afterwards', async () => {
    await get(`/taxpayers/${taxpayerId}`, { token: officerToken });
    const row = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM taxpayer_record_access_logs LIMIT 1',
    );
    assert.ok(row, 'there is a row to try to change');

    await assert.rejects(
      pool.query(`UPDATE taxpayer_record_access_logs SET surface = 'TAX_OBLIGATIONS' WHERE id = $1`, [
        row!.id,
      ]),
      /append-only|cannot be (updated|changed)/i,
    );
    await assert.rejects(
      pool.query('DELETE FROM taxpayer_record_access_logs WHERE id = $1', [row!.id]),
      /cannot be deleted/i,
    );
  });
});
