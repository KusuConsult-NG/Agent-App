/**
 * A bill raised in error, and the two people it takes to withdraw it.
 *
 * An agent who charges a trader twice for one levy left a debt nobody could
 * take back. Three things cancel an invoice — an objection upheld, a PAYE
 * return withdrawn, a reversal the State caused — and an unpaid duplicate is
 * none of them. Before this, asking for it was refused at the door: the
 * approvals route did not know the kind of request.
 *
 * Now it is an approval like a reversal: asked by somebody who may issue
 * bills, granted by somebody else, carried out only when granted, and refused
 * by name where withdrawing would be wrong.
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
import { computeComplianceScore } from '../services/incentives';

let agent: { token: string; device: string };
let officer = '';
let colleague = '';
let finance = '';
let administrator = '';
let sequence = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Withdraw Admin', phone: '+2348036200001', role: 'admin' });
  await createGovernmentUser({ fullName: 'Asking Officer', phone: '+2348036200002', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Deciding Officer', phone: '+2348036200003', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Finance Officer', phone: '+2348036200004', role: 'finance_officer' });
  officer = (await loginAs('+2348036200002')).accessToken;
  colleague = (await loginAs('+2348036200003')).accessToken;
  finance = (await loginAs('+2348036200004')).accessToken;
  administrator = (await loginAs('+2348036200001')).accessToken;
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  sequence = 0;
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });
const key = (label: string) => `wd-${label}-${++sequence}`;

/** A trader charged twice for the same shop rate. */
async function chargedTwice() {
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Twice',
      lastName: `Charged${sequence}`,
      phone: `+23481053${String(++sequence).padStart(5, '0')}`,
      address: '3 Ahmadu Bello Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...asAgent(), idempotencyKey: key('tp') },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  const item = await revenueItemByCode('SHOPS-KIOSKS');
  const first = await post(
    '/revenue/assessments',
    { taxpayerId: taxpayer.body.taxpayerId, revenueItemId: item, inputs: {} },
    { ...asAgent(), idempotencyKey: key('as') },
  );
  const second = await post(
    '/revenue/assessments',
    { taxpayerId: taxpayer.body.taxpayerId, revenueItemId: item, inputs: {} },
    { ...asAgent(), idempotencyKey: key('as') },
  );
  assert.equal(second.status, 201, JSON.stringify(second.body));
  return { taxpayerId: taxpayer.body.taxpayerId as string, first: first.body, duplicate: second.body };
}

const ask = (invoiceId: string, token = officer) =>
  post(
    '/government/approvals',
    {
      approvalType: 'INVOICE_WITHDRAWAL',
      entityType: 'invoice',
      entityId: invoiceId,
      payload: {},
      reason: 'Raised twice for the same shop in the same period; the second press timed out.',
    },
    { token },
  );

const decide = (approvalId: string, decision: 'APPROVE' | 'REJECT', token = colleague) =>
  post(
    `/government/approvals/${approvalId}/decide`,
    { decision, reason: 'Checked against the first charge on the record.' },
    { token },
  );

const invoiceStatus = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM invoices WHERE id = $1', [id]))!.status;
const transactionStatus = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM transactions WHERE id = $1', [id]))!.status;

describe('a duplicate charge', () => {
  it('is withdrawn once a second officer grants it, and not before', async () => {
    const { taxpayerId, first, duplicate } = await chargedTwice();

    const asked = await ask(duplicate.invoiceId);
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.equal(await invoiceStatus(duplicate.invoiceId), 'UNPAID', 'asking changes nothing');

    // The officer who asked cannot grant it.
    const self = await decide(asked.body.approvalId, 'APPROVE', officer);
    assert.equal(self.status, 403, JSON.stringify(self.body));
    assert.equal(await invoiceStatus(duplicate.invoiceId), 'UNPAID');

    const granted = await decide(asked.body.approvalId, 'APPROVE');
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.equal(granted.body.status, 'EXECUTED');

    assert.equal(await invoiceStatus(duplicate.invoiceId), 'CANCELLED');
    assert.equal(await transactionStatus(duplicate.transactionId), 'CANCELLED');
    assert.equal(await invoiceStatus(first.invoiceId), 'UNPAID', 'the real charge stands');

    const approval = await queryOne<{ status: string; executed_at: Date | null }>(
      pool,
      'SELECT status, executed_at FROM approvals WHERE id = $1',
      [asked.body.approvalId],
    );
    assert.equal(approval?.status, 'EXECUTED');
    assert.ok(approval?.executed_at);

    const audit = await queryOne<{ reason: string }>(
      pool,
      `SELECT reason FROM audit_logs WHERE action = 'invoice.withdrawn' AND entity_id = $1`,
      [duplicate.invoiceId],
    );
    assert.match(audit?.reason ?? '', /second press timed out/);

    // No longer owed: off the trader's list, and not counted against them.
    const owed = await get(`/revenue/taxpayers/${taxpayerId}/obligations`, asAgent());
    assert.deepEqual(
      (owed.body as { invoice_id: string }[]).map((row) => row.invoice_id),
      [first.invoiceId],
    );
    const client = await pool.connect();
    try {
      const score = await computeComplianceScore(client, taxpayerId);
      assert.ok(
        score.components.some((c) => /0 of 1 assessment period|of 1 /.test(c.detail)),
        `one charge raised, not two: ${JSON.stringify(score.components)}`,
      );
    } finally {
      client.release();
    }
  });

  it('stands when the request is rejected', async () => {
    const { duplicate } = await chargedTwice();
    const asked = await ask(duplicate.invoiceId);
    const rejected = await decide(asked.body.approvalId, 'REJECT');
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(await invoiceStatus(duplicate.invoiceId), 'UNPAID');
    assert.equal(await transactionStatus(duplicate.transactionId), 'INVOICE_GENERATED');
  });

  it('is withdrawn after it has lapsed, and then cannot be issued again', async () => {
    const { duplicate } = await chargedTwice();
    await pool.query(`UPDATE invoices SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      duplicate.invoiceId,
    ]);
    const asked = await ask(duplicate.invoiceId);
    assert.equal((await decide(asked.body.approvalId, 'APPROVE')).status, 200);
    assert.equal(await invoiceStatus(duplicate.invoiceId), 'CANCELLED');

    const reissued = await post(
      `/revenue/invoices/${duplicate.invoiceId}/reissue`,
      {},
      { ...asAgent(), idempotencyKey: key('re') },
    );
    assert.equal(reissued.status, 409, JSON.stringify(reissued.body));
    assert.equal(reissued.body.error.code, 'INVOICE_WITHDRAWN');
  });
});

describe('what is not withdrawn', () => {
  async function paid() {
    const { duplicate } = await chargedTwice();
    const started = await post(
      '/payments/initiate',
      { transactionId: duplicate.transactionId },
      { ...asAgent(), idempotencyKey: key('pay') },
    );
    return { duplicate, gatewayReference: started.body.gatewayReference as string };
  }

  it('a bill that has been paid', async () => {
    const { duplicate, gatewayReference } = await paid();
    await post('/payments/simulate', { gatewayReference, outcome: 'SUCCESS', deliverWebhook: true }, asAgent());
    const refused = await ask(duplicate.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_ALREADY_PAID');
  });

  it('a bill somebody is paying', async () => {
    const { duplicate } = await paid();
    const refused = await ask(duplicate.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_PAYMENT_IN_PROGRESS');
  });

  it('a bill paid between the asking and the granting', async () => {
    const { duplicate } = await chargedTwice();
    const asked = await ask(duplicate.invoiceId);
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    const started = await post(
      '/payments/initiate',
      { transactionId: duplicate.transactionId },
      { ...asAgent(), idempotencyKey: key('pay') },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: started.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      asAgent(),
    );

    const refused = await decide(asked.body.approvalId, 'APPROVE');
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_ALREADY_PAID');
    assert.equal(await invoiceStatus(duplicate.invoiceId), 'PAID');
    const approval = await queryOne<{ status: string }>(pool, 'SELECT status FROM approvals WHERE id = $1', [
      asked.body.approvalId,
    ]);
    assert.equal(approval?.status, 'REQUESTED', 'the decision did not happen, and can still be a rejection');
  });

  it('a bill already withdrawn', async () => {
    const { duplicate } = await chargedTwice();
    await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [duplicate.invoiceId]);
    const refused = await ask(duplicate.invoiceId);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_WITHDRAWN');
  });

  it('a second request while the first is waiting', async () => {
    const { duplicate } = await chargedTwice();
    assert.equal((await ask(duplicate.invoiceId)).status, 201);
    const again = await ask(duplicate.invoiceId, colleague);
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.match(again.body.error.message, /already waiting for a decision/);
  });

  it('a request that names something other than an invoice', async () => {
    const { duplicate } = await chargedTwice();
    const wrong = await post(
      '/government/approvals',
      {
        approvalType: 'INVOICE_WITHDRAWAL',
        entityType: 'transaction',
        entityId: duplicate.transactionId,
        payload: {},
        reason: 'Raised twice for the same shop in the same period.',
      },
      { token: officer },
    );
    assert.equal(wrong.status, 400, JSON.stringify(wrong.body));
  });

  it('a request from somebody who may ask for approvals but does not issue bills', async () => {
    // The administrator holds approval:request and not invoice:create, which
    // makes it the role this rule is about; a finance officer could not ask
    // for any approval at all, so refusing one would prove nothing here.
    const { duplicate } = await chargedTwice();
    const refused = await ask(duplicate.invoiceId, administrator);
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.match(refused.body.error.message, /invoice:create/);
  });

  it('a request from somebody who may not ask for approvals at all', async () => {
    const { duplicate } = await chargedTwice();
    const refused = await ask(duplicate.invoiceId, finance);
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
  });
});
