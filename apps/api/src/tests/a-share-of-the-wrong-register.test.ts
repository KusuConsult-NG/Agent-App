/**
 * "Register paying" for a supervisor whose view is a territory.
 *
 * The geography report divides the taxpayers who paid in a place by the
 * taxpayers registered there. For a supervisor, the payers are counted within
 * their territory — every transaction carries one — but the register is kept
 * by LGA, ward and community, and nothing records which registered taxpayers
 * belong to a territory. So the figure divided one territory's payers by the
 * whole place's register. Measured with two territories in one LGA: the
 * supervisor whose one trader paid was shown 25% (1 of 4), and an
 * administrator looking at the same LGA, where all four had paid, was shown
 * 100%. Every level had the same mismatch.
 *
 * A territory view now reports the register and the share as unknown, rather
 * than a share that is wrong and a register that is not the supervisor's.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

interface GeoRow {
  level: string;
  level_id?: string | null;
  taxpayers: string;
  registered_taxpayers: string | null;
  compliance_bp: number | null;
  growth_bp?: number | null;
}

let lga: { id: string; name: string };
let ward: { id: string; name: string };
let supervisorToken = '';
let adminToken = '';
let adminId = '';
let seq = 0;

async function paid(territoryId: string) {
  seq += 1;
  const suffix = String(seq).padStart(3, '0');
  const item = (await queryOne<{ id: string; rate_id: string }>(
    pool,
    `SELECT ri.id, r.id AS rate_id FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE ri.code = 'MARKET-LEVY' LIMIT 1`,
  ))!;
  const taxpayer = (await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers
       (taxpayer_type, first_name, last_name, phone, address, lga_id, ward_id, community, status, source)
     VALUES ('INDIVIDUAL','Register','Fixture',$1,'2 Market Rd',$2,$3,'Terminus','ACTIVE','AGENT')
     RETURNING id`,
    [`+2348095300${suffix}`, lga.id, ward.id],
  ))!;
  const assessment = (await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments
       (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
        computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,100000,100000,$5,'INVOICED',$6)
     RETURNING id`,
    [`ASMT-REG-${suffix}`, taxpayer.id, item.id, item.rate_id, lga.id, adminId],
  ))!;
  const invoice = (await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices
       (invoice_number, assessment_id, taxpayer_id, amount_kobo, total_amount_kobo,
        verification_code, created_by)
     VALUES ($1,$2,$3,100000,100000,$4,$5)
     RETURNING id`,
    [`INV-REG-${suffix}`, assessment.id, taxpayer.id, `REG${suffix}`, adminId],
  ))!;
  await query(
    pool,
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
        amount_kobo, total_amount_kobo, status, lga_id, ward_id, territory_id, channel, created_by)
     VALUES ($1,$2,$3,$4,$5,100000,100000,'RECEIPT_GENERATED',$6,$7,$8,'AGENT_PWA',$9)`,
    [`REG-${suffix}`, taxpayer.id, invoice.id, assessment.id, item.id, lga.id, ward.id, territoryId, adminId],
  );
}

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  await startTestServer();

  lga = (await queryOne<{ id: string; name: string }>(pool, 'SELECT id, name FROM lgas ORDER BY name LIMIT 1'))!;
  ward = (await queryOne<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM wards WHERE lga_id = $1 ORDER BY name LIMIT 1',
    [lga.id],
  ))!;

  adminId = await createGovernmentUser({ fullName: 'Register Admin', phone: '+2348095300901', role: 'admin' });
  const supervisorId = await createGovernmentUser({
    fullName: 'Register Supervisor',
    phone: '+2348095300902',
    role: 'supervisor',
  });

  // Territories are reference data and survive resetDatabase, so upsert.
  const territories = await query<{ id: string }>(
    pool,
    `INSERT INTO territories (name, code, lga_id)
     VALUES ('Register Territory', 'REGISTER-1', $1), ('Neighbouring Territory', 'REGISTER-2', $1)
     ON CONFLICT (code) DO UPDATE SET lga_id = EXCLUDED.lga_id
     RETURNING id`,
    [lga.id],
  );
  await query(pool, 'INSERT INTO user_territories (user_id, territory_id) VALUES ($1, $2)', [
    supervisorId,
    territories[0]!.id,
  ]);

  // One trader paid in the supervisor's territory; three in the neighbouring one.
  await paid(territories[0]!.id);
  for (let i = 0; i < 3; i += 1) await paid(territories[1]!.id);

  supervisorToken = (await loginAs('+2348095300902')).accessToken;
  adminToken = (await loginAs('+2348095300901')).accessToken;
});

after(async () => {
  await stopTestServer();
});

async function geography(token: string, query = '') {
  const response = await get<GeoRow[]>(`/government/intelligence/geography${query}`, { token });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

describe('a supervisor whose view is a territory', () => {
  it('is not shown a share of the LGA’s register, and is told nothing false about it', async () => {
    const row = (await geography(supervisorToken)).find((r) => r.level === lga.name)!;
    assert.equal(row.taxpayers, '1', 'their payers are still their own');
    assert.equal(row.compliance_bp, null, 'a share of the wrong register was shown');
    assert.equal(row.registered_taxpayers, null, 'the whole LGA’s register is not their figure');
    assert.ok('growth_bp' in row, 'the rest of the row is unchanged');
  });

  it('is not shown one at ward level either', async () => {
    const row = (await geography(supervisorToken, `?lgaId=${lga.id}`)).find((r) => r.level === ward.name)!;
    assert.equal(row.taxpayers, '1');
    assert.equal(row.compliance_bp, null);
    assert.equal(row.registered_taxpayers, null);
  });

  it('is not shown one at community level either', async () => {
    const rows = await geography(supervisorToken, `?wardId=${ward.id}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.compliance_bp, null);
    assert.equal(rows[0]!.registered_taxpayers, null);
  });
});

describe('an administrator, whose view is the whole State', () => {
  it('still sees the register and the share paying, at every level', async () => {
    const state = (await geography(adminToken)).find((r) => r.level === lga.name)!;
    const wardRow = (await geography(adminToken, `?lgaId=${lga.id}`)).find((r) => r.level === ward.name)!;
    const community = (await geography(adminToken, `?wardId=${ward.id}`))[0]!;
    for (const row of [state, wardRow, community]) {
      assert.equal(row.taxpayers, '4');
      assert.equal(row.registered_taxpayers, '4');
      assert.equal(row.compliance_bp, 10_000);
    }
  });
});
