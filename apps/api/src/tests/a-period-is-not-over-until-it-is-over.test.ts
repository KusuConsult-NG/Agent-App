/**
 * A month that is declared finished a day and a half before it ends.
 *
 * `forecast()` in `services/targets.ts` has a branch for a period that is not
 * a forecast at all — one that has not started, or one that is already over:
 *
 *     if (daysElapsed >= daysInPeriod || daysElapsed <= 0) { ... }
 *
 * and for the finished case it answers with `confidence: 'HIGH'`,
 * `basis: 'RUN_RATE'` and `explanation_key: 'forecastPeriodComplete'`. That is
 * the right answer for a finished period: there is nothing to extrapolate, the
 * collected figure *is* the answer, and saying so beats a projection.
 *
 * It decided "finished" by counting days, and counted them with `Math.round`:
 *
 *     daysElapsed = clamp(0, daysInPeriod, round((now - periodStart)/day) + 1)
 *
 * `round` turns a part-day into a whole one, so for September 2026
 * (periodStart 09-01, periodEnd 09-30, daysInPeriod 30) the count reaches 30
 * at **midday on the 29th**:
 *
 *     2026-09-29 11:30   elapsed 29   a forecast
 *     2026-09-29 12:30   elapsed 30   RUN_RATE / HIGH / forecastPeriodComplete
 *
 * From that instant the platform tells a government the month is over and this
 * is the final figure, with a day and a half of collection still to come. The
 * figure is not a forecast any more, by its own label, so nobody reading it
 * has any reason to treat it as provisional.
 *
 * AND THE LAST DAY IS STILL WRONG WITH `floor`. Day 30 of 30 is *in* the
 * period. `daysElapsed >= daysInPeriod` is true from 00:00 on the 30th
 * whichever rounding is used, so the whole of the final day — a working day,
 * on which a month's late payers settle up — reported the month as closed.
 * That is the same off-by-one this repository has already fixed twice, in a
 * certificate that read EXPIRED on the date it said it expired and an
 * incentive programme that would not open on the day it said it closed.
 *
 * So the count and the question are separated: `daysElapsed` counts whole
 * elapsed days with `floor`, and whether the period is over is asked of the
 * calendar in Plateau rather than inferred from that count.
 *
 * WHY NOTHING CAUGHT IT. The existing test asserts the no-history case is
 * `RUN_RATE` with `LOW` confidence, and three of its four assertions are also
 * true of the finished-period branch. It passed every day of the month except
 * the last two, and failed on 30 September for the first time — which is to
 * say the suite was green by coincidence of the date it ran on.
 */

import './env';
import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { seedReferenceData } from '../db/seed';
import { forecast } from '../services/targets';

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
});
after(async () => {
  await stopTestServer();
});

async function atInstant<T>(iso: string, body: () => Promise<T> | T): Promise<T> {
  mock.timers.enable({ apis: ['Date'], now: new Date(iso).getTime() });
  try {
    return await body();
  } finally {
    mock.timers.reset();
  }
}

/** September 2026: thirty days, the 30th being the last of them. */
const SEPTEMBER = {
  periodStart: new Date('2026-09-01T00:00:00Z'),
  periodEnd: new Date('2026-09-30T00:00:00Z'),
};

const forecastAt = (iso: string) => atInstant(iso, () => forecast(pool, { ...SEPTEMBER }));

describe('a period is not over until it is over', () => {
  it('is still a forecast at midday on the second-to-last day', async () => {
    // The instant `Math.round` used to tip over. A day and a half of
    // collection remains.
    const result = await forecastAt('2026-09-29T12:30:00Z');
    assert.notEqual(
      result.explanation_key,
      'forecastPeriodComplete',
      'the month was reported closed on the 29th, with two days of it left',
    );
    assert.notEqual(
      result.confidence,
      'HIGH',
      'and reported it with the confidence reserved for a finished period',
    );
  });

  it('counts whole elapsed days, not part of one as all of it', async () => {
    const before = await forecastAt('2026-09-29T11:30:00Z');
    const after = await forecastAt('2026-09-29T12:30:00Z');
    assert.equal(before.days_elapsed, 29, 'eleven hours into the 29th is 29 days elapsed');
    assert.equal(
      after.days_elapsed,
      29,
      'and so is half past twelve — an hour of the afternoon is not a day',
    );
  });

  it('is still a forecast on the last day of the period', async () => {
    // A working day. A month's late payers settle on it.
    const result = await forecastAt('2026-09-30T20:00:00Z');
    assert.equal(result.days_elapsed, 30, 'the 30th is the thirtieth day');
    assert.equal(result.days_in_period, 30);
    assert.notEqual(
      result.explanation_key,
      'forecastPeriodComplete',
      'the last day of the month was reported as already over',
    );
    assert.notEqual(result.confidence, 'HIGH');
    assert.equal(result.is_forecast, true);
  });

  it('is finished once the period has actually passed', async () => {
    // The control: the branch is right, it was only reached too early.
    const result = await forecastAt('2026-10-01T00:30:00Z');
    assert.equal(result.explanation_key, 'forecastPeriodComplete');
    assert.equal(result.confidence, 'HIGH');
    assert.equal(result.basis, 'RUN_RATE');
    assert.equal(result.days_elapsed, result.days_in_period);
  });

  it('asks the calendar in Plateau, not the one the server is set to', async () => {
    // 2026-10-01T00:30Z is 01:30 in Lagos — over in both. The hour that
    // separates them is 2026-09-30T23:30Z, which is already 1 October in
    // Plateau, where the taxpayers and the officers are. UTC would still call
    // it September.
    const result = await forecastAt('2026-09-30T23:30:00Z');
    assert.equal(
      result.explanation_key,
      'forecastPeriodComplete',
      'half past midnight on 1 October in Jos was still reported as September in progress',
    );
  });

  it('has not started before it starts', async () => {
    const result = await forecastAt('2026-08-31T12:00:00Z');
    assert.equal(result.days_elapsed, 0);
    assert.equal(result.basis, 'INSUFFICIENT_HISTORY');
    assert.equal(result.explanation_key, 'forecastNotStarted');
  });
});
