/**
 * What the agent's screen can say about the money, when a payment is refused.
 *
 * `ErrorAlert` in the agent application prints one of three sentences from the
 * refusal's `moneyStatus` — "No money has been taken from the taxpayer", "The
 * payment has NOT been confirmed. Do not collect again", "The money has been
 * received" — and its own comment calls that "the sentence that decides
 * whether a citizen is asked to pay twice". It has three possible values, so
 * unlike the message it is always in the agent's language. All three are in the
 * safety tier.
 *
 * It is printed only when the refusal names a state. Every money-bearing
 * refusal in `lib/errors.ts` names one. The five in `initiatePayment` were
 * raised through `conflict()`, which has no money parameter, so they arrived
 * as NOT_APPLICABLE and the sentence was left out.
 *
 * Two of those five say "Do not collect payment again" in their English
 * message. They are the refusals that mean the bill is already settled, they
 * are raised while the agent is standing in front of the person who settled
 * it, and they were the two with no money line under them — so the only part
 * of that screen guaranteed to be readable was the part that was missing.
 *
 * The other three mean nothing was started. NOT_DEBITED is not a technicality
 * there: it is what the agent needs in order to tell the citizen that nothing
 * has been taken from them.
 */

import './env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

/** The three the agent's screen can actually print. */
const SAID_OUT_LOUD = ['NOT_DEBITED', 'UNCONFIRMED', 'RECEIVED'];

let agent: { token: string; deviceId: string };
let sequence = 0;

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
    fullName: 'Payment Officer',
    phone: '+2348083000001',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demo agent needs an administrator to approve it');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

/** A taxpayer, an assessment, and the transaction it raised. */
async function collectable() {
  sequence += 1;
  const suffix = String(sequence).padStart(2, '0');
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Twice',
      lastName: `Payer${suffix}`,
      phone: `+23481060000${suffix}`,
      address: '6 Bauchi Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agent, idempotencyKey: `tw-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agent, idempotencyKey: `tw-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  return {
    transactionId: assessment.body.transactionId as string,
    invoiceId: assessment.body.invoiceId as string,
    suffix,
  };
}

const initiate = (transactionId: string, suffix: string) =>
  post(
    '/payments/initiate',
    { transactionId },
    { ...agent, idempotencyKey: `tw-pay-${suffix}-${Math.random().toString(36).slice(2, 8)}` },
  );

describe('a payment the platform will not start', () => {
  it('says the money is already in when the bill is already settled', async () => {
    const { transactionId, invoiceId, suffix } = await collectable();
    const started = await initiate(transactionId, suffix);
    assert.equal(started.status, 201, JSON.stringify(started.body));

    // Settled, the way settlement leaves it.
    await pool.query(
      `UPDATE invoices SET status = 'PAID', amount_paid_kobo = total_amount_kobo WHERE id = $1`,
      [invoiceId],
    );

    const again = await initiate(transactionId, suffix);
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error.code, 'INVOICE_ALREADY_PAID');
    assert.equal(
      again.body.error.moneyStatus,
      'RECEIVED',
      'the agent is told the money is in, in their own language, under a message that is not',
    );
    assert.match(again.body.error.message, /do not collect payment again/i);
  });

  it('says nothing was taken when the bill can no longer be paid', async () => {
    const { transactionId, invoiceId, suffix } = await collectable();

    await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [invoiceId]);

    const refused = await initiate(transactionId, suffix);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_NOT_PAYABLE');
    assert.equal(
      refused.body.error.moneyStatus,
      'NOT_DEBITED',
      'which is the reassurance the agent has to give the person in front of them',
    );
  });

  it('says nothing was taken when the deadline has passed', async () => {
    const { transactionId, invoiceId, suffix } = await collectable();

    // Past its expiry, which is a state every unpaid invoice reaches on its own.
    await pool.query(
      `UPDATE invoices SET expires_at = now() - interval '1 day' WHERE id = $1`,
      [invoiceId],
    );

    const refused = await initiate(transactionId, suffix);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'INVOICE_EXPIRED');
    assert.equal(refused.body.error.moneyStatus, 'NOT_DEBITED');
  });

  it('never refuses a payment without saying what happened to the money', async () => {
    /*
     * Read out of the source, because one of the five cannot be provoked
     * through the API: `PAYMENT_ALREADY_VERIFIED` needs a verified payment
     * against an invoice that is not PAID, and verification marks the invoice
     * PAID in the same transaction, so the check above it always fires first.
     * Fabricating that state would prove the fixture ran.
     *
     * `notFound` is allowed and is the one exception: "that transaction could
     * not be found" is not a statement about anybody's money, and it comes
     * from a helper every service in the platform shares.
     */
    // `__dirname`, not `import.meta.url`: these tests run under `tsx` where
    // both work and are compiled by `tsc` into CommonJS, where the second is a
    // build error. `a-check-that-nothing-runs` resolves its paths the same way.
    const source = readFileSync(join(__dirname, '..', 'services', 'payments.ts'), 'utf8');
    const start = source.indexOf('export async function initiatePayment');
    assert.ok(start > -1, 'initiatePayment moved');
    const body = source.slice(start, source.indexOf('\nexport async function', start + 10));

    const refusals = [...body.matchAll(/throw (\w+)\(/g)].map((match) => match[1]);
    assert.ok(refusals.length >= 5, `expected the refusals, found ${refusals.join(', ')}`);

    for (const raised of refusals) {
      assert.ok(
        raised === 'notFound' || raised === 'paymentRefused',
        `${raised}() does not name a money state, so the agent's screen would print none`,
      );
    }

    // And the states it names are ones the screen can print.
    for (const match of body.matchAll(/moneyStatus: '([A-Z_]+)'/g)) {
      assert.ok(
        SAID_OUT_LOUD.includes(match[1]!),
        `${match[1]} is not one of the three sentences the agent's screen has`,
      );
    }
  });

  it('still starts a payment that can be started', async () => {
    // The guard: a refusal on every path would satisfy the checks above and
    // take collection away.
    const { transactionId, suffix } = await collectable();
    const started = await initiate(transactionId, suffix);

    assert.equal(started.status, 201, JSON.stringify(started.body));
    assert.ok(started.body.paymentId, 'a payment was created');
  });
});
