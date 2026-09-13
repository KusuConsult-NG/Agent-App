/**
 * Agent clearance, on the real KYC adapter, through the real API.
 *
 * The identity check is what stands between an applicant and the authority to
 * collect government revenue, and every clearance in this codebase has been
 * answered by `MockKycProvider`. `HttpKycProvider` has contract tests, but they
 * call the class — no route, no `agent_kyc` row, no clearance state.
 *
 * The mapping is the fragile part, and it fails quietly in both directions:
 *
 *   * A vendor word missing from `KYC_CLEARED_VALUES` sends every applicant to
 *     UNDER_REVIEW. That looks like a slow review queue, not a
 *     misconfiguration, and nobody is cleared for weeks.
 *   * A vendor that could not be reached must not become a verdict. An outage
 *     is not a failed identity check, and recording it as one puts a refusal
 *     on a real person's application.
 *
 * The third case is the one no configuration may ever override: a status the
 * mapping does not recognise cannot clear anybody.
 */

// Must be first: it selects the KYC adapter before config.ts loads.
import { KYC_STUB_PORT } from './kyc-env';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { kycProvider } from '../integrations/kyc';

/** What the stub answers next. */
let verdict: Record<string, unknown> = { status: 'verified', reference: 'KYC-771', liveness: true };
/** Requests received, so the wire format can be asserted. */
const asked: Record<string, unknown>[] = [];

let stub: Server;
let lgaId = '';

before(async () => {
  stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/verify')) {
        asked.push(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(verdict));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });

  await new Promise<void>((resolve, reject) => {
    stub.once('error', reject);
    stub.listen(KYC_STUB_PORT, '127.0.0.1', resolve);
  });

  await startTestServer();
});

after(async () => {
  await stopTestServer();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

beforeEach(async () => {
  asked.length = 0;
  verdict = { status: 'verified', reference: 'KYC-771', liveness: true };
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();
});

/** An applicant who has got as far as needing their identity checked. */
async function applicant(suffix: string): Promise<{ token: string; agentId: string }> {
  const phone = `+23480777${suffix.padStart(5, '0')}`;
  const application = await post('/agents/apply', {
    fullName: `Kyc Applicant${suffix}`,
    phone,
    password: 'FieldAgent2026',
    address: '1 Test Street, Jos',
    lgaId,
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: `Kyc Applicant${suffix}`,
    accountNumber: '0123456781',
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  const { accessToken } = await loginAs(phone, 'FieldAgent2026');
  return { token: accessToken, agentId: application.body.agentId as string };
}

async function submitKyc(token: string, identityNumber: string) {
  return post('/agents/me/kyc', { identityType: 'NIN', identityNumber }, { token });
}

describe('Agent clearance on the real KYC adapter', () => {
  it('is not running on the mock', () => {
    assert.equal(kycProvider.name, 'identity-service');
  });

  it('sends the provider the applicant’s own details and records its verdict', async () => {
    const { token, agentId } = await applicant('1');
    const response = await submitKyc(token, '12345678901');

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(asked.length, 1, 'exactly one identity check reached the provider');
    assert.equal(asked[0]!.identityType, 'NIN');
    assert.equal(asked[0]!.identityNumber, '12345678901');
    assert.equal(asked[0]!.lastName, 'Applicant1', 'the name checked is the applicant’s own');

    const row = await queryOne<{
      verification_status: string;
      verification_provider: string;
      verification_reference: string | null;
      identity_number_masked: string;
    }>(
      pool,
      `SELECT verification_status, verification_provider, verification_reference,
              identity_number_masked
         FROM agent_kyc WHERE agent_id = $1 AND superseded_at IS NULL`,
      [agentId],
    );
    assert.equal(row?.verification_status, 'CLEARED');
    assert.equal(row?.verification_provider, 'identity-service');
    assert.equal(row?.verification_reference, 'KYC-771');
    assert.doesNotMatch(
      row!.identity_number_masked,
      /12345678901/,
      'the NIN is not kept in the clear',
    );
  });

  it('cannot be made to clear anyone on a status it does not recognise', async () => {
    // No value of KYC_CLEARED_VALUES is in play here: the vendor has simply
    // said something new. The applicant goes to a human, not into the field.
    verdict = { status: 'partially_matched', reference: 'KYC-772' };
    const { token, agentId } = await applicant('2');
    const response = await submitKyc(token, '12345678902');

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const row = await queryOne<{ verification_status: string }>(
      pool,
      `SELECT verification_status FROM agent_kyc WHERE agent_id = $1 AND superseded_at IS NULL`,
      [agentId],
    );
    assert.equal(row?.verification_status, 'UNDER_REVIEW');
  });

  it('does not turn an outage into a refusal', async () => {
    const { token, agentId } = await applicant('3');

    await new Promise<void>((resolve) => stub.close(() => resolve()));
    try {
      const response = await submitKyc(token, '12345678903');

      assert.equal(response.status, 503, JSON.stringify(response.body));
      assert.equal(response.body.error.code, 'KYC_PROVIDER_UNAVAILABLE');
      assert.match(response.body.error.message, /not a problem with your details/);

      const row = await queryOne<{ count: string }>(
        pool,
        'SELECT count(*)::text AS count FROM agent_kyc WHERE agent_id = $1',
        [agentId],
      );
      assert.equal(
        row?.count,
        '0',
        'an unreachable provider must leave no verdict on the application',
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        stub.once('error', reject);
        stub.listen(KYC_STUB_PORT, '127.0.0.1', resolve);
      });
    }
  });

  it('records a refusal as a refusal when the provider actually refuses', async () => {
    verdict = { status: 'no_match', reference: 'KYC-773', reason: 'Name does not match the NIN' };
    const { token, agentId } = await applicant('4');
    const response = await submitKyc(token, '12345678904');

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const row = await queryOne<{ verification_status: string }>(
      pool,
      `SELECT verification_status FROM agent_kyc WHERE agent_id = $1 AND superseded_at IS NULL`,
      [agentId],
    );
    assert.equal(row?.verification_status, 'FAILED');
  });
});
