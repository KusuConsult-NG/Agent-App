/**
 * The objection window, over HTTP, from the three doors nobody had opened.
 *
 * `what-the-agent-saw.test.ts` exercises `raiseObjection`, `openObjections` and
 * `attestObservation` thoroughly by calling them directly. What no test had
 * ever done is reach them through their routes, and the route layer is where a
 * different class of thing lives: which permission opens the door, and whether
 * the officer's territory is applied to what comes back.
 *
 * Three of the nine routes the coverage tool still lists as unexercised:
 *
 *   POST /government/enumeration/assessments/:id/object
 *   GET  /government/enumeration/objections
 *   POST /government/enumeration/observations/:id/attest
 *
 * WHY THE SCOPE ASSERTION IS THE ONE THAT EARNS ITS KEEP
 *
 * `openObjections(db, scope = { kind: 'STATEWIDE' })` has a default. The route
 * resolves the caller's scope and passes it, and if that argument were ever
 * dropped -- one deleted identifier -- every officer would silently be served
 * every open objection in Plateau State, and no test would have failed. A
 * defaulted parameter is a hole that looks like a convenience.
 *
 * WHY AN AGENT MUST BE ABLE TO RAISE ONE
 *
 * The route admits `assessment:create` as well as `paye:file`, and says why:
 * "An agent at a stall hears the trader say the count is wrong and must be able
 * to write it down there, rather than telling them to come to an office -- an
 * objection that is hard to raise is an objection window that exists on paper."
 * `agent` holds `assessment:create` in migration 059, so the premise is true
 * today. It is asserted here so that a permission edit cannot quietly close the
 * stall door while leaving the sentence in place.
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
import { seedDemoAgent } from '../db/seed-agent';
import { assessFromObservation, recordObservation } from '../services/enumeration';
import { adoptNanoPolicy, classifyLga, publishScheduleEntry } from '../services/presumptive';

const SUPERVISOR = '+2348077400001';
const ADMIN = '+2348077400002';

let officerId = '';
let supervisorToken = '';
let adminToken = '';
let agentAuth: { token: string; deviceId: string };
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

  officerId = await createGovernmentUser({ fullName: 'Enum Admin', phone: ADMIN, role: 'admin' });
  adminToken = (await loginAs(ADMIN)).accessToken;

  /*
   * The home LGA is taken FROM a seeded territory rather than chosen first,
   * because `territories` is reference data that `resetDatabase` deliberately
   * does not truncate -- inserting one here with a fixed code collides with
   * itself on the second test in the file.
   */
  const seeded = await queryOne<{ id: string; lga_id: string }>(
    pool,
    "SELECT id, lga_id FROM territories WHERE status = 'ACTIVE' ORDER BY name LIMIT 1",
    [],
  );
  assert.ok(seeded, 'the seed publishes at least one territory');
  homeLga = seeded!.lga_id;
  const elsewhere = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM lgas WHERE id <> $1 ORDER BY name LIMIT 1',
    [homeLga],
  );
  otherLga = elsewhere!.id;

  /*
   * A supervisor, which is the only seeded role holding `report:read:territory`
   * WITHOUT `report:read:all` -- so `resolveReportScope` returns TERRITORIES
   * rather than short-circuiting to statewide, which is what makes the scope
   * assertion below mean anything.
   */
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

  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  // Phase 4's outputs, without which an assessment refuses to be made at all.
  await adoptNanoPolicy(pool, {
    construction: 'CONJUNCTIVE',
    turnoverCeilingKobo: '1200000000',
    legalBasis: 'Opinion of the Attorney-General of Plateau State, 12 January 2026',
    effectiveFrom: '2026-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
  for (const lgaId of [homeLga, otherLga]) {
    await classifyLga(pool, {
      lgaId,
      classCode: 'A',
      indexInputs: { roadAccess: 'paved' },
      indexSource: 'National Bureau of Statistics',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2029-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });
  }
  await publishScheduleEntry(pool, {
    economicSector: 'ARTISAN_CRAFT',
    sizeBand: 'SMALL',
    lgaClass: 'A',
    assumedAnnualTurnoverKobo: '480000000',
    instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
    effectiveFrom: '2026-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
});

const supervisor = () => ({ token: supervisorToken });
const admin = () => ({ token: adminToken });

/** A tailor with a lock-up shop, two machines and one apprentice. */
const TAILOR = {
  premises: 'LOCK_UP_SHOP' as const,
  equipmentCount: 2,
  peopleWorking: 1,
  economicSector: 'ARTISAN_CRAFT',
};

async function traderIn(lgaId: string): Promise<string> {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Stall',
      lastName: `Trader${suffix}`,
      phone: `+23480477${suffix}`,
      address: '7 Terminus Market, Jos',
      lgaId,
      economicSector: 'ARTISAN_CRAFT',
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `obj-tp-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

/** An observed trader carrying a presumptive assessment, in a chosen LGA. */
async function assessedTraderIn(lgaId: string): Promise<{ assessmentId: string }> {
  const taxpayerId = await traderIn(lgaId);
  const observation = await recordObservation(pool, {
    taxpayerId,
    ...TAILOR,
    actorId: officerId,
    actorRole: 'admin',
  });
  const assessment = await assessFromObservation(pool, {
    observationId: observation.id,
    actorId: officerId,
    actorRole: 'admin',
  });
  assert.equal(assessment.taxTier, 'PRESUMPTIVE', 'the trader is inside the tax net');
  return { assessmentId: assessment.id };
}

const objectTo = (assessmentId: string, auth: Record<string, unknown>) =>
  post(
    `/government/enumeration/assessments/${assessmentId}/object`,
    { ground: 'FACTS_WRONG', statement: 'The second machine belongs to my brother.' },
    auth,
  );

// ===========================================================================
describe('an objection raised at the stall', () => {
  it('is accepted from the agent standing in front of the trader', async () => {
    const { assessmentId } = await assessedTraderIn(homeLga);

    const raised = await objectTo(assessmentId, agentAuth);
    assert.equal(raised.status, 201, JSON.stringify(raised.body));
    assert.ok(raised.body.id, 'the objection has an id to decide later');
  });

  it('reaches the worklist of the supervisor whose territory it is in', async () => {
    const { assessmentId } = await assessedTraderIn(homeLga);
    await objectTo(assessmentId, agentAuth);

    const worklist = await get('/government/enumeration/objections', supervisor());
    assert.equal(worklist.status, 200, JSON.stringify(worklist.body));
    const rows = worklist.body as { presumptiveAssessmentId: string; assessedBy: string }[];
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0]!.presumptiveAssessmentId, assessmentId);
  });

  /*
   * The one that would catch the defaulted scope. `openObjections` falls back
   * to STATEWIDE when no scope is passed, so a route that stopped passing it
   * would serve this supervisor an objection from an LGA they have no business
   * seeing, and every other assertion in this file would still pass.
   */
  it('does not reach a supervisor whose territory it is not in', async () => {
    const away = await assessedTraderIn(otherLga);
    await objectTo(away.assessmentId, agentAuth);

    const worklist = await get('/government/enumeration/objections', supervisor());
    assert.equal(worklist.status, 200, JSON.stringify(worklist.body));
    assert.deepEqual(
      worklist.body,
      [],
      'a territory-scoped supervisor was served an objection from another LGA',
    );
  });

  /*
   * And the statewide reader still sees it, so the test above is measuring
   * scope rather than an objection that was never raised.
   */
  it('does reach a reader whose scope is the whole State', async () => {
    const away = await assessedTraderIn(otherLga);
    await objectTo(away.assessmentId, agentAuth);

    const worklist = await get('/government/enumeration/objections', admin());
    assert.equal(worklist.status, 200, JSON.stringify(worklist.body));
    assert.equal((worklist.body as unknown[]).length, 1, JSON.stringify(worklist.body));
  });

  it('names the officer who raised the assessment, who may not decide it', async () => {
    const { assessmentId } = await assessedTraderIn(homeLga);
    await objectTo(assessmentId, agentAuth);

    const worklist = await get('/government/enumeration/objections', supervisor());
    const rows = worklist.body as { assessedBy: string }[];
    assert.equal(
      rows[0]!.assessedBy,
      officerId,
      'the worklist must say whose assessment this is, since that officer is barred from deciding it',
    );
  });

  it('refuses a second objection while the first is still open', async () => {
    const { assessmentId } = await assessedTraderIn(homeLga);
    assert.equal((await objectTo(assessmentId, agentAuth)).status, 201);

    const again = await objectTo(assessmentId, agentAuth);
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error.code, 'OBJECTION_ALREADY_OPEN');
  });
});

// ===========================================================================
describe('a group leader attesting to what the agent wrote down', () => {
  async function observationAwaitingAttestation(): Promise<string> {
    seq += 1;
    const group = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayer_groups
         (code, name, group_type, lga_id, leader_name, leader_phone, registered_by, tax_role,
          economic_sector)
       VALUES ($1,'Terminus Tailors Guild','ARTISAN_GUILD',$2,'Guild Leader',$3,$4,'ATTESTATION',
               'ARTISAN_CRAFT')
       RETURNING id`,
      [`GRP-OBJ-${seq}`, homeLga, `+23481277${String(seq).padStart(5, '0')}`, officerId],
    );
    const taxpayerId = await traderIn(homeLga);
    const observation = await recordObservation(pool, {
      taxpayerId,
      ...TAILOR,
      groupId: group!.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(observation.attestationState, 'PENDING', 'the guild is asked to attest');
    return observation.id;
  }

  it('records the leader agreeing', async () => {
    const observationId = await observationAwaitingAttestation();

    const attested = await post(
      `/government/enumeration/observations/${observationId}/attest`,
      { agrees: true, attestedByName: 'Musa Danjuma, Guild Secretary' },
      admin(),
    );
    assert.equal(attested.status, 204, JSON.stringify(attested.body));

    const row = await queryOne<{ attestation_state: string; attested_by_name: string }>(
      pool,
      'SELECT attestation_state, attested_by_name FROM presumptive_observations WHERE id = $1',
      [observationId],
    );
    assert.equal(row!.attestation_state, 'AGREED');
    assert.equal(row!.attested_by_name, 'Musa Danjuma, Guild Secretary');
  });

  /*
   * A leader who disagrees must say what they claim instead. A bare "no" leaves
   * a supervisor with nothing to settle, which is the service's own reasoning
   * and is asserted here through the route that carries it.
   *
   * 400 rather than 422, and the distinction is the point: the route's schema
   * marks the three claim fields optional ON PURPOSE, so that the refusal comes
   * from the service and arrives as a sentence saying why, instead of as a
   * field-level "Required" that tells a guild secretary nothing.
   */
  it('refuses a disagreement with nothing behind it', async () => {
    const observationId = await observationAwaitingAttestation();

    const attested = await post(
      `/government/enumeration/observations/${observationId}/attest`,
      { agrees: false, attestedByName: 'Musa Danjuma, Guild Secretary' },
      admin(),
    );
    assert.equal(attested.status, 400, JSON.stringify(attested.body));
    assert.match(attested.body.error.message, /say what the leader claims instead/i);

    const row = await queryOne<{ attestation_state: string }>(
      pool,
      'SELECT attestation_state FROM presumptive_observations WHERE id = $1',
      [observationId],
    );
    assert.equal(row!.attestation_state, 'PENDING', 'the refusal left nothing half-written');
  });

  it('records what the leader claims instead', async () => {
    const observationId = await observationAwaitingAttestation();

    const attested = await post(
      `/government/enumeration/observations/${observationId}/attest`,
      {
        agrees: false,
        attestedByName: 'Musa Danjuma, Guild Secretary',
        premises: 'STALL',
        equipmentCount: 1,
        peopleWorking: 0,
      },
      admin(),
    );
    assert.equal(attested.status, 204, JSON.stringify(attested.body));

    const row = await queryOne<{
      attestation_state: string;
      attested_premises: string;
      attested_equipment_count: number;
    }>(
      pool,
      `SELECT attestation_state, attested_premises, attested_equipment_count
         FROM presumptive_observations WHERE id = $1`,
      [observationId],
    );
    assert.equal(row!.attestation_state, 'DISAGREED');
    assert.equal(row!.attested_premises, 'STALL');
    assert.equal(row!.attested_equipment_count, 1);
  });
});
