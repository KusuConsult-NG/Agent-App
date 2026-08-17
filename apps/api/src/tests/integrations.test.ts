/**
 * KYC provider and vehicle registry adapter tests.
 *
 * Run against local HTTP servers speaking the shapes a real provider might, so
 * the adapters' actual behaviour is exercised rather than described.
 *
 * The tests that matter most are the ones about being unable to ask. Both
 * adapters have an outcome that means "we could not reach the provider", and
 * the whole point of that outcome is that it must never be mistaken for a
 * verdict:
 *
 *   a KYC outage must not read as a failed identity check;
 *   a registry outage must not read as an unregistered vehicle.
 *
 * Every branch that could collapse the two — a 500, a timeout, a bad key, an
 * unparseable body, an unmapped status word — is tested here for what it does
 * NOT say.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpKycProvider, MockKycProvider } from '../integrations/kyc';
import { HttpVehicleRegistry, MockVehicleRegistry } from '../integrations/vehicles';

// ---------------------------------------------------------------------------
// A stub upstream whose next response each test sets explicitly
// ---------------------------------------------------------------------------

interface StubResponse {
  status: number;
  body: string;
  contentType?: string;
  /** Hold the socket open past the adapter's timeout without replying. */
  delayMs?: number;
}

let server: Server;
let baseUrl = '';
let nextResponse: StubResponse = { status: 200, body: '{}' };
const received: { method: string; url: string; authorization: string; body: string }[] = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: (req.headers.authorization as string) ?? '',
        body: Buffer.concat(chunks).toString(),
      });

      const reply = () => {
        res.writeHead(nextResponse.status, {
          'content-type': nextResponse.contentType ?? 'application/json',
        });
        res.end(nextResponse.body);
      };

      if (nextResponse.delayMs) {
        setTimeout(reply, nextResponse.delayMs).unref();
        return;
      }
      reply();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function respond(response: StubResponse) {
  nextResponse = response;
}

function json(status: number, body: unknown) {
  respond({ status, body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

function kyc(overrides: Partial<ConstructorParameters<typeof HttpKycProvider>[0]> = {}) {
  return new HttpKycProvider({
    name: 'test-kyc',
    url: `${baseUrl}/verify`,
    apiKey: 'test-key',
    timeoutMs: 2000,
    statusPath: 'status',
    referencePath: 'reference',
    livenessPath: 'liveness',
    reasonPath: 'reason',
    clearedValues: ['verified', 'success'],
    failedValues: ['failed', 'no_match'],
    moreInfoValues: ['incomplete'],
    ...overrides,
  });
}

const APPLICANT = {
  identityType: 'NIN',
  identityNumber: '12345678901',
  firstName: 'Amina',
  lastName: 'Dung',
  dateOfBirth: '1992-04-11',
  phone: '+2348030000001',
};

describe('KYC adapter: a verdict about the person', () => {
  it('clears an applicant the provider matched', async () => {
    json(200, { status: 'verified', reference: 'KYC-1', liveness: 'passed', livenessScore: 94 });
    const result = await kyc().verify({ ...APPLICANT, selfieChecksum: 'abc' });

    assert.equal(result.status, 'CLEARED');
    assert.equal(result.reference, 'KYC-1');
    assert.equal(result.livenessResult, 'PASSED');
    assert.equal(result.livenessScore, 94);
    assert.equal(result.failureReason, undefined);
    assert.equal(result.provider, 'test-kyc');
  });

  it('fails an applicant the provider did not match, and says why', async () => {
    json(200, { status: 'no_match', reference: 'KYC-2', reason: 'NIN does not match name' });
    const result = await kyc().verify(APPLICANT);

    assert.equal(result.status, 'FAILED');
    assert.equal(result.failureReason, 'NIN does not match name');
  });

  it('sends the applicant, and the API key, in the request', async () => {
    received.length = 0;
    json(200, { status: 'verified', reference: 'KYC-3' });
    await kyc().verify({ ...APPLICANT, selfieChecksum: 'abc' });

    const request = received.at(-1)!;
    assert.equal(request.method, 'POST');
    assert.equal(request.authorization, 'Bearer test-key');
    const body = JSON.parse(request.body) as Record<string, unknown>;
    assert.equal(body.identityNumber, '12345678901');
    assert.equal(body.selfieProvided, true);
    // The selfie itself is never sent — only that one was captured.
    assert.equal(body.selfieChecksum, undefined);
  });

  it('reads a nested payload when the response path says so', async () => {
    json(200, { data: { status: 'verified', reference: 'KYC-4' } });
    const result = await kyc({
      statusPath: 'data.status',
      referencePath: 'data.reference',
    }).verify(APPLICANT);

    assert.equal(result.status, 'CLEARED');
    assert.equal(result.reference, 'KYC-4');
  });
});

describe('KYC adapter: an outage is not a verdict', () => {
  // Each of these would, if mapped to FAILED, reject a legitimate applicant and
  // leave a record indistinguishable from a genuine identity mismatch.
  const outages: [string, StubResponse][] = [
    ['a 500 from the provider', { status: 500, body: 'upstream exploded' }],
    ['a 502 from a gateway in front of it', { status: 502, body: '<html>bad gateway</html>' }],
    ['a 401 from a mis-provisioned key', { status: 401, body: '{"error":"unauthorised"}' }],
    ['a 429 rate limit', { status: 429, body: '{"error":"slow down"}' }],
  ];

  for (const [description, response] of outages) {
    it(`treats ${description} as UNAVAILABLE, not FAILED`, async () => {
      respond(response);
      const result = await kyc().verify(APPLICANT);

      assert.equal(result.status, 'UNAVAILABLE');
      assert.notEqual(result.status, 'FAILED');
      assert.equal(result.reference, '');
      assert.match(result.failureReason ?? '', /could not|responded/i);
    });
  }

  it('treats a timeout as UNAVAILABLE', async () => {
    respond({ status: 200, body: '{"status":"verified"}', delayMs: 500 });
    const result = await kyc({ timeoutMs: 50 }).verify(APPLICANT);

    assert.equal(result.status, 'UNAVAILABLE');
    assert.match(result.failureReason ?? '', /did not respond in time/i);
  });

  it('treats an unreachable host as UNAVAILABLE', async () => {
    // Port 1 on loopback: nothing listens there.
    const result = await kyc({ url: 'http://127.0.0.1:1/verify' }).verify(APPLICANT);
    assert.equal(result.status, 'UNAVAILABLE');
  });

  it('treats a missing provider URL as UNAVAILABLE rather than crashing', async () => {
    const result = await kyc({ url: '' }).verify(APPLICANT);
    assert.equal(result.status, 'UNAVAILABLE');
    assert.match(result.failureReason ?? '', /no kyc provider url/i);
  });

  it('never throws, whatever the provider does', async () => {
    respond({ status: 200, body: 'not json at all', contentType: 'text/plain' });
    // The caller runs inside a database transaction; an exception here would be
    // a 500 with no explanation of whether the applicant was checked.
    const result = await kyc().verify(APPLICANT);
    assert.equal(result.status, 'UNAVAILABLE');
  });
});

describe('KYC adapter: anything unrecognised puts a human in the loop', () => {
  it('does not clear an applicant on a status nobody mapped', async () => {
    json(200, { status: 'quite possibly fine', reference: 'KYC-5' });
    const result = await kyc().verify(APPLICANT);

    assert.equal(result.status, 'UNDER_REVIEW');
    assert.match(result.failureReason ?? '', /quite possibly fine/);
  });

  it('does not clear an applicant on a missing status', async () => {
    json(200, { reference: 'KYC-6' });
    assert.equal((await kyc().verify(APPLICANT)).status, 'UNDER_REVIEW');
  });

  it('routes a "more information needed" status to the applicant', async () => {
    json(200, { status: 'incomplete', reference: 'KYC-7', reason: 'Upload a clearer photograph' });
    const result = await kyc().verify(APPLICANT);

    assert.equal(result.status, 'VERIFICATION_REQUIRED');
    assert.equal(result.failureReason, 'Upload a clearer photograph');
  });

  it('will not clear an identity whose liveness check failed', async () => {
    // The identity matched a record; the face in front of the camera did not.
    json(200, { status: 'verified', reference: 'KYC-8', liveness: 'failed' });
    const result = await kyc().verify({ ...APPLICANT, selfieChecksum: 'abc' });

    assert.equal(result.status, 'UNDER_REVIEW');
    assert.equal(result.livenessResult, 'FAILED');
    assert.match(result.failureReason ?? '', /liveness/i);
  });
});

describe('mock KYC provider', () => {
  const mock = new MockKycProvider();

  it('reaches every outcome deterministically', async () => {
    const verify = (identityNumber: string) => mock.verify({ ...APPLICANT, identityNumber });

    assert.equal((await verify('12345678901')).status, 'CLEARED');
    assert.equal((await verify('12345678909')).status, 'FAILED');
    assert.equal((await verify('12345678908')).status, 'UNAVAILABLE');
    assert.equal((await verify('12345678900')).status, 'UNDER_REVIEW');
  });

  it('labels itself so a mock verdict is never mistaken for a real one', async () => {
    assert.equal((await mock.verify(APPLICANT)).provider, 'mock');
  });
});

// ---------------------------------------------------------------------------
// Vehicle registry
// ---------------------------------------------------------------------------

function registry(overrides: Partial<ConstructorParameters<typeof HttpVehicleRegistry>[0]> = {}) {
  return new HttpVehicleRegistry({
    name: 'test-registry',
    baseUrl,
    apiKey: 'registry-key',
    timeoutMs: 2000,
    lookupPath: '/vehicles/{registration}',
    renewalPath: '/vehicles/{registration}/renewals',
    recordPath: '',
    statusPath: 'status',
    notFoundValues: ['not_found', 'none'],
    ...overrides,
  });
}

describe('vehicle registry: the authority answered', () => {
  it('returns the record the authority holds', async () => {
    json(200, {
      registrationNumber: 'jos 123 ab',
      chassis: 'CHS-9911',
      make: 'Toyota',
      model: 'Corolla',
      owner_name: 'Dung Pam',
      expiry_date: '2026-03-31T00:00:00.000Z',
      reference: 'VIO-77',
    });

    const result = await registry().lookup('JOS123AB');

    assert.equal(result.outcome, 'FOUND');
    // Normalised on the way in, whatever case and spacing the authority uses.
    assert.equal(result.vehicle?.registrationNumber, 'JOS123AB');
    assert.equal(result.vehicle?.chassisNumber, 'CHS-9911');
    assert.equal(result.vehicle?.ownerName, 'Dung Pam');
    // A timestamp is reduced to the date; the platform stores a DATE.
    assert.equal(result.vehicle?.currentExpiryDate, '2026-03-31');
    assert.equal(result.vehicle?.authorityReference, 'VIO-77');
  });

  it('reads a nested record when the record path says so', async () => {
    json(200, { status: 'ok', data: { vehicle: { plateNumber: 'PLT900XY', make: 'Honda' } } });
    const result = await registry({ recordPath: 'data.vehicle' }).lookup('PLT900XY');

    assert.equal(result.outcome, 'FOUND');
    assert.equal(result.vehicle?.make, 'Honda');
  });

  it('treats a 404 as a real "no such vehicle"', async () => {
    respond({ status: 404, body: '{"message":"no record"}' });
    const result = await registry().lookup('JOS999ZZ');

    assert.equal(result.outcome, 'NOT_FOUND');
    assert.equal(result.vehicle, undefined);
  });

  it('treats a mapped not-found status as a real "no such vehicle"', async () => {
    json(200, { status: 'NOT_FOUND' });
    assert.equal((await registry().lookup('JOS999ZZ')).outcome, 'NOT_FOUND');
  });

  it('puts the registration number in the URL and sends the API key', async () => {
    received.length = 0;
    json(200, { registrationNumber: 'JOS123AB' });
    await registry().lookup('JOS 123/AB');

    const request = received.at(-1)!;
    assert.equal(request.method, 'GET');
    assert.equal(request.authorization, 'Bearer registry-key');
    // Encoded, so a registration with a slash cannot reach a different route.
    assert.equal(request.url, '/vehicles/JOS%20123%2FAB');
  });
});

describe('vehicle registry: an outage is not "unregistered"', () => {
  // If any of these returned NOT_FOUND, an agent would be told the vehicle is
  // not registered and would capture it manually. During a registry outage that
  // would happen to every vehicle in Plateau State, silently.
  const outages: [string, StubResponse][] = [
    ['a 500 from the registry', { status: 500, body: 'database down' }],
    ['a 503 during maintenance', { status: 503, body: 'maintenance' }],
    ['a 401 from a mis-provisioned key', { status: 401, body: '{"error":"unauthorised"}' }],
    ['a 200 carrying an unreadable body', { status: 200, body: 'not json', contentType: 'text/plain' }],
    ['a 200 carrying a list instead of a record', { status: 200, body: '[]' }],
    ['a 200 carrying null', { status: 200, body: 'null' }],
    ['a 200 with no registration number in it', { status: 200, body: '{"make":"Toyota"}' }],
  ];

  for (const [description, response] of outages) {
    it(`treats ${description} as UNAVAILABLE, not NOT_FOUND`, async () => {
      respond(response);
      const result = await registry().lookup('JOS123AB');

      assert.equal(result.outcome, 'UNAVAILABLE');
      assert.notEqual(result.outcome, 'NOT_FOUND');
      assert.equal(result.vehicle, undefined);
      assert.ok((result.reason ?? '').length > 0, 'an outage must say why');
    });
  }

  it('treats a timeout as UNAVAILABLE', async () => {
    respond({ status: 200, body: '{"registrationNumber":"JOS123AB"}', delayMs: 500 });
    const result = await registry({ timeoutMs: 50 }).lookup('JOS123AB');

    assert.equal(result.outcome, 'UNAVAILABLE');
    assert.match(result.reason ?? '', /did not respond in time/i);
  });

  it('treats an unreachable registry as UNAVAILABLE', async () => {
    const result = await registry({ baseUrl: 'http://127.0.0.1:1' }).lookup('JOS123AB');
    assert.equal(result.outcome, 'UNAVAILABLE');
  });

  it('treats a missing registry URL as UNAVAILABLE rather than crashing', async () => {
    const result = await registry({ baseUrl: '' }).lookup('JOS123AB');
    assert.equal(result.outcome, 'UNAVAILABLE');
    assert.match(result.reason ?? '', /no vehicle registry url/i);
  });

  it('never throws, whatever the registry does', async () => {
    respond({ status: 418, body: '' });
    assert.equal((await registry().lookup('JOS123AB')).outcome, 'UNAVAILABLE');
  });
});

describe('vehicle registry: telling the authority about a renewal', () => {
  it('reports acceptance with the authority reference', async () => {
    received.length = 0;
    json(200, { reference: 'ACK-4412' });
    const result = await registry().recordRenewal({
      registrationNumber: 'JOS123AB',
      expiryDate: '2027-01-31',
      documentNumber: 'PSIRS-VEH-000001',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.reference, 'ACK-4412');

    const request = received.at(-1)!;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/vehicles/JOS123AB/renewals');
    assert.equal(
      (JSON.parse(request.body) as Record<string, unknown>).documentNumber,
      'PSIRS-VEH-000001',
    );
  });

  it('accepts a renewal the authority acknowledged without a reference', async () => {
    respond({ status: 204, body: '' });
    const result = await registry().recordRenewal({
      registrationNumber: 'JOS123AB',
      expiryDate: '2027-01-31',
      documentNumber: 'PSIRS-VEH-000002',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.reference, '');
  });

  it('reports a failure to notify without throwing — the renewal still stands', async () => {
    // The taxpayer has paid and holds a receipt. A failure to tell the
    // authority is retryable back-office work, not a failed renewal.
    respond({ status: 500, body: 'registry down' });
    const result = await registry().recordRenewal({
      registrationNumber: 'JOS123AB',
      expiryDate: '2027-01-31',
      documentNumber: 'PSIRS-VEH-000003',
    });

    assert.equal(result.accepted, false);
    assert.match(result.reason ?? '', /responded 500/);
  });
});

describe('mock vehicle registry', () => {
  const mock = new MockVehicleRegistry();

  it('reaches every outcome deterministically', async () => {
    assert.equal((await mock.lookup('JOS123AB')).outcome, 'FOUND');
    assert.equal((await mock.lookup('XYZ123AB')).outcome, 'NOT_FOUND');
    assert.equal((await mock.lookup('ZZZ123AB')).outcome, 'UNAVAILABLE');
  });

  it('normalises the registration number before matching', async () => {
    assert.equal((await mock.lookup('  jos 123 ab ')).outcome, 'FOUND');
    assert.equal((await mock.lookup('  jos 123 ab ')).vehicle?.registrationNumber, 'JOS123AB');
  });

  it('labels itself so a mock record is never mistaken for a real one', async () => {
    assert.equal((await mock.lookup('JOS123AB')).provider, 'mock');
  });

  it('can fail a renewal notification, so that path is exercisable', async () => {
    const accepted = await mock.recordRenewal({
      registrationNumber: 'JOS123AB',
      expiryDate: '2027-01-31',
      documentNumber: 'PSIRS-VEH-000004',
    });
    assert.equal(accepted.accepted, true);

    const failed = await mock.recordRenewal({
      registrationNumber: 'ZZZ123AB',
      expiryDate: '2027-01-31',
      documentNumber: 'PSIRS-VEH-000005',
    });
    assert.equal(failed.accepted, false);
  });
});
