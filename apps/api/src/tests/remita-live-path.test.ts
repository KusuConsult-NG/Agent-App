/**
 * The whole platform, on the real gateway adapter, for the first time.
 *
 * Everything that moves money in this codebase has only ever been exercised on
 * `MockGateway`. The Remita adapter has its own tests, but they call the class
 * directly: no route, no database, no receipt, no commission. So the seam that
 * a production deployment actually depends on — the API talking to a gateway
 * that is not the mock — had never been run at all, and the first exercise of
 * it was going to be a taxpayer's money.
 *
 * This boots the real Express app with `PAYMENT_GATEWAY=remita` against a
 * server speaking Remita's wire protocol over real TCP, and takes one
 * collection the whole way: assessment, RRR, an unconfirmed poll, Remita's
 * notification, verification, receipt.
 *
 * Two things it watches for that an adapter-level test cannot see:
 *
 *   * **The unit boundary, end to end.** The platform holds integer kobo and
 *     Remita speaks Naira decimals. The adapter converts, but nothing until now
 *     checked that the figure leaving the API for Remita and the figure landing
 *     on the receipt are the same money. A hundred-fold error here bills a
 *     ₦5,000 kiosk levy as ₦500,000 or collects ₦50.
 *
 *   * **That the mock is genuinely out of the picture.** The RRR is one the
 *     stub invents, so a receipt carrying it is proof the request travelled.
 */

// Must be first: it selects the gateway before config.ts and gateway.ts load.
import { REMITA_API_KEY, REMITA_MERCHANT_ID, REMITA_STUB_PORT } from './remita-env';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  createGovernmentUser,
  firstLgaId,
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
import { gateway } from '../integrations/gateway';
import { runReconciliation } from '../services/reconciliation';
import { koboToNaira } from '@psirs/shared';

/** The RRR the stub issues. Nothing else in the codebase can produce it. */
const STUB_RRR = '340006286726';

/** What the stub says when asked about the RRR. Starts unpaid. */
let statusBody: Record<string, unknown> = { status: '021', message: 'Transaction pending' };

/** Remita's account of the money, in Naira, once it says the RRR is paid. */
function remitaPaid(amountNaira: string): Record<string, unknown> {
  return {
    status: '00',
    message: 'Approved or Completed Successfully',
    amount: amountNaira,
    RRR: STUB_RRR,
    channel: 'CARD',
    transactiontime: new Date().toISOString(),
  };
}

/** Every init request the stub received, for asserting the wire format. */
const initRequests: { body: Record<string, unknown>; authorization: string }[] = [];
/** Every status query, so we can prove the platform asked before believing. */
const statusQueries: string[] = [];

let stub: Server;
let agent: { token: string; device: string };

before(async () => {
  stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = req.url ?? '';

      if (url.includes('/paymentinit')) {
        initRequests.push({
          body: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
          authorization: (req.headers.authorization as string) ?? '',
        });
        res.writeHead(200, { 'content-type': 'text/plain' });
        // Remita wraps the init response in a JSONP envelope, and `025` is the
        // code it returns for a reference it has generated.
        res.end(
          `jsonp ${JSON.stringify({
            statuscode: '025',
            status: 'Payment Reference generated',
            RRR: STUB_RRR,
          })}`,
        );
        return;
      }

      if (url.includes('/status.reg')) {
        statusQueries.push(url);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(statusBody));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });

  await new Promise<void>((resolve, reject) => {
    stub.once('error', reject);
    stub.listen(REMITA_STUB_PORT, '127.0.0.1', resolve);
  });

  await startTestServer();
});

after(async () => {
  await stopTestServer();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

beforeEach(async () => {
  initRequests.length = 0;
  statusQueries.length = 0;
  statusBody = { status: '021', message: 'Transaction pending', RRR: STUB_RRR };

  await resetDatabase();
  await seedReferenceData();
  // The demonstration agent needs an admin to approve it into the field.
  await createGovernmentUser({
    fullName: 'Remita Admin',
    phone: '+2348000000090',
    role: 'admin',
  });
  await createGovernmentUser({
    fullName: 'Remita Officer',
    phone: '+2348000000091',
    role: 'revenue_officer',
  });

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/**
 * Register a taxpayer and assess the kiosk levy against them.
 *
 * The amount comes back from the assessment rather than being written here.
 * A catalogue price is allowed to change; what this file is checking is that
 * the same money survives the trip to Remita and back, whatever it is.
 */
async function assessKioskLevy(
  suffix: string,
): Promise<{ transactionId: string; amountKobo: bigint; amountNaira: string }> {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Remita',
      lastName: `Subject${suffix}`,
      phone: `+23480999${suffix.padStart(5, '0')}`,
      address: '5 Market Road, Jos',
      lgaId: await firstLgaId(),
      community: 'Kabong',
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `remita-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `remita-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  const amountKobo = BigInt(assessment.body.amountKobo as string);
  return {
    transactionId: assessment.body.transactionId as string,
    amountKobo,
    amountNaira: koboToNaira(amountKobo),
  };
}

describe('The API on the real Remita adapter', () => {
  it('is not running on the mock', () => {
    // If this fails, everything below is theatre: it would be the mock gateway
    // agreeing with itself, which is what the suite already did.
    assert.equal(gateway.name, 'remita');
  });

  it('generates the RRR at Remita and stores that reference, not one of its own', async () => {
    const { transactionId } = await assessKioskLevy('1');

    const payment = await post(
      '/payments/initiate',
      { transactionId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'remita-pay-1' },
    );

    assert.equal(payment.status, 201, JSON.stringify(payment.body));
    assert.equal(payment.body.status, 'PENDING');
    assert.equal(
      payment.body.gatewayReference,
      STUB_RRR,
      'the reference handed to the agent must be the one Remita issued',
    );

    const stored = await queryOne<{ gateway_reference: string; gateway: string }>(
      pool,
      'SELECT gateway_reference, gateway FROM payments WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(stored?.gateway_reference, STUB_RRR);
    assert.equal(stored?.gateway, 'remita');
  });

  it('sends Remita the amount in Naira, and the hash over it', async () => {
    // The most expensive possible bug in this codebase lives on this line.
    const { transactionId, amountKobo, amountNaira } = await assessKioskLevy('2');
    await post(
      '/payments/initiate',
      { transactionId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'remita-pay-2' },
    );

    assert.equal(initRequests.length, 1, 'exactly one init request reached Remita');
    const sent = initRequests[0]!;

    // The same money in two vocabularies. Sending the kobo integer as if it
    // were Naira is a hundredfold overcharge, and it would look like a
    // perfectly ordinary number all the way to the taxpayer.
    assert.equal(sent.body.amount, amountNaira);
    assert.notEqual(sent.body.amount, String(amountKobo));
    assert.equal(sent.body.serviceTypeId, '4430731');

    const transaction = await queryOne<{ amount_kobo: string }>(
      pool,
      'SELECT amount_kobo FROM transactions WHERE id = $1',
      [transactionId],
    );
    assert.equal(
      transaction?.amount_kobo,
      String(amountKobo),
      'the platform still holds integer kobo on its own side of the boundary',
    );

    // Remita authenticates the request by a SHA512 over the fields it was
    // given. Recomputing it here proves the adapter hashed what it actually
    // sent, rather than a shape that happens to parse.
    const expected = createHash('sha512')
      .update(
        `${REMITA_MERCHANT_ID}4430731${sent.body.orderId}${amountNaira}${sent.body.responseurl as string}`,
      )
      .digest('hex');
    assert.equal(
      sent.authorization,
      `remitaConsumerKey=${REMITA_MERCHANT_ID},remitaConsumerToken=${expected}`,
    );
  });

  it('refuses to confirm while Remita still calls it pending', async () => {
    const { transactionId } = await assessKioskLevy('3');
    const payment = await post(
      '/payments/initiate',
      { transactionId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'remita-pay-3' },
    );

    const confirm = await post(
      `/payments/${payment.body.paymentId}/confirm`,
      {},
      { token: agent.token, deviceId: agent.device },
    );

    assert.equal(confirm.status, 202);
    assert.equal(confirm.body.error.code, 'PAYMENT_UNCONFIRMED');
    assert.match(confirm.body.error.message, /has NOT been marked as received/);
    assert.ok(statusQueries.length >= 1, 'the platform asked Remita rather than assuming');

    const receipts = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM receipts WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(receipts?.count, '0');
  });

  it('takes Remita’s notification as a prompt and re-asks before issuing a receipt', async () => {
    const { transactionId, amountKobo, amountNaira } = await assessKioskLevy('4');
    const payment = await post(
      '/payments/initiate',
      { transactionId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'remita-pay-4' },
    );

    // A forged notification claiming success, while Remita itself still says
    // pending. PRD §95: the delivery must not be able to move the money state.
    const forged = await post('/webhooks/payments', {
      rrr: STUB_RRR,
      status: '00',
      amount: amountNaira,
      channel: 'CARD',
    });
    assert.equal(forged.status, 200, 'the delivery is accepted as a prompt');

    const afterForgery = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE transaction_id = $1',
      [transactionId],
    );
    assert.notEqual(
      afterForgery?.status,
      'VERIFIED',
      'a notification Remita did not back up must not verify a payment',
    );

    // Now the money is genuinely in: Remita's own status query says so.
    statusBody = remitaPaid(amountNaira);

    const confirm = await post(
      `/payments/${payment.body.paymentId}/confirm`,
      {},
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));

    const verified = await queryOne<{ status: string; amount_kobo: string }>(
      pool,
      'SELECT status, amount_kobo FROM payments WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(verified?.status, 'VERIFIED');
    assert.equal(
      verified?.amount_kobo,
      String(amountKobo),
      `Remita's ₦${amountNaira} came back as ${amountKobo} kobo`,
    );

    const receipt = await queryOne<{ receipt_number: string; amount_kobo: string }>(
      pool,
      'SELECT receipt_number, amount_kobo FROM receipts WHERE transaction_id = $1',
      [transactionId],
    );
    assert.ok(receipt, 'a receipt exists once Remita confirmed the money');
    assert.equal(
      receipt!.amount_kobo,
      String(amountKobo),
      'the receipt is for the money that was actually collected',
    );
  });

  it('reconciles against Remita by asking about each RRR it issued', async () => {
    // `runReconciliation` has only ever run against a hand-written statement
    // pushed into the mock gateway. The path a deployment actually gets —
    // `fetchStatementPerReference`, looping RRRs through the HTTP status query
    // because `REMITA_STATEMENT_PATH` is unset — had never driven it.
    const { transactionId, amountKobo, amountNaira } = await assessKioskLevy('6');
    const payment = await post(
      '/payments/initiate',
      { transactionId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'remita-pay-6' },
    );

    statusBody = remitaPaid(amountNaira);
    const confirm = await post(
      `/payments/${payment.body.paymentId}/confirm`,
      {},
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));

    const summary = await runReconciliation({
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date(Date.now() + 60 * 60 * 1000),
      actorId: null,
      actorRole: 'system',
    });

    assert.equal(summary.status, 'COMPLETED');
    assert.equal(summary.exceptions, 0, 'the money the platform holds is the money Remita holds');

    const line = await queryOne<{ amount_kobo: string; gateway: string; status: string }>(
      pool,
      'SELECT amount_kobo, gateway, status FROM gateway_statement_lines WHERE gateway_reference = $1',
      [STUB_RRR],
    );
    assert.ok(line, 'Remita’s line for this RRR was kept');
    assert.equal(line!.gateway, 'remita');
    assert.equal(line!.status, 'SUCCESS');
    assert.equal(
      line?.amount_kobo,
      String(amountKobo),
      'Remita’s own record of the amount is kept for a dispute',
    );
  });

  it('will not accuse a verified payment when Remita cannot be reached', async () => {
    // The failure mode that makes an outage look like mass fraud: a statement
    // returned empty because nobody answered reads, to reconciliation, as a
    // gateway with no record of any of it.
    const { transactionId, amountNaira } = await assessKioskLevy('7');
    const payment = await post(
      '/payments/initiate',
      { transactionId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'remita-pay-7' },
    );

    statusBody = remitaPaid(amountNaira);
    await post(
      `/payments/${payment.body.paymentId}/confirm`,
      {},
      { token: agent.token, deviceId: agent.device },
    );

    // Remita goes away — genuinely, at the socket, not by a stubbed method.
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    try {
      const summary = await runReconciliation({
        from: new Date(Date.now() - 60 * 60 * 1000),
        to: new Date(Date.now() + 60 * 60 * 1000),
        actorId: null,
        actorRole: 'system',
      });

      assert.equal(summary.status, 'ABORTED', 'a period nobody could ask about is not a clean one');
      assert.equal(summary.exceptions, 0);

      const accused = await query<{ status: string }>(
        pool,
        `SELECT status FROM reconciliation_records
          WHERE gateway_reference = $1 AND status = 'MISSING_PAYMENT'`,
        [STUB_RRR],
      );
      assert.equal(
        accused.length,
        0,
        'a payment Remita confirmed was accused of being missing because Remita was down',
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        stub.once('error', reject);
        stub.listen(REMITA_STUB_PORT, '127.0.0.1', resolve);
      });
    }
  });

  it('issues no receipt when Remita’s figure is not the invoice’s figure', async () => {
    // Found by getting this file's own arithmetic wrong: the stub was told to
    // report ₦5,000 against a ₦3,000 kiosk levy, and the platform refused the
    // receipt and put the transaction under review. That is the right answer
    // and it had never been exercised against a real adapter, so it stays.
    //
    // A gateway reporting a different amount is not a hypothetical. It is what
    // a part-payment, a re-used RRR, or a merchant misconfiguration looks like
    // from here, and receipting it would put a government receipt behind money
    // the state did not receive.
    const { transactionId, amountKobo } = await assessKioskLevy('5');
    const payment = await post(
      '/payments/initiate',
      { transactionId },
      { token: agent.token, deviceId: agent.device, idempotencyKey: 'remita-pay-5' },
    );

    statusBody = remitaPaid(koboToNaira(amountKobo + 200_000n));

    const confirm = await post(
      `/payments/${payment.body.paymentId}/confirm`,
      {},
      { token: agent.token, deviceId: agent.device },
    );

    assert.equal(confirm.status, 409, JSON.stringify(confirm.body));
    assert.equal(confirm.body.error.code, 'PAYMENT_AMOUNT_MISMATCH');
    assert.equal(confirm.body.error.moneyStatus, 'UNCONFIRMED');
    assert.match(confirm.body.error.message, /Do not collect payment again/);

    const receipts = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM receipts WHERE transaction_id = $1',
      [transactionId],
    );
    assert.equal(receipts?.count, '0', 'no receipt stands behind an amount that does not match');
  });
});
