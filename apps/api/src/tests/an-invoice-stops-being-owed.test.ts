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

  it('stops counting against the taxpayer as an outstanding balance', async () => {
    // Compliance decides incentive eligibility, so an invoice the platform
    // refuses payment for must not go on marking the citizen down for it.
    await lapse();
    await expireLapsedInvoices({ actorId: null, actorRole: 'system' });

    const outstanding = await queryOne<{ outstanding_kobo: string }>(
      pool,
      `SELECT COALESCE(SUM(total_amount_kobo - amount_paid_kobo), 0)::text AS outstanding_kobo
         FROM invoices WHERE taxpayer_id = $1 AND status IN ('UNPAID','PARTIALLY_PAID')`,
      [raised.taxpayerId],
    );
    assert.equal(Number(outstanding!.outstanding_kobo), 0);
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
 * One lapsed invoice, and every figure that has an opinion about it.
 *
 * "Outstanding" is two different questions and this platform asks both. What
 * can still be collected is one; what is owed, whether or not this particular
 * bill can still be paid, is the other. A lapsed invoice answers yes to the
 * second and no to the first — the payment path refuses it with
 * INVOICE_EXPIRED — and the liability itself does not lapse with the paper:
 * the bill wants reissuing, not writing off.
 *
 * Both answers are legitimate and the platform needs both. What it cannot
 * afford is a figure that does not say which one it gives, and that is how the
 * officer's home tile came to disagree with itself: the money filtered on the
 * status alone and the count beside it tested the deadline, so between an
 * invoice lapsing and the hourly sweep writing EXPIRED the tile showed a sum
 * over invoices its own hint did not count.
 *
 * So this is the list, written down once. Every figure below is read in the
 * window the sweep has not reached yet, which is the only window in which the
 * two questions give different answers — and therefore the only one in which a
 * figure can be caught not knowing which it was asked.
 */
describe('one lapsed invoice, and every figure with an opinion about it', () => {
  it("is out of the officer's tile, both halves of it", async () => {
    await lapse();
    const home = await get('/government/home', { token: officerToken });
    assert.equal(home.status, 200, JSON.stringify(home.body));
    assert.equal(Number(home.body.revenue.unpaid_kobo), 0, 'the money on the tile');
    assert.equal(Number(home.body.revenue.invoices_unpaid), 0, 'and the count in its hint');
  });

  it('is out of the arrears worklist, and in its lapsed figure beside it', async () => {
    /*
     * The model the rest of this list is measured against. Its collectable CTE
     * says why: "Past its expiry the payment path refuses the money
     * (INVOICE_EXPIRED), so a lapsed invoice on a call list is a call that
     * cannot end in a payment. That money is counted in the summary instead,
     * where it is labelled for what it is."
     */
    await lapse();
    const worklist = await get('/government/arrears', { token: adminToken });
    assert.equal(worklist.status, 200, JSON.stringify(worklist.body).slice(0, 300));
    assert.equal(
      Number(worklist.body.summary.totalKobo),
      0,
      'a call that cannot end in a payment is on the call list',
    );
    assert.equal(
      Number(worklist.body.summary.lapsedKobo),
      Number(raised.totalKobo),
      'and the money is in no figure at all, rather than in the one that names it',
    );
  });

  it('is still owed on the compliance score, because lapsing is not paying', async () => {
    /*
     * Deliberately in, and the one case where excluding it would be the
     * defect: a score that improved when a bill lapsed would make letting the
     * deadline pass the cheapest way to look compliant. The score gates
     * incentive eligibility, so that is not a presentational point.
     *
     * Asserted as equality rather than a direction, because lapse() changes
     * nothing else the score reads — the transaction was never verified, so
     * the late-payment count cannot move either way.
     */
    const read = async () => {
      const client = await pool.connect();
      try {
        return await computeComplianceScore(client, raised.taxpayerId);
      } finally {
        client.release();
      }
    };

    const before = await read();
    await lapse();
    const after = await read();
    assert.equal(
      after.score,
      before.score,
      'the deadline passing moved a compliance score, so a taxpayer who lets a ' +
        'bill lapse scores differently from one who is simply late',
    );
  });

  it('is still listed to the taxpayer, carrying its own deadline', async () => {
    /*
     * In, and it has to be: a citizen asking what they owe is asking the
     * second question. The row carries `status` and `expires_at`, which is
     * what lets the screen say "this one needs reissuing" rather than the
     * platform deciding on the citizen's behalf that the debt is gone.
     */
    await lapse();
    const owed = await get(`/revenue/taxpayers/${raised.taxpayerId}/obligations`, {
      token: officerToken,
    });
    assert.equal(owed.status, 200, JSON.stringify(owed.body).slice(0, 300));
    const row = (owed.body as { invoice_id: string; expires_at: string }[]).find(
      (invoice) => invoice.invoice_id === raised.invoiceId,
    );
    assert.ok(row, `the lapsed invoice vanished from what the taxpayer owes: ${JSON.stringify(owed.body).slice(0, 300)}`);
    assert.ok(row!.expires_at, 'and it is listed without the deadline that makes it unpayable');
  });

  it('still answers the "only unpaid" filter, which asks the second question', async () => {
    // The checkbox says only unpaid, and a bill whose deadline passed is
    // unpaid. An officer filtering for it is looking for people who have not
    // paid, not for people they can take money from this afternoon.
    await lapse();
    const found = await get('/taxpayers/search?outstandingOnly=true', { token: officerToken });
    assert.equal(found.status, 200, JSON.stringify(found.body).slice(0, 300));
    // A bare array: `res.json(found)`.
    const ids = (found.body as { id: string }[]).map((taxpayer) => taxpayer.id);
    assert.ok(
      ids.includes(raised.taxpayerId),
      `a taxpayer with an unpaid bill dropped off the unpaid filter when it lapsed: ${JSON.stringify(found.body).slice(0, 300)}`,
    );
  });
});
