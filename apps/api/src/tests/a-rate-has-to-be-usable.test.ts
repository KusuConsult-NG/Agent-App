/**
 * A price the platform can actually charge.
 *
 * `POST /revenue/items/:id/rates` sets what a public service costs. It takes a
 * rate type and a bag of optional parameters, and it never checked that the
 * parameters match the type. Each of the four types needs exactly one thing,
 * and each could be created without it — failing in one of two directions,
 * both quiet.
 *
 * FIXED with no amount falls back to zero and PERCENTAGE with no rate charges
 * zero per cent, so the service becomes free. Nothing says so: no error here,
 * no error at assessment, and the agent who tries to collect is refused with
 * "the calculated amount is zero, check the values entered" — which blames
 * them for a figure they did not enter and cannot change.
 *
 * TIERED with no bands and FORMULA with no formula fail the other way. The
 * rate is accepted, goes live on its effective date, and then throws in the
 * field: an agent standing in front of a citizen is told the item "has no rate
 * bands configured", which is true and is not something they can act on.
 *
 * And the floor and the ceiling were never compared. Clamping applies the
 * minimum and then the maximum, so a minimum above a maximum lets the maximum
 * win silently — an officer who set a floor of ₦5,000 against a ceiling of
 * ₦1,000 gets ₦1,000 charged, and nothing tells them the floor they wrote is
 * doing nothing.
 *
 * The catalogue is where the price of a public service lives. A configuration
 * the platform cannot honour has to be refused at the moment it is written, by
 * the officer who can still fix it — not discovered in a market, or never.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

const OFFICER = '+2348030000700';
let officerToken = '';
let itemId = '';
/*
 * Rates are reference data and survive `resetDatabase`, so every version this
 * file writes is still there for the next test. Counting from a baseline taken
 * per test is what makes "no rate was created" mean that, rather than meaning
 * "no rate has ever been created".
 */
let baseline = 0;

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
    role: 'revenue_officer',
    phone: OFFICER,
    fullName: 'Catalogue Officer',
  });
  officerToken = (await loginAs(OFFICER)).accessToken;

  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM revenue_items WHERE status = 'ACTIVE' ORDER BY code LIMIT 1`,
  );
  itemId = item!.id;
  baseline = await rateCount();
});

/** One rate change, with the one-time code it needs. */
async function setRate(body: Record<string, unknown>) {
  await grantStepUp(officerToken, OFFICER, 'catalogue.rate.change');
  return post(
    `/revenue/items/${itemId}/rates`,
    {
      effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
      reason: 'Rate revised by the Board for the coming year.',
      ...body,
    },
    { token: officerToken },
  );
}

const rateCount = async () =>
  Number(
    (await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM revenue_item_rates WHERE revenue_item_id = $1',
      [itemId],
    ))!.n,
  );

const newVersions = async () => (await rateCount()) - baseline;

describe('setting the price of a public service', () => {
  it('refuses a fixed rate with no amount, rather than making it free', async () => {
    const response = await setRate({ rateType: 'FIXED' });
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.match(JSON.stringify(response.body), /fixedAmountKobo/i);
    assert.equal(await newVersions(), 0);
  });

  it('refuses a percentage with no percentage', async () => {
    const response = await setRate({ rateType: 'PERCENTAGE' });
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.match(JSON.stringify(response.body), /rateBasisPoints/i);
    assert.equal(await newVersions(), 0);
  });

  it('refuses tiered bands that are not there', async () => {
    const response = await setRate({ rateType: 'TIERED' });
    assert.equal(
      response.status,
      422,
      'accepted here, it goes live and then fails in front of a citizen',
    );
    assert.equal(await newVersions(), 0);
  });

  it('refuses an empty list of bands as well as a missing one', async () => {
    const response = await setRate({ rateType: 'TIERED', tiers: { tiers: [] } });
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.equal(await newVersions(), 0);
  });

  it('refuses a formula rate with no formula', async () => {
    const response = await setRate({ rateType: 'FORMULA' });
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.equal(await newVersions(), 0);
  });

  it('refuses a floor above the ceiling', async () => {
    const response = await setRate({
      rateType: 'FIXED',
      fixedAmountKobo: '250000',
      minimumAmountKobo: '500000',
      maximumAmountKobo: '100000',
    });
    assert.equal(
      response.status,
      422,
      'the maximum silently wins, so the floor the officer set does nothing',
    );
    assert.equal(await newVersions(), 0);
  });

  it('still accepts each type configured properly', async () => {
    const fixed = await setRate({ rateType: 'FIXED', fixedAmountKobo: '250000' });
    assert.equal(fixed.status, 201, JSON.stringify(fixed.body));

    const percentage = await setRate({ rateType: 'PERCENTAGE', rateBasisPoints: 250 });
    assert.equal(percentage.status, 201, JSON.stringify(percentage.body));

    const tiered = await setRate({
      rateType: 'TIERED',
      tiers: {
        tiers: [
          { upToKobo: '80000000', basisPoints: 0 },
          { upToKobo: null, basisPoints: 700 },
        ],
      },
    });
    assert.equal(tiered.status, 201, JSON.stringify(tiered.body));

    const formula = await setRate({ rateType: 'FORMULA', formula: 'baseAmountKobo * 3 / 100' });
    assert.equal(formula.status, 201, JSON.stringify(formula.body));

    const bounded = await setRate({
      rateType: 'FIXED',
      fixedAmountKobo: '250000',
      minimumAmountKobo: '100000',
      maximumAmountKobo: '500000',
    });
    assert.equal(bounded.status, 201, JSON.stringify(bounded.body));

    assert.equal(await newVersions(), 5, 'a proper configuration is still a proper configuration');
  });

  it('accepts a percentage of nothing, which is a real rate', async () => {
    // Zero basis points is the Fourth Schedule's first band, not a mistake.
    // The rule is that the parameter must be *given*, not that it must be
    // positive — refusing a genuine nil rate would push an officer into
    // configuring something else.
    const response = await setRate({ rateType: 'PERCENTAGE', rateBasisPoints: 0 });
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });
});
