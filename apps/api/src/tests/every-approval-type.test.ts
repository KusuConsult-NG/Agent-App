/**
 * The approval queue holds every type it says it does.
 *
 * `POST /government/approvals` validates `approvalType` against an enum of
 * eleven, and the schema's CHECK constraint agrees with it. Four of the eleven
 * were ever raised — the ones that move money and had tests written around
 * them — so the other seven were an enum nobody had walked. An accepted value
 * that has never been stored once is a value nobody knows the storing of: the
 * insert could have failed on a constraint, the queue could have hidden it,
 * the type filter could have missed it, and the first officer to find out
 * would have been an officer with a decision to raise.
 *
 * So each of the eleven is raised here, read back off the queue, and filtered
 * for by type. The decision half is walked on a type that has no execution
 * branch of its own, because REVIEWED — the middle state of maker-checker,
 * where one officer has looked and a second has yet to authorise — had never
 * been written either.
 *
 * What this does not do is decide COMMISSION_PAYOUT or BANK_ACCOUNT_CHANGE
 * raised this way. Those two carry out real work when they are decided, and
 * that work is driven from the payout and bank-account tests where the rows it
 * acts on exist. Raising one here with no payout behind it would prove only
 * that the platform refuses it, which is a different test in a different file.
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

let requester = '';
let reviewer = '';
let authoriser = '';
let agentId = '';
let taxpayerId = '';
let transactionId = '';
let revenueItemId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  // seedDemoAgent walks the real clearance pipeline, which needs an approver.
  await createGovernmentUser({ fullName: 'Queue Admin', phone: '+2348030000300', role: 'admin' });
  // Three offices, because maker-checker will not accept fewer: the requester
  // may not review, and the reviewer may not authorise.
  await createGovernmentUser({ fullName: 'Queue Requester', phone: '+2348030000301', role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Queue Reviewer', phone: '+2348030000302', role: 'supervisor' });
  await createGovernmentUser({ fullName: 'Queue Authoriser', phone: '+2348030000303', role: 'finance_officer' });
  requester = (await loginAs('+2348030000301')).accessToken;
  reviewer = (await loginAs('+2348030000302')).accessToken;
  authoriser = (await loginAs('+2348030000303')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  agentId = demo!.agentId;
  revenueItemId = await revenueItemByCode('SHOPS-KIOSKS');

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Approval',
      lastName: 'Subject',
      phone: '+2348101110300',
      address: '9 Ahmadu Bello Way, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'approval-subject' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId;

  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId, revenueItemId, inputs: {} },
    { ...auth, idempotencyKey: 'approval-assessment' },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));
  transactionId = assessment.body.transactionId;
});

/**
 * Every type the endpoint accepts, against the entity it would really name.
 *
 * The entity is real in each case rather than a placeholder string, because
 * an approval whose `entity_id` points at nothing is a request an officer
 * cannot act on, and a test that raised one would be checking the insert
 * rather than the request.
 */
function everyType() {
  return [
    { approvalType: 'AGENT_ACTIVATION', entityType: 'agent', entityId: agentId,
      reason: 'Clearance complete; activating this agent for field collection.' },
    { approvalType: 'AGENT_SUSPENSION', entityType: 'agent', entityId: agentId,
      reason: 'Collections at odds with the ward register; suspend pending review.' },
    { approvalType: 'COMMISSION_ADJUSTMENT', entityType: 'agent', entityId: agentId,
      reason: 'Commission accrued twice on one transaction in the March batch.' },
    { approvalType: 'COMMISSION_PAYOUT', entityType: 'agent', entityId: agentId,
      reason: 'Agent has requested settlement of eligible commission for March.' },
    { approvalType: 'REFUND', entityType: 'transaction', entityId: transactionId,
      reason: 'Taxpayer paid twice for the same kiosk in the same quarter.' },
    { approvalType: 'PAYMENT_REVERSAL', entityType: 'transaction', entityId: transactionId,
      reason: 'Assessment was raised against the wrong premises entirely.' },
    { approvalType: 'REVENUE_RATE_CHANGE', entityType: 'revenue_item', entityId: revenueItemId,
      reason: 'Executive Council approved a revised rate for this item.' },
    { approvalType: 'MANUAL_CORRECTION', entityType: 'transaction', entityId: transactionId,
      reason: 'Ward attribution recorded wrongly at the point of collection.' },
    { approvalType: 'BANK_ACCOUNT_CHANGE', entityType: 'bank_account', entityId: agentId,
      reason: 'Agent bank branch merged and the old account was closed.' },
    { approvalType: 'TAXPAYER_ADJUSTMENT', entityType: 'taxpayer', entityId: taxpayerId,
      reason: 'Business closed mid-year; annual obligation to be prorated.' },
    { approvalType: 'AGENT_OVERRIDE_ACTIVATION', entityType: 'agent', entityId: agentId,
      reason: 'Referee unreachable for six weeks; activating on documentary evidence.' },
  ];
}

const raise = (body: Record<string, unknown>) =>
  post('/government/approvals', { payload: {}, ...body }, { token: requester });

describe('Every approval type the endpoint accepts can actually be raised', () => {
  it('stores each one and shows it back on the queue', async () => {
    for (const request of everyType()) {
      const response = await raise(request);
      assert.equal(
        response.status,
        201,
        `${request.approvalType} was refused: ${JSON.stringify(response.body)}`,
      );
      assert.equal(response.body.status, 'REQUESTED');

      const stored = await queryOne<{ approval_type: string; entity_id: string; status: string }>(
        pool,
        'SELECT approval_type, entity_id, status FROM approvals WHERE id = $1',
        [response.body.approvalId],
      );
      assert.equal(stored?.approval_type, request.approvalType);
      assert.equal(stored?.entity_id, request.entityId);
    }

    const queue = await get('/government/approvals', { token: reviewer });
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    const seen = new Set(queue.body.map((row: { approval_type: string }) => row.approval_type));
    for (const request of everyType()) {
      assert.ok(seen.has(request.approvalType), `${request.approvalType} is missing from the queue`);
    }

    // And the reviewer can narrow to one type, which is how a finance officer
    // finds the reversals among ninety agent activations.
    const filtered = await get('/government/approvals?type=REVENUE_RATE_CHANGE', { token: reviewer });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.length, 1);
    assert.equal(filtered.body[0].approval_type, 'REVENUE_RATE_CHANGE');
    assert.equal(filtered.body[0].requested_by_name, 'Queue Requester');
  });

  it('refuses a type it does not know rather than storing it', async () => {
    const response = await raise({
      approvalType: 'BUDGET_VIREMENT',
      entityType: 'transaction',
      entityId: transactionId,
      reason: 'Moving a line between heads of the estimates.',
    });
    assert.equal(response.status, 422, JSON.stringify(response.body));

    const count = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM approvals');
    assert.equal(count?.n, '0', 'nothing was stored for a type the platform does not have');
  });
});

describe('A request that has been looked at but not yet authorised', () => {
  /**
   * REVIEWED is the state maker-checker exists for: one officer has read the
   * request and a second has still to authorise it. Nothing had ever written
   * it, so the queue could show a request as reviewed by nobody and no test
   * would have noticed.
   */
  async function raiseRateChange() {
    const response = await raise({
      approvalType: 'REVENUE_RATE_CHANGE',
      entityType: 'revenue_item',
      entityId: revenueItemId,
      payload: { proposedAmountKobo: '750000' },
      reason: 'Executive Council approved a revised rate for this item.',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.approvalId as string;
  }

  it('records who reviewed it, and leaves the authorising to somebody else', async () => {
    const approvalId = await raiseRateChange();

    const reviewed = await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'REVIEW', reason: 'Council minute sighted and the item matches.' },
      { token: reviewer },
    );
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.status, 'REVIEWED');

    const row = await queryOne<{
      status: string;
      reviewed_by: string;
      review_note: string;
      approved_by: string | null;
    }>(pool, 'SELECT status, reviewed_by, review_note, approved_by FROM approvals WHERE id = $1', [
      approvalId,
    ]);
    assert.equal(row?.status, 'REVIEWED');
    assert.ok(row!.reviewed_by, 'a reviewed request names its reviewer');
    assert.match(row!.review_note, /Council minute/);
    assert.equal(row!.approved_by, null, 'reviewing is not authorising');

    // The queue shows the reviewer by name, so the second officer knows whose
    // reading they are relying on before they authorise.
    const queue = await get(`/government/approvals?status=REVIEWED`, { token: authoriser });
    assert.equal(queue.body.length, 1);
    assert.equal(queue.body[0].reviewed_by_name, 'Queue Reviewer');

    // Still open, and a different officer can carry it.
    const authorised = await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Authorised against the Council minute of 14 March.' },
      { token: authoriser },
    );
    assert.equal(authorised.status, 200, JSON.stringify(authorised.body));
    assert.equal(authorised.body.status, 'APPROVED');
  });

  it('will not let the officer who reviewed it also authorise it', async () => {
    const approvalId = await raiseRateChange();
    await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'REVIEW', reason: 'Council minute sighted and the item matches.' },
      { token: reviewer },
    );

    const sameHand = await post(
      `/government/approvals/${approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Authorising the request I have just reviewed.' },
      { token: reviewer },
    );
    assert.equal(sameHand.status, 403, JSON.stringify(sameHand.body));

    const row = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM approvals WHERE id = $1',
      [approvalId],
    );
    assert.equal(row?.status, 'REVIEWED', 'it stays where it was');
  });
});
