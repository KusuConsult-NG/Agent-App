/**
 * Certification revision 10 — the money rules that changed after revision 9.
 *
 * Independent controls audit. Every test here is an attack on a guarantee the
 * platform makes about money, executed either through the HTTP API a real
 * caller reaches or through a raw database connection — the position of a
 * compromised service account or a careless DBA, which is the position the
 * platform's own migration comments claim its financial controls hold against.
 *
 * The rules under attack were all introduced or changed after the last audit:
 *
 *   * a government receipt now requires SETTLED (bank-confirmed), not merely
 *     VERIFIED (gateway-confirmed) — migration 040;
 *   * the taxpayer holds a PAYMENT_ACKNOWLEDGEMENT in between, one per
 *     collection, revoked if the money goes back — migration 041;
 *   * an interrupted idempotency key is reported rather than blocking for ever;
 *   * money in transit is PENDING_SETTLEMENT, not an exception, until 72 hours
 *     have passed.
 *
 * Tests assert the behaviour a correct platform would have. A test that fails
 * is a finding, and is left failing on purpose: the audit reports the defect,
 * it does not repair it.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  importStatementFor,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { issueReceipt } from '../services/receipts';
import {
  awaitingSettlement,
  exceptionQueue,
  recordSettlement,
  runReconciliation,
} from '../services/reconciliation';
import { promoteEligibleCommissions } from '../services/commission';

// Three officers, because a reversal will not take fewer than three people.
const FINANCE_ONE = '+2348077000001';
const FINANCE_TWO = '+2348077000002';
const REVENUE_OFFICER = '+2348077000003';

let agent: { token: string; deviceId: string; agentId: string };
let financeOne = { token: '', id: '' };
let financeTwo = { token: '', id: '' };
let revenueOfficer = { token: '', id: '' };
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
  await createGovernmentUser({ fullName: 'Rev10 Admin', phone: '+2348077000000', role: 'admin' });
  financeOne.id = await createGovernmentUser({
    fullName: 'Rev10 Finance One',
    phone: FINANCE_ONE,
    role: 'finance_officer',
  });
  financeTwo.id = await createGovernmentUser({
    fullName: 'Rev10 Finance Two',
    phone: FINANCE_TWO,
    role: 'finance_officer',
  });
  revenueOfficer.id = await createGovernmentUser({
    fullName: 'Rev10 Revenue Officer',
    phone: REVENUE_OFFICER,
    role: 'revenue_officer',
  });
  financeOne.token = (await loginAs(FINANCE_ONE)).accessToken;
  financeTwo.token = (await loginAs(FINANCE_TWO)).accessToken;
  revenueOfficer.token = (await loginAs(REVENUE_OFFICER)).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must clear the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier, agentId: demo!.agentId };
});

// ---------------------------------------------------------------------------
// Fixtures — every one of them goes through the real API
// ---------------------------------------------------------------------------

interface Collection {
  transactionId: string;
  paymentId: string;
  gatewayReference: string;
  amountKobo: string;
  taxpayerId: string;
}

let keyCounter = 0;
const freshKey = (prefix: string) => `${prefix}-${Date.now()}-${++keyCounter}`;

/** A taxpayer with an assessed obligation and a payment intent at the gateway. */
async function initiate(): Promise<{
  transactionId: string;
  paymentId: string;
  gatewayReference: string;
  taxpayerId: string;
  idempotencyKey: string;
}> {
  subject += 1;
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Audit',
      lastName: `Subject${subject}`,
      phone: `+2348157${String(subject).padStart(6, '0')}`,
      address: '10 Beach Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: freshKey('r10-tp') },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agent, idempotencyKey: freshKey('r10-as') },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const idempotencyKey = freshKey('r10-pay');
  const payment = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId, paymentMethod: 'CARD' },
    { ...agent, idempotencyKey },
  );
  assert.equal(payment.status, 201, JSON.stringify(payment.body));

  return {
    transactionId: assessment.body.transactionId,
    paymentId: payment.body.paymentId,
    gatewayReference: payment.body.gatewayReference,
    taxpayerId: taxpayer.body.taxpayerId,
    idempotencyKey,
  };
}

/** Gateway-confirmed and independently verified. Nothing settles. */
async function collectAndVerify(options: { via?: 'webhook' | 'poll' } = {}): Promise<Collection> {
  const intent = await initiate();
  const simulated = await post(
    '/payments/simulate',
    {
      gatewayReference: intent.gatewayReference,
      outcome: 'SUCCESS',
      deliverWebhook: options.via !== 'poll',
    },
    agent,
  );
  assert.equal(simulated.status, 200, JSON.stringify(simulated.body));
  if (options.via === 'poll') {
    const confirmed = await post(`/payments/${intent.paymentId}/confirm`, {}, agent);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  }

  const payment = await queryOne<{ status: string; amount_kobo: string; settlement_id: string | null }>(
    pool,
    'SELECT status, amount_kobo, settlement_id FROM payments WHERE id = $1',
    [intent.paymentId],
  );
  assert.equal(payment!.status, 'VERIFIED', 'the fixture must reach VERIFIED');
  assert.equal(payment!.settlement_id, null, 'and must not be settled');

  return {
    transactionId: intent.transactionId,
    paymentId: intent.paymentId,
    gatewayReference: intent.gatewayReference,
    amountKobo: payment!.amount_kobo,
    taxpayerId: intent.taxpayerId,
  };
}

/** What a finance officer does when the bank statement shows the credit. */
async function settleViaApi(
  collections: Collection[],
  receivedKobo: bigint,
  options: { token?: string; bankReference?: string; corroborate?: boolean } = {},
) {
  // recordSettlement refuses a reference the gateway's statement does not
  // confirm, so every case except the one testing that refusal has to import
  // the statement first — which is the order production runs in.
  if (options.corroborate !== false) {
    await importStatementFor(collections.map((c) => c.gatewayReference));
  }
  return post(
    '/government/settlements',
    {
      settlementDate: new Date().toISOString().slice(0, 10),
      gatewayReferences: collections.map((c) => c.gatewayReference),
      receivedAmountKobo: receivedKobo.toString(),
      bankReference: options.bankReference ?? `AUDIT-BNK-${Date.now()}-${++keyCounter}`,
    },
    { token: options.token ?? financeOne.token },
  );
}

/** Request, approve and execute a reversal — the three-person path. */
async function reverse(transactionId: string) {
  const request = await post(
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: transactionId,
      payload: { reason: 'Charged in error', refundType: 'REVERSAL' },
      reason: 'Duplicate assessment for the same premises in this period.',
    },
    { token: revenueOfficer.token },
  );
  assert.equal(request.status, 201, JSON.stringify(request.body));

  const approved = await post(
    `/government/approvals/${request.body.approvalId}/decide`,
    { decision: 'APPROVE', reason: 'Duplicate confirmed against the record.' },
    { token: financeOne.token },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const otp = await post(
    '/auth/otp/request',
    { destination: FINANCE_TWO, purpose: 'STEP_UP' },
    { token: financeTwo.token },
  );
  const stepUp = await post(
    '/auth/step-up',
    { action: 'payment.reversal.approve', destination: FINANCE_TWO, code: otp.body.developmentCode },
    { token: financeTwo.token },
  );
  assert.equal(stepUp.status, 200, JSON.stringify(stepUp.body));

  const executed = await post(
    `/government/approvals/${request.body.approvalId}/execute-reversal`,
    {},
    { token: financeTwo.token },
  );
  assert.equal(executed.status, 200, JSON.stringify(executed.body));
  return executed;
}

const receiptCount = async (transactionId: string) =>
  Number(
    (
      await queryOne<{ n: string }>(
        pool,
        'SELECT count(*)::text AS n FROM receipts WHERE transaction_id = $1',
        [transactionId],
      )
    )!.n,
  );

const transactionStatus = async (transactionId: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM transactions WHERE id = $1', [transactionId]))!
    .status;

const acknowledgementFor = (transactionId: string) =>
  queryOne<{ id: string; document_number: string; verification_code: string; status: string }>(
    pool,
    `SELECT id, document_number, verification_code, status FROM documents
      WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_type = 'transaction' AND entity_id = $1
      ORDER BY created_at LIMIT 1`,
    [transactionId],
  );

/** A forged receipt row, straight into the table. */
const forgeReceipt = (c: Collection, receiptNumber: string) =>
  pool.query(
    `INSERT INTO receipts
       (receipt_number, transaction_id, payment_id, taxpayer_id, amount_kobo, verification_code, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'VALID')`,
    [receiptNumber, c.transactionId, c.paymentId, c.taxpayerId, c.amountKobo, `FORGED${receiptNumber.replace(/\W/g, '')}`],
  );

/** Source files under src/, excluding the tests, for the static checks. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests') continue;
      out.push(...sourceFiles(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
const SRC = path.resolve(__dirname, '..');

// ===========================================================================
describe('ATTACK 1 — a receipt for money the State has not received', () => {
  it('1a. is refused at the database for a VERIFIED but unsettled payment', async () => {
    const c = await collectAndVerify();
    await assert.rejects(
      forgeReceipt(c, 'PSIRS/2026/900001'),
      /has not been settled into a government account/,
      'the trigger must name settlement as the missing fact',
    );
    assert.equal(await receiptCount(c.transactionId), 0);
  });

  it('1b. is refused when the service that issues receipts is called directly', async () => {
    const c = await collectAndVerify();
    await assert.rejects(
      withTransaction((client) =>
        issueReceipt(client, { transactionId: c.transactionId, paymentId: c.paymentId }),
      ),
      /has not been settled into a government account/,
    );
    assert.equal(await receiptCount(c.transactionId), 0);
    const strayDocuments = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM documents WHERE document_type = 'RECEIPT'`,
    );
    assert.equal(strayDocuments!.n, '0', 'a refused receipt leaves no PDF registered');
  });

  it('1c. has exactly one code path that inserts a receipt, reached only from settlement', () => {
    const inserters = sourceFiles(SRC).filter((file) =>
      /INSERT INTO receipts/.test(readFileSync(file, 'utf8')),
    );
    assert.deepEqual(
      inserters.map((f) => path.relative(SRC, f)),
      ['services/receipts.ts'],
      'every INSERT INTO receipts outside the tests must be in the receipts service',
    );

    const callers = sourceFiles(SRC).filter(
      (file) =>
        !file.endsWith('services/receipts.ts') && /\bissueReceipt\(/.test(readFileSync(file, 'utf8')),
    );
    assert.deepEqual(
      callers.map((f) => path.relative(SRC, f)),
      ['services/reconciliation.ts'],
      'issueReceipt must be called from the settlement path and nowhere else',
    );
    const reconciliation = readFileSync(path.join(SRC, 'services/reconciliation.ts'), 'utf8');
    const calls = reconciliation.match(/\bissueReceipt\(/g) ?? [];
    assert.equal(calls.length, 1, 'once, inside settleLinkedTransactions');
  });

  it('1d. a second confirmation of an unsettled payment does not issue one either', async () => {
    const c = await collectAndVerify();
    const again = await post(`/payments/${c.paymentId}/confirm`, {}, agent);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.receiptNumber, undefined, 'no receipt number may be reported');
    assert.ok(again.body.acknowledgementNumber, 'the acknowledgement is what exists');
    assert.equal(await receiptCount(c.transactionId), 0);
  });

  it('1e. the on-demand vehicle document route cannot issue particulars for an unsettled renewal', async () => {
    subject += 1;
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Motorist',
        lastName: `Subject${subject}`,
        phone: `+2348157${String(subject).padStart(6, '0')}`,
        address: '4 Zaria Road, Jos',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...agent, idempotencyKey: freshKey('r10-vtp') },
    );
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
    const vehicle = await post(
      '/vehicles',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        registrationNumber: `JOS77${subject}ZX`,
        vehicleType: 'PRIVATE',
        make: 'Toyota',
        model: 'Corolla',
        colour: 'Blue',
        ownerName: `Motorist Subject${subject}`,
      },
      { ...agent, idempotencyKey: freshKey('r10-veh') },
    );
    assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));
    const renewal = await post(
      `/vehicles/${vehicle.body.vehicleId}/renew`,
      {
        revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
        renewalPeriodMonths: 12,
        taxpayerId: taxpayer.body.taxpayerId,
      },
      { ...agent, idempotencyKey: freshKey('r10-rnw') },
    );
    assert.equal(renewal.status, 201, JSON.stringify(renewal.body));
    const payment = await post(
      '/payments/initiate',
      { transactionId: renewal.body.transactionId },
      { ...agent, idempotencyKey: freshKey('r10-rpay') },
    );
    assert.equal(payment.status, 201, JSON.stringify(payment.body));
    await post(
      '/payments/simulate',
      { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      agent,
    );
    assert.equal(await transactionStatus(renewal.body.transactionId), 'RECONCILIATION_PENDING');

    // The route that exists "so a document can be recovered after an
    // interrupted session". Its service still lists RECONCILIATION_PENDING as
    // a paid state; the database does not.
    const attempt = await post(`/vehicles/renewals/${renewal.body.renewalId}/document`, {}, agent);
    assert.notEqual(attempt.status, 200, `particulars issued for unsettled money: ${JSON.stringify(attempt.body)}`);

    const row = await queryOne<{ document_id: string | null; status: string }>(
      pool,
      'SELECT document_id, status FROM vehicle_renewals WHERE id = $1',
      [renewal.body.renewalId],
    );
    assert.equal(row!.document_id, null);
    const particulars = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM documents WHERE document_type = 'VEHICLE_RENEWAL'`,
    );
    assert.equal(particulars!.n, '0', 'no particulars document may survive the refusal');
  });

  it('1f. a DISPUTED settlement (bank paid short) must not make a receipt insertable', async () => {
    /*
     * The trigger's own comment: "a settlement whose credit does not match the
     * collections it covers settles none of them". recordSettlement links
     * payments.settlement_id to the batch whether or not it matched, so the
     * question is whether the trigger reads the settlement's status or only
     * whether the column is null.
     */
    const c = await collectAndVerify();
    const short = await settleViaApi([c], BigInt(c.amountKobo) - 100n);
    assert.equal(short.status, 201, JSON.stringify(short.body));
    assert.equal(short.body.status, 'DISPUTED');
    assert.equal(await transactionStatus(c.transactionId), 'RECONCILIATION_PENDING', 'settled nothing');

    const linked = await queryOne<{ settlement_id: string | null; settlement_status: string | null }>(
      pool,
      `SELECT p.settlement_id, s.status AS settlement_status
         FROM payments p LEFT JOIN settlements s ON s.id = p.settlement_id
        WHERE p.id = $1`,
      [c.paymentId],
    );
    assert.equal(linked!.settlement_status, 'DISPUTED', 'the payment is linked to a disputed batch');

    await assert.rejects(
      forgeReceipt(c, 'PSIRS/2026/900002'),
      /settle|dispute|not been received/i,
      'the database must refuse a receipt whose only settlement is a short-paid, disputed batch',
    );
    assert.equal(await receiptCount(c.transactionId), 0);
  });

  it('1g. a collection in a DISPUTED settlement is not reported MATCHED by the sweep', async () => {
    const c = await collectAndVerify();
    const short = await settleViaApi([c], BigInt(c.amountKobo) - 100n);
    assert.equal(short.body.status, 'DISPUTED');

    const to = new Date(Date.now() + 60_000);
    const from = new Date(Date.now() - 60 * 60_000);
    const summary = await runReconciliation({ from, to, actorId: financeOne.id, actorRole: 'finance_officer' });
    assert.equal(summary.status, 'COMPLETED');

    const record = await queryOne<{ status: string }>(
      pool,
      `SELECT status FROM reconciliation_records WHERE run_id = $1 AND payment_id = $2`,
      [summary.runId, c.paymentId],
    );
    assert.ok(record, 'the payment was in the window');
    assert.notEqual(
      record!.status,
      'MATCHED',
      'money the bank paid short must not reconcile as MATCHED: the third leg is a RECONCILED settlement, not a settlement_id',
    );
    assert.equal(summary.matched, 0, `matched count claims ${summary.matched} for a disputed batch`);
  });
});

// ===========================================================================
describe('ATTACK 2 — a forged settlement', () => {
  it('2a. a settlement row invented in SQL must not unlock a receipt', async () => {
    const c = await collectAndVerify();

    // Step 1: a settlement nobody reconciled — no bank credit, no officer, no
    // matching. Only touch/no-delete triggers exist on this table.
    const forged = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO settlements
         (settlement_reference, gateway, settlement_date, expected_amount_kobo, received_amount_kobo,
          transaction_count, status)
       VALUES ('FORGED-STL-0001', 'mock', current_date, $1, 0, 1, 'PENDING') RETURNING id`,
      [c.amountKobo],
    );
    assert.ok(forged, 'the table accepted a PENDING settlement that received nothing');

    // Step 2: point the payment at it. payments_immutable does not list settlement_id.
    await pool.query('UPDATE payments SET settlement_id = $2 WHERE id = $1', [c.paymentId, forged!.id]);

    // Step 3: the receipt. If this succeeds, two UPDATE-able rows defeat the cardinal rule.
    await assert.rejects(
      forgeReceipt(c, 'PSIRS/2026/900003'),
      /settle|reconcil|received/i,
      'a receipt was issued against a settlement that is PENDING with received_amount_kobo = 0',
    );
    assert.equal(await receiptCount(c.transactionId), 0);
  });

  it('2b. transactions.status cannot be flipped to SETTLED in SQL to release commission', async () => {
    const c = await collectAndVerify();
    const commission = await queryOne<{ id: string; status: string }>(
      pool,
      'SELECT id, status FROM commissions WHERE transaction_id = $1',
      [c.transactionId],
    );
    assert.ok(commission, 'commission accrued PENDING at verification');
    assert.equal(commission!.status, 'PENDING');

    // No settlement exists. Flip the transaction and back-date the settlement
    // clock past the 72-hour hold.
    let flipped = true;
    try {
      await pool.query(
        `UPDATE transactions SET status = 'SETTLED', settled_at = now() - interval '80 hours' WHERE id = $1`,
        [c.transactionId],
      );
    } catch {
      flipped = false;
    }

    const promoted = flipped ? await promoteEligibleCommissions() : 0;
    const after = await queryOne<{ status: string }>(pool, 'SELECT status FROM commissions WHERE id = $1', [
      commission!.id,
    ]);

    assert.ok(
      !flipped || after!.status === 'PENDING',
      `a raw UPDATE moved the transaction to SETTLED with no settlement row, and the promotion job released ` +
        `${promoted} commission (status now ${after!.status}); the receipt rule is enforced in the database ` +
        'but the SETTLED state that gates commission is not',
    );
  });

  it('2c. the API cannot mark a batch SETTLED on one officer\'s typed figure with no statement behind it', async () => {
    /*
     * The reconciliation sweep refuses to run without the gateway's statement
     * (migration 015). The settlement route is asked the same question: does
     * anything corroborate the figure the officer typed?
     */
    const c = await collectAndVerify();
    const statementLines = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM gateway_statement_lines');
    assert.equal(statementLines!.n, '0', 'no statement has been imported for this period');

    const settled = await settleViaApi([c], BigInt(c.amountKobo), {
      bankReference: 'TYPED-BY-ONE-OFFICER',
      corroborate: false,
    });

    const receipts = await receiptCount(c.transactionId);
    const status = await transactionStatus(c.transactionId);
    assert.ok(
      settled.status !== 201 || settled.body.status !== 'RECONCILED' || receipts === 0,
      `a lone finance officer recorded a settlement corroborated by nothing — no statement line, no second ` +
        `officer — and the platform answered ${settled.status} ${settled.body.status}, moved the transaction to ` +
        `${status} and issued ${receipts} government receipt(s)`,
    );
  });
});

// ===========================================================================
describe('ATTACK 3 — the acknowledgement after the money goes back', () => {
  it('3a. a reversal through the proper flow revokes the acknowledgement and public verification says so', async () => {
    const c = await collectAndVerify();
    const ack = await acknowledgementFor(c.transactionId);
    assert.ok(ack);
    assert.equal(ack!.status, 'ISSUED');

    await reverse(c.transactionId);

    const after = await acknowledgementFor(c.transactionId);
    assert.equal(after!.status, 'REVOKED');
    const checked = await get(`/verify/${ack!.verification_code}`);
    assert.equal(checked.status, 200);
    assert.notEqual(checked.body.status, 'VALID');
    assert.match(checked.body.message, /revers|refund|returned/i);
    assert.equal(await receiptCount(c.transactionId), 0);
  });

  it('3b. a revoked acknowledgement cannot be resurrected by a raw UPDATE', async () => {
    const c = await collectAndVerify();
    const ack = (await acknowledgementFor(c.transactionId))!;
    await reverse(c.transactionId);
    assert.equal((await acknowledgementFor(c.transactionId))!.status, 'REVOKED');

    let resurrected = true;
    try {
      await pool.query(`UPDATE documents SET status = 'ISSUED' WHERE id = $1`, [ack.id]);
    } catch {
      resurrected = false;
    }
    const checked = await get(`/verify/${ack.verification_code}`);
    assert.ok(
      !resurrected,
      `documents.status is not protected: a REVOKED acknowledgement went back to ISSUED in one statement, and the ` +
        `public portal now answers ${checked.body.status}: "${checked.body.message}" for a payment the State gave back`,
    );
  });

  it('3c. two live acknowledgements for one collection are refused by the database', async () => {
    const c = await collectAndVerify();
    const existing = await queryOne<Record<string, string>>(
      pool,
      `SELECT owner_type, owner_id, storage_reference, checksum, issuing_authority, byte_size
         FROM documents WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
      [c.transactionId],
    );
    assert.ok(existing);
    await assert.rejects(
      pool.query(
        `INSERT INTO documents
           (document_number, document_type, entity_type, entity_id, owner_type, owner_id, storage_reference,
            checksum, issuing_authority, byte_size, verification_code, status)
         VALUES ('PSIRS-ACK/2026/999998', 'PAYMENT_ACKNOWLEDGEMENT', 'transaction', $1, $2, $3, $4, $5, $6, $7,
                 'DUPEACK99998', 'ISSUED')`,
        [
          c.transactionId,
          existing!.owner_type,
          existing!.owner_id,
          existing!.storage_reference,
          existing!.checksum,
          existing!.issuing_authority,
          existing!.byte_size,
        ],
      ),
      /documents_one_acknowledgement_per_transaction|duplicate key/,
      'the one-per-collection rule must be a unique index, not a service check',
    );
  });

  it('3d. a reversed collection cannot be receipted by a later settlement naming its gateway reference', async () => {
    const c = await collectAndVerify();
    await reverse(c.transactionId);
    assert.equal(await transactionStatus(c.transactionId), 'REVERSED');

    const late = await settleViaApi([c], BigInt(c.amountKobo));
    // Whatever the route answers, no receipt and no state change may follow.
    assert.equal(await receiptCount(c.transactionId), 0, JSON.stringify(late.body));
    assert.equal(await transactionStatus(c.transactionId), 'REVERSED');
    const link = await queryOne<{ settlement_id: string | null }>(
      pool,
      'SELECT settlement_id FROM payments WHERE id = $1',
      [c.paymentId],
    );
    assert.equal(link!.settlement_id, null, 'a reversed payment is not linked to a bank credit');
  });
});

// ===========================================================================
describe('ATTACK 4 — idempotency replay and double execution', () => {
  it('4a. ten simultaneous initiations under one key produce one payment and one initiation', async () => {
    const intentBody = await (async () => {
      subject += 1;
      const taxpayer = await post(
        '/taxpayers',
        {
          taxpayerType: 'INDIVIDUAL',
          firstName: 'Race',
          lastName: `Subject${subject}`,
          phone: `+2348157${String(subject).padStart(6, '0')}`,
          address: '1 Race Road, Jos',
          lgaId: await firstLgaId(),
          consentGiven: true,
          declarationAccepted: true,
        },
        { ...agent, idempotencyKey: freshKey('r10-rtp') },
      );
      const assessment = await post(
        '/revenue/assessments',
        { taxpayerId: taxpayer.body.taxpayerId, revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'), inputs: {} },
        { ...agent, idempotencyKey: freshKey('r10-ras') },
      );
      return { transactionId: assessment.body.transactionId as string, paymentMethod: 'CARD' };
    })();

    const key = freshKey('r10-samekey');
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => post('/payments/initiate', intentBody, { ...agent, idempotencyKey: key })),
    );
    const firstHand = attempts.filter((a) => a.status === 201 && a.headers.get('idempotent-replay') !== 'true');
    const replays = attempts.filter((a) => a.headers.get('idempotent-replay') === 'true');
    const refused = attempts.filter((a) => a.status === 409);
    assert.ok(firstHand.length <= 1, `${firstHand.length} first-hand executions`);
    assert.equal(firstHand.length + replays.length + refused.length, 10, 'every answer is one of the three');

    const payments = await query(pool, 'SELECT id FROM payments WHERE transaction_id = $1', [intentBody.transactionId]);
    assert.equal(payments.length, 1);
    const initiations = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_logs WHERE action = 'payment.initiated' AND entity_id = $1`,
      [payments[0].id],
    );
    assert.equal(initiations!.n, '1', 'the handler ran once');
  });

  it('4b. an interrupted key is reported, never re-executed, on either side of the stall window', async () => {
    const intent = await initiate();
    const before = await query(pool, 'SELECT id FROM payments WHERE transaction_id = $1', [intent.transactionId]);
    assert.equal(before.length, 1);

    // The state a killed container leaves behind.
    await pool.query(
      `UPDATE idempotency_keys
          SET status = 'IN_PROGRESS', response_code = NULL, response_body = NULL, completed_at = NULL,
              created_at = now() - interval '4 minutes'
        WHERE idempotency_key = $1`,
      [intent.idempotencyKey],
    );
    const body = { transactionId: intent.transactionId, paymentMethod: 'CARD' };
    const soon = await post('/payments/initiate', body, { ...agent, idempotencyKey: intent.idempotencyKey });
    assert.equal(soon.status, 409, JSON.stringify(soon.body));
    assert.equal(soon.body.error.code, 'REQUEST_IN_PROGRESS');

    await pool.query(`UPDATE idempotency_keys SET created_at = now() - interval '10 minutes' WHERE idempotency_key = $1`, [
      intent.idempotencyKey,
    ]);
    const later = await post('/payments/initiate', body, { ...agent, idempotencyKey: intent.idempotencyKey });
    assert.equal(later.status, 409, JSON.stringify(later.body));
    assert.equal(later.body.error.code, 'REQUEST_INTERRUPTED');
    assert.equal(later.body.error.moneyStatus, 'UNCONFIRMED');

    // Hold it open for a year: still no re-execution.
    await pool.query(`UPDATE idempotency_keys SET created_at = now() - interval '400 days' WHERE idempotency_key = $1`, [
      intent.idempotencyKey,
    ]);
    const muchLater = await post('/payments/initiate', body, { ...agent, idempotencyKey: intent.idempotencyKey });
    assert.equal(muchLater.body.error?.code, 'REQUEST_INTERRUPTED');

    const still = await queryOne<{ status: string }>(pool, 'SELECT status FROM idempotency_keys WHERE idempotency_key = $1', [
      intent.idempotencyKey,
    ]);
    assert.equal(still!.status, 'IN_PROGRESS', 'the row is never reset to allow re-execution');
    const after = await query(pool, 'SELECT id FROM payments WHERE transaction_id = $1', [intent.transactionId]);
    assert.equal(after.length, 1, 'no second payment row');
    const initiations = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_logs WHERE action = 'payment.initiated' AND entity_id = $1`,
      [before[0].id],
    );
    assert.equal(initiations!.n, '1', 'the handler did not run again');
  });

  it('4c. the stall window is five minutes and the retry path is one atomic statement', () => {
    const source = readFileSync(path.join(SRC, 'middleware/idempotency.ts'), 'utf8');
    assert.match(source, /STALL_AFTER_MS = 5 \* 60_000/);
    // The only transition back into IN_PROGRESS is from FAILED, inside the
    // INSERT ... ON CONFLICT DO UPDATE ... WHERE status = 'FAILED' — the
    // database evaluates the predicate under the row lock, so two retries of
    // a FAILED key cannot both win.
    assert.match(source, /ON CONFLICT \(scope, idempotency_key\)\s+DO UPDATE SET status = 'IN_PROGRESS'[^;]*WHERE idempotency_keys\.status = 'FAILED'/);
    assert.doesNotMatch(
      source,
      /status = 'IN_PROGRESS'[^;]*status = 'IN_PROGRESS'\s+AND\s+created_at/,
      'there must be no age-based reset of an IN_PROGRESS key',
    );
  });

  it('4d. reusing a key for a different body is refused rather than replayed', async () => {
    const intent = await initiate();
    const other = await initiate();
    const reused = await post(
      '/payments/initiate',
      { transactionId: other.transactionId, paymentMethod: 'CARD' },
      { ...agent, idempotencyKey: intent.idempotencyKey },
    );
    assert.equal(reused.status, 422, JSON.stringify(reused.body));
    assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  });
});

// ===========================================================================
describe('ATTACK 5 — money in transit', () => {
  const window = () => ({ from: new Date(Date.now() - 24 * 60 * 60_000), to: new Date(Date.now() + 60_000) });
  /*
   * Age the money, not the paperwork.
   *
   * This aged `reconciliation_records.created_at` — the moment the sweep last
   * looked — which is the very thing 5b says the 72 hours must not be counted
   * from. Now that they are counted from the payment, a fixture that ages the
   * record is ageing something the question no longer turns on. The record is
   * aged alongside it because in reality a collection five days old was first
   * seen days ago too, and leaving it fresh would model a sweep that had never
   * run.
   */
  const ageMoney = async (paymentId: string, recordId: string, interval: string) => {
    await pool.query(
      `UPDATE payments
          SET verified_at = now() - $2::interval,
              paid_at = now() - $2::interval,
              created_at = now() - $2::interval
        WHERE id = $1`,
      [paymentId, interval],
    );
    await pool.query(`UPDATE reconciliation_records SET created_at = now() - $2::interval WHERE id = $1`, [
      recordId,
      interval,
    ]);
  };

  it('5a. an unsettled collection is PENDING_SETTLEMENT, then an exception once 72 hours have passed', async () => {
    const c = await collectAndVerify({ via: 'poll' });
    const summary = await runReconciliation({ ...window(), actorId: financeOne.id, actorRole: 'finance_officer' });
    const record = await queryOne<{ id: string; status: string }>(
      pool,
      'SELECT id, status FROM reconciliation_records WHERE run_id = $1 AND payment_id = $2',
      [summary.runId, c.paymentId],
    );
    assert.equal(record!.status, 'PENDING_SETTLEMENT');
    assert.equal(summary.exceptions, 0, 'money inside the settlement window is not an exception');
    assert.equal((await exceptionQueue(pool)).length, 0);
    const waiting = (await awaitingSettlement(pool)) as Array<{ overdue: boolean; age_hours: number }>;
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].overdue, false);

    await ageMoney(c.paymentId, record!.id, '73 hours');
    const queue = (await exceptionQueue(pool)) as Array<{ status: string; transaction_reference: string }>;
    assert.equal(queue.length, 1, 'past the window it is somebody\'s job');
    assert.equal(queue[0].status, 'PENDING_SETTLEMENT');
    assert.equal(((await awaitingSettlement(pool))[0] as { overdue: boolean }).overdue, true);
  });

  it('5b. the 72 hours are counted from the money, not from the last time the sweep looked', async () => {
    /*
     * A payment the gateway confirmed five days ago that has never settled. The
     * sweep runs now and writes a fresh record. The exception queue decides
     * "overdue" from the record's created_at, so the question is whether a
     * collection 120 hours unsettled is shown as an exception.
     */
    const c = await collectAndVerify({ via: 'poll' });
    await pool.query(
      `UPDATE payments SET created_at = now() - interval '5 days', verified_at = now() - interval '5 days',
                           paid_at = now() - interval '5 days' WHERE id = $1`,
      [c.paymentId],
    );
    await pool.query(`UPDATE mock_gateway_transactions SET created_at = now() - interval '5 days' WHERE gateway_reference = $1`, [
      c.gatewayReference,
    ]);
    const summary = await runReconciliation({
      from: new Date(Date.now() - 10 * 24 * 60 * 60_000),
      to: new Date(Date.now() + 60_000),
      actorId: financeOne.id,
      actorRole: 'finance_officer',
    });
    const record = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM reconciliation_records WHERE run_id = $1 AND payment_id = $2',
      [summary.runId, c.paymentId],
    );
    assert.equal(record!.status, 'PENDING_SETTLEMENT');

    const queue = await exceptionQueue(pool);
    const waiting = (await awaitingSettlement(pool)) as Array<{ overdue: boolean; age_hours: number }>;
    assert.equal(
      queue.length,
      1,
      `a collection confirmed 120 hours ago and never settled is not in the exception queue; awaiting-settlement ` +
        `reports it as ${waiting[0]?.age_hours}h old, overdue=${waiting[0]?.overdue}`,
    );
  });

  it('5c. money that has since settled does not surface as an overdue PENDING_SETTLEMENT exception', async () => {
    /*
     * The realistic sequence: sweep sees the payment on day 1 (PENDING_SETTLEMENT),
     * the payment leaves the 48-hour sweep window, the bank credit lands on day 3
     * and the officer records it. Nothing re-examines the payment, so the newest
     * record for it is still the day-1 verdict.
     */
    const c = await collectAndVerify({ via: 'poll' });
    const summary = await runReconciliation({ ...window(), actorId: financeOne.id, actorRole: 'finance_officer' });
    const record = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM reconciliation_records WHERE run_id = $1 AND payment_id = $2',
      [summary.runId, c.paymentId],
    );

    const settled = await settleViaApi([c], BigInt(c.amountKobo));
    assert.equal(settled.status, 201, JSON.stringify(settled.body));
    assert.equal(await transactionStatus(c.transactionId), 'SETTLED');
    assert.equal(await receiptCount(c.transactionId), 1);

    await ageMoney(c.paymentId, record!.id, '4 days');
    const queue = (await exceptionQueue(pool)) as Array<{ status: string; transaction_status: string }>;
    const waiting = await awaitingSettlement(pool);
    assert.equal(
      queue.length,
      0,
      `a SETTLED, receipted collection is in the finance officer's exception queue as ` +
        `${queue[0]?.status} (transaction is ${queue[0]?.transaction_status}); awaiting-settlement lists ${waiting.length}`,
    );
  });

  it('5d. a gateway that reports a verified payment REVERSED puts it in the exception queue', async () => {
    /*
     * The chargeback case: the State receipted the money, then the gateway's
     * statement says the payment was reversed. The sweep records it as
     * 'REVERSED'. Whether that reaches anybody depends on whether 'REVERSED'
     * is an exception status.
     */
    const c = await collectAndVerify({ via: 'poll' });
    const settled = await settleViaApi([c], BigInt(c.amountKobo));
    assert.equal(settled.body.status, 'RECONCILED');
    assert.equal(await receiptCount(c.transactionId), 1);

    const chargeback = await post(
      '/payments/simulate',
      { gatewayReference: c.gatewayReference, outcome: 'REVERSED', deliverWebhook: false },
      agent,
    );
    assert.equal(chargeback.status, 200);

    const summary = await runReconciliation({ ...window(), actorId: financeOne.id, actorRole: 'finance_officer' });
    const record = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM reconciliation_records WHERE run_id = $1 AND payment_id = $2',
      [summary.runId, c.paymentId],
    );
    assert.equal(record!.status, 'REVERSED', 'the sweep noticed');

    const queue = await exceptionQueue(pool);
    assert.ok(
      summary.exceptions >= 1 && queue.length >= 1,
      `the gateway says a receipted payment was reversed; the run counted ${summary.exceptions} exception(s) and the ` +
        `finance officer's queue holds ${queue.length} — the receipt stays VALID and nobody is told`,
    );
  });
});

// ===========================================================================
describe('ATTACK 6 — commission on unsettled money', () => {
  const commissionFor = (transactionId: string) =>
    queryOne<{ id: string; status: string; agent_id: string }>(
      pool,
      'SELECT id, status, agent_id FROM commissions WHERE transaction_id = $1',
      [transactionId],
    );

  it('6a. accrual at verification is PENDING and the promotion job releases nothing without settlement', async () => {
    const c = await collectAndVerify();
    const commission = await commissionFor(c.transactionId);
    assert.ok(commission);
    assert.equal(commission!.status, 'PENDING');

    const promoted = await promoteEligibleCommissions({ now: new Date(Date.now() + 365 * 24 * 60 * 60_000) });
    assert.equal(promoted, 0, 'a year on the clock does not make unsettled money payable');
    assert.equal((await commissionFor(c.transactionId))!.status, 'PENDING');
  });

  it('6b. the database refuses a payable (ELIGIBLE) commission for a transaction that has not settled', async () => {
    const c = await collectAndVerify();
    const existing = (await commissionFor(c.transactionId))!;
    assert.equal(await transactionStatus(c.transactionId), 'RECONCILIATION_PENDING');

    let promotedInSql = true;
    try {
      await pool.query(`UPDATE commissions SET status = 'ELIGIBLE', eligible_at = now() WHERE id = $1`, [existing.id]);
    } catch {
      promotedInSql = false;
    }
    const payable = await query<{ id: string }>(
      pool,
      `SELECT id FROM commissions WHERE agent_id = $1 AND status = 'ELIGIBLE'`,
      [existing.agent_id],
    );
    assert.ok(
      !promotedInSql,
      `commissions.status moved PENDING -> ELIGIBLE in one UPDATE on a RECONCILIATION_PENDING transaction; ` +
        `requestPayout selects exactly this (${payable.length} row now payable) — the trigger checks only that the ` +
        'transaction was verified, not that ELIGIBLE/APPROVED/PAID require SETTLED',
    );
  });

  it('6c. the database refuses an ELIGIBLE commission inserted for unsettled money', async () => {
    const c = await collectAndVerify();
    const existing = (await commissionFor(c.transactionId))!;
    const policy = await queryOne<{ id: string }>(pool, `SELECT policy_id AS id FROM commissions WHERE id = $1`, [existing.id]);

    /*
     * The insert has to land on a transaction that has no commission row.
     *
     * `commissions.transaction_id` is UNIQUE, so inserting against a collection
     * that already accrued is refused by the index before any rule is
     * consulted — and an assertion that accepts either answer cannot tell you
     * which one it got. An earlier version of this test did exactly that,
     * moved the existing row to CANCELLED believing that freed the index (it
     * does not; the index is not partial), and reported the rule as holding
     * when only the index had answered.
     *
     * So the fixture copies the verified transaction to a second row by SQL,
     * which is the position this whole section tests from anyway. Its status is
     * RECONCILIATION_PENDING — gateway-confirmed, not settled — which satisfies
     * the existing accrual trigger, so nothing but the settlement rule is left
     * to refuse the row.
     */
    const bare = (await queryOne<{ id: string }>(
      pool,
      `INSERT INTO transactions
         (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
          agent_id, device_id, lga_id, amount_kobo, total_amount_kobo, status, created_by)
       SELECT transaction_reference || '-AUDIT6C', taxpayer_id, invoice_id, assessment_id,
              revenue_item_id, agent_id, device_id, lga_id, amount_kobo, total_amount_kobo,
              'RECONCILIATION_PENDING', created_by
         FROM transactions WHERE id = $1
       RETURNING id`,
      [c.transactionId],
    ))!;
    const noCommissionYet = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM commissions WHERE transaction_id = $1`,
      [bare.id],
    );
    assert.equal(noCommissionYet!.n, '0', 'the fixture must not leave the UNIQUE index able to answer');

    await assert.rejects(
      pool.query(
        `INSERT INTO commissions
           (agent_id, transaction_id, policy_id, rate_basis_points, basis_amount_kobo, amount_kobo, status, eligible_at)
         VALUES ($1, $2, $3, 150, $4, 1, 'ELIGIBLE', now())`,
        [existing.agent_id, bare.id, policy!.id, c.amountKobo],
      ),
      /not SETTLED/i,
      'a commission can be written already ELIGIBLE for money the State has not received — requestPayout ' +
        'selects exactly this status, so the row is payable the moment it exists and never passes through ' +
        'the transition the UPDATE rule watches',
    );

    // And the same insert is accepted at PENDING, so what is refused is the
    // payable status and not the insert.
    await pool.query(
      `INSERT INTO commissions
         (agent_id, transaction_id, policy_id, rate_basis_points, basis_amount_kobo, amount_kobo, status)
       VALUES ($1, $2, $3, 150, $4, 1, 'PENDING')`,
      [existing.agent_id, bare.id, policy!.id, c.amountKobo],
    );
  });
});

// ===========================================================================
describe('ATTACK 7 — the committed evidence is behind the rule', () => {
  const certification = readFileSync(path.join(SRC, 'tests/certification-audit.test.ts'), 'utf8');

  it('7a. the prior audit tests a PENDING payment, not a VERIFIED-but-unsettled one', () => {
    assert.match(certification, /refuses a receipt for a PENDING payment/, 'the old evidence is there');
    assert.match(certification, /not VERIFIED/, 'and asserts the old error text');
    // The rule changed in migration 040. The certification suite should carry
    // evidence for the rule as it now stands.
    assert.match(
      certification,
      /has not been settled into a government account/,
      'certification-audit.test.ts never inserts a receipt for a VERIFIED-but-unsettled payment; the cardinal ' +
        'rule it certifies is the one that was replaced by migration 040',
    );
  });

  it('7b. the evidence for the settlement rule lives in a feature suite, not the certification suite', () => {
    const feature = readFileSync(path.join(SRC, 'tests/money-the-state-has-not-received.test.ts'), 'utf8');
    assert.match(feature, /has not been settled into a government account/);
    assert.match(feature, /INSERT INTO receipts/);
  });
});

// ===========================================================================
describe('ATTACK 8 — what the gateway says and what the platform hears', () => {
  it('8a. a gateway answering REVERSED for a pending payment does not verify it', async () => {
    /*
     * The gateway contract lists REVERSED among the answers verify() may give.
     * confirmPayment treats PENDING/UNKNOWN as unconfirmed and FAILED/ABANDONED
     * as failed. The question is what it does with REVERSED — the answer that
     * means the money went back.
     */
    const intent = await initiate();
    const reversedAtGateway = await post(
      '/payments/simulate',
      { gatewayReference: intent.gatewayReference, outcome: 'REVERSED', deliverWebhook: true },
      agent,
    );
    assert.equal(reversedAtGateway.status, 200, JSON.stringify(reversedAtGateway.body));

    const payment = await queryOne<{ status: string }>(pool, 'SELECT status FROM payments WHERE id = $1', [intent.paymentId]);
    const txn = await transactionStatus(intent.transactionId);
    const ack = await acknowledgementFor(intent.transactionId);
    const commission = await queryOne<{ status: string }>(pool, 'SELECT status FROM commissions WHERE transaction_id = $1', [
      intent.transactionId,
    ]);
    assert.notEqual(
      payment!.status,
      'VERIFIED',
      `the gateway said REVERSED and the platform recorded payment=${payment!.status}, transaction=${txn}, ` +
        `acknowledgement=${ack?.document_number ?? 'none'}, commission=${commission?.status ?? 'none'}`,
    );
    assert.equal(ack, null, 'no acknowledgement for money the gateway says went back');
    assert.equal(commission, null, 'no commission either');
  });
});
