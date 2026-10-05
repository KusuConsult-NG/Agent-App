/**
 * Two officers publishing a revision of one schedule figure at the same moment.
 *
 * Publishing ends the figure in force on the new figure's start date and then
 * inserts (`a-figure-that-could-not-be-revised`). Both found the same figure
 * in force; the second waited on its row, found it no longer in force once the
 * first had ended it, and inserted into the first's period — refused by the
 * database as an overlap with a "later figure" that does not exist. A second
 * apart it would have been told what is true: a figure already starts that
 * day, so a replacement has to start later. The lock on the schedule cell
 * makes the second wait and then read what the first published.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, pool, resetDatabase, startTestServer, stopTestServer } from '../helpers';
import { query } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { publishScheduleEntry } from '../../services/presumptive';
import { currentYearInPlateau } from '../../lib/calendar-day';

let officerId = '';
const year = currentYearInPlateau();

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({ fullName: 'Revising Officer', phone: '+2348077400001', role: 'admin' });
});

const publish = (sizeBand: 'MICRO' | 'SMALL' | 'MEDIUM', turnoverKobo: string, effectiveFrom: string) =>
  publishScheduleEntry(pool, {
    economicSector: 'ARTISAN_CRAFT',
    sizeBand,
    lgaClass: 'A',
    assumedAnnualTurnoverKobo: turnoverKobo,
    instrumentReference: `Plateau State Revenue (Presumptive Assessment) Regulation, from ${effectiveFrom}`,
    effectiveFrom,
    actorId: officerId,
    actorRole: 'admin',
  });

describe('two revisions of one figure from the same date, at once', () => {
  it('publishes one and tells the other why its date cannot be used', async () => {
    const bands = ['MICRO', 'SMALL', 'MEDIUM'] as const;
    for (let round = 0; round < 6; round += 1) {
      const band = bands[round % 3]!;
      const from = `${year + 1 + Math.floor(round / 3)}-01-01`;
      if (round < 3) await publish(band, '480000000', '2020-01-01');

      const outcomes = await Promise.allSettled([
        publish(band, '520000000', from),
        publish(band, '530000000', from),
      ]);
      const published = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const refused = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      assert.equal(published.length, 1, `round ${round}: ${published.length} published`);
      assert.equal(
        refused[0]!.reason.code,
        'NOT_REPLACEABLE_FROM_THAT_DATE',
        `round ${round}: refused as ${String(refused[0]!.reason.code ?? refused[0]!.reason)}`,
      );

      const rows = await query<{ n: string }>(
        pool,
        `SELECT count(*)::text AS n FROM presumptive_schedules
          WHERE size_band = $1 AND effective_from = $2`,
        [band, from],
      );
      assert.equal(rows[0]!.n, '1', `round ${round} left two figures from ${from}`);
    }
  });
});
