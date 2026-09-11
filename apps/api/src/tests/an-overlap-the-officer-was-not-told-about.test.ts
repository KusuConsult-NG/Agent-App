/**
 * Two rules about time refusing correctly, and what the officer was told.
 *
 * Four tables carry an `EXCLUDE USING gist` constraint, and each says the same
 * kind of thing: a period of time may not be covered twice. Two financial
 * months. Two classes for one LGA. Two constructions of the nano exemption.
 * Two presumptive assessments of one taxpayer.
 *
 * Postgres raises `23P01` for all four, and the error handler had no branch for
 * it. So the request fell past every branch to the 500 at the bottom of that
 * function, whose comment reads: "Nothing above recognised this, which means it
 * is a bug rather than a rule firing." It was a rule firing, and it had fired
 * correctly. The officer got `INTERNAL_ERROR` and a reference number for an
 * action the platform refused on purpose, and `reportError` woke somebody about
 * it, so one ordinary mistake also spent an alert.
 *
 * WHY NOBODY SAW IT
 *
 * `openPeriod` checks for an overlapping month in TypeScript before inserting,
 * so the one exclusion constraint reachable from a well-covered route almost
 * never fires. The other two writers — `classifyLga` and `adoptNanoPolicy` —
 * insert straight in and let the database refuse, and both sit behind routes on
 * the never-exercised list: `POST /presumptive/lga-classes` and
 * `POST /presumptive/nano-policy`. Nothing had ever called them, so nothing had
 * ever seen what the refusal looked like.
 *
 * THE MISTAKE IS THE ORDINARY ONE
 *
 * Not an exotic race. Reclassifying an LGA, or adopting a replacement reading
 * of the nano exemption, without first giving the current record an end date is
 * what somebody does the first time they use the screen. The answer they need
 * is "close the current one first" — which is now what they get.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';

const ADMIN = '+2348077200001';
let token = '';
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Overlap Admin', phone: ADMIN, role: 'admin' });
  token = (await loginAs(ADMIN)).accessToken;
  lgaId = await firstLgaId();
});

const auth = () => ({ token });

/* Far enough out that nothing the seed adopts can be in the way. */
const nanoPolicy = (effectiveFrom: string) => ({
  construction: 'CONJUNCTIVE' as const,
  turnoverCeilingKobo: '2500000000',
  legalBasis: 'PITA s.37 as read with the 2023 Finance Act memorandum.',
  effectiveFrom,
});

const lgaClass = (effectiveFrom: string, effectiveTo?: string) => ({
  lgaId,
  classCode: 'B' as const,
  indexInputs: { marketDensity: 4, roadAccess: 'TARRED' },
  indexSource: 'National Bureau of Statistics, 2029 LGA index.',
  effectiveFrom,
  ...(effectiveTo ? { effectiveTo } : {}),
});

// ===========================================================================
describe('a second record covering time that is already covered', () => {
  it('tells an officer the nano policy overlaps, rather than failing', async () => {
    const first = await post('/government/presumptive/nano-policy', nanoPolicy('2030-01-01'), auth());
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await post('/government/presumptive/nano-policy', nanoPolicy('2030-06-01'), auth());
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error.code, 'OVERLAPPING_PERIOD');
    assert.match(second.body.error.message, /nano exemption policy already covers/i);
    assert.match(second.body.error.nextStep, /end date/i);
  });

  it('tells an officer the LGA is already classified for those dates', async () => {
    const first = await post('/government/presumptive/lga-classes', lgaClass('2030-01-01'), auth());
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await post('/government/presumptive/lga-classes', lgaClass('2030-06-01'), auth());
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error.code, 'OVERLAPPING_PERIOD');
    assert.match(second.body.error.message, /already has a class covering/i);
  });

  /*
   * The message has to name the record, not the constraint. An officer who is
   * told "conflicting key value violates exclusion constraint" has been told
   * the database's business, and the two constraints must not be described
   * interchangeably either — the remedy is on a different screen for each.
   */
  it('does not put the constraint name in front of the officer', async () => {
    await post('/government/presumptive/nano-policy', nanoPolicy('2030-01-01'), auth());
    const second = await post('/government/presumptive/nano-policy', nanoPolicy('2030-06-01'), auth());

    const body = JSON.stringify(second.body);
    assert.ok(!body.includes('nano_policy_no_overlap'), `constraint name leaked: ${body}`);
    assert.ok(!body.includes('daterange'), `raw detail leaked: ${body}`);
    assert.ok(!body.includes('exclusion constraint'), `postgres wording leaked: ${body}`);
  });

  /*
   * Controls. The branch must refuse an overlap and nothing else — a rule that
   * turned every failed write into "that overlaps" would be worse than the 500,
   * because it would be confidently wrong.
   */
  it('still accepts a policy that begins after the last one ends', async () => {
    const first = await post(
      '/government/presumptive/nano-policy',
      nanoPolicy('2030-01-01'),
      auth(),
    );
    assert.equal(first.status, 201, JSON.stringify(first.body));
  });

  it('still accepts a class for a period the previous one has been closed before', async () => {
    /*
     * Three years, not five months. `lga_class_fixed_for_three_years` requires
     * `effective_to >= effective_from + 3 years`, so an LGA's class cannot be
     * churned — which is the point of classifying by an index rather than by
     * judgement. The window here is the shortest one the rule allows.
     */
    const first = await post(
      '/government/presumptive/lga-classes',
      lgaClass('2030-01-01', '2033-01-01'),
      auth(),
    );
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await post(
      '/government/presumptive/lga-classes',
      lgaClass('2033-01-01'),
      auth(),
    );
    assert.equal(second.status, 201, JSON.stringify(second.body));
  });

  /*
   * And the other constraint classes still answer as themselves, so the new
   * branch cannot be swallowing them by sitting above them.
   */
  it('leaves a plain validation failure answering as a validation failure', async () => {
    const bad = await post(
      '/government/presumptive/nano-policy',
      { ...nanoPolicy('2030-01-01'), legalBasis: 'short' },
      auth(),
    );
    assert.equal(bad.status, 422, JSON.stringify(bad.body));
    assert.equal(bad.body.error.code, 'VALIDATION_FAILED');
  });
});
