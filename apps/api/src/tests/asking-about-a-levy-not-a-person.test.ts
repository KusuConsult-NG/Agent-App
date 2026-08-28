/**
 * The questions an officer has that the platform could not answer.
 *
 * Every way into the taxpayer record identified one person you already knew
 * about: a name, a phone, a TIN, a plate, a receipt number, a transaction
 * reference. All useful, all the same shape — you have somebody in front of you
 * and you want their file.
 *
 * The work an officer actually plans is the other way round. Which taxpayers are
 * registered under Development Levy. Who is paying Market Tax in Jos North. How
 * much did each levy raise last month, in this LGA, through this agent. Which of
 * the people assessed under Market Levy have not paid. None of those name a
 * person; they name a levy and ask for the set.
 *
 * The dashboard came closest — it grouped revenue by category — but statewide,
 * for all time, and no further down than the category. Enough for a commissioner
 * reading a total, not enough to decide where to send collectors on Monday.
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
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentAuth: { token: string; deviceId: string };
let officer = '';
let lgaId = '';
let subject = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Levy Admin', phone: '+2348000000060', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Levy Revenue',
    phone: '+2348000000061',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348000000061')).accessToken;
  lgaId = await firstLgaId();

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

/** Assess a taxpayer under one revenue item, optionally taking the money. */
async function assess(itemCode: string, options: { pay?: boolean } = {}) {
  subject += 1;
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Levy',
      lastName: `Subject${subject}`,
      phone: `+2348161${String(subject).padStart(6, '0')}`,
      address: '2 Bauchi Road, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `levy-tp-${subject}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode(itemCode),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `levy-as-${subject}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  if (options.pay) {
    const payment = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId },
      { ...agentAuth, idempotencyKey: `levy-pay-${subject}` },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      agentAuth,
    );
    await settleTransaction(assessment.body.transactionId);
  }

  return {
    taxpayerId: taxpayer.body.taxpayerId as string,
    transactionId: assessment.body.transactionId as string,
    name: `Levy Subject${subject}`,
  };
}

const itemId = (code: string) => revenueItemByCode(code);

async function categoryOf(code: string) {
  const row = await queryOne<{ category_id: string }>(
    pool,
    'SELECT category_id FROM revenue_items WHERE code = $1',
    [code],
  );
  return row!.category_id;
}

describe('Finding everyone registered under a levy', () => {
  it('returns the taxpayers assessed under that item and nobody else', async () => {
    const onMarket = await assess('MARKET-LEVY');
    const onShops = await assess('SHOPS-KIOSKS');

    const found = await get(`/taxpayers/search?revenueItemId=${await itemId('MARKET-LEVY')}`, {
      token: officer,
    });
    assert.equal(found.status, 200, JSON.stringify(found.body));

    const ids = found.body.map((row: { id: string }) => row.id);
    assert.ok(ids.includes(onMarket.taxpayerId), 'the market trader must be in the answer');
    assert.ok(
      !ids.includes(onShops.taxpayerId),
      'and somebody assessed under a different levy must not be',
    );
  });

  it('answers the same question at the category level', async () => {
    // "Who is under Local Government Rates and Fees" rather than one item of it.
    const onShops = await assess('SHOPS-KIOSKS');
    const category = await categoryOf('SHOPS-KIOSKS');

    const found = await get(`/taxpayers/search?categoryId=${category}`, { token: officer });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.ok(
      found.body.some((row: { id: string }) => row.id === onShops.taxpayerId),
      'the category must include its own items',
    );
  });

  it('narrows by LGA, because a levy is collected somewhere', async () => {
    const onMarket = await assess('MARKET-LEVY');
    const elsewhere = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 LIMIT 1',
      [lgaId],
    );

    const here = await get(
      `/taxpayers/search?revenueItemId=${await itemId('MARKET-LEVY')}&lgaId=${lgaId}`,
      { token: officer },
    );
    const there = await get(
      `/taxpayers/search?revenueItemId=${await itemId('MARKET-LEVY')}&lgaId=${elsewhere!.id}`,
      { token: officer },
    );

    assert.ok(
      here.body.some((row: { id: string }) => row.id === onMarket.taxpayerId),
      'the trader is in their own LGA',
    );
    assert.ok(
      !there.body.some((row: { id: string }) => row.id === onMarket.taxpayerId),
      'and not in another one',
    );
  });

  it('takes a filter alone as a search, without any text', async () => {
    /*
     * The guard asked whether any *string* had been supplied, which "everyone
     * with something outstanding" does not satisfy — and that is a legitimate
     * question with no text in it at all.
     */
    await assess('MARKET-LEVY');
    const found = await get('/taxpayers/search?outstandingOnly=true', { token: officer });
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.ok(Array.isArray(found.body));
  });

  it('still refuses a search with no criteria at all', async () => {
    // Otherwise it is not a search, it is a dump of the taxpayer register.
    const refused = await get('/taxpayers/search', { token: officer });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
  });
});

describe('What each levy actually raised', () => {
  it('breaks the total down by category and by item', async () => {
    await assess('MARKET-LEVY', { pay: true });
    await assess('SHOPS-KIOSKS', { pay: true });

    const summary = await get('/government/revenue/by-category', { token: officer });
    assert.equal(summary.status, 200, JSON.stringify(summary.body));

    assert.ok(summary.body.categories.length > 0, 'categories must be reported');
    assert.ok(summary.body.items.length > 0, 'and the items under them');

    const market = summary.body.items.find(
      (row: { code: string }) => row.code === 'MARKET-LEVY',
    );
    assert.ok(market, 'the item that was collected must appear');
    assert.ok(BigInt(market.amount_kobo) > 0n, 'with what it raised');
    assert.equal(market.taxpayers, '1', 'and how many people it came from');
  });

  it('separates what was collected from what the State actually holds', async () => {
    /*
     * The number this platform exists to keep honest. A revenue report that
     * showed only "collected" would be the pre-settlement behaviour in a new
     * place: money the gateway confirmed reported as money government has.
     */
    await assess('MARKET-LEVY', { pay: true });
    const confirmedOnly = await assess('SHOPS-KIOSKS');
    const payment = await post(
      '/payments/initiate',
      { transactionId: confirmedOnly.transactionId },
      { ...agentAuth, idempotencyKey: `levy-unsettled-${subject}` },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      agentAuth,
    );

    const summary = await get('/government/revenue/by-category', { token: officer });
    assert.ok(
      BigInt(summary.body.awaitingSettlementKobo) > 0n,
      'money in transit must be visible as such, not folded into the total',
    );
    assert.equal(
      BigInt(summary.body.totalKobo) -
        BigInt(summary.body.settledKobo) -
        BigInt(summary.body.awaitingSettlementKobo),
      0n,
      'and the three figures must agree with each other',
    );
  });

  it('narrows to one LGA', async () => {
    await assess('MARKET-LEVY', { pay: true });
    const elsewhere = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 LIMIT 1',
      [lgaId],
    );

    const here = await get(`/government/revenue/by-category?lgaId=${lgaId}`, { token: officer });
    const there = await get(`/government/revenue/by-category?lgaId=${elsewhere!.id}`, {
      token: officer,
    });

    assert.ok(BigInt(here.body.totalKobo) > 0n, 'the LGA it was collected in has the money');
    assert.equal(BigInt(there.body.totalKobo), 0n, 'another LGA has none of it');
  });

  it('narrows to a date range', async () => {
    await assess('MARKET-LEVY', { pay: true });
    const lastYear = new Date(Date.now() - 400 * 24 * 60 * 60_000).toISOString();
    const stillLastYear = new Date(Date.now() - 300 * 24 * 60 * 60_000).toISOString();

    const old = await get(
      `/government/revenue/by-category?from=${lastYear}&to=${stillLastYear}`,
      { token: officer },
    );
    assert.equal(BigInt(old.body.totalKobo), 0n, 'a window before the collection contains none');
  });
});

describe('Who has not paid, per levy', () => {
  it('lists the defaulters on one item with what they owe', async () => {
    const owing = await assess('MARKET-LEVY');
    await assess('MARKET-LEVY', { pay: true });

    const report = await get(
      `/government/revenue/defaulters?revenueItemId=${await itemId('MARKET-LEVY')}`,
      { token: officer },
    );
    assert.equal(report.status, 200, JSON.stringify(report.body));

    const names = report.body.rows.map((row: { taxpayer_id: string }) => row.taxpayer_id);
    assert.ok(names.includes(owing.taxpayerId), 'the one who has not paid must be listed');
    assert.equal(report.body.rows.length, 1, 'and the one who has paid must not be');
    assert.ok(BigInt(report.body.outstandingKobo) > 0n, 'with a total that is owed');
  });

  it('does not call somebody a defaulter on a levy they are square on', async () => {
    /*
     * The failure that would make the report useless: a trader who has paid
     * their market levy and is behind on a shop rate appearing on the market
     * levy defaulter list. An officer sent to collect from them would be wrong,
     * and would be told so at the stall.
     */
    const square = await assess('MARKET-LEVY', { pay: true });
    await post(
      '/revenue/assessments',
      {
        taxpayerId: square.taxpayerId,
        revenueItemId: await itemId('SHOPS-KIOSKS'),
        inputs: {},
      },
      { ...agentAuth, idempotencyKey: `levy-second-${subject}` },
    );

    const market = await get(
      `/government/revenue/defaulters?revenueItemId=${await itemId('MARKET-LEVY')}`,
      { token: officer },
    );
    assert.ok(
      !market.body.rows.some((row: { taxpayer_id: string }) => row.taxpayer_id === square.taxpayerId),
      'paid on this levy means not a defaulter on this levy',
    );

    const shops = await get(
      `/government/revenue/defaulters?revenueItemId=${await itemId('SHOPS-KIOSKS')}`,
      { token: officer },
    );
    assert.ok(
      shops.body.rows.some((row: { taxpayer_id: string }) => row.taxpayer_id === square.taxpayerId),
      'and they are a defaulter on the one they have not paid',
    );
  });

  it('is ordered by what is owed, so it can be worked from', async () => {
    await assess('MARKET-LEVY');
    await assess('SHOPS-KIOSKS');

    const report = await get('/government/revenue/defaulters', { token: officer });
    const amounts = report.body.rows.map((row: { outstanding_kobo: string }) =>
      BigInt(row.outstanding_kobo),
    );
    for (let i = 1; i < amounts.length; i += 1) {
      assert.ok(amounts[i - 1] >= amounts[i], 'largest debt first');
    }
  });
});
