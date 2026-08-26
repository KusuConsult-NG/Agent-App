/**
 * The clearance journal, saying which thing happened.
 *
 * `agent_clearance_events` is the record an officer reads before deciding
 * whether to trust somebody with a territory and a device that takes public
 * money. It declares twenty-three event types. Three of them named events the
 * platform performs constantly and recorded under another name, so the journal
 * was not wrong about what happened — it was unable to distinguish:
 *
 *   REINSTATED         `activate` both activates a cleared applicant and puts
 *                      a suspended agent back to work; it is the only thing
 *                      that clears `suspended_at`. Both wrote ACTIVATED, so an
 *                      agent suspended for mishandling cash and quietly
 *                      restored a month later showed two identical entries.
 *
 *   REFEREE_REPLACED   §29 keeps a superseded referee rather than overwriting
 *                      them, precisely so a substitution is visible. The
 *                      journal wrote REFEREE_INVITED either way, so an
 *                      applicant cycling through referees until one cleared
 *                      read as an applicant who nominated once.
 *
 *   KYC_INFO_REQUIRED  A provider asking for a clearer document is not a
 *                      failure and is not silence. It fell through to
 *                      KYC_SUBMITTED, so the journal showed an applicant who
 *                      had submitted and gone quiet while the platform was in
 *                      fact waiting on them — and the mock provider could not
 *                      produce the outcome at all, so no local run ever
 *                      reached the branch.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const ADMIN = '+2348030003300';
let adminToken = '';
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();
  await createGovernmentUser({ role: 'admin', phone: ADMIN, fullName: 'Clearance Admin' });
  adminToken = (await loginAs(ADMIN)).accessToken;
});

async function journalFor(agentId: string): Promise<string[]> {
  const rows = await query<{ event_type: string }>(
    pool,
    `SELECT event_type FROM agent_clearance_events WHERE agent_id = $1 ORDER BY created_at, id`,
    [agentId],
  );
  return rows.map((row) => row.event_type);
}

describe('putting a suspended agent back to work', () => {
  it('is journalled as a return, not as a second first day', async () => {
    const demo = await seedDemoAgent();
    assert.ok(demo);

    await grantStepUp(adminToken, ADMIN, 'agent.suspend');
    const suspended = await post(
      `/agents/${demo!.agentId}/suspend`,
      { reason: 'Cash from Tuesday market has not been accounted for.' },
      { token: adminToken },
    );
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));

    /*
     * Suspending an agent suspends their handsets too, so putting them back to
     * work is deliberately two decisions: the officer restores the device they
     * are satisfied is accounted for, and then the agent. A phone that is
     * still missing stays suspended while its owner returns to work on a new
     * one.
     */
    const device = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM agent_devices WHERE agent_id = $1 AND status = 'SUSPENDED' LIMIT 1`,
      [demo!.agentId],
    );
    assert.ok(device, 'suspending the agent should have suspended the handset');
    const handset = await post(
      `/agents/devices/${device!.id}/restore`,
      { reason: 'Handset returned and the day book reconciled.' },
      { token: adminToken },
    );
    assert.equal(handset.status, 200, JSON.stringify(handset.body));

    const restored = await post(`/agents/${demo!.agentId}/activate`, {}, { token: adminToken });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));

    const events = await journalFor(demo!.agentId);
    assert.ok(events.includes('SUSPENDED'), `no suspension in ${events.join(', ')}`);
    assert.ok(events.includes('REINSTATED'), `no reinstatement in ${events.join(', ')}`);

    // And exactly one activation — the original one. A second ACTIVATED here
    // is the defect: it makes the return indistinguishable from the start.
    assert.equal(
      events.filter((event) => event === 'ACTIVATED').length,
      1,
      `expected one ACTIVATED, got ${events.join(', ')}`,
    );

    const agent = await queryOne<{ operational_status: string; suspended_at: Date | null }>(
      pool,
      'SELECT operational_status, suspended_at FROM agents WHERE id = $1',
      [demo!.agentId],
    );
    assert.equal(agent!.operational_status, 'ACTIVE');
    assert.equal(agent!.suspended_at, null);
  });
});

describe('an applicant whose identity check needs more from them', () => {
  it('is journalled as waiting on the applicant, not as a bare submission', async () => {
    const phone = '+2347010009001';
    const application = await post('/agents/apply', {
      fullName: 'Ngo Yakubu',
      phone,
      email: 'ngo.yakubu@example.test',
      password: 'FieldAgent2026',
      dateOfBirth: '1993-02-19',
      gender: 'FEMALE',
      address: '5 Zaria Road, Jos',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Ngo Yakubu',
      accountNumber: '0123456787',
    });
    assert.equal(application.status, 201, JSON.stringify(application.body));
    const agentId = application.body.agentId;
    const token = (await loginAs(phone, 'FieldAgent2026')).accessToken;

    // The mock provider answers by the last digit: 7 is "we need more".
    const submitted = await post(
      '/agents/me/kyc',
      { identityType: 'NIN', identityNumber: '12345678907' },
      { token },
    );
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.status, 'VERIFICATION_REQUIRED');

    const events = await journalFor(agentId);
    assert.ok(events.includes('KYC_INFO_REQUIRED'), `no info request in ${events.join(', ')}`);
    assert.ok(
      !events.includes('KYC_FAILED'),
      'a request for a clearer document is not a failed identity check',
    );

    // The applicant is told the same thing the journal says.
    const notified = await queryOne<{ event: string }>(
      pool,
      `SELECT event FROM notifications WHERE entity_id = $1 AND event = 'KYC_ACTION_REQUIRED' LIMIT 1`,
      [agentId],
    );
    assert.ok(notified, 'the applicant should be asked for what is missing');
  });

  it('still records an outright failure as a failure', async () => {
    const phone = '+2347010009002';
    const application = await post('/agents/apply', {
      fullName: 'Sunday Choji',
      phone,
      email: 'sunday.choji@example.test',
      password: 'FieldAgent2026',
      dateOfBirth: '1990-06-06',
      gender: 'MALE',
      address: '11 Bauchi Road, Jos',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Sunday Choji',
      accountNumber: '0123456786',
    });
    const token = (await loginAs(phone, 'FieldAgent2026')).accessToken;

    await post('/agents/me/kyc', { identityType: 'NIN', identityNumber: '12345678909' }, { token });

    const events = await journalFor(application.body.agentId);
    assert.ok(events.includes('KYC_FAILED'), `no failure in ${events.join(', ')}`);
    assert.ok(!events.includes('KYC_INFO_REQUIRED'), 'a refusal is not a request for more');
  });
});

describe('nominating a referee in place of another', () => {
  it('is journalled as a replacement, so the substitution is visible', async () => {
    const phone = '+2347010009003';
    const application = await post('/agents/apply', {
      fullName: 'Plangnan Dung',
      phone,
      email: 'plangnan.dung@example.test',
      password: 'FieldAgent2026',
      dateOfBirth: '1991-11-30',
      gender: 'MALE',
      address: '3 Murtala Way, Jos',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Plangnan Dung',
      accountNumber: '0123456785',
    });
    assert.equal(application.status, 201, JSON.stringify(application.body));
    const agentId = application.body.agentId;
    const token = (await loginAs(phone, 'FieldAgent2026')).accessToken;

    const first = await post(
      '/agents/me/referees',
      {
        fullName: 'Rev James Bulus',
        phone: '+2348099992001',
        category: 'RELIGIOUS_LEADER',
        relationship: 'Pastor of his church for nine years',
      },
      { token },
    );
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const replacement = await post(
      '/agents/me/referees',
      {
        fullName: 'Mrs Ladi Gyang',
        phone: '+2348099992002',
        category: 'PUBLIC_SERVANT',
        relationship: 'Head teacher at the school where he trades',
        replacesRefereeId: first.body.refereeId,
      },
      { token },
    );
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body));

    const events = await journalFor(agentId);
    assert.equal(
      events.filter((event) => event === 'REFEREE_INVITED').length,
      1,
      `the first nomination only: ${events.join(', ')}`,
    );
    assert.ok(events.includes('REFEREE_REPLACED'), `no replacement in ${events.join(', ')}`);

    // §29: the superseded referee is kept and linked, never overwritten.
    const superseded = await queryOne<{ replaced_by_referee_id: string | null }>(
      pool,
      'SELECT replaced_by_referee_id FROM referees WHERE id = $1',
      [first.body.refereeId],
    );
    assert.equal(superseded!.replaced_by_referee_id, replacement.body.refereeId);
  });
});
