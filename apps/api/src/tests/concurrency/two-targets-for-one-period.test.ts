/**
 * Two figures set for one period, at the same moment.
 *
 * `setTarget` supersedes whatever stood for the same scope and dates and then
 * inserts the new figure, which is a revision for one caller and a race for
 * two. Both UPDATEs match nothing — the row each is looking for is the one the
 * other has not committed yet — and both insert.
 *
 * WHAT THE RACE COSTS, WHICH IS NOT WHAT IT LOOKS LIKE
 *
 * Migration 088 narrowed `revenue_targets_one_live_per_scope` to the scope and
 * the two dates, so the second insert now meets it rather than settling beside
 * the first. That is the right database answer and the wrong answer to give an
 * officer: they are refused a target that would have been set had the two
 * requests arrived a second apart, and the sentence they get tells them to
 * close a target they cannot see — where sequentially they would have
 * superseded it and been told which figure they replaced.
 *
 * So the lock, and not only the index. The index is what makes the rule true;
 * the lock is what lets both callers be answered as though they had queued,
 * because that is what they did.
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
import { query } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { resolvePeriod } from '../../services/targets';

let token = '';
const period = resolvePeriod('MONTHLY');
const iso = (date: Date) => date.toISOString().slice(0, 10);

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Target Race Officer',
    phone: '+2348089800001',
    role: 'revenue_officer',
  });
  token = (await loginAs('+2348089800001')).accessToken;
});

/**
 * One target, as the planning screen sends it.
 *
 * Two labels over one pair of dates, because that is the shape the index used
 * to allow: `period_kind` was part of its key and part of nothing that reads a
 * target. The race is the same with one label — this way it is also the
 * defect that sent me looking.
 */
const set = (periodKind: string, amountKobo: string) =>
  post(
    '/government/targets',
    {
      scope: 'STATE',
      periodKind,
      periodStart: iso(period.start),
      periodEnd: iso(period.end),
      amountKobo,
    },
    { token },
  );

async function rows(): Promise<{ id: string; status: string; amount_kobo: string }[]> {
  return query<{ id: string; status: string; amount_kobo: string }>(
    pool,
    `SELECT id, status, amount_kobo::text FROM revenue_targets
      WHERE scope = 'STATE' AND period_start = $1 AND period_end = $2
      ORDER BY created_at`,
    [iso(period.start), iso(period.end)],
  );
}

describe('two targets set for one period together', () => {
  it('leaves one figure live, and the other recorded as superseded', async () => {
    await Promise.all([set('MONTHLY', '50000000'), set('QUARTERLY', '90000000')]);

    const written = await rows();
    const live = written.filter((row) => row.status === 'ACTIVE');
    assert.equal(
      live.length,
      1,
      'two live targets for one period, which is the disagreement migration 056 ' +
        `was written to prevent: ${JSON.stringify(written)}`,
    );
    assert.equal(
      written.length,
      2,
      `a figure was lost rather than superseded: ${JSON.stringify(written)}`,
    );
    assert.equal(
      written.find((row) => row.status !== 'ACTIVE')!.status,
      'SUPERSEDED',
      'the figure that did not survive is not recorded as having been replaced',
    );
  });

  it('answers both callers as though they had queued', async () => {
    const [first, second] = await Promise.all([
      set('MONTHLY', '50000000'),
      set('QUARTERLY', '90000000'),
    ]);

    assert.deepEqual(
      [first.status, second.status].sort(),
      [201, 201],
      'one caller was refused a target that would have been set a second apart: ' +
        JSON.stringify([first.body, second.body]),
    );

    // One went first and superseded nothing; the other names what it replaced.
    const superseded = [first, second].map((response) => response.body.superseded);
    const named = superseded.filter((id) => id !== null);
    assert.equal(
      named.length,
      1,
      `expected exactly one of the two to report a supersede: ${JSON.stringify(superseded)}`,
    );
    const ids = [first.body.id, second.body.id];
    assert.ok(
      ids.includes(named[0]),
      'the supersede names a target neither call created, so the two did not ' +
        'serialise against each other',
    );
  });
});
