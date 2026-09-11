/**
 * An employer who paid last week, on a list of people who have not paid.
 *
 * Three worklists carry a money column headed with what the subject "has paid
 * the State in the last year": the PAYE non-filers, the consumption-tax
 * non-payers, and the intelligence leads. All three computed it the same way:
 *
 *     SELECT SUM(tr.amount_kobo) FROM transactions tr
 *      WHERE tr.taxpayer_id = t.id
 *        AND tr.status IN ('PAYMENT_CONFIRMED', 'RECEIPTED', 'SETTLED')
 *
 * `transactions` has no PAYMENT_CONFIRMED and no RECEIPTED. Its CHECK
 * constraint allows sixteen values and neither of those is among them, so two
 * of the three named matched nothing and the set meant `SETTLED` alone.
 *
 * WHAT THAT COSTS
 *
 * Settlement is not instant — `SETTLEMENT_DUE_HOURS` is 72, and a collection
 * sits in PAYMENT_VERIFIED, RECEIPT_GENERATED or RECONCILIATION_PENDING until
 * the bank statement catches up with it. Every one of those is money the
 * platform recognises as collected; `REVENUE_STATES` says so, and the citizen
 * is holding a receipt for it.
 *
 * So an employer who paid on Monday appeared on Tuesday's enforcement list
 * with a money column reading zero. The worklist did not merely omit a figure,
 * it asserted a wrong one, next to a name and a phone number, on the screen an
 * officer uses to decide who to ring.
 *
 * WHY THE GUARD DID NOT CATCH IT
 *
 * Because I exempted these files when I wrote it, on the stated grounds that
 * they "name a different table's statuses". All three read `FROM transactions
 * tr`. The exemption was wrong and the reason for it was never checked against
 * the schema. `the-money-an-audit-report-could-not-see.test.ts` now asks the
 * CHECK constraint instead of taking anybody's word for it.
 *
 * These tests are the behavioural half: they put money in each state the
 * platform recognises and require the worklist to see it.
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
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const OFFICER = '+2348077300001';
let token = '';
let lgaId = '';
let seq = 1;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Worklist Officer', phone: OFFICER, role: 'admin' });
  token = (await loginAs(OFFICER)).accessToken;
  lgaId = await firstLgaId();
});

const auth = () => ({ token });

/**
 * An employer in an employing sector who has never filed a PAYE return, which
 * is what puts them on this list, holding one collection in `status`.
 *
 * Built through the real collection path rather than by inserting a row:
 * `transactions.invoice_id` is NOT NULL, so a bare insert would be testing a
 * shape the platform never produces. The status is moved afterwards, which is
 * the one thing the path will not do on demand.
 */
async function employerWhoPaid(status: string): Promise<{ taxpayerId: string; kobo: string }> {
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent cleared the pipeline');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const agentAuth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  const key = status.toLowerCase().replace(/_/g, '-');

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'BUSINESS',
      businessName: `Academy ${status}`,
      phone: `+2348150${String(seq++).padStart(6, '0')}`,
      address: '3 Ledger Road, Jos',
      lgaId,
      economicSector: 'EDUCATION',
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `wl-tp-${key}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...agentAuth, idempotencyKey: `wl-as-${key}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...agentAuth, idempotencyKey: `wl-pay-${key}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );

  /*
   * Straight to the state under test. Issued as SQL deliberately: the point is
   * what the worklist says about a transaction sitting in that status, however
   * it got there.
   *
   * Only the status moves. `amount_kobo` and `created_at` are both immutable
   * once written, and those are controls worth leaving alone rather than
   * fixture inconveniences to route around -- the collection is minutes old,
   * which is inside the year this column totals anyway.
   */
  if (status === 'SETTLED') {
    /*
     * SETTLED is not a status you may simply write. A trigger refuses it
     * unless a reconciled settlement covers the transaction -- "no reconciled
     * settlement covers it" -- which is the control that stops the platform
     * calling money settled before the bank says so. So this one goes through
     * the same helper the rest of the suite uses.
     */
    await settleTransaction(assessment.body.transactionId);
  }

  const moved = await query<{ amount_kobo: string }>(
    pool,
    `UPDATE transactions
        SET status = $2
      WHERE id = $1
      RETURNING amount_kobo::text`,
    [assessment.body.transactionId, status],
  );
  assert.equal(moved.length, 1, 'the collection moved into the state under test');

  return { taxpayerId: taxpayer.body.taxpayerId as string, kobo: moved[0]!.amount_kobo };
}

async function leadFor(taxpayerId: string) {
  const answer = await get('/government/paye/not-filing?limit=500', auth());
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  return (answer.body.rows as { taxpayerId: string; paidLastYearKobo: string }[]).find(
    (row) => row.taxpayerId === taxpayerId,
  );
}

// ===========================================================================
describe('what a worklist says an employer has paid', () => {
  /*
   * One test per recognised state rather than one test naming all four,
   * because the defect dropped three of them and a single assertion over a sum
   * would have gone green as soon as any one was restored.
   */
  for (const status of ['PAYMENT_VERIFIED', 'RECEIPT_GENERATED', 'RECONCILIATION_PENDING']) {
    it(`counts money sitting in ${status}`, async () => {
      const { taxpayerId, kobo } = await employerWhoPaid(status);
      const lead = await leadFor(taxpayerId);
      assert.ok(lead, 'the employer is on the non-filing list');
      assert.equal(
        lead!.paidLastYearKobo,
        kobo,
        `${status} is money the platform recognises as collected, and the list read ` +
          `${lead!.paidLastYearKobo} instead of ${kobo}`,
      );
    });
  }

  it('counts money that has settled', async () => {
    const { taxpayerId, kobo } = await employerWhoPaid('SETTLED');
    const lead = await leadFor(taxpayerId);
    assert.ok(lead, 'the employer is on the non-filing list');
    assert.equal(lead!.paidLastYearKobo, kobo);
  });

  /*
   * Controls. Widening the set must not have swept in money the State does not
   * have — a worklist that credited a failed payment would send an officer
   * away from somebody who genuinely owes.
   */
  for (const status of ['FAILED', 'REVERSED', 'PAYMENT_PENDING']) {
    it(`does not count money in ${status}`, async () => {
      const { taxpayerId } = await employerWhoPaid(status);
      const lead = await leadFor(taxpayerId);
      assert.ok(lead, 'the employer is still on the non-filing list');
      assert.equal(
        lead!.paidLastYearKobo,
        '0',
        `${status} is not money the State has, and the list credited it`,
      );
    });
  }
});
