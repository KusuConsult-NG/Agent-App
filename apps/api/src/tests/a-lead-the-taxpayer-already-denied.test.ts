/**
 * The connection graph, through the three doors nobody had opened.
 *
 * Coverage rather than a fix, for three of the six routes `route-coverage.mjs`
 * still lists as unexercised:
 *
 *   POST /government/intelligence/rebuild
 *   GET  /government/intelligence/leads
 *   POST /government/intelligence/connections/:id/decision
 *
 * They are one journey and are tested as one: the register is read into the
 * graph, the graph produces a list of people running commercial vehicles who
 * have never been assessed for income tax, and an officer records what the
 * taxpayer said back.
 *
 * THE CLAIM WORTH HOLDING
 *
 * `coverageLeads` admits only edges in state ASSERTED or CONFIRMED_BY_TAXPAYER,
 * and says why: "A disputed or withdrawn edge is not evidence. Chasing somebody
 * on a claim they have already told the State is wrong is how an enforcement
 * list turns into a complaint file."
 *
 * That sentence is a promise to a citizen, and until now nothing checked that
 * the platform keeps it. The decision route and the lead list were both
 * unexercised, so the fact that recording a dispute actually removes somebody
 * from the chase list was true by inspection only.
 *
 * AND THE SCOPE, FOR THE SAME REASON AS THE OBJECTIONS
 *
 * `coverageLeads(db, params, scope = { kind: 'STATEWIDE' })` carries the same
 * defaulted parameter as `openObjections`. A route that stopped passing the
 * caller's scope would hand a supervisor in one LGA the names, phone numbers
 * and vehicle registrations of people in another, and nothing would fail.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
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

const ADMIN = '+2348077500001';
const SUPERVISOR = '+2348077500002';

let officerId = '';
let adminToken = '';
let supervisorToken = '';
let homeLga = '';
let otherLga = '';
let seq = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  seq = 0;

  officerId = await createGovernmentUser({ fullName: 'Graph Admin', phone: ADMIN, role: 'admin' });
  adminToken = (await loginAs(ADMIN)).accessToken;

  /* As in the objections file: the home LGA comes FROM a seeded territory. */
  const seeded = await queryOne<{ id: string; lga_id: string }>(
    pool,
    "SELECT id, lga_id FROM territories WHERE status = 'ACTIVE' ORDER BY name LIMIT 1",
    [],
  );
  assert.ok(seeded, 'the seed publishes at least one territory');
  homeLga = seeded!.lga_id;
  otherLga = (await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM lgas WHERE id <> $1 ORDER BY name LIMIT 1',
    [homeLga],
  ))!.id;

  const supervisorId = await createGovernmentUser({
    fullName: 'Territory Supervisor',
    phone: SUPERVISOR,
    role: 'supervisor',
  });
  await query(
    pool,
    'INSERT INTO user_territories (user_id, territory_id, assigned_by) VALUES ($1,$2,$3)',
    [supervisorId, seeded!.id, officerId],
  );
  supervisorToken = (await loginAs(SUPERVISOR)).accessToken;
});

const admin = () => ({ token: adminToken });
const supervisor = () => ({ token: supervisorToken });

/**
 * Somebody running a taxi who has never been assessed for income tax, which is
 * exactly what the lead list is for.
 *
 * The vehicle is written to the register directly. The register is the State's
 * own record and the graph is built FROM it; going through a renewal would test
 * the renewal path instead, which is covered elsewhere.
 */
async function taxiOwnerIn(lgaId: string): Promise<{ taxpayerId: string; plate: string }> {
  seq += 1;
  const suffix = String(seq).padStart(4, '0');
  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers
       (taxpayer_type, first_name, last_name, phone, address, lga_id, status)
     VALUES ('INDIVIDUAL', 'Danladi', $1, $2, '9 Bauchi Road, Jos', $3, 'ACTIVE')
     RETURNING id`,
    [`Owner${suffix}`, `+23480488${suffix}0`, lgaId],
  );
  const plate = `PL-${suffix}-TX`;
  await query(
    pool,
    `INSERT INTO vehicles
       (taxpayer_id, registration_number, vehicle_type, owner_name, status)
     VALUES ($1, $2, 'TAXI', 'Danladi Owner', 'ACTIVE')`,
    [taxpayer!.id, plate],
  );
  return { taxpayerId: taxpayer!.id, plate };
}

const rebuild = () => post('/government/intelligence/rebuild', {}, admin());
const leads = (auth: Record<string, unknown>) => get('/government/intelligence/leads', auth);

async function connectionFor(taxpayerId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM taxpayer_connections
      WHERE taxpayer_id = $1 AND subject_type = 'VEHICLE' AND kind = 'OWNS'`,
    [taxpayerId],
  );
  assert.ok(row, 'the rebuild asserted an edge for this owner');
  return row!.id;
}

const decide = (connectionId: string, state: string, reason: string) =>
  post(`/government/intelligence/connections/${connectionId}/decision`, { state, reason }, admin());

// ===========================================================================
describe('reading the vehicle register into the graph', () => {
  it('asserts an edge for a taxpayer named on the register', async () => {
    const owner = await taxiOwnerIn(homeLga);

    const built = await rebuild();
    assert.equal(built.status, 200, JSON.stringify(built.body));
    assert.ok(built.body.fromRegistry >= 1, JSON.stringify(built.body));

    const row = await queryOne<{ state: string; source: string; subject_label: string }>(
      pool,
      `SELECT state, source, subject_label FROM taxpayer_connections
        WHERE taxpayer_id = $1 AND subject_type = 'VEHICLE'`,
      [owner.taxpayerId],
    );
    assert.equal(row!.state, 'ASSERTED');
    assert.equal(row!.source, 'VEHICLE_REGISTRY');
    assert.match(row!.subject_label, new RegExp(owner.plate));
  });

  /*
   * Run twice. The route has no job lock, which is only safe because every
   * insert is ON CONFLICT DO NOTHING -- so a second press, or two officers
   * pressing at once, must not double the graph.
   */
  it('does not double the graph when run again', async () => {
    const owner = await taxiOwnerIn(homeLga);
    await rebuild();
    await rebuild();

    const rows = await query<{ id: string }>(
      pool,
      `SELECT id FROM taxpayer_connections WHERE taxpayer_id = $1 AND subject_type = 'VEHICLE'`,
      [owner.taxpayerId],
    );
    assert.equal(rows.length, 1, 'the second rebuild asserted the same edge again');
  });
});

// ===========================================================================
describe('the coverage lead list', () => {
  it('names somebody running a taxi who has never been assessed for income tax', async () => {
    const owner = await taxiOwnerIn(homeLga);
    await rebuild();

    const answer = await leads(admin());
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const rows = answer.body.rows as { taxpayerId: string; commercialVehicles: number }[];
    assert.equal(rows.length, 1, JSON.stringify(answer.body));
    assert.equal(rows[0]!.taxpayerId, owner.taxpayerId);
  });

  it('does not hand a supervisor the names of people in another LGA', async () => {
    await taxiOwnerIn(otherLga);
    await rebuild();

    const answer = await leads(supervisor());
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.deepEqual(
      answer.body.rows,
      [],
      'a territory-scoped supervisor was served a lead from another LGA',
    );
  });

  it('still serves that lead to a reader whose scope is the whole State', async () => {
    await taxiOwnerIn(otherLga);
    await rebuild();

    const answer = await leads(admin());
    assert.equal((answer.body.rows as unknown[]).length, 1, JSON.stringify(answer.body));
  });
});

// ===========================================================================
describe('what the taxpayer said back', () => {
  /*
   * The promise in the service's own words: "Chasing somebody on a claim they
   * have already told the State is wrong is how an enforcement list turns into
   * a complaint file."
   */
  it('takes somebody off the chase list once they have denied the vehicle is theirs', async () => {
    const owner = await taxiOwnerIn(homeLga);
    await rebuild();
    assert.equal((await leads(admin())).body.rows.length, 1, 'they start on the list');

    const decided = await decide(
      await connectionFor(owner.taxpayerId),
      'DISPUTED',
      'Says the taxi was sold in 2024 and produced the receipt.',
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));

    const after = await leads(admin());
    assert.deepEqual(
      after.body.rows,
      [],
      'somebody who told the State the vehicle is not theirs is still being chased',
    );
  });

  /*
   * A control, and the other half of the rule. Confirming the edge must leave
   * them on the list -- a decision route that dropped everybody it touched
   * would empty the list rather than clean it.
   */
  it('leaves somebody on the list when they confirm the vehicle is theirs', async () => {
    const owner = await taxiOwnerIn(homeLga);
    await rebuild();

    const decided = await decide(
      await connectionFor(owner.taxpayerId),
      'CONFIRMED_BY_TAXPAYER',
      'Confirmed on the telephone, 12 September.',
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));

    const after = await leads(admin());
    assert.equal((after.body.rows as unknown[]).length, 1, JSON.stringify(after.body));
  });

  it('refuses a decision with no reason behind it', async () => {
    const owner = await taxiOwnerIn(homeLga);
    await rebuild();

    const decided = await decide(await connectionFor(owner.taxpayerId), 'DISPUTED', '   ');
    assert.equal(decided.status, 422, JSON.stringify(decided.body));
  });

  it('writes the change to the audit log, with what it was before', async () => {
    const owner = await taxiOwnerIn(homeLga);
    await rebuild();
    await decide(await connectionFor(owner.taxpayerId), 'WITHDRAWN', 'Register entry was a typo.');

    const entry = await queryOne<{ old_value: unknown; new_value: unknown; reason: string }>(
      pool,
      `SELECT old_value, new_value, reason FROM audit_logs
        WHERE action = 'connection.state_changed' ORDER BY created_at DESC LIMIT 1`,
      [],
    );
    assert.ok(entry, 'the change was written down');
    assert.deepEqual(entry!.old_value, { state: 'ASSERTED' });
    assert.match(entry!.reason, /typo/i);
  });
});
