/**
 * A credential the notification queue kept after it had delivered it.
 *
 * Two tables in this schema deliberately hold only a hash, and both say so in
 * the code that writes them:
 *
 *   otp_codes.code_hash               sha256(code), in services/auth.ts
 *   referee_invitations.token_hash    sha256(token), in services/referees.ts
 *
 * The referee module's own header put it plainly — "Invitation tokens are
 * stored only as hashes (§37): the plaintext exists once, in the message sent
 * to the referee."
 *
 * It existed twice. `queueNotification` rendered the template in full into
 * `notifications.message`, so the SMS carrying the one-time code, and the SMS
 * carrying the invitation link, sat in the same database as the hash — and
 * nothing has ever deleted a notification, so they sat there permanently.
 * Neither hash was doing any work. This join, run by hand against the UAT
 * database, resolved two invitations from their own queued SMS, one of them
 * still SENT and a fortnight from expiry:
 *
 *   SELECT i.status
 *     FROM notifications n
 *     JOIN referee_invitations i
 *       ON i.invitation_token_hash =
 *          encode(digest(substring(n.message from 'referee/([A-Za-z0-9_-]+)'),
 *                        'sha256'), 'hex');
 *
 * That is the shape this file tests, and it is deliberately tested by the
 * mechanism rather than by the two events known to carry a credential: every
 * word-shaped substring of every stored body is hashed and looked for in both
 * credential tables. A third credential rendered into a third template is
 * caught by the same assertion on the day it is added, without anyone
 * remembering to come back here.
 *
 * The plaintext still has to reach the gateway, so it is carried in
 * `secret_message` and cleared as the row becomes SENT or FAILED — which is
 * the other half of what is checked below. A fix that stopped the leak by
 * sending the citizen a masked code would be worse than the leak.
 */

import './env';
import { createHash } from 'node:crypto';
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
import { dispatchQueued, queueNotification } from '../services/notifications';
import { requestOtp } from '../services/auth';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

/** An applicant who has applied and nothing more, so no referee is on file. */
let agentId = '';
let agentToken = '';
let agentPhone = '';

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: '+2348099200001', fullName: 'Queue Admin' });

  agentPhone = '+2348099200011';
  const application = await post('/agents/apply', {
    fullName: 'Queue Applicant',
    phone: agentPhone,
    password: 'FieldAgent2026',
    address: '11 Yakubu Gowon Way, Jos',
    lgaId: await firstLgaId(),
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: 'Queue Applicant',
    accountNumber: '0223456701',
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));
  agentId = application.body.agentId as string;
  agentToken = (await loginAs(agentPhone, 'FieldAgent2026')).accessToken;
});

/** Nominate a referee the way the applicant does, and hand back their token. */
async function inviteReferee(phone = '+2348099200077') {
  const response = await post(
    '/agents/me/referees',
    {
      fullName: 'Ladi Bature',
      phone,
      category: 'COMMUNITY_LEADER',
      relationship: 'Neighbour of twelve years',
    },
    { token: agentToken },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return (response.body.invitationUrl as string).split('/referee/')[1]!;
}

/**
 * Every credential this database claims to hold only as a hash.
 *
 * The columns are discovered from `information_schema` rather than listed,
 * because listing them is the failure this test exists to prevent. There are
 * four today — `otp_codes.code_hash`, `referee_invitations.
 * invitation_token_hash`, `group_attestation_invitations.
 * invitation_token_hash` and `sessions.refresh_token_hash` — and only the
 * first two reach a template at all. The attestation link is handed to an
 * officer to forward rather than queued, which is a property of one call site
 * and could change in a commit that has nothing to do with this file.
 */
async function hashedCredentials(): Promise<Map<string, string>> {
  const columns = await query<{ table_name: string; column_name: string }>(
    pool,
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name LIKE '%token_hash%' OR column_name LIKE '%code_hash%')
      ORDER BY table_name, column_name`,
  );
  assert.ok(
    columns.length >= 4,
    `expected the four hashed-credential columns, found ${columns.length} — has one been renamed?`,
  );

  const found = new Map<string, string>();
  for (const column of columns) {
    const rows = await query<{ hash: string | null }>(
      pool,
      // Identifiers, not values: both halves come from information_schema and
      // match a restrictive LIKE, so there is nothing here a caller supplies.
      `SELECT "${column.column_name}" AS hash FROM "${column.table_name}"`,
    );
    for (const row of rows) {
      if (row.hash) found.set(row.hash, `${column.table_name}.${column.column_name}`);
    }
  }
  return found;
}

/**
 * The retained record, as a database reader sees it.
 *
 * `secret_message` is deliberately excluded: it is the in-flight copy, and
 * that it holds the plaintext is the design. What must not hold it is the
 * columns that stay.
 */
const retainedBodies = () =>
  query<{ id: string; event: string; status: string; subject: string | null; message: string }>(
    pool,
    'SELECT id, event, status, subject, message FROM notifications ORDER BY created_at',
  );

/**
 * Substrings of a message that could be a credential.
 *
 * A one-time code is digits; an invitation token is a URL-safe base64 word.
 * Taking every run of four or more of either is wider than both and costs
 * nothing — a substring that is not a credential simply hashes to something no
 * table holds.
 *
 * A numeric run that is not the code could in principle equal one that is: an
 * unrelated six-digit figure in another message, matching the six-digit OTP
 * this fixture issued. That is one chance in a million per run, and the report
 * would name the table it matched, so anyone who meets it can tell a collision
 * from a leak in one line.
 */
function candidates(text: string): string[] {
  return text.match(/[A-Za-z0-9_-]{4,}/g) ?? [];
}

describe('a credential rendered into a notification', () => {
  it('is not left in the retained body once it has been delivered', async () => {
    await requestOtp({ destination: agentPhone, purpose: 'LOGIN' });
    await inviteReferee();
    await dispatchQueued(pool);

    const credentials = await hashedCredentials();
    assert.ok(credentials.size >= 2, 'the fixture wrote no hashed credential to look for');

    const leaks: string[] = [];
    for (const row of await retainedBodies()) {
      for (const text of [row.message, row.subject ?? '']) {
        for (const candidate of candidates(text)) {
          const table = credentials.get(sha256(candidate));
          if (table) leaks.push(`${row.event} (${row.status}) holds, in plaintext, a value ${table} keeps only as a hash`);
        }
      }
    }

    assert.deepEqual(
      leaks,
      [],
      `the point of hashing the credential is that the database does not hold it:\n${leaks.join('\n')}`,
    );
  });

  it('still reaches the person it was sent to, unmasked', async () => {
    const { developmentCode } = await requestOtp({ destination: agentPhone, purpose: 'LOGIN' });
    const token = await inviteReferee();
    assert.ok(developmentCode, 'the mock provider is configured, so the code is returned');

    /*
     * The provider's own log line is the evidence, because it is the only
     * place the delivered text exists after the sweep. A fix that masked the
     * body everywhere — including on the wire — would pass the test above and
     * send a citizen six blocks where their code should be.
     */
    const delivered: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => {
      delivered.push(args.map(String).join(' '));
    };
    try {
      await dispatchQueued(pool);
    } finally {
      console.log = realLog;
    }

    const sent = delivered.join('\n');
    assert.ok(
      sent.includes(developmentCode!),
      'the one-time code must reach the handset, not a mask of it',
    );
    assert.ok(
      sent.includes(token),
      'the invitation link must reach the referee, or they cannot answer at all',
    );
  });

  it('leaves the queue holding nothing once the gateway has taken it', async () => {
    await requestOtp({ destination: agentPhone, purpose: 'LOGIN' });
    await inviteReferee();

    const beforeSweep = await query<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM notifications WHERE secret_message IS NOT NULL`,
    );
    assert.equal(
      beforeSweep[0]!.count,
      '2',
      'both credential-bearing messages should be carrying their plaintext while queued',
    );

    await dispatchQueued(pool);

    const afterSweep = await query<{ status: string; secret_message: string | null }>(
      pool,
      `SELECT status, secret_message FROM notifications WHERE event IN ('SECURITY_ALERT','REFEREE_INVITATION')`,
    );
    assert.ok(afterSweep.length >= 2, 'nothing was queued at all');
    for (const row of afterSweep) {
      assert.equal(row.status, 'SENT');
      assert.equal(
        row.secret_message,
        null,
        'a row the gateway has finished with must not still be holding the credential',
      );
    }
  });

  it('holds it through an outage, because the message is still owed', async () => {
    // The mock provider answers UNAVAILABLE for a number ending in 8. The row
    // stays QUEUED and does not consume an attempt — so it must keep the body
    // it will need on the next sweep.
    await inviteReferee('+2348099200078');
    await dispatchQueued(pool);

    const row = await queryOne<{ status: string; attempts: number; secret_message: string | null }>(
      pool,
      `SELECT status, attempts, secret_message FROM notifications WHERE event = 'REFEREE_INVITATION'`,
    );
    assert.equal(row!.status, 'QUEUED');
    assert.equal(row!.attempts, 0);
    assert.ok(
      row!.secret_message,
      'clearing on an outage would leave the referee permanently unable to answer',
    );
  });

  it('still leaves a support officer a record worth reading', async () => {
    await inviteReferee();
    await dispatchQueued(pool);

    const row = await queryOne<{ message: string; status: string; language: string }>(
      pool,
      `SELECT message, status, language FROM notifications WHERE event = 'REFEREE_INVITATION'`,
    );
    // Who it was about and which nomination it was, both still legible. The
    // masking is of the credential, not of the message.
    assert.match(row!.message, /REF-/, 'the reference code is how an officer finds the nomination');
    assert.match(row!.message, /█{4,}/, 'the credential itself should read as withheld');
    assert.equal(row!.status, 'SENT');
  });

  it('is never rendered into a subject line by any active template', async () => {
    /*
     * A subject is a preview: it is what shows on a locked handset, in an
     * inbox list and in a push banner. Every template that carries a code puts
     * it in the body, and `queueNotification` masks the subject unconditionally
     * — so a template that put one there would deliver a mask and the recipient
     * would have nothing to type. That is a template bug, and this is where it
     * is caught.
     */
    const offenders = await query<{ code: string; subject: string }>(
      pool,
      `SELECT code, subject FROM notification_templates
        WHERE status = 'ACTIVE' AND subject IS NOT NULL
          AND (subject LIKE '%{{code}}%' OR subject LIKE '%{{link}}%')`,
    );
    assert.deepEqual(
      offenders.map((row) => row.code),
      [],
      'a one-time code or an invitation link belongs in the body, never in a preview',
    );
  });

  it('is not held by a message that carries no credential at all', async () => {
    // The control. `secret_message` exists for two events; every other
    // notification must be queued exactly as it was before, in one column.
    await withTransaction((client) =>
      queueNotification(client, {
        event: 'AGENT_APPROVED',
        agentId,
        variables: { name: 'Demo Field Agent' },
      }),
    );

    const row = await queryOne<{ message: string; secret_message: string | null }>(
      pool,
      `SELECT message, secret_message FROM notifications WHERE event = 'AGENT_APPROVED'`,
    );
    assert.ok(row, 'nothing was queued');
    assert.equal(row!.secret_message, null, 'no credential, no second copy');
    assert.doesNotMatch(row!.message, /█/, 'and nothing masked out of it');
  });
});
