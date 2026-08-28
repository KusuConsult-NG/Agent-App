/**
 * Money in a message to a citizen reads as money — and one convention makes it
 * so.
 *
 * Every amount this platform holds is an integer number of kobo, and every
 * caller passes it that way: `expected.toString()` from the payment path,
 * `invoice.total_amount_kobo` from the reminder sweep. Read on its own, each
 * call looks like it would put "200000" into an SMS.
 *
 * It does not, because `render()` converts it:
 *
 *   if (key === 'amount' && /^\d+$/.test(value)) return formatNaira(BigInt(value));
 *
 * One place, applied to every template, so a caller cannot forget. That is the
 * right design and it works. These tests exist because it is invisible at the
 * call site: nothing about `amount: expected.toString()` says the amount will
 * come out as naira, and somebody removing that line in `render` would break
 * every citizen-facing message about money at once while every unit test of
 * the callers kept passing.
 *
 * The stake if it ever breaks is not tidiness. A citizen reading "300000"
 * reads three hundred thousand naira — a hundred times the real charge, in the
 * alarming direction, in an official SMS with a receipt number attached to
 * make it credible.
 *
 * The second test guards the convention rather than the mechanism. The
 * conversion is keyed on the variable being *named* `amount`, so a template
 * that ever says `{{serviceCharge}}` or `{{balance}}` would silently print
 * kobo. Today every template that mentions money uses `amount`; this keeps it
 * that way, since nothing in a template hints that its name is load-bearing.
 */

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
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { sendDueReminders } from '../services/reminders';

let agent: { token: string; device: string };

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
    phone: '+2348030000130',
    fullName: 'Notification Officer',
  });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/** A complete collection: registration, assessment, payment, verification. */
async function collect(suffix: string, extra: Record<string, unknown> = {}) {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Notified',
      lastName: `Citizen${suffix}`,
      phone: `+2348131${suffix.padStart(6, '0')}`,
      address: '4 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
      ...extra,
    },
    { ...auth, idempotencyKey: `tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `as-${suffix}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  return {
    taxpayerId: taxpayer.body.taxpayerId as string,
    transactionId: assessment.body.transactionId as string,
  };
}

const messagesFor = async (event: string) =>
  (
    await query<{ message: string }>(
      pool,
      `SELECT message FROM notifications WHERE event = $1 ORDER BY created_at DESC`,
      [event],
    )
  ).map((r) => r.message);

describe('an amount a citizen is shown', () => {
  it('is written as naira on a payment confirmation, not as kobo', async () => {
    await collect('1');

    const messages = await messagesFor('PAYMENT_SUCCESSFUL');
    assert.ok(messages.length > 0, 'a verified payment should notify the taxpayer');

    const money = messages.find((m) => /payment of/i.test(m));
    assert.ok(money, `no payment message found in ${JSON.stringify(messages).slice(0, 300)}`);
    assert.match(
      money!,
      /₦3,000\.00/,
      `an amount must read as naira. Got: ${money}`,
    );
    assert.doesNotMatch(
      money!,
      /\b300000\b/,
      'raw kobo in a citizen message reads as a hundred times the real amount',
    );
  });

  it('is written as naira on a due reminder', async () => {
    // Assessed but not paid, so the invoice is still outstanding, then moved
    // into the six-week window. Built through the API rather than by hand: an
    // invoice row assembled in a test proves nothing about the path that makes
    // real ones.
    const auth = { token: agent.token, deviceId: agent.device };
    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Reminded',
        lastName: 'Citizen',
        phone: '+2348131000099',
        address: '9 Market Road, Bokkos',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...auth, idempotencyKey: 'tp-rem' },
    );
    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
        inputs: {},
      },
      { ...auth, idempotencyKey: 'as-rem' },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    const moved = await pool.query(
      `UPDATE invoices SET expires_at = now() + interval '42 days', status = 'UNPAID',
              reminder_sent_6w = false
        WHERE taxpayer_id = $1`,
      [taxpayer.body.taxpayerId],
    );
    assert.ok((moved.rowCount ?? 0) > 0, 'the assessment should have raised an invoice');

    const result = await sendDueReminders();
    assert.ok(result.sent > 0, `no reminder was sent: ${JSON.stringify(result)}`);

    const messages = await messagesFor('TAX_REMINDER_6W');
    const reminder = messages.find((m) => /is due|due on/i.test(m));
    assert.ok(reminder, `no reminder message found in ${JSON.stringify(messages).slice(0, 300)}`);
    assert.match(reminder!, /₦3,000\.00/, `a reminder must read as naira. Got: ${reminder}`);
    assert.doesNotMatch(reminder!, /\b300000\b/);
  });

  it('is never carried by a template variable the renderer will not convert', async () => {
    // `render` converts on the name `amount`. Any other name holding money
    // would print kobo, and nothing in the template would show why.
    const rows = await query<{ event: string; body: string; subject: string | null }>(
      pool,
      'SELECT event, body, subject FROM notification_templates',
    );

    const moneyish = /^(kobo|total|fee|charge|serviceCharge|naira|balance|sum|price|due|owed)$/i;
    const offenders: string[] = [];
    for (const row of rows) {
      const text = `${row.subject ?? ''} ${row.body}`;
      for (const match of text.matchAll(/\{\{([a-zA-Z]+)\}\}/g)) {
        if (moneyish.test(match[1])) offenders.push(`${row.event}: {{${match[1]}}}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'only a variable named "amount" is converted from kobo to naira; these would print kobo',
    );
  });
});

// ---------------------------------------------------------------------------

describe('a taxpayer who gave an email address', () => {
  /**
   * The catalogue of templates has carried an email confirmation for a
   * successful payment from the beginning, and no notification in any run of
   * this suite had ever been queued on the email channel — because no taxpayer
   * the suite registered had ever given an address. So the branch that picks
   * the email recipient rather than the phone, and the subject line that only
   * the email template has, had never once run.
   *
   * It matters more than a channel count. An SMS carries a receipt number; the
   * email is the only message that carries the whole confirmation, and it is
   * what a trader forwards to whoever keeps their books.
   */
  it('is sent the confirmation by email as well as by text', async () => {
    await collect('40', { email: 'ledger.keeper@example.com' });

    const queued = await query<{ channel: string; recipient: string; subject: string | null }>(
      pool,
      `SELECT channel, recipient, subject FROM notifications
        WHERE event = 'PAYMENT_SUCCESSFUL' ORDER BY channel`,
    );
    const channels = queued.map((row) => row.channel);
    assert.ok(channels.includes('EMAIL'), `only ${JSON.stringify(channels)} were queued`);
    assert.ok(channels.includes('SMS'), 'the text message still goes; the email does not replace it');

    const email = queued.find((row) => row.channel === 'EMAIL')!;
    assert.equal(email.recipient, 'ledger.keeper@example.com', 'to the address, not the phone');
    assert.ok(email.subject, 'an email has a subject line and an SMS does not');
    /*
     * The subject named a receipt when confirmation issued one. It now names
     * the acknowledgement, because that is what the message is about — this is
     * the one copy a citizen with no account keeps, and a subject line saying
     * "receipt" is how an acknowledgement gets filed as one.
     */
    assert.match(email.subject!, /acknowledgement/i);
    assert.doesNotMatch(email.subject!, /receipt/i);
  });

  it('gets the text message alone when there is no address to send to', async () => {
    await collect('41');

    const channels = (
      await query<{ channel: string }>(
        pool,
        `SELECT channel FROM notifications WHERE event = 'PAYMENT_SUCCESSFUL'`,
      )
    ).map((row) => row.channel);
    assert.deepEqual(channels, ['SMS'], 'no empty email is queued against a missing address');
  });
});
