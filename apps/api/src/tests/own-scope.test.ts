/**
 * `:own` has to mean the caller's own.
 *
 * `requirePermission` answers one question — does this *role* hold the
 * permission — and never touches a row. So every route relying on a `:own`
 * permission for narrowing has to do the narrowing itself, and six of them did
 * not. Any active agent could read any transaction, assessment, receipt or
 * document by id: another agent's taxpayer, their name, TIN, amounts and
 * computation trace. `GET /documents/:id` was the worst, because it does not
 * merely describe a document — it returns a signed URL that downloads it.
 *
 * It was proven with two agents before it was fixed, and this is that proof
 * kept: a second cleared agent, no connection to any of the records, reaching
 * for each one.
 *
 * The refusal is 404 rather than 403 throughout. Whether a given transaction
 * or document exists is itself something the taxpayer it belongs to is
 * entitled to keep, and a 403 confirms existence to anyone who guesses an id.
 *
 * One route that looked like the others is deliberately left open, and is
 * covered here so it stays that way on purpose rather than by accident.
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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

/** The agent who did the work. */
let owner: { token: string; device: string };
/** A cleared agent with no connection to any of it. */
let stranger = '';
let officer = '';

const collected: {
  reference: string;
  transactionId: string;
  assessmentId: string;
  invoiceId: string;
  receiptId: string;
  receiptNumber: string;
  documentId: string;
} = {} as never;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Scope Admin', phone: '+2348000000100', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Scope Officer',
    phone: '+2348000000101',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348000000101')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  owner = { token: session.accessToken, device: demo!.deviceIdentifier };

  // A second agent account. Not cleared to collect, which does not matter:
  // the question is whether holding an agent session is enough to read
  // somebody else's records, and it must not be.
  const strangerPhone = '+2347010000055';
  await createGovernmentUser({ fullName: 'Stranger Agent', phone: strangerPhone, role: 'agent' });
  stranger = (await loginAs(strangerPhone)).accessToken;

  // One complete collection, owned by the first agent.
  const auth = { token: owner.token, deviceId: owner.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Scope',
      lastName: 'Subject',
      phone: '+2348099911122',
      address: '5 Market Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'scope-tp' },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 'scope-as' },
  );
  const payment = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: 'scope-pay' },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );

  const row = await queryOne<{
    invoice_id: string;
    assessment_id: string;
    receipt_id: string;
    receipt_number: string;
    document_id: string;
  }>(
    pool,
    `SELECT t.invoice_id, t.assessment_id, r.id AS receipt_id, r.receipt_number, r.document_id
       FROM transactions t JOIN receipts r ON r.transaction_id = t.id
      WHERE t.id = $1`,
    [assessment.body.transactionId],
  );

  Object.assign(collected, {
    reference: assessment.body.transactionReference,
    transactionId: assessment.body.transactionId,
    assessmentId: row!.assessment_id,
    invoiceId: row!.invoice_id,
    receiptId: row!.receipt_id,
    receiptNumber: row!.receipt_number,
    documentId: row!.document_id,
  });
});

/**
 * Each guarded route, and how to reach the record this collection produced.
 *
 * The path is a function because `describe` bodies run before `beforeEach`:
 * built eagerly, every one of these read an id that was still undefined.
 */
const GUARDED: { what: string; path: () => string }[] = [
  { what: 'the transaction', path: () => `/payments/transactions/${collected.reference}/status` },
  { what: 'the assessment', path: () => `/revenue/assessments/${collected.assessmentId}` },
  { what: 'the invoice', path: () => `/revenue/invoices/${collected.invoiceId}` },
  { what: 'the receipt', path: () => `/receipts/${collected.receiptId}` },
  {
    what: 'the receipt by its printed number',
    path: () => `/receipts/lookup?number=${encodeURIComponent(collected.receiptNumber)}`,
  },
  { what: 'the document', path: () => `/documents/${collected.documentId}` },
];

describe('Another agent cannot read what they had no part in', () => {
  for (const { what, path } of GUARDED) {
    it(`refuses ${what}`, async () => {
      const response = await get(path(), { token: stranger });
      assert.equal(
        response.status,
        404,
        `an unrelated agent read ${what} — ${JSON.stringify(response.body).slice(0, 160)}`,
      );
    });
  }

  it('does not hand over a download URL for somebody else’s document', async () => {
    // The document route is the one that matters most: it returns a signed URL,
    // so a leak here is the PDF itself and not only its description.
    const response = await get(`/documents/${collected.documentId}`, { token: stranger });
    assert.equal(response.status, 404);
    assert.equal(response.body.downloadUrl, undefined);
  });
});

describe('The agent who did the work still can', () => {
  for (const { what, path } of GUARDED) {
    it(`serves ${what}`, async () => {
      const response = await get(path(), { token: owner.token, deviceId: owner.device });
      assert.equal(response.status, 200, `${what}: ${JSON.stringify(response.body).slice(0, 160)}`);
    });
  }
});

describe('An officer holding the unrestricted permission is untouched', () => {
  for (const { what, path } of GUARDED) {
    it(`serves ${what}`, async () => {
      const response = await get(path(), { token: officer });
      assert.equal(response.status, 200, `${what}: ${JSON.stringify(response.body).slice(0, 160)}`);
    });
  }
});

describe('What one taxpayer owes stays open to any agent', () => {
  it('is not narrowed, because serving a walk-up taxpayer is the job', async () => {
    /*
     * This route was on the list of six and does not belong there.
     * `agent-scope.test.ts` states the intent — "serving a walk-up taxpayer
     * requires finding them and knowing their obligations; that much is the
     * job" — and narrowing it would push an agent into raising a second
     * assessment for a debt that already exists. Pinned here so the next sweep
     * over `:own` permissions leaves it alone on purpose.
     */
    const taxpayerId = await queryOne<{ taxpayer_id: string }>(
      pool,
      'SELECT taxpayer_id FROM transactions WHERE id = $1',
      [collected.transactionId],
    );
    const response = await get(`/revenue/taxpayers/${taxpayerId!.taxpayer_id}/obligations`, {
      token: stranger,
    });
    assert.equal(response.status, 200);
  });
});

describe('A new :own route has to declare what it does about scope', () => {
  /*
   * This cannot tell whether a narrowing is correct — only that somebody
   * decided. Six routes reached production guarded by a `:own` permission with
   * no row-level check because nothing ever asked the question, and the way to
   * stop the seventh is to make adding one fail here until it is listed.
   *
   * `scoped` means the handler narrows to the caller. `open` means it is
   * deliberately not narrowed, and why.
   */
  const DECLARED: Record<string, 'scoped' | 'open'> = {
    // Self-addressed by construction: /me is the caller.
    'agents.ts GET /me/transactions': 'open',
    'agents.ts GET /me/commission': 'open',

    'payments.ts GET /transactions/:reference/status': 'scoped',
    // The receipt list filters for agents in its own SQL.
    'payments.ts GET /': 'scoped',
    'payments.ts GET /lookup': 'scoped',
    'payments.ts GET /:id': 'scoped',

    'revenue.ts GET /assessments/:id': 'scoped',
    'revenue.ts GET /invoices/:id': 'scoped',
    'revenue.ts POST /invoices/:id/document': 'scoped',
    // Serving a walk-up taxpayer requires knowing what they owe — see above.
    'revenue.ts GET /taxpayers/:id/obligations': 'open',
  };

  it('has an entry for every route guarded by a :own permission', () => {
    const dir = join(__dirname, '..', 'routes');
    const found: string[] = [];

    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      const pattern = /(\w+Router)\.(get|post|patch|put|delete)\(\s*'([^']+)',\s*([\s\S]{0,220}?)\)\s*,/g;
      for (const match of source.matchAll(pattern)) {
        const guard = match[4]!;
        if (!guard.includes(':own') || !guard.includes('requirePermission')) continue;
        found.push(`${file} ${match[2]!.toUpperCase()} ${match[3]}`);
      }
    }

    assert.ok(found.length >= 10, `expected the :own routes, found ${found.length}`);

    for (const route of found) {
      assert.ok(
        DECLARED[route],
        `${route} is guarded by a :own permission and is not declared in this test. ` +
          'Decide whether it narrows to the caller and add it as "scoped" or "open" — ' +
          'six routes shipped unscoped because nobody was made to answer that.',
      );
    }

    for (const route of Object.keys(DECLARED)) {
      assert.ok(
        found.includes(route),
        `${route} is declared here but no longer exists; remove it so the list stays honest`,
      );
    }
  });
});
