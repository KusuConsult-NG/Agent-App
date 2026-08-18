/**
 * The invoice a taxpayer takes away, and who may see it.
 *
 * TWO THINGS.
 *
 * 1. NOTHING COULD PRODUCE THE INVOICE. `POST /revenue/invoices/:id/document`
 *    renders the full PDF — number, amounts, verification code, computation
 *    trace — and had no caller in either application. That matters because of
 *    the collection model: the Remita reference is payable at any bank branch,
 *    ATM, POS or USSD channel, possibly days later. An agent whose taxpayer
 *    said "I will pay at the bank tomorrow" read a reference aloud and hoped
 *    they wrote it down.
 *
 * 2. `invoice:read:own` ENFORCED NOTHING. Both invoice routes are guarded by
 *    `requirePermission('invoice:read:own', 'invoice:read:all')` and then
 *    filtered by neither. An agent holding only the `:own` permission could
 *    fetch any invoice by id — another agent's taxpayer, their name, TIN,
 *    amounts and computation trace — or mint a PDF of it. The permission was
 *    named for a scope the query never applied.
 *
 * The second was found while wiring a button to the first, which is the reason
 * the button is worth being careful about: exposing an endpoint is when its
 * access control stops being theoretical.
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
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string };
let officer = '';
let invoiceId = '';
let transactionReference = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Invoice Admin', phone: '+2348000000090', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Invoice Officer',
    phone: '+2348000000091',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348000000091')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Invoice',
      lastName: 'Subject',
      phone: '+2348099900011',
      address: '8 Market Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'inv-tp' },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 'inv-as' },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  transactionReference = assessment.body.transactionReference;

  const row = await queryOne<{ invoice_id: string }>(
    pool,
    'SELECT invoice_id FROM transactions WHERE id = $1',
    [assessment.body.transactionId],
  );
  invoiceId = row!.invoice_id;
});

describe('An agent can hand the taxpayer something to pay against', () => {
  it('renders the invoice and returns somewhere to get it', async () => {
    const response = await post(
      `/revenue/invoices/${invoiceId}/document`,
      {},
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.match(response.body.documentNumber, /PSIRS-INV/);
    assert.ok(response.body.downloadUrl, 'the agent needs somewhere to send the taxpayer');
  });

  it('issues one invoice for one obligation, however many times it is asked', async () => {
    // An agent who taps twice, or returns to the transaction tomorrow, must not
    // hand out a second document for the same debt.
    const first = await post(
      `/revenue/invoices/${invoiceId}/document`,
      {},
      { token: agent.token, deviceId: agent.device },
    );
    const second = await post(
      `/revenue/invoices/${invoiceId}/document`,
      {},
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(second.body.documentNumber, first.body.documentNumber);

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM documents
        WHERE entity_type = 'invoice' AND entity_id = $1`,
      [invoiceId],
    );
    assert.equal(count?.count, '1');
  });

  it('carries the invoice id on the transaction, so the app can ask for it', async () => {
    const status = await get(`/payments/transactions/${transactionReference}/status`, {
      token: agent.token,
      deviceId: agent.device,
    });
    assert.equal(status.status, 200);
    assert.equal(status.body.transaction.invoice_id, invoiceId);
  });
});

describe('invoice:read:own means the caller’s own', () => {
  it('refuses another agent’s invoice, and does not confirm it exists', async () => {
    // A second agent, cleared the same way, with no connection to this invoice.
    const intruderPhone = '+2347010000002';
    await createGovernmentUser({
      fullName: 'Second Agent User',
      phone: intruderPhone,
      role: 'agent',
    });
    const intruder = await loginAs(intruderPhone);

    const read = await get(`/revenue/invoices/${invoiceId}`, { token: intruder.accessToken });
    assert.equal(
      read.status,
      404,
      'an agent must not read an invoice raised by somebody else — and 404, ' +
        'because whether it exists is the taxpayer’s business',
    );

    const render = await post(
      `/revenue/invoices/${invoiceId}/document`,
      {},
      { token: intruder.accessToken },
    );
    assert.equal(render.status, 404, 'nor mint a PDF of it');

    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM documents
        WHERE entity_type = 'invoice' AND entity_id = $1`,
      [invoiceId],
    );
    assert.equal(count?.count, '0', 'and nothing was rendered on the way to being refused');
  });

  it('lets the agent who raised it through', async () => {
    const read = await get(`/revenue/invoices/${invoiceId}`, {
      token: agent.token,
      deviceId: agent.device,
    });
    assert.equal(read.status, 200, JSON.stringify(read.body));
  });

  it('lets an officer holding invoice:read:all see any invoice', async () => {
    // The wider permission is what officers have, and it is not narrowed.
    const read = await get(`/revenue/invoices/${invoiceId}`, { token: officer });
    assert.equal(read.status, 200, JSON.stringify(read.body));
  });
});
