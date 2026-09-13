/**
 * The reference an officer is holding, and the story behind it.
 *
 * Two questions the platform could not answer, tested against a real
 * collection driven through the API — taxpayer registered, assessment raised,
 * invoice issued, payment initiated, gateway confirmed, settlement recorded,
 * receipt issued, commission accrued — because a fixture that writes those rows
 * directly would prove the queries run and nothing about whether they describe
 * what actually happened.
 *
 * WHAT IS BEING ASSERTED
 *
 *   * A reference of any kind finds its thing, and the reference for a receipt
 *     and the reference for the transaction that produced it both arrive at the
 *     same place.
 *   * The 360 view assembles the whole chain in one call.
 *   * The timeline interleaves the state machine and the audit log in time
 *     order, which is the thing an auditor cannot do by opening two screens.
 *   * Every section is gated on the permission its own screen requires, and a
 *     section that is withheld says so rather than looking empty.
 *   * A supervisor cannot find, or open, a transaction outside their territory
 *     — and gets "no such transaction" rather than "not yours".
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
import { mergeTimeline } from '../services/investigation';

interface Collected {
  transactionId: string;
  reference: string;
  receiptNumber: string;
  taxpayerId: string;
  paymentReference: string;
}

let collected: Collected;
const tokens: Record<string, string> = {};

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  for (const officer of [
    { fullName: 'Three Sixty Admin', phone: '+2348072000001', role: 'admin' },
    { fullName: 'Three Sixty Finance', phone: '+2348072000002', role: 'finance_officer' },
    { fullName: 'Three Sixty Auditor', phone: '+2348072000003', role: 'auditor' },
    { fullName: 'Three Sixty Supervisor', phone: '+2348072000004', role: 'supervisor' },
    { fullName: 'Three Sixty Revenue', phone: '+2348072000005', role: 'revenue_officer' },
  ]) {
    await createGovernmentUser(officer);
    tokens[officer.role] = (await loginAs(officer.phone)).accessToken;
  }

  collected = await collect();
});

/** One collection, taken the whole way, through the endpoints an agent uses. */
async function collect(): Promise<Collected> {
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      lastName: 'Pamdegu',
      phone: '+2348129900001',
      address: '12 Rwang Pam Street, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 't360-tp' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 't360-as' },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: 't360-pay' },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  await settleTransaction(assessment.body.transactionId);

  const row = await queryOne<{
    transaction_reference: string;
    receipt_number: string;
    payment_reference: string;
  }>(
    pool,
    `SELECT t.transaction_reference, r.receipt_number, p.payment_reference
       FROM transactions t
       JOIN receipts r ON r.transaction_id = t.id
       JOIN payments p ON p.id = r.payment_id
      WHERE t.id = $1`,
    [assessment.body.transactionId],
  );
  assert.ok(row, 'the collection produced a receipt');

  return {
    transactionId: assessment.body.transactionId,
    reference: row!.transaction_reference,
    receiptNumber: row!.receipt_number,
    paymentReference: row!.payment_reference,
    taxpayerId: taxpayer.body.taxpayerId,
  };
}

const auth = (role: string) => ({ token: tokens[role] });

/** Put the supervisor over the territory this collection was taken in. */
async function assignSupervisorToTheCollection(): Promise<void> {
  await pool.query(
    `INSERT INTO user_territories (user_id, territory_id, assigned_by)
     SELECT u.id, t.territory_id, u.id
       FROM users u, transactions t
      WHERE u.phone = '+2348072000004' AND t.id = $1
     ON CONFLICT DO NOTHING`,
    [collected.transactionId],
  );
}

// ===========================================================================
describe('one box, every kind of government reference', () => {
  it('finds a transaction by its reference', async () => {
    const found = await get(
      `/government/search?q=${encodeURIComponent(collected.reference)}`,
      auth('admin'),
    );
    assert.equal(found.status, 200);
    const hit = (found.body.hits as { kind: string; reference: string; path: string }[]).find(
      (row) => row.kind === 'transaction',
    );
    assert.ok(hit, JSON.stringify(found.body.hits));
    assert.equal(hit!.reference, collected.reference);
    assert.equal(hit!.path, `/transaction/${collected.transactionId}`);
  });

  /*
   * A receipt number and a transaction reference land in the same place.
   *
   * This is the point of the search box rather than a nicety. The officer
   * holding a citizen's SMS has a receipt number and does not know, and should
   * not have to know, that it is not a transaction reference.
   */
  it('sends a receipt number to the same transaction', async () => {
    const found = await get(
      `/government/search?q=${encodeURIComponent(collected.receiptNumber)}`,
      auth('auditor'),
    );
    const hit = (found.body.hits as { kind: string; path: string }[]).find(
      (row) => row.kind === 'receipt',
    );
    assert.ok(hit, JSON.stringify(found.body.hits));
    assert.equal(hit!.path, `/transaction/${collected.transactionId}`);
  });

  /*
   * An invoice number opens the invoice, and an assessment number the
   * assessment.
   *
   * Both used to resolve to `COALESCE('/transaction/' || t.id, '/outstanding')`
   * — the transaction when one existed, and the outstanding worklist when one
   * did not. The fallback was the damage: an invoice with no transaction is an
   * invoice nobody has paid, which is exactly the invoice somebody rings up
   * about, and it sent the officer to a list of everybody's unpaid invoices
   * with no mention of the one they had typed.
   *
   * Asserted against a PAID collection deliberately. That is the case the old
   * behaviour got least wrong, so if the path is the invoice here it is the
   * invoice everywhere — and a test that only covered the unpaid case would
   * pass against a COALESCE that still hijacked every paid one.
   */
  it('sends an invoice number to the invoice, not to the transaction', async () => {
    const row = await queryOne<{ invoice_id: string; invoice_number: string }>(
      pool,
      `SELECT i.id AS invoice_id, i.invoice_number
         FROM invoices i
         JOIN transactions t ON t.invoice_id = i.id
        WHERE t.id = $1`,
      [collected.transactionId],
    );
    assert.ok(row, 'the collection produced an invoice');

    const found = await get(
      `/government/search?q=${encodeURIComponent(row!.invoice_number)}`,
      auth('admin'),
    );
    const hit = (found.body.hits as { kind: string; path: string }[]).find(
      (item) => item.kind === 'invoice',
    );
    assert.ok(hit, JSON.stringify(found.body.hits));
    assert.equal(hit!.path, `/invoice/${row!.invoice_id}`);
  });

  it('sends an assessment number to the assessment', async () => {
    const row = await queryOne<{ id: string; assessment_number: string }>(
      pool,
      `SELECT a.id, a.assessment_number
         FROM assessments a
         JOIN transactions t ON t.assessment_id = a.id
        WHERE t.id = $1`,
      [collected.transactionId],
    );
    assert.ok(row, 'the collection produced an assessment');

    const found = await get(
      `/government/search?q=${encodeURIComponent(row!.assessment_number)}`,
      auth('admin'),
    );
    const hit = (found.body.hits as { kind: string; path: string }[]).find(
      (item) => item.kind === 'assessment',
    );
    assert.ok(hit, JSON.stringify(found.body.hits));
    assert.equal(hit!.path, `/assessment/${row!.id}`);
  });

  it('finds a taxpayer by name and an agent by code', async () => {
    const byName = await get('/government/search?q=Pamdegu', auth('admin'));
    assert.ok(
      (byName.body.hits as { kind: string; title: string }[]).some(
        (row) => row.kind === 'taxpayer' && row.title.includes('Pamdegu'),
      ),
      JSON.stringify(byName.body.hits),
    );

    const agent = await queryOne<{ agent_code: string }>(
      pool,
      'SELECT agent_code FROM agents WHERE agent_code IS NOT NULL LIMIT 1',
    );
    const byCode = await get(
      `/government/search?q=${encodeURIComponent(agent!.agent_code)}`,
      auth('admin'),
    );
    assert.ok(
      (byCode.body.hits as { kind: string }[]).some((row) => row.kind === 'agent'),
      JSON.stringify(byCode.body.hits),
    );
  });

  /*
   * Each kind of result keeps its own screen's gate.
   *
   * The endpoint itself is open to every portal role, because it grants
   * nothing on its own. A supervisor holds neither `user:manage` nor
   * `audit:read` — they cannot open the users screen and cannot read the audit
   * log that names officers — so they must not be able to enumerate staff from
   * the search box either. An administrator and an auditor can, because both
   * already can by other routes.
   */
  it('lets only the roles that already see officers find them', async () => {
    const asSupervisor = await get('/government/search?q=Three Sixty', auth('supervisor'));
    assert.equal(asSupervisor.status, 200);
    assert.equal(
      (asSupervisor.body.hits as { kind: string }[]).filter((row) => row.kind === 'officer').length,
      0,
      'a supervisor should get no officer results',
    );

    for (const role of ['admin', 'auditor']) {
      const found = await get('/government/search?q=Three Sixty', auth(role));
      assert.ok(
        (found.body.hits as { kind: string }[]).some((row) => row.kind === 'officer'),
        `a ${role} should`,
      );
    }
  });
});

// ===========================================================================
describe('transaction 360', () => {
  it('assembles the whole chain in one call', async () => {
    const view = await get(`/government/transactions/${collected.reference}/full`, auth('admin'));
    assert.equal(view.status, 200, JSON.stringify(view.body));

    // Taxpayer → agent → revenue → assessment → invoice.
    assert.equal(view.body.transaction.transaction_reference, collected.reference);
    assert.equal(view.body.transaction.taxpayer_name, 'Ladi Pamdegu');
    assert.ok(view.body.transaction.agent_code, 'the collecting agent');
    assert.ok(view.body.transaction.revenue_item, 'what was charged');
    assert.ok(view.body.transaction.assessment_number, 'the assessment');
    assert.ok(view.body.transaction.invoice_number, 'the invoice');

    // → payment → gateway → receipt.
    assert.equal((view.body.payments as unknown[]).length, 1);
    const payment = (view.body.payments as { status: string; gateway_reference: string }[])[0]!;
    assert.equal(payment.status, 'VERIFIED');
    assert.ok(payment.gateway_reference, 'what the gateway called it');
    assert.equal(view.body.receipt.receipt_number, collected.receiptNumber);

    // → settlement → commission.
    assert.ok(view.body.settlement, 'the money arriving in the government account');
    assert.equal(view.body.settlement.status, 'RECONCILED');
    assert.ok(view.body.commission, 'what the agent earned');

    // An administrator is shown everything.
    assert.deepEqual(view.body.withheld, []);
  });

  /*
   * The same view, reached by id rather than reference.
   *
   * An officer arriving from a citizen's SMS has the reference; one arriving
   * from a list has the id. Making them care which is a needless way to lose
   * people.
   */
  it('takes an id or a reference', async () => {
    const byId = await get(
      `/government/transactions/${collected.transactionId}/full`,
      auth('admin'),
    );
    assert.equal(byId.status, 200);
    assert.equal(byId.body.transaction.transaction_reference, collected.reference);
  });

  it('tells the story in the order it happened', async () => {
    const view = await get(
      `/government/transactions/${collected.transactionId}/full`,
      auth('auditor'),
    );
    const timeline = view.body.timeline as { at: string; source: string; label: string }[];
    assert.ok(timeline.length >= 4, `expected a timeline, got ${timeline.length} entries`);

    // In time order, which is the whole point of merging the two records.
    for (let index = 1; index < timeline.length; index += 1) {
      assert.ok(
        timeline[index - 1]!.at <= timeline[index]!.at,
        `entry ${index} is out of order: ${timeline[index - 1]!.at} then ${timeline[index]!.at}`,
      );
    }

    // Both records are present. Either alone is half the answer.
    assert.ok(timeline.some((entry) => entry.source === 'STATE'), 'the state machine');
    assert.ok(timeline.some((entry) => entry.source === 'AUDIT'), 'the audit log');
    assert.ok(
      timeline.some((entry) => entry.label.includes('PAYMENT_SUCCESSFUL')),
      timeline.map((entry) => entry.label).join(', '),
    );
  });

  /*
   * A section that is withheld says so.
   *
   * An empty `commission` could mean the agent earned none or that this officer
   * may not see it. An investigator who cannot tell those apart will conclude
   * something false, which is worse than being refused.
   */
  it('names what it is not showing', async () => {
    // A supervisor sees into their own territory and nowhere else, so the
    // fixture has to put them in the one this collection happened in.
    await assignSupervisorToTheCollection();

    const asSupervisor = await get(
      `/government/transactions/${collected.transactionId}/full`,
      auth('supervisor'),
    );
    assert.equal(asSupervisor.status, 200, JSON.stringify(asSupervisor.body));

    const withheld = asSupervisor.body.withheld as string[];
    assert.ok(withheld.includes('audit'), 'a supervisor holds no audit:read');
    assert.ok(withheld.includes('settlement'), 'nor report:financial');
    assert.equal(asSupervisor.body.settlement, null);
    assert.deepEqual(asSupervisor.body.timeline.filter(
      (entry: { source: string }) => entry.source === 'AUDIT',
    ), []);

    // And what they do hold, they get.
    assert.ok(!withheld.includes('commission'), 'a supervisor holds commission:read:all');
    assert.ok(asSupervisor.body.commission, 'so the commission is there');
  });

  /*
   * Finance gets the settlement chain whole.
   *
   * Their question is not "who did this" but "did the money actually move
   * correctly", and answering it means the payment, what the gateway called it,
   * the government credit, and what reconciliation concluded — four tables that
   * were four screens.
   */
  it('gives a finance officer the settlement chain in one place', async () => {
    const view = await get(
      `/government/transactions/${collected.transactionId}/full`,
      auth('finance_officer'),
    );
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.ok(view.body.settlement, 'the government credit');
    assert.equal(view.body.settlement.status, 'RECONCILED');
    assert.ok(Array.isArray(view.body.reconciliation));
    assert.ok((view.body.payments as unknown[]).length > 0, 'the payment');
    assert.ok(view.body.commission, 'and what it cost in commission');
    assert.deepEqual(view.body.withheld, [], 'a finance officer is withheld nothing here');
  });
});

// ===========================================================================
describe('a transaction outside your territory', () => {
  /*
   * Not found, not refused.
   *
   * "No such reference" and "not yours" are the same answer to somebody who
   * should not know the row exists. Distinguishing them turns this endpoint
   * into a way to confirm any reference by reading its error message.
   */
  it('is not found rather than refused', async () => {
    const elsewhere = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM territories WHERE id <> (SELECT territory_id FROM transactions WHERE id = $1)
        LIMIT 1`,
      [collected.transactionId],
    );
    assert.ok(elsewhere, 'another territory exists to assign');

    const supervisor = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM users WHERE phone = '+2348072000004'`,
    );
    await pool.query(
      `INSERT INTO user_territories (user_id, territory_id, assigned_by)
       VALUES ($1, $2, $1) ON CONFLICT DO NOTHING`,
      [supervisor!.id, elsewhere!.id],
    );

    const view = await get(
      `/government/transactions/${collected.reference}/full`,
      auth('supervisor'),
    );
    assert.equal(view.status, 404, JSON.stringify(view.body));

    const search = await get(
      `/government/search?q=${encodeURIComponent(collected.reference)}`,
      auth('supervisor'),
    );
    assert.equal(
      (search.body.hits as { kind: string }[]).filter((row) => row.kind === 'transaction').length,
      0,
      'nor should it be findable',
    );
  });
});

// ===========================================================================
describe('merging the two records', () => {
  /*
   * A unit test beside the integration ones, for the tie.
   *
   * When a status change and the audit entry that caused it land in the same
   * millisecond — which they do, because they are written in one transaction —
   * showing the effect above the cause reads backwards. Reproducing that
   * collision through the API is a race; here it is an argument.
   */
  it('puts the cause above the effect when the clock cannot separate them', () => {
    const at = '2026-09-06T10:04:56.000Z';
    const merged = mergeTimeline(
      [{ created_at: at, from_status: 'PAYMENT_PENDING', to_status: 'PAYMENT_SUCCESSFUL', source: 'GATEWAY_WEBHOOK' }],
      [{ created_at: at, action: 'payment.verify', result: 'SUCCESS', actor_name: 'Ngo' }],
    );
    assert.deepEqual(merged.map((entry) => entry.source), ['STATE', 'AUDIT']);
  });

  it('orders across the two records by time, not by which record it came from', () => {
    const merged = mergeTimeline(
      [{ created_at: '2026-09-06T10:06:00.000Z', to_status: 'SETTLED', source: 'RECONCILIATION' }],
      [{ created_at: '2026-09-06T10:02:00.000Z', action: 'assessment.create', result: 'SUCCESS' }],
    );
    assert.deepEqual(merged.map((entry) => entry.label), ['assessment.create', 'SETTLED']);
  });
});
