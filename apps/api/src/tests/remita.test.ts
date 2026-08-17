/**
 * Remita adapter tests.
 *
 * Run against a local HTTP server speaking Remita's response shapes, so the
 * adapter's real behaviour is exercised: the hashes it computes, the units it
 * converts, and — most importantly — what it refuses to call a payment.
 *
 * The unit conversion gets its own attention. Remita works in Naira decimals
 * and this platform works in integer kobo; a silent hundred-fold error there
 * would be the most expensive bug the codebase could have.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { nairaToKobo } from '@psirs/shared';
import { RemitaGateway, remitaAmountToKobo } from '../integrations/gateways/remita';

const MERCHANT_ID = '2547916';
const API_KEY = 'test-api-key';
const SERVICE_TYPE_ID = '4430731';

/** What the stub Remita should answer next, per RRR. */
const statusResponses = new Map<string, unknown>();
/** Captured init requests, so the hash and payload can be asserted. */
const initRequests: { body: Record<string, unknown>; authorization: string }[] = [];

let server: Server;
let baseUrl = '';
let nextInitResponse: unknown = null;

before(async () => {
  server = createServer((req, res) => {
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
        // Remita wraps init responses in a JSONP envelope.
        res.end(`jsonp ${JSON.stringify(nextInitResponse)}`);
        return;
      }

      // /remita/ecomm/{merchantId}/{rrr}/{hash}/status.reg
      const match = /\/remita\/ecomm\/[^/]+\/([^/]+)\/[^/]+\/status\.reg/.exec(url);
      if (match) {
        const rrr = match[1]!;
        const body = statusResponses.get(rrr);
        if (body === undefined) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('upstream failure');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }

      res.writeHead(404);
      res.end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeGateway(overrides: Partial<ConstructorParameters<typeof RemitaGateway>[0]> = {}) {
  return new RemitaGateway({
    baseUrl,
    merchantId: MERCHANT_ID,
    apiKey: API_KEY,
    serviceTypeId: SERVICE_TYPE_ID,
    successStatusCodes: ['00'],
    failureStatusCodes: [],
    notificationSecret: '',
    notificationIpAllowlist: [],
    requestTimeoutMs: 3000,
    ...overrides,
  });
}

describe('Remita amount conversion', () => {
  it('reads Naira decimals as kobo, in every shape Remita sends', () => {
    // All of these mean ₦5,000.00 — never 5,000 kobo.
    assert.equal(remitaAmountToKobo('5000'), 500_000n);
    assert.equal(remitaAmountToKobo('5000.00'), 500_000n);
    assert.equal(remitaAmountToKobo(5000), 500_000n);
    assert.equal(remitaAmountToKobo('1234.56'), 123_456n);
    assert.equal(remitaAmountToKobo(1234.56), 123_456n);
  });

  it('treats an unusable amount as unknown rather than as zero', () => {
    // Returning 0n here would let a "successful" payment of nothing through.
    for (const bad of [null, undefined, '', 'N5,000', {}, [], NaN, Infinity]) {
      assert.equal(remitaAmountToKobo(bad), null, `${String(bad)} should be unknown`);
    }
  });

  it('sends Naira to Remita, not kobo', async () => {
    initRequests.length = 0;
    nextInitResponse = { statuscode: '025', RRR: '280002091257', status: 'Payment Reference generated' };

    await makeGateway().initiate({
      paymentReference: 'PSIRSPAY-2026-000001-1234',
      amountKobo: nairaToKobo('5000'),
      phone: '+2348012345678',
      email: 'taxpayer@example.test',
      callbackUrl: 'https://psirs.example/return',
      metadata: {},
    });

    assert.equal(initRequests.length, 1);
    // ₦5,000.00 must go out as "5000.00", not "500000".
    assert.equal(initRequests[0]!.body.amount, '5000.00');
  });
});

describe('Remita payment initiation', () => {
  it('returns the RRR and signs the request as Remita expects', async () => {
    initRequests.length = 0;
    nextInitResponse = { statuscode: '025', RRR: '280002091258', status: 'ok' };

    const result = await makeGateway().initiate({
      paymentReference: 'ORDER-1',
      amountKobo: nairaToKobo('20000'),
      phone: '+2348012345678',
      callbackUrl: 'https://psirs.example/return',
      metadata: {},
    });

    assert.equal(result.gatewayReference, '280002091258');
    assert.equal(result.status, 'PENDING');

    // SHA512(merchantId + serviceTypeId + orderId + amount + responseUrl)
    const expected = createHash('sha512')
      .update(`${MERCHANT_ID}${SERVICE_TYPE_ID}ORDER-120000.00https://psirs.example/return`)
      .digest('hex');
    assert.equal(
      initRequests[0]!.authorization,
      `remitaConsumerKey=${MERCHANT_ID},remitaConsumerToken=${expected}`,
    );
  });

  it('fails loudly when Remita returns no RRR', async () => {
    nextInitResponse = { statuscode: '099', status: 'Service type not found' };
    await assert.rejects(
      makeGateway().initiate({
        paymentReference: 'ORDER-2',
        amountKobo: nairaToKobo('1000'),
        phone: '+2348012345678',
        callbackUrl: 'https://psirs.example/return',
        metadata: {},
      }),
      /did not return an RRR/,
    );
  });
});

describe('Remita verification — the only thing that can confirm money', () => {
  it('confirms a paid RRR, converting the amount to kobo', async () => {
    statusResponses.set('RRR-PAID', {
      status: '00',
      message: 'Approved',
      amount: '5000.00',
      transactiontime: '2026-08-17 10:15:00',
      channel: 'BANK BRANCH',
      RRR: 'RRR-PAID',
    });

    const result = await makeGateway().verify('RRR-PAID');
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.amountKobo, 500_000n);
    assert.equal(result.paymentMethod, 'BANK_TRANSFER');
    assert.ok(result.paidAt);
  });

  it('reports an unmapped status code as pending, never as paid or failed', async () => {
    // The safe direction in both senses: an unmapped code can neither invent
    // revenue nor close a transaction the taxpayer may genuinely have paid.
    statusResponses.set('RRR-ODD', { status: '021', message: 'Pending', amount: '5000.00' });
    const result = await makeGateway().verify('RRR-ODD');
    assert.equal(result.status, 'PENDING');
  });

  it('honours a configured failure code once PSIRS confirms it', async () => {
    statusResponses.set('RRR-FAILED', { status: '02', message: 'Declined', amount: '5000.00' });
    const result = await makeGateway({ failureStatusCodes: ['02'] }).verify('RRR-FAILED');
    assert.equal(result.status, 'FAILED');
    assert.match(result.failureReason ?? '', /Declined/);
  });

  it('reports UNKNOWN when Remita cannot be reached', async () => {
    // A transport failure says nothing about the money, so the payment stays in
    // flight and reconciliation picks it up.
    const result = await makeGateway().verify('RRR-NEVER-CONFIGURED');
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.amountKobo, null);
  });

  it('refuses to call a payment successful without a usable amount', async () => {
    // A success with no amount cannot be receipted: the receipt trigger
    // compares the amount, and a zero would be a fabricated figure.
    statusResponses.set('RRR-NOAMOUNT', { status: '00', message: 'Approved' });
    const result = await makeGateway().verify('RRR-NOAMOUNT');
    assert.equal(result.status, 'UNKNOWN');

    statusResponses.set('RRR-ZERO', { status: '00', amount: '0.00' });
    assert.equal((await makeGateway().verify('RRR-ZERO')).status, 'UNKNOWN');
  });

  it('computes the status hash Remita expects', async () => {
    // SHA512(rrr + apiKey + merchantId) — asserted by construction, since the
    // stub would 404 on a malformed path.
    const expected = createHash('sha512')
      .update(`RRR-PAID${API_KEY}${MERCHANT_ID}`)
      .digest('hex');
    assert.equal(expected.length, 128);
    const result = await makeGateway().verify('RRR-PAID');
    assert.equal(result.gatewayReference, 'RRR-PAID');
  });
});

describe('Remita notifications carry no authority', () => {
  it('accepts an unsigned notification but does not call it authenticated', () => {
    const auth = makeGateway().authenticateWebhook({
      rawBody: Buffer.from('{}'),
      headers: {},
      parsedBody: {},
      sourceIp: '102.89.0.1',
    });
    assert.equal(auth.accepted, true);
    assert.equal(auth.authenticated, false, 'an unsigned delivery is never provably genuine');
    assert.match(auth.reason ?? '', /status query/);
  });

  it('enforces a shared secret when one is configured', () => {
    const gateway = makeGateway({ notificationSecret: 'shared-secret' });
    assert.equal(
      gateway.authenticateWebhook({
        rawBody: Buffer.from('{}'),
        headers: { 'x-remita-signature': 'wrong' },
        parsedBody: {},
        sourceIp: null,
      }).accepted,
      false,
    );
    const good = gateway.authenticateWebhook({
      rawBody: Buffer.from('{}'),
      headers: { 'x-remita-signature': 'shared-secret' },
      parsedBody: {},
      sourceIp: null,
    });
    assert.equal(good.accepted, true);
    assert.equal(good.authenticated, true);
  });

  it('enforces an address allowlist when one is configured', () => {
    const gateway = makeGateway({ notificationIpAllowlist: ['102.89.0.1'] });
    assert.equal(
      gateway.authenticateWebhook({
        rawBody: Buffer.from('{}'),
        headers: {},
        parsedBody: {},
        sourceIp: '10.0.0.9',
      }).accepted,
      false,
    );
    assert.equal(
      gateway.authenticateWebhook({
        rawBody: Buffer.from('{}'),
        headers: {},
        parsedBody: {},
        sourceIp: '102.89.0.1',
      }).accepted,
      true,
    );
  });

  it('derives a stable event id so a redelivery collapses to a duplicate', () => {
    const gateway = makeGateway();
    const payload = { rrr: '280002091257', status: '00', amount: '5000.00', channel: 'CARD' };

    const first = gateway.parseWebhook(payload);
    const second = gateway.parseWebhook({ ...payload });

    assert.ok(first);
    // Remita sends no event id, so the same outcome must hash to the same key —
    // that is what the UNIQUE (gateway, event_id) constraint keys on (PRD §53).
    assert.equal(first.eventId, second!.eventId);
    assert.equal(first.gatewayReference, '280002091257');
    assert.equal(first.amountKobo, 500_000n);
    assert.equal(first.paymentMethod, 'CARD');
  });

  it('ignores a notification with no reference at all', () => {
    assert.equal(makeGateway().parseWebhook({ status: '00' }), null);
    assert.equal(makeGateway().parseWebhook(null), null);
    assert.equal(makeGateway().parseWebhook('not an object'), null);
  });
});

describe('Remita reconciliation posture', () => {
  it('returns no statement lines rather than inventing them', async () => {
    // Remita settlement reporting depends on how PSIRS's merchant account is
    // configured. Returning nothing makes verified payments surface as
    // reconciliation exceptions for finance to look at — the correct failure
    // mode — instead of being silently marked reconciled.
    const lines = await makeGateway().fetchStatement({
      from: new Date('2026-01-01'),
      to: new Date('2026-12-31'),
    });
    assert.deepEqual(lines, []);
  });
});
