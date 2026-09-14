/**
 * Approving a handset without an officer, and only where that is safe.
 *
 * An agent's first handset is auto-approved so onboarding can finish. Every one
 * after that starts PENDING and waits for a government officer, because
 * revoking a stolen phone would be worth nothing if the thief could register
 * another and carry on collecting. That rule is right and stays.
 *
 * It also makes a demonstration or a local trial awkward in a way no fixture
 * can solve. The seeded agent already has a handset — the seed had to register
 * one to build its data through the real API — so anybody opening the app in
 * their own browser is that agent's second handset and is refused. Two people
 * are needed to show one screen.
 *
 * `DEVICE_AUTO_APPROVE` closes that gap where the stakes are nil: a handset
 * registered against a development or test deployment is approved on the spot.
 *
 * The important half of this file is the other one. The setting is refused at
 * boot in production, in the same block that refuses a mock payment gateway and
 * a mock KYC provider, and for the same reason — a convenience that is harmless
 * on a laptop is the removal of device binding on a government revenue
 * platform. Anybody who found the flag in the code and set it in production
 * would be turning off the control that makes a revoked handset stay revoked.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  createGovernmentUser,
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
import { registerDevice } from '../services/agents';

let agentToken = '';
let agentPhone = '';
let firstDevice = '';
let agentId = '';
let agentUserId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Device Admin', phone: '+2348000000040', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must seed for this suite to mean anything');
  agentPhone = demo!.phone;
  firstDevice = demo!.deviceIdentifier;
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;
  const row = await queryOne<{ id: string; user_id: string }>(
    pool,
    'SELECT a.id, a.user_id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  );
  agentId = row!.id;
  agentUserId = row!.user_id;
});

/**
 * Register a handset and report what state it landed in.
 *
 * Through the service rather than the route so `autoApprove` can be given both
 * answers. Setting the environment variable instead would change it for every
 * other suite sharing this process, several of which assert the strict rule.
 */
async function register(deviceIdentifier: string, autoApprove: boolean) {
  const result = await registerDevice({
    agentId,
    deviceIdentifier,
    deviceName: 'A second handset',
    actorId: agentUserId,
    autoApprove,
  });
  const row = await queryOne<{ status: string; approved_at: Date | null }>(
    pool,
    'SELECT status, approved_at FROM agent_devices WHERE device_identifier = $1',
    [deviceIdentifier],
  );
  return { result, row: row! };
}

describe('A second handset', () => {
  it('waits for an officer by default, which is the production rule', async () => {
    /*
     * The default, and the behaviour every other suite is asserting. Revoking a
     * stolen phone would be worth nothing if the thief could register another
     * and carry on collecting.
     */
    const { row } = await register('second-handset-000001', false);

    assert.equal(row.status, 'PENDING', 'a replacement handset waits for a government officer');
    assert.equal(row.approved_at, null, 'and nothing is stamped, because nobody approved it');
  });

  it('is approved on the spot where the deployment has asked for that', async () => {
    // What a demonstration or a local trial depends on: open the app in any
    // browser, register, collect, without needing a second person.
    const { row } = await register('second-handset-000002', true);

    assert.equal(row.status, 'ACTIVE');
    assert.ok(row.approved_at, 'and stamps when, because every approval is dated');
  });

  it('records that no officer looked at it, and why', async () => {
    // An approval nobody can account for afterwards is worse than a delay. The
    // two reasons are not the same thing: one is the onboarding rule, the other
    // is a deployment setting.
    await register('second-handset-000003', true);
    const event = await queryOne<{ metadata: Record<string, unknown> }>(
      pool,
      `SELECT metadata FROM agent_clearance_events
        WHERE event_type = 'DEVICE_REGISTERED'
          AND metadata->>'deviceIdentifier' = 'second-handset-000003'`,
    );
    assert.ok(event, 'the registration must be journalled like any other');
    assert.equal(event!.metadata.autoApproved, true, 'no officer looked at it');
    assert.equal(event!.metadata.firstDevice, false, 'and it was not the onboarding rule');
  });

  it('never brings back a handset that was revoked', async () => {
    /*
     * The one decision this must never undo, whatever the deployment thinks
     * about convenience. A handset revoked for cause stays revoked.
     */
    await register('second-handset-000004', true);
    await pool.query(
      `UPDATE agent_devices SET status = 'REVOKED', revoked_at = now() WHERE device_identifier = $1`,
      ['second-handset-000004'],
    );

    await assert.rejects(
      () => register('second-handset-000004', true),
      /revoked/i,
      'a revoked handset must not come back, auto-approval or not',
    );

    const row = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM agent_devices WHERE device_identifier = $1',
      ['second-handset-000004'],
    );
    assert.equal(row!.status, 'REVOKED');
  });
});

describe('And refused outright in production', () => {
  it('will not boot with DEVICE_AUTO_APPROVE set', () => {
    /*
     * The half that matters. Loading config in a production-like environment
     * with the flag on must throw, in the same block that refuses a mock
     * payment gateway — a convenience that is harmless on a laptop is device
     * binding removed on a government revenue platform.
     *
     * A child process because config is a module singleton.
     */
    let threw = false;
    let output = '';
    try {
      execFileSync(
        'npx',
        ['tsx', '-e', `require(${JSON.stringify(join(__dirname, '..', 'config.ts'))})`],
        {
          encoding: 'utf8',
          stdio: 'pipe',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: 'postgres://user:pass@db.example.gov.ng:5432/psirs',
            JWT_SECRET: 'a'.repeat(40),
            IDENTITY_HASH_SECRET: 'b'.repeat(40),
            PAYMENT_WEBHOOK_SECRET: 'c'.repeat(40),
            DEVICE_AUTO_APPROVE: 'true',
          },
        },
      );
    } catch (error) {
      threw = true;
      const failure = error as { stdout?: string; stderr?: string };
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }

    assert.ok(threw, 'production must refuse to start with device auto-approval on');
    assert.match(
      output,
      /DEVICE_AUTO_APPROVE/,
      `the refusal must name the setting so it can be found and removed: ${output.slice(0, 400)}`,
    );
  });

  it('says nothing about the setting when nobody set it', () => {
    /*
     * The other direction, and it has to be provable without standing up a
     * fully valid production configuration — which would mean naming a dozen
     * unrelated secrets here and rewriting this test every time one is added.
     *
     * Production refuses to boot for plenty of reasons on a laptop. What
     * matters is that DEVICE_AUTO_APPROVE is not among them when nobody has set
     * it: the complaint appears because somebody asked for it, never by
     * default. Absence fails closed and silently, which is the behaviour a
     * deployment that has simply never heard of the flag depends on.
     */
    let output = '';
    try {
      execFileSync(
        'npx',
        ['tsx', '-e', `require(${JSON.stringify(join(__dirname, '..', 'config.ts'))})`],
        {
          encoding: 'utf8',
          stdio: 'pipe',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: 'postgres://user:pass@db.example.gov.ng:5432/psirs',
            JWT_SECRET: 'a'.repeat(40),
            IDENTITY_HASH_SECRET: 'b'.repeat(40),
            PAYMENT_WEBHOOK_SECRET: 'c'.repeat(40),
            DEVICE_AUTO_APPROVE: undefined as unknown as string,
          },
        },
      );
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }

    assert.ok(output.length > 0, 'a laptop environment cannot boot as production, which is right');
    assert.doesNotMatch(
      output,
      /DEVICE_AUTO_APPROVE/,
      'an unset flag must not be complained about — it is off, quietly, by default',
    );
  });
});
