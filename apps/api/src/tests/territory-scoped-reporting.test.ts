/**
 * A supervisor's analytics, and the permission that promised them.
 *
 * `report:read:territory` exists in the RBAC table and a supervisor is the
 * only role that holds it. Running the platform and signing in as one showed
 * what it was worth:
 *
 *   * `/government/dashboard` answered 403. The portal's menu hides it too,
 *     so a supervisor signed in and landed on a raw transaction list. The
 *     role that runs a territory had no analytics at all.
 *   * `/government/intelligence/geography` answered 200 — with all seventeen
 *     LGAs. The permission that says "territory" returned the whole state.
 *   * The portal hid that page from them anyway, so the only screen the
 *     permission did unlock was one they could not reach.
 *
 * Two faults pointing opposite ways: an API too permissive and a menu too
 * restrictive, with the net effect that a supervisor saw nothing and the
 * safeguard implied by the permission's name did not exist. `users` had no
 * territory column, so there was nothing to scope by even in principle.
 *
 * The property that matters most here is the last one. A permission that
 * narrows access must fail closed: a supervisor with no territory assigned
 * has to see nothing, because the alternative — the one that was live — is
 * that an unconfigured account sees everything.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

interface Totals {
  collections: { total_kobo: string; today_kobo: string };
  counts: Record<string, string>;
  revenueByLga: { lga: string; amount_kobo: string }[];
}

interface GeoRow {
  level: string;
  level_type: string;
  level_id: string | null;
  amount_kobo: string;
}

/** Two LGAs, a territory in each, and revenue booked to both. */
let insideLga: { id: string; name: string };
let outsideLga: { id: string; name: string };
let insideTerritory: string;
let scopedSupervisorToken: string;
let unassignedSupervisorToken: string;
let adminToken: string;

const INSIDE_KOBO = 500_000n;
const OUTSIDE_KOBO = 900_000n;

/**
 * Book a settled transaction into an LGA and territory.
 *
 * Written against the tables rather than through the collection flow: what is
 * under test is which rows a report counts, and driving a full payment for
 * each would make the fixture the subject of the test.
 */
async function bookRevenue(params: {
  lgaId: string;
  territoryId: string | null;
  amountKobo: bigint;
  reference: string;
  suffix: string;
  officerId: string;
}) {
  const item = await queryOne<{ id: string; rate_id: string }>(
    pool,
    `SELECT ri.id, r.id AS rate_id
       FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE ri.code = 'MARKET-LEVY' LIMIT 1`,
  );
  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Scope','Fixture',$1,'1 Market Rd',$2,'ACTIVE','AGENT')
     RETURNING id`,
    [`+2348095200${params.suffix}`, params.lgaId],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments
       (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
        computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,$5,$5,$6,'INVOICED',$7)
     RETURNING id`,
    [
      `ASMT-SCOPE-${params.suffix}`,
      taxpayer!.id,
      item!.id,
      item!.rate_id,
      params.amountKobo.toString(),
      params.lgaId,
      params.officerId,
    ],
  );
  const invoice = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices
       (invoice_number, assessment_id, taxpayer_id, amount_kobo, total_amount_kobo,
        verification_code, created_by)
     VALUES ($1,$2,$3,$4,$4,$5,$6)
     RETURNING id`,
    [
      `INV-SCOPE-${params.suffix}`,
      assessment!.id,
      taxpayer!.id,
      params.amountKobo.toString(),
      `SCOPE${params.suffix}`,
      params.officerId,
    ],
  );
  await query(
    pool,
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
        amount_kobo, total_amount_kobo, status, lga_id, territory_id, channel, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6,'RECEIPT_GENERATED',$7,$8,'AGENT_PWA',$9)`,
    [
      params.reference,
      taxpayer!.id,
      invoice!.id,
      assessment!.id,
      item!.id,
      params.amountKobo.toString(),
      params.lgaId,
      params.territoryId,
      params.officerId,
    ],
  );
}

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  await startTestServer();

  const lgas = await query<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM lgas ORDER BY name LIMIT 2',
  );
  insideLga = lgas[0]!;
  outsideLga = lgas[1]!;

  // Territories are reference data and survive resetDatabase, so this upserts
  // rather than inserting — otherwise a second run of the file collides with
  // the rows the first one left behind.
  const adminId = await createGovernmentUser({
    fullName: 'Scope Test Admin',
    phone: '+2348095100003',
    role: 'admin',
  });
  const scoped = await createGovernmentUser({
    fullName: 'Scoped Supervisor',
    phone: '+2348095100001',
    role: 'supervisor',
  });
  await createGovernmentUser({
    fullName: 'Unassigned Supervisor',
    phone: '+2348095100002',
    role: 'supervisor',
  });

  const territories = await query<{ id: string }>(
    pool,
    `INSERT INTO territories (name, code, lga_id)
     VALUES ('Scope Test Territory', 'SCOPE-1', $1), ('Other Territory', 'SCOPE-2', $2)
     ON CONFLICT (code) DO UPDATE SET lga_id = EXCLUDED.lga_id
     RETURNING id`,
    [insideLga.id, outsideLga.id],
  );
  insideTerritory = territories[0]!.id;

  await bookRevenue({
    lgaId: insideLga.id,
    territoryId: insideTerritory,
    amountKobo: INSIDE_KOBO,
    reference: 'SCOPE-INSIDE-00001',
    suffix: '01',
    officerId: adminId,
  });
  await bookRevenue({
    lgaId: outsideLga.id,
    territoryId: territories[1]!.id,
    amountKobo: OUTSIDE_KOBO,
    reference: 'SCOPE-OUTSIDE-00002',
    suffix: '02',
    officerId: adminId,
  });

  await query(
    pool,
    `INSERT INTO user_territories (user_id, territory_id) VALUES ($1, $2)`,
    [scoped, insideTerritory],
  );

  scopedSupervisorToken = (await loginAs('+2348095100001')).accessToken;
  unassignedSupervisorToken = (await loginAs('+2348095100002')).accessToken;
  adminToken = (await loginAs('+2348095100003')).accessToken;
});

after(async () => {
  await stopTestServer();
});

describe('a supervisor can open the dashboard at all', () => {
  it('is not refused outright', async () => {
    const response = await get('/government/dashboard', { token: scopedSupervisorToken });
    assert.equal(
      response.status,
      200,
      `a supervisor was refused their own dashboard: ${JSON.stringify(response.body)}`,
    );
  });
});

describe('and sees their territory rather than the state', () => {
  it('counts only revenue booked to a territory they hold', async () => {
    const response = await get<Totals>('/government/dashboard', { token: scopedSupervisorToken });
    assert.equal(response.status, 200);
    assert.equal(
      response.body.collections.total_kobo,
      INSIDE_KOBO.toString(),
      'the supervisor is being shown revenue from a territory that is not theirs',
    );
  });

  it('lists only the LGAs their territories cover', async () => {
    const response = await get<GeoRow[]>('/government/intelligence/geography', {
      token: scopedSupervisorToken,
    });
    assert.equal(response.status, 200);
    const names = response.body.map((row) => row.level).sort();
    assert.deepEqual(
      names,
      [insideLga.name],
      'geographic intelligence returned areas outside the supervisor’s territories',
    );
  });
});

describe('an unconfigured supervisor', () => {
  /*
   * The fail-closed property, and the reason this file exists.
   *
   * A supervisor with no territory has no territory-scoped view of anything.
   * The dangerous reading of that is "no filter, so show everything", and it
   * is the reading the platform had: `report:read:territory` was accepted as
   * an alternative to `report:read:all` and then narrowed nothing.
   *
   * An account nobody has finished configuring must be the least dangerous
   * account in the system, not the most.
   */
  it('sees nothing, rather than everything', async () => {
    const response = await get<Totals>('/government/dashboard', {
      token: unassignedSupervisorToken,
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.body.collections.total_kobo,
      '0',
      'a supervisor with no territory assigned was shown revenue',
    );
  });

  it('gets no geography either', async () => {
    const response = await get<GeoRow[]>('/government/intelligence/geography', {
      token: unassignedSupervisorToken,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  });

  it('is told the view is empty because nothing is assigned, not because nothing was collected', async () => {
    // Zero from an unassigned account and zero from a quiet week look the
    // same on a dashboard, and one of them is a configuration fault somebody
    // needs to fix.
    const response = await get<Totals & { scope?: { kind: string; territories: unknown[] } }>(
      '/government/dashboard',
      { token: unassignedSupervisorToken },
    );
    assert.equal(response.body.scope?.kind, 'TERRITORIES');
    assert.deepEqual(response.body.scope?.territories, []);
  });
});

describe('statewide roles are unaffected', () => {
  it('still shows an administrator everything', async () => {
    const response = await get<Totals>('/government/dashboard', { token: adminToken });
    assert.equal(response.status, 200);
    assert.equal(
      response.body.collections.total_kobo,
      (INSIDE_KOBO + OUTSIDE_KOBO).toString(),
      'scoping has narrowed a statewide role',
    );
  });

  it('still lists every LGA for an administrator', async () => {
    const response = await get<GeoRow[]>('/government/intelligence/geography', {
      token: adminToken,
    });
    const total = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM lgas');
    assert.equal(response.body.length, Number(total!.n));
  });

  it('says so in the payload, so a screen can label what it is showing', async () => {
    const response = await get<Totals & { scope?: { kind: string } }>('/government/dashboard', {
      token: adminToken,
    });
    assert.equal(response.body.scope?.kind, 'STATEWIDE');
  });
});

describe('an administrator can actually assign a territory', () => {
  /*
   * Without this the scoping is inert. Every supervisor would sit permanently
   * unassigned, seeing nothing, and the only remedy would be an UPDATE against
   * the database — which is the one thing the audit design exists to prevent.
   * This is the "built but never wired" check.
   */
  it('lists what is assigned and what could be', async () => {
    const officer = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM users WHERE phone = '+2348095100002'`,
    );
    const response = await get<{ assigned: unknown[]; available: unknown[] }>(
      `/government/users/${officer!.id}/territories`,
      { token: adminToken },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.assigned, []);
    assert.ok(response.body.available.length > 0, 'no territory could be chosen');
  });

  it('assigns one, and the supervisor’s figures change accordingly', async () => {
    const officer = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM users WHERE phone = '+2348095100002'`,
    );

    const assigned = await post(
      `/government/users/${officer!.id}/territories`,
      { territoryIds: [insideTerritory], reason: 'Taking over the Jos market round' },
      { token: adminToken },
    );
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));

    const dashboard = await get<Totals>('/government/dashboard', {
      token: unassignedSupervisorToken,
    });
    assert.equal(
      dashboard.body.collections.total_kobo,
      INSIDE_KOBO.toString(),
      'the newly assigned supervisor still sees nothing',
    );
  });

  it('records the change, because it decides how much revenue somebody can see', async () => {
    const entry = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_logs WHERE action = 'user.territories.change'`,
    );
    assert.equal(entry!.n, '1');
  });

  it('refuses a territory that does not exist rather than assigning nothing quietly', async () => {
    const officer = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM users WHERE phone = '+2348095100002'`,
    );
    const response = await post(
      `/government/users/${officer!.id}/territories`,
      {
        territoryIds: ['00000000-0000-0000-0000-000000000000'],
        reason: 'Assigning a territory that is not real',
      },
      { token: adminToken },
    );
    assert.equal(response.status, 400);

    // And the refusal left the previous assignment intact rather than clearing it.
    const still = await get<Totals>('/government/dashboard', {
      token: unassignedSupervisorToken,
    });
    assert.equal(still.body.collections.total_kobo, INSIDE_KOBO.toString());
  });
});
