/**
 * A month closed over bills that were still running.
 *
 * Every bill has thirty days to be paid, so a month is always closed with some
 * of its bills still open; the close waits for unresolved exceptions and
 * pending payments, not for those. Migration 058 locked every transaction
 * raised in a closed month against any write at all, and so locked the open
 * bills with the money. Measured, with last month closed over one of its bills
 * still unpaid and in date:
 *
 *   - paying it was refused, 409, "… is closed; the transactions in it cannot
 *     be changed", so a bill the taxpayer was entitled to pay could not be
 *     taken by anybody;
 *   - the expiry sweep threw on it and stopped, and because it works in
 *     deadline order, every lapsed bill behind it — this month's included —
 *     stayed UNPAID;
 *   - and every way of ending the bill (withdrawn, issued again, an objection
 *     upheld) closes its charge, and was refused the same way.
 *
 * What a close counts is the month's transactions in a revenue-recognised
 * state. Migration 093 keeps those frozen whole, as before, and lets a bill
 * the close did not count change in any way that keeps it out of the count.
 * Paying an old bill would add to it, so that bill is issued again into an
 * open month first — same amount, same deadline.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REVENUE_RECOGNISED_STATES } from '@psirs/shared';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { expireLapsedInvoices, getObligations } from '../services/revenue';

let agent = { token: '', device: '' };
let taxpayerId = '';
let revenueItemId = '';
let sequence = 0;
const CLOSED = 'Last month';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: '+2348030009401', fullName: 'Records Admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1');
  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM revenue_items WHERE code = 'DEV-LEVY' AND status = 'ACTIVE' LIMIT 1`,
  );
  revenueItemId = item!.id;
  const registered = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Lami',
      lastName: 'Gyang',
      phone: '+2348037009411',
      address: '12 Bukuru Expressway, Jos',
      lgaId: lga!.id,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...asAgent(), idempotencyKey: 'closed-month-taxpayer' },
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  taxpayerId = registered.body.taxpayerId;
  sequence = 0;
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });

/** A fresh bill, as the agent raises one. */
async function raise() {
  sequence += 1;
  const assessed = await post(
    '/revenue/assessments',
    { taxpayerId, revenueItemId, inputs: {} },
    { ...asAgent(), idempotencyKey: `closed-month-bill-${sequence}` },
  );
  assert.equal(assessed.status, 201, JSON.stringify(assessed.body));
  return assessed.body as { invoiceId: string; transactionId: string };
}

function lastMonth() {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
    // Mid-month, so no question of which calendar the day falls on.
    during: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 10)),
  };
}

/**
 * Move a charge into last month, which is when it was raised for the purpose
 * of the test. `created_at` is immutable, so the trigger that says so comes off
 * for the one statement that fakes the clock.
 */
async function raisedLastMonth(transactionId: string) {
  await query(pool, 'ALTER TABLE transactions DISABLE TRIGGER transactions_immutable');
  try {
    await query(pool, 'UPDATE transactions SET created_at = $2 WHERE id = $1', [
      transactionId,
      lastMonth().during,
    ]);
  } finally {
    await query(pool, 'ALTER TABLE transactions ENABLE TRIGGER transactions_immutable');
  }
}

async function closeLastMonth() {
  const admin = await queryOne<{ id: string }>(pool, `SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  await query(
    pool,
    `INSERT INTO financial_periods (label, period_start, period_end, status, closed_at, closed_by, closing_note)
     VALUES ($1, $2, $3, 'CLOSED', now(), $4, 'Reconciled and reported.')`,
    [CLOSED, lastMonth().start, lastMonth().end, admin!.id],
  );
}

const stateOf = (transactionId: string) =>
  queryOne<{ transaction: string; invoice: string }>(
    pool,
    `SELECT t.status AS transaction, i.status AS invoice
       FROM transactions t JOIN invoices i ON i.id = t.invoice_id WHERE t.id = $1`,
    [transactionId],
  );

describe('a bill still open when its month was closed', () => {
  it('is taken by issuing it again into an open month, for the same amount and deadline', async () => {
    const bill = await raise();
    await raisedLastMonth(bill.transactionId);
    await closeLastMonth();

    const listed = (await getObligations(pool, taxpayerId)) as {
      invoice_id: string;
      needs_reissue: boolean;
      period_closed: string | null;
    }[];
    const row = listed.find((entry) => entry.invoice_id === bill.invoiceId);
    assert.deepEqual(
      { needs_reissue: row?.needs_reissue, period_closed: row?.period_closed },
      { needs_reissue: true, period_closed: CLOSED },
      'the list offered a payment the server would refuse',
    );

    // Refused before the gateway is asked for anything.
    const paying = await post(
      '/payments/initiate',
      { transactionId: bill.transactionId, paymentMethod: 'POS' },
      { ...asAgent(), idempotencyKey: 'closed-month-pay' },
    );
    assert.equal(paying.status, 409, JSON.stringify(paying.body));
    assert.equal(paying.body.error.code, 'INVOICE_PERIOD_CLOSED');
    assert.equal(paying.body.error.moneyStatus, 'NOT_DEBITED');
    const attempts = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM payments WHERE transaction_id = $1',
      [bill.transactionId],
    );
    assert.equal(attempts?.n, '0', 'an attempt was started that could never be recorded');

    const old = await queryOne<{ expires_at: Date }>(pool, 'SELECT expires_at FROM invoices WHERE id = $1', [
      bill.invoiceId,
    ]);
    const issued = await post(
      `/revenue/invoices/${bill.invoiceId}/reissue`,
      {},
      { ...asAgent(), idempotencyKey: 'closed-month-reissue' },
    );
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    const replacement = await queryOne<{ expires_at: Date; total_amount_kobo: string }>(
      pool,
      'SELECT expires_at, total_amount_kobo FROM invoices WHERE id = $1',
      [issued.body.invoiceId],
    );
    assert.equal(
      replacement?.expires_at.getTime(),
      old?.expires_at.getTime(),
      'the taxpayer was given a new deadline for the State’s book-keeping',
    );
    // It did not lapse; it was moved.
    assert.deepEqual(await stateOf(bill.transactionId), { transaction: 'CANCELLED', invoice: 'CANCELLED' });

    const started = await post(
      '/payments/initiate',
      { transactionId: issued.body.transactionId, paymentMethod: 'POS' },
      { ...asAgent(), idempotencyKey: 'closed-month-pay-again' },
    );
    assert.equal(started.status, 201, JSON.stringify(started.body));
    await post(
      '/payments/simulate',
      { gatewayReference: started.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      asAgent(),
    );
    assert.equal((await stateOf(issued.body.transactionId))?.invoice, 'PAID');
  });

  it('lapses, and does not stop the sweep for every bill behind it', async () => {
    const old = await raise();
    await raisedLastMonth(old.transactionId);
    await closeLastMonth();
    const recent = await raise();
    await query(pool, `UPDATE invoices SET expires_at = now() - interval '2 days' WHERE id = $1`, [old.invoiceId]);
    await query(pool, `UPDATE invoices SET expires_at = now() - interval '1 day' WHERE id = $1`, [
      recent.invoiceId,
    ]);

    const swept = await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
    assert.equal(swept.expired, 2, 'the sweep stopped at the bill from the closed month');
    assert.deepEqual(await stateOf(old.transactionId), { transaction: 'EXPIRED', invoice: 'EXPIRED' });
    assert.deepEqual(await stateOf(recent.transactionId), { transaction: 'EXPIRED', invoice: 'EXPIRED' });
  });
});

describe('what a closed month still locks', () => {
  /** Charges raised last month, each put in the state given, then the month closed. */
  async function closedWith(...statuses: string[]) {
    const ids: string[] = [];
    for (const status of statuses) {
      const bill = await raise();
      await raisedLastMonth(bill.transactionId);
      await query(pool, 'UPDATE transactions SET status = $2 WHERE id = $1', [bill.transactionId, status]);
      ids.push(bill.transactionId);
    }
    await closeLastMonth();
    return ids;
  }
  const move = (id: string, to: string) =>
    query(pool, 'UPDATE transactions SET status = $2 WHERE id = $1', [id, to]);
  const locked = /is closed; the transactions in it cannot be changed/;

  it('refuses money arriving into it, or leaving it', async () => {
    const [pending, receipted] = await closedWith('PAYMENT_PENDING', 'RECEIPT_GENERATED');
    await assert.rejects(move(pending!, 'PAYMENT_VERIFIED'), locked);
    await assert.rejects(move(receipted!, 'REVERSED'), locked);
  });

  it('keeps a row it counted frozen whole, as before', async () => {
    // Even a move that changes no figure: what the close counted is a record
    // somebody signed, and correcting it is what reopening the month is for.
    const [id] = await closedWith('RECONCILIATION_PENDING');
    await assert.rejects(move(id!, 'RECEIPT_GENERATED'), locked);
  });

  it('lets a charge that took nothing be cancelled', async () => {
    const [id] = await closedWith('INVOICE_GENERATED');
    await move(id!, 'CANCELLED');
    assert.equal((await stateOf(id!))?.transaction, 'CANCELLED');
  });

  it('counts revenue by the same states the close does', async () => {
    // The trigger spells the states out; the close reads them from the shared
    // package. If one changes without the other the lock guards the wrong rows.
    const source = await queryOne<{ def: string }>(
      pool,
      `SELECT pg_get_functiondef('refuse_change_to_a_shut_months_revenue'::regproc) AS def`,
    );
    const listed = /ARRAY\[([^\]]*)\]/.exec(source!.def)![1]!
      .split(',')
      .map((state) => state.trim().replace(/^'|'(::text)?$/g, ''))
      .sort();
    assert.deepEqual(listed, [...REVENUE_RECOGNISED_STATES].sort());
  });
});
