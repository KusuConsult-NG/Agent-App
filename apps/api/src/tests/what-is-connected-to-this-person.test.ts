/**
 * The asset graph, and the rules that stop it becoming a dossier.
 *
 * Phase 2 of the informal-sector programme finds people the State should have
 * assessed and has not, from registers it already owns. The revenue case is
 * easy; the part that needs holding down is everything around it, because the
 * naive build of "show me what is connected to this citizen" is a surveillance
 * system with a revenue justification.
 *
 * Four properties carry that weight, and three of them are tested twice —
 * once through the service and once by issuing SQL directly, on this project's
 * standing rule that a guarantee which only holds through the service layer is
 * not an invariant.
 *
 *   A claim says where it came from. An edge nobody can source cannot be
 *   defended to the person it describes.
 *
 *   A claim cannot be edited. Confidence that can be raised after the fact is
 *   not confidence, it is a number somebody picked, and "match, never merge"
 *   means nothing if a phone-number guess can be promoted to a registry fact
 *   by an UPDATE.
 *
 *   An ambiguous match produces nothing. A phone shared by two taxpayers
 *   identifies neither, and asserting both puts a citizen on an enforcement
 *   list because a handset was reused.
 *
 *   Every read is logged with a purpose that cannot be omitted.
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
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne, query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import {
  coverageLeads,
  connectionAccessHistory,
  readConnections,
  rebuildVehicleConnections,
  recordConnectionDecision,
} from '../services/connections';

let auth: { token: string; deviceId: string };
let officerId: string;
let seq = 0;

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Revenue Admin',
    phone: '+2348000000001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  seq = 0;
});

async function taxpayer(name: string, phone?: string) {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: name,
      lastName: `Owner${suffix}`,
      phone: phone ?? `+23480666${suffix}`,
      address: '9 Rukuba Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `conn-tp-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

/**
 * A vehicle on the register, through the ordinary capture route.
 *
 * Built through the API rather than inserted, so the test exercises rows the
 * platform actually produces. `taxpayerId` is left off to model the common
 * case: a vehicle captured in the field against an owner name and a phone,
 * with nobody having linked it to a taxpayer record.
 */
async function vehicle(params: {
  registration: string;
  type?: string;
  ownerName?: string;
  ownerPhone?: string;
  taxpayerId?: string;
}) {
  seq += 1;
  const response = await post(
    '/vehicles',
    {
      registrationNumber: params.registration,
      vehicleType: params.type ?? 'COMMERCIAL',
      make: 'Toyota',
      model: 'Hiace',
      ownerName: params.ownerName ?? 'Field Captured Owner',
      ...(params.ownerPhone ? { ownerPhone: params.ownerPhone } : {}),
      ...(params.taxpayerId ? { taxpayerId: params.taxpayerId } : {}),
    },
    { ...auth, idempotencyKey: `conn-veh-${seq}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return (
    await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM vehicles WHERE registration_number = $1',
      [params.registration],
    )
  )!.id;
}

const edgesFor = (taxpayerId: string) =>
  query<{
    id: string;
    confidence: number;
    match_basis: string;
    state: string;
    obtained_by_job: string | null;
    lawful_basis: string;
    subject_label: string;
  }>(
    pool,
    `SELECT id, confidence, match_basis, state, obtained_by_job, lawful_basis, subject_label
       FROM taxpayer_connections WHERE taxpayer_id = $1 ORDER BY confidence DESC`,
    [taxpayerId],
  );

describe('building the graph from the register', () => {
  it('asserts what the register itself says, believed outright', async () => {
    const owner = await taxpayer('Registered');
    await vehicle({ registration: 'PL-101-AA', taxpayerId: owner });

    const result = await rebuildVehicleConnections(pool);
    assert.equal(result.fromRegistry, 1);

    const [edge] = await edgesFor(owner);
    assert.ok(edge, 'the register naming a taxpayer is an edge');
    assert.equal(edge!.confidence, 100);
    assert.equal(edge!.match_basis, 'TAXPAYER_ID');
    assert.ok(edge!.subject_label.includes('PL-101-AA'), 'named so an officer can check it');
  });

  it('asserts a shared phone as a weaker claim, and says so on the row', async () => {
    /*
     * The distinction the whole design turns on. A phone two records happen to
     * share is a lead; the register naming the taxpayer is the State's own
     * record. Storing both at the same confidence would erase the difference
     * exactly where somebody is about to act on it.
     */
    const owner = await taxpayer('Phoned', '+2348079990001');
    await vehicle({ registration: 'PL-202-BB', ownerPhone: '+2348079990001' });

    const result = await rebuildVehicleConnections(pool);
    assert.equal(result.fromPhone, 1);

    const [edge] = await edgesFor(owner);
    assert.equal(edge!.confidence, 85, 'a shared phone is not a registry fact');
    assert.equal(edge!.match_basis, 'SHARED_PHONE');
  });

  it('asserts nothing when a phone matches two taxpayers', async () => {
    /*
     * Registration refuses a second taxpayer on a phone already in use, so the
     * collision is made afterwards — which is how it arises in practice, when
     * somebody corrects a number on one record to one another record already
     * holds. `taxpayers.phone` carries an index and no unique constraint, so
     * the state is one the schema permits and the builder has to survive.
     */
    const first = await taxpayer('Twin One', '+2348079990002');
    const second = await taxpayer('Twin Two', '+2348079990012');
    await pool.query(`UPDATE taxpayers SET phone = $2 WHERE id = $1`, [
      second,
      '+2348079990002',
    ]);
    await vehicle({ registration: 'PL-303-CC', ownerPhone: '+2348079990002' });

    const result = await rebuildVehicleConnections(pool);

    assert.equal(result.fromPhone, 0, 'a phone matching two people identifies neither');
    assert.equal((await edgesFor(first)).length, 0);
    assert.equal((await edgesFor(second)).length, 0);
    assert.equal(
      result.ambiguous,
      1,
      'and it is counted, because a number nobody sees is a data problem nobody fixes',
    );
  });

  it('can be run twice without doubling the graph', async () => {
    const owner = await taxpayer('Repeated');
    await vehicle({ registration: 'PL-404-DD', taxpayerId: owner });

    await rebuildVehicleConnections(pool);
    const second = await rebuildVehicleConnections(pool);

    assert.equal(second.asserted, 0, 'the second run asserts nothing new');
    assert.equal((await edgesFor(owner)).length, 1);
  });

  it('leaves an archived vehicle out, because it is not an asset any more', async () => {
    const owner = await taxpayer('Archived');
    const vehicleId = await vehicle({ registration: 'PL-505-EE', taxpayerId: owner });
    await pool.query(`UPDATE vehicles SET status = 'ARCHIVED' WHERE id = $1`, [vehicleId]);

    await rebuildVehicleConnections(pool);
    assert.equal((await edgesFor(owner)).length, 0);
  });

  it('names the job that made each claim, and the power relied on', async () => {
    const owner = await taxpayer('Sourced');
    await vehicle({ registration: 'PL-606-FF', taxpayerId: owner });
    await rebuildVehicleConnections(pool);

    const [edge] = await edgesFor(owner);
    assert.equal(edge!.obtained_by_job, 'connection-graph');
    assert.ok(
      edge!.lawful_basis.length > 20,
      'an edge that cannot say what power it rests on cannot be defended to the person it is about',
    );
  });
});

describe('what the database refuses, with the service bypassed', () => {
  /*
   * The tests above go through the service. These issue SQL directly, because
   * a rule the service enforces and the database does not is one UPDATE away
   * from being undone by a compromised service account or a DBA at a prompt —
   * and this table holds claims about citizens.
   */
  it('refuses an edge that cannot say where it came from', async () => {
    const owner = await taxpayer('Anonymous');
    await assert.rejects(
      pool.query(
        `INSERT INTO taxpayer_connections
           (taxpayer_id, kind, subject_type, subject_id, subject_label,
            source, confidence, match_basis, lawful_basis)
         VALUES ($1, 'OWNS', 'VEHICLE', gen_random_uuid(), 'PL-999-ZZ',
                 'VEHICLE_REGISTRY', 100, 'TAXPAYER_ID', 'because we say so')`,
        [owner],
      ),
      /connection_has_an_origin/,
    );
  });

  it('refuses to raise the confidence of a claim already made', async () => {
    /*
     * "Match, never merge" as a schema property. If an 85 can become a 100,
     * the confidence column is decoration and every downstream decision that
     * reads it is being told a story.
     */
    const owner = await taxpayer('Promoted', '+2348079990003');
    await vehicle({ registration: 'PL-707-GG', ownerPhone: '+2348079990003' });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    await assert.rejects(
      pool.query('UPDATE taxpayer_connections SET confidence = 100 WHERE id = $1', [edge!.id]),
      /immutable|cannot be changed|confidence/i,
    );
  });

  it('refuses a state change nobody signed', async () => {
    const owner = await taxpayer('Unsigned');
    await vehicle({ registration: 'PL-808-HH', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    await assert.rejects(
      pool.query(`UPDATE taxpayer_connections SET state = 'WITHDRAWN' WHERE id = $1`, [edge!.id]),
      /without recording who/i,
    );
  });

  it('refuses a state change with no reason given', async () => {
    const owner = await taxpayer('Unexplained');
    await vehicle({ registration: 'PL-909-II', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    await assert.rejects(
      pool.query(
        `UPDATE taxpayer_connections
            SET state = 'WITHDRAWN', state_changed_by = $2, state_changed_at = now()
          WHERE id = $1`,
        [edge!.id, officerId],
      ),
      /without a reason/i,
    );
  });

  it('refuses to delete a claim, so a citizen can always be shown what was held', async () => {
    const owner = await taxpayer('Undeletable');
    await vehicle({ registration: 'PL-111-JJ', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    await assert.rejects(
      pool.query('DELETE FROM taxpayer_connections WHERE id = $1', [edge!.id]),
      /delete/i,
    );
  });

  it('refuses to revive a claim the State withdrew', async () => {
    const owner = await taxpayer('Revived');
    await vehicle({ registration: 'PL-222-KK', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    await recordConnectionDecision(pool, {
      connectionId: edge!.id,
      state: 'WITHDRAWN',
      reason: 'The vehicle was sold before this record was made',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      pool.query(
        `UPDATE taxpayer_connections
            SET state = 'ASSERTED', state_changed_by = $2, state_changed_at = now(),
                state_reason = 'on reflection'
          WHERE id = $1`,
        [edge!.id, officerId],
      ),
      /withdrawn/i,
    );
  });

  it('refuses to edit the log of who looked', async () => {
    const owner = await taxpayer('Watched');
    await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'CONSISTENCY_CHECK',
      actorId: officerId,
    });
    const row = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM taxpayer_connection_access_logs WHERE taxpayer_id = $1',
      [owner],
    );

    await assert.rejects(
      pool.query(
        `UPDATE taxpayer_connection_access_logs SET purpose = 'TAXPAYER_REQUEST' WHERE id = $1`,
        [row!.id],
      ),
      /update/i,
    );
    await assert.rejects(
      pool.query('DELETE FROM taxpayer_connection_access_logs WHERE id = $1', [row!.id]),
      /delete/i,
    );
  });
});

describe('reading a person’s record', () => {
  it('logs the read against the person, with the purpose that was claimed', async () => {
    const owner = await taxpayer('Read');
    await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'COVERAGE_LEAD',
      actorId: officerId,
      ipAddress: '10.0.0.9',
    });

    const log = await queryOne<{ purpose: string; accessed_by: string; ip_address: string }>(
      pool,
      'SELECT purpose, accessed_by, ip_address::text FROM taxpayer_connection_access_logs WHERE taxpayer_id = $1',
      [owner],
    );
    assert.equal(log!.purpose, 'COVERAGE_LEAD');
    assert.equal(log!.accessed_by, officerId);
    // `inet` renders with its mask, which is the column doing its job.
    assert.equal(log!.ip_address, '10.0.0.9/32');
  });

  it('shows the citizen who looked and why, without naming the officer', async () => {
    const owner = await taxpayer('Curious');
    await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'TAXPAYER_REQUEST',
      actorId: officerId,
    });

    const history = await connectionAccessHistory(pool, owner);
    assert.equal(history.length, 1);
    assert.equal(history[0]!.purpose, 'TAXPAYER_REQUEST');
    assert.equal(history[0]!.officerRole, 'admin', 'the role, so the read is accountable');
    assert.ok(
      !('officerName' in history[0]!),
      'and not the individual — in a small LGA that invites reprisal and adds no accountability',
    );
  });

  it('hides a withdrawn claim from the officer view and keeps it for the citizen', async () => {
    const owner = await taxpayer('Withdrawn');
    await vehicle({ registration: 'PL-333-LL', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);
    await recordConnectionDecision(pool, {
      connectionId: edge!.id,
      state: 'WITHDRAWN',
      reason: 'Vehicle belongs to the applicant’s employer',
      actorId: officerId,
      actorRole: 'admin',
    });

    const officerView = await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'CONSISTENCY_CHECK',
      actorId: officerId,
    });
    assert.equal(officerView.connections.length, 0, 'a retracted claim is not evidence');

    const citizenView = await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'TAXPAYER_REQUEST',
      actorId: officerId,
      includeWithdrawn: true,
    });
    assert.equal(
      citizenView.connections.length,
      1,
      'the person it was about is entitled to see what was once believed',
    );
    assert.equal(citizenView.connections[0]!.state, 'WITHDRAWN');
  });

  it('records a taxpayer confirming a claim about themselves', async () => {
    /*
     * The state that makes a high-impact edge usable. The design rule is that
     * a claim must be confirmed by the person it describes before it drives an
     * assessment, so the confirmation has to be a recorded fact and not an
     * officer's recollection of a conversation.
     */
    const owner = await taxpayer('Agreeing');
    await vehicle({ registration: 'PL-C01-WW', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    const decided = await recordConnectionDecision(pool, {
      connectionId: edge!.id,
      state: 'CONFIRMED_BY_TAXPAYER',
      reason: 'Taxpayer confirmed the vehicle is theirs when the officer called',
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(decided.state, 'CONFIRMED_BY_TAXPAYER');
    assert.ok(decided.stateReason, 'and the record says on what footing');

    const view = await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'CONSISTENCY_CHECK',
      actorId: officerId,
    });
    assert.equal(view.connections[0]!.state, 'CONFIRMED_BY_TAXPAYER');
  });

  it('refuses a decision nobody explained', async () => {
    const owner = await taxpayer('Silent');
    await vehicle({ registration: 'PL-C02-XX', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    await assert.rejects(
      recordConnectionDecision(pool, {
        connectionId: edge!.id,
        state: 'WITHDRAWN',
        reason: '   ',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /why this claim is being changed/i,
    );
  });

  it('shows what they owe alongside what they own, and which part is payable', async () => {
    const owner = await taxpayer('Owing');
    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: owner,
        revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
        inputs: {},
      },
      { ...auth, idempotencyKey: `conn-as-${seq}` },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    const view = await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'CONSISTENCY_CHECK',
      actorId: officerId,
    });

    assert.equal(view.liabilities.length, 1, 'the liability half is the point of the view');
    assert.ok(BigInt(view.totalOwedKobo) > 0n);
    assert.equal(view.liabilities[0]!.payable, true);

    await pool.query(
      `UPDATE invoices SET expires_at = now() - interval '1 day' WHERE id = $1`,
      [assessment.body.invoiceId],
    );
    const later = await readConnections(pool, {
      taxpayerId: owner,
      purpose: 'CONSISTENCY_CHECK',
      actorId: officerId,
    });
    assert.equal(
      later.liabilities[0]!.payable,
      false,
      'an officer must know which of this can be taken today',
    );
  });
});

describe('the coverage lead', () => {
  it('finds a commercial vehicle owner with no income assessment', async () => {
    const owner = await taxpayer('Hauler');
    await vehicle({ registration: 'PL-444-MM', type: 'COMMERCIAL', taxpayerId: owner });
    await rebuildVehicleConnections(pool);

    const leads = await coverageLeads(pool);
    const row = leads.rows.find((lead) => lead.taxpayerId === owner);

    assert.ok(row, 'somebody running a commercial vehicle has an income');
    assert.equal(row!.commercialVehicles, 1);
    assert.equal(row!.lowestConfidence, 100);
    assert.ok(row!.registrations.some((r) => r.includes('PL-444-MM')));
  });

  it('drops them once they have been assessed for income tax', async () => {
    const owner = await taxpayer('Assessed');
    await vehicle({ registration: 'PL-555-NN', type: 'COMMERCIAL', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    assert.ok(coverageLeadsHas(await coverageLeads(pool), owner));

    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: owner,
        revenueItemId: await revenueItemByCode('PIT-DIRECT'),
        assessmentType: 'SELF_ASSESSMENT',
        inputs: { baseAmountKobo: '240000000' },
      },
      { ...auth, idempotencyKey: `conn-pit-${seq}` },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    // Belt and braces: the fixture must actually have produced a PIT
    // assessment, or the assertion below passes for the wrong reason.
    const category = await queryOne<{ code: string }>(
      pool,
      `SELECT rc.code FROM assessments a
         JOIN revenue_items ri      ON ri.id = a.revenue_item_id
         JOIN revenue_categories rc ON rc.id = ri.category_id
        WHERE a.id = $1`,
      [assessment.body.assessmentId],
    );
    assert.equal(category!.code, 'PIT');

    assert.equal(
      coverageLeadsHas(await coverageLeads(pool), owner),
      false,
      'a list headed "never assessed" must not carry people who have been',
    );
  });

  it('leaves a private car alone', async () => {
    const owner = await taxpayer('Commuter');
    await vehicle({ registration: 'PL-666-OO', type: 'PRIVATE', taxpayerId: owner });
    await rebuildVehicleConnections(pool);

    assert.equal(
      coverageLeadsHas(await coverageLeads(pool), owner),
      false,
      'owning a car is not evidence of a business',
    );
  });

  it('does not chase somebody on a claim they have disputed', async () => {
    const owner = await taxpayer('Disputing');
    await vehicle({ registration: 'PL-777-PP', type: 'COMMERCIAL', taxpayerId: owner });
    await rebuildVehicleConnections(pool);
    const [edge] = await edgesFor(owner);

    await recordConnectionDecision(pool, {
      connectionId: edge!.id,
      state: 'DISPUTED',
      reason: 'Taxpayer says the vehicle is their brother’s',
      actorId: officerId,
      actorRole: 'admin',
    });

    assert.equal(
      coverageLeadsHas(await coverageLeads(pool), owner),
      false,
      'chasing a contested claim is how an enforcement list becomes a complaint file',
    );
  });

  it('says how many vehicles it could not connect to anybody', async () => {
    await vehicle({ registration: 'PL-888-QQ', type: 'COMMERCIAL', ownerPhone: '+2348070000999' });
    await rebuildVehicleConnections(pool);

    const leads = await coverageLeads(pool);
    assert.equal(
      leads.summary.unmatchedVehicles,
      1,
      'a lead count with no denominator reads as completeness',
    );
  });

  it('ranks by how many vehicles, because that is the size of the case', async () => {
    const one = await taxpayer('One Bus');
    const three = await taxpayer('Three Buses');
    await vehicle({ registration: 'PL-A01-RR', taxpayerId: one });
    for (const reg of ['PL-B01-SS', 'PL-B02-TT', 'PL-B03-UU']) {
      await vehicle({ registration: reg, taxpayerId: three });
    }
    await rebuildVehicleConnections(pool);

    const leads = await coverageLeads(pool);
    const order = leads.rows.map((row) => row.taxpayerId);
    assert.ok(
      order.indexOf(three) < order.indexOf(one),
      `three vehicles outranks one: ${JSON.stringify(leads.rows.map((r) => [r.name, r.commercialVehicles]))}`,
    );
  });

  it('narrows to the officer’s own territories', async () => {
    const owner = await taxpayer('Elsewhere');
    await vehicle({ registration: 'PL-999-VV', type: 'COMMERCIAL', taxpayerId: owner });
    await rebuildVehicleConnections(pool);

    const lgaId = (await queryOne<{ lga_id: string }>(
      pool,
      'SELECT lga_id FROM taxpayers WHERE id = $1',
      [owner],
    ))!.lga_id;
    const otherLga = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 LIMIT 1',
      [lgaId],
    );
    const territory = await queryOne<{
      id: string; name: string; name_ha: string | null; code: string;
    }>(pool, 'SELECT id, name, name_ha, code FROM territories WHERE lga_id = $1 LIMIT 1', [
      otherLga!.id,
    ]);
    assert.ok(territory, 'the fixture needs a territory in another LGA');

    const elsewhere = await coverageLeads(pool, {}, {
      kind: 'TERRITORIES',
      territories: [
        {
          id: territory!.id,
          name: territory!.name,
          nameHa: territory!.name_ha,
          code: territory!.code,
          lgaId: otherLga!.id,
        },
      ],
    });
    assert.equal(
      coverageLeadsHas(elsewhere, owner),
      false,
      'a lead in another LGA is not this supervisor’s to work',
    );
  });
});

function coverageLeadsHas(leads: Awaited<ReturnType<typeof coverageLeads>>, taxpayerId: string) {
  return leads.rows.some((row) => row.taxpayerId === taxpayerId);
}

describe('who may ask, and why', () => {
  it('refuses a read that does not say what it is for', async () => {
    const owner = await taxpayer('Purposeless');
    const officer = await loginAs('+2348000000001');

    const bare = await get(`/government/intelligence/taxpayers/${owner}`, {
      token: officer.accessToken,
    });
    assert.equal(
      bare.status,
      422,
      'a purpose that may be omitted is not a purpose-bound system',
    );

    // And the same officer, having said what it is for, is allowed through —
    // so the test is about the missing purpose rather than about the officer.
    const stated = await get(
      `/government/intelligence/taxpayers/${owner}?purpose=CONSISTENCY_CHECK`,
      { token: officer.accessToken },
    );
    assert.equal(stated.status, 200, JSON.stringify(stated.body));
  });

  it('refuses a purpose outside the two uses this graph is for', async () => {
    const owner = await taxpayer('Inventive');
    const officer = await loginAs('+2348000000001');
    const response = await get(
      `/government/intelligence/taxpayers/${owner}?purpose=CURIOSITY`,
      { token: officer.accessToken },
    );
    assert.equal(response.status, 422, 'the vocabulary is the limit; free text would not be');
  });

  it('is refused to an agent entirely', async () => {
    const owner = await taxpayer('Private');
    const response = await get(
      `/government/intelligence/taxpayers/${owner}?purpose=COVERAGE_LEAD`,
      auth,
    );
    assert.equal(response.status, 403, `got ${response.status}`);
  });

  it('refuses a supervisor a taxpayer outside their territories', async () => {
    /*
     * Refused rather than answered empty. An empty record would tell the
     * officer the person exists somewhere they may not look, which is itself
     * the disclosure the scope is meant to prevent.
     */
    const owner = await taxpayer('Outsider');
    await createGovernmentUser({
      fullName: 'District Supervisor',
      phone: '+2348000000077',
      role: 'supervisor',
    });
    const supervisor = await loginAs('+2348000000077');

    const response = await get(
      `/government/intelligence/taxpayers/${owner}?purpose=COVERAGE_LEAD`,
      { token: supervisor.accessToken },
    );
    assert.equal(response.status, 403, `got ${response.status}: ${JSON.stringify(response.body)}`);
  });
});
