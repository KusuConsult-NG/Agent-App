/**
 * Money reaches an agent's bank account and nobody tells them.
 *
 * `completePayout` moves a commission payout to PAID, transitions every
 * commission inside it, records the bank reference and writes an audit entry.
 * `failPayout` returns the whole payout to ELIGIBLE when the transfer bounces.
 * `refusePayout` declines one outright. Between them they are every way an
 * agent's own money changes hands — and there is not one `queueNotification`
 * call in the whole of `commission.ts`.
 *
 * A `COMMISSION_PAID` template is seeded. Somebody meant this to happen; the
 * wire was never connected. So an agent learns their commission arrived by
 * checking their bank, and learns a transfer failed by not finding it there —
 * which is indistinguishable from PSIRS simply not having paid them, and is
 * the belief that turns into a support ticket, or into an agent who starts
 * asking citizens for cash.
 *
 * The failure case matters more than the success. A bank transfer that bounces
 * usually bounces because the account details are wrong, which only the agent
 * can fix, and until somebody tells them they do not know there is anything to
 * fix.
 *
 * AND THE CHANNEL THAT COULD NOT CARRY ANY OF IT. `queueNotification` resolves
 * a PUSH template's recipient to a *phone number*, because the branch reads
 * "EMAIL ? email : phone". The push adapter is addressed to a user id, so the
 * first PUSH template anybody seeded would be refused on every send — with a
 * message blaming the template. And none is seeded, so a channel with a
 * subscription store, a provider, a settings toggle and a service worker
 * reaches nobody at all.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { query, queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { completePayout, failPayout, refusePayout, requestPayout } from '../services/commission';
import { queueNotification } from '../services/notifications';

let agentId = '';
let agentUserId = '';
let officerId = '';
let demoPhone = '';
let demoPassword = '';
let demoDevice = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    role: 'finance_officer',
    phone: '+2348098000001',
    fullName: 'Payout Officer',
  });
  // seedDemoAgent needs an administrator to have approved the clearance.
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348098000002',
    fullName: 'Payout Admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must seed');
  const row = await queryOne<{ id: string; user_id: string }>(
    pool,
    'SELECT a.id, a.user_id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  );
  agentId = row!.id;
  agentUserId = row!.user_id;
  demoPhone = demo!.phone;
  demoPassword = demo!.password;
  demoDevice = demo!.deviceIdentifier;
});

let fixtureSeq = 0;

/**
 * One eligible commission on one collection.
 *
 * Booked against the tables rather than driven through the collection flow:
 * what is under test is whether anybody is told when the money moves, and
 * running a full payment for each case would make the fixture the subject.
 */
async function eligibleCommission(amountKobo = 50_000n) {
  fixtureSeq += 1;
  const suffix = String(fixtureSeq).padStart(2, '0');
  const item = await queryOne<{ id: string; rate_id: string }>(
    pool,
    `SELECT ri.id, r.id AS rate_id
       FROM revenue_items ri JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE ri.code = 'MARKET-LEVY' LIMIT 1`,
  );
  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Payout',$1,$2,'3 Market Rd',(SELECT id FROM lgas ORDER BY name LIMIT 1),
             'ACTIVE','AGENT')
     RETURNING id`,
    [`Subject${suffix}`, `+2348098100${suffix}`],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments
       (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
        computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,$5,$5,
             (SELECT id FROM lgas ORDER BY name LIMIT 1),'INVOICED',$6)
     RETURNING id`,
    [`ASMT-PAY-${suffix}`, taxpayer!.id, item!.id, item!.rate_id, amountKobo.toString(), officerId],
  );
  const invoice = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices
       (invoice_number, assessment_id, taxpayer_id, amount_kobo, total_amount_kobo,
        verification_code, created_by)
     VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id`,
    [`INV-PAY-${suffix}`, assessment!.id, taxpayer!.id, amountKobo.toString(), `PAY${suffix}`, officerId],
  );
  const transaction = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id, agent_id,
        amount_kobo, total_amount_kobo, status, lga_id, channel, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'SETTLED',(SELECT id FROM lgas ORDER BY name LIMIT 1),
             'AGENT_PWA',$8)
     RETURNING id`,
    [
      `PAY-${suffix}-0001`,
      taxpayer!.id,
      invoice!.id,
      assessment!.id,
      item!.id,
      agentId,
      amountKobo.toString(),
      officerId,
    ],
  );

  await query(
    pool,
    `INSERT INTO commissions
       (agent_id, transaction_id, policy_id, rate_basis_points, basis_amount_kobo, amount_kobo,
        status, eligible_at)
     VALUES ($1,$2,(SELECT id FROM commission_policies LIMIT 1),500,$3,$3,'ELIGIBLE',now())`,
    [agentId, transaction!.id, amountKobo.toString()],
  );
}

async function approvedPayout() {
  await eligibleCommission();
  const { payoutId } = await requestPayout({
    agentId,
    actorId: agentUserId,
    actorRole: 'agent',
  });
  await query(pool, `UPDATE commission_payouts SET status = 'APPROVED' WHERE id = $1`, [payoutId]);
  await query(
    pool,
    `UPDATE commissions SET status = 'APPROVED', approved_at = now() WHERE payout_id = $1`,
    [payoutId],
  );
  return payoutId;
}

const notificationsFor = (event: string) =>
  query<{ channel: string; recipient: string; message: string; user_id: string | null }>(
    pool,
    `SELECT channel, recipient, message, user_id FROM notifications
      WHERE event = $1 ORDER BY channel`,
    [event],
  );

describe('when a payout reaches the agent’s bank', () => {
  it('tells them, because otherwise they find out by looking', async () => {
    const payoutId = await approvedPayout();
    await completePayout({
      payoutId,
      bankReference: 'FBN/2026/0001',
      actorId: officerId,
      actorRole: 'finance_officer',
    });

    const queued = await notificationsFor('COMMISSION_PAID');
    assert.ok(
      queued.length > 0,
      'a COMMISSION_PAID template is seeded and nothing has ever queued it',
    );
    assert.equal(queued[0]!.user_id, agentUserId, 'and it is addressed to the agent');
  });

  it('names the bank reference, which is what they will quote to their bank', async () => {
    const payoutId = await approvedPayout();
    await completePayout({
      payoutId,
      bankReference: 'FBN/2026/0002',
      actorId: officerId,
      actorRole: 'finance_officer',
    });

    const queued = await notificationsFor('COMMISSION_PAID');
    assert.ok(
      queued.some((row) => row.message.includes('FBN/2026/0002')),
      `the reference must be in the message: ${JSON.stringify(queued.map((r) => r.message))}`,
    );
  });
});

describe('when the transfer bounces', () => {
  it('tells the agent, because only they can fix the account it bounced off', async () => {
    /*
     * The case that matters more than success. A bounced transfer is usually
     * wrong account details, and until somebody says so the agent cannot tell
     * "the bank refused my account" from "PSIRS did not pay me" — which is the
     * belief that ends in a support ticket, or in an agent who starts asking
     * citizens for cash.
     */
    const payoutId = await approvedPayout();
    await failPayout({
      payoutId,
      reason: 'Account name does not match',
      actorId: officerId,
      actorRole: 'finance_officer',
    });

    const queued = await notificationsFor('COMMISSION_PAYOUT_FAILED');
    assert.ok(queued.length > 0, 'a failed transfer told the agent nothing');
    assert.ok(
      queued.some((row) => /Account name does not match/i.test(row.message)),
      `the reason must reach them: ${JSON.stringify(queued.map((r) => r.message))}`,
    );
  });

  it('says the money is still theirs, because it is', async () => {
    // The commissions go back to ELIGIBLE and will be in the next payout. An
    // agent told only "your payout failed" reasonably concludes it is gone.
    const payoutId = await approvedPayout();
    await failPayout({
      payoutId,
      reason: 'Account closed',
      actorId: officerId,
      actorRole: 'finance_officer',
    });

    /*
     * Asserted on the concrete fact rather than on a reassuring word. "Still"
     * and "again" appear in almost any sentence about a retry, so matching
     * those would pass for a message that says the money is gone. What the
     * agent needs to know is where it went: back to the balance they can
     * request from.
     */
    const queued = await notificationsFor('COMMISSION_PAYOUT_FAILED');
    assert.ok(
      queued.some((row) => /available balance/i.test(row.message)),
      `they must be told the money returned to their balance: ${JSON.stringify(queued.map((r) => r.message))}`,
    );
  });
});

describe('when an officer refuses a payout', () => {
  it('tells the agent, with the reason the officer gave', async () => {
    const payoutId = await approvedPayout();
    await query(pool, `UPDATE commission_payouts SET status = 'REQUESTED' WHERE id = $1`, [
      payoutId,
    ]);
    await withTransaction((client) =>
      refusePayout(client, {
        payoutId,
        reason: 'Awaiting the outcome of a fraud review',
        actorId: officerId,
        actorRole: 'finance_officer',
      }),
    );

    const queued = await notificationsFor('COMMISSION_PAYOUT_REFUSED');
    assert.ok(queued.length > 0, 'a refusal the agent is never told about is not a decision');
    assert.ok(
      queued.some((row) => /fraud review/i.test(row.message)),
      JSON.stringify(queued.map((r) => r.message)),
    );
  });
});

describe('a PUSH notification', () => {
  it('is addressed to a person, not to their telephone number', async () => {
    /*
     * The queueing side and the delivery side disagreed. `queueNotification`
     * reads "EMAIL ? email : phone", so a PUSH row was addressed to a phone
     * number; the adapter looks up subscriptions by user id and refuses
     * anything else. Every push would have been permanently rejected, with a
     * message blaming whoever wrote the template.
     */
    await withTransaction((client) =>
      queueNotification(client, {
        event: 'AGENT_SUSPENDED',
        agentId,
        variables: { reason: 'Test' },
      }),
    );

    const push = (await notificationsFor('AGENT_SUSPENDED')).filter(
      (row) => row.channel === 'PUSH',
    );
    assert.ok(push.length > 0, 'no PUSH template is seeded, so the channel reaches nobody');
    assert.equal(
      push[0]!.recipient,
      agentUserId,
      'a push is delivered to a person’s devices, so the recipient is their user id',
    );
  });

  it('does not replace the SMS, because a handset can refuse notifications', async () => {
    /*
     * Push is additive. An agent who declined the browser prompt, or whose
     * phone was replaced, must still be told they have been suspended — that
     * is the message they must not miss.
     */
    await withTransaction((client) =>
      queueNotification(client, {
        event: 'AGENT_SUSPENDED',
        agentId,
        variables: { reason: 'Test' },
      }),
    );

    const channels = (await notificationsFor('AGENT_SUSPENDED')).map((row) => row.channel);
    assert.ok(channels.includes('SMS'), 'the SMS must still go');
    assert.ok(channels.includes('PUSH'));
  });

  it('is skipped rather than misaddressed when there is no user behind it', async () => {
    // A taxpayer holds no account here. A PUSH template on a taxpayer-facing
    // event must queue nothing rather than queue a row addressed to a phone.
    const taxpayerId = (await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
       VALUES ('INDIVIDUAL','No','Account','+2348098000099','1 Nowhere',
               (SELECT id FROM lgas LIMIT 1),'ACTIVE','AGENT')
       RETURNING id`,
    ))!.id;

    await query(
      pool,
      `INSERT INTO notification_templates (code, event, channel, body)
       VALUES ('TEST_PUSH_NO_USER','TIN_CREATED','PUSH','Your TIN is {{tin}}')
       ON CONFLICT (code) DO NOTHING`,
    );

    await withTransaction((client) =>
      queueNotification(client, { event: 'TIN_CREATED', taxpayerId, variables: { tin: 'P123' } }),
    );

    const push = (await notificationsFor('TIN_CREATED')).filter((row) => row.channel === 'PUSH');
    assert.deepEqual(
      push,
      [],
      'a push with nobody to deliver it to must not be queued against a phone number',
    );
  });
});

describe('the two places a template is written', () => {
  /**
   * `seed.ts` and the migration must say the same thing.
   *
   * New templates go in both: `seed.ts` so a fresh database has them and the
   * catalogue stays readable, and a migration so a deployment that already
   * exists gets them without a reseed. Both insert `ON CONFLICT (code) DO
   * NOTHING`, and migrations run first — so on every real database it is the
   * migration's wording that takes effect and `seed.ts`'s copy is dead text.
   *
   * That was found by mutation: changing the message in `seed.ts` alone
   * changed nothing and no test noticed. An author editing the sentence a
   * citizen or an agent reads would reasonably edit the readable catalogue and
   * believe they had done it. This makes the divergence fail instead.
   */
  it('agree, or the one nobody reads wins', () => {
    const seed = readFileSync(join(__dirname, '..', 'db', 'seed.ts'), 'utf8');
    const migrations = join(__dirname, '..', 'db', 'migrations');

    const seeded = new Map<string, string>();
    for (const match of seed.matchAll(
      /\{\s*code:\s*'([A-Z0-9_]+)'[^}]*?body:\s*'((?:[^'\\]|\\.)*)'/g,
    )) {
      seeded.set(match[1]!, normalise(match[2]!));
    }
    assert.ok(seeded.size > 15, `expected the seeded templates, found ${seeded.size}`);

    const disagreements: string[] = [];
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql'))) {
      const sql = readFileSync(join(migrations, file), 'utf8');
      for (const match of sql.matchAll(
        /\('([A-Z0-9_]+)',\s*'[A-Z0-9_]+',\s*'(?:SMS|EMAIL|PUSH|WHATSAPP)',\s*(?:NULL|'[^']*'),\s*((?:'(?:[^']|'')*'\s*(?:\|\|)?\s*)+)\)/g,
      )) {
        const code = match[1]!;
        if (!seeded.has(code)) continue;
        const body = normalise(
          match[2]!
            .split(/\s*\|\|\s*/)
            .map((part) => part.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
            .join(''),
        );
        if (body !== seeded.get(code)) {
          disagreements.push(`${code} (${file})\n    seed:      ${seeded.get(code)}\n    migration: ${body}`);
        }
      }
    }

    assert.deepEqual(
      disagreements,
      [],
      'these templates are written twice and the two copies differ. Migrations run first and ' +
        'both insert ON CONFLICT DO NOTHING, so the migration wins and the seed is dead text:\n  ' +
        disagreements.join('\n  '),
    );
  });
});

/** Whitespace and escapes only; the words are what must match. */
function normalise(body: string): string {
  return body
    .replace(/\\'/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('a payment that did not go through', () => {
  /**
   * Success queues a notification and failure queues nothing.
   *
   * A `PAYMENT_FAILED` template has been seeded from the beginning and no code
   * path has ever raised the event. The failure branch transitions the payment,
   * transitions the transaction, writes an audit entry, and returns a sentence
   * to whichever client made the call — which is the agent's handset, not the
   * citizen.
   *
   * That asymmetry is the wrong way round. A citizen whose payment succeeded
   * finds out anyway: a receipt follows. A citizen whose payment failed may
   * have been debited by their own bank and had the gateway report failure
   * regardless, and PRD §60 exists because somebody who cannot tell whether
   * their money left their account pays a second time.
   */
  it('tells the taxpayer, who is the one who does not otherwise find out', async () => {
    const session = await loginAs(demoPhone, demoPassword, demoDevice);
    const auth = { token: session.accessToken, deviceId: demoDevice };

    const created = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Failed',
        lastName: 'Payer',
        phone: '+2348098200001',
        address: '5 Market Rd',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...auth, idempotencyKey: 'fail-tp-1' },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: created.body.taxpayerId,
        revenueItemId: await revenueItemByCode('MARKET-LEVY'),
        inputs: {},
      },
      { ...auth, idempotencyKey: 'fail-as-1' },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    const initiated = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId },
      { ...auth, idempotencyKey: 'fail-pay-1' },
    );
    assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

    await post(
      '/payments/simulate',
      {
        gatewayReference: initiated.body.gatewayReference,
        outcome: 'FAILED',
        deliverWebhook: true,
      },
      auth,
    );

    const queued = await notificationsFor('PAYMENT_FAILED');
    assert.ok(
      queued.length > 0,
      'a PAYMENT_FAILED template is seeded and no code path has ever raised the event',
    );
    assert.ok(
      queued.some((row) => /no money|not been taken|not been received/i.test(row.message)),
      `they must be told their money was not taken: ${JSON.stringify(queued.map((r) => r.message))}`,
    );
  });
});
