/**
 * The presumptive schedule, and the reason a tailor in Wase pays less.
 *
 * Phase 4's acceptance criterion is not a passing test — it is whether PSIRS
 * can stand in a room full of traders and defend the table. So the case that
 * matters most here is the worked example: the same trade, the same
 * observations, two local governments, and a smaller bill in the poorer one
 * with nobody having granted anything.
 *
 * Three refusals are as important as the arithmetic, because each is somebody
 * else's decision and a default would make it quietly:
 *
 *   No adopted reading of the nano exemption, no assessment. The Act's
 *   exemption has two defensible constructions and the difference is whether a
 *   shop-based tailor turning over ₦3m pays anything at all. A platform that
 *   picked one would be deciding who in Plateau State is taxed.
 *
 *   No published class for the LGA, no schedule to read.
 *
 *   No schedule row for the sector and band, nothing to assess against.
 *
 * And the invariant the whole regime turns on: the agent records what they can
 * see, the server decides the band. There is no input on any of this through
 * which a turnover or a band can be supplied.
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
  adoptNanoPolicy,
  bandFor,
  classifyLga,
  computePresumptive,
  publishScheduleEntry,
  publishedSchedule,
  tierFor,
  type NanoConstruction,
  type Observations,
} from '../services/presumptive';

let auth: { token: string; deviceId: string };
let officerId: string;
let josNorth: string;
let wase: string;

/** ₦12,000,000 — the nano turnover ceiling in the Act. */
const CEILING_KOBO = '1200000000';

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

  const lgas = await query<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 2', []);
  josNorth = lgas[0]!.id;
  wase = lgas[1]!.id;
});

const TAILOR: Observations = { premises: 'LOCK_UP_SHOP', equipmentCount: 2, peopleWorking: 1 };

async function classify(lgaId: string, classCode: 'A' | 'B' | 'C' | 'D') {
  return classifyLga(pool, {
    lgaId,
    classCode,
    indexInputs: { roadAccess: 'paved', electrification: 0.82, povertyHeadcount: 0.31 },
    indexSource: 'National Bureau of Statistics, 2024 living standards survey',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2029-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
}

async function publish(lgaClass: 'A' | 'B' | 'C' | 'D', turnoverKobo: string, band: 'MICRO' | 'SMALL' | 'MEDIUM' = 'SMALL') {
  return publishScheduleEntry(pool, {
    economicSector: 'ARTISAN_CRAFT',
    sizeBand: band,
    lgaClass,
    assumedAnnualTurnoverKobo: turnoverKobo,
    instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
    effectiveFrom: '2026-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
}

async function adopt(construction: NanoConstruction = 'CONJUNCTIVE') {
  return adoptNanoPolicy(pool, {
    construction,
    turnoverCeilingKobo: CEILING_KOBO,
    legalBasis: 'Opinion of the Attorney-General of Plateau State, 12 January 2026',
    effectiveFrom: '2026-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
}

describe('the worked example', () => {
  it('bills the same tailor less in the poorer local government, with no discount granted', async () => {
    /*
     * The case the whole design exists to make defensible. Identical trade,
     * identical observations, identical rate — and a smaller bill in Wase,
     * because turnover in Wase genuinely is lower and the published schedule
     * says so. Nobody waived anything and no officer decided anything.
     */
    await adopt();
    await classify(josNorth, 'A');
    await classify(wase, 'C');
    await publish('A', '480000000'); // ₦4.8m assumed
    await publish('C', '288000000'); // ₦2.88m assumed

    const inJos = await computePresumptive(pool, {
      economicSector: 'ARTISAN_CRAFT',
      lgaId: josNorth,
      observations: TAILOR,
    });
    const inWase = await computePresumptive(pool, {
      economicSector: 'ARTISAN_CRAFT',
      lgaId: wase,
      observations: TAILOR,
    });

    assert.equal(inJos.annualTaxKobo, '4800000', '₦48,000 a year in a class A area');
    assert.equal(inWase.annualTaxKobo, '2880000', '₦28,800 a year in a class C area');
    assert.equal(inJos.monthlyTaxKobo, '400000', '₦4,000 a month');
    assert.equal(inWase.monthlyTaxKobo, '240000', '₦2,400 a month');

    assert.equal(inJos.sizeBand, inWase.sizeBand, 'the same trade is the same band everywhere');
    assert.ok(
      BigInt(inWase.annualTaxKobo) * 100n / BigInt(inJos.annualTaxKobo) === 60n,
      'the Wase tailor pays 40% less',
    );
  });

  it('carries the arithmetic so it can be repeated at a stall', async () => {
    await adopt();
    await classify(josNorth, 'A');
    await publish('A', '480000000');

    const result = await computePresumptive(pool, {
      economicSector: 'ARTISAN_CRAFT',
      lgaId: josNorth,
      observations: TAILOR,
    });

    const steps = result.trace.map((step) => step.step);
    assert.ok(steps.includes('What was observed'), 'a trader must be able to check the facts');
    assert.ok(steps.includes('Size band'));
    assert.ok(steps.includes('Assumed annual turnover'));
    assert.ok(steps.includes('Presumptive tax at 1%'));
    assert.ok(
      result.trace.some((step) => step.detail.includes('Presumptive Assessment) Regulation')),
      'and which instrument the figure comes from',
    );
  });
});

describe('the band is the server’s to decide', () => {
  it('reads the premises first, because that is what cannot be moved', () => {
    assert.equal(bandFor({ premises: 'NONE', equipmentCount: 0, peopleWorking: 0 }), 'MICRO');
    assert.equal(bandFor({ premises: 'STALL', equipmentCount: 0, peopleWorking: 0 }), 'MICRO');
    assert.equal(bandFor({ premises: 'LOCK_UP_SHOP', equipmentCount: 0, peopleWorking: 0 }), 'SMALL');
    assert.equal(bandFor({ premises: 'BUILDING', equipmentCount: 0, peopleWorking: 0 }), 'MEDIUM');
  });

  it('lets scale lift a band but never lower it', () => {
    /*
     * Somebody operating out of a building with no equipment is not micro,
     * they are between stock. The floor is the point: without it, an operator
     * could be recorded down a band on a quiet day.
     */
    assert.equal(bandFor({ premises: 'BUILDING', equipmentCount: 0, peopleWorking: 0 }), 'MEDIUM');
    assert.equal(bandFor({ premises: 'STALL', equipmentCount: 0, peopleWorking: 6 }), 'MEDIUM');
    assert.equal(bandFor({ premises: 'STALL', equipmentCount: 4, peopleWorking: 0 }), 'SMALL');
  });

  it('refuses a negative observation', () => {
    assert.throws(
      () => bandFor({ premises: 'STALL', equipmentCount: -1, peopleWorking: 0 }),
      /negative/i,
    );
  });

  it('takes no turnover and no band through the API', async () => {
    /*
     * The property stated as a request shape. A caller who sends a band or a
     * turnover has it dropped, and the answer comes out of the observations
     * regardless — so there is nothing to gain by sending one.
     */
    await adopt();
    await classify(josNorth, 'A');
    await publish('A', '480000000');
    const officer = await loginAs('+2348000000001');

    const response = await post(
      '/government/presumptive/preview',
      {
        economicSector: 'ARTISAN_CRAFT',
        lgaId: josNorth,
        sizeBand: 'MICRO',
        assumedAnnualTurnoverKobo: '1',
        observations: { premises: 'LOCK_UP_SHOP', equipmentCount: 2, peopleWorking: 1 },
      },
      { token: officer.accessToken },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.sizeBand, 'SMALL', 'the observations decide, not the request');
    assert.equal(response.body.assumedAnnualTurnoverKobo, '480000000');
  });
});

describe('the nano exemption', () => {
  it('will not assess anybody until a construction has been adopted', async () => {
    await classify(josNorth, 'A');
    await publish('A', '480000000');

    await assert.rejects(
      computePresumptive(pool, {
        economicSector: 'ARTISAN_CRAFT',
        lgaId: josNorth,
        observations: TAILOR,
      }),
      /nano exemption has been adopted/i,
      'guessing here would decide who in Plateau State is taxed at all',
    );
  });

  it('exempts a hawker under either reading', async () => {
    const hawker: Observations = { premises: 'NONE', equipmentCount: 0, peopleWorking: 0 };
    for (const construction of ['CONJUNCTIVE', 'TURNOVER_GOVERNED'] as NanoConstruction[]) {
      await resetDatabase();
      await seedReferenceData();
      officerId = await createGovernmentUser({
        fullName: 'Revenue Admin',
        phone: '+2348000000001',
        role: 'admin',
      });
      await adopt(construction);
      await classify(josNorth, 'A');
      await publish('A', '90000000', 'MICRO'); // ₦900,000, under the ceiling

      const result = await computePresumptive(pool, {
        economicSector: 'ARTISAN_CRAFT',
        lgaId: josNorth,
        observations: hawker,
      });
      assert.equal(result.tier, 'NANO', `exempt under ${construction}`);
      assert.equal(result.annualTaxKobo, '0');
    }
  });

  it('splits on the shop-based tailor, which is the whole of the legal question', async () => {
    /*
     * ₦4.8m assumed, which is under the ₦12m ceiling — so the turnover limb is
     * satisfied and the premises limb is not. Read conjunctively she is
     * taxable; read with turnover governing she is exempt. One question, an
     * order of magnitude of the covered population, and not an engineer's to
     * answer.
     */
    await adopt('CONJUNCTIVE');
    await classify(josNorth, 'A');
    await publish('A', '480000000');

    const strict = await computePresumptive(pool, {
      economicSector: 'ARTISAN_CRAFT',
      lgaId: josNorth,
      observations: TAILOR,
    });
    assert.equal(strict.tier, 'PRESUMPTIVE');
    assert.ok(BigInt(strict.annualTaxKobo) > 0n);

    // The same facts under the other reading.
    const policy = {
      construction: 'TURNOVER_GOVERNED' as NanoConstruction,
      turnoverCeilingKobo: CEILING_KOBO,
      legalBasis: 'test',
      effectiveFrom: new Date(),
    };
    const loose = tierFor(policy, TAILOR, 480_000_000n);
    assert.equal(loose.tier, 'NANO', 'the same tailor, exempt on the other reading');
  });

  it('says which limb caught somebody, not just that they are taxable', async () => {
    const policy = {
      construction: 'CONJUNCTIVE' as NanoConstruction,
      turnoverCeilingKobo: CEILING_KOBO,
      legalBasis: 'test',
      effectiveFrom: new Date(),
    };
    const decision = tierFor(policy, TAILOR, 480_000_000n);

    const premises = decision.reasons.find((r) => r.limb === 'No fixed premises');
    assert.equal(premises!.met, false, 'the shop is the limb that catches her');
    assert.ok(premises!.detail.includes('LOCK_UP_SHOP'));
    assert.equal(
      decision.reasons.find((r) => r.limb === 'Turnover at or below the ceiling')!.met,
      true,
      'and it is not the turnover — which PSIRS should be able to see it is doing',
    );
  });

  it('taxes somebody over the ceiling under either reading', async () => {
    const policy = {
      construction: 'TURNOVER_GOVERNED' as NanoConstruction,
      turnoverCeilingKobo: CEILING_KOBO,
      legalBasis: 'test',
      effectiveFrom: new Date(),
    };
    const big: Observations = { premises: 'NONE', equipmentCount: 0, peopleWorking: 0 };
    assert.equal(tierFor(policy, big, 2_000_000_000n).tier, 'PRESUMPTIVE');
  });
});

describe('what it refuses rather than guesses', () => {
  it('refuses when the local government has no published class', async () => {
    await adopt();
    await publish('A', '480000000');

    await assert.rejects(
      computePresumptive(pool, {
        economicSector: 'ARTISAN_CRAFT',
        lgaId: josNorth,
        observations: TAILOR,
      }),
      /no published class/i,
    );
  });

  it('does not use a class whose period has not started', async () => {
    /*
     * The three-year fix means nothing if a class applies outside the years it
     * was published for. A classification dated from 2030 is not in force
     * today, and reading it anyway would let a future relief be claimed now.
     */
    await adopt();
    await publish('A', '480000000');
    await classifyLga(pool, {
      lgaId: josNorth,
      classCode: 'A',
      indexInputs: { roadAccess: 'paved' },
      indexSource: 'National Bureau of Statistics',
      effectiveFrom: '2030-01-01',
      effectiveTo: '2033-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      computePresumptive(pool, {
        economicSector: 'ARTISAN_CRAFT',
        lgaId: josNorth,
        observations: TAILOR,
      }),
      /no published class/i,
    );

    // And it is in force on a date inside its own period, so the assertion is
    // about the dates rather than about the row not existing.
    const later = await computePresumptive(pool, {
      economicSector: 'ARTISAN_CRAFT',
      lgaId: josNorth,
      observations: TAILOR,
      at: new Date('2031-06-01'),
    });
    assert.equal(later.lgaClass, 'A');
  });

  it('does not use a class whose period has ended', async () => {
    await adopt();
    await publish('A', '480000000');
    await classifyLga(pool, {
      lgaId: josNorth,
      classCode: 'A',
      indexInputs: { roadAccess: 'paved' },
      indexSource: 'National Bureau of Statistics',
      effectiveFrom: '2020-01-01',
      effectiveTo: '2023-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });

    await assert.rejects(
      computePresumptive(pool, {
        economicSector: 'ARTISAN_CRAFT',
        lgaId: josNorth,
        observations: TAILOR,
      }),
      /no published class/i,
      'relief that outlives its published period is relief nobody adopted',
    );
  });

  it('refuses when no schedule covers the sector and band', async () => {
    await adopt();
    await classify(josNorth, 'A');
    // A schedule for MICRO only; the tailor is SMALL.
    await publish('A', '90000000', 'MICRO');

    await assert.rejects(
      computePresumptive(pool, {
        economicSector: 'ARTISAN_CRAFT',
        lgaId: josNorth,
        observations: TAILOR,
      }),
      /No published schedule covers/i,
    );
  });
});

describe('what the database refuses, with the service bypassed', () => {
  it('refuses a class fixed for less than three years', async () => {
    /*
     * The anti-gaming property. A class that can move next year is one an LGA
     * will lobby about, and relief that evaporates the moment an LGA succeeds
     * is a tax on succeeding.
     */
    await assert.rejects(
      pool.query(
        `INSERT INTO lga_classes
           (lga_id, class_code, index_inputs, index_source, effective_from, effective_to, published_by)
         VALUES ($1,'C','{}','NBS','2026-01-01','2027-01-01',$2)`,
        [wase, officerId],
      ),
      /lga_class_fixed_for_three_years/,
    );
  });

  it('refuses two overlapping classes for one local government', async () => {
    await classify(josNorth, 'A');
    await assert.rejects(
      pool.query(
        `INSERT INTO lga_classes
           (lga_id, class_code, index_inputs, index_source, effective_from, effective_to, published_by)
         VALUES ($1,'D','{"x":1}','NBS','2027-01-01','2031-01-01',$2)`,
        [josNorth, officerId],
      ),
      /lga_class_no_overlap/,
      'an ambiguous lookup is the one thing a published table may not be',
    );
  });

  it('refuses a published class being edited', async () => {
    const published = await classify(josNorth, 'A');
    await assert.rejects(
      pool.query(`UPDATE lga_classes SET class_code = 'D' WHERE id = $1`, [published.id]),
      /immutable|cannot be changed|class_code/i,
    );
  });

  it('refuses a schedule with no instrument behind it', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO presumptive_schedules
           (economic_sector, size_band, lga_class, assumed_annual_turnover_kobo,
            instrument_reference, effective_from, published_by)
         VALUES ('ARTISAN_CRAFT','SMALL','A',480000000,'   ','2026-01-01',$1)`,
        [officerId],
      ),
      /instrument_reference/,
      'a schedule nobody adopted will not survive its first challenge',
    );
  });

  it('refuses two overlapping figures for the same cell', async () => {
    await publish('A', '480000000');
    await assert.rejects(
      pool.query(
        `INSERT INTO presumptive_schedules
           (economic_sector, size_band, lga_class, assumed_annual_turnover_kobo,
            instrument_reference, effective_from, published_by)
         VALUES ('ARTISAN_CRAFT','SMALL','A',999,'Reg 2026','2026-06-01',$1)`,
        [officerId],
      ),
      /presumptive_no_overlap/,
    );
  });

  it('refuses a published figure being edited', async () => {
    const entry = await publish('A', '480000000');
    await assert.rejects(
      pool.query(
        'UPDATE presumptive_schedules SET assumed_annual_turnover_kobo = 1 WHERE id = $1',
        [entry.id],
      ),
      /immutable|cannot be changed|assumed_annual_turnover_kobo/i,
    );
  });

  it('refuses two overlapping nano policies, so the reading is never ambiguous', async () => {
    await adopt();
    await assert.rejects(
      pool.query(
        `INSERT INTO nano_exemption_policies
           (construction, turnover_ceiling_kobo, legal_basis, effective_from, adopted_by)
         VALUES ('TURNOVER_GOVERNED',$1,'other opinion','2026-06-01',$2)`,
        [CEILING_KOBO, officerId],
      ),
      /nano_policy_no_overlap/,
    );
  });

  it('refuses an adopted construction being edited', async () => {
    const policy = await adopt();
    await assert.rejects(
      pool.query(
        `UPDATE nano_exemption_policies SET construction = 'TURNOVER_GOVERNED' WHERE id = $1`,
        [policy.id],
      ),
      /immutable|cannot be changed|construction/i,
    );
  });

  it('refuses a tax tier the schema does not know', async () => {
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Tiered',
        lastName: 'Person',
        phone: '+2348077700001',
        address: '1 Market Rd',
        lgaId: josNorth,
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...auth, idempotencyKey: 'tier-tp-1' },
    );
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

    await assert.rejects(
      pool.query(`UPDATE taxpayers SET tax_tier = 'EXEMPT' WHERE id = $1`, [
        taxpayer.body.taxpayerId,
      ]),
      /tax_tier/,
    );
    // And the three the regime actually has.
    for (const tier of ['NANO', 'PRESUMPTIVE', 'BOOKS']) {
      await pool.query(`UPDATE taxpayers SET tax_tier = $2 WHERE id = $1`, [
        taxpayer.body.taxpayerId,
        tier,
      ]);
    }
  });

  it('refuses a group trade outside the taxpayer vocabulary', async () => {
    /*
     * The two columns could not be joined, so a market association's trade was
     * not something the schedule could look up. Same vocabulary now, same
     * constraint.
     */
    const group = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayer_groups (code, name, group_type, lga_id, leader_name, leader_phone, registered_by)
       VALUES ('GRP-TEST-1','Bukuru Shoemakers','ARTISAN_GUILD',$1,'Leader','+2348011100001',$2)
       RETURNING id`,
      [josNorth, officerId],
    );
    await assert.rejects(
      pool.query(`UPDATE taxpayer_groups SET economic_sector = 'shoes' WHERE id = $1`, [group!.id]),
      /economic_sector/,
    );
    await pool.query(`UPDATE taxpayer_groups SET economic_sector = 'ARTISAN_CRAFT' WHERE id = $1`, [
      group!.id,
    ]);
  });
});

describe('the published table', () => {
  it('says what is missing before it says what is in it', async () => {
    const before = await publishedSchedule(pool);
    assert.equal(before.readiness.nanoPolicyAdopted, false);
    assert.equal(before.readiness.scheduleCells, 0);
    assert.ok(before.readiness.lgasTotal > 0, 'the denominator is the LGAs on the register');
    assert.equal(
      before.readiness.lgasClassified,
      0,
      'a schedule half-published assesses some people and refuses others for reasons ' +
        'neither of them can see',
    );

    await adopt();
    await classify(josNorth, 'A');
    await publish('A', '480000000');

    const after = await publishedSchedule(pool);
    assert.equal(after.readiness.nanoPolicyAdopted, true);
    assert.equal(after.readiness.nanoConstruction, 'CONJUNCTIVE');
    assert.equal(after.readiness.lgasClassified, 1);
    assert.equal(after.readiness.scheduleCells, 1);
  });

  it('carries the whole ladder, and the figures fall as the class weakens', async () => {
    /*
     * Four classes and three bands are not decoration: the ladder is what a
     * trader reads to see that the numbers move in an order that makes sense.
     * A schedule where class B and class D were never published would look
     * complete to an officer and refuse half the State.
     */
    await adopt();
    const lgas = await query<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 4', []);
    const ladder = [
      { lga: lgas[0]!.id, code: 'A' as const, turnover: '480000000' },
      { lga: lgas[1]!.id, code: 'B' as const, turnover: '384000000' },
      { lga: lgas[2]!.id, code: 'C' as const, turnover: '288000000' },
      { lga: lgas[3]!.id, code: 'D' as const, turnover: '192000000' },
    ];
    for (const rung of ladder) {
      await classify(rung.lga, rung.code);
      await publish(rung.code, rung.turnover);
      // And the largest band, so every size the schema allows is published.
      await publishScheduleEntry(pool, {
        economicSector: 'ARTISAN_CRAFT',
        sizeBand: 'MEDIUM',
        lgaClass: rung.code,
        assumedAnnualTurnoverKobo: (BigInt(rung.turnover) * 3n).toString(),
        instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
        effectiveFrom: '2026-01-01',
        actorId: officerId,
        actorRole: 'admin',
      });
    }

    const table = await publishedSchedule(pool);
    assert.equal(table.readiness.scheduleCells, 8, 'four classes across two bands');

    const small = table.entries.filter((entry) => entry.sizeBand === 'SMALL');
    const byClass = Object.fromEntries(
      small.map((entry) => [entry.lgaClass, BigInt(entry.assumedAnnualTurnoverKobo)]),
    );
    assert.ok(
      byClass.A! > byClass.B! && byClass.B! > byClass.C! && byClass.C! > byClass.D!,
      'the assumed turnover falls as the local economy weakens, which is the whole mechanism',
    );

    // And the ladder produces bills in the same order.
    const inA = await computePresumptive(pool, {
      economicSector: 'ARTISAN_CRAFT',
      lgaId: lgas[0]!.id,
      observations: TAILOR,
    });
    const inD = await computePresumptive(pool, {
      economicSector: 'ARTISAN_CRAFT',
      lgaId: lgas[3]!.id,
      observations: TAILOR,
    });
    assert.ok(BigInt(inA.annualTaxKobo) > BigInt(inD.annualTaxKobo));
  });

  it('names the evidence behind each class', async () => {
    await classify(wase, 'C');
    const table = await publishedSchedule(pool);
    const row = table.classes.find((entry) => entry.lgaId === wase);
    assert.ok(row, 'the class is published, not held privately');
    assert.ok(
      row!.indexSource.includes('National Bureau of Statistics'),
      'a class an LGA cannot trace is one they cannot argue with',
    );
  });

  it('is readable by anyone who may read the catalogue', async () => {
    await adopt();
    await classify(josNorth, 'A');
    await publish('A', '480000000');
    const officer = await loginAs('+2348000000001');

    const response = await get('/government/presumptive/schedule', { token: officer.accessToken });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.entries.length, 1);
  });
});

describe('who may change it', () => {
  it('is refused to an agent', async () => {
    const response = await post(
      '/government/presumptive/schedule',
      {
        economicSector: 'ARTISAN_CRAFT',
        sizeBand: 'SMALL',
        lgaClass: 'A',
        assumedAnnualTurnoverKobo: '1',
        instrumentReference: 'Made up',
        effectiveFrom: '2026-01-01',
      },
      auth,
    );
    assert.equal(response.status, 403, `got ${response.status}`);
  });

  it('refuses a class with no indicators recorded', async () => {
    await assert.rejects(
      classifyLga(pool, {
        lgaId: josNorth,
        classCode: 'C',
        indexInputs: {},
        indexSource: 'National Bureau of Statistics',
        effectiveFrom: '2026-01-01',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /a letter somebody chose/i,
    );
  });

  it('refuses a class with no source named', async () => {
    await assert.rejects(
      classifyLga(pool, {
        lgaId: josNorth,
        classCode: 'C',
        indexInputs: { povertyHeadcount: 0.44 },
        indexSource: '   ',
        effectiveFrom: '2026-01-01',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /whose data this class came from/i,
      'a classification nobody can trace is one an LGA cannot argue with',
    );
  });

  it('refuses a schedule figure with no instrument named', async () => {
    await assert.rejects(
      publishScheduleEntry(pool, {
        economicSector: 'ARTISAN_CRAFT',
        sizeBand: 'SMALL',
        lgaClass: 'A',
        assumedAnnualTurnoverKobo: '480000000',
        instrumentReference: '   ',
        effectiveFrom: '2026-01-01',
        actorId: officerId,
        actorRole: 'admin',
      }),
      /instrument that adopted this figure/i,
    );
  });

  it('numbers each version of a cell in sequence', async () => {
    const first = await publish('A', '480000000');
    assert.equal(first.version, 1);

    await pool.query(
      `UPDATE presumptive_schedules SET effective_to = '2027-01-01' WHERE id = $1`,
      [first.id],
    );
    const second = await publishScheduleEntry(pool, {
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: 'SMALL',
      lgaClass: 'A',
      assumedAnnualTurnoverKobo: '520000000',
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2027',
      effectiveFrom: '2027-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });
    assert.equal(second.version, 2, 'an assessment carries the version it was computed against');
  });
});
