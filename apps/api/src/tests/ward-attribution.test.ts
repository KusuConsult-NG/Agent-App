/**
 * Revenue is reported from the ward it was collected in.
 *
 * The portal's revenue intelligence screen offers a drill from State to LGA to
 * Ward to Community, and says so in its own words: "to see where revenue is
 * and is not being collected". The ward tier is built with
 *
 *     FROM wards w LEFT JOIN transactions t ON t.ward_id = w.id
 *
 * so it always returned every ward in the LGA. And `ward_id` was never
 * populated: the registration wizard asked for an LGA and a free-text
 * community and never for a ward, and `GET /reference/wards` — 187 wards,
 * seeded, with an endpoint — had no caller anywhere.
 *
 * The result was not a blank tier. It was every ward in the state reported as
 * having collected nothing, while collections were happening in them. On a
 * screen for finding where revenue is not being collected, that is a false
 * answer rather than a missing one, and a supervisor acting on it would chase
 * a ward that was doing fine.
 *
 * The second test is about the other way this goes wrong. The column took any
 * ward id the caller sent; a foreign key made it a real ward and nothing made
 * it a ward of the taxpayer's LGA. Revenue filed confidently under the wrong
 * ward is worse than the nothing that tier used to show.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string };
let officer = '';
let lgaId = '';
let wards: { id: string; name: string }[] = [];

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Ward Admin', phone: '+2348000000070', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Ward Officer',
    phone: '+2348000000071',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348000000071')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  lgaId = await firstLgaId();
  wards = await query<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM wards WHERE lga_id = $1 ORDER BY name',
    [lgaId],
  );
  assert.ok(wards.length >= 2, 'the seed provides wards to attribute revenue to');
});

async function registerIn(wardId: string | undefined, suffix: string) {
  const auth = { token: agent.token, deviceId: agent.device };
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ward',
      lastName: `Subject${suffix}`,
      phone: `+23480777${suffix.padStart(5, '0')}`,
      address: '5 Market Road, Jos',
      lgaId,
      ...(wardId ? { wardId } : {}),
      community: 'Kabong',
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `ward-tp-${suffix}` },
  );
  return response;
}

/** Take a registration through to a verified payment. */
async function collectFrom(taxpayerId: string, suffix: string) {
  const auth = { token: agent.token, deviceId: agent.device };
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `ward-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const payment = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `ward-pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  return assessment.body.transactionId as string;
}

describe('A collection is attributed to the ward it came from', () => {
  it('carries the ward from the taxpayer onto the transaction', async () => {
    const ward = wards[0]!;
    const registered = await registerIn(ward.id, '1');
    assert.equal(registered.status, 201, JSON.stringify(registered.body));

    const transactionId = await collectFrom(registered.body.taxpayerId, '1');

    const row = await queryOne<{ ward_id: string | null }>(
      pool,
      'SELECT ward_id FROM transactions WHERE id = $1',
      [transactionId],
    );
    assert.equal(row?.ward_id, ward.id, 'the transaction inherits the taxpayer’s ward');
  });

  it('shows the money against that ward in the drill-down, and zero against the others', async () => {
    const ward = wards[0]!;
    const other = wards[1]!;
    const registered = await registerIn(ward.id, '2');
    await collectFrom(registered.body.taxpayerId, '2');

    const report = await get(`/government/intelligence/geography?lgaId=${lgaId}`, {
      token: officer,
    });
    assert.equal(report.status, 200, JSON.stringify(report.body));

    const rows = report.body as { level: string; level_type: string; amount_kobo: string }[];
    const collected = rows.find((row) => row.level === ward.name);
    const empty = rows.find((row) => row.level === other.name);

    assert.ok(collected, `${ward.name} must appear in the ward tier`);
    assert.notEqual(
      collected!.amount_kobo,
      '0',
      'the ward the money came from must not report zero — this tier reported zero for ' +
        'every ward in the state until the registration wizard asked which ward it was',
    );
    assert.equal(empty?.amount_kobo, '0', 'a ward with no collections still reports zero');
  });

  it('leaves the ward unset rather than guessing when none was chosen', async () => {
    // The field is optional: an agent who does not know the ward must not be
    // blocked from registering somebody standing in front of them.
    const registered = await registerIn(undefined, '3');
    assert.equal(registered.status, 201, JSON.stringify(registered.body));

    const row = await queryOne<{ ward_id: string | null }>(
      pool,
      'SELECT ward_id FROM taxpayers WHERE id = $1',
      [registered.body.taxpayerId],
    );
    assert.equal(row?.ward_id, null);
  });
});

describe('A ward has to belong to the LGA it is filed under', () => {
  it('refuses a ward from a different LGA, naming the problem', async () => {
    const otherLga = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 LIMIT 1',
      [lgaId],
    );
    const foreignWard = await queryOne<{ id: string; name: string }>(
      pool,
      'SELECT id, name FROM wards WHERE lga_id = $1 LIMIT 1',
      [otherLga!.id],
    );
    assert.ok(foreignWard, 'the seed provides a ward in another LGA');

    const response = await registerIn(foreignWard!.id, '4');
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(response.body.error.message, /not a ward of the selected/i);
  });

  it('refuses a ward that does not exist at all', async () => {
    const response = await registerIn('00000000-0000-0000-0000-000000000000', '5');
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /does not exist/i);
  });
});

describe('The wizard asks which ward, because nothing else can', () => {
  /*
   * The tests above pass against the code that had this bug, and that is worth
   * saying out loud rather than leaving as a trap for the next reader. The API
   * always accepted wardId; those tests supply one directly, so they prove the
   * attribution works and say nothing about whether anything ever sends it.
   *
   * The defect was entirely in the capture: the registration wizard asked for
   * an LGA and a free-text community and never for a ward, so ward_id stayed
   * null on every taxpayer the platform has. This is the assertion that fails
   * against that code — the same shape as the step-up and KYC review guards,
   * for the same reason. A field nothing fills is a column that is always null,
   * and an always-null column feeding a drill-down is a screen that lies.
   */
  const WIZARD = join(
    __dirname, '..', '..', '..', '..',
    'apps', 'agent', 'src', 'screens', 'Taxpayers.tsx',
  );

  it('fetches the wards for the chosen LGA', () => {
    const source = readFileSync(WIZARD, 'utf8');
    assert.match(
      source,
      /reference\/wards\?lgaId=/,
      'the registration wizard must load the wards of the chosen LGA — the endpoint and 187 ' +
        'seeded wards existed with no caller anywhere',
    );
  });

  it('sends the chosen ward with the registration', () => {
    const source = readFileSync(WIZARD, 'utf8');
    assert.match(
      source,
      /wardId:\s*form\.wardId/,
      'the wizard must submit the ward it collected, or the drill-down stays empty',
    );
  });

  it('clears a ward chosen under a previous LGA', () => {
    // Changing the LGA with a ward still selected would submit a ward of a
    // different LGA. The server refuses that now, but the agent should never
    // have to be told.
    const source = readFileSync(WIZARD, 'utf8');
    assert.match(source, /lgaId:\s*event\.target\.value,\s*wardId:\s*''/);
  });
});
