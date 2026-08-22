/**
 * Moving the account an agent's commission is paid into.
 *
 * The account was written once, at application time, and never again — only
 * its verification status was ever updated. Agents change banks and accounts
 * get closed, so the only remedy was a manual UPDATE against the database,
 * which is the one thing the append-only audit design exists to prevent.
 *
 * Changing the destination of money is the classic payout-fraud vector:
 * redirect the account, then trigger a payout. So the interesting tests here
 * are not the happy path but the refusals, and each one is checked on its own
 * because each is load-bearing:
 *
 *   without a step-up code nothing is proposed at all;
 *   the bank must confirm the new account before an officer may approve it,
 *     and "the bank was unreachable" is not a soft yes;
 *   the officer who asked for a change may not be the one who approves it;
 *   a payout already in flight blocks the change until it is settled;
 *   the agent is told on the number already on record, so a change somebody
 *     else asked for is noticed while it is still a proposal;
 *   and the old account is superseded rather than overwritten, so the record
 *     of where money went is never lost.
 */

import {
  createGovernmentUser,
  firstLgaId,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne, query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string; agentId: string; phone: string };
let officerA = '';
let officerB = '';

const NEW_ACCOUNT = {
  bankName: 'Guaranty Trust Bank',
  bankCode: '058',
  accountName: 'Demo Field Agent',
  accountNumber: '0987654321',
  reason: 'Old account closed when the branch merged.',
};

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await firstLgaId();

  // Two different offices, deliberately. `agent:manage` — which is what
  // raising a change on an agent's behalf needs — belongs to admin;
  // `approval:authorise` belongs to supervisors and finance officers. No role
  // holds both, so the officer who can propose a change of destination
  // structurally cannot be the one who authorises it.
  await createGovernmentUser({ role: 'admin', phone: '+2348030000180', fullName: 'Agent Administrator' });
  officerA = (await loginAs('+2348030000180')).accessToken;
  await createGovernmentUser({ role: 'supervisor', phone: '+2348030000181', fullName: 'Approving Supervisor' });
  officerB = (await loginAs('+2348030000181')).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = {
    token: session.accessToken,
    device: demo!.deviceIdentifier,
    agentId: demo!.agentId,
    phone: demo!.phone,
  };
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });

/** Propose a change the way the PWA does, step-up and all. */
async function proposeAsAgent(body: Record<string, unknown> = NEW_ACCOUNT) {
  await grantStepUp(agent.token, agent.phone, 'agent.bank_account.change');
  return post('/agents/me/bank/change', body, asAgent());
}

const activeAccount = () =>
  queryOne<{ id: string; account_number: string; bank_name: string; status: string }>(
    pool,
    `SELECT b.id, b.account_number, b.bank_name, b.status
       FROM agents a JOIN bank_accounts b ON b.id = a.bank_account_id WHERE a.id = $1`,
    [agent.agentId],
  );

describe('proposing a change', () => {
  it('is refused outright without a step-up code', async () => {
    const response = await post('/agents/me/bank/change', NEW_ACCOUNT, asAgent());
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'STEP_UP_REQUIRED');

    const proposals = await query(pool, `SELECT id FROM bank_accounts WHERE status = 'PROPOSED'`);
    assert.equal(proposals.length, 0, 'nothing should have been proposed');
  });

  it('creates a proposal that nothing points at yet', async () => {
    const before = await activeAccount();
    const response = await proposeAsAgent();
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const current = await activeAccount();
    assert.notEqual(
      current!.id,
      response.body.proposedAccountId,
      'the proposal must not become the account in use',
    );
    assert.equal(current!.id, before!.id, 'the existing account is untouched');
    assert.equal(current!.status, 'ACTIVE');
  });

  it('never returns the account number in full', async () => {
    const response = await proposeAsAgent();
    const body = JSON.stringify(response.body);
    assert.ok(!body.includes('0987654321'), `account number leaked: ${body}`);
    assert.match(response.body.accountNumberMasked, /^····4321$/);
  });

  it('refuses a second proposal while one is waiting', async () => {
    await proposeAsAgent();
    const second = await proposeAsAgent({ ...NEW_ACCOUNT, accountNumber: '0111222333' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'BANK_CHANGE_ALREADY_PENDING');
  });

  it('refuses details identical to the account already in use', async () => {
    const current = await activeAccount();
    const same = await proposeAsAgent({
      ...NEW_ACCOUNT,
      bankName: current!.bank_name,
      accountNumber: current!.account_number,
    });
    assert.equal(same.status, 400, JSON.stringify(same.body));
    assert.match(JSON.stringify(same.body), /already on record/i);
  });

  it('refuses an account number that is not ten digits', async () => {
    const short = await proposeAsAgent({ ...NEW_ACCOUNT, accountNumber: '12345' });
    assert.equal(short.status, 422);
    assert.match(JSON.stringify(short.body), /10 digits/i);
  });

  it('tells the agent on the number already on record', async () => {
    await proposeAsAgent();
    const notice = await queryOne<{ recipient: string; message: string }>(
      pool,
      `SELECT recipient, message FROM notifications
        WHERE event = 'AGENT_BANK_CHANGE_REQUESTED' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(notice, 'the agent should have been told');
    assert.equal(notice!.recipient, agent.phone, 'told on the number already on record');
    assert.match(notice!.message, /not you/i, 'the message must invite them to raise it');
    assert.ok(!notice!.message.includes('0987654321'), 'the message must not carry the full number');
  });
});

describe('approving a change', () => {
  it('moves the account, and keeps the old one', async () => {
    const proposal = await proposeAsAgent();
    const before = await activeAccount();

    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Confirmed with the agent by telephone.' },
      { token: officerB },
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));

    const after = await activeAccount();
    assert.equal(after!.id, proposal.body.proposedAccountId, 'the new account is now in use');
    assert.equal(after!.bank_name, 'Guaranty Trust Bank');

    const old = await queryOne<{ status: string; superseded_at: Date | null }>(
      pool,
      'SELECT status, superseded_at FROM bank_accounts WHERE id = $1',
      [before!.id],
    );
    assert.equal(old!.status, 'SUPERSEDED', 'the old account is kept, not deleted');
    assert.ok(old!.superseded_at, 'and dated');
  });

  it('cannot be authorised by the officer who raised it', async () => {
    const unchanged = await activeAccount();
    // An administrator raises it on the agent's behalf — the case an agent who
    // cannot reach the app at all depends on — and then tries to approve it.
    await grantStepUp(officerA, '+2348030000180', 'agent.bank_account.change');
    const proposal = await post(
      `/agents/${agent.agentId}/bank/change`,
      NEW_ACCOUNT,
      { token: officerA },
    );
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));

    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Approving my own request, which must fail.' },
      { token: officerA },
    );
    assert.equal(decided.status, 403, JSON.stringify(decided.body));

    const current = await activeAccount();
    assert.equal(current!.id, unchanged!.id, 'the account must not have moved');
  });

  it('keeps the maker and the approver apart in the database too', async () => {
    // The RBAC split above is the control an officer meets. This is the one
    // underneath it: even a future role holding both permissions could not
    // approve its own request, because the row refuses to hold both names.
    const proposal = await proposeAsAgent();
    const approval = await queryOne<{ requested_by: string }>(
      pool,
      'SELECT requested_by FROM approvals WHERE id = $1',
      [proposal.body.approvalId],
    );
    await assert.rejects(
      () =>
        pool.query(
          `UPDATE approvals SET status = 'APPROVED', approved_by = $2, decision_reason = 'x'
            WHERE id = $1`,
          [proposal.body.approvalId, approval!.requested_by],
        ),
      /approvals_maker_not_approver/,
    );
  });

  it('is refused while the bank has not confirmed the account', async () => {
    const unchanged = await activeAccount();
    const proposal = await proposeAsAgent();
    // Put the proposal back into the state a bank outage leaves it in.
    await pool.query(
      `UPDATE bank_accounts SET verification_status = 'PENDING' WHERE id = $1`,
      [proposal.body.proposedAccountId],
    );

    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Trying to wave through an unverified account.' },
      { token: officerB },
    );
    assert.equal(decided.status, 409, JSON.stringify(decided.body));
    assert.equal(decided.body.error.code, 'BANK_ACCOUNT_NOT_VERIFIED');

    const current = await activeAccount();
    assert.equal(current!.id, unchanged!.id, 'the account must not have moved');
  });

  it('records no approval for a change that did not happen', async () => {
    const proposal = await proposeAsAgent();
    await pool.query(
      `UPDATE bank_accounts SET verification_status = 'FAILED', verification_reason = 'Name does not match' WHERE id = $1`,
      [proposal.body.proposedAccountId],
    );

    await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Should be rolled back in full.' },
      { token: officerB },
    );

    const approval = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM approvals WHERE id = $1',
      [proposal.body.approvalId],
    );
    assert.equal(
      approval!.status,
      'REQUESTED',
      'the decision must roll back with the change it could not carry out',
    );
  });
});

describe('refusing a change', () => {
  it('leaves the account in use alone and says so', async () => {
    const unchanged = await activeAccount();
    const proposal = await proposeAsAgent();
    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'REJECT', reason: 'Could not reach the agent to confirm this.' },
      { token: officerB },
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));

    const current = await activeAccount();
    assert.equal(current!.id, unchanged!.id, 'the account in use is untouched');

    const proposed = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM bank_accounts WHERE id = $1',
      [proposal.body.proposedAccountId],
    );
    assert.equal(proposed!.status, 'REJECTED');

    const notice = await queryOne<{ message: string }>(
      pool,
      `SELECT message FROM notifications
        WHERE event = 'AGENT_BANK_CHANGE_REFUSED' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(notice, 'the agent should be told it was refused');
    assert.match(notice!.message, /unchanged/i);
  });

  it('lets another proposal be raised afterwards', async () => {
    const first = await proposeAsAgent();
    await post(
      `/government/approvals/${first.body.approvalId}/decide`,
      { decision: 'REJECT', reason: 'Wrong account number given.' },
      { token: officerB },
    );
    const second = await proposeAsAgent({ ...NEW_ACCOUNT, accountNumber: '0111222333' });
    assert.equal(second.status, 201, JSON.stringify(second.body));
  });
});

describe('what officers can see', () => {
  it('lists the proposals waiting on them, without full account numbers', async () => {
    await proposeAsAgent();
    const response = await get('/agents/bank-changes', { token: officerB });
    assert.equal(response.status, 200);
    assert.equal(response.body.changes.length, 1);
    const change = response.body.changes[0];
    assert.equal(change.agentId, agent.agentId);
    assert.match(change.accountNumberMasked, /^····4321$/);
    assert.ok(change.current, 'the account being replaced is shown alongside');
    assert.ok(!JSON.stringify(response.body).includes('0987654321'));
  });

  it('shows an agent their own outstanding proposal', async () => {
    await proposeAsAgent();
    const response = await get('/agents/me/bank/change', asAgent());
    assert.equal(response.status, 200);
    assert.ok(response.body.change, 'the agent should see what they asked for');
    assert.equal(response.body.change.verificationStatus, 'VERIFIED');
  });
});

describe('a payout already in flight', () => {
  /**
   * `commission_payouts.bank_account_id` is fixed when the payout is
   * requested, so an approved change cannot retarget money already
   * authorised. Refusing the change while one is outstanding removes the
   * ambiguity entirely — settle first, then move the account — and spares an
   * officer having to work out which account a half-finished payout meant.
   */
  async function payoutInFlight(status: 'REQUESTED' | 'APPROVED') {
    const account = await activeAccount();
    await pool.query(
      `INSERT INTO commission_payouts
         (payout_reference, agent_id, bank_account_id, amount_kobo, commission_count, status)
       VALUES ($1, $2, $3, 250000, 3, $4)`,
      [`PO-TEST-${status}`, agent.agentId, account!.id, status],
    );
  }

  it('blocks a change from being proposed', async () => {
    await payoutInFlight('REQUESTED');
    const response = await proposeAsAgent();
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'PAYOUT_IN_FLIGHT');
    assert.match(response.body.error.message, /PO-TEST-REQUESTED/);
  });

  it('blocks a proposal already raised from being carried out', async () => {
    const proposal = await proposeAsAgent();
    // The payout is raised after the proposal, which is the ordering that
    // makes this worth guarding: the request check alone would have passed.
    await payoutInFlight('APPROVED');

    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Should be held until the payout settles.' },
      { token: officerB },
    );
    assert.equal(decided.status, 409, JSON.stringify(decided.body));
    assert.equal(decided.body.error.code, 'PAYOUT_IN_FLIGHT');

    const approval = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM approvals WHERE id = $1',
      [proposal.body.approvalId],
    );
    assert.equal(approval!.status, 'REQUESTED', 'the decision rolls back with it');
  });

  it('lets the change through once the payout is settled', async () => {
    await payoutInFlight('REQUESTED');
    await pool.query(
      `UPDATE commission_payouts SET status = 'PAID', bank_reference = 'BR-1', paid_at = now()
        WHERE payout_reference = 'PO-TEST-REQUESTED'`,
    );
    const response = await proposeAsAgent();
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });
});

describe('asking the bank again', () => {
  /**
   * Without this a proposal raised while the bank service was unreachable
   * would sit unverifiable for good, and the only way out would be refusing a
   * change that may be perfectly sound.
   */
  it('lifts a proposal out of the state a bank outage left it in', async () => {
    const proposal = await proposeAsAgent();
    await pool.query(
      `UPDATE bank_accounts SET verification_status = 'PENDING', verified_at = NULL WHERE id = $1`,
      [proposal.body.proposedAccountId],
    );

    const retried = await post(
      `/agents/bank-changes/${proposal.body.approvalId}/verify`,
      {},
      { token: officerA },
    );
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.verified, true);

    // And the change can now be carried out, which is the point of retrying.
    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Bank confirmed the account on the second attempt.' },
      { token: officerB },
    );
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
  });

  it('will not re-check a change that has already been settled', async () => {
    const proposal = await proposeAsAgent();
    await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'REJECT', reason: 'Refused before any retry was attempted.' },
      { token: officerB },
    );

    const retried = await post(
      `/agents/bank-changes/${proposal.body.approvalId}/verify`,
      {},
      { token: officerA },
    );
    assert.equal(retried.status, 409, JSON.stringify(retried.body));
    assert.equal(retried.body.error.code, 'BANK_CHANGE_ALREADY_SETTLED');
  });
});
