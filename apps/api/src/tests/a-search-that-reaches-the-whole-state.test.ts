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
import { promoteExactIdentifier } from '../routes/taxpayers';
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
let awayPlate = '';
let awayTransactionReference = '';
let homeTin = '';

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

  /*
   * A TIN as the registry issues one: digits, and nothing but digits. The
   * shape matters here — the search box has to be able to tell a TIN from a
   * name, and it does that by looking at the string.
   */
  const tin = `9${suffix}0000001`;
  // And a phone number of the length Nigerian numbers actually are: +234 and
  // ten digits. The old fixture was one digit short, which no citizen's is.
  const phone = `+23480961000${suffix}`;
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
  /*
   * A transaction reference in the shape the platform issues, because the
   * acknowledgement a citizen holds while a payment is in flight is numbered
   * by its transaction and that is the number they quote back.
   */
  const transactionReference = `TXN-2026-00${suffix}01`;
  await query(
    pool,
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
        amount_kobo, total_amount_kobo, status, lga_id, channel, created_by)
     VALUES ($1,$2,$3,$4,$5,50000,50000,'INVOICE_GENERATED',$6,'AGENT_PWA',$7)`,
    [transactionReference, taxpayer!.id, invoice!.id, assessment!.id, item!.id, lgaId, adminUserId],
  );

  // And a vehicle, because a plate is the other thing a citizen hands over.
  const plate = `PL0${suffix}JOS`;
  await query(
    pool,
    `INSERT INTO vehicles (taxpayer_id, registration_number, vehicle_type, owner_name)
     VALUES ($1,$2,'PRIVATE_CAR',$3)`,
    [taxpayer!.id, plate, `Bitrus Danlami${suffix}`],
  );

  return { tin, phone, plate, transactionReference };
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

  homeTin = (await plant(homeLga.id, '01')).tin;
  const away = await plant(awayLga.id, '02');
  awayPhone = away.phone;
  awayTin = away.tin;
  awayPlate = away.plate;
  awayTransactionReference = away.transactionReference;

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

/*
 * THE CARVE-OUT NOTHING COULD REACH.
 *
 * Everything above is true of the API and was false of the product. Every
 * screen that looks a taxpayer up — the collection flow, the register, the
 * picker inside the group and vehicle screens — offers one field labelled
 * "Name, phone or TIN" and sends whatever was typed as `q`. Nothing sends
 * `tin=` or `phone=`. So the rule that an identifier reaches the whole state
 * held only for a caller writing the query by hand: an agent in a Jos South
 * market, holding the TIN of a trader registered in Jos North, typed that TIN
 * into the only box there is and was told nobody matched.
 *
 * The browser test caught it, which is the point of having one — the unit
 * tests above passed the entire time, because they were the only client that
 * knew to use the parameter.
 */
describe('the one search box an agent actually has', () => {
  it('reaches the other Local Government Area when the box holds a TIN', async () => {
    const response = await get(`/taxpayers/search?q=${awayTin}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      names(response.body).includes('Danlami02'),
      'a TIN typed into the only search box did not reach the citizen it identifies',
    );
  });

  it('reaches them when the box holds their phone number', async () => {
    const response = await get(`/taxpayers/search?q=${encodeURIComponent(awayPhone)}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(names(response.body).includes('Danlami02'), JSON.stringify(response.body));
  });

  it('reaches them when the box holds the local form of that number', async () => {
    /*
     * A citizen says "zero eight zero...", not "plus two three four". The
     * column holds +234, so the typed text has to be understood as a phone
     * number rather than matched as characters — which is why this goes
     * through `phoneSchema` and not through a LIKE.
     */
    const local = `0${awayPhone.slice(4)}`;
    const response = await get(`/taxpayers/search?q=${local}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      names(response.body).includes('Danlami02'),
      `08... did not find the citizen stored as ${awayPhone}: ${JSON.stringify(response.body)}`,
    );
  });

  it('reaches them when the number is typed with the spaces a person reads it in', async () => {
    const spaced = `0${awayPhone.slice(4, 7)} ${awayPhone.slice(7, 10)} ${awayPhone.slice(10)}`;
    const response = await get(`/taxpayers/search?q=${encodeURIComponent(spaced)}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(names(response.body).includes('Danlami02'), JSON.stringify(response.body));
  });

  it('reaches them when the box holds the plate on the vehicle in front of the agent', async () => {
    const response = await get(`/taxpayers/search?q=${awayPlate}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(names(response.body).includes('Danlami02'), JSON.stringify(response.body));
  });

  it('reaches them when the box holds the reference off their acknowledgement', async () => {
    const response = await get(`/taxpayers/search?q=${awayTransactionReference}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(names(response.body).includes('Danlami02'), JSON.stringify(response.body));
  });

  it('still does not let a name fragment out of the agent’s own area', async () => {
    /*
     * The direction that matters. Promoting an identifier must not have
     * promoted the thing the scoping exists to stop — `a`, then `ab`, then
     * `ac`, until the register falls out.
     */
    for (const fragment of ['Danlami', 'Dan', 'a', 'Bitrus']) {
      const response = await get(`/taxpayers/search?q=${fragment}`, asAgent());
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(
        names(response.body).filter((name) => name === 'Danlami02'),
        [],
        `the fragment "${fragment}" reached across the state`,
      );
    }
  });

  it('does not treat part of a TIN as the whole of one', async () => {
    /*
     * A prefix is a fragment however numeric it looks, and a prefix that
     * reached statewide would be the same enumeration with a smaller
     * alphabet: ten digits, eight places.
     */
    const response = await get(`/taxpayers/search?q=${awayTin.slice(0, 5)}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(
      names(response.body).filter((name) => name === 'Danlami02'),
      [],
      'part of a TIN reached across the state',
    );
  });

  it('still searches a short run of digits as a fragment, in the agent’s own area', async () => {
    /*
     * The other direction of the same guard. Part of a TIN is a fragment, and
     * a fragment is answered by matching it anywhere in the column — so an
     * agent who has typed the first three digits of a TIN they are reading off
     * a card still sees the trader in front of them. Treating that as a whole
     * identifier would look up `tin = '901'`, find nobody, and tell the agent
     * their own taxpayer does not exist.
     */
    const response = await get(`/taxpayers/search?q=${homeTin.slice(0, 3)}`, asAgent());
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      names(response.body).includes('Danlami01'),
      `part of a TIN stopped finding the agent’s own taxpayer: ${JSON.stringify(response.body)}`,
    );
  });

  it('still refuses to list the register when the box is empty', async () => {
    const response = await get(`/taxpayers/search?revenueItemId=${marketLevyId}`, asAgent());
    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 200));
  });
});

/*
 * The shapes themselves, without a database in the way.
 *
 * The HTTP tests above prove that recognising an identifier widens the reach.
 * This proves what is recognised, which is the half with the sharp edge: read
 * too generously and a business name becomes a plate lookup that finds
 * nobody; read too meanly and the citizen standing in front of the agent
 * cannot be served. Both directions are here, and each shape is the one the
 * platform actually issues — checked against the seeded data, not invented.
 */
describe('what the search box recognises as an identifier', () => {
  const cases: [string, ReturnType<typeof promoteExactIdentifier>][] = [
    // A receipt, and the acknowledgement that precedes one.
    ['PSIRS/2026/000001', { receiptNumber: 'PSIRS/2026/000001' }],
    ['psirs/2026/000001', { receiptNumber: 'PSIRS/2026/000001' }],
    ['TXN-2026-000005', { transactionReference: 'TXN-2026-000005' }],
    // A phone number, in each form a person writes one.
    ['+2348031000014', { phone: '+2348031000014' }],
    ['08031000014', { phone: '+2348031000014' }],
    ['0803 100 0014', { phone: '+2348031000014' }],
    ['234 803 100 0014', { phone: '+2348031000014' }],
    // A TIN.
    ['117212855', { tin: '117212855' }],
    // A plate, written with and without the separators.
    ['PL001JOS', { vehicleRegistration: 'PL001JOS' }],
    ['pl001jos', { vehicleRegistration: 'PL001JOS' }],
    ['ABC-123-DE', { vehicleRegistration: 'ABC123DE' }],
  ];

  for (const [typed, expected] of cases) {
    it(`reads ${typed} as what it is`, () => {
      assert.deepEqual(promoteExactIdentifier(typed), expected);
    });
  }

  const fragments = [
    '',
    '   ',
    'a',
    'ab',
    'Rifkatu',
    'Rifkatu Choji',
    // Part of a TIN, and part of a phone number. A prefix is a guess.
    '117',
    '1172128',
    '0803100',
    // A business name that carries a number, which a looser plate rule would
    // have looked up in the vehicle register and reported as nobody.
    '9JAFOODS',
    'MTN241',
    // A receipt number that has been half typed.
    'PSIRS/2026',
    'TXN-2026',
  ];

  for (const fragment of fragments) {
    it(`treats ${JSON.stringify(fragment)} as a name fragment`, () => {
      assert.equal(promoteExactIdentifier(fragment), null);
    });
  }
});
