/**
 * The gate that refuses a build, and could never be moved.
 *
 * `requireSupportedAppVersion` answers 426 with `moneyStatus: NOT_DEBITED` to
 * any collection from a field application below the minimum version. It is the
 * lever for a release found to be getting money wrong — the one thing that
 * stops a bad build taking another naira while a fix ships.
 *
 * It reads the newest `app_versions` row and falls back to configuration only
 * when the table is empty, and the seed inserts a row only when the table is
 * empty. So configuration decided the minimum on the first deploy and nothing
 * could change it afterwards: raising PWA_MINIMUM_AGENT_VERSION in the
 * environment had no effect on a database that already had a row, and no
 * endpoint wrote a second one. The threshold was frozen at whatever shipped on
 * day one, which means the gate could never lock out the build it exists for.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBaseUrl,
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
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { compareVersions } from '@psirs/shared';

let admin = '';
let officer = '';
let agent: { token: string; device: string; phone: string; password: string };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Version Admin', phone: '+2348039000001', role: 'admin' });
  await createGovernmentUser({
    fullName: 'Version Officer',
    phone: '+2348039000002',
    role: 'revenue_officer',
  });
  admin = (await loginAs('+2348039000001')).accessToken;
  officer = (await loginAs('+2348039000002')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = {
    token: session.accessToken,
    device: demo!.deviceIdentifier,
    phone: demo!.phone,
    password: demo!.password,
  };
});

const publish = (body: Record<string, unknown>, token = admin) =>
  post('/agents/app-version', body, { token });

/**
 * How many versions a person has published.
 *
 * The deploy seeds one `app_versions` row so the gate has a threshold on day
 * one, and that row survives every reset — so counting the table says one when
 * nothing has been published. `created_by` is what separates the two: null on
 * the seeded row, and the publishing administrator on every row after it.
 */
const publishedCount = async () =>
  (await query(pool, `SELECT id FROM app_versions WHERE created_by IS NOT NULL`)).length;

/**
 * Take a collection to the point money would move, at a stated app version.
 *
 * The gate guards payment initiation and vehicle renewal — the steps that
 * commit a citizen to paying — rather than registration or assessment, which
 * cost nobody anything and which an out-of-date handset can still usefully do
 * offline. So the version has to be carried all the way to `/payments/initiate`
 * for the refusal to be the one under test.
 */
let subject = 0;
async function collectAt(appVersion: string) {
  subject += 1;
  const auth = { token: agent.token, deviceId: agent.device, appVersion };
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Version',
      lastName: `Subject${subject}`,
      phone: `+234810900000${subject}`,
      address: '5 Rukuba Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `ver-tp-${subject}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId: taxpayer.body.taxpayerId, revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'), inputs: {} },
    { ...auth, idempotencyKey: `ver-as-${subject}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  return post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId },
    { ...auth, idempotencyKey: `ver-pay-${subject}` },
  );
}

describe('The minimum version an administrator can actually raise', () => {
  it('moves the gate, and the old build stops being able to collect', async () => {
    // The build in the field collects normally to begin with.
    const before = await collectAt('1.0.0');
    assert.equal(before.status, 201, JSON.stringify(before.body));

    const published = await publish({
      minimumVersion: '1.4.0',
      recommendedVersion: '1.4.0',
      notes: 'Build 1.3.2 rounds the service charge down; no collection from below 1.4.0.',
    });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.minimumVersion, '1.4.0');
    assert.equal(published.body.previousMinimum, '1.0.0');

    // The gate now refuses the build that was fine a moment ago, and says the
    // money did not move — which is the whole point of refusing at this layer.
    const after = await collectAt('1.0.0');
    assert.equal(after.status, 426, JSON.stringify(after.body));
    assert.equal(after.body.error.code, 'UPDATE_REQUIRED');
    assert.equal(after.body.error.moneyStatus, 'NOT_DEBITED');
    assert.match(after.body.error.message, /1\.4\.0/);

    // And the updated build collects.
    const updated = await collectAt('1.4.0');
    assert.equal(updated.status, 201, JSON.stringify(updated.body));
  });

  it('appends rather than overwriting, so what was required when is kept', async () => {
    await publish({
      minimumVersion: '1.2.0',
      recommendedVersion: '1.2.0',
      notes: 'First tightening after the pilot in Bokkos.',
    });
    await publish({
      minimumVersion: '1.4.0',
      recommendedVersion: '1.5.0',
      notes: 'Service charge rounding fixed in 1.4.0; recommend 1.5.0 for the offline queue.',
    });

    const rows = await query<{ minimum_version: string; notes: string; created_by: string | null }>(
      pool,
      `SELECT minimum_version, notes, created_by FROM app_versions
        WHERE app = 'AGENT_PWA' ORDER BY effective_from`,
    );
    // Three rows, not two: the deploy's own row is still the first of them.
    // What the platform launched requiring is part of the record of what was
    // required when, and a publication that quietly replaced it would lose the
    // only evidence of which build a refusal in the field was measured against.
    assert.deepEqual(rows.map((row) => row.minimum_version), ['1.0.0', '1.2.0', '1.4.0']);
    assert.equal(rows[0].created_by, null, 'the launch row came from the deploy, not a person');
    assert.ok(rows.slice(1).every((row) => row.created_by), 'each published one says who did it');

    // The gate and the read endpoint agree on the newest one.
    const stated = await get('/agents/app-version', { token: agent.token, appVersion: '1.4.0' });
    assert.equal(stated.body.minimumVersion, '1.4.0');
    assert.equal(stated.body.recommendedVersion, '1.5.0');
    assert.equal(stated.body.supported, true);
  });

  it('counts the handsets it is about to stop, rather than leaving it to be discovered', async () => {
    const devices = await query<{ id: string }>(pool, `SELECT id FROM agent_devices WHERE status = 'ACTIVE'`);
    assert.ok(devices.length > 0, 'the demonstration agent has a registered handset');
    await pool.query(`UPDATE agent_devices SET pwa_version = '1.0.0' WHERE status = 'ACTIVE'`);

    const raised = await publish({
      minimumVersion: '2.0.0',
      recommendedVersion: '2.0.0',
      notes: 'Emergency: 1.x sends the wrong revenue item on renewals.',
    });
    assert.equal(raised.status, 200, JSON.stringify(raised.body));
    assert.equal(raised.body.devicesLockedOut, devices.length);
    assert.equal(raised.body.activeDevices, devices.length);
    assert.match(raised.body.message, /cannot collect until they update/i);

    // Locking everybody out is allowed — it is what the lever is for — but it
    // is never silent.
    assert.ok(raised.body.devicesLockedOut > 0);
  });

  it('counts a handset that has never said which build it runs as stopped', async () => {
    /*
     * A device with no reported version is the one the gate itself refuses —
     * `requireSupportedAppVersion` treats a missing version as unsupported —
     * so leaving it out of the count would under-report exactly the handsets
     * that are about to stop working, and an administrator would be told the
     * change was harmless.
     */
    const devices = await query<{ id: string }>(pool, `SELECT id FROM agent_devices WHERE status = 'ACTIVE'`);
    await pool.query(`UPDATE agent_devices SET pwa_version = NULL WHERE status = 'ACTIVE'`);

    const raised = await publish({
      minimumVersion: '1.4.0',
      recommendedVersion: '1.4.0',
      notes: 'Rounding fix; handsets that have never checked in are stopped too.',
    });
    assert.equal(raised.body.devicesLockedOut, devices.length);
  });

  it('says so plainly when nothing in the field is affected', async () => {
    await pool.query(`UPDATE agent_devices SET pwa_version = '3.0.0' WHERE status = 'ACTIVE'`);
    const raised = await publish({
      minimumVersion: '2.0.0',
      recommendedVersion: '3.0.0',
      notes: 'Routine floor lift now every handset is on the March build.',
    });
    assert.equal(raised.body.devicesLockedOut, 0);
    assert.match(raised.body.message, /No active handset is below it/i);
  });
});

describe('What the gate refuses to be set to', () => {
  it('will not accept a minimum above the recommended build', async () => {
    const refused = await publish({
      minimumVersion: '2.0.0',
      recommendedVersion: '1.9.0',
      notes: 'A minimum nobody could satisfy, including the newest build.',
    });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(JSON.stringify(refused.body), /above the recommended/i);

    assert.equal(await publishedCount(), 0, 'nothing was published');
  });

  it('will not accept a date the gate would never read', async () => {
    await publish({
      minimumVersion: '1.2.0',
      recommendedVersion: '1.2.0',
      notes: 'The version currently in force across the state.',
    });

    const backdated = await publish({
      minimumVersion: '1.6.0',
      recommendedVersion: '1.6.0',
      notes: 'Backdated behind the row in force, so the gate would never select it.',
      effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
    });
    assert.equal(backdated.status, 409, JSON.stringify(backdated.body));
    assert.equal(backdated.body.error.code, 'APP_VERSION_NOT_LATER');

    // The minimum is unchanged, which is the thing a silent success would hide.
    const stated = await get('/agents/app-version', { token: agent.token, appVersion: '1.2.0' });
    assert.equal(stated.body.minimumVersion, '1.2.0');
  });

  it('will not accept something that is not a version', async () => {
    const refused = await publish({
      minimumVersion: 'latest',
      recommendedVersion: 'latest',
      notes: 'A word rather than a version number.',
    });
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
  });

  it('is not a revenue officer’s to publish', async () => {
    const refused = await publish(
      {
        minimumVersion: '1.4.0',
        recommendedVersion: '1.4.0',
        notes: 'A revenue officer stopping every agent in the state.',
      },
      officer,
    );
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(await publishedCount(), 0);
  });
});

describe('What an administrator sees before moving it', () => {
  const history = (token = admin) => get('/agents/app-version/history', { token });

  it('shows the fleet against the minimum, so the cost of moving it is known first', async () => {
    await pool.query(`UPDATE agent_devices SET pwa_version = '1.0.0' WHERE status = 'ACTIVE'`);

    const before = await history();
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(before.body.minimumVersion, '1.0.0');
    const running = before.body.fleet.find((row: any) => row.version === '1.0.0');
    assert.ok(running, 'the handsets in the field are listed by the build they run');
    assert.equal(running.belowMinimum, false);
    assert.equal(before.body.activeDevices, running.devices);

    await publish({
      minimumVersion: '1.4.0',
      recommendedVersion: '1.4.0',
      notes: 'Service charge rounding fixed in 1.4.0.',
    });

    const after = await history();
    assert.equal(after.body.minimumVersion, '1.4.0');
    assert.equal(after.body.fleet.find((row: any) => row.version === '1.0.0').belowMinimum, true);
  });

  it('separates what is in force from what is dated ahead', async () => {
    await publish({
      minimumVersion: '1.2.0',
      recommendedVersion: '1.2.0',
      notes: 'In force across the state from today.',
    });
    const scheduled = await publish({
      minimumVersion: '1.6.0',
      recommendedVersion: '1.6.0',
      notes: 'Announced now, enforced after the March rollout finishes.',
      effectiveFrom: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));

    const seen = await history();
    // The scheduled row is on the record but is not the gate's answer yet, and
    // the screen has to be able to tell them apart — a list in date order that
    // did not would show 1.6.0 at the top of a state still collecting on 1.2.0.
    assert.deepEqual(
      seen.body.published.map((row: any) => [row.minimumVersion, row.inForce]),
      [['1.6.0', false], ['1.2.0', true], ['1.0.0', false]],
    );
    assert.equal(seen.body.minimumVersion, '1.2.0');
    assert.equal(seen.body.published[1].publishedBy, 'Version Admin');
    assert.equal(seen.body.published[2].publishedBy, null, 'the launch row was nobody\u2019s decision');

    // And the gate still lets 1.2.0 collect, because the future row is not yet
    // the rule.
    const collecting = await collectAt('1.2.0');
    assert.equal(collecting.status, 201, JSON.stringify(collecting.body));
  });

  it('is not a revenue officer\u2019s to read', async () => {
    assert.equal((await history(officer)).status, 403);
  });
});

describe('Comparing versions', () => {
  /**
   * The comparison decides whether a handset may take money, and it moved out
   * of the middleware so the publishing path could use it without depending on
   * Express. The case that matters is the one a string comparison gets wrong.
   */
  it('reads 1.10.0 as newer than 1.9.0, which a text comparison does not', () => {
    assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
    assert.ok('1.10.0' < '1.9.0', 'the string comparison this replaces says the opposite');
  });

  it('treats a missing part as zero', () => {
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
    assert.ok(compareVersions('1.2.1', '1.2') > 0);
  });
});
