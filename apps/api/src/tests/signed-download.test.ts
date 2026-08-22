/**
 * The signed document link, which nothing had exercised.
 *
 * `GET /documents/:id/download` sits outside `authenticate` on purpose: the
 * signature is the authorisation, so a taxpayer can open a receipt on a phone
 * without an account. That makes the signature the only thing between a link
 * and somebody's receipt, and it had no test.
 *
 * It holds up. This pins the four properties it depends on — the link expires,
 * the id cannot be swapped, the expiry cannot be extended, and a wrong
 * signature is refused — because each is invisible when it breaks. A signed
 * URL that quietly stopped checking `expires` would behave identically until
 * an old link turned up in someone's message history.
 */

import {
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  createGovernmentUser,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { signDocumentUrl } from '../services/storage';

let documentId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  // seedDemoAgent walks the real clearance pipeline, which needs an approver.
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000097',
    fullName: 'Document Admin',
  });

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Receipt',
      lastName: 'Holder',
      phone: '+2348066660001',
      address: '5 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'tp-doc' },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 'as-doc' },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: 'pay-doc' },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );

  const doc = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM documents ORDER BY created_at DESC LIMIT 1`,
  );
  assert.ok(doc, 'a verified payment should have produced a document');
  documentId = doc!.id;
});

/** Pull the query string off a freshly signed URL. */
function signedQuery(id: string, ttlSeconds?: number) {
  const url = signDocumentUrl(id, ttlSeconds);
  const query = url.split('?')[1];
  const params = new URLSearchParams(query);
  return { query, expires: params.get('expires')!, signature: params.get('signature')! };
}

describe('the signed document link', () => {
  it('serves the document to a valid link', async () => {
    const { query } = signedQuery(documentId);

    const response = await get(`/documents/${documentId}/download?${query}`);

    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
  });

  it('refuses a link whose time has passed', async () => {
    // Signed correctly, for a moment already gone.
    const { query } = signedQuery(documentId, -60);

    const response = await get(`/documents/${documentId}/download?${query}`);

    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 200));
  });

  it('refuses a link pointed at a different document', async () => {
    // A signature granted for one document, replayed against another id. The
    // target need not exist: the signature is checked before the lookup, which
    // is the property under test — the grant is bound to one document.
    const { query } = signedQuery(documentId);
    const other = '11111111-2222-3333-4444-555555555555';

    const response = await get(`/documents/${other}/download?${query}`);

    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 200));
  });

  it('refuses a link whose expiry has been stretched', async () => {
    const { signature, expires } = signedQuery(documentId);
    const later = String(Number(expires) + 86_400);

    const response = await get(
      `/documents/${documentId}/download?expires=${later}&signature=${signature}`,
    );

    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 200));
  });

  it('refuses a signature that is simply wrong', async () => {
    const { expires } = signedQuery(documentId);

    const response = await get(
      `/documents/${documentId}/download?expires=${expires}&signature=${'0'.repeat(64)}`,
    );

    assert.equal(response.status, 403, JSON.stringify(response.body).slice(0, 200));
  });
});
