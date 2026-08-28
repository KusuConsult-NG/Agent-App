/**
 * Who a search may reach, and who may list rather than look up.
 *
 * The enumeration guard added with the levy screens drew one line: name
 * somebody, or hold `taxpayer:read:all`. That was right about agents and wrong
 * about supervisors, and it left a third thing untouched.
 *
 * A SUPERVISOR RUNS A TERRITORY AND COULD NOT SEE INTO IT. "Who is registered
 * under the shop rate in my area" is the question their job consists of, and
 * they hold `taxpayer:read:assigned`, so the guard refused it. The reports
 * beside it are territory-scoped and answer for them; the register was
 * all-or-nothing. Scoping it costs nothing new — `territories.lga_id` is
 * already how `report-scope.ts` derives its LGA list, and taxpayers are held
 * by LGA.
 *
 * A NAME FRAGMENT REACHED THE WHOLE STATE. `q=a` matches most Nigerian names
 * and returns a hundred citizens' TINs and phone numbers, and there is no
 * offset — but there are twenty-six letters and six hundred and seventy-six
 * pairs, so the register is walkable to anyone patient. A field agent held
 * that.
 *
 * The line is between a fragment and an identifier. `q` is a guess that can be
 * varied until something falls out. A TIN, a phone number, a receipt number or
 * a vehicle registration is a thing the citizen standing in front of the agent
 * hands over, and it must keep working across every Local Government Area — a
 * trader registered in Jos North buys their levy at a Jos South market, and an
 * agent who cannot serve them is a worse outcome than the one being prevented.
 *
 * So: exact identifiers reach the whole state, and everything else is bounded
 * to where the caller works. An agent's territory has exactly one LGA, and the
 * schema already refuses to activate an agent without one.
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
import { seedDemoAgent } from '../db/seed-agent';

let homeLga: { id: string; name: string };
let awayLga: { id: string; name: string };
let supervisorToken = '';
let unassignedSupervisorToken = '';
let adminToken = '';
let agentToken = '';
let agentDevice = '';
let marketLevyId = '';
let awayPhone = '';
let awayTin = '';

/** A taxpayer with an unpaid Market Levy, in a named LGA. */
async function plant(lgaId: string, suffix: string) {
  const item = await queryOne<{ id: string; rate_id: string }>(
    pool,
    `SELECT ri.id, r.id AS rate_id
       FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE ri.code = 'MARKET-LEVY' LIMIT 1`,
  );
  marketLevyId = item!.id;

  const tin = `PL${suffix}0000001`;
  const phone = `+2348096100${suffix}`;
  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, tin, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Bitrus',$1,$2,$3,'9 Terminus Rd',$4,'ACTIVE','AGENT')
     RETURNING id`,
    [`Danlami${suffix}`, phone, tin, lgaId],
  );

  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments
       (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
        computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,50000,50000,$5,'INVOICED',$6)
     RETURNING id`,
    [`ASMT-SRCH-${suffix}`, taxpayer!.id, item!.id, item!.rate_id, lgaId, adminUserId],
  );
  const invoice = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices
       (invoice_number, assessment_id, taxpayer_id, amount_kobo, total_amount_kobo,
        verification_code, created_by)
     VALUES ($1,$2,$3,50000,50000,$4,$5)
     RETURNING id`,
    [`INV-SRCH-${suffix}`, assessment!.id, taxpayer!.id, `SRCH${suffix}`, adminUserId],
  );
  await query(
    pool,
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
        amount_kobo, total_amount_kobo, status, lga_id, channel, created_by)
     VALUES ($1,$2,$3,$4,$5,50000,50000,'INVOICE_GENERATED',$6,'AGENT_PWA',$7)`,
    [`SRCH-${suffix}-0001`, taxpayer!.id, invoice!.id, assessment!.id, item!.id, lgaId, adminUserId],
  );
  return { tin, phone };
}

let adminUserId = '';

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  await startTestServer();

  adminUserId = await createGovernmentUser({
    fullName: 'Search Admin',
    phone: '+2348096000003',
    role: 'admin',
  });
  const supervisor = await createGovernmentUser({
    fullName: 'Search Supervisor',
    phone: '+2348096000001',
    role: 'supervisor',
  });
  await createGovernmentUser({
    fullName: 'Search Unassigned Supervisor',
    phone: '+2348096000002',
    role: 'supervisor',
  });

  /*
   * The agent's own LGA is the home one, because the demo agent is seeded into
   * a territory and this test is about what happens either side of its edge.
   */
  const demo = await seedDemoAgent();
  const home = await queryOne<{ lga_id: string; name: string }>(
    pool,
    `SELECT t.lga_id, l.name
       FROM agents a JOIN territories t ON t.id = a.territory_id
       JOIN lgas l ON l.id = t.lga_id
      WHERE a.user_id = (SELECT id FROM users WHERE phone = $1)`,
    [demo!.phone],
  );
  homeLga = { id: home!.lga_id, name: home!.name };

  const other = await queryOne<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM lgas WHERE id <> $1 ORDER BY name LIMIT 1',
    [homeLga.id],
  );
  awayLga = other!;

  await plant(homeLga.id, '01');
  const away = await plant(awayLga.id, '02');
  awayPhone = away.phone;
  awayTin = away.tin;

  // The supervisor supervises the agent's own LGA.
  const territory = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO territories (name, code, lga_id) VALUES ('Search Home','SRCH-1',$1)
     ON CONFLICT (code) DO UPDATE SET lga_id = EXCLUDED.lga_id RETURNING id`,
    [homeLga.id],
  );
  await query(pool, 'INSERT INTO user_territories (user_id, territory_id) VALUES ($1,$2)', [
    supervisor,
    territory!.id,
  ]);

  supervisorToken = (await loginAs('+2348096000001')).accessToken;
  unassignedSupervisorToken = (await loginAs('+2348096000002')).accessToken;
  adminToken = (await loginAs('+2348096000003')).accessToken;

  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  agentDevice = demo!.deviceIdentifier;
});

after(async () => {
  await stopTestServer();
});

const asAgent = () => ({ token: agentToken, deviceId: agentDevice });
const names = (body: unknown) =>
  (body as { last_name: string | null }[]).map((row) => row.last_name);

describe('a field agent searching by name', () => {
  it('finds the trader registered where they work', async () => {
    const response = await get('/taxpayers/search?q=Danlami', asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(names(response.body).includes('Danlami01'), JSON.stringify(response.body));
  });

  it('does not reach a citizen in another Local Government Area', async () => {
    /*
     * The register is walkable by varying the fragment — there is no offset,
     * but there are six hundred and seventy-six two-letter pairs. Bounding it
     * to where the agent actually works is what makes the walk finite and
     * about their own patch.
     */
    const response = await get('/taxpayers/search?q=Danlami', asAgent());
    assert.equal(response.status, 200);
    assert.deepEqual(
      names(response.body).filter((name) => name === 'Danlami02'),
      [],
      'a name fragment reached across the state',
    );
  });

  it('still reaches them by the phone number they hand over', async () => {
    /*
     * The reason the line is drawn at the fragment and not at the person. A
     * trader registered in one LGA buys their levy in the market next door,
     * and an agent who cannot serve them is a worse outcome than the one this
     * is preventing. An identifier is something the citizen presents; a
     * fragment is a guess that can be repeated.
     */
    const response = await get(
      `/taxpayers/search?phone=${encodeURIComponent(awayPhone)}`,
      asAgent(),
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(names(response.body).includes('Danlami02'), JSON.stringify(response.body));
  });

  it('still reaches them by TIN', async () => {
    const response = await get(`/taxpayers/search?tin=${awayTin}`, asAgent());
    assert.equal(response.status, 200);
    assert.ok(names(response.body).includes('Danlami02'), JSON.stringify(response.body));
  });

  it('still may not list the register by levy', async () => {
    const response = await get(`/taxpayers/search?revenueItemId=${marketLevyId}`, asAgent());
    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 200));
  });
});

describe('a supervisor asking about their own territory', () => {
  it('may list who is registered under a levy there, which is their job', async () => {
    const response = await get(
      `/taxpayers/search?revenueItemId=${marketLevyId}`,
      { token: supervisorToken },
    );
    assert.equal(
      response.status,
      200,
      `the role that runs a territory was refused a list of it: ${JSON.stringify(response.body)}`,
    );
    assert.ok(names(response.body).includes('Danlami01'), JSON.stringify(response.body));
  });

  it('is not given the rest of the state along with it', async () => {
    const response = await get(
      `/taxpayers/search?revenueItemId=${marketLevyId}`,
      { token: supervisorToken },
    );
    assert.deepEqual(
      names(response.body).filter((name) => name === 'Danlami02'),
      [],
      'a territory-scoped officer was shown another territory',
    );
  });

  it('is bounded on a name fragment too', async () => {
    const response = await get('/taxpayers/search?q=Danlami', { token: supervisorToken });
    assert.equal(response.status, 200);
    assert.deepEqual(names(response.body).filter((name) => name === 'Danlami02'), []);
  });

  it('is told plainly when they have no territory, rather than shown an empty list', async () => {
    /*
     * Fail-closed, and legible. An empty result reads as "nobody matches",
     * which is a different and wrong belief — and the account most likely to
     * hit this is one an administrator has not finished setting up.
     */
    const response = await get(
      `/taxpayers/search?revenueItemId=${marketLevyId}`,
      { token: unassignedSupervisorToken },
    );
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.match(response.body.error?.message ?? '', /territor/i);
  });
});

describe('an officer who may read every taxpayer', () => {
  it('still reaches both Local Government Areas by name', async () => {
    const response = await get('/taxpayers/search?q=Danlami', { token: adminToken });
    assert.equal(response.status, 200);
    const found = names(response.body);
    assert.ok(found.includes('Danlami01') && found.includes('Danlami02'), JSON.stringify(found));
  });

  it('still lists the whole register by levy', async () => {
    const response = await get(`/taxpayers/search?revenueItemId=${marketLevyId}`, {
      token: adminToken,
    });
    assert.equal(response.status, 200);
    assert.equal(names(response.body).length, 2, JSON.stringify(response.body));
  });
});
