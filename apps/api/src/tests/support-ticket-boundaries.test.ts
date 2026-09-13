/**
 * Two edges of the support channel that nothing was watching.
 *
 * 1. A TICKET CAN CITE ANY TRANSACTION IN THE STATE. `raiseTicket` looks a
 *    reference up, refuses one that does not exist — and then attaches it
 *    without asking whether the person raising the ticket has anything to do
 *    with it. Two consequences, and both matter.
 *
 *    `ticketDetail` returns the cited transaction's reference and total amount
 *    to the raiser. Transaction references are sequential (TXN-2026-000123), so
 *    anyone signed in can read the amount of any transaction anyone has ever
 *    made, one ticket at a time.
 *
 *    And the ticket is stamped with that transaction's `agent_id`. A complaint
 *    filed under AGENT_MISCONDUCT lands against an agent who has never met the
 *    complainant, in the record support staff read when deciding whether an
 *    agent has a pattern.
 *
 * 2. CLOSED WALKS PAST THE RESOLUTION REQUIREMENT. `updateTicket` refuses to
 *    mark a ticket RESOLVED without recording how — the control is there and
 *    is tested. CLOSED has no such check, and CLOSED is further along the same
 *    path. So a complaint can be shut with nothing written down; and because
 *    `addMessage` refuses to add to a closed ticket, the person who raised it
 *    cannot ask why. They are told to raise a new one.
 *
 * Neither is reachable by accident. Both are reachable by anyone who reads the
 * API, which for a channel that carries AGENT_MISCONDUCT and
 * UNAUTHORISED_CHARGE is the population that matters.
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
  startTestServer,
  stopTestServer,
  revenueItemByCode,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string; id: string };
let officer = '';
let outsider = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Support Admin', phone: '+2348000000060', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Desk Officer',
    phone: '+2348000000061',
    role: 'revenue_officer',
  });
  officer = (await loginAs('+2348000000061')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const row = await queryOne<{ id: string }>(
    pool,
    'SELECT a.id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  );
  agent = { token: session.accessToken, device: demo!.deviceIdentifier, id: row!.id };

  // Somebody signed in with no connection to the collection below. A finance
  // officer holds no support permission beyond raising their own ticket.
  await createGovernmentUser({
    fullName: 'Finance Outsider',
    phone: '+2348000000063',
    role: 'finance_officer',
  });
  outsider = (await loginAs('+2348000000063')).accessToken;
});

/** A real collection by the demo agent, for somebody the outsider never met. */
async function collection(): Promise<{ reference: string; amountKobo: string }> {
  const auth = { token: agent.token, deviceId: agent.device };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Private',
      lastName: 'Trader',
      phone: '+2348055500001',
      address: '4 Market Road, Bokkos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: 'tp-sup' },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
      inputs: {},
    },
    { ...auth, idempotencyKey: 'as-sup' },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const row = await queryOne<{ transaction_reference: string; total_amount_kobo: string }>(
    pool,
    'SELECT transaction_reference, total_amount_kobo::text FROM transactions WHERE id = $1',
    [assessment.body.transactionId],
  );
  return { reference: row!.transaction_reference, amountKobo: row!.total_amount_kobo };
}

const raise = (token: string, overrides: Record<string, unknown> = {}) =>
  post(
    '/support/tickets',
    {
      category: 'PAYMENT_ISSUE',
      subject: 'Payment has not confirmed',
      description: 'The taxpayer paid at the POS and nothing has come through after ten minutes.',
      priority: 'HIGH',
      ...overrides,
    },
    { token },
  );

describe('A ticket may only cite a transaction the raiser was part of', () => {
  it('refuses a reference belonging to somebody else', async () => {
    const txn = await collection();

    const ticket = await raise(outsider, {
      category: 'UNAUTHORISED_CHARGE',
      subject: 'I was charged for something I did not ask for',
      transactionReference: txn.reference,
    });

    assert.notEqual(
      ticket.status,
      201,
      `a stranger filed a ticket against ${txn.reference}: ${JSON.stringify(ticket.body)}`,
    );
  });

  it('does not hand a stranger the amount of that transaction', async () => {
    const txn = await collection();

    const ticket = await raise(outsider, {
      transactionReference: txn.reference,
      subject: 'Query about a payment reference',
    });
    if (ticket.status !== 201) return; // refused at the door, which is the fix

    const detail = await get(`/support/tickets/${ticket.body.id}`, { token: outsider });
    assert.notEqual(
      String(detail.body.total_amount_kobo ?? ''),
      txn.amountKobo,
      'the ticket read back the amount of a transaction the raiser had nothing to do with',
    );
  });

  it('does not stamp an unrelated agent with the complaint', async () => {
    const txn = await collection();

    const ticket = await raise(outsider, {
      category: 'AGENT_MISCONDUCT',
      subject: 'The agent demanded more than the assessment',
      transactionReference: txn.reference,
    });
    if (ticket.status !== 201) return;

    const stamped = await queryOne<{ agent_id: string | null }>(
      pool,
      'SELECT agent_id FROM support_tickets WHERE id = $1',
      [ticket.body.id],
    );
    assert.notEqual(
      stamped!.agent_id,
      agent.id,
      'a misconduct ticket was filed against an agent the complainant never met',
    );
  });

  // --- controls ---

  it('still lets the agent who took the payment cite it', async () => {
    const txn = await collection();

    const ticket = await raise(agent.token, { transactionReference: txn.reference });

    assert.equal(ticket.status, 201, JSON.stringify(ticket.body));
    const detail = await get(`/support/tickets/${ticket.body.id}`, { token: agent.token });
    assert.equal(detail.body.transaction_reference, txn.reference);
  });

  it('still rejects a reference that does not exist', async () => {
    const ticket = await raise(agent.token, { transactionReference: 'TXN-2026-999999' });
    assert.equal(ticket.status, 400, JSON.stringify(ticket.body));
  });
});

describe('A ticket cannot be shut without saying what happened', () => {
  it('refuses to close a ticket with no resolution recorded', async () => {
    const ticket = await raise(agent.token, {
      category: 'UNAUTHORISED_CHARGE',
      subject: 'The agent took more than the receipt shows',
    });
    assert.equal(ticket.status, 201, JSON.stringify(ticket.body));

    const closed = await post(
      `/support/tickets/${ticket.body.id}/update`,
      { status: 'CLOSED' },
      { token: officer },
    );

    assert.notEqual(
      closed.status,
      200,
      `the complaint was closed with nothing written down: ${JSON.stringify(closed.body)}`,
    );

    const row = await queryOne<{ status: string; resolution: string | null }>(
      pool,
      'SELECT status, resolution FROM support_tickets WHERE id = $1',
      [ticket.body.id],
    );
    assert.notEqual(row!.status, 'CLOSED', 'and the ticket is still open to be answered');
  });

  it('still closes a ticket that carries a resolution', async () => {
    const ticket = await raise(agent.token);
    await post(
      `/support/tickets/${ticket.body.id}/update`,
      { status: 'RESOLVED', resolution: 'Gateway confirmed the payment; receipt reissued.' },
      { token: officer },
    );

    const closed = await post(
      `/support/tickets/${ticket.body.id}/update`,
      { status: 'CLOSED' },
      { token: officer },
    );

    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    const row = await queryOne<{ status: string; resolution: string | null }>(
      pool,
      'SELECT status, resolution FROM support_tickets WHERE id = $1',
      [ticket.body.id],
    );
    assert.equal(row!.status, 'CLOSED');
    assert.ok(row!.resolution, 'the reason it was closed is on the record');
  });

  it('still refuses RESOLVED without a resolution', async () => {
    const ticket = await raise(agent.token);
    const resolved = await post(
      `/support/tickets/${ticket.body.id}/update`,
      { status: 'RESOLVED' },
      { token: officer },
    );
    assert.equal(resolved.status, 400, JSON.stringify(resolved.body));
  });
});
