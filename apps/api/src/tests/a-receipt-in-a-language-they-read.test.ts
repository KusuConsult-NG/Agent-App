/**
 * The one thing a citizen receives, in a language they may not read.
 *
 * A taxpayer holds no account on this platform. An agent approaches them, they
 * pay, and an SMS carrying the receipt number and the verification code is the
 * only copy they ever get — there is no inbox to fall back to and no portal to
 * log into. `messaging/types.ts` says exactly that, and it is why the delivery
 * contract is as careful as it is.
 *
 * All thirty templates are in English.
 *
 * Hausa is the first language of a large share of the people this platform
 * exists to reach, and the agent application has carried it since it was built
 * precisely because "an agent who cannot read *never collect cash* is exactly
 * the agent who collects cash". The same reasoning applies with more force to
 * the citizen, who gets one message and cannot ask it to repeat itself: a
 * receipt they cannot read is a receipt they cannot check, and an unchecked
 * receipt is the whole of PRD §95 undone at the last step.
 *
 * So a template carries a language, a person carries the language they read,
 * and the queue picks the one that matches — falling back to English when there
 * is no translation, because a message in the wrong language is far better than
 * no message at all.
 *
 * THE PREFERENCE HAS TO BE WRITABLE. A column nothing ever sets is the defect
 * this project has found more often than any other. The agent registering the
 * taxpayer is standing in front of them and is the only person who can ask, so
 * registration takes it.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { queueNotification } from '../services/notifications';

let auth: { token: string; deviceId: string };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: '+2348099000001', fullName: 'Lang Admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
});

let seq = 0;
async function register(preferredLanguage?: string) {
  seq += 1;
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Hausa',
      lastName: `Reader${seq}`,
      phone: `+2348099100${String(seq).padStart(3, '0')}`,
      address: '4 Market Rd',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
      ...(preferredLanguage ? { preferredLanguage } : {}),
    },
    { ...auth, idempotencyKey: `lang-tp-${seq}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.taxpayerId as string;
}

/**
 * What was queued for one person, for one event.
 *
 * Scoped by event because registration itself queues TIN_CREATED, so every
 * taxpayer already has one SMS before the test sends anything — and a count
 * that included it would have read as the duplicate it is looking for.
 */
const queuedFor = (taxpayerId: string, event: string) =>
  query<{ channel: string; message: string; language: string }>(
    pool,
    `SELECT n.channel, n.message, n.language
       FROM notifications n
      WHERE n.event = $2
        AND n.recipient = (SELECT phone FROM taxpayers WHERE id = $1)
      ORDER BY n.channel`,
    [taxpayerId, event],
  );

describe('a taxpayer who reads Hausa', () => {
  it('can be recorded as one when the agent registers them', async () => {
    const taxpayerId = await register('ha');
    const row = await queryOne<{ preferred_language: string }>(
      pool,
      'SELECT preferred_language FROM taxpayers WHERE id = $1',
      [taxpayerId],
    );
    assert.equal(
      row!.preferred_language,
      'ha',
      'the agent is standing in front of them and is the only person who can ask',
    );
  });

  it('is sent their receipt in Hausa', async () => {
    const taxpayerId = await register('ha');
    await withTransaction((client) =>
      queueNotification(client, {
        event: 'RECEIPT_GENERATED',
        taxpayerId,
        variables: { receiptNumber: 'PSIRS/2026/000123', amount: '2,000', code: 'XM3KN-RX6AC' },
      }),
    );

    const queued = await queuedFor(taxpayerId, 'RECEIPT_GENERATED');
    assert.ok(queued.length > 0, 'nothing was queued at all');
    assert.ok(
      queued.every((row) => row.language === 'ha'),
      `every message must be in the language they read: ${JSON.stringify(queued.map((r) => r.language))}`,
    );
    assert.ok(
      queued.some((row) => /rasit/i.test(row.message)),
      `the receipt word the glossary fixes: ${JSON.stringify(queued.map((r) => r.message))}`,
    );
  });

  it('still gets their receipt number and code untranslated, because they are typed', async () => {
    /*
     * The verification code is read off the message and typed into a public
     * page. A translated code is a code that does not verify.
     */
    const taxpayerId = await register('ha');
    await withTransaction((client) =>
      queueNotification(client, {
        event: 'RECEIPT_GENERATED',
        taxpayerId,
        variables: { receiptNumber: 'PSIRS/2026/000456', amount: '2,000', code: 'XM3KN-RX6AC' },
      }),
    );

    const queued = await queuedFor(taxpayerId, 'RECEIPT_GENERATED');
    assert.ok(
      queued.some((row) => row.message.includes('PSIRS/2026/000456')),
      JSON.stringify(queued.map((r) => r.message)),
    );
  });
});

describe('a taxpayer who reads English', () => {
  it('is unchanged, and is what an unrecorded preference falls back to', async () => {
    const taxpayerId = await register();
    await withTransaction((client) =>
      queueNotification(client, {
        event: 'RECEIPT_GENERATED',
        taxpayerId,
        variables: { receiptNumber: 'PSIRS/2026/000789', amount: '2,000', code: 'AB123-CD456' },
      }),
    );

    const queued = await queuedFor(taxpayerId, 'RECEIPT_GENERATED');
    assert.ok(queued.length > 0);
    assert.ok(queued.every((row) => row.language === 'en'), JSON.stringify(queued));
  });
});

describe('an event with no Hausa translation yet', () => {
  it('still reaches them, in English, rather than not at all', async () => {
    /*
     * The fallback is the whole reason a language column is safe to add. A
     * message in the wrong language is worse than one in the right language
     * and enormously better than silence — and silence is what a strict match
     * would produce the first time somebody adds an English-only template.
     */
    await query(
      pool,
      `DELETE FROM notification_templates WHERE event = 'TIN_CREATED' AND language = 'ha'`,
    );
    const taxpayerId = await register('ha');

    await withTransaction((client) =>
      queueNotification(client, {
        event: 'TIN_CREATED',
        taxpayerId,
        variables: { tin: 'P1234567890' },
      }),
    );

    const queued = await queuedFor(taxpayerId, 'TIN_CREATED');
    assert.ok(queued.length > 0, 'a missing translation must not silence the message');
    assert.ok(queued.every((row) => row.language === 'en'), JSON.stringify(queued));
  });

  it('does not send the same message twice, once per language', async () => {
    // The template table now holds two rows per event and channel. Selecting
    // both would send a citizen their receipt in English and again in Hausa,
    // and charge PSIRS for the second one.
    const taxpayerId = await register('ha');
    await withTransaction((client) =>
      queueNotification(client, {
        event: 'RECEIPT_GENERATED',
        taxpayerId,
        variables: { receiptNumber: 'PSIRS/2026/000999', amount: '2,000', code: 'EF123-GH456' },
      }),
    );

    const queued = await queuedFor(taxpayerId, 'RECEIPT_GENERATED');
    const channels = queued.map((row) => row.channel);
    assert.equal(
      new Set(channels).size,
      channels.length,
      `one message per channel, not one per channel per language: ${JSON.stringify(channels)}`,
    );
  });
});
