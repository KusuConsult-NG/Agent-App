/**
 * A rate that belongs to a Local Government Council, not to the State.
 *
 * Eleven catalogue items are on Part III of the Taxes and Levies (Approved
 * List for Collection) Act — the local government list — and the rate for any
 * of them is set by a Council's own bye-law. Plateau has seventeen Councils.
 * The catalogue carried one figure each, so a daily market levy of ₦200
 * applied in Jos North and in Wase alike. Those are not the same market and no
 * single bye-law governs both, so the figure was wrong somewhere no matter
 * what it was.
 *
 * The properties below are what "per-LGA" has to mean to be worth having.
 *
 * The last one is the one that would hurt. The agent app shows a quote and
 * then raises an assessment, and those are two calls. If only one of them
 * knows which LGA the taxpayer is in, the screen shows a trader one figure and
 * the receipt charges another — which is precisely the class of failure this
 * platform exists to prevent, arriving through a feature meant to make the
 * figures more accurate.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  post,
  loginAs,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { createAssessment, quote, resolveRate } from '../services/revenue';

let officerId: string;
let itemId: string;
let cheapLga: { id: string; name: string };
let dearLga: { id: string; name: string };

const kobo = (naira: number) => (BigInt(naira) * 100n).toString();

async function taxpayerIn(lgaId: string, suffix: string) {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Rate','Fixture',$1,'1 Market Rd',$2,'ACTIVE','AGENT')
     RETURNING id`,
    [`+2348094${suffix}`, lgaId],
  );
  return row!.id;
}

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  await startTestServer();

  officerId = await createGovernmentUser({
    fullName: 'Rate Test Officer',
    phone: '+2348094000001',
    role: 'revenue_officer',
  });

  const lgas = await query<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM lgas ORDER BY name LIMIT 2',
  );
  cheapLga = lgas[0]!;
  dearLga = lgas[1]!;

  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM revenue_items WHERE code = 'MARKET-LEVY'`,
  );
  itemId = item!.id;
});

after(async () => {
  await stopTestServer();
});

describe('a Council may set its own figure', () => {
  /*
   * The fixture uses two items on purpose.
   *
   * INFRA-LEVY is state revenue and still carries one statewide rate, so it
   * is where "an LGA override beats the default" can be tested at all.
   * MARKET-LEVY is Part III and now carries seventeen rates and no default,
   * which is the arrangement the change exists to produce — so superseding
   * one Council's row is what changing a market levy actually looks like now.
   */
  let infraItem: string;

  before(async () => {
    const infra = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'INFRA-LEVY'`,
    );
    infraItem = infra!.id;

    await query(
      pool,
      `INSERT INTO revenue_item_rates
         (revenue_item_id, lga_id, version, rate_type, fixed_amount_kobo, effective_from)
       VALUES ($1,$2,1,'FIXED',$3, now() - interval '1 day')`,
      [infraItem, dearLga.id, kobo(7500)],
    );

    // Changing a Part III rate means closing this Council's row and opening a
    // new version of it — not touching a shared figure.
    const current = await queryOne<{ id: string; version: number }>(
      pool,
      `SELECT id, version FROM revenue_item_rates
        WHERE revenue_item_id = $1 AND lga_id = $2 AND effective_to IS NULL`,
      [itemId, dearLga.id],
    );
    await query(pool, `UPDATE revenue_item_rates SET effective_to = now() WHERE id = $1`, [
      current!.id,
    ]);
    await query(
      pool,
      `INSERT INTO revenue_item_rates
         (revenue_item_id, lga_id, version, rate_type, fixed_amount_kobo, effective_from)
       VALUES ($1,$2,$3,'FIXED',$4, now() - interval '1 second')`,
      [itemId, dearLga.id, current!.version + 100, kobo(750)],
    );
  });

  it('prefers the LGA rate over the statewide default', async () => {
    const specific = await resolveRate(pool, infraItem, new Date(), dearLga.id);
    assert.equal(specific.fixed_amount_kobo, kobo(7500));
    assert.equal(specific.lga_id, dearLga.id);
  });

  it('falls back to the statewide default where a Council has set nothing', async () => {
    const fallback = await resolveRate(pool, infraItem, new Date(), cheapLga.id);
    assert.equal(fallback.lga_id, null, 'an LGA without its own rate did not fall back');
    assert.equal(fallback.fixed_amount_kobo, kobo(5000));
  });

  it('charges two taxpayers differently according to where they are', async () => {
    const here = await taxpayerIn(dearLga.id, '100001');
    const there = await taxpayerIn(cheapLga.id, '100002');

    const dear = await createAssessment({
      taxpayerId: here,
      revenueItemId: itemId,
      inputs: {},
      actorId: officerId,
      actorRole: 'revenue_officer',
      channel: 'OFFICER',
    });
    const cheap = await createAssessment({
      taxpayerId: there,
      revenueItemId: itemId,
      inputs: {},
      actorId: officerId,
      actorRole: 'revenue_officer',
      channel: 'OFFICER',
    });

    assert.equal(dear.amountKobo.toString(), kobo(750));
    assert.equal(cheap.amountKobo.toString(), kobo(200));
  });
});

describe('"not collectable here" has a representation', () => {
  it('refuses an item with neither an LGA rate nor a default', async () => {
    /*
     * Part III excludes street naming in the State Capital, and Jos is the
     * capital. With per-LGA rates that is expressible directly: no rate row
     * for those LGAs, and the platform already refuses an item with no rate
     * in force rather than inventing one.
     */
    const streetNaming = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'STREET-NAMING'`,
    );
    const jos = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM lgas WHERE name = 'Jos North'`,
    );
    const taxpayer = await taxpayerIn(jos!.id, '100003');

    await assert.rejects(
      () =>
        createAssessment({
          taxpayerId: taxpayer,
          revenueItemId: streetNaming!.id,
          inputs: {},
          actorId: officerId,
          actorRole: 'revenue_officer',
          channel: 'OFFICER',
        }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, 'NO_EFFECTIVE_RATE', error.message ?? 'no message');
        return true;
      },
      'street naming must not be chargeable in the State Capital',
    );
  });

  it('still charges it where a Council has set a rate', async () => {
    const streetNaming = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'STREET-NAMING'`,
    );
    const elsewhere = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM lgas WHERE name NOT IN ('Jos North','Jos South') ORDER BY name LIMIT 1`,
    );
    const taxpayer = await taxpayerIn(elsewhere!.id, '100004');

    const assessment = await createAssessment({
      taxpayerId: taxpayer,
      revenueItemId: streetNaming!.id,
      inputs: {},
      actorId: officerId,
      actorRole: 'revenue_officer',
      channel: 'OFFICER',
    });
    assert.ok(BigInt(assessment.amountKobo) > 0n);
  });
});

describe('the quote and the charge agree', () => {
  it('quotes the same figure the assessment raises, in the same LGA', async () => {
    /*
     * The agent app quotes, shows the trader the amount, and then assesses.
     * Two calls. If the quote does not know the LGA and the assessment does,
     * the screen shows one figure and the receipt carries another — the exact
     * failure this platform is built to prevent, arriving through a feature
     * meant to make the figures more accurate.
     */
    const taxpayer = await taxpayerIn(dearLga.id, '100005');

    const quoted = await quote(pool, {
      revenueItemId: itemId,
      inputs: {},
      lgaId: dearLga.id,
    });

    const assessment = await createAssessment({
      taxpayerId: taxpayer,
      revenueItemId: itemId,
      inputs: {},
      actorId: officerId,
      actorRole: 'revenue_officer',
      channel: 'OFFICER',
    });

    assert.equal(
      quoted.amountKobo.toString(),
      assessment.amountKobo.toString(),
      'the amount shown to the taxpayer is not the amount charged',
    );
    assert.equal(quoted.amountKobo.toString(), kobo(750));
  });

  it('quotes the statewide figure where the Council has set none', async () => {
    const quoted = await quote(pool, { revenueItemId: itemId, inputs: {}, lgaId: cheapLga.id });
    assert.equal(quoted.amountKobo.toString(), kobo(200));
  });
});

describe('every Part III item is a per-Council decision', () => {
  it('carries a rate for each LGA rather than one for the State', async () => {
    /*
     * Seeded at the figure the catalogue already carried, so behaviour today
     * is unchanged — what changes is that seventeen Councils now have
     * seventeen rows to correct instead of one shared figure nobody can
     * source.
     */
    const rows = await query<{ code: string; lga_rates: string; default_rates: string }>(
      pool,
      `SELECT ri.code,
              count(*) FILTER (WHERE r.lga_id IS NOT NULL)::text AS lga_rates,
              count(*) FILTER (WHERE r.lga_id IS NULL)::text AS default_rates
         FROM revenue_items ri
         JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
        WHERE ri.code IN ('SHOPS-KIOSKS','TENEMENT-RATES','SLAUGHTER-SLAB','ABATTOIR-FEE',
                          'MARRIAGE-REGISTRATION','RIGHT-OCCUPANCY','MOTOR-PARK-LEVY',
                          'DOMESTIC-ANIMAL-LICENCE','SIGNAGE-FEE')
        GROUP BY ri.code ORDER BY ri.code`,
    );
    assert.equal(rows.length, 9, 'a Part III item lost its rates entirely');

    for (const row of rows) {
      assert.equal(
        row.default_rates,
        '0',
        `${row.code} still carries a statewide default, which no bye-law sets`,
      );
      assert.equal(
        row.lga_rates,
        '17',
        `${row.code} does not have a rate for every Council`,
      );
    }
  });

  it('gives street naming every Council except the two in the State Capital', async () => {
    const row = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n
         FROM revenue_item_rates r
         JOIN revenue_items ri ON ri.id = r.revenue_item_id
         JOIN lgas l ON l.id = r.lga_id
        WHERE ri.code = 'STREET-NAMING' AND l.name IN ('Jos North','Jos South')`,
    );
    assert.equal(row!.n, '0', 'street naming is priced in the State Capital');
  });
});

describe('the quote a trader is actually shown', () => {
  /*
   * Over HTTP, not through the service.
   *
   * The rest of this file calls `quote` and `createAssessment` directly, and
   * that would have passed with the route still resolving statewide — the
   * screen showing one figure and the receipt carrying another is a defect
   * that lives entirely in the wiring between them.
   *
   * It also holds the part that is a security property rather than a
   * correctness one: the endpoint takes the taxpayer and looks the place up
   * itself. If it accepted an LGA from the client, an agent could quote a
   * trader at whichever Council's figure suited them, and the quote is what
   * the trader agrees to before paying.
   */
  let agentToken: string;
  let deviceId: string;

  before(async () => {
    // The demo agent is approved by an administrator, so one has to exist
    // first — `seedDemoAgent` returns null rather than inventing an approver.
    await createGovernmentUser({
      fullName: 'Per-LGA Approver',
      phone: '+2348000000001',
      role: 'admin',
    });
    const agent = await seedDemoAgent();
    assert.ok(agent, 'the demo agent should seed');
    deviceId = agent!.deviceIdentifier;
    agentToken = (await loginAs(agent!.phone, agent!.password, deviceId)).accessToken;
  });

  it('resolves the Council from the taxpayer, over the wire', async () => {
    const here = await taxpayerIn(dearLga.id, '100011');
    const there = await taxpayerIn(cheapLga.id, '100012');

    const dear = await post(
      '/revenue/quote',
      { revenueItemId: itemId, inputs: {}, taxpayerId: here },
      { token: agentToken, deviceId },
    );
    const cheap = await post(
      '/revenue/quote',
      { revenueItemId: itemId, inputs: {}, taxpayerId: there },
      { token: agentToken, deviceId },
    );

    assert.equal(dear.status, 200, JSON.stringify(dear.body));
    assert.equal(cheap.status, 200, JSON.stringify(cheap.body));
    assert.equal(dear.body.amountKobo, kobo(750));
    assert.equal(cheap.body.amountKobo, kobo(200));
  });

  it('refuses the item where the Council has no rate, rather than guessing one', async () => {
    const streetNaming = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM revenue_items WHERE code = 'STREET-NAMING'`,
    );
    const jos = await queryOne<{ id: string }>(pool, `SELECT id FROM lgas WHERE name = 'Jos North'`);
    const taxpayer = await taxpayerIn(jos!.id, '100013');

    const response = await post(
      '/revenue/quote',
      { revenueItemId: streetNaming!.id, inputs: {}, taxpayerId: taxpayer },
      { token: agentToken, deviceId },
    );
    assert.equal(response.body.error?.code, 'NO_EFFECTIVE_RATE', JSON.stringify(response.body));
  });

  it('will not let the caller name the Council itself', async () => {
    // A client-supplied lgaId is not in the schema, so it is ignored rather
    // than honoured — the taxpayer's own LGA decides.
    const here = await taxpayerIn(dearLga.id, '100014');
    const response = await post(
      '/revenue/quote',
      { revenueItemId: itemId, inputs: {}, taxpayerId: here, lgaId: cheapLga.id },
      { token: agentToken, deviceId },
    );
    assert.equal(
      response.body.amountKobo,
      kobo(750),
      'a caller chose which Council’s rate to be quoted',
    );
  });
});
