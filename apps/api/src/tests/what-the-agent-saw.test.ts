/**
 * Enumeration through associations, and the assessment that follows.
 *
 * Phase 5, and the part a citizen actually meets. Most of what is held here is
 * about restraint: what an agent may not enter, what a leader may not decide,
 * and what happens to somebody who says the estimate is wrong.
 *
 * THE PROPERTY THE REGIME TURNS ON. An agent records what they can see and the
 * server computes the band. There is no parameter on any of this through which
 * a turnover, a band or an amount can be supplied — an agent paid commission
 * on what they collect, holding a form with a band on it, is being invited to
 * negotiate somebody's tax at a stall.
 *
 * THE ONE THAT PROTECTS TRADERS FROM THEIR OWN LEADERS. The association's roll
 * is the sampling frame PSIRS cannot build for itself, and the leader's
 * attestation is a real check on the agent. But the leader attests to facts —
 * what premises, how many hands — and there is no column anywhere for them to
 * set a band or an amount. That is the difference between a witness and a tax
 * farmer, and the second is unlawful under the 2026 Regulations.
 *
 * THE ONE THAT MAKES AN ESTIMATE FAIR. An objection suspends enforcement, and
 * the officer who raised the assessment may not decide the objection to it.
 * Both are enforced in the database.
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
import { queryOne, query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import {
  assessFromObservation,
  attestObservation,
  decideObjection,
  disagreements,
  openObjections,
  raiseObjection,
  recordObservation,
} from '../services/enumeration';
import {
  adoptNanoPolicy,
  classifyLga,
  publishScheduleEntry,
  type Observations,
} from '../services/presumptive';
import { arrearsWorklist } from '../services/arrears';
import {
  createProgramme,
  evaluateEligibility,
  syncTaxpayerComplianceAndIncentives,
} from '../services/incentives';

let auth: { token: string; deviceId: string };
let officerId: string;
let secondOfficerId: string;
let lgaId: string;
let seq = 0;

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Assessing Officer',
    phone: '+2348000000001',
    role: 'admin',
  });
  secondOfficerId = await createGovernmentUser({
    fullName: 'Reviewing Officer',
    phone: '+2348000000002',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  lgaId = (await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1', []))!.id;
  seq = 0;

  // Phase 4's outputs, which Phase 5 refuses to work without.
  await adoptNanoPolicy(pool, {
    construction: 'CONJUNCTIVE',
    turnoverCeilingKobo: '1200000000',
    legalBasis: 'Opinion of the Attorney-General of Plateau State, 12 January 2026',
    effectiveFrom: '2026-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
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
  for (const [band, turnover] of [['MICRO', '90000000'], ['SMALL', '480000000']] as const) {
    await publishScheduleEntry(pool, {
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: band,
      lgaClass: 'A',
      assumedAnnualTurnoverKobo: turnover,
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
      effectiveFrom: '2026-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });
  }
});

async function trader(name: string) {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: name,
      lastName: `Trader${suffix}`,
      phone: `+23480444${suffix}`,
      address: '7 Terminus Market, Jos',
      lgaId,
      economicSector: 'ARTISAN_CRAFT',
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `enum-tp-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

async function guild(taxRole: 'ENUMERATION' | 'ATTESTATION' | 'NONE' = 'ATTESTATION') {
  seq += 1;
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayer_groups
       (code, name, group_type, lga_id, leader_name, leader_phone, registered_by, tax_role,
        economic_sector)
     VALUES ($1,'Terminus Tailors Guild','ARTISAN_GUILD',$2,'Guild Leader',$3,$4,$5,'ARTISAN_CRAFT')
     RETURNING id`,
    [`GRP-ENUM-${seq}`, lgaId, `+23481222${String(seq).padStart(5, '0')}`, officerId, taxRole],
  );
  return row!.id;
}

/** A tailor with a lock-up shop, two machines and one apprentice. */
const TAILOR: {
  premises: Observations['premises'];
  equipmentCount: number;
  peopleWorking: number;
  economicSector: string;
} = {
  premises: 'LOCK_UP_SHOP',
  equipmentCount: 2,
  peopleWorking: 1,
  economicSector: 'ARTISAN_CRAFT',
};

const observe = (taxpayerId: string, overrides: Partial<typeof TAILOR> & { groupId?: string } = {}) =>
  recordObservation(pool, {
    taxpayerId,
    ...TAILOR,
    ...overrides,
    actorId: officerId,
    actorRole: 'admin',
  });

describe('what the agent records', () => {
  it('takes facts and returns a band it worked out itself', async () => {
    const taxpayer = await trader('Amina');
    const observation = await observe(taxpayer);

    assert.equal(observation.sizeBand, 'SMALL', 'the server decides the band');
    assert.equal(observation.premises, 'LOCK_UP_SHOP');
  });

  it('takes the LGA from the taxpayer, not from whoever fills the form', async () => {
    /*
     * The LGA selects the schedule column. Accepting it from the request would
     * let the person filling the form choose which figure they are assessed
     * against — the same negotiation the band rule prevents, one step removed.
     *
     * Sent anyway and asserted ignored, because "there is no parameter" is
     * only worth something if a request that supplies one is not honoured.
     */
    const taxpayer = await trader('Fixed LGA');
    const elsewhere = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 LIMIT 1',
      [lgaId],
    );
    const officer = await loginAs('+2348000000001');

    const response = await post(
      '/government/enumeration/observations',
      { taxpayerId: taxpayer, ...TAILOR, lgaId: elsewhere!.id },
      { token: officer.accessToken },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));

    /*
     * Read from the row, not from the response. The response object builds
     * `lgaId` from the taxpayer it looked up, so it says the right thing even
     * if something else was written — which is exactly the assertion that
     * cannot fail, and the reason this reads the stored observation instead.
     */
    const stored = await queryOne<{ lga_id: string }>(
      pool,
      'SELECT lga_id FROM presumptive_observations WHERE id = $1',
      [response.body.id],
    );
    assert.equal(
      stored!.lga_id,
      lgaId,
      'the taxpayer’s own local government decides which schedule column applies',
    );
    assert.notEqual(stored!.lga_id, elsewhere!.id);
  });

  it('has nowhere to put a band or an amount', async () => {
    const taxpayer = await trader('Negotiating');
    const officer = await loginAs('+2348000000001');
    const response = await post(
      '/government/enumeration/observations',
      {
        taxpayerId: taxpayer,
        ...TAILOR,
        sizeBand: 'MICRO',
        assumedAnnualTurnoverKobo: '1',
        annualTaxKobo: '1',
      },
      { token: officer.accessToken },
    );

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(
      response.body.sizeBand,
      'SMALL',
      'the observations decide the band, whatever else was sent',
    );
  });

  it('refuses a negative count', async () => {
    const taxpayer = await trader('Negative');
    await assert.rejects(observe(taxpayer, { equipmentCount: -1 }), /negative/i);
  });

  it('refuses to name a group that has no part in this', async () => {
    /*
     * A group registered for an allocation programme is not an attesting body.
     * Treating one as though it were would give a leader standing over members
     * who never agreed to it.
     */
    const taxpayer = await trader('Wrong Group');
    const other = await guild('NONE');
    await assert.rejects(observe(taxpayer, { groupId: other }), /part in enumeration/i);
  });
});

describe('what the leader may say', () => {
  it('confirms an observation, and that is recorded against it', async () => {
    const taxpayer = await trader('Attested');
    const group = await guild();
    const observation = await observe(taxpayer, { groupId: group });
    assert.equal(observation.attestationState, 'PENDING');

    await attestObservation(pool, {
      observationId: observation.id,
      agrees: true,
      attestedByName: 'Guild Leader',
      actorId: officerId,
      actorRole: 'admin',
    });

    const row = await queryOne<{ attestation_state: string; attested_by_name: string }>(
      pool,
      'SELECT attestation_state, attested_by_name FROM presumptive_observations WHERE id = $1',
      [observation.id],
    );
    assert.equal(row!.attestation_state, 'AGREED');
    assert.equal(row!.attested_by_name, 'Guild Leader');
  });

  it('must say what they claim instead when they disagree', async () => {
    const taxpayer = await trader('Vague');
    const group = await guild();
    const observation = await observe(taxpayer, { groupId: group });

    await assert.rejects(
      attestObservation(pool, {
        observationId: observation.id,
        agrees: false,
        attestedByName: 'Guild Leader',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /what the leader claims instead/i,
      'a disagreement with nothing behind it leaves nothing to settle',
    );
  });

  it('has no way to set a band or an amount', async () => {
    /*
     * Asserted against the schema itself rather than the service, because the
     * point is that the capability does not exist. A rule in a service can be
     * relaxed by an edit; a column that was never added cannot.
     */
    const columns = await query<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'presumptive_observations'`,
      [],
    );
    const names = columns.map((row) => row.column_name);
    for (const forbidden of [
      'attested_band',
      'attested_size_band',
      'attested_turnover_kobo',
      'attested_tax_kobo',
      'leader_band',
    ]) {
      assert.equal(
        names.includes(forbidden),
        false,
        `a leader who could set ${forbidden} would be a collector, not a witness`,
      );
    }
    assert.ok(names.includes('attested_premises'), 'they attest to facts');
  });

  it('cannot attest twice', async () => {
    const taxpayer = await trader('Twice');
    const group = await guild();
    const observation = await observe(taxpayer, { groupId: group });
    await attestObservation(pool, {
      observationId: observation.id,
      agrees: true,
      attestedByName: 'Guild Leader',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      attestObservation(pool, {
        observationId: observation.id,
        agrees: false,
        attestedByName: 'Guild Leader',
        premises: 'STALL',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /not awaiting attestation/i,
    );
  });
});

describe('the disagreement queue', () => {
  it('shows both versions and the band each would produce', async () => {
    const taxpayer = await trader('Contested');
    const group = await guild();
    const observation = await observe(taxpayer, { groupId: group });

    await attestObservation(pool, {
      observationId: observation.id,
      agrees: false,
      attestedByName: 'Guild Leader',
      premises: 'STALL',
      actorId: officerId,
      actorRole: 'admin',
    });

    const queue = await disagreements(pool);
    const item = queue.find((row) => row.observationId === observation.id);
    assert.ok(item, 'two versions of a checkable fact is what attestation is for');
    assert.equal(item!.agentBand, 'SMALL');
    assert.equal(item!.leaderBand, 'SMALL', 'one apprentice still lifts a stall to SMALL');
    assert.equal(item!.agentSaw.premises, 'LOCK_UP_SHOP');
    assert.equal(item!.leaderSays.premises, 'STALL');
  });

  it('does not invent a wider disagreement than the one that was made', async () => {
    /*
     * A leader who disputed the premises said nothing about the staff. Reading
     * the silent fields as zero would put the member a band lower than either
     * account supports, which is a disagreement neither person made.
     */
    const taxpayer = await trader('Partial');
    const group = await guild();
    const observation = await observe(taxpayer, { groupId: group, peopleWorking: 6 });
    await attestObservation(pool, {
      observationId: observation.id,
      agrees: false,
      attestedByName: 'Guild Leader',
      premises: 'STALL',
      actorId: officerId,
      actorRole: 'admin',
    });

    const item = (await disagreements(pool)).find((row) => row.observationId === observation.id);
    assert.equal(
      item!.leaderBand,
      'MEDIUM',
      'six people still means MEDIUM — the leader only disputed the premises',
    );
  });

  it('leaves an agreed observation off the queue entirely', async () => {
    const taxpayer = await trader('Settled');
    const group = await guild();
    const observation = await observe(taxpayer, { groupId: group });
    await attestObservation(pool, {
      observationId: observation.id,
      agrees: true,
      attestedByName: 'Guild Leader',
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(disagreementsHas(await disagreements(pool), observation.id), false);
  });

  it('clears once somebody has been back to look again', async () => {
    /*
     * The queue's only exit, and it has to exist: a disputed observation
     * cannot be assessed, so it would otherwise sit there for ever and a
     * supervisor who did the right thing would see the same item every day.
     * Observations are immutable, so going back means a new row — and the
     * later one is what the State now believes.
     */
    const taxpayer = await trader('Revisited');
    const group = await guild();
    const first = await observe(taxpayer, { groupId: group });
    await attestObservation(pool, {
      observationId: first.id,
      agrees: false,
      attestedByName: 'Guild Leader',
      premises: 'STALL',
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.ok(disagreementsHas(await disagreements(pool), first.id), 'on the queue first');

    const second = await observe(taxpayer, { premises: 'STALL' });
    assert.equal(
      disagreementsHas(await disagreements(pool), first.id),
      false,
      'a supervisor who went back and settled it should not see it again',
    );
    assert.ok(second.id, 'and the earlier disagreement is still on the record');

    const kept = await queryOne<{ attestation_state: string }>(
      pool,
      'SELECT attestation_state FROM presumptive_observations WHERE id = $1',
      [first.id],
    );
    assert.equal(kept!.attestation_state, 'DISAGREED');
  });
});

function disagreementsHas(queue: Awaited<ReturnType<typeof disagreements>>, id: string) {
  return queue.some((row) => row.observationId === id);
}

describe('assessing what was found', () => {
  it('computes the bill from the schedule and raises an ordinary invoice', async () => {
    const taxpayer = await trader('Assessed');
    const observation = await observe(taxpayer);

    const result = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });

    assert.equal(result.taxTier, 'PRESUMPTIVE');
    assert.equal(result.assumedAnnualTurnoverKobo, '480000000');
    assert.equal(result.annualTaxKobo, '4800000', 'one per cent of ₦4.8m is ₦48,000');
    assert.ok(result.invoiceNumber, 'and it is collected through the ordinary invoice');

    const invoice = await queryOne<{ amount_kobo: string }>(
      pool,
      'SELECT amount_kobo FROM invoices WHERE invoice_number = $1',
      [result.invoiceNumber],
    );
    assert.equal(invoice!.amount_kobo, result.annualTaxKobo);
  });

  it('records a nano operator as exempt, with no invoice at all', async () => {
    /*
     * Recorded rather than skipped. How many people the exemption covers is
     * the number this whole regime should be judged on, and a coverage metric
     * that only counted assessments would bury it.
     */
    const taxpayer = await trader('Hawker');
    const observation = await observe(taxpayer, {
      premises: 'NONE',
      equipmentCount: 0,
      peopleWorking: 0,
    });

    const result = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });

    assert.equal(result.taxTier, 'NANO');
    assert.equal(result.annualTaxKobo, '0');
    assert.equal(result.invoiceNumber, null, 'an invoice for zero is not a record of exemption');

    const tier = await queryOne<{ tax_tier: string }>(
      pool,
      'SELECT tax_tier FROM taxpayers WHERE id = $1',
      [taxpayer],
    );
    assert.equal(tier!.tax_tier, 'NANO');
  });

  it('refuses to assess an observation the association disputed', async () => {
    const taxpayer = await trader('Disputed');
    const group = await guild();
    const observation = await observe(taxpayer, { groupId: group });
    await attestObservation(pool, {
      observationId: observation.id,
      agrees: false,
      attestedByName: 'Guild Leader',
      premises: 'STALL',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      assessFromObservation(pool, {
        observationId: observation.id,
        actorId: officerId,
        actorRole: 'admin',
      }),
      /not settled facts/i,
      'issuing it anyway spends PSIRS credibility to save a supervisor a visit',
    );
  });

  it('refuses to assess the same observation twice', async () => {
    const taxpayer = await trader('Doubled');
    const observation = await observe(taxpayer);
    await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      assessFromObservation(pool, {
        observationId: observation.id,
        actorId: officerId,
        actorRole: 'admin',
      }),
      /already produced an assessment/i,
    );
  });

  it('records which schedule version and which construction it used', async () => {
    const taxpayer = await trader('Traceable');
    const observation = await observe(taxpayer);
    const result = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });

    const row = await queryOne<{
      schedule_id: string;
      nano_policy_id: string;
      observation_id: string;
    }>(
      pool,
      'SELECT schedule_id, nano_policy_id, observation_id FROM presumptive_assessments WHERE id = $1',
      [result.id],
    );
    assert.ok(row!.schedule_id, 'an assessment must be re-checkable against what it used');
    assert.ok(row!.nano_policy_id);
    assert.equal(row!.observation_id, observation.id);
  });
});

describe('objecting to it', () => {
  async function assessed(name: string) {
    const taxpayer = await trader(name);
    const observation = await observe(taxpayer);
    const assessment = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    return { taxpayer, assessment };
  }

  it('suspends enforcement while the objection is open', async () => {
    /*
     * The property that makes the objection window mean something. A citizen
     * who formally disputed an estimate and then took a call demanding payment
     * has learnt that the process is decorative.
     */
    const { taxpayer, assessment } = await assessed('Objecting');

    await pool.query(
      `UPDATE invoices SET expires_at = now() + interval '20 days'
        WHERE assessment_id = (SELECT assessment_id FROM presumptive_assessments WHERE id = $1)`,
      [assessment.id],
    );
    assert.ok(
      (await arrearsWorklist(pool)).rows.some((row) => row.taxpayerId === taxpayer),
      'on the worklist before objecting',
    );

    await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'The stall is half the size recorded and there is no apprentice.',
      actorId: officerId,
      actorRole: 'admin',
    });

    assert.equal(
      (await arrearsWorklist(pool)).rows.some((row) => row.taxpayerId === taxpayer),
      false,
      'a disputed estimate is not chased while it is disputed',
    );
  });

  it('marks the assessment objected, and settled again once decided', async () => {
    /*
     * Separate from the arrears exclusion, which keys off the objection rather
     * than the assessment. This is the record a screen shows the officer, and
     * it was going untested — an assessment stuck at OBJECTED after the
     * objection was rejected would read as unresolved for ever.
     */
    const { assessment } = await assessed('Status Tracked');
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'The machines are borrowed.',
      actorId: officerId,
      actorRole: 'admin',
    });

    const objected = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM presumptive_assessments WHERE id = $1',
      [assessment.id],
    );
    assert.equal(objected!.status, 'OBJECTED');

    await decideObjection(pool, {
      objectionId: objection.id,
      uphold: false,
      reason: 'Re-checked on site; the machines are the trader’s own.',
      actorId: secondOfficerId,
      actorRole: 'admin',
    });

    const settled = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM presumptive_assessments WHERE id = $1',
      [assessment.id],
    );
    assert.equal(settled!.status, 'ASSESSED', 'and it does not read as unresolved for ever');
  });

  it('lets the taxpayer leave the regime by producing records', async () => {
    const { assessment } = await assessed('Has Books');
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'HAS_RECORDS',
      statement: 'Audited accounts for 2025 are available and were filed with FIRS.',
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.ok(objection.id, 'moving up must be a right, not a favour');
  });

  it('refuses a second objection while the first is still open', async () => {
    /*
     * The unique index refuses it either way. What this holds is that the
     * officer is told somebody already raised it, rather than handed a
     * constraint violation and left to guess whether the estimate is disputed.
     */
    const { assessment } = await assessed('Twice Over');
    await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'The shop was shut for half the year.',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      raiseObjection(pool, {
        presumptiveAssessmentId: assessment.id,
        ground: 'OTHER',
        statement: 'Raised again at the counter by a different clerk.',
        actorId: secondOfficerId,
        actorRole: 'admin',
      }),
      /already open/i,
    );
  });

  it('refuses an objection to an exemption, which charges nothing', async () => {
    /*
     * An exempt operator has no bill. Upholding an objection withdraws the
     * assessment — so an objection allowed here would delete the record of the
     * exemption and put the observation back in the queue to be assessed
     * again. Complaining would cost the taxpayer their exemption.
     */
    const taxpayer = await trader('Nothing Owed');
    const observation = await observe(taxpayer, {
      premises: 'NONE',
      equipmentCount: 0,
      peopleWorking: 0,
    });
    const exempt = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(exempt.taxTier, 'NANO');

    await assert.rejects(
      raiseObjection(pool, {
        presumptiveAssessmentId: exempt.id,
        ground: 'NOT_TRADING',
        statement: 'He says he stopped hawking in June.',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /no estimate to object to/i,
    );
  });

  it('will not let the assessing officer decide the objection', async () => {
    const { assessment } = await assessed('Same Officer');
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'The machines counted belong to the landlord.',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      decideObjection(pool, {
        objectionId: objection.id,
        uphold: false,
        reason: 'I stand by my own assessment',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /cannot decide the objection/i,
      'an objection decided by the person objected to is a form, not a right of appeal',
    );
  });

  it('cancels the bill when the objection is upheld', async () => {
    const { taxpayer, assessment } = await assessed('Upheld');
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'NOT_TRADING',
      statement: 'The shop closed in November and the trader has left the State.',
      actorId: officerId,
      actorRole: 'admin',
    });

    await decideObjection(pool, {
      objectionId: objection.id,
      uphold: true,
      reason: 'Confirmed with the market association that the shop is closed.',
      actorId: secondOfficerId,
      actorRole: 'admin',
    });

    const invoice = await queryOne<{ status: string }>(
      pool,
      `SELECT i.status FROM invoices i
         JOIN presumptive_assessments pa ON pa.assessment_id = i.assessment_id
        WHERE pa.id = $1`,
      [assessment.id],
    );
    assert.equal(
      invoice!.status,
      'CANCELLED',
      'a decision in the taxpayer’s favour that left the bill standing cost them nothing',
    );
    assert.equal(
      (await arrearsWorklist(pool)).rows.some((row) => row.taxpayerId === taxpayer),
      false,
    );
  });

  it('puts the debt back when the objection is rejected', async () => {
    const { taxpayer, assessment } = await assessed('Rejected');
    await pool.query(
      `UPDATE invoices SET expires_at = now() + interval '20 days'
        WHERE assessment_id = (SELECT assessment_id FROM presumptive_assessments WHERE id = $1)`,
      [assessment.id],
    );
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'OTHER',
      statement: 'The trader says the tax is too high.',
      actorId: officerId,
      actorRole: 'admin',
    });

    await decideObjection(pool, {
      objectionId: objection.id,
      uphold: false,
      reason: 'The observations were re-checked on site and are correct.',
      actorId: secondOfficerId,
      actorRole: 'admin',
    });

    assert.ok(
      (await arrearsWorklist(pool)).rows.some((row) => row.taxpayerId === taxpayer),
      'enforcement resumes once the objection is decided',
    );
  });

  it('refuses a decision with no reason the taxpayer can read', async () => {
    const { assessment } = await assessed('Unexplained');
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'The premises are shared with two other traders.',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      decideObjection(pool, {
        objectionId: objection.id,
        uphold: false,
        reason: '   ',
        actorId: secondOfficerId,
        actorRole: 'admin',
      }),
      /reason the taxpayer can read/i,
    );
  });

  it('names the assessing officer on the queue, so a reviewer knows to pass it on', async () => {
    const { assessment } = await assessed('Queued');
    await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'The count is wrong.',
      actorId: officerId,
      actorRole: 'admin',
    });

    const queue = await openObjections(pool);
    assert.equal(queue.length, 1);
    assert.equal(queue[0]!.assessedBy, officerId);
  });
});

describe('what the database refuses, with the service bypassed', () => {
  async function scheduleRow(band: 'MICRO' | 'SMALL') {
    return (await queryOne<{ id: string; assumed_annual_turnover_kobo: string }>(
      pool,
      `SELECT id, assumed_annual_turnover_kobo FROM presumptive_schedules WHERE size_band = $1`,
      [band],
    ))!;
  }

  async function bareObservation(taxpayerId: string) {
    return (await queryOne<{ id: string }>(
      pool,
      `INSERT INTO presumptive_observations
         (taxpayer_id, premises, equipment_count, people_working, economic_sector, lga_id, observed_by)
       VALUES ($1,'LOCK_UP_SHOP',2,1,'ARTISAN_CRAFT',$2,$3) RETURNING id`,
      [taxpayerId, lgaId, officerId],
    ))!.id;
  }

  const policyId = async () =>
    (await queryOne<{ id: string }>(pool, 'SELECT id FROM nano_exemption_policies LIMIT 1', []))!.id;

  it('refuses an assessment whose figure disagrees with the schedule it cites', async () => {
    const taxpayer = await trader('Mismatched');
    const observation = await bareObservation(taxpayer);
    const schedule = await scheduleRow('SMALL');

    await assert.rejects(
      pool.query(
        `INSERT INTO presumptive_assessments
           (taxpayer_id, observation_id, schedule_id, nano_policy_id, tax_tier, size_band,
            lga_class, assumed_annual_turnover_kobo, annual_tax_kobo, objection_window_ends_at,
            created_by)
         VALUES ($1,$2,$3,$4,'PRESUMPTIVE','SMALL','A',999,9,now(),$5)`,
        [taxpayer, observation, schedule.id, await policyId(), officerId],
      ),
      /cites a schedule row saying/i,
      'a foreign key to evidence and a number from somewhere else is the shape of a stall bargain',
    );
  });

  it('refuses an assessment that cites a schedule row for a different band', async () => {
    const taxpayer = await trader('Wrong Band');
    const observation = await bareObservation(taxpayer);
    const micro = await scheduleRow('MICRO');

    await assert.rejects(
      pool.query(
        `INSERT INTO presumptive_assessments
           (taxpayer_id, observation_id, schedule_id, nano_policy_id, tax_tier, size_band,
            lga_class, assumed_annual_turnover_kobo, annual_tax_kobo, objection_window_ends_at,
            created_by)
         VALUES ($1,$2,$3,$4,'PRESUMPTIVE','SMALL','A',$5,$6,now(),$7)`,
        [
          taxpayer,
          observation,
          micro.id,
          await policyId(),
          micro.assumed_annual_turnover_kobo,
          (BigInt(micro.assumed_annual_turnover_kobo) / 100n).toString(),
          officerId,
        ],
      ),
      /cites a schedule row for band/i,
    );
  });

  it('refuses a charge that is not one per cent of the assumed turnover', async () => {
    const taxpayer = await trader('Wrong Rate');
    const observation = await bareObservation(taxpayer);
    const schedule = await scheduleRow('SMALL');

    await assert.rejects(
      pool.query(
        `INSERT INTO presumptive_assessments
           (taxpayer_id, observation_id, schedule_id, nano_policy_id, tax_tier, size_band,
            lga_class, assumed_annual_turnover_kobo, annual_tax_kobo, objection_window_ends_at,
            created_by)
         VALUES ($1,$2,$3,$4,'PRESUMPTIVE','SMALL','A',$5,$6,now(),$7)`,
        [
          taxpayer,
          observation,
          schedule.id,
          await policyId(),
          schedule.assumed_annual_turnover_kobo,
          '999999',
          officerId,
        ],
      ),
      /not one per cent of/i,
    );
  });

  it('refuses to charge a nano business anything at all', async () => {
    /*
     * The plan's second invariant, and the reason it is a trigger. An officer
     * measured on how many people they bring into the net has a standing
     * reason to assess somebody the law exempts — which is how these schemes
     * turn regressive without anybody deciding that they should.
     */
    const taxpayer = await trader('Exempt');
    const observation = await bareObservation(taxpayer);
    const schedule = await scheduleRow('MICRO');

    await assert.rejects(
      pool.query(
        `INSERT INTO presumptive_assessments
           (taxpayer_id, observation_id, schedule_id, nano_policy_id, tax_tier, size_band,
            lga_class, assumed_annual_turnover_kobo, annual_tax_kobo, objection_window_ends_at,
            created_by)
         VALUES ($1,$2,$3,$4,'NANO','MICRO','A',$5,$6,now(),$7)`,
        [
          taxpayer,
          observation,
          schedule.id,
          await policyId(),
          schedule.assumed_annual_turnover_kobo,
          (BigInt(schedule.assumed_annual_turnover_kobo) / 100n).toString(),
          officerId,
        ],
      ),
      /nano business is exempt/i,
    );
  });

  it('refuses an assessment with no observation behind it', async () => {
    const schedule = await scheduleRow('SMALL');
    await assert.rejects(
      pool.query(
        `INSERT INTO presumptive_assessments
           (taxpayer_id, schedule_id, nano_policy_id, tax_tier, size_band, lga_class,
            assumed_annual_turnover_kobo, annual_tax_kobo, objection_window_ends_at, created_by)
         VALUES ($1,$2,$3,'PRESUMPTIVE','SMALL','A',$4,$5,now(),$6)`,
        [
          await trader('No Evidence'),
          schedule.id,
          await policyId(),
          schedule.assumed_annual_turnover_kobo,
          (BigInt(schedule.assumed_annual_turnover_kobo) / 100n).toString(),
          officerId,
        ],
      ),
      /observation_id/,
      'no observation, no assessment — not a rule to remember but a column that cannot be null',
    );
  });

  it('refuses to edit what was observed', async () => {
    const taxpayer = await trader('Rewritten');
    const observation = await bareObservation(taxpayer);
    await assert.rejects(
      pool.query(`UPDATE presumptive_observations SET equipment_count = 99 WHERE id = $1`, [
        observation,
      ]),
      /immutable|cannot be changed|equipment_count/i,
    );
  });

  it('refuses an attestation that does not say who made it', async () => {
    const taxpayer = await trader('Anonymous Attestation');
    const observation = await bareObservation(taxpayer);
    await assert.rejects(
      pool.query(
        `UPDATE presumptive_observations SET attestation_state = 'AGREED' WHERE id = $1`,
        [observation],
      ),
      /who made it and when/i,
    );
  });

  it('refuses an objection decided by nobody', async () => {
    const taxpayer = await trader('Anonymous Decision');
    const observation = await observe(taxpayer);
    const assessment = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'Wrong count.',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      pool.query(`UPDATE assessment_objections SET status = 'REJECTED' WHERE id = $1`, [
        objection.id,
      ]),
      /must record who made it/i,
    );
  });

  it('refuses to re-decide an objection', async () => {
    const taxpayer = await trader('Re-decided');
    const observation = await observe(taxpayer);
    const assessment = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'Wrong count.',
      actorId: officerId,
      actorRole: 'admin',
    });
    await decideObjection(pool, {
      objectionId: objection.id,
      uphold: false,
      reason: 'Re-checked on site.',
      actorId: secondOfficerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      pool.query(
        `UPDATE assessment_objections
            SET status = 'UPHELD', decided_by = $2, decision_reason = 'changed my mind'
          WHERE id = $1`,
        [objection.id, secondOfficerId],
      ),
      /already been decided/i,
    );
  });

  it('refuses a group tax role the schema does not know', async () => {
    const group = await guild();
    await assert.rejects(
      pool.query(`UPDATE taxpayer_groups SET tax_role = 'COLLECTION' WHERE id = $1`, [group]),
      /tax_role/,
      'there is no collecting role, and there must not be one',
    );
  });

  it('has no column through which money could be owed by a group', async () => {
    /*
     * State money never enters an association's account. Asserted against the
     * schema because that is where the guarantee lives: there is no payable
     * against a group to create.
     */
    const columns = await query<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'taxpayer_groups'`,
      [],
    );
    const names = columns.map((row) => row.column_name);
    for (const forbidden of ['balance_kobo', 'collected_kobo', 'account_number', 'payable_kobo']) {
      assert.equal(names.includes(forbidden), false, `a group with ${forbidden} is a tax farmer`);
    }
  });
});

describe('the statutory rate is in one place', () => {
  it('charges the one per cent the catalogue carries', async () => {
    /*
     * The rate lives on the revenue item, the service applies it to the
     * schedule's assumed turnover, and migration 058 checks the stored charge
     * against the same one per cent. Three places would drift; this asserts
     * they currently agree, so a change to any of them fails here rather than
     * on somebody's bill.
     */
    const rate = await queryOne<{ rate_basis_points: number; rate_type: string }>(
      pool,
      `SELECT r.rate_basis_points, r.rate_type
         FROM revenue_item_rates r
         JOIN revenue_items ri ON ri.id = r.revenue_item_id
        WHERE ri.code = 'PIT-PRESUMPTIVE-SMALL'
        ORDER BY r.effective_from DESC LIMIT 1`,
      [],
    );
    assert.ok(rate, 'the presumptive items must carry a rate or nothing can be invoiced');
    assert.equal(rate!.rate_type, 'PERCENTAGE');
    assert.equal(rate!.rate_basis_points, 100, 'one per cent, per section 29 of the Act');

    const taxpayer = await trader('Rate Check');
    const observation = await observe(taxpayer);
    const result = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(
      BigInt(result.annualTaxKobo),
      BigInt(result.assumedAnnualTurnoverKobo) / 100n,
      'and the charge is that rate applied to the schedule figure',
    );
  });

  /*
   * The figure on the notice and the figure on the bill are two different
   * computations, and until this they were only ever compared by eye.
   *
   * `annual_tax_kobo` is what the trace explains at the stall, what an
   * objection is decided against, and what the arrears worklist reads. The
   * money owed is whatever the rate engine made of the revenue catalogue when
   * the invoice was raised. Nothing tied them together, and they came apart
   * in two different ways.
   */
  it('records the same figure it bills, on a schedule that is not a whole naira', async () => {
    /*
     * `assumed_annual_turnover_kobo` is a BIGINT of kobo with no whole-naira
     * constraint, so a published schedule may carry ...050. At that figure the
     * service's own `(assumed * 100n) / 10_000n` truncated to 4,800,000 while
     * `applyBasisPoints` — which the rate engine bills through — rounded to
     * 4,800,001. The trader was shown one and billed the other.
     *
     * MEDIUM because the fixture publishes MICRO and SMALL, and a BUILDING
     * floors the band there.
     */
    await publishScheduleEntry(pool, {
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: 'MEDIUM',
      lgaClass: 'A',
      assumedAnnualTurnoverKobo: '480000050',
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
      effectiveFrom: '2026-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });

    const taxpayer = await trader('Half Kobo');
    const observation = await observe(taxpayer, { premises: 'BUILDING' });
    const result = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(result.sizeBand, 'MEDIUM', 'the fixture must reach the unrounded schedule row');

    const billed = await queryOne<{ amount_kobo: string }>(
      pool,
      `SELECT amount_kobo FROM assessments
        WHERE id = (SELECT assessment_id FROM presumptive_assessments WHERE id = $1)`,
      [result.id],
    );

    assert.equal(
      billed!.amount_kobo,
      result.annualTaxKobo,
      'the invoice must bill exactly what the assessment says is owed',
    );

    // And the sentence the trader is read at the stall must carry that figure
    // too, or the explanation is of a number nobody is charging.
    const step = result.trace.find((entry) => entry.step.includes('1%'));
    assert.equal(step?.amountKobo, billed!.amount_kobo, 'the trace must explain the sum billed');
  });

  it('refuses to assess at all when the catalogue is charging a different rate', async () => {
    /*
     * A rate version is publishable through the ordinary catalogue route, and
     * carries a statutory minimum and maximum besides. None of that reaches
     * `computePresumptive`, which explains one per cent from a constant. With
     * a 2% version in force the notice said 4,800,000 kobo and the trader was
     * billed 9,600,001 — double, with the notice in their hand saying
     * otherwise.
     *
     * No rounding rule reconciles that, and neither figure may be quietly
     * preferred: recording the engine's leaves the trace explaining a rate
     * nobody applied, and recording the regime's leaves the State collecting a
     * sum its own notice contradicts. So nothing is issued.
     */
    const item = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'PIT-PRESUMPTIVE-SMALL'`,
      [],
    );
    const current = await queryOne<{ id: string; version: number }>(
      pool,
      `SELECT id, version FROM revenue_item_rates
        WHERE revenue_item_id = $1 AND effective_to IS NULL AND lga_id IS NULL
        ORDER BY version DESC LIMIT 1`,
      [item!.id],
    );
    await query(pool, 'UPDATE revenue_item_rates SET effective_to = now() WHERE id = $1', [
      current!.id,
    ]);
    await query(
      pool,
      `INSERT INTO revenue_item_rates
         (revenue_item_id, lga_id, version, rate_type, rate_basis_points, effective_from, created_by)
       VALUES ($1, NULL, $2, 'PERCENTAGE', 200, now(), $3)`,
      [item!.id, current!.version + 1, officerId],
    );

    const taxpayer = await trader('Rate Adrift');
    const observation = await observe(taxpayer);
    await assert.rejects(
      assessFromObservation(pool, {
        observationId: observation.id,
        actorId: officerId,
        actorRole: 'admin',
      }),
      (error: { code?: string }) => error.code === 'PRESUMPTIVE_CHARGE_DISAGREES',
      'a notice that explains one figure and bills another must not be issued',
    );

    // And the refusal must take the invoice down with it. A rolled-back
    // assessment that left a live bill behind would be the same defect with
    // the paperwork missing.
    const orphan = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM assessments a
         JOIN taxpayers t ON t.id = a.taxpayer_id
        WHERE t.id = $1`,
      [taxpayer],
    );
    assert.equal(orphan!.count, '0', 'the refusal must leave no assessment behind');
  });
});

describe('who may do what', () => {
  it('lets an agent record an observation', async () => {
    const taxpayer = await trader('Field Recorded');
    const response = await post(
      '/government/enumeration/observations',
      { taxpayerId: taxpayer, ...TAILOR },
      { ...auth, idempotencyKey: 'enum-obs-1' },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  it('does not let an agent turn one into a bill', async () => {
    const taxpayer = await trader('Field Assessed');
    const observation = await observe(taxpayer);
    const response = await post(
      `/government/enumeration/observations/${observation.id}/assess`,
      {},
      auth,
    );
    assert.equal(
      response.status,
      403,
      'raising a charge off a document is not the same act as recording what is in front of you',
    );
  });

  it('does not let an agent decide an objection', async () => {
    const taxpayer = await trader('Field Decided');
    const observation = await observe(taxpayer);
    const assessment = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'Wrong count.',
      actorId: officerId,
      actorRole: 'admin',
    });

    const response = await post(
      `/government/enumeration/objections/${objection.id}/decide`,
      { uphold: true, reason: 'Because the trader asked me to' },
      auth,
    );
    assert.equal(response.status, 403, `got ${response.status}`);
  });

  it('lets an officer read the disagreement queue', async () => {
    const officer = await loginAs('+2348000000001');
    const response = await get('/government/enumeration/disagreements', {
      token: officer.accessToken,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });
});

/**
 * A count taken where there is no signal.
 *
 * The Councils whose traders are least likely to be on the register are the
 * ones the network is worst in. An enumeration that needed a connection would
 * be collected where coverage already exists, which is exactly where the
 * missing taxpayers are not — so the capture goes in the offline queue and is
 * replayed when the handset comes back.
 *
 * What must survive that trip is the division of labour: the phone carries
 * facts, and the platform concludes a band from them. A queue that carried a
 * band would be a queue an altered handset could put a smaller number in.
 */
describe('an enumeration that waited for a signal', () => {
  async function agentSession() {
    const demo = await seedDemoAgent();
    const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
    return { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  }

  it('replays a queued count, and works out the band on arrival', async () => {
    const taxpayer = await trader('No Signal');
    const agent = await agentSession();

    const response = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'offline-observation-000001',
            draftType: 'BUSINESS_OBSERVATION',
            capturedAt: new Date(Date.now() - 7_200_000).toISOString(),
            payload: {
              taxpayerId: taxpayer,
              premises: 'LOCK_UP_SHOP',
              equipmentCount: 3,
              peopleWorking: 2,
              economicSector: 'ARTISAN_CRAFT',
            },
          },
        ],
      },
      agent,
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const [result] = response.body.results;
    assert.equal(result.status, 'SYNCED', JSON.stringify(result));
    assert.equal(result.entityType, 'presumptive_observation');

    /*
     * The band is not a column. `presumptive_observations` holds facts and
     * nothing else, and the band is concluded from them — which is why the
     * queue can carry a capture at all. So it is checked where the platform
     * actually states it: in the reply the agent's phone reads back.
     */
    assert.match(
      result.message,
      /small business/i,
      'the platform’s conclusion, reached when the capture arrived',
    );

    const stored = await queryOne<{
      premises: string;
      equipment_count: number;
      people_working: number;
    }>(
      pool,
      `SELECT premises, equipment_count, people_working
         FROM presumptive_observations WHERE id = $1`,
      [result.entityId],
    );
    assert.deepEqual(
      { ...stored },
      { premises: 'LOCK_UP_SHOP', equipment_count: 3, people_working: 2 },
      'and the facts are the ones the phone carried, unaltered',
    );
  });

  it('records the platform’s band, not the one the handset sent', async () => {
    /*
     * The property the whole arrangement rests on, now that the phone works
     * out a band of its own.
     *
     * The handset's answer travels with the capture and is kept, because a
     * trader was told it. It decides nothing: the platform runs the rule
     * again on the facts, and a building with nine machines and six people is
     * MEDIUM whatever the phone said. This sends MICRO — which no honest
     * build of the app could have produced from these facts — so what is
     * being proved is that the claim changes nothing, not merely that an
     * agreeing claim is tolerated.
     */
    const taxpayer = await trader('Says Its Own Band');
    const agent = await agentSession();

    const response = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'offline-observation-000002',
            draftType: 'BUSINESS_OBSERVATION',
            capturedAt: new Date().toISOString(),
            payload: {
              taxpayerId: taxpayer,
              premises: 'BUILDING',
              equipmentCount: 9,
              peopleWorking: 6,
              economicSector: 'ARTISAN_CRAFT',
              bandAtCapture: 'MICRO',
            },
          },
        ],
      },
      agent,
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const [result] = response.body.results;
    assert.equal(result.status, 'SYNCED', JSON.stringify(result));
    assert.match(
      result.message,
      /medium business/i,
      'the phone said micro; the platform read the facts and said otherwise',
    );

    /*
     * And the handset's answer is kept where it can be read, rather than
     * dropped. The taxpayer standing at that stall was told micro; when the
     * notice says medium, somebody has to be able to say why.
     */
    const row = await queryOne<{ band_at_capture: string }>(
      pool,
      'SELECT band_at_capture FROM presumptive_observations WHERE id = $1',
      [result.entityId],
    );
    assert.equal(row!.band_at_capture, 'MICRO');

    const flagged = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM audit_logs
        WHERE entity_id = $1 AND action = 'observation.band_disagreed_with_handset'`,
      [result.entityId],
    );
    assert.equal(flagged!.count, '1', 'and the disagreement is on the record, not merely stored');
  });

  it('says nothing about a disagreement when the two agree', async () => {
    /*
     * The mirror, and the case that will be true almost always: one shared
     * function, run twice. A flag raised on every capture would be a flag
     * nobody reads by the second week.
     */
    const taxpayer = await trader('Handset Agrees');
    const agent = await agentSession();

    const response = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'offline-observation-000005',
            draftType: 'BUSINESS_OBSERVATION',
            capturedAt: new Date().toISOString(),
            payload: {
              taxpayerId: taxpayer,
              premises: 'BUILDING',
              equipmentCount: 9,
              peopleWorking: 6,
              economicSector: 'ARTISAN_CRAFT',
              // The top band, and the same facts the disagreeing case above
              // sends — so the two differ only in what the handset claimed.
              bandAtCapture: 'MEDIUM',
            },
          },
        ],
      },
      agent,
    );
    const [result] = response.body.results;
    assert.equal(result.status, 'SYNCED', JSON.stringify(result));

    const flagged = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM audit_logs
        WHERE entity_id = $1 AND action = 'observation.band_disagreed_with_handset'`,
      [result.entityId],
    );
    assert.equal(flagged!.count, '0');
  });

  it('will not let what the agent was told be edited afterwards', async () => {
    /*
     * What somebody was told on a particular afternoon is a fact about that
     * afternoon. Editing it turns the record of a mis-told band into a record
     * of somebody having tidied up.
     *
     * The column is settable only as the row is written, which is stricter
     * than "cannot be changed" and is the right strictness: an observation
     * that reached the platform without a handset band was not taken on a
     * handset, and cannot be given one later either.
     */
    const told = await recordObservation(pool, {
      taxpayerId: await trader('Told Once'),
      ...TAILOR,
      bandAtCapture: 'SMALL',
      actorId: officerId,
      actorRole: 'admin',
    });
    await assert.rejects(
      pool.query('UPDATE presumptive_observations SET band_at_capture = $2 WHERE id = $1', [
        told.id,
        'MICRO',
      ]),
      /band_at_capture/i,
      'a band the agent showed cannot be revised into one they did not',
    );

    const officerRecorded = await observe(await trader('No Handset'), {});
    await assert.rejects(
      pool.query('UPDATE presumptive_observations SET band_at_capture = $2 WHERE id = $1', [
        officerRecorded.id,
        'MICRO',
      ]),
      /band_at_capture/i,
      'and an observation nobody took on a phone cannot acquire one',
    );
  });

  it('replays it once, however many times the phone sends it', async () => {
    // A handset that loses its connection mid-sync retries the whole batch.
    // Two observations of one stall would be two estimates of one trader.
    const taxpayer = await trader('Sent Twice');
    const agent = await agentSession();
    const draft = {
      clientReference: 'offline-observation-000003',
      draftType: 'BUSINESS_OBSERVATION',
      capturedAt: new Date().toISOString(),
      payload: {
        taxpayerId: taxpayer,
        premises: 'STALL',
        equipmentCount: 1,
        peopleWorking: 0,
        economicSector: 'RETAIL_TRADE',
      },
    };

    const first = await post('/drafts/sync', { drafts: [draft] }, agent);
    assert.equal(first.body.results[0].status, 'SYNCED', JSON.stringify(first.body));
    const second = await post('/drafts/sync', { drafts: [draft] }, agent);
    assert.equal(second.body.results[0].status, 'DUPLICATE', JSON.stringify(second.body));

    const written = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM presumptive_observations WHERE taxpayer_id = $1',
      [taxpayer],
    );
    assert.equal(written!.count, '1');
  });

  it('hands back a refusal the agent can act on, not a constraint', async () => {
    // A group with no part in enumeration is the likeliest field mistake, and
    // an agent reading the queue needs the sentence, not an error code.
    const taxpayer = await trader('Wrong Group');
    const association = await guild('NONE');
    const agent = await agentSession();

    const response = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'offline-observation-000004',
            draftType: 'BUSINESS_OBSERVATION',
            capturedAt: new Date().toISOString(),
            payload: {
              taxpayerId: taxpayer,
              premises: 'KIOSK',
              equipmentCount: 1,
              peopleWorking: 1,
              economicSector: 'ARTISAN_CRAFT',
              groupId: association,
            },
          },
        ],
      },
      agent,
    );
    const [result] = response.body.results;
    assert.equal(result.status, 'REJECTED');
    assert.match(result.message, /has not been given a part/i);
  });
});

/**
 * The rest of the schedule, which one LGA and one trade never reach.
 *
 * A presumptive schedule is a table: sector by band by LGA class. Everything
 * above assesses an artisan with a lock-up shop in a class-A LGA, which is one
 * cell of it. The cells nobody exercises are where a per-class table fails
 * silently — a trader in a rural Council charged the Jos figure is not a
 * refused request, it is a wrong bill that looks exactly like a right one.
 */
describe('the other cells of the schedule', () => {
  async function traderIn(name: string, lga: string) {
    const taxpayer = await trader(name);
    await pool.query('UPDATE taxpayers SET lga_id = $2 WHERE id = $1', [taxpayer, lga]);
    return taxpayer;
  }

  it('charges a rural trader the rural figure, not the Jos one', async () => {
    /*
     * The whole point of classifying LGAs. Four classes, four turnovers, and
     * an assessment that took the wrong row would still produce a plausible
     * invoice — so the figures are chosen far enough apart that reading the
     * wrong one cannot be mistaken for rounding.
     */
    const others = await query<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 ORDER BY name LIMIT 3',
      [lgaId],
    );
    assert.equal(others.length, 3, 'Plateau has seventeen Councils; three spare ones are needed');

    const byClass = [
      { classCode: 'B' as const, lga: others[0]!.id, turnover: '60000000', tax: '600000' },
      { classCode: 'C' as const, lga: others[1]!.id, turnover: '30000000', tax: '300000' },
      { classCode: 'D' as const, lga: others[2]!.id, turnover: '12000000', tax: '120000' },
    ];

    for (const cell of byClass) {
      await classifyLga(pool, {
        lgaId: cell.lga,
        classCode: cell.classCode,
        indexInputs: { roadAccess: 'earth' },
        indexSource: 'National Bureau of Statistics',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2029-01-01',
        actorId: officerId,
        actorRole: 'admin',
      });
      await publishScheduleEntry(pool, {
        economicSector: 'ARTISAN_CRAFT',
        sizeBand: 'SMALL',
        lgaClass: cell.classCode,
        assumedAnnualTurnoverKobo: cell.turnover,
        instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
        effectiveFrom: '2026-01-01',
        actorId: officerId,
        actorRole: 'admin',
      });
    }

    for (const cell of byClass) {
      const taxpayer = await traderIn(`Class ${cell.classCode}`, cell.lga);
      const observation = await observe(taxpayer);
      const assessment = await assessFromObservation(pool, {
        observationId: observation.id,
        actorId: officerId,
        actorRole: 'admin',
      });
      assert.equal(assessment.lgaClass, cell.classCode);
      assert.equal(
        assessment.annualTaxKobo,
        cell.tax,
        `class ${cell.classCode} was charged another class's figure`,
      );
    }

    const classA = await trader('Class A');
    const inJos = await assessFromObservation(pool, {
      observationId: (await observe(classA)).id,
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(inJos.annualTaxKobo, '4800000', 'and the class-A figure did not move either');
  });

  it('lifts a trader working out of a building to the top band', async () => {
    /*
     * Premises set a floor the count cannot lower. Someone running a workshop
     * from a whole building is a medium enterprise whatever they say about how
     * many machines are theirs — which is the arm of the band rule a lock-up
     * shop never reaches.
     */
    await publishScheduleEntry(pool, {
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: 'MEDIUM',
      lgaClass: 'A',
      assumedAnnualTurnoverKobo: '1800000000',
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
      effectiveFrom: '2026-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });

    const taxpayer = await trader('Workshop');
    const observation = await observe(taxpayer, {
      premises: 'BUILDING',
      equipmentCount: 1,
      peopleWorking: 0,
    });
    assert.equal(observation.sizeBand, 'MEDIUM', 'the premises floor is not negotiable');

    const assessment = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(assessment.sizeBand, 'MEDIUM');
    assert.equal(assessment.annualTaxKobo, '18000000');
  });

  it('leaves a kiosk trader in the smallest band', async () => {
    // The other end of the same rule: a kiosk sets no floor above MICRO, so
    // one person with one machine stays where the count puts them.
    const taxpayer = await trader('Kiosk');
    const observation = await observe(taxpayer, {
      premises: 'KIOSK',
      equipmentCount: 1,
      peopleWorking: 0,
    });
    assert.equal(observation.sizeBand, 'MICRO');
  });

  it('records whatever the leader says the premises are, including none', async () => {
    /*
     * The leader's account is written down as given, not translated into a
     * band or a judgement about who is right. Every rung of the ladder,
     * because the one that matters most is NONE — a leader saying a member has
     * no fixed premises at all is saying they may be exempt, and an
     * attestation that could not carry that would only ever argue upwards.
     */
    const association = await guild('ATTESTATION');
    const ladder = ['NONE', 'KIOSK', 'LOCK_UP_SHOP', 'BUILDING'] as const;
    for (const premises of ladder) {
      const taxpayer = await trader(`Leader Says ${premises}`);
      // Attestation is only open on an observation recorded against a group;
      // there is nobody to attest to one an agent took on their own.
      const observation = await observe(taxpayer, { groupId: association });
      await attestObservation(pool, {
        observationId: observation.id,
        agrees: false,
        attestedByName: 'Guild Leader',
        premises,
        equipmentCount: 1,
        peopleWorking: 0,
        actorId: officerId,
        actorRole: 'admin',
      });

      const stored = await queryOne<{ attested_premises: string; attestation_state: string }>(
        pool,
        'SELECT attested_premises, attestation_state FROM presumptive_observations WHERE id = $1',
        [observation.id],
      );
      assert.equal(stored!.attested_premises, premises);
      assert.equal(stored!.attestation_state, 'DISAGREED');
    }
  });

  it('gives a group its part in enumeration, and takes it back', async () => {
    /*
     * The control that makes attestation reachable at all.
     *
     * Phase 5 gave groups a tax role and nothing could set it: every group
     * registered through the platform sat at NONE, so no association could
     * ever attest and the disagreement queue could never fill. A column only
     * a migration can write is a column the platform does not have.
     *
     * Both directions, because withdrawing matters as much as conferring: a
     * union found to be inflating its members' figures has to stop being
     * consulted the same day.
     */
    const association = await guild('NONE');
    // Approved, because standing is only conferred on a group PSIRS admitted;
    // the test below covers what happens when it has not been.
    await pool.query(`UPDATE taxpayer_groups SET status = 'ACTIVE' WHERE id = $1`, [association]);
    const officer = await loginAs('+2348000000001');

    const conferred = await post(
      `/groups/${association}/tax-role`,
      { taxRole: 'ATTESTATION', reason: 'Recognised under the market bye-law of 2026.' },
      { token: officer.accessToken },
    );
    assert.equal(conferred.status, 200, JSON.stringify(conferred.body));

    const taxpayer = await trader('Now Attestable');
    const observation = await observe(taxpayer, { groupId: association });
    await attestObservation(pool, {
      observationId: observation.id,
      agrees: true,
      attestedByName: 'Guild Leader',
      actorId: officerId,
      actorRole: 'admin',
    });

    const withdrawn = await post(
      `/groups/${association}/tax-role`,
      { taxRole: 'NONE', reason: 'Leader suspended pending an inflation complaint.' },
      { token: officer.accessToken },
    );
    assert.equal(withdrawn.status, 200);

    await assert.rejects(
      observe(await trader('After Withdrawal'), { groupId: association }),
      /has not been given a part/i,
      'a group stripped of its role stops being able to stand over anybody',
    );
  });

  it('refuses standing to a group nobody has approved', async () => {
    // A pending registration is a claim that an association exists. Standing
    // conferred before anybody checked would let a group vouch for itself.
    const association = await guild('NONE');
    const registered = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM taxpayer_groups WHERE id = $1',
      [association],
    );
    assert.equal(registered!.status, 'PENDING', 'a newly registered group is not yet approved');

    const officer = await loginAs('+2348000000001');
    const response = await post(
      `/groups/${association}/tax-role`,
      { taxRole: 'ATTESTATION', reason: 'Recognised under the market bye-law of 2026.' },
      { token: officer.accessToken },
    );
    assert.equal(response.status, 409, JSON.stringify(response.body));
  });

  it('lets an association that enumerates its own members do so', async () => {
    /*
     * Two different parts a group can play. An attesting body confirms what an
     * agent recorded; an enumerating one does the recording, which is how a
     * market association reaches members no agent would be let near. Both are
     * standing to be enumerated against; only NONE is not.
     */
    const association = await guild('ENUMERATION');
    const taxpayer = await trader('Enumerated By Guild');
    const observation = await observe(taxpayer, { groupId: association });

    const stored = await queryOne<{ group_id: string }>(
      pool,
      'SELECT group_id FROM presumptive_observations WHERE id = $1',
      [observation.id],
    );
    assert.equal(stored!.group_id, association);
  });
});

/*
 * What objecting costs a trader, which must be nothing.
 *
 * An open objection suspends enforcement. `collectable` in the arrears
 * worklist honours that and always has. Three other readers did not, because
 * they all read `taxpayer_compliance.outstanding_amount_kobo`, which counted
 * the disputed invoice like any other: the incentive arrears gate, the
 * compliance score, and the public citizen portal.
 *
 * A price on objecting — unadvertised, and levied over a bill the objection
 * may be about to overturn — is the one thing an objection window may not
 * have.
 */
describe('an objection costs the trader nothing while it is open', () => {
  async function objectingTrader(name: string) {
    const taxpayer = await trader(name);
    const observation = await observe(taxpayer);
    const assessment = await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    await raiseObjection(pool, {
      presumptiveAssessmentId: assessment.id,
      ground: 'FACTS_WRONG',
      statement: 'I have one machine, not two, and nobody works with me.',
      actorId: officerId,
      actorRole: 'admin',
    });
    await syncTaxpayerComplianceAndIncentives(pool, taxpayer);
    return taxpayer;
  }

  it('records the disputed part beside the total rather than instead of it', async () => {
    const taxpayer = await objectingTrader('Books Straight');
    const row = await queryOne<{
      outstanding_amount_kobo: string;
      disputed_amount_kobo: string;
    }>(
      pool,
      `SELECT outstanding_amount_kobo, disputed_amount_kobo
         FROM taxpayer_compliance WHERE taxpayer_id = $1`,
      [taxpayer],
    );

    /*
     * The gross figure must not move: the receivables report sums it per LGA
     * to answer "what is the State owed", and disputed money is still owed
     * until somebody decides the objection. Narrowing it would make a finance
     * report understate the State's own book.
     */
    assert.equal(
      row!.outstanding_amount_kobo,
      '4800000',
      'the receivable is unchanged by the objection',
    );
    assert.equal(
      row!.disputed_amount_kobo,
      '4800000',
      'and all of it is recorded as suspended from enforcement',
    );
  });

  it('does not disqualify the objector from a programme that requires no arrears', async () => {
    const taxpayer = await objectingTrader('Fertiliser Wanted');

    const { programmeId } = await createProgramme({
      input: {
        name: 'Dry Season Fertiliser Subsidy',
        code: `FERT-${Date.now()}`,
        benefitType: 'INPUT_SUBSIDY',
        minimumScore: 0,
        minimumCompliancePeriods: 0,
        requiresNoArrears: true,
        startDate: '2026-01-01',
        approvalAuthority: 'Plateau State Executive Council',
      },
      actorId: officerId,
      actorRole: 'admin',
    });

    // A programme is created DRAFT; only an ACTIVE one is evaluated on merit.
    await query(pool, `UPDATE incentive_programmes SET status = 'ACTIVE' WHERE id = $1`, [
      programmeId,
    ]);

    const verdict = await evaluateEligibility({ programmeId, taxpayerId: taxpayer });
    assert.ok(
      !verdict.reasons.includes('There are outstanding revenue obligations'),
      `objecting must not cost an entitlement; reasons were ${JSON.stringify(verdict.reasons)}`,
    );
    assert.equal(
      verdict.eligible,
      true,
      `and the programme must actually be granted; reasons were ${JSON.stringify(verdict.reasons)}`,
    );
  });

  it('scores the trader on what is enforceable, not on what is disputed', async () => {
    const taxpayer = await objectingTrader('Scored Fairly');
    const row = await queryOne<{ score: number; score_breakdown: unknown }>(
      pool,
      'SELECT score, score_breakdown FROM taxpayer_compliance WHERE taxpayer_id = $1',
      [taxpayer],
    );
    const components = row!.score_breakdown as { factor: string; points: number }[];
    const liabilities = components.find((c) => c.factor.includes('outstanding liabilities'));
    assert.ok(
      liabilities && liabilities.points === 25,
      `the 25 points must not be withheld over a disputed bill; breakdown was ${JSON.stringify(components)}`,
    );
  });

  it('tells the citizen their assessment is under objection, not that they are in arrears', async () => {
    const taxpayer = await objectingTrader('Asking Online');
    const phone = await queryOne<{ phone: string }>(
      pool,
      'SELECT phone FROM taxpayers WHERE id = $1',
      [taxpayer],
    );

    const response = await get(`/citizen-status?phone=${encodeURIComponent(phone!.phone)}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(
      response.body.complianceStatus,
      'UNDER_OBJECTION',
      'neither HAS_ARREARS, which presses for suspended money, nor COMPLIANT, which is not true either',
    );
    assert.ok(
      !/contact your nearest PSIRS office or a revenue agent to pay/i.test(response.body.message),
      'the State must not press for money it has agreed not to press for',
    );
  });

  /*
   * The control. Without it every assertion above would also pass on a trader
   * who simply owes nothing, and the suite would be measuring the fixture
   * rather than the objection.
   */
  it('still calls an unobjected assessment arrears', async () => {
    const taxpayer = await trader('No Complaint');
    const observation = await observe(taxpayer);
    await assessFromObservation(pool, {
      observationId: observation.id,
      actorId: officerId,
      actorRole: 'admin',
    });
    await syncTaxpayerComplianceAndIncentives(pool, taxpayer);

    const row = await queryOne<{
      outstanding_amount_kobo: string;
      disputed_amount_kobo: string;
    }>(
      pool,
      `SELECT outstanding_amount_kobo, disputed_amount_kobo
         FROM taxpayer_compliance WHERE taxpayer_id = $1`,
      [taxpayer],
    );
    assert.equal(row!.outstanding_amount_kobo, '4800000');
    assert.equal(row!.disputed_amount_kobo, '0', 'nothing is suspended without an objection');

    const phone = await queryOne<{ phone: string }>(
      pool,
      'SELECT phone FROM taxpayers WHERE id = $1',
      [taxpayer],
    );
    const response = await get(`/citizen-status?phone=${encodeURIComponent(phone!.phone)}`);
    assert.equal(response.body.complianceStatus, 'HAS_ARREARS');
  });
});
