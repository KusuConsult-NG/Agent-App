/**
 * The support channel, end to end (PRD §77, §78).
 *
 * The tables, the categories and three endpoints all existed. Nothing could
 * reach them: no screen in the agent app or the portal mentioned a ticket, so
 * the only way to raise one was to hand-write an HTTP request. And
 * `ticket_messages` — the table that makes a ticket a conversation rather than
 * a status field — had never been read or written by any code, so a ticket
 * could be moved to RESOLVED without anyone ever having answered it.
 *
 * The tests below are mostly about who may see and say what, because that is
 * where this feature can do harm rather than merely fail. §78 lists
 * AGENT_MISCONDUCT and UNAUTHORISED_CHARGE as categories, which means a
 * complaint about an agent travels through here — and an internal note that
 * leaks to the person being complained about is worse than a support desk
 * that was never built.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentToken = '';
let agentDevice = '';
let officer = '';
let auditor = '';
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
  await createGovernmentUser({ fullName: 'Support Admin', phone: '+2348000000040', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Desk Officer',
    phone: '+2348000000041',
    role: 'revenue_officer',
  });
  await createGovernmentUser({ fullName: 'Read Only', phone: '+2348000000042', role: 'auditor' });
  officer = (await loginAs('+2348000000041')).accessToken;
  auditor = (await loginAs('+2348000000042')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  agentDevice = demo!.deviceIdentifier;

  // Somebody signed in who holds no support:read:all — a finance officer holds
  // no support permission at all, which is exactly the case that must not be
  // able to read another person's complaint.
  await createGovernmentUser({
    fullName: 'Finance Outsider',
    phone: '+2348000000043',
    role: 'finance_officer',
  });
  outsider = (await loginAs('+2348000000043')).accessToken;
});

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

describe('An agent can report a problem and read the answer', () => {
  it('raises a ticket, and it comes back with a conversation', async () => {
    const created = await raise(agentToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.match(created.body.ticketNumber, /\w/);

    const detail = await get(`/support/tickets/${created.body.id}`, { token: agentToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.status, 'OPEN');
    assert.deepEqual(detail.body.messages, [], 'a new ticket has no replies yet');
  });

  it('carries a reply back to the agent, and moves the ticket into progress', async () => {
    const created = await raise(agentToken);

    const reply = await post(
      `/support/tickets/${created.body.id}/messages`,
      { body: 'We can see the payment at the gateway. Issuing the receipt now.' },
      { token: officer },
    );
    assert.equal(reply.status, 201, JSON.stringify(reply.body));

    const detail = await get(`/support/tickets/${created.body.id}`, { token: agentToken });
    assert.equal(detail.body.messages.length, 1);
    assert.match(detail.body.messages[0].body, /Issuing the receipt/);
    assert.equal(detail.body.status, 'IN_PROGRESS', 'an answered ticket is no longer just open');
  });

  it('tells the agent there is something to read', async () => {
    const created = await raise(agentToken);
    await post(
      `/support/tickets/${created.body.id}/messages`,
      { body: 'Looking into this now.' },
      { token: officer },
    );

    const notification = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM notifications WHERE entity_id = $1`,
      [created.body.id],
    );
    assert.notEqual(notification?.count, '0', 'a reply nobody hears about is not an answer');
  });

  it('reopens a resolved ticket when the agent says it is not fixed', async () => {
    const created = await raise(agentToken);
    await post(
      `/support/tickets/${created.body.id}/update`,
      { status: 'RESOLVED', resolution: 'Receipt issued manually.' },
      { token: officer },
    );

    const reply = await post(
      `/support/tickets/${created.body.id}/messages`,
      { body: 'The taxpayer still has no receipt.' },
      { token: agentToken },
    );
    assert.equal(reply.status, 201);
    assert.equal(reply.body.reopened, true);

    const detail = await get(`/support/tickets/${created.body.id}`, { token: agentToken });
    assert.equal(detail.body.status, 'OPEN');
  });

  it('records a status change in the thread, so the history reads as one', async () => {
    const created = await raise(agentToken);
    await post(
      `/support/tickets/${created.body.id}/update`,
      { status: 'RESOLVED', resolution: 'Gateway confirmed and receipt issued.' },
      { token: officer },
    );

    const detail = await get(`/support/tickets/${created.body.id}`, { token: agentToken });
    assert.equal(detail.body.messages.length, 1);
    assert.match(detail.body.messages[0].body, /Marked resolved/);
  });
});

describe('A ticket is only visible to the person who raised it, and to support', () => {
  it('hides a complaint from a signed-in user who is not support', async () => {
    const created = await raise(agentToken, {
      category: 'AGENT_MISCONDUCT',
      subject: 'Conduct of a colleague',
      description: 'A colleague collected cash outside an assessment at the Bokkos market.',
    });

    const peek = await get(`/support/tickets/${created.body.id}`, { token: outsider });
    assert.equal(peek.status, 404, 'and 404, not 403 — its existence is not disclosed either');

    const theirList = await get('/support/tickets', { token: outsider });
    assert.equal(theirList.body.length, 0, 'their own list shows only their own');
  });

  it('shows it to support staff', async () => {
    const created = await raise(agentToken);
    const seen = await get(`/support/tickets/${created.body.id}`, { token: officer });
    assert.equal(seen.status, 200);
    assert.equal(seen.body.id, created.body.id);
  });
});

describe('An internal note never reaches the person complained about', () => {
  it('is invisible to the raiser and visible to staff', async () => {
    const created = await raise(agentToken, {
      category: 'UNAUTHORISED_CHARGE',
      subject: 'Taxpayer says they were charged twice',
      description: 'The taxpayer at stall 14 says they paid the levy twice in one week.',
    });

    const note = await post(
      `/support/tickets/${created.body.id}/messages`,
      { body: 'This is the third report against this agent. Escalating to oversight.', internal: true },
      { token: officer },
    );
    assert.equal(note.status, 201, JSON.stringify(note.body));

    const asAgent = await get(`/support/tickets/${created.body.id}`, { token: agentToken });
    assert.equal(
      asAgent.body.messages.length,
      0,
      'the agent must not see a note written about them',
    );

    const asOfficer = await get(`/support/tickets/${created.body.id}`, { token: officer });
    assert.equal(asOfficer.body.messages.length, 1);
    assert.equal(asOfficer.body.messages[0].internal, true);
  });

  it('refuses an internal note from someone without support:manage', async () => {
    const created = await raise(agentToken);
    const attempt = await post(
      `/support/tickets/${created.body.id}/messages`,
      { body: 'Marking my own ticket as internal', internal: true },
      { token: agentToken },
    );
    assert.equal(attempt.status, 403);
  });
});

describe('The auditor reads and does not speak', () => {
  it('can open any ticket', async () => {
    const created = await raise(agentToken);
    const seen = await get(`/support/tickets/${created.body.id}`, { token: auditor });
    assert.equal(seen.status, 200);
  });

  it('cannot reply to one', async () => {
    // The auditor is read-only everywhere else in the platform. The support
    // desk is not the one place they get to speak to an agent under review.
    const created = await raise(agentToken);
    const attempt = await post(
      `/support/tickets/${created.body.id}/messages`,
      { body: 'Please explain yourself.' },
      { token: auditor },
    );
    assert.equal(attempt.status, 403);
  });

  it('cannot move one', async () => {
    const created = await raise(agentToken);
    const attempt = await post(
      `/support/tickets/${created.body.id}/update`,
      { status: 'CLOSED' },
      { token: auditor },
    );
    assert.equal(attempt.status, 403);
  });
});

describe('Closing a ticket is final', () => {
  it('refuses a reply to a closed ticket, and says what to do instead', async () => {
    const created = await raise(agentToken);
    await post(`/support/tickets/${created.body.id}/update`, { status: 'CLOSED' }, { token: officer });

    const attempt = await post(
      `/support/tickets/${created.body.id}/messages`,
      { body: 'It happened again.' },
      { token: agentToken },
    );
    assert.equal(attempt.status, 400);
    assert.match(attempt.body.error.message, /raise a new one/i);
  });

  it('will not mark a ticket resolved without saying how', async () => {
    const created = await raise(agentToken);
    const attempt = await post(
      `/support/tickets/${created.body.id}/update`,
      { status: 'RESOLVED' },
      { token: officer },
    );
    assert.equal(attempt.status, 400);
  });
});

describe('A ticket about a transaction finds it', () => {
  it('rejects a reference that does not exist rather than filing it blind', async () => {
    const attempt = await raise(agentToken, { transactionReference: 'PSIRS-NOT-A-REAL-REF' });
    assert.equal(attempt.status, 400);
    assert.match(attempt.body.error.message, /No transaction found/);
  });
});
