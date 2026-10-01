/**
 * What the reminder sweep records, and what it actually sent.
 *
 * `sendDueReminders` flags each invoice inside a transaction before queuing
 * the message — deliberately, so a crash mid-send misses a reminder rather
 * than sending it twice. That is the right trade. What it does not do is check
 * whether anything was queued at all.
 *
 * `queueNotification` returns the number of messages it queued, and returns
 * zero when no ACTIVE template exists for the event. Deactivating a template
 * is not a fault — it is an intended operation, the reason templates live in
 * the database and carry a status column, so PSIRS can change the approved
 * wording of a demand without a code release. But while one is inactive the
 * sweep marks every invoice in the window as reminded, queues nothing, reports
 * "N reminder(s) sent", and because the flag is what stops a duplicate, those
 * taxpayers can never be reminded for that window again. Four sweeps a day
 * would work through the whole state.
 *
 * The second is smaller and has a fixed cost. The due date in the message is
 * rendered with `toLocaleDateString('en-NG')` and no time zone, so it comes out
 * in whatever zone the server runs in — UTC, in every container in this repo.
 * Nigeria is UTC+1 with no daylight saving, so an invoice expiring in the first
 * hour of a Lagos day is announced to the taxpayer as the day before.
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
  revenueItemByCode,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { REMINDER_WINDOWS, sendDueReminders } from '../services/reminders';

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
  /*
   * notification_templates is not among the tables resetDatabase truncates —
   * the reminder templates come from migration 016, and truncating them would
   * delete them for the rest of the run with no migration to put them back.
   * That means a test which deactivates one leaves it deactivated for every
   * test after it. Restoring the statuses here is what makes each case below
   * mean what it says; without it the second test passed against unfixed code
   * because the first had already switched its templates off.
   *
   * Restored by event rather than across the table. The blanket form was
   * `UPDATE notification_templates SET status = 'ACTIVE'` with no WHERE, which
   * repaired this file at the cost of every file after it in the same shard:
   * it switched on the templates the seed deliberately ships INACTIVE, and
   * `an-agent-paid-in-silence.test.ts` — which asserts that COMMISSION_EARNED
   * goes out by push and that its retired SMS wording stays switched off — then
   * failed against correct code. A fixture that reaches outside what its own
   * file touches is the D-14 defect again, one table further along; the events
   * below are the only ones this file moves.
   */
  await pool.query(
    `UPDATE notification_templates SET status = 'ACTIVE' WHERE event LIKE 'TAX_REMINDER%'`,
  );
  await createGovernmentUser({ fullName: 'Reminder Admin', phone: '+2348000000050', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/**
 * An unpaid invoice, with the expiry the platform gave it.
 *
 * Nothing is moved: this is what an invoice raised today actually looks like,
 * which is the only way to ask whether a reminder window can be reached.
 */
async function freshInvoice(suffix: string): Promise<string> {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Reminder',
      lastName: `Subject${suffix}`,
      phone: `+23480444${suffix.padStart(5, '0')}`,
      address: '2 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
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
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const invoice = await queryOne<{ id: string }>(
    pool,
    `SELECT i.id FROM invoices i
       JOIN assessments a ON a.id = i.assessment_id
      WHERE a.id = $1`,
    [assessment.body.assessmentId],
  );
  assert.ok(invoice, 'the assessment raised an invoice');

  return invoice!.id;
}

/**
 * The same invoice, due at a chosen instant.
 *
 * Moved in time, which is the honest way to reach a window that is two weeks
 * wide without waiting two weeks — honest only as far as the instant chosen is
 * one the platform can produce. See the last describe block in this file for
 * what that rules out.
 */
async function invoiceDueAt(suffix: string, expiresAt: Date): Promise<string> {
  const id = await freshInvoice(suffix);
  await pool.query('UPDATE invoices SET expires_at = $2 WHERE id = $1', [id, expiresAt]);
  return id;
}

/** Fourteen days out — squarely inside the two-week window (13–15 days). */
function twoWeeksOut(atUtcHour = 12, atUtcMinute = 0): Date {
  const when = new Date(Date.now() + 14 * 86_400_000);
  when.setUTCHours(atUtcHour, atUtcMinute, 0, 0);
  return when;
}

async function reminderFlag(invoiceId: string): Promise<boolean> {
  const row = await queryOne<{ reminder_sent_2w: boolean }>(
    pool,
    'SELECT reminder_sent_2w FROM invoices WHERE id = $1',
    [invoiceId],
  );
  return row!.reminder_sent_2w;
}

async function messagesFor(invoiceId: string) {
  return query<{ channel: string; message: string; recipient: string }>(
    pool,
    `SELECT channel, message, recipient FROM notifications
      WHERE entity_type = 'invoice' AND entity_id = $1`,
    [invoiceId],
  );
}

describe('The reminder sweep only counts what it actually queued', () => {
  it('does not burn the reminder flag when no active template exists', async () => {
    const invoiceId = await invoiceDueAt('1', twoWeeksOut());
    // PSIRS takes the two-week wording out of service to revise it. Every other
    // window is untouched.
    await pool.query(
      `UPDATE notification_templates SET status = 'INACTIVE' WHERE event = 'TAX_REMINDER_2W'`,
    );

    const result = await sendDueReminders(pool);

    assert.equal((await messagesFor(invoiceId)).length, 0, 'nothing was queued');
    assert.equal(result.sent, 0, `the sweep reported ${result.sent} sent having queued nothing`);
    assert.equal(
      await reminderFlag(invoiceId),
      false,
      'and it must not mark the invoice reminded, or this taxpayer never hears again',
    );
  });

  /*
   * The window-level check asks whether *a* template is active. This asks the
   * question the check cannot: an EMAIL-only template set, and a taxpayer with
   * no email address. A template is active, so the sweep proceeds — and this
   * particular taxpayer still has nothing queued for them.
   */
  it('does not burn the flag for a taxpayer no active channel can reach', async () => {
    const invoiceId = await invoiceDueAt('7', twoWeeksOut());
    await pool.query(
      `UPDATE notification_templates SET status = 'INACTIVE'
        WHERE event = 'TAX_REMINDER_2W' AND channel <> 'EMAIL'`,
    );
    await pool.query(
      `UPDATE taxpayers SET email = NULL WHERE id =
         (SELECT taxpayer_id FROM invoices WHERE id = $1)`,
      [invoiceId],
    );

    const result = await sendDueReminders(pool);

    assert.equal((await messagesFor(invoiceId)).length, 0, 'nothing could be queued');
    assert.equal(result.sent, 0, `the sweep reported ${result.sent} sent having queued nothing`);
    assert.equal(await reminderFlag(invoiceId), false, 'so the reminder is still owed');
  });

  it('reminds the taxpayer once the wording is back in service', async () => {
    const invoiceId = await invoiceDueAt('2', twoWeeksOut());
    await pool.query(
      `UPDATE notification_templates SET status = 'INACTIVE' WHERE event = 'TAX_REMINDER_2W'`,
    );
    await sendDueReminders(pool);

    await pool.query(
      `UPDATE notification_templates SET status = 'ACTIVE' WHERE event = 'TAX_REMINDER_2W'`,
    );
    const result = await sendDueReminders(pool);

    assert.ok(result.sent >= 1, 'the reminder is still owed and is now sent');
    assert.ok((await messagesFor(invoiceId)).length > 0);
    assert.equal(await reminderFlag(invoiceId), true);
  });

  it('names the due date in Nigerian time, not the server’s', async () => {
    // 23:30 UTC is 00:30 the next day in Lagos. The taxpayer's due date is the
    // Lagos one; the server happens to run in UTC.
    const expiresAt = twoWeeksOut(23, 30);
    const invoiceId = await invoiceDueAt('3', expiresAt);

    const inLagos = new Intl.DateTimeFormat('en-NG', {
      timeZone: 'Africa/Lagos',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(expiresAt);

    await sendDueReminders(pool);

    const messages = await messagesFor(invoiceId);
    assert.ok(messages.length > 0, 'a reminder was queued');
    for (const message of messages) {
      assert.ok(
        message.message.includes(inLagos),
        `${message.channel} names a date other than ${inLagos}: ${message.message.slice(0, 160)}`,
      );
    }
  });

  // --- controls ---

  it('still reminds a taxpayer whose payment is due in two weeks', async () => {
    const invoiceId = await invoiceDueAt('4', twoWeeksOut());

    const result = await sendDueReminders(pool);

    assert.ok(result.sent >= 1, JSON.stringify(result));
    assert.equal(await reminderFlag(invoiceId), true);
    const messages = await messagesFor(invoiceId);
    assert.ok(messages.length > 0, 'the message exists');
    assert.ok(
      messages.some((m) => m.channel === 'SMS'),
      'including the SMS, which is the copy most taxpayers actually get',
    );
    for (const message of messages) {
      assert.doesNotMatch(
        message.message,
        /\{\{|\s{2,}(due|is)\b/,
        `a placeholder went out unrendered: ${message.message.slice(0, 160)}`,
      );
    }
  });

  it('still never sends the same window twice', async () => {
    const invoiceId = await invoiceDueAt('5', twoWeeksOut());

    await sendDueReminders(pool);
    const afterFirst = (await messagesFor(invoiceId)).length;
    const second = await sendDueReminders(pool);

    assert.equal(second.sent, 0, 'the second sweep sends nothing');
    assert.equal((await messagesFor(invoiceId)).length, afterFirst);
  });

  it('still leaves an invoice outside every window alone', async () => {
    // Twenty days out: past the two-week window, short of the four-week one.
    const invoiceId = await invoiceDueAt('6', new Date(Date.now() + 20 * 86_400_000));

    const result = await sendDueReminders(pool);

    assert.equal(result.sent, 0, JSON.stringify(result));
    assert.equal((await messagesFor(invoiceId)).length, 0);
    assert.equal(await reminderFlag(invoiceId), false);
  });
});

// ===========================================================================
/**
 * A reminder nothing can reach.
 *
 * The sweep declares three windows — six, four and two weeks before an
 * invoice's expiry — and the file that declares them read as a description of
 * what PSIRS sends. `createAssessmentIn` gives every invoice thirty days to be
 * paid, and `invoiceValidityDays`, the parameter that would change that, is
 * passed by nothing anywhere: not a route, not a service, not a test. So the
 * gap between now and an invoice's expiry starts at thirty days and only
 * shrinks, and a window whose floor is forty-one days cannot be entered.
 *
 * TAX_REMINDER_6W has therefore never been sent to anybody. The template is
 * approved and the Hausa translation written; the flag column exists on every
 * invoice and is false on all of them. The two suites that appeared to cover
 * it first moved an invoice's expiry out to forty-two days, which is a state
 * the platform cannot produce — so what they proved was that the fixture ran.
 *
 * These measure it instead of asserting it, against an invoice with the expiry
 * the platform gave it, so the day a revenue item is given a longer window to
 * pay this fails rather than the comment quietly going out of date.
 */
describe('the reminder ladder, against the invoices the platform issues', () => {
  const window = (event: string) => {
    const found = REMINDER_WINDOWS.find((entry) => entry.event === event);
    assert.ok(found, `no ${event} window`);
    return found!;
  };

  /** The validity of an invoice the platform just raised, in whole days. */
  async function validityOf(invoiceId: string): Promise<number> {
    const row = await queryOne<{ days: string }>(
      pool,
      `SELECT round(EXTRACT(EPOCH FROM (expires_at - now())) / 86400)::text AS days
         FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    return Number.parseInt(row!.days, 10);
  }

  it('gives every invoice thirty days, because nothing can ask for more', async () => {
    const invoiceId = await freshInvoice('10');
    assert.equal(
      await validityOf(invoiceId),
      30,
      'the only validity this platform issues, and the number every window below is judged against',
    );
  });

  it('cannot reach the six-week window with any invoice it can raise', async () => {
    const validity = await validityOf(await freshInvoice('11'));
    const sixWeeks = window('TAX_REMINDER_6W');

    assert.ok(
      sixWeeks.minDays > validity,
      `the six-week window opens at ${sixWeeks.minDays} days and an invoice is born with ` +
        `${validity}; the gap only shrinks from there, so nothing can ever be inside it`,
    );
  });

  it('reaches the other two, and reaches the four-week one the next day', async () => {
    const validity = await validityOf(await freshInvoice('12'));

    for (const event of ['TAX_REMINDER_4W', 'TAX_REMINDER_2W']) {
      assert.ok(
        window(event).maxDays <= validity,
        `${event} opens at ${window(event).maxDays} days, within the ${validity} an invoice has`,
      );
    }

    /*
     * And how soon. A thirty-day invoice is inside the 27–29 day window one
     * day after it is raised, so the taxpayer assessed on the Monday is told
     * on the Tuesday that they have four weeks to pay. True, and not what a
     * ladder of three reminders was drawn for — recorded here as a figure
     * rather than an opinion.
     */
    assert.equal(validity - window('TAX_REMINDER_4W').maxDays, 1);
  });

  it('sends no six-week reminder across the whole life of a real invoice', async () => {
    /*
     * The end-to-end form. The invoice is walked through every day of its life
     * by moving its expiry one day closer at a time — each of those is a state
     * the platform reaches on its own — and the sweep is run at each step.
     * Forty-one days is never among them.
     */
    const invoiceId = await freshInvoice('13');

    for (let daysLeft = 30; daysLeft >= 3; daysLeft -= 1) {
      await pool.query(
        `UPDATE invoices SET expires_at = now() + ($2 || ' days')::interval WHERE id = $1`,
        [invoiceId, String(daysLeft)],
      );
      await sendDueReminders();
    }

    const flags = await queryOne<{
      reminder_sent_6w: boolean;
      reminder_sent_4w: boolean;
      reminder_sent_2w: boolean;
    }>(
      pool,
      `SELECT reminder_sent_6w, reminder_sent_4w, reminder_sent_2w FROM invoices WHERE id = $1`,
      [invoiceId],
    );

    assert.equal(flags!.reminder_sent_4w, true, 'the four-week reminder went out');
    assert.equal(flags!.reminder_sent_2w, true, 'and the two-week one');
    assert.equal(
      flags!.reminder_sent_6w,
      false,
      'and the six-week one did not, on any day of the invoice it was meant for',
    );

    const sent = await query<{ event: string }>(
      pool,
      `SELECT DISTINCT event FROM notifications
        WHERE entity_type = 'invoice' AND entity_id = $1 AND event LIKE 'TAX_REMINDER%'`,
      [invoiceId],
    );
    const events = sent.map((row) => row.event).sort();
    assert.deepEqual(
      events,
      ['TAX_REMINDER_2W', 'TAX_REMINDER_4W'],
      'two of the three reminders exist for this taxpayer, and the suite says which two',
    );
  });
});
