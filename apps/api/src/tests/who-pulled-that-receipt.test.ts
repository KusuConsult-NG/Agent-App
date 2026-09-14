/**
 * A fraud rule about officers, reading a column nothing ever filled in.
 *
 * `REPEATED_RECEIPT_REGENERATION` exists to notice one thing, and its own
 * comment says what:
 *
 *   "A receipt a hundred citizens verify is a receipt doing its job; the same
 *    officer fetching one document twelve times in a day is the signal."
 *
 * It counts rows in `document_access_logs` `WHERE accessed_by IS NOT NULL`.
 *
 * The only writer of that table is `GET /documents/:id/download`, which sits
 * outside `authenticate` on purpose — a taxpayer opens their receipt from an
 * SMS with no account, and the signed link is the authorisation. It records
 * `req.auth?.userId ?? null`, and nothing had ever put `req.auth` on that
 * request. So `accessed_by` was NULL on every row that has ever been written,
 * the rule's filter excluded all of them, and it could not fire.
 *
 * Not inferred. A download carrying a valid officer bearer token recorded:
 *
 *   [ { access_type: 'DOWNLOAD', accessed_by: null, ip_address: '127.0.0.1' } ]
 *
 * `identifyIfSignedIn` now reads the token when one is offered. It changes who
 * is *named*, never who is *admitted*: the signature still decides that, and a
 * citizen with no session downloads exactly as before and is recorded
 * anonymously — which is right, because the rule is about staff pulling one
 * citizen's document over and over, not about citizens.
 *
 * Both halves are held below. A fix that made the rule fire by requiring a
 * session would lock every taxpayer out of their own receipt, which is worse
 * than the dead rule.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { signDocumentUrl } from '../services/storage';
import { runFraudSweep } from '../services/fraud';

const OFFICER_PHONE = '+2348030000098';

let documentId = '';
let officerToken = '';
let officerUserId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: OFFICER_PHONE, fullName: 'Records Officer' });
  officerToken = (await loginAs(OFFICER_PHONE)).accessToken;
  officerUserId = (await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM users WHERE phone = $1',
    [OFFICER_PHONE],
  ))!.id;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Receipt',
      lastName: 'Holder',
      phone: '+2348066660002',
      address: '5 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'tp-pull' },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 'as-pull' },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: 'pay-pull' },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );

  const doc = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM documents ORDER BY created_at DESC LIMIT 1',
  );
  assert.ok(doc, 'a verified payment should have produced a document');
  documentId = doc!.id;
});

/** Download the document once, optionally as a signed-in caller. */
async function download(options: { token?: string } = {}) {
  const query_ = signDocumentUrl(documentId).split('?')[1]!;
  const response = await get(
    `/documents/${documentId}/download?${query_}`,
    options.token ? { token: options.token } : undefined,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
}

const accessLog = () =>
  query<{ access_type: string; accessed_by: string | null }>(
    pool,
    'SELECT access_type, accessed_by FROM document_access_logs ORDER BY created_at',
  );

describe('who pulled that receipt', () => {
  it('records the officer who pulled it, when there is one to record', async () => {
    await download({ token: officerToken });

    const rows = await accessLog();
    assert.equal(rows.length, 1, 'the download should have been logged');
    assert.equal(rows[0]!.access_type, 'DOWNLOAD');
    assert.equal(
      rows[0]!.accessed_by,
      officerUserId,
      'a log that cannot say who read a citizen\'s receipt is not a log',
    );
  });

  it('records nobody when a citizen opens their own receipt from an SMS', async () => {
    // The control, and the reason the route is not simply put behind
    // `authenticate`: the taxpayer holds no account at all.
    await download();

    const rows = await accessLog();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.accessed_by, null, 'a citizen with a link is not an actor to name');
  });

  it('still serves the document when the token offered is no good', async () => {
    /*
     * The signature is the authorisation, not the session. A stale token in a
     * browser tab must not turn a valid receipt link into a 401 — that would
     * be this fix breaking the thing it was meant to leave alone.
     */
    await download({ token: 'not.a.real.token' });

    const rows = await accessLog();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.accessed_by, null, 'an unusable token names nobody');
  });

  it('raises the flag when one person pulls one receipt past the threshold', async () => {
    /*
     * The whole point. Thirteen retrievals by one officer of one document, and
     * the sweep must see them — it could not before, because every row it
     * counts was written with no actor.
     */
    for (let attempt = 0; attempt < 13; attempt += 1) {
      await download({ token: officerToken });
    }

    const raised = await withTransaction((client) => runFraudSweep(client));
    assert.ok(raised.flagsRaised > 0, 'the sweep raised nothing at all');

    const flag = await queryOne<{ rule: string; entity_id: string; detail: Record<string, unknown> }>(
      pool,
      `SELECT rule, entity_id::text AS entity_id, detail
         FROM fraud_flags WHERE rule = 'REPEATED_RECEIPT_REGENERATION'`,
    );
    assert.ok(flag, 'thirteen retrievals of one receipt by one officer raised no flag');
    assert.equal(flag!.entity_id, documentId);
    assert.equal(
      (flag!.detail as { byUserId?: string }).byUserId,
      officerUserId,
      'the flag has to name the person, or an investigator has nowhere to start',
    );
  });

  it('does not raise it when the same document is opened by citizens', async () => {
    /*
     * The other control, and the rule's own words: "a receipt a hundred
     * citizens verify is a receipt doing its job". Anonymous retrievals must
     * not accumulate into an accusation against nobody.
     */
    for (let attempt = 0; attempt < 13; attempt += 1) {
      await download();
    }

    await withTransaction((client) => runFraudSweep(client));

    const flag = await queryOne<{ rule: string }>(
      pool,
      `SELECT rule FROM fraud_flags WHERE rule = 'REPEATED_RECEIPT_REGENERATION'`,
    );
    assert.equal(flag, null, 'thirteen citizens are not one suspicious officer');
  });
});
