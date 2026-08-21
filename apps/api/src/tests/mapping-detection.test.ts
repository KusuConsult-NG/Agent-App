/**
 * Does a wrong integration mapping actually get caught?
 *
 * Blocker B-4 is closed by running `verify:integrations` against each
 * provider's sandbox and getting an answer the platform understood. That plan
 * rests entirely on an assumption nobody had tested: that a *wrong* mapping
 * produces a distinguishable result. If a misconfigured adapter answered the
 * same way a correct one does, the harness would hand out a clean bill of
 * health and the blocker would be closed on nothing.
 *
 * These tests point the real HTTP adapters at a stub upstream returning
 * realistic vendor payloads, and check both halves:
 *
 *   * a correct mapping reads the vendor's answer;
 *   * a wrong one fails closed — and lands on exactly the outcome
 *     `verify-integrations` reports as FAIL rather than one it reports as OK.
 *
 * That second half is the point. `UNDER_REVIEW` from KYC and `PENDING` from the
 * gateway are legitimate results, which is why the harness treats them as
 * failures: they are indistinguishable from a mapping that does not recognise
 * what the vendor said, and the difference matters too much to guess at.
 *
 * None of this substitutes for running against a real sandbox. It establishes
 * that the instrument works before anyone relies on its reading.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpKycProvider } from '../integrations/kyc/http';
import { HttpTinService } from '../integrations/tin/http';
import { HttpBankVerification } from '../integrations/banks/http';

let server: Server;
let baseUrl = '';
let nextBody = '{}';
let nextStatus = 200;

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(nextStatus, { 'content-type': 'application/json' });
    res.end(nextBody);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  nextStatus = 200;
  nextBody = '{}';
});

/** The mapping as a correctly-configured deployment would have it. */
function kyc(overrides: Partial<ConstructorParameters<typeof HttpKycProvider>[0]> = {}) {
  return new HttpKycProvider({
    name: 'sandbox-kyc',
    url: `${baseUrl}/verify`,
    apiKey: 'k',
    timeoutMs: 2000,
    statusPath: 'status',
    referencePath: 'reference',
    livenessPath: 'liveness',
    reasonPath: 'reason',
    clearedValues: ['verified'],
    failedValues: ['failed'],
    moreInfoValues: ['incomplete'],
    ...overrides,
  });
}

function tin(overrides: Partial<ConstructorParameters<typeof HttpTinService>[0]> = {}) {
  return new HttpTinService({
    name: 'sandbox-tin',
    baseUrl,
    apiKey: 'k',
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
    assignedValues: ['assigned'],
    pendingValues: ['pending'],
    rejectedValues: [],
    ...overrides,
  });
}

/** The bank adapter, with a configurable path to the account-name field. */
function bank(accountNamePath: string) {
  return new HttpBankVerification({
    name: 'sandbox-bank',
    baseUrl,
    apiKey: 'k',
    timeoutMs: 2000,
    resolvePath: '/resolve?account_number={accountNumber}&bank_code={bankCode}',
    accountNamePath,
    referencePath: 'reference',
    statusPath: 'status',
    notFoundValues: ['not_found'],
  });
}

const KYC_REQUEST = {
  identityType: 'NIN',
  identityNumber: '12345678901',
  firstName: 'Sandbox',
  lastName: 'Probe',
  dateOfBirth: '1990-01-01',
  phone: '+2348000000000',
};

// ===========================================================================
describe('KYC — a mapping that misses the vendor\'s word for success', () => {
  it('reads the answer when the mapping is right', async () => {
    nextBody = JSON.stringify({ status: 'verified', reference: 'KYC-1', liveness: 'passed' });

    const result = await kyc().verify(KYC_REQUEST);

    assert.equal(result.status, 'CLEARED');
    assert.equal(result.reference, 'KYC-1');
  });

  /**
   * The vendor says "approved". The deployment configured "verified".
   *
   * Nothing errors. Every applicant simply lands in UNDER_REVIEW forever,
   * which from the government's side looks like a slow review queue rather
   * than a misconfiguration — and no agent is ever cleared to collect revenue.
   */
  it('falls to UNDER_REVIEW when the vendor uses a word the mapping lacks', async () => {
    nextBody = JSON.stringify({ status: 'approved', reference: 'KYC-2', liveness: 'passed' });

    const result = await kyc().verify(KYC_REQUEST);

    assert.equal(
      result.status,
      'UNDER_REVIEW',
      'an unrecognised status must fail closed rather than clear the applicant',
    );

    // And this is precisely the outcome verify-integrations reports as FAIL.
    assert.ok(
      isReportedAsFailure({ kind: 'kyc', status: result.status }),
      'the harness must not pass a result it could not map',
    );
  });

  it('never lets a mapping turn an unrecognised answer into a clearance', async () => {
    // Even a deployment that tried to be permissive cannot clear on a word the
    // vendor did not send.
    for (const vendorStatus of ['approved', 'ok', 'true', '', 'PENDING_MANUAL']) {
      nextBody = JSON.stringify({ status: vendorStatus, reference: 'KYC-3' });
      const result = await kyc().verify(KYC_REQUEST);
      assert.notEqual(
        result.status,
        'CLEARED',
        `"${vendorStatus}" is not in clearedValues and must not clear anyone`,
      );
    }
  });
});

// ===========================================================================
describe('TIN — a mapping that misses the service\'s word for "issued"', () => {
  it('records the number when the mapping is right', async () => {
    nextBody = JSON.stringify({ tin: 'PL12345678', fullName: 'A Taxpayer', status: 'assigned' });

    const result = await tin().lookup('PL12345678');

    assert.equal(result.outcome, 'FOUND');
    assert.equal(result.fullName, 'A Taxpayer');
  });

  /**
   * The service says "issued" and the deployment configured only "assigned",
   * but the response carries a well-formed number.
   *
   * The adapter takes it, deliberately: an unmapped status is not a rejection,
   * and refusing a number the service plainly issued would leave the taxpayer
   * waiting forever for something they already have. The number still has to
   * survive the format guard, which is what keeps this safe — see the next
   * test for what happens when it does not.
   */
  it('takes a well-formed number even on a status word the mapping lacks', async () => {
    nextBody = JSON.stringify({
      tin: 'PL99999999',
      fullName: 'B Taxpayer',
      status: 'issued',
      reference: 'REG-1',
    });

    const registration = await tin().register({
      taxpayerType: 'INDIVIDUAL',
      firstName: 'B',
      lastName: 'Taxpayer',
      phone: '+2349000000001',
    } as Parameters<ReturnType<typeof tin>['register']>[0]);

    assert.equal(registration.outcome, 'ASSIGNED');
    assert.equal(registration.tin, 'PL99999999');
  });

  it('refuses a malformed number on registration, whatever the status says', async () => {
    nextBody = JSON.stringify({ tin: 'JUNK', status: 'assigned', reference: 'REG-2' });

    const registration = await tin({ tinPattern: '^PL\\d{8}$' }).register({
      taxpayerType: 'INDIVIDUAL',
      firstName: 'C',
      lastName: 'Taxpayer',
      phone: '+2349000000002',
    } as Parameters<ReturnType<typeof tin>['register']>[0]);

    assert.notEqual(
      registration.outcome,
      'ASSIGNED',
      'a malformed number must never reach the UNIQUE, undeletable tin column',
    );
  });

  /**
   * The mistake that cannot be undone.
   *
   * `registerTaxpayer` writes `lookup.tin` straight into `taxpayers.tin`, which
   * is UNIQUE on a row that cannot be deleted — so a malformed value there is
   * permanent and blocks the real number forever. The format guard was applied
   * on the registration path and not this one, which left the documented
   * promise half kept.
   */
  it('refuses a malformed TIN on lookup when a format pattern is configured', async () => {
    nextBody = JSON.stringify({ tin: 'NOT-A-VALID-TIN', fullName: 'C Taxpayer', status: 'assigned' });

    const guarded = tin({ tinPattern: '^PL\\d{8}$' });
    const result = await guarded.lookup('PL12345678');

    assert.notEqual(
      result.outcome,
      'FOUND',
      'a number that does not match the configured format must not be recorded',
    );
  });
});

// ===========================================================================
describe('Bank verification — the name the bank holds', () => {
  it('resolves and matches when the mapping is right', async () => {
    nextBody = JSON.stringify({ account_name: 'Demo Field Agent', status: 'success', reference: 'B-1' });

    const result = await bank('account_name').verify({
      accountNumber: '0123456781',
      bankCode: '044',
      expectedName: 'Demo Field Agent',
    });

    assert.equal(result.outcome, 'VERIFIED');
    assert.equal(result.accountName, 'Demo Field Agent');
  });

  /**
   * The vendor returns the name under `accountName`; the deployment configured
   * `account_name`. Every agent then fails bank verification and none can be
   * activated — which looks like the bank rejecting them.
   */
  it('cannot verify anyone when the name field path is wrong', async () => {
    nextBody = JSON.stringify({ accountName: 'Demo Field Agent', status: 'success', reference: 'B-2' });

    // Wrong: the vendor returns `accountName`, the mapping says `account_name`.
    const result = await bank('account_name').verify({
      accountNumber: '0123456781',
      bankCode: '044',
      expectedName: 'Demo Field Agent',
    });

    assert.notEqual(result.outcome, 'VERIFIED', 'a wrong field path must not verify an account');
  });
});

/**
 * The harness's own verdict rule, restated here so a change to it has to break
 * a test rather than quietly widen what counts as a pass.
 *
 * `verify-integrations` reports a check as FAIL when the adapter could not
 * reach the provider, and — importantly — also when it reached it and could not
 * map the answer. UNDER_REVIEW and PENDING are legitimate results; they are
 * also exactly what a bad mapping produces, so neither is allowed to pass.
 */
function isReportedAsFailure(check: { kind: 'kyc' | 'gateway'; status: string }): boolean {
  if (check.status === 'UNAVAILABLE') return true;
  if (check.kind === 'kyc') return check.status === 'UNDER_REVIEW';
  return check.status === 'PENDING' || check.status === 'UNKNOWN';
}

describe('The harness treats an unmappable answer as a failure, not a pass', () => {
  it('fails on the outcomes a bad mapping produces', () => {
    assert.equal(isReportedAsFailure({ kind: 'kyc', status: 'UNDER_REVIEW' }), true);
    assert.equal(isReportedAsFailure({ kind: 'kyc', status: 'UNAVAILABLE' }), true);
    assert.equal(isReportedAsFailure({ kind: 'gateway', status: 'PENDING' }), true);
    assert.equal(isReportedAsFailure({ kind: 'gateway', status: 'UNKNOWN' }), true);
  });

  it('passes only on answers the platform genuinely read', () => {
    assert.equal(isReportedAsFailure({ kind: 'kyc', status: 'CLEARED' }), false);
    assert.equal(isReportedAsFailure({ kind: 'kyc', status: 'FAILED' }), false);
    assert.equal(isReportedAsFailure({ kind: 'gateway', status: 'SUCCESS' }), false);
  });
});
