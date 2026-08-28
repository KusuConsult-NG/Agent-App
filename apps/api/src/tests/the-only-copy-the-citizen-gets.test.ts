/**
 * What the taxpayer is actually told, in the only channel that reaches them.
 *
 * A citizen holds no account here. They are not going to open a portal, and the
 * agent walks away. The SMS is the whole record of the transaction as far as
 * they are concerned, and the platform's own configuration says so — a mock SMS
 * provider is one of the things production refuses to boot with, for exactly
 * this reason.
 *
 * Which is where the two-stage rule left a hole nobody had looked into. The
 * confirmation message was written when confirmation issued a receipt, and it
 * still says so:
 *
 *   "PSIRS: Your payment of N3,000 has been confirmed. Receipt:
 *    PSIRS-ACK/2026/000008. Verify it at any time using the receipt number."
 *
 * and by email, "Your payment has been received and confirmed. Your official
 * receipt number is PSIRS-ACK/2026/000008."
 *
 * Every screen in the platform was taught to distinguish an acknowledgement
 * from a receipt — the agent's app, the officer's portal, the public
 * verification page, the PDF itself. The one place that was not is the one
 * place the citizen ever sees. They are told in plain words that they hold an
 * official government receipt, and given the acknowledgement's number as its
 * number, for money the government has not yet received.
 *
 * And the other half. When the settlement lands and the real receipt is finally
 * issued, nothing tells them. There was no notification event for it at all. So
 * the citizen's only copy names a document that is not a receipt, and the number
 * of the receipt they are actually entitled to never reaches them.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentAuth: { token: string; deviceId: string };
let subject = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Copy Admin', phone: '+2348000000050', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Copy Finance',
    phone: '+2348000000051',
    role: 'finance_officer',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

/** A collection the gateway has confirmed and nobody has settled. */
async function collectAndConfirm() {
  subject += 1;
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Only',
      lastName: `Copy${subject}`,
      phone: `+2348151${String(subject).padStart(6, '0')}`,
      address: '6 Yakubu Gowon Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `copy-tp-${subject}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `copy-as-${subject}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const payment = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `copy-pay-${subject}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );

  return {
    transactionId: assessment.body.transactionId as string,
    taxpayerId: taxpayer.body.taxpayerId as string,
  };
}

/** Everything queued for this transaction, as the taxpayer would receive it. */
async function messagesFor(transactionId: string) {
  return query<{ event: string; channel: string; subject: string | null; body: string }>(
    pool,
    `SELECT event, channel, subject, message AS body FROM notifications
      WHERE entity_id = $1 ORDER BY created_at, channel`,
    [transactionId],
  );
}

describe('The message sent when the gateway confirms', () => {
  it('does not call the acknowledgement a receipt', async () => {
    /*
     * The whole change in one assertion. Every other surface was taught the
     * difference; this is the one the citizen actually reads, and it was still
     * handing them the word "receipt" and an acknowledgement's number to go
     * with it.
     */
    const { transactionId } = await collectAndConfirm();
    const messages = await messagesFor(transactionId);
    assert.ok(messages.length > 0, 'the taxpayer must be told something');

    for (const message of messages) {
      const text = `${message.subject ?? ''} ${message.body}`;
      assert.doesNotMatch(
        text,
        /official receipt|Receipt:|receipt number is/i,
        `${message.channel} calls it a receipt: ${text}`,
      );
    }
  });

  it('does not tell them the government has the money', async () => {
    // "has been received" is the specific claim that is not true yet, and it is
    // the one a taxpayer would quote back if the money never arrived.
    const { transactionId } = await collectAndConfirm();
    for (const message of await messagesFor(transactionId)) {
      assert.doesNotMatch(
        `${message.subject ?? ''} ${message.body}`,
        /has been received/i,
        `${message.channel} says the money is in: ${message.body}`,
      );
    }
  });

  it('says a receipt follows, so the citizen knows to expect one', async () => {
    // Otherwise the acknowledgement reads as the end of the matter, and a
    // taxpayer who never gets a receipt has no reason to ask for one.
    const { transactionId } = await collectAndConfirm();
    const messages = await messagesFor(transactionId);
    assert.ok(
      messages.every((m) => /receipt (follows|will follow|is issued|to follow)/i.test(m.body)),
      `every message must say a receipt is coming: ${messages.map((m) => m.body).join(' | ')}`,
    );
  });

  it('still gives them a number they can check', async () => {
    // Telling a debited citizen nothing checkable would be its own failure.
    const { transactionId } = await collectAndConfirm();
    const messages = await messagesFor(transactionId);
    assert.ok(
      messages.every((m) => m.body.includes('PSIRS-ACK')),
      'the acknowledgement number must be in the message',
    );
  });
});

describe('The message sent when the money actually arrives', () => {
  it('tells the taxpayer their receipt number', async () => {
    /*
     * The half that did not exist. A citizen whose only copy names an
     * acknowledgement, and who is never sent the number of the receipt they are
     * entitled to, has no way of ever knowing it.
     */
    const { transactionId } = await collectAndConfirm();
    const before = await messagesFor(transactionId);
    await settleTransaction(transactionId);
    const after = await messagesFor(transactionId);

    assert.ok(
      after.length > before.length,
      'settling must tell the taxpayer something it had not told them before',
    );

    const receipt = await queryOne<{ receipt_number: string }>(
      pool,
      'SELECT receipt_number FROM receipts WHERE transaction_id = $1',
      [transactionId],
    );
    assert.ok(receipt, 'a receipt exists to be told about');

    const issued = after.filter((m) => m.body.includes(receipt!.receipt_number));
    assert.ok(
      issued.length > 0,
      `the receipt number must reach the taxpayer: ${after.map((m) => m.body).join(' | ')}`,
    );
    for (const message of issued) {
      assert.match(
        message.body,
        /receipt/i,
        'and be called a receipt, because now it is one',
      );
    }
  });

  it('says nothing new when the collection has not settled', async () => {
    // The message is earned by the money arriving, not by time passing.
    const { transactionId } = await collectAndConfirm();
    const messages = await messagesFor(transactionId);
    const receiptTalk = messages.filter((m) => /your receipt (number )?is/i.test(m.body));
    assert.equal(receiptTalk.length, 0, 'no receipt number before there is a receipt');
  });
});

describe('Correcting a deployment that already has the old wording', () => {
  it('rewrites the templates rather than only the seed', async () => {
    /*
     * The half a fresh database can never catch.
     *
     * Templates are inserted ON CONFLICT (code) DO NOTHING, so a deployment that
     * already holds these rows keeps whatever text it was first given. Every
     * test here runs against a database seeded from scratch, which therefore has
     * the corrected wording before the migration is reached — the migration
     * could be empty and nothing above would notice.
     *
     * So this puts the old text back, runs the migration the way a deployment
     * would, and checks it actually moved. Reverting the migration's UPDATE was
     * silent against a fresh database; against this it is not.
     */
    const OLD_SMS =
      'PSIRS: Your payment of {{amount}} has been confirmed. Receipt: {{receiptNumber}}. ' +
      'Verify it at any time using the receipt number.';
    const OLD_EMAIL =
      'Your payment of {{amount}} has been received and confirmed. Your official receipt ' +
      'number is {{receiptNumber}}.';

    await pool.query('UPDATE notification_templates SET body = $2 WHERE code = $1', [
      'PAYMENT_SUCCESS_SMS',
      OLD_SMS,
    ]);
    await pool.query('UPDATE notification_templates SET body = $2 WHERE code = $1', [
      'PAYMENT_SUCCESS_EMAIL',
      OLD_EMAIL,
    ]);

    const migration = readFileSync(
      join(__dirname, '..', 'db', 'migrations', '042_the_only_copy_the_citizen_gets.sql'),
      'utf8',
    );
    await pool.query(migration);

    const after = await query<{ code: string; body: string }>(
      pool,
      `SELECT code, body FROM notification_templates
        WHERE code IN ('PAYMENT_SUCCESS_SMS', 'PAYMENT_SUCCESS_EMAIL')`,
    );
    assert.equal(after.length, 2, 'both templates must still be there');

    for (const template of after) {
      /*
       * The precise false claims, not the word "receipt". The corrected text
       * mentions an official receipt on purpose — to say one follows — and a
       * blunter pattern would forbid the sentence that makes the message
       * useful.
       */
      assert.doesNotMatch(
        template.body,
        /Receipt: \{\{receiptNumber|official receipt number is|has been received/i,
        `${template.code} was left with the old wording: ${template.body}`,
      );
      assert.match(
        template.body,
        /acknowledgement/i,
        `${template.code} must name the acknowledgement: ${template.body}`,
      );
    }
  });

  it('is safe to run twice, because a migration runner may', async () => {
    // The receipt templates are inserted, not updated, so a second run must not
    // duplicate them.
    const migration = readFileSync(
      join(__dirname, '..', 'db', 'migrations', '042_the_only_copy_the_citizen_gets.sql'),
      'utf8',
    );
    await pool.query(migration);
    await pool.query(migration);

    const count = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM notification_templates WHERE event = 'RECEIPT_GENERATED'`,
    );
    assert.equal(count!.n, '2', 'one SMS template and one email template, however often it runs');
  });
});
