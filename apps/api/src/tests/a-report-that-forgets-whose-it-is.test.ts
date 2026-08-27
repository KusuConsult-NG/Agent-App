/**
 * Two reports that answered for the whole state, and a search that listed
 * citizens to a field agent.
 *
 * `report-scope.ts` exists because `report:read:territory` narrowed nothing
 * for the first year of this platform's life. Its own comment says why the
 * predicate is a shared helper rather than written out per query: so that "an
 * author cannot accidentally write a filter that is right in one report and
 * absent in the next."
 *
 * Two reports were then added — revenue by category, and defaulters by
 * category — and neither took a scope. Eight report functions in the same file
 * take one; these two did not, and their routes accepted
 * `report:read:territory` as sufficient. So a supervisor assigned one
 * territory could read:
 *
 *   * every naira the state collected, under every levy, for all time; and
 *   * the name, TIN, phone number and debt of five hundred citizens anywhere
 *     in Plateau State, largest debt first.
 *
 * The second is worse than a reporting leak. A defaulter list is a list of
 * people who can be pressed for money, and handing one for another
 * supervisor's territory to a supervisor is handing over exactly the material
 * an unofficial collection is made from.
 *
 * THE SEARCH IS THE SAME FAULT ONE LAYER DOWN. `/taxpayers/search` was a
 * lookup: an exact TIN, phone number, receipt number, vehicle plate, or a
 * fragment of a name. Every one of those requires already knowing who you are
 * looking for. `revenueItemId`, `categoryId` and `outstandingOnly` were added
 * so an officer could ask "who is registered under Market Levy" — and the
 * endpoint accepts `taxpayer:read:assigned`, which every field agent holds.
 * That turned a lookup into an enumeration: a hundred citizens' TINs and
 * telephone numbers, selected by a levy an agent collects, returned to the
 * agent's own handset.
 *
 * A filter narrows a search. It is not a search. A caller who cannot read
 * every taxpayer has to name one first.
 *
 * (`q` is left as it was. A one-letter fragment matches many people, so it is
 * a weaker version of the same thing — but it is the surface the agent
 * application has always used, there is no offset parameter to walk the
 * register with, and narrowing it is a field-behaviour decision rather than a
 * fix to a hole this change opened.)
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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

interface CategoryReport {
  totalKobo: string;
  categories: { category: string; amount_kobo: string; taxpayers: string }[];
  items: { revenue_item: string; amount_kobo: string }[];
}

interface DefaulterReport {
  outstandingKobo: string;
  defaulters: number;
  rows: { name: string; lga: string; tin: string | null; phone: string }[];
}

let insideLga: { id: string; name: string };
let outsideLga: { id: string; name: string };
let scopedToken = '';
let unassignedToken = '';
let adminToken = '';
let agentToken = '';
let agentDevice = '';
let marketLevyId = '';

const INSIDE_KOBO = 400_000n;
const OUTSIDE_KOBO = 700_000n;

/**
 * One unpaid obligation, booked into an LGA and a territory.
 *
 * Written against the tables rather than through the collection flow: what is
 * under test is which rows a report counts, and driving a payment for each
 * would make the fixture the subject of the test. The invoice is left unpaid,
 * which is what makes the same taxpayer a defaulter as well as a collection.
 */
async function bookObligation(params: {
  lgaId: string;
  territoryId: string | null;
  amountKobo: bigint;
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
  marketLevyId = item!.id;

  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Levy',$1,$2,'2 Market Rd',$3,'ACTIVE','AGENT')
     RETURNING id`,
    [`Subject${params.suffix}`, `+2348095300${params.suffix}`, params.lgaId],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments
       (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
        computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,$5,$5,$6,'INVOICED',$7)
     RETURNING id`,
    [
      `ASMT-LEVY-${params.suffix}`,
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
      `INV-LEVY-${params.suffix}`,
      assessment!.id,
      taxpayer!.id,
      params.amountKobo.toString(),
      `LEVY${params.suffix}`,
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
      `LEVY-SCOPE-${params.suffix}`,
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

  const adminId = await createGovernmentUser({
    fullName: 'Levy Scope Admin',
    phone: '+2348095400003',
    role: 'admin',
  });
  const scoped = await createGovernmentUser({
    fullName: 'Levy Scoped Supervisor',
    phone: '+2348095400001',
    role: 'supervisor',
  });
  await createGovernmentUser({
    fullName: 'Levy Unassigned Supervisor',
    phone: '+2348095400002',
    role: 'supervisor',
  });

  // Territories are reference data and survive resetDatabase, so this upserts.
  const territories = await query<{ id: string }>(
    pool,
    `INSERT INTO territories (name, code, lga_id)
     VALUES ('Levy Inside', 'LEVY-1', $1), ('Levy Outside', 'LEVY-2', $2)
     ON CONFLICT (code) DO UPDATE SET lga_id = EXCLUDED.lga_id
     RETURNING id`,
    [insideLga.id, outsideLga.id],
  );

  await bookObligation({
    lgaId: insideLga.id,
    territoryId: territories[0]!.id,
    amountKobo: INSIDE_KOBO,
    suffix: '01',
    officerId: adminId,
  });
  await bookObligation({
    lgaId: outsideLga.id,
    territoryId: territories[1]!.id,
    amountKobo: OUTSIDE_KOBO,
    suffix: '02',
    officerId: adminId,
  });

  await query(pool, 'INSERT INTO user_territories (user_id, territory_id) VALUES ($1, $2)', [
    scoped,
    territories[0]!.id,
  ]);

  scopedToken = (await loginAs('+2348095400001')).accessToken;
  unassignedToken = (await loginAs('+2348095400002')).accessToken;
  adminToken = (await loginAs('+2348095400003')).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  agentDevice = demo!.deviceIdentifier;
});

after(async () => {
  await stopTestServer();
});

describe('what a levy collected, asked by a supervisor', () => {
  it('counts only the territory they hold', async () => {
    const response = await get<CategoryReport>('/government/revenue/by-category', {
      token: scopedToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(
      response.body.totalKobo,
      INSIDE_KOBO.toString(),
      `a supervisor was shown the whole state's collections: ${JSON.stringify(response.body.categories)}`,
    );
  });

  it('leaves the other territory out of the per-levy breakdown too', async () => {
    // The category total and the item total are separate queries over the same
    // rows, and a scope applied to one and not the other is a report that
    // contradicts itself.
    const response = await get<CategoryReport>('/government/revenue/by-category', {
      token: scopedToken,
    });
    const items = response.body.items.reduce((sum, row) => sum + BigInt(row.amount_kobo), 0n);
    assert.equal(items, INSIDE_KOBO, 'the per-levy rows must be scoped like the category rows');
  });

  it('shows a supervisor with no territory nothing, rather than everything', async () => {
    /*
     * The fail-closed rule this platform already holds elsewhere. The tempting
     * reading — no assignment, so no filter, so show the lot — makes an account
     * nobody has finished configuring the most privileged in the system.
     */
    const response = await get<CategoryReport>('/government/revenue/by-category', {
      token: unassignedToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.totalKobo, '0', JSON.stringify(response.body.categories));
  });

  // --- control ---

  it('still shows an administrator the whole state', async () => {
    const response = await get<CategoryReport>('/government/revenue/by-category', {
      token: adminToken,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.totalKobo, (INSIDE_KOBO + OUTSIDE_KOBO).toString());
  });
});

describe('who is behind on a levy, asked by a supervisor', () => {
  it('names only the debtors in the territory they hold', async () => {
    const response = await get<DefaulterReport>('/government/revenue/defaulters', {
      token: scopedToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const elsewhere = response.body.rows.filter((row) => row.lga === outsideLga.name);
    assert.deepEqual(
      elsewhere,
      [],
      'a defaulter list is a list of people who can be pressed for money; ' +
        'another territory’s belongs to that territory',
    );
  });

  it('does not total up debts it may not list', async () => {
    // A headline figure covering rows the caller cannot see is the same leak
    // with the names removed, and it is the number an officer would quote.
    const response = await get<DefaulterReport>('/government/revenue/defaulters', {
      token: scopedToken,
    });
    assert.equal(response.body.outstandingKobo, INSIDE_KOBO.toString(), JSON.stringify(response.body));
  });

  it('shows a supervisor with no territory nobody', async () => {
    const response = await get<DefaulterReport>('/government/revenue/defaulters', {
      token: unassignedToken,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.defaulters, 0, JSON.stringify(response.body.rows));
  });

  // --- control ---

  it('still names both to an administrator', async () => {
    const response = await get<DefaulterReport>('/government/revenue/defaulters', {
      token: adminToken,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.outstandingKobo, (INSIDE_KOBO + OUTSIDE_KOBO).toString());
  });
});

describe('an agent asking who else is registered under a levy they collect', () => {
  const agentAuth = () => ({ token: agentToken, deviceId: agentDevice });

  it('is refused, because that is a list of citizens and not a lookup', async () => {
    const response = await get(`/taxpayers/search?revenueItemId=${marketLevyId}`, agentAuth());
    assert.equal(
      response.status,
      403,
      `an agent enumerated the register by levy: ${JSON.stringify(response.body).slice(0, 300)}`,
    );
  });

  it('is refused for a whole category as well', async () => {
    const category = await queryOne<{ id: string }>(
      pool,
      'SELECT category_id AS id FROM revenue_items WHERE id = $1',
      [marketLevyId],
    );
    const response = await get(`/taxpayers/search?categoryId=${category!.id}`, agentAuth());
    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 300));
  });

  it('is refused a list of everyone who owes anything', async () => {
    const response = await get('/taxpayers/search?outstandingOnly=true', agentAuth());
    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 300));
  });

  it('is refused a list of everyone in an LGA', async () => {
    // The same shape, and it predates the three above: an LGA on its own is
    // "everybody in Jos North", which is not a search for anyone.
    const response = await get(`/taxpayers/search?lgaId=${insideLga.id}`, agentAuth());
    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 300));
  });

  it('is told what to do instead, rather than only that they may not', async () => {
    const response = await get(`/taxpayers/search?revenueItemId=${marketLevyId}`, agentAuth());
    assert.match(
      response.body.error?.message ?? '',
      /name|phone|TIN|reference/i,
      `a refusal an agent cannot act on is a dead end: ${JSON.stringify(response.body)}`,
    );
  });

  // --- controls: the agent's actual job is untouched ---

  it('can still find one taxpayer by name, which is what the handset does', async () => {
    const response = await get('/taxpayers/search?q=Subject01', agentAuth());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(Array.isArray(response.body));
  });

  it('can still narrow that lookup by LGA', async () => {
    // A filter beside an identifier is a narrowing, not an enumeration.
    const response = await get(
      `/taxpayers/search?q=Subject01&lgaId=${insideLga.id}`,
      agentAuth(),
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it('can still find somebody by exact phone number', async () => {
    const response = await get('/taxpayers/search?phone=%2B234809530001', agentAuth());
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });
});

describe('an officer who may read every taxpayer', () => {
  it('can still ask who is registered under a levy, which is the whole feature', async () => {
    const response = await get(`/taxpayers/search?revenueItemId=${marketLevyId}`, {
      token: adminToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      (response.body as unknown[]).length >= 1,
      'the officer-facing question must still be answerable',
    );
  });

  it('can still ask for everyone with something unpaid', async () => {
    const response = await get('/taxpayers/search?outstandingOnly=true', {
      token: adminToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });
});

describe('the next report added here', () => {
  /**
   * Every route that accepts `report:read:territory` resolves a scope.
   *
   * This is the structural half, and it is the half that would have caught
   * this before it shipped. The two leaking endpoints were written beside four
   * that scope correctly, in the same file, and read as if they belonged: the
   * permission guard listed `report:read:territory` and the handler simply
   * did not narrow anything. Nothing in the type system objects, because the
   * scope argument has a default of STATEWIDE — which is the right default for
   * a service function called by a job, and the wrong one to arrive at by
   * forgetting.
   *
   * Checked against the route source rather than by signing in as a
   * supervisor: a behavioural test can only cover endpoints somebody thought
   * to write a test for, and the failure mode here is precisely not thinking
   * of one.
   */
  it('cannot accept a territory permission and then answer for the state', () => {
    const routes = join(__dirname, '..', 'routes');
    const missing: string[] = [];
    let checked = 0;

    for (const file of readdirSync(routes).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(routes, file), 'utf8');
      const starts = [...source.matchAll(/\w+Router\.(get|post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g)];

      for (const [index, match] of starts.entries()) {
        const next = starts[index + 1];
        const block = source.slice(match.index!, next ? next.index! : source.length);
        if (!block.includes("'report:read:territory'")) continue;
        checked += 1;
        /*
         * Resolved *and then used*. A handler that computes a scope and calls
         * the report without it is the same leak with a decoy in front of it,
         * and the two endpoints this test exists for failed one character away
         * from that.
         *
         * Two spellings are correct and both count: the result passed inline
         * as an argument, which cannot be ignored; or bound to a name, which
         * then has to appear again below. `/agents/performance` uses the first
         * and `/government/dashboard` the second.
         */
        const at = block.indexOf('resolveReportScope');
        if (at === -1) {
          missing.push(`${file} ${match[1]!.toUpperCase()} ${match[2]}`);
          continue;
        }
        const bound = /const\s+(\w+)\s*=\s*await\s+resolveReportScope/.exec(block);
        if (bound) {
          const after = block.slice(bound.index + bound[0].length);
          if (!new RegExp(`\\b${bound[1]}\\b`).test(after)) {
            missing.push(`${file} ${match[1]!.toUpperCase()} ${match[2]} (resolved, never passed)`);
          }
        }
      }
    }

    assert.ok(checked >= 5, `expected to find the scoped routes, found ${checked}`);
    assert.deepEqual(
      missing,
      [],
      'these routes offer themselves to a territory-scoped officer and then do not narrow ' +
        'anything, so the permission that says "territory" returns the whole state:\n  ' +
        missing.join('\n  '),
    );
  });
});
