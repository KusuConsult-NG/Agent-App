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

let agent = { token: '', device: '' };
let officerToken = '';
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
