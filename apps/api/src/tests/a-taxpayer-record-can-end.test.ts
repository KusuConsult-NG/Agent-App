/**
 * Taking a taxpayer record off the register.
 *
 * `taxpayers.status` has allowed SUSPENDED and CLOSED since the second
 * migration, and nothing could ever write either. A record was created ACTIVE
 * by an agent in the field and stayed that way for ever, so a business that
 * shut two years ago went on accruing assessments and went on being sent
 * reminders, and whoever inherited the phone number went on receiving them.
 *
 * The readers were already built for this. `createAssessment` has always
 * refused a taxpayer whose status is not ACTIVE, with an error code of its
 * own, and that refusal had never once fired in the life of this platform.
 *
 * The whole risk in building the writer is that closing quietly becomes
 * forgiveness. It must not: an invoice raised before the record closed is
 * still owed, still payable, and still in every total of what the State is
 * due. So the tests below are mostly about what closing does *not* do, and
 * about the queue that stops a closed record with arrears becoming a debt that
 * is nobody's job.
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { sendDueReminders } from '../services/reminders';

let agent: { token: string; device: string };
let officer = '';
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
  await createGovernmentUser({ fullName: 'Register Admin', phone: '+2348038000001', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Register Officer',
    phone: '+2348038000002',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348038000002')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  sequence = 0;
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });

/** A registered taxpayer, optionally with an unpaid assessment against them. */
async function taxpayer(options: { withArrears?: boolean } = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(2, '0');
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'BUSINESS',
      businessName: `Shuttered Trading ${suffix}`,
      phone: `+23481070000${suffix}`,
      address: '14 Ahmadu Bello Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...asAgent(), idempotencyKey: `end-tp-${suffix}` },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.taxpayerId as string;

  if (options.withArrears) {
    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId: id, revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'), inputs: {} },
      { ...asAgent(), idempotencyKey: `end-as-${suffix}` },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  }
  return id;
}

const setStatus = (id: string, status: string, reason: string, token = officer) =>
  post(`/taxpayers/${id}/status`, { status, reason }, { token });

const statusRow = (id: string) =>
  queryOne<{ status: string; status_reason: string | null; status_changed_by: string | null }>(
    pool,
    'SELECT status, status_reason, status_changed_by FROM taxpayers WHERE id = $1',
    [id],
  );

describe('A record that is taken off the register', () => {
  it('stops accruing new charges, and says who ended it and why', async () => {
    const id = await taxpayer();

    const closed = await setStatus(
      id,
      'CLOSED',
      'Premises visited: the shop has been empty since the market fire in March.',
    );
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.status, 'CLOSED');
    assert.equal(closed.body.previousStatus, 'ACTIVE');

    const row = await statusRow(id);
    assert.equal(row?.status, 'CLOSED');
    assert.match(row!.status_reason!, /market fire/);
    assert.ok(row!.status_changed_by, 'the officer who ended it is on the record');

    // The guard that has existed since the beginning and never once fired.
    const refused = await post(
      '/revenue/assessments',
      { taxpayerId: id, revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'), inputs: {} },
      { ...asAgent(), idempotencyKey: 'end-after-close' },
    );
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'TAXPAYER_NOT_ACTIVE');
  });

  it('does not forgive what was already owed', async () => {
    const id = await taxpayer({ withArrears: true });

    const before = await queryOne<{ owed: string }>(
      pool,
      `SELECT COALESCE(SUM(total_amount_kobo - amount_paid_kobo),0)::text AS owed
         FROM invoices WHERE taxpayer_id = $1 AND status IN ('UNPAID','PARTIALLY_PAID')`,
      [id],
    );
    assert.ok(BigInt(before!.owed) > 0n, 'the fixture should owe something');

    const closed = await setStatus(id, 'CLOSED', 'Owner deceased; family confirmed the shop is shut.');
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.outstandingKobo, before!.owed, 'the officer is told what they are leaving');
    assert.match(closed.body.message, /already owed remains owed/i);

    const after = await queryOne<{ owed: string; statuses: string }>(
      pool,
      `SELECT COALESCE(SUM(total_amount_kobo - amount_paid_kobo),0)::text AS owed,
              string_agg(DISTINCT status, ',') AS statuses
         FROM invoices WHERE taxpayer_id = $1`,
      [id],
    );
    assert.equal(after!.owed, before!.owed, 'closing a record must not write off a debt');
    assert.equal(after!.statuses, 'UNPAID', 'and must not touch the invoice at all');
  });

  it('stops the reminder sweep chasing it', async () => {
    const chased = await taxpayer({ withArrears: true });
    const ended = await taxpayer({ withArrears: true });

    // Both invoices moved into the six-week window, the way the reminder test
    // does it: the sweep is driven by the expiry date, not by the clock.
    await pool.query(
      `UPDATE invoices SET expires_at = now() + interval '42 days', status = 'UNPAID',
              reminder_sent_6w = false
        WHERE taxpayer_id = ANY($1::uuid[])`,
      [[chased, ended]],
    );

    await setStatus(ended, 'CLOSED', 'Business wound up; notice filed with the corporate registry.');

    const result = await sendDueReminders();
    assert.equal(result.sent, 1, `exactly one of the two should be chased: ${JSON.stringify(result)}`);

    const reminded = await query<{ taxpayer_id: string }>(
      pool,
      `SELECT DISTINCT n.user_id, t.id AS taxpayer_id
         FROM notifications n JOIN taxpayers t ON t.phone = n.recipient
        WHERE n.event = 'TAX_REMINDER_6W'`,
    );
    const remindedIds = reminded.map((row) => row.taxpayer_id);
    assert.ok(remindedIds.includes(chased), 'the open record is still chased');
    assert.ok(!remindedIds.includes(ended), 'the ended record is not');
  });
});

describe('A debt on a record nobody is chasing', () => {
  it('appears in a queue an officer works', async () => {
    const owing = await taxpayer({ withArrears: true });
    const clear = await taxpayer();
    // An open record that owes money. It belongs in the ordinary arrears work
    // and the reminder sweep is still chasing it, so it must not appear here —
    // this queue is about debts nobody is behind any more, not about debts.
    const stillTrading = await taxpayer({ withArrears: true });

    await setStatus(owing, 'CLOSED', 'Shop shut and the trader has left the state.');
    await setStatus(clear, 'CLOSED', 'Duplicate of an older record; nothing outstanding.');

    const queue = await get('/taxpayers/ended-with-arrears', { token: officer });
    assert.equal(queue.status, 200, JSON.stringify(queue.body));

    const rows = queue.body.taxpayers as { id: string; outstanding_kobo: string; status: string; ended_by: string }[];
    assert.ok(
      !rows.some((row) => row.id === stillTrading),
      'an open record with arrears is ordinary work, not this queue',
    );
    assert.equal(rows.length, 1, 'only the ended one that still owes something');
    assert.equal(rows[0]!.id, owing);
    assert.equal(rows[0]!.status, 'CLOSED');
    assert.ok(BigInt(rows[0]!.outstanding_kobo) > 0n);
    assert.equal(rows[0]!.ended_by, 'Register Officer', 'and who took it off the register');
  });

  it('leaves the queue when the debt is paid, not when the record is closed', async () => {
    const id = await taxpayer({ withArrears: true });
    await setStatus(id, 'SUSPENDED', 'Trading licence revoked pending an environmental hearing.');

    assert.equal((await get('/taxpayers/ended-with-arrears', { token: officer })).body.taxpayers.length, 1);

    // Settling the invoice is what clears it. Done directly, because paying a
    // suspended taxpayer's invoice through the agent path is a separate
    // question from whether this queue reads the invoices honestly.
    await pool.query(
      `UPDATE invoices SET status = 'PAID', amount_paid_kobo = total_amount_kobo
        WHERE taxpayer_id = $1`,
      [id],
    );
    assert.equal((await get('/taxpayers/ended-with-arrears', { token: officer })).body.taxpayers.length, 0);
  });
});

describe('Putting a record back', () => {
  it('can be reopened, because a taxpayer record cannot be made twice', async () => {
    const id = await taxpayer();
    await setStatus(id, 'CLOSED', 'Reported shut by the ward head at the June enumeration.');

    const reopened = await setStatus(id, 'ACTIVE', 'Trader produced a current tenancy; the shop never shut.');
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal((await statusRow(id))?.status, 'ACTIVE');

    // And it can be assessed again, which is the whole point of reopening.
    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId: id, revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'), inputs: {} },
      { ...asAgent(), idempotencyKey: 'end-reopened' },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  });

  it('refuses a status the record already holds, and a change with no reason', async () => {
    const id = await taxpayer();

    const noReason = await setStatus(id, 'CLOSED', 'shut');
    assert.equal(noReason.status, 422, JSON.stringify(noReason.body));
    assert.equal((await statusRow(id))?.status, 'ACTIVE');

    const same = await setStatus(id, 'ACTIVE', 'Confirming the record is active, which it already is.');
    assert.equal(same.status, 400, JSON.stringify(same.body));
  });

  it('is not an agent’s to make', async () => {
    const id = await taxpayer();
    const refused = await post(
      `/taxpayers/${id}/status`,
      { status: 'CLOSED', reason: 'An agent closing a record they registered themselves.' },
      asAgent(),
    );
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal((await statusRow(id))?.status, 'ACTIVE');
  });
});

describe('What the citizen is told about their own ended record', () => {
  /**
   * The lookup required `status = 'ACTIVE'`, which was harmless while nothing
   * could be anything else. The moment a record can be closed, that filter
   * starts telling somebody who may still owe money that PSIRS has no record
   * of them — the platform asserting something untrue about money, which is
   * the one thing §95 exists to prevent.
   */
  it('finds the record, says it has ended, and says what is still owed', async () => {
    const id = await taxpayer({ withArrears: true });
    const phone = (await queryOne<{ phone: string }>(pool, 'SELECT phone FROM taxpayers WHERE id = $1', [id]))!.phone;

    await setStatus(id, 'CLOSED', 'Premises empty at three visits; neighbours say the trader moved.');

    const lookup = await get(`/citizen-status?phone=${encodeURIComponent(phone)}`);
    assert.equal(lookup.status, 200, JSON.stringify(lookup.body));
    assert.equal(lookup.body.found, true, 'a closed record is still this person’s record');
    assert.equal(lookup.body.hasOutstanding, true, 'and what they owe is unchanged');
    assert.equal(lookup.body.ended?.status, 'CLOSED');
    assert.match(lookup.body.ended.reason, /Premises empty/);
    assert.match(lookup.body.ended.message, /still owed and can still be paid/i);
    assert.match(lookup.body.ended.message, /if this is wrong/i);
  });

  it('says nothing about an ending to somebody whose record is open', async () => {
    const id = await taxpayer();
    const phone = (await queryOne<{ phone: string }>(pool, 'SELECT phone FROM taxpayers WHERE id = $1', [id]))!.phone;

    const lookup = await get(`/citizen-status?phone=${encodeURIComponent(phone)}`);
    assert.equal(lookup.body.found, true);
    assert.equal(lookup.body.ended, undefined);
  });
});
