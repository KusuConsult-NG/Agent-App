/**
 * The items a field agent is offered for a taxpayer.
 *
 * The collect screen asked for the catalogue by taxpayer type alone. Two things
 * followed, both because the list never knew where the taxpayer was:
 *
 *   * An item limited to other Councils was offered anyway. The agent could
 *     pick it, have it quoted, and only then be refused when raising the
 *     charge — `createAssessmentIn` checks `applicable_lga_ids`, the list did
 *     not.
 *   * The rate shown beside each item was whichever rate was newest anywhere.
 *     Eleven items carry a rate per Council and SHOPS-KIOSKS has no statewide
 *     rate at all, so the list described some other Council's charge.
 *
 * The list now takes the taxpayer, as the quote does, and resolves the place
 * and the taxpayer type from the record rather than from the client.
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
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; deviceId: string };
let taxpayerId = '';
let homeLga = '';
let otherLga = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Catalogue Admin', phone: '+2348000000390', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const lgas = await query<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 2');
  [homeLga, otherLga] = [lgas[0]!.id, lgas[1]!.id];

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Listed',
      lastName: 'Trader',
      phone: '+2348030000391',
      address: '1 Old Market, Jos',
      lgaId: homeLga,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: 'items-taxpayer' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId as string;
});

/** The list the collect screen asks for. */
const listFor = () => get(`/revenue/items?taxpayerType=INDIVIDUAL&taxpayerId=${taxpayerId}`, agent);

describe('the catalogue offered for one taxpayer', () => {
  it('leaves out an item limited to other Councils', async () => {
    const elsewhere = await revenueItemByCode('SHOPS-KIOSKS');
    await pool.query('UPDATE revenue_items SET applicable_lga_ids = ARRAY[$2::uuid] WHERE id = $1', [
      elsewhere,
      otherLga,
    ]);

    const listed = await listFor();
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const ids = (listed.body as { id: string }[]).map((item) => item.id);
    assert.ok(!ids.includes(elsewhere), 'offered an item the charge would then be refused for');
  });

  it('still offers one limited to the taxpayer’s own Council', async () => {
    // The control: the filter narrows to the place, it does not hide every
    // limited item.
    const here = await revenueItemByCode('SHOPS-KIOSKS');
    await pool.query('UPDATE revenue_items SET applicable_lga_ids = ARRAY[$2::uuid] WHERE id = $1', [
      here,
      homeLga,
    ]);

    const ids = ((await listFor()).body as { id: string }[]).map((item) => item.id);
    assert.ok(ids.includes(here));
  });

  it('describes the rate this taxpayer’s Council charges, not the newest one anywhere', async () => {
    const shops = await revenueItemByCode('SHOPS-KIOSKS');
    // A newer rate in another Council than the one in force here. Taking
    // effect now, after the seed's: backdated by a second, it was older than
    // the seeded rates, and the test passed against the defect.
    await pool.query(
      `UPDATE revenue_item_rates SET effective_to = now()
        WHERE revenue_item_id = $1 AND lga_id = $2 AND effective_to IS NULL`,
      [shops, otherLga],
    );
    await pool.query(
      `INSERT INTO revenue_item_rates (revenue_item_id, lga_id, version, rate_type, formula, effective_from)
       SELECT $1, $2, max(version) + 1, 'FORMULA', 'area * 50000', clock_timestamp()
         FROM revenue_item_rates WHERE revenue_item_id = $1 AND lga_id = $2`,
      [shops, otherLga],
    );

    const row = ((await listFor()).body as { id: string; rate_type: string }[]).find(
      (item) => item.id === shops,
    );
    assert.ok(row, 'the item is offered here');
    assert.equal(row!.rate_type, 'FIXED', "the list showed another Council's formula rate");
  });

  it('leaves out an item with no rate in force for this Council', async () => {
    // SHOPS-KIOSKS has no statewide rate. Without this Council's, the quote
    // and the charge both refuse it, so offering it is offering a refusal.
    const shops = await revenueItemByCode('SHOPS-KIOSKS');
    await pool.query(
      `UPDATE revenue_item_rates SET effective_to = now()
        WHERE revenue_item_id = $1 AND lga_id = $2 AND effective_to IS NULL`,
      [shops, homeLga],
    );

    const ids = ((await listFor()).body as { id: string }[]).map((item) => item.id);
    assert.ok(!ids.includes(shops), 'offered an item no rate here can charge');
  });

  it('takes the place from the record, not from the request', async () => {
    // The same reasoning as the quote: the client is not the one to say which
    // Council's rules apply. A taxpayerType contradicting the record is ignored.
    const listed = await get(`/revenue/items?taxpayerType=BUSINESS&taxpayerId=${taxpayerId}`, agent);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const individualOnly = await query<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items
        WHERE status = 'ACTIVE' AND applicable_taxpayer_types = ARRAY['INDIVIDUAL']::text[] LIMIT 1`,
    );
    assert.ok(individualOnly[0], 'the seed has an item only individuals pay');
    const ids = (listed.body as { id: string }[]).map((item) => item.id);
    assert.ok(ids.includes(individualOnly[0]!.id), 'the record says INDIVIDUAL; the request said otherwise');
  });

  it('prefers this Council’s rate to a newer statewide one, as the charge does', async () => {
    // resolveRate takes the Council's own rate first. A list that took the
    // newest would show the statewide figure here and charge the Council's.
    const shops = await revenueItemByCode('SHOPS-KIOSKS');
    await pool.query(
      `INSERT INTO revenue_item_rates (revenue_item_id, lga_id, version, rate_type, formula, effective_from)
       VALUES ($1, NULL, 1, 'FORMULA', 'area * 50000', clock_timestamp())`,
      [shops],
    );

    const row = ((await listFor()).body as { id: string; rate_type: string }[]).find(
      (item) => item.id === shops,
    );
    assert.equal(row?.rate_type, 'FIXED', 'the list showed the statewide rate over the Council’s own');
  });
});
