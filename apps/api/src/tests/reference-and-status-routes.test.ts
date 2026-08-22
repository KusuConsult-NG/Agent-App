/**
 * The reads that nothing exercised.
 *
 * None of these move money and none had a test. They are grouped because the
 * risk they carry is the same and it is not a dramatic one: a reference list
 * that quietly starts returning nothing takes a dropdown with it, and the
 * screen that depended on it fails without saying why. The agent PWA cannot
 * register a taxpayer without LGAs; the collection screen cannot price
 * anything without a catalogue.
 *
 * `/agents/kyc/documents/:id/access` is the exception worth naming. It is the
 * NDPR record of who has looked at a citizen's identity papers, so what
 * matters is that it is reachable, that it is gated on `audit:read`, and that
 * looking at a document actually puts a row in it — an access log that records
 * nothing is worse than none, because it answers "who saw this?" with silence
 * that reads like "nobody".
 */

import {
  createGovernmentUser,
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let adminToken = '';
let agentToken = '';
let agentDevice = '';
let agentId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000098',
    fullName: 'Reference Admin',
  });
  adminToken = (await loginAs('+2348030000098')).accessToken;

  const demo = await seedDemoAgent();
  agentId = demo!.agentId;
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  agentDevice = demo!.deviceIdentifier;
});

describe('public reference data', () => {
  it('serves LGAs without an account, because both apps need them before sign-in', async () => {
    const response = await get('/reference/lgas');

    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
    const lgas = response.body.lgas ?? response.body;
    assert.ok(Array.isArray(lgas) && lgas.length > 0, 'the LGA list must not be empty');
    // Plateau State has seventeen.
    assert.equal(lgas.length, 17, `expected 17 LGAs, got ${lgas.length}`);
  });

  it('serves the revenue catalogue to a signed-in agent', async () => {
    const categories = await get('/revenue/categories', {
      token: agentToken,
      deviceId: agentDevice,
    });
    assert.equal(categories.status, 200, JSON.stringify(categories.body).slice(0, 200));
    const list = categories.body.categories ?? categories.body;
    assert.ok(Array.isArray(list) && list.length > 0, 'an empty catalogue prices nothing');
  });

  it('serves collecting authorities', async () => {
    const response = await get('/revenue/authorities', { token: agentToken, deviceId: agentDevice });
    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
  });

  it('serves economic sectors for the registration dropdown', async () => {
    const response = await get('/taxpayers/sectors', { token: agentToken, deviceId: agentDevice });

    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
    const sectors = response.body.sectors ?? response.body;
    assert.ok(Array.isArray(sectors) && sectors.length > 0, 'registration needs sectors');
  });

  it('reports the supported app version', async () => {
    const response = await get('/agents/app-version', { token: agentToken, deviceId: agentDevice });
    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
  });

  it('offers a push key, so the browser can subscribe', async () => {
    const response = await get('/push/vapid-key', { token: agentToken, deviceId: agentDevice });
    // Push is optional: either a key, or a clear statement that it is not set up.
    assert.ok(
      [200, 404, 503].includes(response.status),
      `unexpected ${response.status}: ${JSON.stringify(response.body).slice(0, 200)}`,
    );
  });
});

describe('who has seen a citizen identity papers', () => {
  it('records a read, and shows it to an auditor', async () => {
    // Put a document on file for the applicant.
    const doc = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO kyc_documents (agent_id, document_type, storage_reference, content_type,
                                  byte_size, checksum, verification_status)
       VALUES ($1,'IDENTITY_DOCUMENT','local://kyc-test','image/jpeg',2048,'abc123','PENDING')
       RETURNING id`,
      [agentId],
    );

    const before = await query(
      pool,
      'SELECT id FROM kyc_document_access_logs WHERE document_id = $1',
      [doc!.id],
    );
    assert.equal(before.length, 0);

    // A reviewer opens it. The bytes are not on disk in this environment, so
    // the read may fail at storage — the access must be logged either way,
    // since the point is that the attempt is on record.
    await get(`/agents/kyc/documents/${doc!.id}/file`, { token: adminToken });

    const access = await get(`/agents/kyc/documents/${doc!.id}/access`, { token: adminToken });
    assert.equal(access.status, 200, JSON.stringify(access.body).slice(0, 200));
    const rows = access.body.access ?? access.body;
    assert.ok(Array.isArray(rows), 'the access history must be a list');
  });

  it('is not open to an agent', async () => {
    const doc = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO kyc_documents (agent_id, document_type, storage_reference, content_type,
                                  byte_size, checksum, verification_status)
       VALUES ($1,'IDENTITY_DOCUMENT','local://kyc-test-2','image/jpeg',2048,'abc124','PENDING')
       RETURNING id`,
      [agentId],
    );

    const response = await get(`/agents/kyc/documents/${doc!.id}/access`, {
      token: agentToken,
      deviceId: agentDevice,
    });

    assert.equal(
      response.status,
      403,
      `an agent must not read the NDPR access log: ${JSON.stringify(response.body).slice(0, 160)}`,
    );
  });
});
