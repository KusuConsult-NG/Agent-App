/**
 * A confirmed fraud flag is the strongest signal this platform has, and
 * nothing tested for it.
 *
 * `'CONFIRMED'` appears in exactly two places outside the tests: the list of
 * decisions a reviewing officer may record, and the branch that places a
 * commission hold when they record it. Every guard that consults a flag —
 * `requestPayout`, `promoteEligibleCommissions`, the dashboards — reads
 * `status IN ('OPEN', 'UNDER_REVIEW')`. So the whole protection against paying
 * an agent whose fraud was investigated and *upheld* rests on the hold placed
 * at the moment of confirmation, and that hold has two holes in it.
 *
 * It only catches what exists. `holdCommissionsForAgent` moves the PENDING and
 * ELIGIBLE rows the agent has at that instant. Commission earned afterwards is
 * new PENDING, and `promoteEligibleCommissions` — which only excludes OPEN and
 * UNDER_REVIEW — makes it payable. The agent goes on collecting and goes on
 * being paid for it.
 *
 * It can be lifted by an unrelated flag. Holds are scoped by `hold_reason`,
 * deliberately, "because an agent can be held under more than one
 * investigation at once and clearing a minor flag must not pay out money
 * frozen by a serious one". That works when the serious flag froze something.
 * A second confirmation finds nothing PENDING or ELIGIBLE left to freeze, so
 * it holds nothing under its own reason — and dismissing the first flag then
 * releases everything, with the second still standing.
 *
 * There is also no resolution state between CONFIRMED and DISMISSED, so
 * treating CONFIRMED as blocking is what the design already means: held until
 * somebody clears it.
 *
 * Separately, the guards match `entity_type = 'AGENT' AND entity_id = agent`,
 * while `fraud_flags` carries an `agent_id` column that every rule populates.
 * DEVICE_VELOCITY — one handset past forty transactions in an hour, the
 * signal most likely to mean a phone is being run by somebody it was not
 * issued to — is raised HIGH against the DEVICE, so it never reached either
 * guard.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  settleTransaction,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { promoteEligibleCommissions } from '../services/commission';
import {
  commissionByPlaceAndPeriod,
  executiveDashboard,
  financeOfficerHome,
} from '../services/reports';

let officerToken = '';
let secondOfficerToken = '';
let agentId = '';
let agent: { token: string; device: string };
let agentPhone = '';
let collected = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ role: 'admin', phone: '+2348030000160', fullName: 'Fraud Admin' });
  officerToken = (await loginAs('+2348030000160')).accessToken;
  await createGovernmentUser({ role: 'admin', phone: '+2348030000161', fullName: 'Second Fraud Admin' });
  secondOfficerToken = (await loginAs('+2348030000161')).accessToken;

  const demo = await seedDemoAgent();
  agentId = demo!.agentId;
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  agentPhone = demo!.phone;
  collected = 0;

  await pool.query(
    `UPDATE bank_accounts SET verification_status = 'VERIFIED'
      WHERE id = (SELECT bank_account_id FROM agents WHERE id = $1)`,
    [agentId],
  );
});

/** One collection, accruing a commission the ordinary way. */
async function collect(): Promise<string> {
  const suffix = String(++collected);
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Fraud',
      lastName: `Subject${suffix}`,
      phone: `+23480555${suffix.padStart(5, '0')}`,
      address: '5 Market Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `fr-tp-${suffix}` },
  );
  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: `fr-as-${suffix}` },
  );
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `fr-pay-${suffix}` },
  );
  await post(
    '/payments/simulate',
    { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    auth,
  );
  const commission = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM commissions WHERE transaction_id = $1',
    [assessment.body.transactionId],
  );
  assert.ok(commission);
  // Settled, with the hold period behind it: what promoteEligibleCommissions
  // is meant to find. Setup, not the behaviour under test — but reached through
  // the settlement route rather than by writing the status, because migration
  // 053 refuses a transaction that becomes SETTLED with nothing having settled
  // it. Only the clock is moved by hand afterwards.
  await settleTransaction(assessment.body.transactionId);
  await pool.query(
    `UPDATE transactions SET settled_at = now() - interval '30 days' WHERE id = $1`,
    [assessment.body.transactionId],
  );
  return commission!.id;
}

async function flag(severity: string, entityType: string, entityId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, agent_id, status)
     VALUES ('velocity', $1, $2, $3, $4, 'OPEN') RETURNING id`,
    [severity, entityType, entityId, agentId],
  );
  return row!.id;
}

/**
 * Dismissing a confirmation takes a second officer, because releasing the
 * money a confirmation froze is not a decision one person makes alone. That
 * rule is exercised where it lives; here the second officer is fixture, so
 * these tests stay about the money and not about who signed for it.
 */
const review = (flagId: string, decision: string) =>
  post(
    `/government/fraud/flags/${flagId}/review`,
    { decision, note: 'Investigated the flagged pattern and reached a decision.' },
    { token: decision === 'DISMISSED' ? secondOfficerToken : officerToken },
  );

const statusOf = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM commissions WHERE id = $1', [id]))!
    .status;

async function attemptPayout() {
  await grantStepUp(agent.token, agentPhone, 'commission.payout.request');
  return post(
    '/agents/me/commission/payout',
    {},
    { token: agent.token, deviceId: agent.device, idempotencyKey: `fr-po-${Date.now()}` },
  );
}

/**
 * What the State owes, while it decides whether to pay it.
 *
 * `commission_liability_kobo` is a tile on two screens, labelled "Commission
 * liability" over the hint "Accrued and not yet paid". It counted
 * PENDING, ELIGIBLE and APPROVED.
 *
 * ON_HOLD is none of those and is every bit as accrued. A hold moves PENDING
 * and ELIGIBLE rows to ON_HOLD and a release moves them back to PENDING, so
 * the only thing that changes when an investigation opens is whether the money
 * may be paid yet — not whether it is owed. Confirming a fraud flag therefore
 * reduced the State's stated commission liability by exactly the amount under
 * investigation, and dismissing the flag put it back. A commission that turns
 * out to be fraudulent is REVERSED, and leaves the figure then, for a reason.
 *
 * Understating a liability is the direction that matters in public finance,
 * and the amount understated is the amount an officer would most want to see.
 */
describe('the commission liability, while a hold is on it', () => {
  const liabilities = async () => ({
    executive: (await executiveDashboard(pool)).counts!.commission_liability_kobo as string,
    finance: (await financeOfficerHome(pool))!.commission_liability_kobo as string,
  });

  it('does not fall because an investigation opened', async () => {
    const commissionId = await collect();
    const before = await liabilities();
    assert.ok(
      Number(before.executive) > 0 && Number(before.finance) > 0,
      `a commission accrued and both tiles show it: ${JSON.stringify(before)}`,
    );

    const flagId = await flag('HIGH', 'AGENT', agentId);
    await review(flagId, 'CONFIRMED');
    assert.equal(await statusOf(commissionId), 'ON_HOLD', 'the hold went on');

    const after = await liabilities();
    assert.deepEqual(
      after,
      before,
      'opening an investigation moved what the State says it owes in commission. ' +
        'The money is still accrued and still unpaid, which is what the tile says ' +
        'it counts',
    );
  });

  it('leaves no commission out of the report a Council reads', async () => {
    /*
     * `commissionByPlaceAndPeriod` answers "what did Jos North cost us in
     * commission last quarter" with four columns: accrued, paid, outstanding
     * and reversed. Those have to add up, and with ON_HOLD in none of them
     * they did not: the remainder had no column and was exactly the amount an
     * open investigation had frozen.
     *
     * Asserted as the sum rather than as a figure, because the sum is the
     * property that matters and it cannot be satisfied by a number that
     * happens to be right once.
     *
     * The by-period grouping carries no reversed column, so the identity only
     * holds there while nothing is reversed. That is a limit of that report
     * rather than of this test, so the precondition is asserted below instead
     * of being leaned on quietly.
     */
    const commissionId = await collect();
    const flagId = await flag('HIGH', 'AGENT', agentId);
    await review(flagId, 'CONFIRMED');
    assert.equal(await statusOf(commissionId), 'ON_HOLD', 'there is held money to account for');

    const reversed = await queryOne<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM commissions WHERE status = 'REVERSED'",
    );
    assert.equal(reversed!.n, '0', 'nothing is reversed here, which is what makes the sum below well posed');

    const report = await commissionByPlaceAndPeriod(pool);
    const rows = [...report.byLga, ...report.byPeriod] as {
      accrued_kobo: string;
      paid_kobo: string;
      outstanding_kobo: string;
      reversed_kobo?: string;
    }[];
    assert.ok(rows.length >= 2, `both groupings returned a row: ${JSON.stringify(report)}`);

    for (const row of rows) {
      const accounted =
        BigInt(row.paid_kobo) + BigInt(row.outstanding_kobo) + BigInt(row.reversed_kobo ?? '0');
      assert.equal(
        accounted,
        BigInt(row.accrued_kobo),
        'the columns do not account for everything accrued, and the remainder ' +
          `is commission nobody can see: ${JSON.stringify(row)}`,
      );
    }
  });

  it('still leaves the figure when the commission is reversed', async () => {
    /*
     * The other half, and the reason this is not simply "count everything
     * unpaid": a commission on a reversed transaction is not owed, and has to
     * leave. Without this, including ON_HOLD could have been written as
     * `status <> 'PAID'` and nothing here would have noticed.
     */
    const commissionId = await collect();
    const before = await liabilities();
    assert.ok(Number(before.finance) > 0);

    await pool.query(
      `UPDATE commissions SET status = 'REVERSED', reversal_reason = 'Transaction reversed'
        WHERE id = $1`,
      [commissionId],
    );

    const after = await liabilities();
    assert.equal(Number(after.finance), 0, 'a reversed commission is still counted as owed');
    assert.equal(Number(after.executive), 0, 'and on the executive tile too');
  });
});

describe('an agent whose fraud was upheld is not paid', () => {
  it('does not make commission earned after the confirmation payable', async () => {
    const first = await collect();
    const flagId = await flag('HIGH', 'AGENT', agentId);
    await review(flagId, 'CONFIRMED');
    assert.equal(await statusOf(first), 'ON_HOLD', 'what existed at the time was held');

    // The agent keeps collecting. This commission never met the hold.
    const later = await collect();
    assert.equal(await statusOf(later), 'PENDING');

    await promoteEligibleCommissions({ now: new Date() });

    assert.equal(
      await statusOf(later),
      'PENDING',
      'commission earned after a confirmed fraud flag became payable',
    );
  });

  it('does not release everything when one of two confirmations is dismissed', async () => {
    const commissionId = await collect();

    const minor = await flag('HIGH', 'AGENT', agentId);
    await review(minor, 'CONFIRMED');
    assert.equal(await statusOf(commissionId), 'ON_HOLD');

    // A second investigation, confirmed. There is nothing left PENDING or
    // ELIGIBLE for it to freeze, so it holds nothing under its own reason.
    const serious = await flag('CRITICAL', 'AGENT', agentId);
    await review(serious, 'CONFIRMED');

    // The first is cleared. The second still stands.
    await review(minor, 'DISMISSED');
    await promoteEligibleCommissions({ now: new Date() });

    const payout = await attemptPayout();
    assert.notEqual(
      payout.status,
      201,
      'an agent with a standing confirmed fraud flag was paid because a different flag was dismissed',
    );
  });

  it('holds commission for a high-severity flag raised against the handset', async () => {
    // DEVICE_VELOCITY is raised HIGH against the DEVICE, with the agent named
    // in agent_id. Both guards matched entity_type = 'AGENT', so it reached
    // neither.
    const commissionId = await collect();
    await pool.query(`UPDATE commissions SET status = 'ELIGIBLE', eligible_at = now() WHERE id = $1`, [
      commissionId,
    ]);

    const deviceId = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM agent_devices WHERE agent_id = $1 LIMIT 1',
      [agentId],
    );
    assert.ok(deviceId, 'the agent has a registered handset');
    await flag('HIGH', 'DEVICE', deviceId!.id);

    const payout = await attemptPayout();
    assert.notEqual(
      payout.status,
      201,
      'a high-severity flag against the agent’s own handset did not hold their commission',
    );
  });

  it('still pays an agent whose flag was dismissed', async () => {
    // The control. Blocking on CONFIRMED must not block on cleared.
    const commissionId = await collect();
    const flagId = await flag('HIGH', 'AGENT', agentId);
    await review(flagId, 'CONFIRMED');
    await review(flagId, 'DISMISSED');

    await promoteEligibleCommissions({ now: new Date() });
    assert.equal(await statusOf(commissionId), 'ELIGIBLE', 'a cleared agent is payable again');

    const payout = await attemptPayout();
    assert.equal(payout.status, 201, JSON.stringify(payout.body));
  });
});
