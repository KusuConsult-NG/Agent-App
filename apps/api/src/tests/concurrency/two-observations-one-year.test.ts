/**
 * Two officers assessing two observations of one trader at the same moment.
 *
 * `assessFromObservation` refuses a second presumptive bill for a year the
 * trader has already been billed for (`a-year-billed-twice`). That refusal
 * reads for a bill and then raises one, and the bill it reads for may be the
 * one another officer is raising from the trader's other observation at that
 * instant: each locks its own observation, neither sees the other's bill, and
 * both are issued. The lock on the taxpayer makes the second wait for the
 * first and then see it.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { seedDemoAgent } from '../../db/seed-agent';
import { assessFromObservation, recordObservation } from '../../services/enumeration';
import { adoptNanoPolicy, classifyLga, publishScheduleEntry } from '../../services/presumptive';

let auth: { token: string; deviceId: string };
let officerId: string;
let secondOfficerId: string;
let lgaId: string;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({ fullName: 'First Officer', phone: '+2348000000201', role: 'admin' });
  secondOfficerId = await createGovernmentUser({ fullName: 'Second Officer', phone: '+2348000000202', role: 'admin' });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  lgaId = (await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1', []))!.id;

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

async function trader(round: number) {
  const suffix = String(round).padStart(5, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Raced',
      lastName: `Tailor${suffix}`,
      phone: `+23480446${suffix}`,
      address: '7 Terminus Market, Jos',
      lgaId,
      economicSector: 'ARTISAN_CRAFT',
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `raced-tp-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

const observe = (taxpayerId: string) =>
  recordObservation(pool, {
    taxpayerId,
    premises: 'LOCK_UP_SHOP',
    equipmentCount: 2,
    peopleWorking: 1,
    economicSector: 'ARTISAN_CRAFT',
    actorId: officerId,
    actorRole: 'admin',
  });

describe('two observations of one trader assessed at once', () => {
  it('bills the year once, and tells the second officer why not', async () => {
    for (let round = 0; round < 8; round += 1) {
      const taxpayer = await trader(round);
      const [one, two] = [await observe(taxpayer), await observe(taxpayer)];

      const outcomes = await Promise.allSettled([
        assessFromObservation(pool, { observationId: one.id, actorId: officerId, actorRole: 'admin' }),
        assessFromObservation(pool, { observationId: two.id, actorId: secondOfficerId, actorRole: 'admin' }),
      ]);

      const issued = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
      assert.equal(issued.length, 1, `round ${round}: ${issued.length} bills issued`);
      assert.equal(
        (refused[0] as PromiseRejectedResult).reason.code,
        'ALREADY_BILLED_THIS_YEAR',
        `round ${round}: refused for the wrong reason: ${String((refused[0] as PromiseRejectedResult).reason)}`,
      );

      const bills = await queryOne<{ n: string }>(
        pool,
        `SELECT count(*)::text AS n FROM invoices i JOIN assessments a ON a.id = i.assessment_id
          WHERE a.taxpayer_id = $1`,
        [taxpayer],
      );
      assert.equal(bills!.n, '1', `round ${round} billed the year ${bills!.n} times`);
    }
  });
});
