/**
 * Two reminder sweeps running at once, and the citizen who gets two texts.
 *
 * `server.ts` says of the scheduled sweep:
 *
 *   "The sweep is idempotent: each window is flagged on the invoice after the
 *    first send, so running it more than once never duplicates a reminder."
 *
 * That is true one after another and false side by side. The sweep selects the
 * invoices whose window flag is false, then for each one opens a transaction
 * and sets the flag before queueing — "better to miss one than to spam", as
 * its own comment puts it. But the write is
 *
 *     UPDATE invoices SET reminder_sent_2w = true WHERE id = $1
 *
 * with no condition on the flag. Two sweeps both select the invoice while the
 * flag is still false; the first takes the row lock, commits and queues; the
 * second unblocks, sets true to true, and queues the same reminder again.
 *
 * WHY TWO SWEEPS CAN RUN AT ONCE
 *
 * The scheduled one goes through `runJob`, which holds a session-level
 * advisory lock, so two instances cannot both sweep. `POST
 * /government/reminders/send-due` calls `sendDueReminders()` directly and
 * takes no lock at all — so an officer pressing the button while the schedule
 * is running, or two officers pressing it together, is exactly this.
 *
 * An unsolicited SMS demanding payment, twice, is the thing the module is most
 * careful about elsewhere: it refuses to chase an ended record, and refuses to
 * chase anything under objection, on the grounds that automated demands are
 * "the most direct form" of enforcement there is.
 *
 * COUNTED BY CHANNEL, BECAUSE ONE SEND IS TWO ROWS
 *
 * `TAX_REMINDER_2W` has an active template per channel, so a single reminder
 * queues one SMS and one WhatsApp message. My first version of this test
 * asserted one row and read the two channels as a double send — the number was
 * right by accident and the reason was wrong. Measured properly: one sweep
 * leaves SMS and WHATSAPP; two sweeps without the claim below leave SMS, SMS,
 * WHATSAPP, WHATSAPP, and both report `sent: 1`.
 */

import '../env';
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
} from '../helpers';
import { LOCK_NAMESPACE, query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { sendDueReminders } from '../../services/reminders';

const OFFICER = '+2348089500001';
const SUBJECT = '+2348089500055';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: OFFICER, fullName: 'Reminder Officer' });

  const lgaId = await firstLgaId();
  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            status, source)
     VALUES ('INDIVIDUAL','Reminder','Subject',$1,'7 Zaria Road',$2,'ACTIVE','AGENT')
     RETURNING id`,
    [SUBJECT, lgaId],
  );
  const item = await revenueItemByCode('SHOPS-KIOSKS');
  const rate = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM revenue_item_rates WHERE revenue_item_id = $1 LIMIT 1',
    [item],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments (assessment_number, taxpayer_id, revenue_item_id, rate_version_id,
                              computation_inputs, computation_trace, base_amount_kobo,
                              amount_kobo, lga_id, status, created_by)
     SELECT 'ASM-RM-1', $1, $2, $3, '{}'::jsonb, '[]'::jsonb, 300000, 300000, $4, 'INVOICED', u.id
       FROM users u WHERE u.phone = $5 LIMIT 1
     RETURNING id`,
    [taxpayer!.id, item, rate!.id, lgaId, OFFICER],
  );

  /*
   * Fourteen days out, which every invoice passes through, and the window flag
   * cleared. Thirty days is what the platform issues, so the two-week window
   * is the one a real invoice actually reaches.
   */
  const invoice = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
                           total_amount_kobo, verification_code, created_by, status, expires_at,
                           reminder_sent_2w)
     SELECT 'INV-RM-1', $1, $2, 300000, 300000, 'RMCODE1', u.id, 'UNPAID',
            now() + interval '14 days', false
       FROM users u WHERE u.phone = $3 LIMIT 1
     RETURNING id`,
    [assessment!.id, taxpayer!.id, OFFICER],
  );

  /*
   * And the charge that goes with it.
   *
   * `raiseInvoiceIn` is the only thing that writes an invoice, and it writes
   * the transaction in the same breath. The sweep reminds only a bill that can
   * be paid as it stands, which it reads from that transaction, so an invoice
   * on its own is a state the platform cannot produce and the sweep rightly
   * passes it by.
   */
  await query(
    pool,
    `INSERT INTO transactions (transaction_reference, taxpayer_id, invoice_id, assessment_id,
                               revenue_item_id, lga_id, amount_kobo, total_amount_kobo,
                               status, created_by)
     SELECT 'TXN-RM-1', $1, $2, $3, $4, $5, 300000, 300000, 'INVOICE_GENERATED', u.id
       FROM users u WHERE u.phone = $6 LIMIT 1`,
    [taxpayer!.id, invoice!.id, assessment!.id, item, lgaId, OFFICER],
  );

  // The wording switched on for this event only: the sweep's own cases take
  // templates out of service, and a file that inherited that state would pass
  // or fail on shard ordering.
  await query(
    pool,
    `UPDATE notification_templates SET status = 'ACTIVE' WHERE event = 'TAX_REMINDER_2W'`,
  );
});

/**
 * Every reminder row for this taxpayer, by channel.
 *
 * One send is one row per active channel, so the channels are the thing to
 * assert: a duplicate shows up as the same channel twice rather than as a
 * count nobody can read.
 */
async function channelsSent(): Promise<string[]> {
  const rows = await query<{ channel: string }>(
    pool,
    `SELECT channel FROM notifications
      WHERE event = 'TAX_REMINDER_2W' AND recipient = $1
      ORDER BY channel`,
    [SUBJECT],
  );
  return rows.map((row) => row.channel);
}

describe('two reminder sweeps for one invoice', () => {
  it('texts the taxpayer once, on each channel and no more', async () => {
    const [first, second] = await Promise.all([sendDueReminders(), sendDueReminders()]);

    assert.deepEqual(
      await channelsSent(),
      ['SMS', 'WHATSAPP'],
      'the taxpayer was sent the same unsolicited demand for payment twice on every ' +
        'channel, by two sweeps that both read the window flag before either set it',
    );

    // Exactly one sweep did the work. Which one depends on who got the row
    // lock, so this is asserted as a pair.
    assert.deepEqual(
      [first.sent, second.sent].sort(),
      [0, 1],
      `both sweeps reported sending: ${JSON.stringify([first, second])}`,
    );

    /*
     * TWO CORRECT INTERLEAVINGS, AND THIS ONCE ASSERTED ONLY ONE OF THEM.
     *
     * It read `[first.skipped, second.skipped].sort()` must be `[0, 1]`, which
     * holds when both sweeps SELECT the invoice before either writes: the
     * loser blocks on the row lock, finds the flag already true, and counts a
     * skip. That is the interleaving this file was written to produce, and it
     * is the usual one.
     *
     * It is not the only one. If the winner finishes its whole transaction
     * before the loser's SELECT runs, the loser's query returns no unflagged
     * invoice and `processWindow` returns `{ sent: 0, skipped: 0 }` from its
     * empty-result branch. Nothing was skipped because nothing was seen, and
     * that is the honest number.
     *
     * So the assertion failed once in a full concurrency run and passed six
     * times out of six on its own — load decides which interleaving happens.
     * The flake was in the test, not in the sweep: the taxpayer is texted
     * exactly once either way, which is what the assertion above this one
     * measures and what this file is for.
     *
     * What is still worth pinning is that the loser does not *invent* work: it
     * reports at most the one invoice, and never reports having sent it.
     */
    const loser = first.sent === 0 ? first : second;
    assert.equal(loser.sent, 0, 'the sweep that lost the race must not report a send');
    assert.ok(
      loser.skipped === 0 || loser.skipped === 1,
      `the loser accounted for ${loser.skipped} invoices, and there is one: ` +
        `${JSON.stringify([first, second])}`,
    );
  });

  it('leaves the flag set either way, so a later sweep does not try again', async () => {
    await Promise.all([sendDueReminders(), sendDueReminders()]);
    const again = await sendDueReminders();

    assert.equal(again.sent, 0, 'a third sweep sent the reminder a second time');
    assert.deepEqual(await channelsSent(), ['SMS', 'WHATSAPP']);
  });
});

describe('the button beside the schedule', () => {
  /**
   * Hold the sweep's lock the way the scheduled run would.
   *
   * The same helper shape as `reconciliation-statement.test.ts`, which tests
   * the other on-demand button in that file for the same reason.
   */
  async function holdTheLock(): Promise<() => Promise<void>> {
    const client = await pool.connect();
    const held = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked',
      [LOCK_NAMESPACE.WORKER, 'reminder-sweep'],
    );
    assert.ok(held.rows[0]?.locked, 'the test could not take the lock it means to hold');
    return async () => {
      await client
        .query('SELECT pg_advisory_unlock($1, hashtext($2))', [
          LOCK_NAMESPACE.WORKER,
          'reminder-sweep',
        ])
        .catch(() => undefined);
      client.release();
    };
  }

  it('is refused while a sweep is running, and says why', async () => {
    const token = (await loginAs(OFFICER)).accessToken;
    const release = await holdTheLock();
    try {
      const response = await post('/government/reminders/send-due', {}, { token });

      assert.equal(
        response.status,
        409,
        `the button started a second sweep: ${JSON.stringify(response.body)}`,
      );
      /*
       * The shared code. This button had one of its own for a commit, which
       * was five more codes than six identical refusals need — see
       * `runOnDemand`. What stayed particular to the reminder sweep is the
       * advice, which is why the next line is still here.
       */
      assert.equal(response.body.error.code, 'SWEEP_ALREADY_RUNNING');
      assert.match(response.body.error.nextStep, /already been sent/);
      assert.deepEqual(await channelsSent(), [], 'and it sent nothing');
    } finally {
      await release();
    }
  });

  it('runs when nothing holds the lock', async () => {
    // The bound: the lock must not have turned the button off.
    const token = (await loginAs(OFFICER)).accessToken;
    const response = await post('/government/reminders/send-due', {}, { token });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.sent, 1);
    assert.deepEqual(await channelsSent(), ['SMS', 'WHATSAPP']);
  });
});
