/**
 * The day an invoice stops being payable, and what still says it is.
 *
 * Every invoice is raised with an `expires_at` — thirty days by default — and
 * the payment path honours it: initiating payment against an expired invoice is
 * refused with INVOICE_EXPIRED. So the deadline is real, and the money cannot
 * be taken after it.
 *
 * What never happened is anything acting on it. `invoices.status` allows
 * EXPIRED, `assessments.status` allows EXPIRED, and the transaction state
 * machine lists EXPIRED as a legal destination from INVOICE_GENERATED — three
 * states, all legal, none ever written. An invoice that lapsed stayed UNPAID
 * for the life of the deployment, and everything that reads UNPAID went on
 * believing it:
 *
 *   The State's outstanding revenue figure counted it, so "unpaid" climbed by
 *   every invoice that was never going to be paid and never came down.
 *
 *   The taxpayer's own list of what they owe showed it as payable, and the
 *   payment path then refused it. Being shown a bill you are not allowed to
 *   settle is worse than not being shown it.
 *
 *   Their compliance score counted it as outstanding — and compliance decides
 *   incentive eligibility. A citizen was marked down, indefinitely, for not
 *   paying something the platform would not accept payment for.
 *
 * A deadline that nothing enforces on the record is not a deadline; it is a
 * date on a piece of paper.
 *
 * Since then the third complaint has been answered differently. A citizen was
 * marked down for a bill the platform would not take money for; the platform
 * now issues a lapsed bill again (migration 091), and withdraws one raised in
 * error (migration 092), so a lapsed debt can be cleared, and the readers
 * that judge what somebody owes count it again — the second table below. The
 * readers that send somebody to collect still drop it at the deadline.
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
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { expireLapsedInvoices } from '../services/revenue';
import { computeComplianceScore } from '../services/incentives';
import { setTaxpayerStatus } from '../services/taxpayers';

let agent = { token: '', device: '' };
let officerToken = '';
let adminToken = '';
let raised = { invoiceId: '', assessmentId: '', transactionId: '', taxpayerId: '', totalKobo: '' };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({ role: 'admin', phone: '+2348030000600', fullName: 'Revenue Admin' });
  await createGovernmentUser({
    role: 'revenue_officer',
    phone: '+2348030000601',
    fullName: 'Revenue Officer',
  });
  officerToken = (await loginAs('+2348030000601')).accessToken;
  adminToken = (await loginAs('+2348030000600')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Deborah',
      lastName: 'Chuwang',
      phone: '+2348037000911',
      address: '9 Bauchi Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'expiry-taxpayer' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessed = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 'expiry-assessment' },
  );
  assert.equal(assessed.status, 201, JSON.stringify(assessed.body));

  const invoice = await queryOne<{ total_amount_kobo: string }>(
    pool,
    'SELECT total_amount_kobo FROM invoices WHERE id = $1',
    [assessed.body.invoiceId],
  );
  raised = {
    invoiceId: assessed.body.invoiceId,
    assessmentId: assessed.body.assessmentId,
    transactionId: assessed.body.transactionId,
    taxpayerId: taxpayer.body.taxpayerId,
    totalKobo: invoice!.total_amount_kobo,
  };
});

/** Put the deadline in the past, as thirty quiet days would. */
async function lapse(): Promise<void> {
  await pool.query(`UPDATE invoices SET expires_at = now() - interval '1 day' WHERE id = $1`, [
    raised.invoiceId,
  ]);
}

const statuses = async () => {
  const row = await queryOne<{ invoice: string; assessment: string; transaction: string }>(
    pool,
    `SELECT i.status AS invoice, a.status AS assessment, t.status AS transaction
       FROM invoices i
       JOIN assessments a ON a.id = i.assessment_id
       JOIN transactions t ON t.invoice_id = i.id
      WHERE i.id = $1`,
    [raised.invoiceId],
  );
  return row!;
};

describe('an invoice whose deadline has passed', () => {
  it('is marked expired, along with its assessment and its transaction', async () => {
    await lapse();
    const swept = await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
    assert.equal(swept.expired, 1, JSON.stringify(swept));

    const after = await statuses();
    assert.equal(after.invoice, 'EXPIRED');
    assert.equal(after.assessment, 'EXPIRED', 'the assessment it came from is spent too');
    assert.equal(
      after.transaction,
      'EXPIRED',
      'INVOICE_GENERATED -> EXPIRED is a legal move the platform could never make',
    );
  });

  it('leaves an invoice that is still in date alone', async () => {
    const swept = await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
    assert.equal(swept.expired, 0);
    assert.equal((await statuses()).invoice, 'UNPAID');
  });

  it('stops counting against the State as revenue outstanding', async () => {
    const before = await get('/government/home', { token: officerToken });
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(Number(before.body.revenue.unpaid_kobo), Number(raised.totalKobo));
    assert.equal(Number(before.body.revenue.invoices_expired), 0);

    await lapse();
    await expireLapsedInvoices({ actorId: null, actorRole: 'system' });

    const after = await get('/government/home', { token: officerToken });
    assert.equal(
      Number(after.body.revenue.unpaid_kobo),
      0,
      'an invoice nobody may pay was still counted as money the State is owed',
    );
    assert.equal(
      Number(after.body.revenue.invoices_expired),
      1,
      'and the tile counting expired invoices could only ever have shown zero',
    );
  });

  it('is out of the officer\'s outstanding tile the moment it lapses, not an hour later', async () => {
    /*
     * The sweep runs hourly, and `jobs.ts` says exactly why that window
     * matters: it "is a window in which the platform tells a citizen they owe
     * something it will refuse to take, and tells the State it is owed money
     * nobody can pay it."
     *
     * `revenueOfficerHome` answers both halves of one tile. `invoices_unpaid`
     * — the count in the hint — tests the deadline itself and so is right the
     * moment the invoice lapses. `unpaid_kobo` — the money the tile shows —
     * filtered on the status alone, so it waited for the sweep to write
     * EXPIRED. For up to an hour the tile read "money assessed and unpaid"
     * over a set of invoices its own hint did not count.
     *
     * So this lapses the invoice and deliberately does NOT sweep. Every other
     * test here sweeps first, which is why nothing failed.
     */
    const before = await get('/government/home', { token: officerToken });
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(Number(before.body.revenue.unpaid_kobo), Number(raised.totalKobo));
    assert.equal(Number(before.body.revenue.invoices_unpaid), 1);

    await lapse();

    const after = await get('/government/home', { token: officerToken });
    assert.equal(
      Number(after.body.revenue.invoices_unpaid),
      0,
      'the count stopped counting it, which it always did',
    );
    assert.equal(
      Number(after.body.revenue.unpaid_kobo),
      0,
      'the tile still shows money the payment path will refuse, and its own hint ' +
        'says there are no invoices open behind it',
    );
    assert.equal(
      (await statuses()).invoice,
      'UNPAID',
      'this case is the window before the sweep, so the record must still say UNPAID — ' +
        'if something expired it, the test is no longer about the window',
    );
  });

  it('does not touch one that was already paid', async () => {
    await pool.query(
      `UPDATE invoices SET status = 'PAID', amount_paid_kobo = total_amount_kobo WHERE id = $1`,
      [raised.invoiceId],
    );
    await lapse();

    const swept = await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
    assert.equal(swept.expired, 0, 'a paid invoice is finished, not lapsed');
    assert.equal((await statuses()).invoice, 'PAID');
  });

  it('says so on the record, so a citizen can be told why', async () => {
    await lapse();
    await expireLapsedInvoices({ actorId: null, actorRole: 'system' });

    const entry = await queryOne<{ action: string; reason: string | null }>(
      pool,
      `SELECT action, reason FROM audit_logs
        WHERE entity_type = 'invoice' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [raised.invoiceId],
    );
    assert.ok(entry, 'an invoice ceasing to be owed is a change to what somebody owes');
    assert.match(entry!.action, /expire/i);
  });
});

// ===========================================================================

/**
 * One lapsed invoice, read three times by every figure that has an opinion
 * about it: in date, lapsed, and swept.
 *
 * This table used to read each figure once, in the window before the sweep,
 * on the stated belief that it was "the only window in which the two
 * questions give different answers". It was the only window in which the
 * figures gave the answers their comments claimed. Five of them said they
 * counted a lapsed bill as still owed — the compliance score, the taxpayer's
 * obligations, the only-unpaid filter, expected revenue, the debt reported
 * when a record is closed — and all five filtered on the status. Once the
 * hourly sweep wrote EXPIRED they stopped counting it, so every one of them
 * changed its answer an hour after the deadline, with nothing having happened
 * but a sweep that says of itself that it decides nothing.
 *
 * Measured on this fixture before the change: a compliance score of 20 in
 * date, 20 lapsed, and 45 swept, the last reading "No unpaid invoices on
 * record" beside "0 of 1 assessment period(s) settled".
 *
 * So the invariant asserted here is the one that holds whichever way the
 * policy goes: the deadline changes a figure and the sweep does not. Which
 * way it went — payable, by the deadline — and what that costs is written
 * out in `lib/payable-invoice.ts`. Each figure must also notice the deadline,
 * which is what proves it counted the invoice in the first place; a reader
 * that never saw the invoice would pass "the sweep changed nothing" for free.
 */
describe('one lapsed invoice, before the sweep and after it', () => {
  const score = async () => {
    const client = await pool.connect();
    try {
      return await computeComplianceScore(client, raised.taxpayerId);
    } finally {
      client.release();
    }
  };

  const ok = <T>(response: { status: number; body: T }, what: string): T => {
    assert.equal(response.status, 200, `${what}: ${JSON.stringify(response.body).slice(0, 300)}`);
    return response.body;
  };

  /*
   * Two questions, and every reader answers one of them. `lib/payable-invoice.ts`
   * says which is which and why they came apart.
   *
   * What can be collected today: the deadline takes the bill out, and the
   * sweep, an hour later, changes nothing further.
   */
  const payableReaders: { figure: string; read: () => Promise<unknown> }[] = [
    {
      figure: "the officer's outstanding tile, both halves of it",
      read: async () => {
        const home = ok(await get('/government/home', { token: officerToken }), 'home');
        return [home.revenue.unpaid_kobo, home.revenue.invoices_unpaid];
      },
    },
    {
      // Still on the list once lapsed — but as a bill to issue again, not a
      // payment to take. The flag is the payable half of the list.
      figure: "whether the taxpayer's obligations offer the bill for payment",
      read: async () => {
        const owed = ok(
          await get(`/revenue/taxpayers/${raised.taxpayerId}/obligations`, { token: officerToken }),
          'obligations',
        ) as { invoice_id: string; needs_reissue: boolean }[];
        const row = owed.find((r) => r.invoice_id === raised.invoiceId);
        return row ? !row.needs_reissue : 'absent';
      },
    },
    {
      figure: 'the arrears call list',
      read: async () =>
        ok(await get('/government/arrears', { token: adminToken }), 'arrears').summary.totalKobo,
    },
  ];

  /*
   * What is owed: lapsed or not, the debt is the same debt. These used to drop
   * the bill at the deadline, when nothing could clear a lapsed bill; it is now
   * issued again or withdrawn, and letting it lapse must not improve anything
   * that judges or reports what somebody owes.
   */
  const owedReaders: { figure: string; read: () => Promise<unknown> }[] = [
    {
      // On the list either way, so an agent is never invited to raise a
      // second charge for a debt already on file. Counted as rows rather than
      // by invoice id, because a bill issued again is a new invoice for the
      // same debt — and this taxpayer owes exactly one.
      figure: "the taxpayer's obligations",
      read: async () => {
        const owed = ok(
          await get(`/revenue/taxpayers/${raised.taxpayerId}/obligations`, { token: officerToken }),
          'obligations',
        ) as { invoice_id: string }[];
        return owed.length;
      },
    },
    {
      figure: 'the compliance score',
      read: async () => {
        const breakdown = await score();
        return [breakdown.score, breakdown.components];
      },
    },
    {
      figure: 'the only-unpaid search filter',
      read: async () => {
        // A bare array: `res.json(found)`.
        const found = ok(
          await get('/taxpayers/search?outstandingOnly=true', { token: officerToken }),
          'search',
        ) as { id: string }[];
        return found.some((taxpayer) => taxpayer.id === raised.taxpayerId);
      },
    },
    {
      figure: 'expected revenue on the executive dashboard',
      read: async () =>
        ok(await get('/government/dashboard', { token: adminToken }), 'dashboard').counts
          .expected_revenue_kobo,
    },
    {
      figure: 'defaulters by levy',
      read: async () => {
        const report = ok(
          await get('/government/revenue/defaulters', { token: adminToken }),
          'defaulters',
        ) as { outstandingKobo: string; rows: { taxpayer_id: string }[] };
        return [
          report.outstandingKobo,
          report.rows.some((row) => row.taxpayer_id === raised.taxpayerId),
        ];
      },
    },
  ];

  for (const { figure, read } of payableReaders) {
    it(`${figure}: the deadline changes it, and the sweep does not`, async () => {
      const inDate = await read();
      await lapse();
      const lapsed = await read();
      await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
      assert.equal((await statuses()).invoice, 'EXPIRED', 'the fixture never reached the swept state');
      const swept = await read();

      assert.notDeepEqual(
        lapsed,
        inDate,
        `${figure} gave the same answer either side of the deadline, so it either never ` +
          `counted the invoice or kept counting a bill nobody may pay: ${JSON.stringify(inDate)}`,
      );
      assert.deepEqual(
        swept,
        lapsed,
        `${figure} changed its answer when the sweep wrote EXPIRED, an hour after the ` +
          'deadline and with nothing having happened in between',
      );
    });
  }

  for (const { figure, read } of owedReaders) {
    it(`${figure}: neither the deadline nor the sweep changes it`, async () => {
      const inDate = await read();
      await lapse();
      const lapsed = await read();
      await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
      assert.equal((await statuses()).invoice, 'EXPIRED', 'the fixture never reached the swept state');
      const swept = await read();

      assert.deepEqual(
        lapsed,
        inDate,
        `${figure} changed at the deadline, so letting the bill lapse changed what the ` +
          'taxpayer is judged to owe',
      );
      assert.deepEqual(swept, lapsed, `${figure} changed when the sweep wrote EXPIRED`);

      // And it was counting the bill all along: withdrawn, it stops.
      await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [raised.invoiceId]);
      assert.notDeepEqual(
        await read(),
        swept,
        `${figure} gave the same answer with the bill withdrawn, so it never counted it: ` +
          JSON.stringify(swept),
      );
    });

    it(`${figure}: a bill issued again is counted once, as it was before it lapsed`, async () => {
      const inDate = await read();
      await lapse();
      await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
      const reissued = await post(
        `/revenue/invoices/${raised.invoiceId}/reissue`,
        {},
        { token: agent.token, deviceId: agent.device, idempotencyKey: `reissue-${figure}` },
      );
      assert.equal(reissued.status, 201, JSON.stringify(reissued.body));
      assert.deepEqual(
        await read(),
        inDate,
        `${figure} counted the debt twice, or not at all, once the bill was replaced`,
      );
    });
  }

  it('is still counted where lapsed money is counted on purpose, before the sweep and after', async () => {
    /*
     * The other half of the policy, and the reason it does not lose money: the
     * arrears worklist reports lapsed money on its own line, as money needing a
     * fresh assessment. It must count it at the deadline and go on counting it
     * once the record says EXPIRED.
     */
    const lapsedKobo = async () =>
      ok(await get('/government/arrears', { token: adminToken }), 'arrears').summary.lapsedKobo;

    assert.equal(Number(await lapsedKobo()), 0, 'in date, nothing has lapsed');
    await lapse();
    assert.equal(Number(await lapsedKobo()), Number(raised.totalKobo), 'counted at the deadline');
    await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
    assert.equal(
      Number(await lapsedKobo()),
      Number(raised.totalKobo),
      'and still counted once the sweep wrote EXPIRED',
    );
  });

  it('is still left behind on a closed record after it lapses', async () => {
    /*
     * Two more readers that are not pure reads, so not in the tables above:
     * the debt `setTaxpayerStatus` reports when a record is closed, and the
     * queue of records ended while still owing. Both are what is owed, so a
     * lapsed bill is still the debt an officer leaves behind. The record is
     * closed, reopened and closed again in each state, because the closing
     * debt is only ever computed by closing.
     */
    const admin = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      '+2348030000600',
    ]);
    assert.ok(admin);
    const setStatus = (status: 'ACTIVE' | 'CLOSED') =>
      setTaxpayerStatus({
        taxpayerId: raised.taxpayerId,
        status,
        reason: 'The stall has closed down',
        actorId: admin!.id,
        actorRole: 'admin',
      });
    const onEndedQueue = async () => {
      const ended = ok(
        await get('/taxpayers/ended-with-arrears', { token: adminToken }),
        'ended-with-arrears',
      ) as { taxpayers: { id: string }[] };
      return ended.taxpayers.some((taxpayer) => taxpayer.id === raised.taxpayerId);
    };

    const inDate = await setStatus('CLOSED');
    assert.equal(inDate.outstandingKobo, raised.totalKobo, 'in date, the whole bill is left behind');
    assert.equal(await onEndedQueue(), true, 'and the record is on the queue of ended debts');

    await lapse();
    assert.equal(await onEndedQueue(), true, 'a lapsed bill is still a debt left behind');
    await setStatus('ACTIVE');
    const lapsed = await setStatus('CLOSED');

    await expireLapsedInvoices({ actorId: null, actorRole: 'system' });
    assert.equal((await statuses()).invoice, 'EXPIRED', 'the fixture never reached the swept state');
    assert.equal(await onEndedQueue(), true);
    await setStatus('ACTIVE');
    const swept = await setStatus('CLOSED');

    assert.equal(lapsed.outstandingKobo, raised.totalKobo, 'closing after the deadline left the debt out');
    assert.equal(swept.outstandingKobo, raised.totalKobo, 'closing after the sweep left the debt out');
  });
});
