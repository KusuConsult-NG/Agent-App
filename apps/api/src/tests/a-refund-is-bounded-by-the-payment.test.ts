/**
 * What a refund may be for, and who is told about it.
 *
 * A reversal is requested, approved and executed by three different officers,
 * and the amount travels between them in the approval's `payload` — a free-form
 * JSON column with no schema. `recordReversal` read `payload.amountKobo`
 * straight into the refund row, and `refunds.amount_kobo` asks only that it be
 * positive. Nothing anywhere compared it to the payment being reversed. A
 * request naming ten million naira against a two thousand naira collection was
 * a well-formed request, and the platform recorded that the State owed it and
 * asked the gateway for it.
 *
 * `refund_type` had the same shape of gap from the other end. PARTIAL is one
 * of three types the column allows, and the execution path honours exactly one
 * of the three: whatever the type, the receipt is voided, the transaction is
 * reversed and the whole commission is clawed back. So a partial refund — the
 * ordinary case of a taxpayer who overpaid by two thousand on a ten thousand
 * bill — would return the two thousand and tell every future verification that
 * the ten thousand payment had been reversed, while eight thousand of it sat
 * with the State.
 *
 * And through all of it the taxpayer is told nothing. There is a notification
 * for a payment that succeeded, one for a payment that failed, one for an
 * agent whose bank account somebody asked to change — and none for the money
 * the State took, reversed, and either did or did not give back. The platform's
 * own rule for the bank account change is that the person finds out while it is
 * still a proposal. A citizen whose receipt has just been voided deserves at
 * least to be told it happened.
 */

import './env';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent = { token: '', device: '' };
let requester = '';
let approver = '';
let executor = '';
const EXECUTOR_PHONE = '+2348000000523';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Refund Admin', phone: '+2348000000520', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Refund Requester',
    phone: '+2348000000521',
    role: 'revenue_officer',
  });
  await createGovernmentUser({
    fullName: 'Refund Finance One',
    phone: '+2348000000522',
    role: 'finance_officer',
  });
  await createGovernmentUser({
    fullName: 'Refund Finance Two',
    phone: EXECUTOR_PHONE,
    role: 'finance_officer',
  });
  requester = (await loginAs('+2348000000521')).accessToken;
  approver = (await loginAs('+2348000000522')).accessToken;
  executor = (await loginAs(EXECUTOR_PHONE)).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/** A collection taken through to a verified payment. */
async function collect(suffix: string) {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Refund',
      lastName: `Subject${suffix}`,
      phone: `+23480222${suffix.padStart(5, '0')}`,
      address: '3 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `rf-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `rf-as-${suffix}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `rf-pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );

  const paid = await queryOne<{ amount_kobo: string }>(
    pool,
    `SELECT amount_kobo FROM payments WHERE transaction_id = $1 AND status = 'VERIFIED'`,
    [assessment.body.transactionId],
  );
  return {
    transactionId: assessment.body.transactionId as string,
    taxpayerId: taxpayer.body.taxpayerId as string,
    taxpayerPhone: `+23480222${suffix.padStart(5, '0')}`,
    paidKobo: BigInt(paid!.amount_kobo),
  };
}

async function grantStepUp() {
  const otp = await post(
    '/auth/otp/request',
    { destination: EXECUTOR_PHONE, purpose: 'STEP_UP' },
    { token: executor },
  );
  await post(
    '/auth/step-up',
    {
      action: 'payment.reversal.approve',
      destination: EXECUTOR_PHONE,
      code: otp.body.developmentCode,
    },
    { token: executor },
  );
}

/** Request, approve and execute a reversal with a payload of our choosing. */
async function reverse(transactionId: string, payload: Record<string, unknown>) {
  const request = await post(
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: transactionId,
      payload,
      reason: 'Duplicate assessment for the same premises in this period.',
    },
    { token: requester },
  );
  assert.equal(request.status, 201, JSON.stringify(request.body));

  const approved = await post(
    `/government/approvals/${request.body.approvalId}/decide`,
    { decision: 'APPROVE', reason: 'Duplicate confirmed against the record.' },
    { token: approver },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  await grantStepUp();
  return post(
    `/government/approvals/${request.body.approvalId}/execute-reversal`,
    {},
    { token: executor },
  );
}

const refundRow = (transactionId: string) =>
  queryOne<{ amount_kobo: string; status: string; refund_type: string }>(
    pool,
    'SELECT amount_kobo, status, refund_type FROM refunds WHERE transaction_id = $1',
    [transactionId],
  );

describe('the amount a refund may be for', () => {
  it('cannot be more than the payment it reverses', async () => {
    const collected = await collect('1');
    const absurd = collected.paidKobo * 5000n;

    const result = await reverse(collected.transactionId, {
      amountKobo: absurd.toString(),
      reason: 'Taxpayer charged in error',
      refundType: 'REVERSAL',
    });

    assert.equal(
      result.status,
      409,
      'the State recorded that it owed a taxpayer five thousand times what they paid',
    );
    assert.match(
      result.body.error.message,
      /in full|payment of/i,
      `and an officer should be told why, not handed a database error: ${JSON.stringify(result.body)}`,
    );
    assert.equal(await refundRow(collected.transactionId), null, 'and no refund stands');

    const transaction = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM transactions WHERE id = $1',
      [collected.transactionId],
    );
    assert.notEqual(transaction!.status, 'REVERSED', 'nor was the payment reversed on the strength of it');
  });

  it('cannot be less than it either, because everything else is all-or-nothing', async () => {
    const collected = await collect('2');
    const result = await reverse(collected.transactionId, {
      amountKobo: (collected.paidKobo - 1n).toString(),
      reason: 'Taxpayer charged in error',
      refundType: 'REVERSAL',
    });
    assert.notEqual(
      result.status,
      200,
      'the receipt is voided and the commission clawed back either way, so returning less ' +
        'leaves the State holding part of a payment it has declared reversed',
    );
    assert.equal(await refundRow(collected.transactionId), null);
  });

  it('is held to it by the database as well', async () => {
    // The service is one path to a refund row. The rule is about money, so it
    // lives where the money is: a row inserted any other way meets it too.
    const collected = await collect('8');
    const payment = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM payments WHERE transaction_id = $1 AND status = 'VERIFIED'`,
      [collected.transactionId],
    );
    const officer = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      '+2348000000521',
    ]);
    const approval = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO approvals (approval_type, entity_type, entity_id, payload, requested_by,
                              requested_reason, status)
       VALUES ('PAYMENT_REVERSAL','transaction',$1,'{}'::jsonb,$2,'Direct insert test','REQUESTED')
       RETURNING id`,
      [collected.transactionId, officer!.id],
    );
    const approverRow = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      '+2348000000522',
    ]);

    await assert.rejects(
      pool.query(
        `INSERT INTO refunds (refund_reference, transaction_id, payment_id, amount_kobo,
                              refund_type, reason, approval_id, requested_by, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,'REVERSAL','Direct insert',$5,$6,$7,now())`,
        [
          `RFD-DIRECT-${Date.now()}`,
          collected.transactionId,
          payment!.id,
          (collected.paidKobo + 1n).toString(),
          approval!.id,
          officer!.id,
          approverRow!.id,
        ],
      ),
      /exceeds/i,
    );
  });

  it('defaults to the payment when the request names no amount', async () => {
    const collected = await collect('3');
    const result = await reverse(collected.transactionId, {
      reason: 'Taxpayer charged in error',
      refundType: 'REVERSAL',
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal((await refundRow(collected.transactionId))!.amount_kobo, collected.paidKobo.toString());
  });
});

describe('a refund the platform cannot actually carry out', () => {
  it('refuses a partial refund rather than voiding the whole receipt for it', async () => {
    const collected = await collect('4');

    const result = await reverse(collected.transactionId, {
      amountKobo: (collected.paidKobo / 5n).toString(),
      reason: 'Taxpayer overpaid',
      refundType: 'PARTIAL',
    });

    assert.notEqual(
      result.status,
      200,
      'a fifth of the money came back and the whole receipt was voided for it',
    );

    const receipt = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM receipts WHERE transaction_id = $1',
      [collected.transactionId],
    );
    assert.notEqual(receipt!.status, 'REVERSED', 'the receipt still stands for what was paid');
  });

  it('says so on the type, not only on the arithmetic', async () => {
    // A partial refund for the whole amount is not a partial refund, but it is
    // what an officer who meant to make one would send once the amount rule
    // pushed them into it. The refusal has to be about the thing they asked
    // for, or they will keep trying to express it another way.
    const collected = await collect('9');
    const result = await reverse(collected.transactionId, {
      amountKobo: collected.paidKobo.toString(),
      reason: 'Taxpayer overpaid',
      refundType: 'PARTIAL',
    });

    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.match(result.body.error.message, /partial/i);
    assert.equal(await refundRow(collected.transactionId), null);
  });
});

describe('telling the taxpayer', () => {
  const notifications = async (transactionId: string) =>
    (
      await queryOne<{ events: string; recipients: string }>(
        pool,
        `SELECT COALESCE(string_agg(DISTINCT event, ','), '') AS events,
                COALESCE(string_agg(DISTINCT recipient, ','), '') AS recipients
           FROM notifications WHERE entity_id = $1`,
        [transactionId],
      )
    )!;

  it('says the payment was reversed and the money is coming', async () => {
    const collected = await collect('5');
    const result = await reverse(collected.transactionId, {
      amountKobo: collected.paidKobo.toString(),
      reason: 'Taxpayer charged in error',
      refundType: 'REVERSAL',
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));

    const sent = await notifications(collected.transactionId);
    assert.match(
      sent.events,
      /PAYMENT_REVERSED/,
      'the citizen’s receipt was voided and nothing told them',
    );
    assert.match(sent.recipients, new RegExp(collected.taxpayerPhone.replace('+', '\\+')));
  });

  it('says so again when the money is actually back', async () => {
    const collected = await collect('6');
    await reverse(collected.transactionId, {
      amountKobo: collected.paidKobo.toString(),
      reason: 'Taxpayer charged in error',
      refundType: 'REVERSAL',
    });

    const refund = await refundRow(collected.transactionId);
    assert.equal(refund!.status, 'COMPLETED', JSON.stringify(refund));
    assert.match((await notifications(collected.transactionId)).events, /REFUND_COMPLETED/);
  });
});

describe('what the finance officer is shown', () => {
  it('counts the refunds that exist, not the ones the column cannot hold', async () => {
    const collected = await collect('7');
    await reverse(collected.transactionId, {
      amountKobo: collected.paidKobo.toString(),
      reason: 'Taxpayer charged in error',
      refundType: 'REVERSAL',
    });
    // Left where an unreachable gateway leaves it: owed, attempted, not paid.
    await pool.query(`UPDATE refunds SET status = 'FAILED' WHERE transaction_id = $1`, [
      collected.transactionId,
    ]);

    const home = await get('/government/home', { token: approver });
    assert.equal(home.status, 200, JSON.stringify(home.body));
    assert.equal(
      Number(home.body.finance.refunds_outstanding),
      1,
      'the tile counted PENDING and APPROVED — and APPROVED is not a status a refund can have, ' +
        'so a refund the gateway refused appeared on no screen a person reads',
    );
  });
});

/**
 * Every message the platform sends has something to send.
 *
 * `queueNotification` looks the event up in `notification_templates`, writes a
 * row for each template it finds, and returns how many it wrote. With no
 * template it finds nothing, writes nothing and returns zero — no error, no
 * warning, and the caller carries on. So an event added in code and never
 * given a template is a message nobody ever receives, and nothing anywhere
 * says so.
 *
 * That is how the reversal notice would have failed if its templates had gone
 * into the reference seed instead of a migration: `npm run migrate` without a
 * re-seed, and a citizen's receipt is voided in silence exactly as before.
 *
 * Checked against the database rather than the source, because templates
 * legitimately come from two places — the seed and, for anything a deployment
 * must not be able to miss, a migration.
 */
describe('every notification the code sends', () => {
  it('has an active template to send', async () => {
    const sources = readdirSync(join('src', 'services'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(join('src', 'services', file), 'utf8'));
    const queued = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/event:\s*'([A-Z][A-Z0-9_]+)'/g)) queued.add(match[1]!);
    }
    assert.ok(queued.size > 10, 'the scan should find the events the services queue');

    const templated = new Set(
      (
        await query<{ event: string }>(
          pool,
          `SELECT DISTINCT event FROM notification_templates WHERE status = 'ACTIVE'`,
        )
      ).map((row) => row.event),
    );

    const silent = [...queued].filter((event) => !templated.has(event)).sort();
    assert.deepEqual(
      silent,
      [],
      'these events are queued by the services and have no active template, so queueing one ' +
        'writes nothing and says nothing:\n  ' + silent.join('\n  '),
    );
  });
});
