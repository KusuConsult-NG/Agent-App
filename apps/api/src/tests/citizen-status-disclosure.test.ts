/**
 * What a stranger is told about somebody else's tax affairs.
 *
 * `/citizen-status` is the platform's one unauthenticated read of a named
 * person's record. It is deliberately open — a citizen with a feature phone
 * and no account has to be able to check whether they owe anything — and the
 * price of that openness is that it cannot tell the taxpayer apart from
 * anyone else who knows their phone number. A phone number is not a secret.
 * A rival trader, a lender, a former partner or a local official may all have
 * it, so every field must be read as though a stranger asked for it.
 *
 * Three groups of field did not survive that reading and are now withheld:
 *
 *   the TIN — the caller supplied a phone number and was handed back a
 *   government identifier they did not have. The platform's own duplicate
 *   detection treats a matching TIN as identity-grade, blocking at 100 where
 *   a shared phone scores only 85; returning the stronger identifier in
 *   exchange for the weaker one inverts that judgement;
 *
 *   the numeric compliance score and the programmes it unlocks — under the
 *   incentive design these decide access to fertiliser, health insurance and
 *   farm inputs, which makes a person's score consequential enough that it is
 *   nobody else's business;
 *
 *   the obligation names and the last payment date — "Cattle Dealer Levy"
 *   describes somebody's livelihood, and a payment date their circumstances.
 *
 * What remains is what a person needs in order to act. The full record is
 * still available through the agent and officer channels, which establish who
 * they are speaking to first.
 */

import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let taxpayerPhone = '';
let taxpayerTin: string | null = null;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  const lgaId = await firstLgaId();

  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000170',
    fullName: 'Disclosure Admin',
  });

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);

  taxpayerPhone = '+2348037654321';
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      lastName: 'Danjuma',
      phone: taxpayerPhone,
      address: '9 Market Road, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: session.accessToken, deviceId: demo!.deviceIdentifier, idempotencyKey: 'disclosure-1' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));

  // Give the record a TIN, so that withholding it is a real choice rather
  // than an absence of data.
  await pool.query(`UPDATE taxpayers SET tin = '900112233', tin_status = 'ASSIGNED' WHERE phone = $1`, [
    taxpayerPhone,
  ]);
  taxpayerTin = '900112233';
});

/** The endpoint is public: these requests carry no token at all. */
const anonymous = () => ({});

describe('a stranger looking someone up by phone number', () => {
  it('finds the record — the check is meant to be usable', async () => {
    const response = await get(
      `/citizen-status?phone=${encodeURIComponent(taxpayerPhone)}`,
      anonymous(),
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.found, true);
  });

  it('is not handed the TIN', async () => {
    const response = await get(
      `/citizen-status?phone=${encodeURIComponent(taxpayerPhone)}`,
      anonymous(),
    );
    const body = JSON.stringify(response.body);
    assert.equal(response.body.tin, undefined, `TIN was returned: ${body}`);
    assert.ok(!body.includes(taxpayerTin!), `the TIN appears somewhere in the body: ${body}`);
  });

  it('is not handed the compliance score, the obligations or the programmes', async () => {
    const response = await get(
      `/citizen-status?phone=${encodeURIComponent(taxpayerPhone)}`,
      anonymous(),
    );
    assert.equal(response.body.complianceScore, undefined);
    assert.equal(response.body.obligations, undefined);
    assert.equal(response.body.eligibleProgrammes, undefined);
    assert.equal(response.body.lastPaymentDate, undefined);
    assert.equal(response.body.outstandingAmountKobo, undefined);
  });

  it('is still told enough to act on', async () => {
    const response = await get(
      `/citizen-status?phone=${encodeURIComponent(taxpayerPhone)}`,
      anonymous(),
    );
    assert.equal(typeof response.body.hasOutstanding, 'boolean');
    assert.ok(typeof response.body.message === 'string' && response.body.message.length > 10);
    assert.match(response.body.detail ?? '', /PSIRS office|revenue agent/i);
  });
});

describe('a stranger looking someone up by TIN', () => {
  it('is held to the same limits, because a TIN is not proof of identity either', async () => {
    const response = await get(`/citizen-status?tin=${taxpayerTin}`, anonymous());
    assert.equal(response.status, 200);
    assert.equal(response.body.found, true);
    assert.equal(response.body.complianceScore, undefined);
    assert.equal(response.body.obligations, undefined);
    assert.equal(response.body.outstandingAmountKobo, undefined);
  });
});

describe('a stranger searching by name', () => {
  it('is given a count and told to use a stronger identifier, never a record', async () => {
    const response = await get('/citizen-status?name=Danjuma', anonymous());
    assert.equal(response.status, 200);
    assert.equal(response.body.tin, undefined);
    assert.equal(response.body.complianceStatus, undefined);
    assert.match(response.body.message, /TIN or phone number|No record/i);
  });
});

describe('a phone number nobody has registered', () => {
  it('is answered without confirming anything about anyone else', async () => {
    const response = await get('/citizen-status?phone=%2B2348039999999', anonymous());
    assert.equal(response.status, 200);
    assert.equal(response.body.found, false);
    assert.equal(response.body.tin, undefined);
  });
});
