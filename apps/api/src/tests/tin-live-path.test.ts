/**
 * Registration, on the real TIN adapter, through the real API.
 *
 * The TIN service decides whether a citizen can be registered at all, and
 * every registration in this codebase has been answered by `MockTinService`.
 * `HttpTinService` has contract tests, but they call the class: no route, no
 * database, no `taxpayers.tin` column — which is UNIQUE, on a row the schema
 * will not let anyone delete. A wrong value written there is permanent and
 * blocks the real number from ever being recorded.
 *
 * So this boots the app on the HTTP adapter against a server speaking a TIN
 * service's shapes, and registers people through it. What it is watching is
 * narrower than "does it work": it is the three ways the platform can be told
 * something and get it wrong.
 *
 *   * The service **has** the TIN — it must be stored as the service spells
 *     it, not as the agent typed it.
 *   * The service says **no such TIN** — refuse, and do not offer to mint a
 *     second one.
 *   * The service **could not be asked** — refuse, and store nothing. "We
 *     could not ask" is not "the answer is no", and during an outage the
 *     difference is a duplicate TIN for every existing taxpayer an agent
 *     touches.
 */

// Must be first: it selects the TIN adapter before config.ts loads.
import { TIN_STUB_PORT } from './tin-env';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  createGovernmentUser,
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
import { seedDemoAgent } from '../db/seed-agent';
import { tinService } from '../integrations/tin';

/** The TIN the stub holds, spelled the way the service spells it. */
const KNOWN_TIN = '10426381';

/** Requests the stub received, so the wire format can be asserted. */
const lookups: string[] = [];
const registrations: Record<string, unknown>[] = [];

/** Set to false to make the stub refuse connections outright. */
let stubListening = true;

let stub: Server;
let agent: { token: string; device: string };
let lgaId = '';

before(async () => {
  stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = req.url ?? '';

      if (req.method === 'GET' && url.startsWith('/tins/')) {
        const asked = decodeURIComponent(url.slice('/tins/'.length));
        lookups.push(asked);
        if (asked === KNOWN_TIN) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              tin: KNOWN_TIN,
              fullName: 'CHINEDU OKAFOR',
              taxpayerType: 'INDIVIDUAL',
              status: 'assigned',
            }),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'not_found', message: 'No record for that number' }));
        return;
      }

      if (req.method === 'POST' && url === '/tins') {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
        registrations.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ status: 'pending', reference: 'TINAPP-88213', message: 'Queued' }),
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });

  await new Promise<void>((resolve, reject) => {
    stub.once('error', reject);
    stub.listen(TIN_STUB_PORT, '127.0.0.1', resolve);
  });

  await startTestServer();
});

after(async () => {
  await stopTestServer();
  if (stubListening) await new Promise<void>((resolve) => stub.close(() => resolve()));
});

beforeEach(async () => {
  lookups.length = 0;
  registrations.length = 0;

  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'TIN Admin',
    phone: '+2348000000094',
    role: 'admin',
  });

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  lgaId = await firstLgaId();
});

async function register(
  suffix: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> {
  return post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Tin',
      lastName: `Subject${suffix}`,
      phone: `+23480888${suffix.padStart(5, '0')}`,
      address: '5 Market Road, Jos',
      lgaId,
      community: 'Kabong',
      consentGiven: true,
      declarationAccepted: true,
      ...extra,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: `tin-${suffix}` },
  );
}

describe('Registration on the real TIN adapter', () => {
  it('is not running on the mock', () => {
    assert.equal(tinService.name, 'psirs-tin-service');
  });

  it('stores the TIN as the service spells it, not as the agent typed it', async () => {
    // The agent types it off a document, with the punctuation that is on the
    // document. What goes in the UNIQUE column has to be the register's.
    const response = await register('1', { existingTin: '104-263 81' });
    assert.equal(response.status, 201, JSON.stringify(response.body));

    assert.deepEqual(lookups, [KNOWN_TIN], 'the service was asked for the normalised number');

    const row = await queryOne<{ tin: string; tin_status: string }>(
      pool,
      'SELECT tin, tin_status FROM taxpayers WHERE id = $1',
      [response.body.taxpayerId],
    );
    assert.equal(row?.tin, KNOWN_TIN);
    assert.equal(row?.tin_status, 'EXISTING');
  });

  it('refuses a TIN the service has no record of, without offering to mint a second', async () => {
    const response = await register('2', { existingTin: '99999999' });

    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(response.body.error.message, /could not be found in the PSIRS TIN service/);
    // The advice that used to be here — "register the taxpayer as a new TIN
    // applicant" — is what puts a second TIN on somebody who has one.
    assert.match(response.body.error.nextStep, /Check the number against the taxpayer/);

    const count = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM taxpayers',
      [],
    );
    assert.equal(count?.count, '0', 'nothing was registered');
  });

  it('applies for a new TIN when the taxpayer has none, and records the reference', async () => {
    const response = await register('3');
    assert.equal(response.status, 201, JSON.stringify(response.body));

    assert.equal(registrations.length, 1, 'one application reached the TIN service');
    const applied = registrations[0]!;
    assert.equal(applied.taxpayerType, 'INDIVIDUAL');
    assert.equal(applied.lastName, 'Subject3');
    assert.ok(applied.lga, 'the service is told which LGA, by name');

    const row = await queryOne<{ tin: string | null; tin_status: string; tin_reference: string | null }>(
      pool,
      'SELECT tin, tin_status, tin_reference FROM taxpayers WHERE id = $1',
      [response.body.taxpayerId],
    );
    assert.equal(row?.tin, null, 'no number is invented while the application is pending');
    assert.equal(row?.tin_reference, 'TINAPP-88213');
  });

  it('stops when the service cannot be asked, rather than registering a duplicate', async () => {
    // The outage case, at the socket rather than by stubbing a method. During
    // a real one this branch runs for every existing taxpayer an agent
    // touches, and a duplicate in a UNIQUE column on an undeletable row is
    // permanent.
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    stubListening = false;
    try {
      const response = await register('4', { existingTin: KNOWN_TIN });

      assert.equal(response.status, 503, JSON.stringify(response.body));
      assert.equal(response.body.error.code, 'TIN_SERVICE_UNAVAILABLE');
      assert.match(response.body.error.message, /Nothing has been registered/);
      assert.match(response.body.error.nextStep, /Do NOT register this taxpayer as a new TIN/);

      const count = await queryOne<{ count: string }>(
        pool,
        'SELECT count(*)::text AS count FROM taxpayers',
        [],
      );
      assert.equal(count?.count, '0', 'an outage must not leave a half-registered taxpayer');
    } finally {
      await new Promise<void>((resolve, reject) => {
        stub.once('error', reject);
        stub.listen(TIN_STUB_PORT, '127.0.0.1', resolve);
      });
      stubListening = true;
    }
  });
});
