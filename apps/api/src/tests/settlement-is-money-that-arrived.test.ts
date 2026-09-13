/**
 * A settlement is money that arrived.
 *
 * `POST /government/settlements` is where a finance officer records that the
 * gateway has paid a batch of collections into a government account. It names
 * the payments, states what the bank credited, and — this is the part that
 * matters — moves every transaction in the batch to SETTLED. SETTLED is the
 * state the commission ledger waits for: an agent is paid for work that
 * settled, and for no other work.
 *
 * The route did that unconditionally. It marked the batch SETTLED first and
 * compared the figures afterwards, so a gateway that paid ₦900,000 against
 * ₦1,000,000 of confirmed collections left every transaction recorded as
 * settled, every commission on them payable, and a HIGH fraud flag beside it
 * naming an entity type it was not. The flag blocked nothing: it carried no
 * agent and no transaction, which are the two columns the commission guard
 * looks at.
 *
 * That is the third inviolable rule read backwards. "No verified transaction,
 * no commission" exists because the State should not pay for money it did not
 * receive — and a batch that came up ₦100,000 short is exactly money the State
 * did not receive.
 *
 * So a settlement that does not match settles nothing. It is recorded, it is
 * disputed, and the collections in it wait — which they can now do, because
 * there is somewhere for a dispute to go.
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
  importStatementFor,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const FINANCE = '+2348030000500';
const SECOND_FINANCE = '+2348030000501';

let financeToken = '';
let secondFinanceToken = '';
let agent = { token: '', device: '' };
let collection = { transactionId: '', gatewayReference: '', amountKobo: 0n };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({ role: 'admin', phone: '+2348030000502', fullName: 'Records Admin' });
  await createGovernmentUser({ role: 'finance_officer', phone: FINANCE, fullName: 'Finance Officer' });
  financeToken = (await loginAs(FINANCE)).accessToken;
  await createGovernmentUser({
    role: 'finance_officer',
    phone: SECOND_FINANCE,
    fullName: 'Second Finance Officer',
  });
  secondFinanceToken = (await loginAs(SECOND_FINANCE)).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  const lgaId = await firstLgaId();
  const revenueItemId = await revenueItemByCode('DEV-LEVY');

  const registered = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Bitrus',
      lastName: 'Gyang',
      phone: '+2348037000811',
      address: '11 Ahmadu Bello Way, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'settlement-taxpayer' },
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));

  const assessed = await post(
    '/revenue/assessments',
    { taxpayerId: registered.body.taxpayerId, revenueItemId, inputs: {} },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'settlement-assessment' },
  );
  assert.equal(assessed.status, 201, JSON.stringify(assessed.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessed.body.transactionId, paymentMethod: 'POS' },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'settlement-payment' },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: false },
    { token: agent.token, deviceId: agent.device },
  );
  const confirmed = await post(
    `/payments/${initiated.body.paymentId}/confirm`,
    {},
    { token: agent.token, deviceId: agent.device },
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

  const amount = await queryOne<{ amount_kobo: string }>(
    pool,
    'SELECT amount_kobo FROM payments WHERE id = $1',
    [initiated.body.paymentId],
  );
  collection = {
    transactionId: assessed.body.transactionId,
    gatewayReference: initiated.body.gatewayReference,
    amountKobo: BigInt(amount!.amount_kobo),
  };
});

/**
 * Record the bank credit, having first imported the statement that confirms it.
 *
 * The import is what a reconciliation run does before an officer ever sees the
 * batch: `recordSettlement` now refuses a reference the gateway's statement
 * does not carry, so a fixture that skipped it would be testing the refusal
 * rather than the settlement. The line states the amount the platform recorded,
 * so passing a different `receivedKobo` here still reaches the variance path.
 */
const settle = async (
  receivedKobo: bigint,
  token = financeToken,
  bankReference = 'BNK-2026-0001',
) => {
  await importStatementFor([collection.gatewayReference]);
  return post(
    '/government/settlements',
    {
      settlementDate: new Date().toISOString().slice(0, 10),
      gatewayReferences: [collection.gatewayReference],
      receivedAmountKobo: receivedKobo.toString(),
      bankReference,
    },
    { token },
  );
};

const transactionStatus = async () =>
  (
    await queryOne<{ status: string }>(pool, 'SELECT status FROM transactions WHERE id = $1', [
      collection.transactionId,
    ])
  )!.status;

const settlementRow = async () =>
  queryOne<{
    id: string;
    status: string;
    received_amount_kobo: string;
    expected_amount_kobo: string;
    reconciled_at: Date | null;
    reconciled_by: string | null;
  }>(
    pool,
    `SELECT id, status, received_amount_kobo, expected_amount_kobo, reconciled_at, reconciled_by
       FROM settlements ORDER BY created_at DESC LIMIT 1`,
  );

const settlementCount = async () =>
  Number(
    (await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM settlements'))!.n,
  );

describe('a settlement that does not match', () => {
  it('settles none of the collections in it', async () => {
    const short = collection.amountKobo - 100000n;
    const response = await settle(short);
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const settlement = await settlementRow();
    assert.equal(settlement!.status, 'DISPUTED');
    assert.equal(settlement!.received_amount_kobo, short.toString());

    assert.notEqual(
      await transactionStatus(),
      'SETTLED',
      'money the State did not receive was recorded as settled, and the commission on it became payable',
    );
    assert.equal(await transactionStatus(), 'RECONCILIATION_PENDING');
  });

  it('leaves the commission where it was', async () => {
    await settle(collection.amountKobo - 100000n);
    const commission = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM commissions WHERE transaction_id = $1',
      [collection.transactionId],
    );
    if (commission) assert.notEqual(commission.status, 'ELIGIBLE');
  });

  it('raises the variance against the settlement, by name', async () => {
    await settle(collection.amountKobo - 100000n);
    const settlement = await settlementRow();

    const flag = await queryOne<{ rule: string; entity_type: string; entity_id: string }>(
      pool,
      `SELECT rule, entity_type, entity_id FROM fraud_flags
        WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [settlement!.id],
    );
    assert.ok(flag, 'a variance has to be visible to somebody');
    assert.equal(
      flag!.entity_type,
      'SETTLEMENT',
      'the flag described a settlement as a transaction, so nothing could ever join to it',
    );
  });
});

describe('a settlement that matches', () => {
  it('settles the collections and records itself as reconciled', async () => {
    const response = await settle(collection.amountKobo);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(await transactionStatus(), 'SETTLED');

    const settlement = await settlementRow();
    assert.equal(settlement!.status, 'RECONCILED');
    assert.notEqual(
      settlement!.reconciled_at,
      null,
      'every settlement ever recorded counted as unreconciled on the finance officer home screen',
    );
  });

  it('stops counting against the finance officer as unreconciled', async () => {
    // "Settlements unreconciled" on the finance officer's home screen counts
    // `reconciled_at IS NULL`, and nothing in the platform ever set that
    // column — so the tile counted every settlement ever recorded, climbed
    // for the life of the deployment, and asked somebody to go and look at
    // work that was finished.
    const before = await get('/government/home', { token: financeToken });
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(Number(before.body.finance.settlements_unreconciled), 0);

    await settle(collection.amountKobo);

    const after = await get('/government/home', { token: financeToken });
    assert.equal(
      Number(after.body.finance.settlements_unreconciled),
      0,
      'a settlement that matched to the kobo is not outstanding work',
    );
    assert.equal(Number(after.body.finance.settlement_variance_kobo), 0);
  });

  it('is counted as reconciled on the settlement dashboard', async () => {
    await settle(collection.amountKobo);
    const dashboard = await get('/government/settlements', { token: financeToken });
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
    assert.equal(Number(dashboard.body.totals.reconciled_count), 1);
  });

  it('will not settle the same collection twice', async () => {
    assert.equal((await settle(collection.amountKobo)).status, 201);

    const again = await settle(collection.amountKobo, financeToken, 'BNK-2026-0002');
    assert.equal(
      again.status,
      409,
      'the same money was banked twice, and the State’s books said so',
    );
    assert.equal(await settlementCount(), 1);
  });
});

describe('closing a disputed settlement', () => {
  const reconcile = (id: string, receivedKobo: bigint, token: string) =>
    post(
      `/government/settlements/${id}/reconcile`,
      {
        receivedAmountKobo: receivedKobo.toString(),
        bankReference: 'BNK-2026-0009',
        note: 'The gateway sent the balance the following morning; both credits are on the statement.',
      },
      { token },
    );

  it('settles the collections once the money is accounted for', async () => {
    await settle(collection.amountKobo - 100000n);
    const settlement = await settlementRow();

    const response = await reconcile(settlement!.id, collection.amountKobo, secondFinanceToken);
    assert.equal(response.status, 200, JSON.stringify(response.body));

    assert.equal(await transactionStatus(), 'SETTLED');
    const after = await settlementRow();
    assert.equal(after!.status, 'RECONCILED');
    assert.equal(after!.received_amount_kobo, collection.amountKobo.toString());
    assert.notEqual(after!.reconciled_at, null);
    assert.notEqual(after!.reconciled_by, null);
  });

  it('is refused to the officer who recorded it', async () => {
    await settle(collection.amountKobo - 100000n);
    const settlement = await settlementRow();

    const response = await reconcile(settlement!.id, collection.amountKobo, financeToken);
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(await transactionStatus(), 'RECONCILIATION_PENDING');
  });

  it('is refused while the money still does not add up', async () => {
    await settle(collection.amountKobo - 100000n);
    const settlement = await settlementRow();

    const response = await reconcile(settlement!.id, collection.amountKobo - 50000n, secondFinanceToken);
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(response.body.error.message, /50,?000|short|variance/i);
    assert.equal(await transactionStatus(), 'RECONCILIATION_PENDING');
  });
});
