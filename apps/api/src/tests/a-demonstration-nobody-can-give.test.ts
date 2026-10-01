/**
 * Device binding relaxed, and the half of it that must not be.
 *
 * An agent's first handset is auto-approved so onboarding can finish; every
 * one after that waits for an officer, because revoking a stolen phone would
 * be worth nothing if the thief could register another and carry on
 * collecting. `a-handset-approved-without-an-officer.test.ts` asserts that
 * rule and `DEVICE_AUTO_APPROVE` is the existing way to lift it.
 *
 * WHY THAT FLAG WAS NOT ENOUGH
 *
 * It is forced off when NODE_ENV is production and the boot check refuses to
 * start if it is set at all. Right for that flag — but a demonstration
 * deployment is a real deployment, built from the production image with
 * NODE_ENV=production, so the flag is inert in exactly the place a demo runs.
 * The seeded agent already has a handset, so a presenter opening the app in
 * their own browser is that agent's second one and cannot collect: a
 * demonstration nobody can give without a second person and a portal login.
 *
 * The alternative on the table was taking NODE_ENV off production on that
 * service, which would also have turned off the published-secret refusal, the
 * cookie hardening and the replica warning. `DEMO_RELAX_DEVICE_BINDING` names
 * the one control instead.
 *
 * WHAT IT MUST STILL REFUSE
 *
 * A REVOKED or SUSPENDED handset. That is the half worth demonstrating — an
 * officer cutting a handset off and it taking effect — and the half whose
 * absence would look exactly like the platform not having the feature. Those
 * two tests are the point of this file; the permissive one is the easy half.
 */

import './relaxed-device-env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { config } from '../config';

/** A handset identifier this agent has never registered. */
const UNKNOWN_HANDSET = 'a-presenters-own-browser-0001';

let agentToken = '';
let agentId = '';
let seededHandset = '';
let taxpayerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  // `seedDemoAgent` needs an admin to approve the agent, and returns null
  // without one — which would leave every assertion below failing on the
  // fixture rather than on the behaviour.
  await createGovernmentUser({
    fullName: 'Demo Admin',
    phone: '+2348000000041',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must seed for this suite to mean anything');
  seededHandset = demo!.deviceIdentifier;
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agentToken = session.accessToken;

  const row = await queryOne<{ id: string }>(
    pool,
    'SELECT a.id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  );
  agentId = row!.id;

  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Pam',
      lastName: 'Danjuma',
      phone: '+2348031999001',
      address: '14 Rwang Pam Street, Jos',
      lgaId: await firstLga(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agentToken, deviceId: seededHandset },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId;
});

async function firstLga(): Promise<string> {
  const row = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1');
  return row!.id;
}

/** The request a presenter actually makes: an assessment, from some browser. */
async function assessFrom(deviceId: string) {
  return post(
    '/revenue/assessments',
    { taxpayerId, revenueItemId: await revenueItemByCode('DEV-LEVY'), inputs: {} },
    { token: agentToken, deviceId },
  );
}

/** Put the seeded handset into a state and keep its id. */
async function setSeededHandsetStatus(status: string): Promise<void> {
  // `query` returns rows, not a result object, so RETURNING is how this
  // confirms it hit something — an UPDATE that matched nothing would leave
  // the handset ACTIVE and the assertions below would pass for the wrong
  // reason, which is the whole failure mode these two tests exist to catch.
  const updated = await query<{ id: string }>(
    pool,
    `UPDATE agent_devices SET status = $1
      WHERE agent_id = $2 AND device_identifier = $3
      RETURNING id`,
    [status, agentId, seededHandset],
  );
  assert.equal(updated.length, 1, `the seeded handset should have been set ${status}`);
}

describe('with device binding relaxed for a demonstration', () => {
  it('is actually relaxed, or nothing below means anything', () => {
    // The ordering trap `relaxed-device-env.ts` exists for: set the variable
    // after config has loaded and every test here passes on the strict rule.
    assert.equal(
      config.security.deviceBindingRelaxed,
      true,
      'DEMO_RELAX_DEVICE_BINDING did not reach config — relaxed-device-env.ts ' +
        'must be the first import in this file, before anything pulls in config',
    );
  });

  it('lets an agent collect from a handset nobody approved', async () => {
    // The whole point: one person, one browser, no officer.
    const response = await assessFrom(UNKNOWN_HANDSET);

    assert.equal(
      response.status,
      201,
      `an unregistered handset was still refused: ${JSON.stringify(response.body)}`,
    );
  });

  it('still lets the seeded handset collect, which was never in question', async () => {
    const response = await assessFrom(seededHandset);
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });
});

describe('what relaxing it must not reach', () => {
  it('still refuses a REVOKED handset', async () => {
    /*
     * The half worth demonstrating. An officer revokes a stolen phone and it
     * stops collecting — if relaxing the flag turned this off too, a
     * demonstration of revocation would show nothing happening, which is
     * indistinguishable from the platform not having the feature.
     */
    await setSeededHandsetStatus('REVOKED');

    const response = await assessFrom(seededHandset);

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'DEVICE_REVOKED');
  });

  it('still refuses a SUSPENDED handset', async () => {
    // Paused rather than taken away, and it says so — the distinction
    // `middleware/auth.ts` separates these two codes for.
    await setSeededHandsetStatus('SUSPENDED');

    const response = await assessFrom(seededHandset);

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'DEVICE_SUSPENDED');
  });
});

describe('the flag itself', () => {
  function workspaceRoot(): string {
    let directory = process.cwd();
    for (;;) {
      const manifest = join(directory, 'package.json');
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
        if (parsed.workspaces) return directory;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error('no workspace root above ' + process.cwd());
      directory = parent;
    }
  }

  it('is not forced off in production, unlike DEVICE_AUTO_APPROVE', () => {
    /*
     * The property that makes it useful and dangerous, and the one this suite
     * cannot demonstrate by running — NODE_ENV is 'test' here, not
     * 'production'. Asserted against the source instead.
     *
     * If somebody "hardens" this by wrapping it in `isProduction ? false :`,
     * they will have restored the gap it exists to close, and the demo will
     * silently stop working on the only deployment that matters.
     */
    const source = readFileSync(
      join(workspaceRoot(), 'apps/api/src/config.ts'),
      'utf8',
    );
    const line = source
      .split('\n')
      .find((candidate) => candidate.includes('deviceBindingRelaxed:'));

    assert.ok(line, 'config.ts no longer defines deviceBindingRelaxed');
    assert.doesNotMatch(
      line!,
      /isProduction/,
      'deviceBindingRelaxed is now gated on isProduction, which makes it inert ' +
        'on the production-image deployments it was written for — that is what ' +
        'DEVICE_AUTO_APPROVE already does and why this flag had to exist',
    );
  });

  it('is announced at every boot rather than refusing to boot', () => {
    /*
     * It is deliberately NOT in assertProductionReadiness: a flag that refuses
     * to start is a flag nobody can use, and the request this answers was for
     * a demonstration that works. A warning in every container's log is the
     * other way of making it impossible to run quietly.
     */
    const server = readFileSync(
      join(workspaceRoot(), 'apps/api/src/server.ts'),
      'utf8',
    );
    assert.match(
      server,
      /deviceBindingRelaxed[\s\S]{0,200}log\.warn/,
      'server.ts no longer warns at boot when device binding is relaxed, so a ' +
        'deployment could run with it and nothing in its log would say so',
    );
  });
});
