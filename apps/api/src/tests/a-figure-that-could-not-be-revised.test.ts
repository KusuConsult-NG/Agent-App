/**
 * A published figure, class or reading of the exemption, and its successor.
 *
 * Each of the three presumptive tables refuses two records covering one day.
 * Nothing on the platform could give a record an end date once it was
 * published, and the portal publishes a schedule figure and adopts a reading
 * of the exemption with no end date at all — so the first of each was
 * permanent. Measured through the routes: a figure for a cell published, its
 * replacement for the next year refused 409 with a message about "this
 * taxpayer's presumptive assessment", and a next step telling the officer to
 * give the current figure an end date, which nothing could do. The reading of
 * the exemption, which decides who in Plateau State pays at all, could never
 * be changed after the first adoption.
 *
 * A new record now replaces the one in force on its start date. It may not do
 * so from the day that record began, from a day already past, or — for a
 * class — within the three years a class is fixed for.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import {
  adoptNanoPolicy,
  classifyLga,
  computePresumptive,
  lgaClassInForce,
  nanoPolicyInForce,
  publishedSchedule,
  publishScheduleEntry,
} from '../services/presumptive';
import { currentYearInPlateau, todayInPlateau } from '../lib/calendar-day';

const ADMIN = '+2348077300001';
let officerId = '';
let token = '';
let lgaId = '';
const year = currentYearInPlateau();
const NEXT_YEAR = `${year + 1}-01-01`;
const LONG_AGO = '2020-01-01';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({ fullName: 'Schedule Officer', phone: ADMIN, role: 'admin' });
  token = (await loginAs(ADMIN)).accessToken;
  lgaId = await firstLgaId();

  await adoptNanoPolicy(pool, {
    construction: 'CONJUNCTIVE',
    turnoverCeilingKobo: '1200000000',
    legalBasis: 'Opinion of the Attorney-General of Plateau State, 12 January 2020',
    effectiveFrom: LONG_AGO,
    actorId: officerId,
    actorRole: 'admin',
  });
  await classifyLga(pool, {
    lgaId,
    classCode: 'A',
    indexInputs: { roadAccess: 'paved' },
    indexSource: 'National Bureau of Statistics',
    effectiveFrom: LONG_AGO,
    actorId: officerId,
    actorRole: 'admin',
  });
});

const figure = (turnoverKobo: string, effectiveFrom: string) => ({
  economicSector: 'ARTISAN_CRAFT' as const,
  sizeBand: 'SMALL' as const,
  lgaClass: 'A' as const,
  assumedAnnualTurnoverKobo: turnoverKobo,
  instrumentReference: `Plateau State Revenue (Presumptive Assessment) Regulation, from ${effectiveFrom}`,
  effectiveFrom,
});

const publish = (turnoverKobo: string, effectiveFrom: string) =>
  publishScheduleEntry(pool, { ...figure(turnoverKobo, effectiveFrom), actorId: officerId, actorRole: 'admin' });

const TAILOR = { premises: 'LOCK_UP_SHOP' as const, equipmentCount: 2, peopleWorking: 1 };
const taxAt = async (at: Date) =>
  (await computePresumptive(pool, { economicSector: 'ARTISAN_CRAFT', lgaId, observations: TAILOR, at }))
    .annualTaxKobo;

async function cell() {
  return query<{ version: number; effective_from: string; effective_to: string | null }>(
    pool,
    `SELECT version, effective_from::text, effective_to::text FROM presumptive_schedules
      WHERE economic_sector = 'ARTISAN_CRAFT' AND size_band = 'SMALL' AND lga_class = 'A'
      ORDER BY effective_from`,
    [],
  );
}

describe('a revised schedule figure', () => {
  it('replaces the figure in force from the day it begins, and not before', async () => {
    const first = await publish('480000000', LONG_AGO);
    const second = await publish('520000000', NEXT_YEAR);

    assert.deepEqual(second.replaced, { id: first.id, effectiveFrom: LONG_AGO });
    assert.equal(second.version, 2, 'the cell’s versions continue');
    assert.deepEqual(await cell(), [
      { version: 1, effective_from: LONG_AGO, effective_to: NEXT_YEAR },
      { version: 2, effective_from: NEXT_YEAR, effective_to: null },
    ]);

    assert.equal(await taxAt(new Date()), '4800000', 'today is still under the first figure');
    assert.equal(await taxAt(new Date(`${year + 1}-06-01T12:00:00Z`)), '5200000');
  });

  it('is accepted through the route the portal uses, and says what it replaced', async () => {
    const first = await post('/government/presumptive/schedule', figure('480000000', LONG_AGO), { token });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await post('/government/presumptive/schedule', figure('520000000', NEXT_YEAR), { token });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.replaced.id, first.body.id);

    const table = await publishedSchedule(pool, new Date(`${year + 1}-06-01T12:00:00Z`));
    assert.deepEqual(
      table.entries.map((entry) => entry.assumedAnnualTurnoverKobo),
      ['520000000'],
      'one figure for the cell, never two',
    );
  });

  it('records what it replaced in the audit trail', async () => {
    const first = await publish('480000000', LONG_AGO);
    const second = await publish('520000000', NEXT_YEAR);
    const audit = await queryOne<{ new_value: { replaces: string | null }; reason: string }>(
      pool,
      `SELECT new_value, reason FROM audit_logs
        WHERE action = 'presumptive_schedule.published' AND entity_id = $1`,
      [second.id],
    );
    assert.equal(audit!.new_value.replaces, first.id);
    assert.match(audit!.reason, new RegExp(`replacing the figure in force since ${LONG_AGO}`));
  });

  it('is refused from a day already past, and changes nothing', async () => {
    await publish('480000000', LONG_AGO);
    const yesterday = todayInPlateau(new Date(Date.now() - 86_400_000));

    await assert.rejects(publish('520000000', yesterday), (error: { code?: string; message?: string }) => {
      assert.equal(error.code, 'NOT_REPLACEABLE_FROM_THAT_DATE');
      assert.match(String(error.message), /stays the record for that day/);
      return true;
    });
    assert.deepEqual(await cell(), [{ version: 1, effective_from: LONG_AGO, effective_to: null }]);
  });

  it('is accepted from today', async () => {
    await publish('480000000', LONG_AGO);
    const replacement = await publish('520000000', todayInPlateau());
    assert.ok(replacement.replaced);
  });

  it('is refused from the day the figure in force began', async () => {
    await publish('480000000', NEXT_YEAR);
    await assert.rejects(
      publish('520000000', NEXT_YEAR),
      (error: { code?: string; message?: string }) =>
        error.code === 'NOT_REPLACEABLE_FROM_THAT_DATE' && /same day/.test(String(error.message)),
    );
  });

  /*
   * A figure published from a later date is not replaced by an earlier one.
   * The earlier one would run into it, and the overlap constraint refuses —
   * now with a sentence about the schedule rather than about a taxpayer.
   */
  it('still refuses running into a figure published from a later date, and says so', async () => {
    await publish('520000000', `${year + 2}-01-01`);
    const response = await post('/government/presumptive/schedule', figure('480000000', NEXT_YEAR), { token });

    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'OVERLAPPING_PERIOD');
    assert.match(response.body.error.message, /presumptive schedule already has a figure/);
    assert.doesNotMatch(response.body.error.message, /taxpayer/i);
    assert.doesNotMatch(JSON.stringify(response.body), /presumptive_no_overlap|exclusion constraint/);
  });
});

describe('a revised reading of the nano exemption', () => {
  it('replaces the reading in force from the day it begins', async () => {
    const adopted = await post(
      '/government/presumptive/nano-policy',
      {
        construction: 'TURNOVER_GOVERNED',
        turnoverCeilingKobo: '1500000000',
        legalBasis: 'Revised opinion of counsel, following the Finance Act',
        effectiveFrom: NEXT_YEAR,
      },
      { token },
    );
    assert.equal(adopted.status, 201, JSON.stringify(adopted.body));
    assert.ok(adopted.body.replaced, 'the first reading was replaced, not refused');

    assert.equal((await nanoPolicyInForce(pool))!.construction, 'CONJUNCTIVE');
    assert.equal(
      (await nanoPolicyInForce(pool, new Date(`${year + 1}-06-01T12:00:00Z`)))!.construction,
      'TURNOVER_GOVERNED',
    );
  });
});

describe('a local government reclassified', () => {
  it('replaces the class once its three years have run', async () => {
    const response = await post(
      '/government/presumptive/lga-classes',
      {
        lgaId,
        classCode: 'B',
        indexInputs: { roadAccess: 'unpaved' },
        indexSource: 'National Bureau of Statistics, revised index',
        effectiveFrom: NEXT_YEAR,
      },
      { token },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal((await lgaClassInForce(pool, lgaId))!.classCode, 'A');
    assert.equal(
      (await lgaClassInForce(pool, lgaId, new Date(`${year + 1}-06-01T12:00:00Z`)))!.classCode,
      'B',
    );
  });

  it('refuses a class within its three years, naming the date it is fixed until', async () => {
    const other = (await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 ORDER BY name LIMIT 1',
      [lgaId],
    ))!.id;
    await classifyLga(pool, {
      lgaId: other,
      classCode: 'C',
      indexInputs: { roadAccess: 'paved' },
      indexSource: 'National Bureau of Statistics',
      effectiveFrom: NEXT_YEAR,
      actorId: officerId,
      actorRole: 'admin',
    });

    const response = await post(
      '/government/presumptive/lga-classes',
      {
        lgaId: other,
        classCode: 'D',
        indexInputs: { roadAccess: 'unpaved' },
        indexSource: 'National Bureau of Statistics, revised index',
        effectiveFrom: `${year + 3}-01-01`,
      },
      { token },
    );
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'NOT_REPLACEABLE_FROM_THAT_DATE');
    assert.match(response.body.error.message, new RegExp(`fixed until ${year + 4}-01-01`));
    assert.equal(
      (await lgaClassInForce(pool, other, new Date(`${year + 3}-06-01T12:00:00Z`)))!.classCode,
      'C',
      'the refusal changed nothing',
    );
  });
});
