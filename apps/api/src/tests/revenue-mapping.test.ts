/**
 * Whose revenue it is, and where it came from.
 *
 * Three things were missing and each had a cause rather than being an
 * oversight.
 *
 *   * Every one of the forty-two catalogue items was mapped to PSIRS-HQ, so
 *     "revenue by MDA" was a single row saying the Internal Revenue Service
 *     collects all of the state's revenue. True of who collects it, and
 *     useless for the question government asks, which is whose it is.
 *
 *   * No collection had ever recorded where it happened. `transactions` has
 *     carried `latitude` and `longitude` since the schema was written, the
 *     assessment endpoint has always accepted them and the service has always
 *     written them — and every transaction in the platform had nulls, because
 *     no client ever sent one. Built, and never wired together.
 *
 *   * There was no screen between the dashboard's totals and the catalogue's
 *     price list showing revenue by generating area.
 *
 * The property worth guarding hardest is the last group below: an unmapped
 * collection must be reported as unmapped, and never counted as being
 * somewhere. A revenue map that quietly places unlocated money is worse than
 * one that admits it has none.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
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
import { seedDemoAgent } from '../db/seed-agent';
import {
  agentCollectionMap,
  collectionMappingCoverage,
  revenueByMda,
  revenueGenerationAreas,
} from '../services/reports';

/** The MDAs named as priorities. */
const PRIORITY_MDAS = [
  'Ministry of Education',
  'Ministry of Lands, Survey and Town Planning',
  'Ministry of Transport',
  'Ministry of Health',
  'Ministry of Water Resources and Energy',
];

let adminToken: string;
let lga: { id: string; name: string };
let ward: { id: string; name: string };

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  await startTestServer();
  await createGovernmentUser({
    fullName: 'Revenue Map Admin',
    phone: '+2348092000001',
    role: 'admin',
  });
  adminToken = (await loginAs('+2348092000001')).accessToken;

  lga = (await queryOne<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM lgas ORDER BY name LIMIT 1',
  ))!;
  ward = (await queryOne<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM wards WHERE lga_id = $1 ORDER BY name LIMIT 1',
    [lga.id],
  ))!;
});

after(async () => {
  await stopTestServer();
});

describe('every revenue item belongs to an arm of government', () => {
  it('names the five priority MDAs', async () => {
    const rows = await query<{ name: string }>(pool, 'SELECT name FROM mdas ORDER BY name');
    const names = rows.map((row) => row.name);
    for (const mda of PRIORITY_MDAS) {
      assert.ok(names.includes(mda), `${mda} is not in the MDA list`);
    }
  });

  it('leaves no catalogue item unattributed', async () => {
    const orphans = await query<{ code: string }>(
      pool,
      'SELECT code FROM revenue_items WHERE mda_id IS NULL ORDER BY code',
    );
    assert.deepEqual(orphans.map((r) => r.code), []);
  });

  it('no longer files everything under the collector', async () => {
    /*
     * PSIRS keeps the taxes it levies in its own name — personal income tax,
     * the development levies. What it must not keep is a vehicle licence or a
     * right of occupancy, which exist because another ministry regulates
     * something.
     */
    const psirs = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM revenue_items ri
         JOIN mdas m ON m.id = ri.mda_id WHERE m.code = 'PSIRS-HQ'`,
    );
    const all = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM revenue_items');
    assert.ok(
      Number(psirs!.n) < Number(all!.n),
      'every item is still attributed to the collector rather than the beneficiary',
    );
  });

  it('puts vehicle and land revenue with the ministries that regulate them', async () => {
    const rows = await query<{ code: string; mda: string }>(
      pool,
      `SELECT ri.code, m.code AS mda FROM revenue_items ri
         JOIN mdas m ON m.id = ri.mda_id
        WHERE ri.code IN ('ROAD-TAX','VEH-RENEW-PRIVATE','RIGHT-OCCUPANCY','LAND-USE-CHARGE')`,
    );
    const byCode = new Map(rows.map((r) => [r.code, r.mda]));
    assert.equal(byCode.get('ROAD-TAX'), 'MDA-TRANS');
    assert.equal(byCode.get('VEH-RENEW-PRIVATE'), 'MDA-TRANS');
    assert.equal(byCode.get('RIGHT-OCCUPANCY'), 'MDA-LANDS');
    assert.equal(byCode.get('LAND-USE-CHARGE'), 'MDA-LANDS');
  });

  it('reports an MDA with no revenue item rather than hiding it', async () => {
    // An arm of government collecting nothing through the platform is the
    // finding. Absent from the list, nobody ever sees it.
    const rows = (await revenueByMda(pool)) as unknown as { mda: string; revenue_items: string }[];
    const empty = rows.filter((row) => row.revenue_items === '0').map((row) => row.mda);
    assert.ok(
      empty.length > 0,
      'no MDA reported a zero — either every one has items, or zeroes are being dropped',
    );
    assert.ok(rows.some((row) => PRIORITY_MDAS.includes(row.mda)));
  });
});

describe('where a collection happened', () => {
  /** A settled collection, optionally with a point on the ground. */
  async function collect(params: { amountKobo: bigint; point?: [number, number]; suffix: string }) {
    const item = await queryOne<{ id: string; rate_id: string }>(
      pool,
      `SELECT ri.id, r.id AS rate_id FROM revenue_items ri
         JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
        WHERE ri.code = 'MARKET-LEVY' AND r.lga_id = $1 LIMIT 1`,
      [lga.id],
    );
    const officer = await queryOne<{ id: string }>(pool, `SELECT id FROM users LIMIT 1`);
    const taxpayer = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, ward_id, status, source)
       VALUES ('INDIVIDUAL','Map','Fixture',$1,'1 Market Rd',$2,$3,'ACTIVE','AGENT') RETURNING id`,
      [`+2348092100${params.suffix}`, lga.id, ward.id],
    );
    const assessment = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO assessments
         (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
          computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
       VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,$5,$5,$6,'INVOICED',$7) RETURNING id`,
      [`ASMT-MAP-${params.suffix}`, taxpayer!.id, item!.id, item!.rate_id,
       params.amountKobo.toString(), lga.id, officer!.id],
    );
    const invoice = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
         total_amount_kobo, verification_code, created_by)
       VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id`,
      [`INV-MAP-${params.suffix}`, assessment!.id, taxpayer!.id,
       params.amountKobo.toString(), `MAP${params.suffix}`, officer!.id],
    );
    await query(
      pool,
      `INSERT INTO transactions
         (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
          amount_kobo, total_amount_kobo, status, lga_id, ward_id, latitude, longitude,
          channel, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6,'RECEIPT_GENERATED',$7,$8,$9,$10,'AGENT_PWA',$11)`,
      [`TXN-MAP-${params.suffix}`, taxpayer!.id, invoice!.id, assessment!.id, item!.id,
       params.amountKobo.toString(), lga.id, ward.id,
       params.point?.[0] ?? null, params.point?.[1] ?? null, officer!.id],
    );
  }

  before(async () => {
    await collect({ amountKobo: 20_000n, point: [9.8965, 8.8583], suffix: '01' });
    await collect({ amountKobo: 20_000n, point: [9.8971, 8.8590], suffix: '02' });
    await collect({ amountKobo: 20_000n, suffix: '03' }); // no fix on the handset
  });

  it('groups revenue by the ward it was generated in', async () => {
    const areas = (await revenueGenerationAreas(pool)) as unknown as {
      lga: string;
      ward: string;
      transactions: string;
      amount_kobo: string;
    }[];
    const row = areas.find((a) => a.lga === lga.name && a.ward === ward.name);
    assert.ok(row, `no row for ${lga.name} / ${ward.name}`);
    assert.equal(row!.transactions, '3');
    assert.equal(row!.amount_kobo, '60000');
  });

  it('counts an unmapped collection as unmapped, not as somewhere', async () => {
    /*
     * The property this file exists for. Two of the three recorded a point;
     * the third did not, because the handset had no fix. Reporting three
     * mapped collections would place money where nobody said it was.
     */
    const areas = (await revenueGenerationAreas(pool)) as unknown as {
      lga: string;
      ward: string;
      transactions: string;
      located_transactions: string;
    }[];
    const row = areas.find((a) => a.lga === lga.name && a.ward === ward.name)!;
    assert.equal(row.transactions, '3');
    assert.equal(row.located_transactions, '2');
  });

  it('reports how much of the revenue can be placed on a map at all', async () => {
    const coverage = (await collectionMappingCoverage(pool)) as unknown as {
      transactions: string;
      located: string;
      total_amount_kobo: string;
      located_amount_kobo: string;
    };
    assert.equal(coverage.transactions, '3');
    assert.equal(coverage.located, '2');
    assert.equal(coverage.total_amount_kobo, '60000');
    assert.equal(coverage.located_amount_kobo, '40000');
  });

  it('still groups a collection with no coordinate by its ward', async () => {
    // The LGA and ward come from the assessment and are always known. Losing
    // the unmapped collection from the area report entirely would understate
    // what a ward produced, which is worse than not knowing the stall.
    const coverage = (await collectionMappingCoverage(pool)) as unknown as {
      transactions: string;
      ward_known: string;
    };
    assert.equal(coverage.ward_known, '3');
  });
});

describe('the summary an administrator opens', () => {
  it('answers all of it in one call', async () => {
    const response = await get('/government/revenue/summary', { token: adminToken });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    for (const key of ['byMda', 'areas', 'agents', 'coverage', 'scope']) {
      assert.ok(key in response.body, `the summary is missing ${key}`);
    }
  });

  it('carries the MDA breakdown, including the empty ones', async () => {
    const response = await get('/government/revenue/summary', { token: adminToken });
    const names = (response.body.byMda as { mda: string }[]).map((row) => row.mda);
    for (const mda of PRIORITY_MDAS) {
      assert.ok(names.includes(mda), `${mda} is missing from the summary`);
    }
  });

  it('is refused to a role with no reporting permission', async () => {
    await createGovernmentUser({
      fullName: 'Revenue Map Outsider',
      phone: '+2348092000002',
      role: 'agent',
    });
    const outsider = await loginAs('+2348092000002');
    const response = await get('/government/revenue/summary', { token: outsider.accessToken });
    assert.equal(response.status, 403);
  });
});

describe('an agent’s ground, not an agent’s movements', () => {
  it('reports where an agent collected, and how widely', async () => {
    const rows = (await agentCollectionMap(pool)) as unknown as { agent_code: string }[];
    // The fixture books transactions with no agent, so this is empty — what
    // is being asserted is that the report runs and returns a list rather
    // than failing on a null agent.
    assert.ok(Array.isArray(rows));
  });
});

describe('the wire from handset to database', () => {
  /*
   * The one that had never worked.
   *
   * Every piece existed independently — the agent app takes a collection, the
   * route accepts coordinates, the service writes them, the column holds them
   * — and no transaction in the platform had ever carried a point, because
   * nothing joined the first piece to the second. Testing the service alone
   * would have kept passing throughout.
   *
   * So this goes over HTTP as an agent, with a coordinate in the body, and
   * looks in the table.
   */
  it('records the point, the agent and the ward from one collection', async () => {
    await createGovernmentUser({
      fullName: 'Revenue Map Approver',
      phone: '+2348000000001',
      role: 'admin',
    });
    const agent = await seedDemoAgent();
    assert.ok(agent, 'the demo agent should seed');
    const session = await loginAs(agent!.phone, agent!.password, agent!.deviceIdentifier);

    const taxpayer = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, ward_id, status, source)
       VALUES ('INDIVIDUAL','Wire','Check','+2348092900001','Terminus Market, Jos',$1,$2,'ACTIVE','AGENT')
       RETURNING id`,
      [lga.id, ward.id],
    );
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT ri.id FROM revenue_items ri
         JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
        WHERE ri.code = 'MARKET-LEVY' AND r.lga_id = $1 LIMIT 1`,
      [lga.id],
    );

    const response = await post(
      '/revenue/assessments',
      {
        taxpayerId: taxpayer!.id,
        revenueItemId: item!.id,
        inputs: {},
        latitude: 9.8965,
        longitude: 8.8583,
      },
      { token: session.accessToken, deviceId: agent!.deviceIdentifier },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const row = await queryOne<{
      latitude: string | null;
      longitude: string | null;
      agent_id: string | null;
      ward_id: string | null;
    }>(
      pool,
      `SELECT latitude, longitude, agent_id, ward_id FROM transactions
        WHERE id = (SELECT id FROM transactions ORDER BY created_at DESC LIMIT 1)`,
    );

    assert.ok(row!.latitude !== null, 'the collection recorded no coordinate');
    assert.equal(Number(row!.latitude).toFixed(4), '9.8965');
    assert.equal(Number(row!.longitude).toFixed(4), '8.8583');
    assert.ok(row!.agent_id, 'the collection is not attributed to an agent');
    assert.equal(row!.ward_id, ward.id, 'the collection lost the ward it was taken in');
  });
});
