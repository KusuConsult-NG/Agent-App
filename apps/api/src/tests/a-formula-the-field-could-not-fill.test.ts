/**
 * A formula rate the field app had no way to fill in.
 *
 * The field app decided what to ask from the catalogue's rate type: a base
 * amount for PERCENTAGE and TIERED items, and nothing at all otherwise. A
 * FORMULA rate names its own inputs — `area * 50000` for a shop charged by the
 * square metre — so the app sent none, the engine answered "This revenue item
 * needs a value for "area"", and the item could not be collected in the field.
 * An officer could configure it, the catalogue listed it, and nobody could
 * charge it.
 *
 * The server now says what the rate in force for this taxpayer reads, by name,
 * and the app asks for exactly that. These hold the server half; the screen
 * half is `apps/agent/src/tests/what-a-formula-asks-for.test.tsx`.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
  createGovernmentUser,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { inputsFor } from '../services/rate-engine';

let agent: { token: string; deviceId: string };
let itemId = '';
let taxpayerId = '';
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/** Put a rate in force now, ending whatever was in force for the same place. */
async function rateInForce(params: { formula: string; lgaId?: string | null }): Promise<void> {
  await pool.query(
    `UPDATE revenue_item_rates SET effective_to = now()
      WHERE revenue_item_id = $1 AND lga_id IS NOT DISTINCT FROM $2 AND effective_to IS NULL`,
    [itemId, params.lgaId ?? null],
  );
  await pool.query(
    `INSERT INTO revenue_item_rates (revenue_item_id, lga_id, version, rate_type, formula, effective_from)
     SELECT $1, $2, COALESCE(max(version), 0) + 1, 'FORMULA', $3, now() - interval '1 minute'
       FROM revenue_item_rates WHERE revenue_item_id = $1 AND lga_id IS NOT DISTINCT FROM $2`,
    [itemId, params.lgaId ?? null, params.formula],
  );
}

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Formula Admin', phone: '+2348000000380', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  itemId = await revenueItemByCode('SHOPS-KIOSKS');
  lgaId = await firstLgaId();

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Measured',
      lastName: 'Shopkeeper',
      phone: '+2348030000381',
      address: '3 Terminus Market, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: 'formula-taxpayer' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId as string;
});

describe('what a rate has to be told', () => {
  it('is named by the rate, once each, in the order the formula uses them', () => {
    assert.deepEqual(inputsFor({ rate_type: 'FORMULA', formula: 'area * 50000 + rooms * 1000 + area' }), [
      'area',
      'rooms',
    ]);
    assert.deepEqual(inputsFor({ rate_type: 'PERCENTAGE', formula: null }), ['baseAmountKobo']);
    assert.deepEqual(inputsFor({ rate_type: 'TIERED', formula: null }), ['baseAmountKobo']);
    assert.deepEqual(inputsFor({ rate_type: 'FIXED', formula: null }), []);
    assert.deepEqual(inputsFor({ rate_type: 'FORMULA', formula: '250000' }), []);
  });

  it('is what the field app is told to ask for a formula item', async () => {
    // On the taxpayer's own Council: SHOPS-KIOSKS is one of the items charged
    // by each Council's bye-law, and that rate is preferred to the statewide one.
    await rateInForce({ formula: 'area * 50000', lgaId });

    const asked = await get(`/revenue/items/${itemId}/inputs?taxpayerId=${taxpayerId}`, agent);
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.deepEqual(asked.body, { rateType: 'FORMULA', inputs: ['area'] });

    // And what it then sends is enough to quote, decimals and all.
    const quoted = await post(
      '/revenue/quote',
      { revenueItemId: itemId, inputs: { area: '15.5' }, taxpayerId },
      agent,
    );
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
    assert.equal(quoted.body.amountKobo, '775000');
  });

  it("follows the taxpayer's Council when its rate reads something else", async () => {
    await rateInForce({ formula: 'area * 50000' });
    await rateInForce({ formula: 'rooms * 20000', lgaId });

    const asked = await get(`/revenue/items/${itemId}/inputs?taxpayerId=${taxpayerId}`, agent);
    assert.deepEqual(asked.body.inputs, ['rooms'], 'the statewide formula is not the one this trader is charged on');
  });
});
