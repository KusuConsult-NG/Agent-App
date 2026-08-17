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
import { HttpTinService, MockTinService } from '../integrations/tin';
import { HttpBankVerification, MockBankVerification, matchesAccountName } from '../integrations/banks';

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

// ---------------------------------------------------------------------------
// TIN service
// ---------------------------------------------------------------------------

function tin(overrides: Partial<ConstructorParameters<typeof HttpTinService>[0]> = {}) {
  return new HttpTinService({
    name: 'test-tin',
    baseUrl,
    apiKey: 'tin-key',
    timeoutMs: 2000,
    lookupPath: '/tins/{tin}',
    registerPath: '/tins',
    tinPath: 'tin',
    namePath: 'fullName',
    typePath: 'taxpayerType',
    statusPath: 'status',
    referencePath: 'reference',
    messagePath: 'message',
    notFoundValues: ['not_found'],
    assignedValues: ['assigned', 'success'],
    pendingValues: ['pending'],
    rejectedValues: ['rejected'],
    ...overrides,
  });
}

const APPLICANT_TIN = {
  taxpayerType: 'INDIVIDUAL' as const,
  firstName: 'Danladi',
  lastName: 'Musa',
  phone: '+2347011000001',
  address: '14 Rwang Pam Street, Jos',
  lgaName: 'Jos North',
};

describe('TIN service: the service answered', () => {
  it('returns an existing TIN', async () => {
    json(200, { tin: '123456789', fullName: 'Danladi Musa', taxpayerType: 'individual' });
    const result = await tin().lookup('123456789');

    assert.equal(result.outcome, 'FOUND');
    assert.equal(result.tin, '123456789');
    assert.equal(result.taxpayerType, 'INDIVIDUAL');
  });

  it('treats a 404 as a real "no such TIN"', async () => {
    respond({ status: 404, body: '{}' });
    assert.equal((await tin().lookup('123456789')).outcome, 'NOT_FOUND');
  });

  it('records an assigned TIN', async () => {
    json(200, { status: 'assigned', tin: '  987654321  ', reference: 'TIN-1' });
    const result = await tin().register(APPLICANT_TIN);

    assert.equal(result.outcome, 'ASSIGNED');
    assert.equal(result.tin, '987654321');
    assert.equal(result.reference, 'TIN-1');
  });

  it('reports a rejection as a rejection', async () => {
    json(200, { status: 'rejected', reference: 'TIN-2', message: 'Date of birth is required' });
    const result = await tin().register(APPLICANT_TIN);

    assert.equal(result.outcome, 'REJECTED');
    assert.equal(result.message, 'Date of birth is required');
  });
});

describe('TIN service: a TIN is never invented', () => {
  // taxpayers.tin is UNIQUE on a row that cannot be deleted, so a junk value
  // written here is permanent AND blocks the real number from ever landing.
  const unusable = [
    ['a blank string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['a number-shaped object', {}],
    ['an array', []],
    ['false', false],
  ] as const;

  for (const [description, value] of unusable) {
    it(`will not report "success" carrying ${description} as ASSIGNED`, async () => {
      json(200, { status: 'assigned', tin: value, reference: 'TIN-3' });
      const result = await tin().register(APPLICANT_TIN);

      assert.equal(result.outcome, 'PENDING');
      assert.equal(result.tin, undefined);
      // PENDING keeps a reference, so the registration can be chased.
      assert.equal(result.reference, 'TIN-3');
    });
  }

  it('rejects a TIN that does not match the configured format', async () => {
    json(200, { status: 'assigned', tin: 'NOT-A-TIN', reference: 'TIN-4' });
    const result = await tin({ tinPattern: '^\\d{8,12}$' }).register(APPLICANT_TIN);

    assert.equal(result.outcome, 'PENDING');
    assert.equal(result.tin, undefined);
  });

  it('accepts a TIN that does match the configured format', async () => {
    json(200, { status: 'assigned', tin: '123456789', reference: 'TIN-5' });
    const result = await tin({ tinPattern: '^\\d{8,12}$' }).register(APPLICANT_TIN);

    assert.equal(result.outcome, 'ASSIGNED');
    assert.equal(result.tin, '123456789');
  });

  it('takes a usable TIN even when the status word is unmapped', async () => {
    // The number is the fact; the vocabulary is the vendor's.
    json(200, { status: 'all good', tin: '123456789', reference: 'TIN-6' });
    assert.equal((await tin().register(APPLICANT_TIN)).outcome, 'ASSIGNED');
  });

  it('leaves an unmapped status with no TIN in flight, not rejected', async () => {
    json(200, { status: 'who knows', reference: 'TIN-7' });
    const result = await tin().register(APPLICANT_TIN);

    assert.equal(result.outcome, 'PENDING');
    assert.notEqual(result.outcome, 'REJECTED');
  });
});

describe('TIN service: an outage never says "no such TIN"', () => {
  // NOT_FOUND is the answer that makes an agent register a duplicate, and a
  // duplicate TIN in a UNIQUE column on an undeletable row is permanent.
  const outages: [string, StubResponse][] = [
    ['a 500', { status: 500, body: 'down' }],
    ['a 401', { status: 401, body: '{}' }],
    ['a 200 with an unreadable body', { status: 200, body: 'not json', contentType: 'text/plain' }],
    ['a 200 with no TIN in it', { status: 200, body: '{"fullName":"Danladi Musa"}' }],
  ];

  for (const [description, response] of outages) {
    it(`treats ${description} as UNAVAILABLE on lookup`, async () => {
      respond(response);
      const result = await tin().lookup('123456789');

      assert.equal(result.outcome, 'UNAVAILABLE');
      assert.notEqual(result.outcome, 'NOT_FOUND');
    });
  }

  it('treats an outage on register as UNAVAILABLE, not REJECTED', async () => {
    respond({ status: 503, body: 'maintenance' });
    const result = await tin().register(APPLICANT_TIN);

    assert.equal(result.outcome, 'UNAVAILABLE');
    assert.notEqual(result.outcome, 'REJECTED');
    assert.match(result.message, /responded 503/);
  });

  it('treats a timeout as UNAVAILABLE on both operations', async () => {
    respond({ status: 200, body: '{"tin":"123456789"}', delayMs: 500 });
    assert.equal((await tin({ timeoutMs: 50 }).lookup('123456789')).outcome, 'UNAVAILABLE');

    respond({ status: 200, body: '{"status":"assigned","tin":"1"}', delayMs: 500 });
    assert.equal((await tin({ timeoutMs: 50 }).register(APPLICANT_TIN)).outcome, 'UNAVAILABLE');
  });

  it('never throws, whatever the service does', async () => {
    respond({ status: 418, body: '' });
    assert.equal((await tin().lookup('1')).outcome, 'UNAVAILABLE');
    assert.equal((await tin().register(APPLICANT_TIN)).outcome, 'UNAVAILABLE');
  });
});

describe('mock TIN service', () => {
  const mock = new MockTinService();

  it('reaches every outcome deterministically', async () => {
    const register = (phone: string) => mock.register({ ...APPLICANT_TIN, phone });

    assert.equal((await register('+2347011000001')).outcome, 'ASSIGNED');
    assert.equal((await register('+2347011000007')).outcome, 'PENDING');
    assert.equal((await register('+2347011000008')).outcome, 'UNAVAILABLE');
    assert.equal((await register('+2347011000009')).outcome, 'REJECTED');

    assert.equal((await mock.lookup('123456781')).outcome, 'FOUND');
    assert.equal((await mock.lookup('123456788')).outcome, 'UNAVAILABLE');
    assert.equal((await mock.lookup('nonsense')).outcome, 'NOT_FOUND');
  });

  it('gives the same person the same TIN, as the real service would', async () => {
    // Otherwise every duplicate-control test would pass for the wrong reason.
    const first = await mock.register(APPLICANT_TIN);
    const second = await mock.register(APPLICANT_TIN);
    assert.equal(first.tin, second.tin);
    assert.ok(first.tin);
  });
});

// ---------------------------------------------------------------------------
// Bank account verification
// ---------------------------------------------------------------------------

describe('Bank account name matching', () => {
  // This rule decides where an agent's commission is paid. It has to tolerate
  // how Nigerian banks actually return names, without ever accepting a
  // different person.
  const shouldMatch: [string, string][] = [
    ['Danladi Musa', 'DANLADI MUSA'],
    ['Danladi Musa', 'MUSA DANLADI'],
    ['Danladi Musa', 'MUSA DANLADI IBRAHIM'],
    ['Danladi Musa Ibrahim', 'MUSA DANLADI'],
    ['Danladi M. Musa', 'DANLADI MUSA'],
    ['Danladi  Musa', 'musa   danladi'],
    ["Ngo'ale Dung", 'DUNG NGOALE'],
    ['Mary-Jane Pam', 'PAM MARY-JANE'],
  ];

  for (const [expected, actual] of shouldMatch) {
    it(`matches "${expected}" with "${actual}"`, () => {
      assert.equal(matchesAccountName(expected, actual), true);
    });
  }

  const shouldNotMatch: [string, string][] = [
    ['Danladi Musa', 'CHINEDU OKAFOR'],
    // One shared name is not enough — half the state shares a surname.
    ['Danladi Musa', 'IBRAHIM MUSA'],
    ['Danladi Musa', 'DANLADI OKAFOR'],
    ['Musa', 'MUSA DANLADI'],
    ['Danladi Musa', ''],
    ['', 'DANLADI MUSA'],
    ['Danladi Musa', '   '],
    // A surname in common plus an initial that does not expand.
    ['D Musa', 'CHINEDU MUSA'],
  ];

  for (const [expected, actual] of shouldNotMatch) {
    it(`refuses "${expected}" against "${actual}"`, () => {
      assert.equal(matchesAccountName(expected, actual), false);
    });
  }

  it('does not let one name part satisfy two', () => {
    // "MUSA MUSA" must not match "MUSA DANLADI" by reusing the same part.
    assert.equal(matchesAccountName('Musa Musa', 'MUSA DANLADI'), false);
  });
});

function bank(overrides: Partial<ConstructorParameters<typeof HttpBankVerification>[0]> = {}) {
  return new HttpBankVerification({
    name: 'test-bank',
    baseUrl,
    apiKey: 'bank-key',
    timeoutMs: 2000,
    resolvePath: '/resolve?account_number={accountNumber}&bank_code={bankCode}',
    accountNamePath: 'account_name',
    referencePath: 'reference',
    statusPath: 'status',
    notFoundValues: ['not_found', 'invalid_account'],
    ...overrides,
  });
}

const ACCOUNT = { bankCode: '044', accountNumber: '0123456781', expectedName: 'Danladi Musa' };

describe('Bank verification: the bank answered', () => {
  it('verifies an account in the agent\'s own name', async () => {
    json(200, { status: 'success', account_name: 'MUSA DANLADI', reference: 'BNK-1' });
    const result = await bank().verify(ACCOUNT);

    assert.equal(result.outcome, 'VERIFIED');
    assert.equal(result.accountName, 'MUSA DANLADI');
    assert.equal(result.reference, 'BNK-1');
  });

  it('reports an account held by someone else as a mismatch, with the name', async () => {
    json(200, { status: 'success', account_name: 'CHINEDU OKAFOR', reference: 'BNK-2' });
    const result = await bank().verify(ACCOUNT);

    assert.equal(result.outcome, 'MISMATCH');
    // The agent needs to see this to spot a mistyped digit.
    assert.equal(result.accountName, 'CHINEDU OKAFOR');
    assert.match(result.failureReason ?? '', /CHINEDU OKAFOR/);
  });

  it('reports a 404 as no such account', async () => {
    respond({ status: 404, body: '{}' });
    assert.equal((await bank().verify(ACCOUNT)).outcome, 'NOT_FOUND');
  });

  it('reports a mapped not-found status as no such account', async () => {
    json(200, { status: 'invalid_account' });
    assert.equal((await bank().verify(ACCOUNT)).outcome, 'NOT_FOUND');
  });

  it('puts the account and bank code in the URL', async () => {
    received.length = 0;
    json(200, { status: 'success', account_name: 'DANLADI MUSA' });
    await bank().verify(ACCOUNT);

    assert.equal(received.at(-1)!.url, '/resolve?account_number=0123456781&bank_code=044');
    assert.equal(received.at(-1)!.authorization, 'Bearer bank-key');
  });
});

describe('Bank verification: an outage is not a wrong account', () => {
  // A FAILED bank account blocks clearance and reads like the account belongs
  // to someone else. An applicant whose bank was down must not carry that.
  const outages: [string, StubResponse][] = [
    ['a 500', { status: 500, body: 'down' }],
    ['a 401 from a bad key', { status: 401, body: '{}' }],
    ['a 429 rate limit', { status: 429, body: '{}' }],
    ['a 200 with an unreadable body', { status: 200, body: 'nope', contentType: 'text/plain' }],
    ['a 200 with no account name', { status: 200, body: '{"status":"success"}' }],
  ];

  for (const [description, response] of outages) {
    it(`treats ${description} as UNAVAILABLE, not MISMATCH or NOT_FOUND`, async () => {
      respond(response);
      const result = await bank().verify(ACCOUNT);

      assert.equal(result.outcome, 'UNAVAILABLE');
      assert.notEqual(result.outcome, 'MISMATCH');
      assert.notEqual(result.outcome, 'NOT_FOUND');
    });
  }

  it('treats a timeout as UNAVAILABLE', async () => {
    respond({ status: 200, body: '{"account_name":"DANLADI MUSA"}', delayMs: 500 });
    assert.equal((await bank({ timeoutMs: 50 }).verify(ACCOUNT)).outcome, 'UNAVAILABLE');
  });

  it('treats a missing URL as UNAVAILABLE rather than crashing', async () => {
    const result = await bank({ baseUrl: '' }).verify(ACCOUNT);
    assert.equal(result.outcome, 'UNAVAILABLE');
    assert.match(result.failureReason ?? '', /no bank verification url/i);
  });

  it('never throws, whatever the bank does', async () => {
    respond({ status: 418, body: '' });
    assert.equal((await bank().verify(ACCOUNT)).outcome, 'UNAVAILABLE');
  });
});

describe('mock bank verification', () => {
  const mock = new MockBankVerification();

  it('reaches every outcome deterministically', async () => {
    const verify = (accountNumber: string) => mock.verify({ ...ACCOUNT, accountNumber });

    assert.equal((await verify('0123456781')).outcome, 'VERIFIED');
    assert.equal((await verify('0123456788')).outcome, 'UNAVAILABLE');
    assert.equal((await verify('0123456789')).outcome, 'MISMATCH');
    assert.equal((await verify('12345')).outcome, 'NOT_FOUND');
  });
});
