/**
 * A receipt says the State received the money. It has to be true.
 *
 * A receipt used to be issued the moment the *gateway* confirmed a payment, and
 * those are different facts. A payment the gateway has confirmed is money the
 * gateway holds; it reaches the Plateau State Government account in a batch a
 * day or two later. If it never arrives — a gateway failure, a disputed batch,
 * a credit that never lands — the State had issued a government receipt for
 * money it does not have, and for a vehicle renewal it had granted a year of
 * legal cover at a checkpoint in exchange for nothing.
 *
 * Section 95 says no transaction may appear successful unless independently
 * confirmed by the payment/revenue infrastructure. The gateway is the payment
 * half. The government account is the revenue half, and it is the half that
 * decides whether the State was paid.
 *
 * WHAT THE CITIZEN HOLDS IN BETWEEN. Not nothing: an acknowledgement of
 * payment, verifiable, that says the gateway confirmed it, that the State has
 * not yet received it, and that a receipt follows. Giving a citizen who has just
 * been debited nothing at all — at a market stall, with an agent who has nothing
 * to show them — is its own way of making the State look like it took the money
 * and denied it.
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { recordSettlement } from '../services/reconciliation';

let agentAuth: { token: string; deviceId: string };
let financeOfficerId = '';
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
  await createGovernmentUser({ fullName: 'Receipt Admin', phone: '+2348079000001', role: 'admin' });
  financeOfficerId = await createGovernmentUser({
    fullName: 'Receipt Finance',
    phone: '+2348079000002',
    role: 'finance_officer',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

/** Collect from a taxpayer and have the gateway confirm it. Nothing settles. */
async function collectAndConfirm() {
  subject += 1;
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Settled',
      lastName: `Subject${subject}`,
      phone: `+2348139${String(subject).padStart(6, '0')}`,
      address: '11 Rukuba Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `rcpt-tp-${subject}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId: taxpayer.body.taxpayerId, revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'), inputs: {} },
    { ...agentAuth, idempotencyKey: `rcpt-as-${subject}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const payment = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `rcpt-pay-${subject}` },
  );
  assert.equal(payment.status, 201, JSON.stringify(payment.body));

  await post(
    '/payments/simulate',
    { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS' },
    agentAuth,
  );
  const confirmed = await post(`/payments/${payment.body.paymentId}/confirm`, {}, agentAuth);

  return {
    transactionId: assessment.body.transactionId,
    gatewayReference: payment.body.gatewayReference,
    amountKobo: String(assessment.body.amountKobo),
    confirmed,
  };
}

/** A vehicle renewal the gateway has confirmed and nobody has settled. */
async function renewAndConfirm() {
  subject += 1;
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Renewal',
      lastName: `Subject${subject}`,
      phone: `+2348139${String(subject).padStart(6, '0')}`,
      address: '4 Zaria Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `rnw-tp-${subject}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const vehicle = await post(
    '/vehicles',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      registrationNumber: `JOS90${subject}AB`,
      vehicleType: 'PRIVATE',
      make: 'Toyota',
      model: 'Corolla',
      colour: 'Blue',
      ownerName: `Renewal Subject${subject}`,
    },
    { ...agentAuth, idempotencyKey: `rnw-veh-${subject}` },
  );
  assert.ok(vehicle.status < 400, JSON.stringify(vehicle.body));

  const renewal = await post(
    `/vehicles/${vehicle.body.vehicleId}/renew`,
    {
      revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
      renewalPeriodMonths: 12,
      taxpayerId: taxpayer.body.taxpayerId,
    },
    { ...agentAuth, idempotencyKey: `rnw-rnw-${subject}` },
  );
  assert.equal(renewal.status, 201, JSON.stringify(renewal.body));

  const payment = await post(
    '/payments/initiate',
    { transactionId: renewal.body.transactionId },
    { ...agentAuth, idempotencyKey: `rnw-pay-${subject}` },
  );
  assert.equal(payment.status, 201, JSON.stringify(payment.body));

  await post(
    '/payments/simulate',
    { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );

  return {
    renewalId: renewal.body.renewalId as string,
    transactionId: renewal.body.transactionId as string,
  };
}

describe('Before the money reaches a government account', () => {
  it('issues an acknowledgement and no receipt', async () => {
    const { transactionId } = await collectAndConfirm();

    const receipts = await query(pool, `SELECT id FROM receipts WHERE transaction_id = $1`, [transactionId]);
    assert.equal(receipts.length, 0, 'no government receipt exists for money the State does not hold');

    const acknowledgement = await queryOne<{ document_number: string }>(
      pool,
      `SELECT document_number FROM documents
        WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
      [transactionId],
    );
    assert.ok(acknowledgement, 'the taxpayer is not left with nothing');
    assert.match(acknowledgement!.document_number, /ACK/);
  });

  it('leaves the transaction awaiting settlement rather than receipted', async () => {
    const { transactionId } = await collectAndConfirm();
    const txn = await queryOne<{ status: string }>(
      pool,
      `SELECT status FROM transactions WHERE id = $1`,
      [transactionId],
    );
    assert.equal(txn!.status, 'RECONCILIATION_PENDING');
  });

  it('tells the agent what has and has not happened', async () => {
    const { confirmed } = await collectAndConfirm();
    const said = JSON.stringify(confirmed.body);
    assert.match(said, /acknowledgement/i);
    assert.doesNotMatch(said, /receipt issued/i);
  });

  it('refuses a receipt at the database even if something tries to insert one', async () => {
    /*
     * The controls in this platform hold against a compromised service account,
     * not merely against its own code. Every other financial guarantee here is
     * a trigger for that reason, and this one is no different: there is no code
     * path that can talk its way past it because the refusal is underneath the
     * code.
     */
    const { transactionId } = await collectAndConfirm();
    const payment = await queryOne<{ id: string; amount_kobo: string; taxpayer_id: string }>(
      pool,
      `SELECT p.id, p.amount_kobo, t.taxpayer_id
         FROM payments p JOIN transactions t ON t.id = p.transaction_id
        WHERE p.transaction_id = $1`,
      [transactionId],
    );

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO receipts
             (receipt_number, transaction_id, payment_id, taxpayer_id, amount_kobo,
              verification_code, issued_at, status)
           VALUES ('PSIRS/2026/999999', $1, $2, $3, $4, 'FORGEDCODE1234', now(), 'VALID')`,
          [transactionId, payment!.id, payment!.taxpayer_id, payment!.amount_kobo],
        ),
      /has not been settled into a government account/,
    );
  });

  it('lets the collecting agent open the acknowledgement to show the taxpayer', async () => {
    /*
     * The whole reason there is an acknowledgement is that a citizen who has
     * just been debited at a market stall must be given something. If the agent
     * cannot open it, the citizen is shown nothing and the document might as
     * well not exist.
     */
    const { transactionId } = await collectAndConfirm();
    const document = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM documents
        WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
      [transactionId],
    );
    assert.ok(document);

    const opened = await get(`/documents/${document!.id}`, agentAuth);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.document_type, 'PAYMENT_ACKNOWLEDGEMENT');
    assert.ok(opened.body.downloadUrl, 'and can be handed to the taxpayer');
  });

  it('tells a citizen checking the code that it is not a receipt', async () => {
    /*
     * The point at which an acknowledgement becomes indistinguishable from a
     * receipt is the point at which none of this was worth doing. A market
     * trader, a checkpoint officer or the taxpayer themselves types the code
     * into the public portal, and what comes back has to say which of the two
     * they are holding — in the message, not only in a type field they will
     * never see.
     */
    const { transactionId } = await collectAndConfirm();
    const document = await queryOne<{ verification_code: string; document_number: string }>(
      pool,
      `SELECT verification_code, document_number FROM documents
        WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
      [transactionId],
    );
    assert.ok(document);

    const checked = await get(`/verify/${document!.verification_code}`);
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    assert.equal(checked.body.documentType, 'PAYMENT_ACKNOWLEDGEMENT');
    assert.match(
      checked.body.message,
      /not a (government )?receipt/i,
      `the citizen must be told this is not a receipt, was told: ${checked.body.message}`,
    );
    assert.doesNotMatch(
      checked.body.message,
      /genuine government document issued by PSIRS\.$/,
      'the generic wording reads as confirmation that the State has been paid',
    );
  });

  it('refuses a second acknowledgement for the same collection', async () => {
    /*
     * `receipts` has carried UNIQUE (transaction_id) since the schema was
     * written, because a second receipt is a second government assertion that
     * the same money was received. The acknowledgement is what the taxpayer
     * holds for the day or two before the receipt exists, and two of them with
     * different numbers for the same money is the same failure a day earlier.
     *
     * A redelivered webhook and an agent's poll arriving together is ordinary,
     * so this cannot rest on which of them happens to run first.
     */
    const { transactionId } = await collectAndConfirm();
    const existing = await queryOne<{ owner_type: string; owner_id: string; storage_reference: string; content_type: string; checksum: string; issuing_authority: string; byte_size: string }>(
      pool,
      `SELECT owner_type, owner_id, storage_reference, content_type, checksum, issuing_authority, byte_size
         FROM documents
        WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_id = $1`,
      [transactionId],
    );
    assert.ok(existing, 'the first acknowledgement is there to duplicate');

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO documents
             (document_number, document_type, entity_type, entity_id, owner_type, owner_id,
              storage_reference, content_type, checksum, issuing_authority, byte_size,
              verification_code, status)
           VALUES ('PSIRS-ACK/2026/999999', 'PAYMENT_ACKNOWLEDGEMENT', 'transaction', $1,
                   $2, $3, $4, $5, $6, $7, $8, 'DUPEACK99999', 'ISSUED')`,
          [
            transactionId,
            existing!.owner_type,
            existing!.owner_id,
            existing!.storage_reference,
            existing!.content_type,
            existing!.checksum,
            existing!.issuing_authority,
            existing!.byte_size,
          ],
        ),
      /documents_one_acknowledgement_per_transaction|duplicate key/,
      'the database must refuse a second acknowledgement for one collection',
    );
  });

  it('refuses vehicle particulars at the database too', async () => {
    /*
     * The certificate half of the same rule, and the more expensive half. A
     * receipt for money the State does not hold is a false record; particulars
     * for money the State does not hold are a legal instrument, valid at a
     * checkpoint for a year, granted for nothing. So the refusal sits in the
     * same place — underneath the code, where a compromised service account
     * cannot reach it.
     */
    const renewal = await renewAndConfirm();

    const document = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM documents WHERE entity_type = 'transaction' AND entity_id = $1 LIMIT 1`,
      [renewal.transactionId],
    );
    assert.ok(document, 'the acknowledgement gives us a real document id to attach');

    await assert.rejects(
      () =>
        pool.query('UPDATE vehicle_renewals SET document_id = $2 WHERE id = $1', [
          renewal.renewalId,
          document!.id,
        ]),
      /the money has not reached a government account/,
    );

    const row = await queryOne<{ document_id: string | null; document_number: string | null }>(
      pool,
      'SELECT document_id, document_number FROM vehicle_renewals WHERE id = $1',
      [renewal.renewalId],
    );
    assert.equal(row!.document_id, null, 'nothing is granted for money in transit');
    assert.equal(row!.document_number, null);
  });
});

describe('When the money arrives', () => {
  it('issues the receipt, and only then', async () => {
    const collection = await collectAndConfirm();

    const settlement = await recordSettlement({
      settlementDate: new Date(),
      gatewayReferences: [collection.gatewayReference],
      receivedAmountKobo: BigInt(collection.amountKobo),
      bankReference: 'ZENITH-CREDIT-0001',
      governmentAccountId: null,
      actorId: financeOfficerId,
      actorRole: 'finance_officer',
    });
    assert.equal(settlement.status, 'RECONCILED', JSON.stringify(settlement));

    const receipt = await queryOne<{ receipt_number: string }>(
      pool,
      `SELECT receipt_number FROM receipts WHERE transaction_id = $1`,
      [collection.transactionId],
    );
    assert.ok(receipt, 'the receipt exists now that the State has the money');
    assert.match(receipt!.receipt_number, /PSIRS\/\d{4}\/\d+/);

    const txn = await queryOne<{ status: string }>(
      pool,
      `SELECT status FROM transactions WHERE id = $1`,
      [collection.transactionId],
    );
    assert.equal(txn!.status, 'SETTLED');
  });

  it('records the whole story in order, so an auditor can read it', async () => {
    const collection = await collectAndConfirm();
    await recordSettlement({
      settlementDate: new Date(),
      gatewayReferences: [collection.gatewayReference],
      receivedAmountKobo: BigInt(collection.amountKobo),
      bankReference: 'ZENITH-CREDIT-0002',
      governmentAccountId: null,
      actorId: financeOfficerId,
      actorRole: 'finance_officer',
    });

    const events = await query<{ to_status: string; seq: string }>(
      pool,
      // Aliased `seq`, not `sequence`: an output alias shadows the column in
      // ORDER BY, and ordering the text cast puts '10' before '9'.
      `SELECT to_status, sequence::text AS seq FROM transaction_events
        WHERE transaction_id = $1 ORDER BY created_at, sequence`,
      [collection.transactionId],
    );
    const chain = events.map((event) => event.to_status);
    // The receipt sits between reconciliation and settlement, which is the
    // ordering that says it was earned by the money arriving.
    assert.ok(chain.includes('PAYMENT_VERIFIED'));
    assert.ok(
      chain.indexOf('RECONCILIATION_PENDING') < chain.indexOf('RECEIPT_GENERATED'),
      `receipt must follow reconciliation: ${chain.join(' → ')}`,
    );
    assert.ok(
      chain.indexOf('RECEIPT_GENERATED') < chain.indexOf('SETTLED'),
      `settlement is the end of the chain: ${chain.join(' → ')}`,
    );

    /*
     * And the order has to be a recorded fact, not an accident of how the rows
     * came back. RECEIPT_GENERATED and SETTLED are written inside one database
     * transaction, so they share `created_at` to the microsecond; without a
     * column that separates them an auditor is reading whatever order the
     * planner happened to produce. "The receipt was issued because the money
     * arrived" is a claim about sequence, so the sequence has to be stored.
     */
    const seqOf = (status: string) =>
      BigInt(events.find((event) => event.to_status === status)!.seq);
    const receiptedAt = seqOf('RECEIPT_GENERATED');
    const settledAt = seqOf('SETTLED');
    const pendingAt = seqOf('RECONCILIATION_PENDING');
    assert.ok(
      pendingAt < receiptedAt && receiptedAt < settledAt,
      `the recorded order must itself be ordered: ${pendingAt} → ${receiptedAt} → ${settledAt}`,
    );

    const sameInstant = await queryOne<{ n: string }>(
      pool,
      `SELECT count(DISTINCT created_at)::text AS n FROM transaction_events
        WHERE transaction_id = $1 AND to_status IN ('RECEIPT_GENERATED', 'SETTLED')`,
      [collection.transactionId],
    );
    assert.equal(
      sameInstant!.n,
      '1',
      'these two share a timestamp, which is exactly why the sequence has to carry the order',
    );
  });

  it('does not receipt a batch the bank paid short', async () => {
    /*
     * A settlement whose credit does not match the collections it covers
     * settles none of them, so it must receipt none of them either. This is the
     * case the whole change is for: the gateway said yes, the money did not
     * arrive in full, and nothing may assert that it did.
     */
    const collection = await collectAndConfirm();
    const short = BigInt(collection.amountKobo) - 100n;

    const settlement = await recordSettlement({
      settlementDate: new Date(),
      gatewayReferences: [collection.gatewayReference],
      receivedAmountKobo: short,
      bankReference: 'ZENITH-SHORT-0001',
      governmentAccountId: null,
      actorId: financeOfficerId,
      actorRole: 'finance_officer',
    });
    assert.equal(settlement.status, 'DISPUTED');

    const receipts = await query(pool, `SELECT id FROM receipts WHERE transaction_id = $1`, [
      collection.transactionId,
    ]);
    assert.equal(receipts.length, 0, 'a disputed batch receipts nothing');

    const txn = await queryOne<{ status: string }>(
      pool,
      `SELECT status FROM transactions WHERE id = $1`,
      [collection.transactionId],
    );
    assert.equal(txn!.status, 'RECONCILIATION_PENDING', 'and settles nothing');
  });

  it('issues one receipt however many times settlement is recorded', async () => {
    const collection = await collectAndConfirm();
    const settle = () =>
      recordSettlement({
        settlementDate: new Date(),
        gatewayReferences: [collection.gatewayReference],
        receivedAmountKobo: BigInt(collection.amountKobo),
        bankReference: 'ZENITH-CREDIT-0003',
        governmentAccountId: null,
        actorId: financeOfficerId,
        actorRole: 'finance_officer',
      });

    await settle();
    await settle().catch(() => undefined);

    const receipts = await query(pool, `SELECT id FROM receipts WHERE transaction_id = $1`, [
      collection.transactionId,
    ]);
    assert.equal(receipts.length, 1);
  });
});
