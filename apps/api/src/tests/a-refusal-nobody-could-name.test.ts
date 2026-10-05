/**
 * Three refusals on the collect path that had no name.
 *
 * The agent application translates a refusal by its code — deliberately, since
 * the server's wording changes and a translation matched on text would stop
 * applying the moment somebody improved an English sentence, silently and in
 * the language nobody testing it reads.
 *
 * These three were raised as `badRequest`, which is 400 INVALID_REQUEST and
 * nothing else: the same code a malformed field gets. INVALID_REQUEST is the
 * one code that map deliberately does not translate, because a validation
 * message names a field and is generated from the schema. So there was nothing
 * to key a Hausa sentence on, and an agent standing in a market was told in
 * English why the levy they had just chosen would not go through.
 *
 * `REVENUE_ITEM_INACTIVE` sits three lines above two of them and was already
 * named. These are the ones beside it that were not.
 *
 * The status stays 400. The request is well formed and the catalogue does not
 * allow it, which is what it always said; what changes is that the sentence
 * can now be said in the reader's language.
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
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { grantStepUp } from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { createAssessment } from '../services/revenue';
import type { ComputationInputs } from '../services/rate-engine';

let officerId: string;
let agentAuth: { token: string; deviceId: string };
let agentlessOfficerToken: string;
let seq = 0;

const OFFICER_PHONE = '+2348000000070';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Catalogue Officer',
    phone: OFFICER_PHONE,
    role: 'admin',
  });
  agentlessOfficerToken = (await loginAs(OFFICER_PHONE)).accessToken;
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demo agent needs an administrator to approve it');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

async function taxpayer(type: 'INDIVIDUAL' | 'BUSINESS' = 'INDIVIDUAL'): Promise<string> {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: type,
      ...(type === 'BUSINESS'
        ? { businessName: `Trader ${suffix} Ltd` }
        : { firstName: 'Ladi', lastName: `Dung${suffix}` }),
      phone: `+23480999${suffix}`,
      address: '9 Market Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `name-tp-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

/** The code and status an assessment was refused with. */
async function refusalFor(
  taxpayerId: string,
  revenueItemId: string,
  // The engine's own input type, not `Record<string, unknown>`: a declared
  // figure is a string, a number or a boolean, and widening it here only moves
  // the refusal to the call below.
  inputs: ComputationInputs = {},
) {
  try {
    await createAssessment({
      taxpayerId,
      revenueItemId,
      inputs,
      actorId: officerId,
      actorRole: 'admin',
      channel: 'OFFICER',
    });
  } catch (error) {
    const caught = error as { statusCode?: number; code?: string; message?: string };
    return { statusCode: caught.statusCode, code: caught.code, message: caught.message };
  }
  assert.fail('the assessment was not refused');
}

describe('a refusal the agent application can translate', () => {
  it('names a levy that does not apply to this kind of taxpayer', async () => {
    // GAMING-TAX is seeded for businesses only, which is a rule about the
    // catalogue rather than about the fixture.
    const individual = await taxpayer('INDIVIDUAL');
    const gaming = await revenueItemByCode('GAMING-TAX');

    const refusal = await refusalFor(individual, gaming);

    assert.equal(refusal.code, 'REVENUE_ITEM_NOT_FOR_TAXPAYER_TYPE');
    assert.notEqual(
      refusal.code,
      'INVALID_REQUEST',
      'the code a malformed field gets, which is the one the agent app will not translate',
    );
    assert.equal(refusal.statusCode, 400, 'the status is unchanged; only the code is specific');
    assert.match(refusal.message ?? '', /does not apply/i);
  });

  it('names a levy that is not collected where the taxpayer is', async () => {
    const payer = await taxpayer('BUSINESS');
    const item = await revenueItemByCode('SHOPS-KIOSKS');

    /*
     * Narrowed to one LGA that is not this taxpayer's — a configuration an
     * officer makes through the catalogue, not a state only a fixture can
     * reach.
     */
    const elsewhere = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 ORDER BY name LIMIT 1',
      [await firstLgaId()],
    );
    await pool.query('UPDATE revenue_items SET applicable_lga_ids = $2 WHERE id = $1', [
      item,
      [elsewhere!.id],
    ]);

    const refusal = await refusalFor(payer, item);

    assert.equal(refusal.code, 'REVENUE_ITEM_NOT_IN_LGA');
    assert.equal(refusal.statusCode, 400);
    assert.match(refusal.message ?? '', /Local Government Area/i);
  });

  it('names an amount that worked out to nothing from a figure that was given', async () => {
    /*
     * Declared, and zero. That separation is the point of the branch: a zero
     * that came out of the schedule is a nil liability and says so, and a zero
     * that came out of an empty form keeps the older message, which
     * `a-rate-has-to-be-usable` describes as blaming the agent for a figure
     * they did not enter. Being unreadable as well as unfair was the worse of
     * the two halves.
     */
    const payer = await taxpayer('BUSINESS');
    const item = await revenueItemByCode('PRODUCE-SALES-TAX');

    /*
     * With no floor under it, set the way an officer sets one.
     *
     * Every percentage levy in the seeded catalogue carries a statutory
     * minimum and the clamp applies it, so a declared zero comes out as the
     * minimum rather than as nothing. A rate row is immutable once written —
     * correctly — so the floor is removed by writing a new version through
     * the catalogue, which is the only way it happens in the field too.
     */
    await grantStepUp(agentlessOfficerToken, OFFICER_PHONE, 'catalogue.rate.change');
    const rate = await post(
      `/revenue/items/${item}/rates`,
      {
        effectiveFrom: new Date().toISOString(),
        reason: 'Floor removed by the Board for produce sales.',
        rateType: 'PERCENTAGE',
        rateBasisPoints: 200,
      },
      { token: agentlessOfficerToken },
    );
    assert.equal(rate.status, 201, JSON.stringify(rate.body));

    const refusal = await refusalFor(payer, item, { baseAmountKobo: '0' });

    assert.equal(refusal.code, 'ASSESSMENT_AMOUNT_ZERO', `got ${refusal.code}: ${refusal.message}`);
    assert.equal(refusal.statusCode, 400);
  });

  it('leaves a missing figure as the field problem it is', async () => {
    /*
     * The boundary of this change, asserted rather than assumed. Assessing the
     * same levy with nothing declared is refused by the rate engine as a field
     * problem — "Assessable amount is required", with the field named in
     * `details` — and that stays INVALID_REQUEST. The agent application
     * renders the detail list with the field's own label, and the policy above
     * its translation map is that a guessed Hausa sentence for a message
     * nobody has seen is worse than the English, because the reader cannot
     * tell a guess from a translation.
     *
     * Naming this one too would have been the easy half of the change and the
     * wrong half.
     */
    const payer = await taxpayer('BUSINESS');
    const refusal = await refusalFor(payer, await revenueItemByCode('PRODUCE-SALES-TAX'));

    assert.equal(refusal.code, 'INVALID_REQUEST', `got ${refusal.code}: ${refusal.message}`);
    assert.match(refusal.message ?? '', /Assessable amount is required/i);
  });

  it('reaches the agent with that code, through the screen they collect on', async () => {
    /*
     * The link that makes the rest of this worth doing: the codes above are
     * only useful if they arrive at the application that translates them, so
     * one is asserted over HTTP from the agent's own session rather than from
     * the service.
     */
    const individual = await taxpayer('INDIVIDUAL');
    const response = await post(
      '/revenue/assessments',
      {
        taxpayerId: individual,
        revenueItemId: await revenueItemByCode('GAMING-TAX'),
        inputs: {},
      },
      { ...agentAuth, idempotencyKey: `name-as-${seq}` },
    );

    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'REVENUE_ITEM_NOT_FOR_TAXPAYER_TYPE');
  });
});
