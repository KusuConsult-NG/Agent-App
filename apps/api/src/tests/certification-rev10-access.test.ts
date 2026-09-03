/**
 * Rev-10 independent access-control audit.
 *
 * Written to BREAK five controls, not to demonstrate them. Nothing here reuses
 * the assertions of the feature suites: each test states a rule the platform
 * claims and then attacks it from the outside — through the HTTP API a real
 * attacker reaches, through a direct connection which is what a compromised
 * service account has, or through a child process which is the only honest way
 * to test what a production boot does.
 *
 * The five:
 *
 *   1. DEVICE_AUTO_APPROVE — a handset approved with no officer.
 *   2. The demonstration path — ?device= adopted by a browser nobody approved.
 *   3. The account an agent's commission is paid into.
 *   4. What a stranger is told about a named person's tax affairs.
 *   5. Web push: who receives what, and where the server can be made to POST.
 *
 * TWO TRAPS THIS FILE DELIBERATELY AVOIDS. An attack that never landed proves
 * nothing, and a test that passes because the attack was malformed is
 * indistinguishable from one that passes because the system is sound. So every
 * attack asserts its own preconditions first — that the fixture is in the state
 * the attack needs, that the harness itself lands when pointed at the
 * permissive case, and that the payload arrived as sent.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server as NetServer } from 'node:net';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
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
  territoryForLga,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { hashPassword } from '../lib/crypto';
import { registerDevice } from '../services/agents';
import { __rateLimitStore } from '../middleware/security';
import {
  clearVapidForTesting,
  resetPushTransport,
  saveSubscription,
  sendPushNotification,
  setPushTransportForTesting,
  setVapidForTesting,
  vapidKeys,
} from '../services/push';

before(async () => {
  await startTestServer();
});
after(async () => {
  resetPushTransport();
  // This file's own litter, so a shared shard database is left as it was found.
  await pool.query('DELETE FROM push_subscriptions');
  await stopTestServer();
});

/**
 * `push_subscriptions` is not in the harness's truncate list and holds a
 * foreign key into `users`, which `resetDatabase` deletes from. Clearing it
 * first is what stops one file's subscription breaking the next file's reset.
 */
async function reset(): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions');
  await resetDatabase();
  await seedReferenceData();
  (__rateLimitStore as { reset?: () => void }).reset?.();
}

// ===========================================================================
// Child-process boot harness, copied in shape from certification-audit.test.ts.
// Config is a module singleton, so the only honest way to ask what a
// production process would do is to start one.
// ===========================================================================

const CONFIG = join(__dirname, '..', 'config.ts');

const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@db.example.gov.ng:5432/psirs',
  JWT_SECRET: 'a'.repeat(40),
  IDENTITY_HASH_SECRET: 'b'.repeat(40),
  PAYMENT_WEBHOOK_SECRET: 'c'.repeat(40),
  VERIFICATION_BASE_URL: 'https://portal.psirs.pl.gov.ng/verify',
  PAYMENT_CALLBACK_URL: 'https://agent.psirs.pl.gov.ng/payment/return',
  CORS_ORIGINS: 'https://agent.psirs.pl.gov.ng,https://portal.psirs.pl.gov.ng',
  PAYMENT_GATEWAY: 'remita',
  REMITA_MERCHANT_ID: '123',
  REMITA_API_KEY: 'key',
  REMITA_SERVICE_TYPE_ID: 'svc',
  REMITA_BASE_URL: 'https://login.remita.net',
  TIN_SERVICE: 'http',
  TIN_SERVICE_URL: 'https://tin.psirs.gov.ng',
  VEHICLE_REGISTRY: 'http',
  VEHICLE_REGISTRY_URL: 'https://vreg.gov.ng',
  KYC_PROVIDER: 'http',
  KYC_PROVIDER_URL: 'https://kyc.vendor.ng',
  BANK_VERIFICATION: 'http',
  BANK_VERIFICATION_URL: 'https://bank.vendor.ng',
  SMS_PROVIDER: 'termii',
  SMS_PROVIDER_URL: 'https://sms.termii.com',
  EMAIL_PROVIDER: 'smtp',
  STORAGE_DRIVER: 's3',
  STORAGE_ENDPOINT: 'https://s3.eu-west-1.amazonaws.com',
  STORAGE_BUCKET: 'psirs',
  STORAGE_ACCESS_KEY_ID: 'AK',
  STORAGE_SECRET_ACCESS_KEY: 'SK',
  ERROR_REPORTING: 'webhook',
  ERROR_REPORTING_URL: 'https://alerts.psirs.pl.gov.ng/hook',
  METRICS_TOKEN: 'a-scrape-token',
  RATE_LIMIT_STORE: 'postgres',
};

function envFor(overrides: Record<string, string>, nodeEnv = 'production'): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...PRODUCTION_ENV, ...overrides };
  env.NODE_ENV = nodeEnv;
  // The child must not inherit the suite's own database or its relaxed limits.
  delete env.VAPID_PUBLIC_KEY;
  delete env.VAPID_PRIVATE_KEY;
  return env;
}

/** Load config.ts in a child process and report whether it refused to start. */
function bootProduction(overrides: Record<string, string>): { threw: boolean; output: string } {
  try {
    execFileSync('npx', ['tsx', '-e', `require(${JSON.stringify(CONFIG)})`], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: envFor(overrides),
    });
    return { threw: false, output: '' };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { threw: true, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * What a booted process actually resolved a setting to.
 *
 * The refusal above is one control; this is the other, and they have to be
 * asked separately or a "the deployment is safe" claim rests on whichever one
 * happened to fire.
 */
function bootedValue(
  overrides: Record<string, string>,
  nodeEnv: string,
): { booted: boolean; deviceAutoApprove: boolean | null; output: string } {
  try {
    const stdout = execFileSync(
      'npx',
      [
        'tsx',
        '-e',
        `const { config } = require(${JSON.stringify(CONFIG)});` +
          'process.stdout.write(JSON.stringify({ v: config.security.deviceAutoApprove }));',
      ],
      { encoding: 'utf8', stdio: 'pipe', env: envFor(overrides, nodeEnv) },
    );
    const match = /\{"v":(true|false)\}/.exec(stdout);
    assert.ok(match, `the child did not report a value: ${stdout}`);
    return { booted: true, deviceAutoApprove: match![1] === 'true', output: stdout };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { booted: false, deviceAutoApprove: null, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// ===========================================================================
// ATTACK 1 — DEVICE_AUTO_APPROVE: a handset approved with no officer
// ===========================================================================

describe('ATTACK 1 — a handset approved without an officer', () => {
  it('1a: production refuses to boot with DEVICE_AUTO_APPROVE=true', () => {
    const result = bootProduction({ DEVICE_AUTO_APPROVE: 'true' });

    assert.ok(result.threw, `production booted with DEVICE_AUTO_APPROVE=true: ${result.output}`);
    assert.match(result.output, /Refusing to start in production/);
    assert.match(result.output, /DEVICE_AUTO_APPROVE is set/);
    assert.match(result.output, /device binding removed/);
  });

  it('1a: and with DEVICE_AUTO_APPROVE=1, which the parser also accepts', () => {
    const result = bootProduction({ DEVICE_AUTO_APPROVE: '1' });
    assert.ok(result.threw, `production booted with DEVICE_AUTO_APPROVE=1: ${result.output}`);
    assert.match(result.output, /DEVICE_AUTO_APPROVE is set/);
  });

  it('1a: a clean production environment still boots, so the guard is specific', () => {
    const result = bootProduction({});
    assert.equal(result.threw, false, `a correct production boot must succeed: ${result.output}`);
  });

  /**
   * 1b — is `isProduction ? false : bool(...)` belt-and-braces, or dead?
   *
   * Both readings are testable, and they make different predictions.
   *
   *   BELT-AND-BRACES predicts some production input for which the boot guard
   *   does NOT fire and the ternary is what forces the value false.
   *
   *   DEAD predicts the opposite: every input for which the ternary changes
   *   the answer is exactly the input set that aborts the boot, so the forced
   *   `false` is never read by anything.
   *
   * The set where the ternary matters is the set where `bool()` returns true,
   * which is {'true','1'} — and both of those abort. Everything else resolves
   * to false with or without the ternary, which the development column proves
   * by producing the identical value from the identical string.
   */
  it('1b: the ternary is inert — every input it would change is an input that aborts', () => {
    // Values a human would write meaning "on" that the parser does not accept.
    for (const raw of ['TRUE', 'yes', 'on', 'True']) {
      const inProduction = bootedValue({ DEVICE_AUTO_APPROVE: raw }, 'production');
      const inDevelopment = bootedValue({ DEVICE_AUTO_APPROVE: raw }, 'development');

      assert.equal(inProduction.booted, true, `production refused "${raw}": ${inProduction.output}`);
      assert.equal(
        inProduction.deviceAutoApprove,
        false,
        `DEVICE_AUTO_APPROVE="${raw}" resolved true in production`,
      );
      // The load-bearing half. Development does not have the ternary, and it
      // reaches the same answer — so the ternary changed nothing here.
      assert.equal(
        inDevelopment.deviceAutoApprove,
        false,
        `"${raw}" means "on" to a person and "off" to bool(); development disagreed with production, ` +
          'which would mean the ternary was doing work',
      );
    }

    // And the inputs where the ternary WOULD change the answer are precisely
    // the ones the guard aborts on, so the forced false is never read.
    for (const raw of ['true', '1']) {
      const inProduction = bootedValue({ DEVICE_AUTO_APPROVE: raw }, 'production');
      const inDevelopment = bootedValue({ DEVICE_AUTO_APPROVE: raw }, 'development');

      assert.equal(
        inProduction.booted,
        false,
        `production booted with DEVICE_AUTO_APPROVE="${raw}"`,
      );
      assert.equal(
        inDevelopment.deviceAutoApprove,
        true,
        `"${raw}" must be honoured outside production, or the flag does nothing anywhere`,
      );
    }
  });

  describe('1c: "a handset revoked for cause cannot be registered again either way"', () => {
    it('refuses the same handset back, with auto-approve forced on', async () => {
      await reset();
      await createGovernmentUser({
        role: 'admin',
        phone: '+2348030000901',
        fullName: 'Device Administrator',
      });
      const admin = (await loginAs('+2348030000901')).accessToken;
      const demo = await seedDemoAgent();
      assert.ok(demo, 'the demonstration agent must seed');

      const agentUser = await queryOne<{ user_id: string }>(
        pool,
        'SELECT user_id FROM agents WHERE id = $1',
        [demo!.agentId],
      );
      const device = await queryOne<{ id: string; status: string }>(
        pool,
        'SELECT id, status FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
        [demo!.agentId, demo!.deviceIdentifier],
      );
      // PRECONDITION: the handset exists and is live before it is revoked.
      assert.ok(device, 'the seeded agent must already hold a handset');
      assert.equal(device!.status, 'ACTIVE', 'the seeded handset must start live');

      const revoked = await post(
        `/agents/devices/${device!.id}/revoke`,
        { reason: 'Handset stolen at Terminus market.' },
        { token: admin },
      );
      assert.equal(revoked.status, 200, JSON.stringify(revoked.body));

      // PRECONDITION: the revocation actually landed in the row the attack
      // will now try to resurrect.
      const afterRevoke = await queryOne<{ status: string }>(
        pool,
        'SELECT status FROM agent_devices WHERE id = $1',
        [device!.id],
      );
      assert.equal(afterRevoke!.status, 'REVOKED', 'the handset must be REVOKED before the attack');

      // THE ATTACK. Not through config — through the service, with the flag
      // forced on, which is stronger than any environment could make it.
      await assert.rejects(
        registerDevice({
          agentId: demo!.agentId,
          deviceIdentifier: demo!.deviceIdentifier,
          actorId: agentUser!.user_id,
          autoApprove: true,
        }),
        /revoked and cannot be registered again/,
        'a handset revoked for cause came back',
      );

      const still = await queryOne<{ status: string; count: string }>(
        pool,
        `SELECT status, (SELECT count(*)::text FROM agent_devices
                          WHERE agent_id = $1 AND device_identifier = $2) AS count
           FROM agent_devices WHERE id = $3`,
        [demo!.agentId, demo!.deviceIdentifier, device!.id],
      );
      assert.equal(still!.status, 'REVOKED', 'the revoked row must stay revoked');
      assert.equal(still!.count, '1', 'no second row may be created for the same handset');
    });

    it('but a REPLACEMENT handset is live with no officer when the flag is on', async () => {
      await reset();
      await createGovernmentUser({
        role: 'admin',
        phone: '+2348030000902',
        fullName: 'Device Administrator',
      });
      const admin = (await loginAs('+2348030000902')).accessToken;
      const demo = await seedDemoAgent();
      const agentUser = await queryOne<{ user_id: string }>(
        pool,
        'SELECT user_id FROM agents WHERE id = $1',
        [demo!.agentId],
      );

      const device = await queryOne<{ id: string }>(
        pool,
        'SELECT id FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
        [demo!.agentId, demo!.deviceIdentifier],
      );
      await post(
        `/agents/devices/${device!.id}/revoke`,
        { reason: 'Handset stolen at Terminus market.' },
        { token: admin },
      );

      // PRECONDITION: the agent has a prior handset, so this is a replacement
      // and not the first-device rule under another name.
      const prior = await queryOne<{ count: string }>(
        pool,
        'SELECT count(*)::text AS count FROM agent_devices WHERE agent_id = $1',
        [demo!.agentId],
      );
      assert.equal(prior!.count, '1', 'the replacement must not be counted as a first device');

      // The control, as production runs it: a replacement waits for an officer.
      const strict = await registerDevice({
        agentId: demo!.agentId,
        deviceIdentifier: 'thiefs-replacement-handset-01',
        actorId: agentUser!.user_id,
        autoApprove: false,
      });
      assert.equal(strict.status, 'PENDING', 'without the flag a replacement must wait');

      // The blast radius of the flag, stated rather than implied: the same
      // call with auto-approve on puts a second handset straight into service.
      const relaxed = await registerDevice({
        agentId: demo!.agentId,
        deviceIdentifier: 'thiefs-replacement-handset-02',
        actorId: agentUser!.user_id,
        autoApprove: true,
      });
      assert.equal(
        relaxed.status,
        'ACTIVE',
        'the flag is documented as approving on the spot; if it does not, the documentation is wrong',
      );

      // And it is recorded as such, so the approval nobody made is accountable.
      const journal = await queryOne<{ metadata: { autoApproved: boolean; firstDevice: boolean } }>(
        pool,
        `SELECT metadata FROM agent_clearance_events
          WHERE agent_id = $1 AND event_type = 'DEVICE_REGISTERED'
            AND metadata->>'deviceIdentifier' = 'thiefs-replacement-handset-02'`,
        [demo!.agentId],
      );
      assert.ok(journal, 'an auto-approval must leave a journal entry');
      assert.equal(journal!.metadata.autoApproved, true);
      assert.equal(
        journal!.metadata.firstDevice,
        false,
        'the journal must distinguish the onboarding rule from the deployment setting',
      );
    });
  });
});

// ===========================================================================
// ATTACK 2 — the demonstration path
// ===========================================================================

const AGENT_DEVICE_MODULE = join(__dirname, '..', '..', '..', 'agent', 'src', 'lib', 'device.ts');
const SEED = join(__dirname, '..', 'db', 'seed.ts');

/** Bundle the PWA's device module the way a build of that mode would. */
function buildDeviceModule(dev: boolean): string {
  const outfile = join(tmpdir(), `psirs-audit-device-${dev ? 'dev' : 'prod'}-${process.pid}.cjs`);
  execFileSync(
    'npx',
    [
      'esbuild',
      AGENT_DEVICE_MODULE,
      '--bundle',
      '--format=cjs',
      '--platform=node',
      `--define:import.meta.env.DEV=${dev}`,
      `--outfile=${outfile}`,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  return outfile;
}

/** Run that bundle in a child process with a browser's globals faked in. */
function identifierFromBuild(dev: boolean, search: string, stored?: string): string {
  const bundle = buildDeviceModule(dev);
  const script = `
    const store = ${JSON.stringify(stored ? { 'psirs.device.id': stored } : {})};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    global.window = { location: { search: ${JSON.stringify(search)} } };
    const { getDeviceIdentifier } = require(${JSON.stringify(bundle)});
    process.stdout.write(JSON.stringify({ id: getDeviceIdentifier() }));
  `;
  const stdout = execFileSync('node', ['-e', script], { encoding: 'utf8', stdio: 'pipe' });
  const parsed = JSON.parse(stdout) as { id: string };
  return parsed.id;
}

describe('ATTACK 2 — a demonstration started in a browser nobody approved', () => {
  const DEMO_DEVICE = 'uat-agent-device-000001';

  it('2: a production build of the PWA ignores ?device= entirely', () => {
    // PRECONDITION, and the trap this test exists to avoid: prove the harness
    // lands at all by pointing it at the permissive build first. A production
    // assertion that passes because esbuild silently dropped the define would
    // be indistinguishable from one that passes because the guard works.
    const inDevelopment = identifierFromBuild(true, `?device=${DEMO_DEVICE}`);
    assert.equal(
      inDevelopment,
      DEMO_DEVICE,
      'the development build must adopt ?device=, or this harness is not exercising the branch',
    );

    const inProduction = identifierFromBuild(false, `?device=${DEMO_DEVICE}`);
    assert.notEqual(inProduction, DEMO_DEVICE, 'a production build honoured ?device=');
    assert.match(inProduction, /^pwa-/, 'a production build must mint its own identifier');

    // And it must not overwrite the handset an officer already approved.
    const overStored = identifierFromBuild(false, `?device=${DEMO_DEVICE}`, 'pwa-the-real-handset');
    assert.equal(overStored, 'pwa-the-real-handset', 'a production build let a link repoint the handset');
  });

  it('2: naming another agent\'s approved handset gains nothing at the API', async () => {
    await reset();
    await createGovernmentUser({
      role: 'admin',
      phone: '+2348030000903',
      fullName: 'Device Administrator',
    });
    const demo = await seedDemoAgent();
    assert.ok(demo, 'the demonstration agent must seed');
    const other = await seedSecondAgent('+2347099000201', 'agent-b-handset-000001');

    // PRECONDITION: agent A's handset is real and ACTIVE, and agent B is a
    // different agent with a different handset.
    const aDevice = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM agent_devices WHERE agent_id = $1 AND device_identifier = $2',
      [demo!.agentId, demo!.deviceIdentifier],
    );
    assert.equal(aDevice!.status, 'ACTIVE');
    assert.notEqual(other.agentId, demo!.agentId);

    const bSession = await loginAs(other.phone, 'Password123', other.deviceIdentifier);
    const lgaId = await firstLgaId();
    const registration = {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Bindings',
      lastName: 'Test',
      phone: '+2348037000111',
      gender: 'UNSPECIFIED',
      address: '4 Audit Way, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    };

    // THE ATTACK: agent B presents agent A's approved identifier on a
    // device-bound, revenue-collecting route.
    const stolen = await post('/taxpayers', registration, {
      token: bSession.accessToken,
      deviceId: demo!.deviceIdentifier,
      idempotencyKey: `audit-bind-stolen-${randomUUID()}`,
    });
    assert.equal(stolen.status, 403, JSON.stringify(stolen.body));
    assert.equal(stolen.body.error.code, 'DEVICE_NOT_REGISTERED');

    // PRECONDITION, checked after the fact: the same request from agent B's
    // OWN handset does not hit the device gate, so the refusal above is about
    // the identifier and not about a malformed request.
    const own = await post('/taxpayers', registration, {
      token: bSession.accessToken,
      deviceId: other.deviceIdentifier,
      idempotencyKey: `audit-bind-own-${randomUUID()}`,
    });
    assert.notEqual(
      own.body?.error?.code,
      'DEVICE_NOT_REGISTERED',
      `the request shape itself was refused: ${JSON.stringify(own.body)}`,
    );
  });

  it('2: the demonstration seed is a closed door in production, not a second one', () => {
    // B-5 was about `--demo` creating five ACTIVE government accounts sharing
    // one published password. The device demonstration rides the same seed, so
    // it is checked here from the outside rather than assumed to be covered.
    const env = { ...envFor({}), DATABASE_URL: process.env.DATABASE_URL! };
    const run = (flags: string[]): { threw: boolean; output: string } => {
      try {
        const stdout = execFileSync('npx', ['tsx', SEED, ...flags], {
          encoding: 'utf8',
          stdio: 'pipe',
          env,
        });
        return { threw: false, output: stdout };
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string };
        return { threw: true, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
      }
    };

    for (const flag of ['--demo', '--demo-agent']) {
      const result = run([flag]);
      assert.ok(result.threw, `${flag} must fail in production: ${result.output}`);
      assert.match(result.output, /Refusing --demo\/--demo-agent in production/);
      assert.ok(
        !result.output.includes('Password123'),
        'no demonstration password may be printed in production',
      );
      assert.ok(
        !result.output.includes('uat-agent-device'),
        'no demonstration handset identifier may be printed in production',
      );
    }
  });
});

/**
 * A second agent, built the way the isolation suites build one.
 *
 * Deliberately not through the application pipeline: what these tests need is
 * a second identity holding a second handset, and the clearance journey is not
 * what is under attack here.
 */
async function seedSecondAgent(
  phone: string,
  deviceIdentifier: string,
): Promise<{ agentId: string; userId: string; phone: string; deviceIdentifier: string }> {
  const lgaId = await firstLgaId();
  const territoryId = await territoryForLga(lgaId);
  const userId = await createGovernmentUser({
    fullName: 'Second Field Agent',
    phone,
    role: 'agent',
  });
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
    userId,
    await hashPassword('Password123'),
  ]);
  const agent = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO agents (user_id, application_number, lga_id, territory_id, operational_status,
                         clearance_status, kyc_status, referee_status, training_status, account_status)
     VALUES ($1, $2, $3, $4, 'ACTIVE', 'APPROVED', 'CLEARED', 'CLEARED', 'COMPLETED', 'ACTIVE')
     RETURNING id`,
    [userId, `APP-AUDIT-${randomUUID().slice(0, 8)}`, lgaId, territoryId],
  );
  await pool.query(
    `INSERT INTO agent_devices (agent_id, device_identifier, device_name, status, registered_at, approved_at)
     VALUES ($1, $2, 'Audit Handset', 'ACTIVE', now(), now())`,
    [agent!.id, deviceIdentifier],
  );
  return { agentId: agent!.id, userId, phone, deviceIdentifier };
}

// ===========================================================================
// ATTACK 3 — where an agent's commission is paid
// ===========================================================================

const NEW_ACCOUNT = {
  bankName: 'Guaranty Trust Bank',
  bankCode: '058',
  accountName: 'Demo Field Agent',
  accountNumber: '0987654321',
  reason: 'Old account closed when the branch merged.',
};

/** A number the development bank verifier resolves to somebody else. */
const MISMATCHING_ACCOUNT = { ...NEW_ACCOUNT, accountNumber: '0987654329' };
/** A number the development bank verifier cannot reach the bank about. */
const UNREACHABLE_ACCOUNT = { ...NEW_ACCOUNT, accountNumber: '0987654328' };

interface BankFixture {
  agentToken: string;
  agentPhone: string;
  agentUserId: string;
  agentId: string;
  device: string;
  adminToken: string;
  supervisorToken: string;
  supervisorId: string;
}

async function bankFixture(seq: string): Promise<BankFixture> {
  await reset();
  const adminPhone = `+234803000${seq}`;
  const supervisorPhone = `+234803001${seq}`;
  await createGovernmentUser({ role: 'admin', phone: adminPhone, fullName: 'Agent Administrator' });
  const supervisorId = await createGovernmentUser({
    role: 'supervisor',
    phone: supervisorPhone,
    fullName: 'Approving Supervisor',
  });
  const adminToken = (await loginAs(adminPhone)).accessToken;
  const supervisorToken = (await loginAs(supervisorPhone)).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  const agentUser = await queryOne<{ user_id: string }>(
    pool,
    'SELECT user_id FROM agents WHERE id = $1',
    [demo!.agentId],
  );

  return {
    agentToken: session.accessToken,
    agentPhone: demo!.phone,
    agentUserId: agentUser!.user_id,
    agentId: demo!.agentId,
    device: demo!.deviceIdentifier,
    adminToken,
    supervisorToken,
    supervisorId,
  };
}

const activeAccountOf = (agentId: string) =>
  queryOne<{ id: string; account_number: string; bank_name: string; status: string }>(
    pool,
    `SELECT b.id, b.account_number, b.bank_name, b.status
       FROM agents a JOIN bank_accounts b ON b.id = a.bank_account_id WHERE a.id = $1`,
    [agentId],
  );

async function proposeAsAgent(fixture: BankFixture, body: Record<string, unknown> = NEW_ACCOUNT) {
  await grantStepUp(fixture.agentToken, fixture.agentPhone, 'agent.bank_account.change');
  return post('/agents/me/bank/change', body, {
    token: fixture.agentToken,
    deviceId: fixture.device,
  });
}

describe('ATTACK 3 — moving where an agent is paid', () => {
  it('3a: a signed-in session alone cannot move the destination', async () => {
    const fixture = await bankFixture('9101');
    const before = await activeAccountOf(fixture.agentId);
    assert.ok(before, 'the agent must start with an account on record');

    // THE ATTACK: a live session, no step-up code — the stolen-laptop case.
    const response = await post('/agents/me/bank/change', NEW_ACCOUNT, {
      token: fixture.agentToken,
      deviceId: fixture.device,
    });

    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'STEP_UP_REQUIRED');

    const proposals = await query(pool, `SELECT id FROM bank_accounts WHERE status = 'PROPOSED'`);
    assert.equal(proposals.length, 0, 'nothing may be proposed without a step-up');
    const after = await activeAccountOf(fixture.agentId);
    assert.equal(after!.id, before!.id, 'the account in use must be untouched');
  });

  it('3b: the same person cannot both raise and authorise the change (service)', async () => {
    const fixture = await bankFixture('9102');
    const proposal = await proposeAsAgent(fixture);
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
    assert.equal(proposal.body.verificationStatus, 'VERIFIED');

    // PRECONDITION: the approval names the person who asked for it.
    const approval = await queryOne<{ requested_by: string; status: string }>(
      pool,
      'SELECT requested_by, status FROM approvals WHERE id = $1',
      [proposal.body.approvalId],
    );
    assert.equal(approval!.requested_by, fixture.agentUserId);
    assert.equal(approval!.status, 'REQUESTED');

    /*
     * Give the requester the hats an approver holds. In this platform the
     * roles separate structurally — `agent:manage` and `approval:authorise`
     * are held by different roles — so the only way to ask the question is to
     * put both on one account, which is exactly the state a role change or a
     * compromised administrator produces.
     */
    await pool.query(`UPDATE users SET role = 'supervisor' WHERE id = $1`, [fixture.agentUserId]);
    const rearmed = await loginAs(fixture.agentPhone, 'FieldAgent2026', fixture.device);
    assert.equal(rearmed.user.role, 'supervisor', 'the attacker must actually hold the approver role');

    // THE ATTACK.
    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Approving my own request for the money.' },
      { token: rearmed.accessToken },
    );

    assert.equal(decided.status, 403, JSON.stringify(decided.body));
    assert.match(decided.body.error.message, /you cannot review or approve it/);

    const after = await queryOne<{ status: string; approved_by: string | null }>(
      pool,
      'SELECT status, approved_by FROM approvals WHERE id = $1',
      [proposal.body.approvalId],
    );
    assert.equal(after!.status, 'REQUESTED');
    assert.equal(after!.approved_by, null);
  });

  it('3b: and the database refuses it too, so it is an invariant not a check', async () => {
    const fixture = await bankFixture('9103');
    const proposal = await proposeAsAgent(fixture);
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));

    // THE ATTACK: a compromised service account with a psql connection, going
    // straight past every line of application code.
    let message = '';
    let code = '';
    try {
      await pool.query(
        `UPDATE approvals
            SET status = 'APPROVED', approved_by = requested_by, approved_at = now(),
                decision_reason = 'Self-approved by a compromised service account'
          WHERE id = $1`,
        [proposal.body.approvalId],
      );
    } catch (error) {
      message = (error as Error).message;
      code = (error as { code?: string }).code ?? '';
    }
    console.log(`  raw self-approval → SQLSTATE ${code}: ${message}`);
    assert.equal(code, '23514', `expected a check-constraint violation, got "${code}" ${message}`);
    assert.match(message, /approvals_maker_not_approver/, message);

    // The same from a clean insert, so it is the constraint and not the row.
    let insertMessage = '';
    try {
      await pool.query(
        `INSERT INTO approvals
           (approval_type, entity_type, entity_id, payload, requested_by, requested_reason,
            status, approved_by, approved_at, decision_reason)
         VALUES ('BANK_ACCOUNT_CHANGE','bank_account',$1,'{}'::jsonb,$2,'raised',
                 'APPROVED',$2, now(), 'and approved by the same person')`,
        [proposal.body.proposedAccountId, fixture.agentUserId],
      );
    } catch (error) {
      insertMessage = (error as Error).message;
    }
    assert.match(insertMessage, /approvals_maker_not_approver/, insertMessage);

    // And the requester cannot be rewritten to make room for one.
    let mutateMessage = '';
    try {
      await pool.query(`UPDATE approvals SET requested_by = $2 WHERE id = $1`, [
        proposal.body.approvalId,
        fixture.supervisorId,
      ]);
    } catch (error) {
      mutateMessage = (error as Error).message;
    }
    console.log(`  raw requester rewrite → ${mutateMessage}`);
    assert.match(mutateMessage, /requested_by/, mutateMessage);
  });

  /**
   * How far a psql connection gets when it stops pretending to be an approval.
   *
   * The maker-checker rule is an invariant — the constraints above prove it.
   * What the schema does NOT claim is that the destination itself can only
   * move behind one, so this measures the residue rather than inventing a
   * requirement: which of the guarantees the schema does make still stand, and
   * what a compromised service account is left able to do.
   */
  it('3b: the residue — what a psql connection can still reach', async () => {
    const fixture = await bankFixture('9110');
    const current = await activeAccountOf(fixture.agentId);
    assert.ok(current, 'the agent must start with an account on record');

    // CLAIMED: an account number never changes in place.
    let inPlace = '';
    try {
      await pool.query(`UPDATE bank_accounts SET account_number = '9999999999' WHERE id = $1`, [
        current!.id,
      ]);
    } catch (error) {
      inPlace = (error as Error).message;
    }
    console.log(`  raw account-number edit → ${inPlace}`);
    assert.match(inPlace, /account_number/, `an account number was edited in place: ${inPlace}`);

    // CLAIMED: one account in use per owner at a time.
    let twoActive = '';
    try {
      await pool.query(
        `INSERT INTO bank_accounts (owner_type, owner_id, bank_name, bank_code, account_name,
                                    account_number, verification_status, status)
         VALUES ('AGENT', $1, 'Attacker Bank', '999', 'Not The Agent', '5555555555', 'VERIFIED', 'ACTIVE')`,
        [fixture.agentId],
      );
    } catch (error) {
      twoActive = (error as Error).message;
    }
    console.log(`  raw second ACTIVE account → ${twoActive}`);
    assert.match(
      twoActive,
      /bank_accounts_one_active_per_owner/,
      `two accounts became simultaneously in use: ${twoActive}`,
    );

    // NOT CLAIMED, and measured rather than asserted: whether the destination
    // can be moved with no approval anywhere. Reported, not required.
    let moved = false;
    let movedError = '';
    try {
      await pool.query(
        `UPDATE bank_accounts SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1`,
        [current!.id],
      );
      const attacker = await queryOne<{ id: string }>(
        pool,
        `INSERT INTO bank_accounts (owner_type, owner_id, bank_name, bank_code, account_name,
                                    account_number, verification_status, status)
         VALUES ('AGENT', $1, 'Attacker Bank', '999', 'Not The Agent', '5555555555', 'VERIFIED', 'ACTIVE')
         RETURNING id`,
        [fixture.agentId],
      );
      await pool.query('UPDATE agents SET bank_account_id = $2 WHERE id = $1', [
        fixture.agentId,
        attacker!.id,
      ]);
      const now = await activeAccountOf(fixture.agentId);
      moved = now!.account_number === '5555555555';
    } catch (error) {
      movedError = (error as Error).message;
    }
    const approvals = await query(
      pool,
      `SELECT id FROM approvals WHERE approval_type = 'BANK_ACCOUNT_CHANGE'`,
    );
    const trail = await query(
      pool,
      `SELECT id FROM audit_logs WHERE action = 'agent.bank_account_changed'`,
    );
    console.log(
      `  raw destination move without any approval → moved=${moved} ` +
        `approvals=${approvals.length} auditEntries=${trail.length}${movedError ? ` error=${movedError}` : ''}`,
    );

    // What IS still true afterwards, and is worth having: the account that was
    // in use is kept rather than overwritten, so the trail of where money went
    // is walkable even when the move itself went round the workflow.
    const superseded = await queryOne<{ status: string; account_number: string }>(
      pool,
      'SELECT status, account_number FROM bank_accounts WHERE id = $1',
      [current!.id],
    );
    assert.equal(superseded!.status, 'SUPERSEDED');
    assert.equal(superseded!.account_number, current!.account_number);
  });

  it('3c: a payout in flight blocks the change being proposed at all', async () => {
    const fixture = await bankFixture('9104');
    const account = await activeAccountOf(fixture.agentId);

    // A payout already authorised against the account money is going to.
    await pool.query(
      `INSERT INTO commission_payouts
         (payout_reference, agent_id, bank_account_id, amount_kobo, commission_count, status)
       VALUES ('PO-AUDIT-REQ', $1, $2, 250000, 3, 'REQUESTED')`,
      [fixture.agentId, account!.id],
    );
    // PRECONDITION: the payout the block is supposed to see really exists.
    const inFlight = await queryOne<{ status: string }>(
      pool,
      `SELECT status FROM commission_payouts WHERE payout_reference = 'PO-AUDIT-REQ'`,
    );
    assert.equal(inFlight!.status, 'REQUESTED');

    const blocked = await proposeAsAgent(fixture);
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.error.code, 'PAYOUT_IN_FLIGHT');
    assert.match(blocked.body.error.message, /PO-AUDIT-REQ/);

    const proposals = await query(
      pool,
      `SELECT id FROM bank_accounts WHERE owner_id = $1 AND status = 'PROPOSED'`,
      [fixture.agentId],
    );
    assert.equal(proposals.length, 0, 'a proposal was raised while a payout was in flight');
  });

  it('3c: and blocks one already raised from being carried out', async () => {
    const fixture = await bankFixture('9109');
    const account = await activeAccountOf(fixture.agentId);

    // Raised while nothing was outstanding — the ordering an attacker wants.
    const proposal = await proposeAsAgent(fixture);
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
    assert.equal(proposal.body.verificationStatus, 'VERIFIED');

    await pool.query(
      `INSERT INTO commission_payouts
         (payout_reference, agent_id, bank_account_id, amount_kobo, commission_count, status)
       VALUES ('PO-AUDIT-APP', $1, $2, 250000, 3, 'APPROVED')`,
      [fixture.agentId, account!.id],
    );
    const inFlight = await queryOne<{ status: string }>(
      pool,
      `SELECT status FROM commission_payouts WHERE payout_reference = 'PO-AUDIT-APP'`,
    );
    assert.equal(inFlight!.status, 'APPROVED', 'the payout must be in flight at the decision');

    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'Authorising the new destination account.' },
      { token: fixture.supervisorToken },
    );
    assert.equal(decided.status, 409, JSON.stringify(decided.body));
    assert.equal(decided.body.error.code, 'PAYOUT_IN_FLIGHT');

    // The decision must roll back with the execution it could not perform.
    const approval = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM approvals WHERE id = $1',
      [proposal.body.approvalId],
    );
    assert.equal(
      approval!.status,
      'REQUESTED',
      'an approval was recorded for a change that did not happen',
    );
    const after = await activeAccountOf(fixture.agentId);
    assert.equal(after!.id, account!.id, 'the destination moved while a payout was in flight');
  });

  it('3d: agent A cannot move agent B\'s account, by path or by body', async () => {
    const fixture = await bankFixture('9105');
    const victim = await seedSecondAgent('+2347099000301', 'agent-b-handset-000301');
    const victimAccount = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO bank_accounts (owner_type, owner_id, bank_name, bank_code, account_name,
                                  account_number, verification_status, status)
       VALUES ('AGENT', $1, 'Zenith Bank', '057', 'Second Field Agent', '0111000222', 'VERIFIED', 'ACTIVE')
       RETURNING id`,
      [victim.agentId],
    );
    await pool.query('UPDATE agents SET bank_account_id = $2 WHERE id = $1', [
      victim.agentId,
      victimAccount!.id,
    ]);
    // PRECONDITION: the victim has an account worth stealing.
    assert.ok((await activeAccountOf(victim.agentId))!.id === victimAccount!.id);

    // ATTACK 1 — the id in the path. Step-up first, so the refusal is about
    // authorisation and not about the missing second factor.
    await grantStepUp(fixture.agentToken, fixture.agentPhone, 'agent.bank_account.change');
    const byPath = await post(`/agents/${victim.agentId}/bank/change`, NEW_ACCOUNT, {
      token: fixture.agentToken,
      deviceId: fixture.device,
    });
    assert.equal(byPath.status, 403, JSON.stringify(byPath.body));

    // ATTACK 2 — the id smuggled into the body of the self-service route.
    const byBody = await post(
      '/agents/me/bank/change',
      { ...NEW_ACCOUNT, agentId: victim.agentId, ownerId: victim.agentId },
      { token: fixture.agentToken, deviceId: fixture.device },
    );
    // It may well succeed — as a change to the ATTACKER'S OWN account.
    assert.ok([201, 403].includes(byBody.status), JSON.stringify(byBody.body));

    const victimNow = await activeAccountOf(victim.agentId);
    assert.equal(victimNow!.id, victimAccount!.id, 'the victim\'s account was repointed');
    assert.equal(victimNow!.account_number, '0111000222');
    const victimProposals = await query(
      pool,
      `SELECT id FROM bank_accounts WHERE owner_id = $1 AND status = 'PROPOSED'`,
      [victim.agentId],
    );
    assert.equal(victimProposals.length, 0, 'a proposal was raised against the victim');

    // ATTACK 3 — retrying the bank check on somebody else's proposal.
    if (byBody.status === 201) {
      const reverify = await post(
        `/agents/bank-changes/${byBody.body.approvalId}/verify`,
        {},
        { token: fixture.agentToken, deviceId: fixture.device },
      );
      assert.equal(reverify.status, 403, JSON.stringify(reverify.body));
    }

    // ATTACK 4 — reading the queue of everybody's pending changes.
    const queue = await get('/agents/bank-changes', {
      token: fixture.agentToken,
      deviceId: fixture.device,
    });
    assert.equal(queue.status, 403, JSON.stringify(queue.body));
  });

  it('3e: an account the bank says belongs to someone else cannot be approved', async () => {
    const fixture = await bankFixture('9106');
    const before = await activeAccountOf(fixture.agentId);

    const proposal = await proposeAsAgent(fixture, MISMATCHING_ACCOUNT);
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
    // PRECONDITION: the bank really did refuse, and said whose it is.
    assert.equal(proposal.body.verificationStatus, 'FAILED', JSON.stringify(proposal.body));
    assert.equal(proposal.body.verificationResolvedName, 'CHINEDU OKAFOR');

    // THE ATTACK: a second officer waves it through anyway.
    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'The agent assures me the account is theirs.' },
      { token: fixture.supervisorToken },
    );
    assert.equal(decided.status, 409, JSON.stringify(decided.body));
    assert.equal(decided.body.error.code, 'BANK_ACCOUNT_NOT_VERIFIED');
    assert.match(decided.body.error.message, /CHINEDU OKAFOR/);

    const approval = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM approvals WHERE id = $1',
      [proposal.body.approvalId],
    );
    assert.equal(approval!.status, 'REQUESTED', 'the decision must roll back with the execution');
    const after = await activeAccountOf(fixture.agentId);
    assert.equal(after!.id, before!.id, 'a mismatched account became the destination');
  });

  it('3e: "the bank could not be reached" is not a soft yes either', async () => {
    const fixture = await bankFixture('9107');
    const before = await activeAccountOf(fixture.agentId);

    const proposal = await proposeAsAgent(fixture, UNREACHABLE_ACCOUNT);
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
    assert.equal(proposal.body.verificationStatus, 'PENDING', JSON.stringify(proposal.body));

    const decided = await post(
      `/government/approvals/${proposal.body.approvalId}/decide`,
      { decision: 'APPROVE', reason: 'The bank service is down; approving on trust.' },
      { token: fixture.supervisorToken },
    );
    assert.equal(decided.status, 409, JSON.stringify(decided.body));
    assert.equal(decided.body.error.code, 'BANK_ACCOUNT_NOT_VERIFIED');

    const after = await activeAccountOf(fixture.agentId);
    assert.equal(after!.id, before!.id);
  });

  it('3: the agent is told on the number already on record, not one supplied', async () => {
    const fixture = await bankFixture('9108');
    const notified = await proposeAsAgent(fixture, {
      ...NEW_ACCOUNT,
      phone: '+2349999999999',
      accountName: 'Demo Field Agent',
    });
    assert.equal(notified.status, 201, JSON.stringify(notified.body));

    const rows = await query<{ recipient: string; message: string }>(
      pool,
      `SELECT recipient, message FROM notifications WHERE event = 'AGENT_BANK_CHANGE_REQUESTED'`,
    );
    assert.ok(rows.length > 0, 'the agent must be told while it is still a proposal');
    for (const row of rows) {
      assert.notEqual(row.recipient, '+2349999999999', 'the warning went to a number in the request');
      assert.ok(
        !row.message.includes('0987654321'),
        `the full account number reached a notification: ${row.message}`,
      );
    }
  });
});

// ===========================================================================
// ATTACK 4 — what a stranger is told about a named person
// ===========================================================================

interface CitizenFixture {
  phone: string;
  tin: string;
  taxpayerId: string;
  officerToken: string;
}

async function citizenFixture(): Promise<CitizenFixture> {
  await reset();
  const lgaId = await firstLgaId();
  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000700',
    fullName: 'Records Administrator',
  });
  await createGovernmentUser({
    role: 'revenue_officer',
    phone: '+2348030000701',
    fullName: 'Records Officer',
  });
  const officerToken = (await loginAs('+2348030000701')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must seed');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);

  const phone = '+2348037654321';
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      lastName: 'Danjuma',
      phone,
      gender: 'UNSPECIFIED',
      address: '9 Market Road, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: session.accessToken, deviceId: demo!.deviceIdentifier, idempotencyKey: 'audit-cit-1' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const taxpayerId = created.body.taxpayerId as string;

  const tin = '900112233';
  await pool.query(`UPDATE taxpayers SET tin = $2, tin_status = 'ASSIGNED' WHERE id = $1`, [
    taxpayerId,
    tin,
  ]);

  // Something owed, so the "amount" question is a real one.
  const item = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM revenue_items WHERE code = 'MARKET-LEVY'`,
  );
  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId, revenueItemId: item!.id, inputs: {} },
    { token: session.accessToken, deviceId: demo!.deviceIdentifier },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  (__rateLimitStore as { reset?: () => void }).reset?.();
  return { phone, tin, taxpayerId, officerToken };
}

describe('ATTACK 4 — the unauthenticated citizen-status read', () => {
  it('4: the whole response, field by field, for a caller who knows a phone number', async () => {
    const fixture = await citizenFixture();

    const byPhone = await get(`/citizen-status?phone=${encodeURIComponent(fixture.phone)}`);
    assert.equal(byPhone.status, 200, JSON.stringify(byPhone.body));

    // THE FULL DUMP, printed so the report can quote it rather than paraphrase.
    console.log('  citizen-status?phone= →', JSON.stringify(byPhone.body));

    const owed = await queryOne<{ total: string }>(
      pool,
      `SELECT COALESCE(SUM(total_amount_kobo - amount_paid_kobo),0)::text AS total
         FROM invoices WHERE taxpayer_id = $1`,
      [fixture.taxpayerId],
    );
    // PRECONDITION: there is genuinely something to disclose. A "no leak"
    // result against an empty record proves nothing.
    assert.ok(BigInt(owed!.total) > 0n, 'the fixture must actually owe money');
    const compliance = await queryOne<{ score: number }>(
      pool,
      'SELECT score FROM taxpayer_compliance WHERE taxpayer_id = $1',
      [fixture.taxpayerId],
    );
    assert.ok(compliance, 'the fixture must have a compliance row to withhold');

    // The exact field set. A new field appearing here is a disclosure decision
    // somebody has to make on purpose.
    assert.deepEqual(
      Object.keys(byPhone.body).sort(),
      ['complianceStatus', 'detail', 'found', 'hasOutstanding', 'message', 'tinStatus'],
      `the response shape changed: ${JSON.stringify(byPhone.body)}`,
    );

    const serialised = JSON.stringify(byPhone.body);
    assert.ok(!serialised.includes(fixture.tin), `the TIN was handed out: ${serialised}`);
    assert.equal(byPhone.body.tin, undefined);
    assert.equal(byPhone.body.complianceScore, undefined);
    assert.ok(
      !new RegExp(`\\b${compliance!.score}\\b`).test(serialised),
      `the numeric compliance score appears in the body: ${serialised}`,
    );
    assert.ok(!serialised.includes(owed!.total), `the amount owed was disclosed: ${serialised}`);

    // The tax this person was actually assessed for, read out of the database
    // rather than guessed, because "Cattle Dealer Levy" describes a livelihood.
    const assessed = await query<{ name: string; code: string }>(
      pool,
      `SELECT DISTINCT ri.name, ri.code
         FROM assessments a JOIN revenue_items ri ON ri.id = a.revenue_item_id
        WHERE a.taxpayer_id = $1`,
      [fixture.taxpayerId],
    );
    assert.ok(assessed.length > 0, 'the fixture must carry a named obligation to withhold');
    for (const item of assessed) {
      assert.ok(!serialised.includes(item.name), `the obligation name "${item.name}" leaked`);
      assert.ok(!serialised.includes(item.code), `the obligation code "${item.code}" leaked`);
    }
    assert.equal(byPhone.body.lastPaymentAt, undefined);
    assert.equal(byPhone.body.obligations, undefined);
    assert.equal(byPhone.body.programmes, undefined);

    // The TIN route is the strongest identifier and must not say more.
    const byTin = await get(`/citizen-status?tin=${fixture.tin}`);
    assert.equal(byTin.status, 200);
    console.log('  citizen-status?tin=   →', JSON.stringify(byTin.body));
    assert.deepEqual(Object.keys(byTin.body).sort(), Object.keys(byPhone.body).sort());
  });

  it('4: an anonymous caller is not handed the officer\'s words about the person', async () => {
    const fixture = await citizenFixture();
    const NOTE = 'Trader died in April; family says the stall was sold to settle a moneylender.';

    const closed = await post(
      `/taxpayers/${fixture.taxpayerId}/status`,
      { status: 'CLOSED', reason: NOTE },
      { token: fixture.officerToken },
    );
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    // PRECONDITION: the note really is on the record.
    const stored = await queryOne<{ status: string; status_reason: string }>(
      pool,
      'SELECT status, status_reason FROM taxpayers WHERE id = $1',
      [fixture.taxpayerId],
    );
    assert.equal(stored!.status, 'CLOSED');
    assert.equal(stored!.status_reason, NOTE);

    (__rateLimitStore as { reset?: () => void }).reset?.();
    const response = await get(`/citizen-status?phone=${encodeURIComponent(fixture.phone)}`);
    assert.equal(response.status, 200);
    console.log('  citizen-status (closed record) →', JSON.stringify(response.body));

    // The file's own header promises "officer notes are NEVER returned".
    assert.ok(
      !JSON.stringify(response.body).includes(NOTE),
      `an officer's free-text note about a named person was returned to an anonymous caller: ${JSON.stringify(response.body)}`,
    );
  });

  it('4: existence is the answer, and only the rate limit makes it expensive', async () => {
    const fixture = await citizenFixture();

    const present = await get(`/citizen-status?phone=${encodeURIComponent(fixture.phone)}`);
    const absent = await get('/citizen-status?phone=%2B2348039999999');
    assert.equal(present.status, 200);
    assert.equal(absent.status, 200);
    assert.equal(present.body.found, true);
    assert.equal(absent.body.found, false);
    console.log('  citizen-status (absent) →', JSON.stringify(absent.body));

    // How loudly the two differ, measured rather than asserted. The shape
    // already separates them — `found` plus three fields that only appear on a
    // hit — so timing adds nothing an attacker did not already have.
    const time = async (path: string): Promise<number> => {
      const started = process.hrtime.bigint();
      await get(path);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const hits: number[] = [];
    const misses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      (__rateLimitStore as { reset?: () => void }).reset?.();
      hits.push(await time(`/citizen-status?phone=${encodeURIComponent(fixture.phone)}`));
      (__rateLimitStore as { reset?: () => void }).reset?.();
      misses.push(await time('/citizen-status?phone=%2B2348039999998'));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(
      `  timing oracle: hit median ${median(hits).toFixed(1)}ms vs miss median ` +
        `${median(misses).toFixed(1)}ms over ${hits.length} samples each`,
    );
    assert.equal(
      Object.keys(absent.body).length < Object.keys(present.body).length,
      true,
      'the shapes already differ; the oracle is the design, not the timing',
    );

    // Stated rather than discovered: this endpoint is an existence oracle by
    // design. The compensating control is the cap, so the cap is what is
    // tested — 10 per minute per address, and it must actually bite.
    (__rateLimitStore as { reset?: () => void }).reset?.();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const probe = await get(`/citizen-status?phone=%2B23480399999${String(10 + i)}`);
      statuses.push(probe.status);
    }
    assert.equal(statuses.filter((s) => s === 200).length, 10, `statuses: ${statuses.join(',')}`);
    assert.equal(statuses.filter((s) => s === 429).length, 2, `statuses: ${statuses.join(',')}`);

    // And the cap is keyed on the connection, not on a header a caller writes.
    // Express splits X-Forwarded-For on commas, so the value is sent without
    // one and asserted to have made no difference.
    const forged = randomBytes(12).toString('hex');
    assert.ok(!forged.includes(','), 'the forged address must survive Express comma-splitting');
    const stillBlocked = await get(`/citizen-status?phone=%2B2348039999888`, {
      headers: { 'x-forwarded-for': `203.0.113.${forged.slice(0, 2)}` },
    });
    assert.equal(stillBlocked.status, 429, JSON.stringify(stillBlocked.body));
  });

  it('4: a name search hands out a count of matching people', async () => {
    const fixture = await citizenFixture();
    (__rateLimitStore as { reset?: () => void }).reset?.();

    const byName = await get('/citizen-status?name=Danjuma');
    assert.equal(byName.status, 200);
    console.log('  citizen-status?name=  →', JSON.stringify(byName.body));

    // A count is the documented answer; individual data must not be.
    assert.equal(byName.body.found, true);
    assert.equal(typeof byName.body.count, 'number');
    assert.deepEqual(Object.keys(byName.body).sort(), ['count', 'found', 'message']);
    const serialised = JSON.stringify(byName.body);
    assert.ok(!serialised.includes(fixture.phone), 'a name search returned a phone number');
    assert.ok(!serialised.includes(fixture.tin), 'a name search returned a TIN');
  });
});

// ===========================================================================
// ATTACK 5 — web push
// ===========================================================================

/** A browser's own subscription keys, as `pushManager.subscribe()` produces. */
function subscriberKeys(): { p256dh: string; auth: string } {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  return { p256dh: Buffer.from(raw).toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

function testVapid(): void {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  setVapidForTesting({
    publicKey: Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).toString('base64url'),
    privateKey: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' })).toString('base64url'),
    subject: 'mailto:audit@psirs.pl.gov.ng',
  });
}

describe('ATTACK 5 — web push', () => {
  it('5a: delivery is keyed on the signed-in identity, not on what was posted', async () => {
    await reset();
    testVapid();
    const attacker = await seedSecondAgent('+2347099000401', 'attacker-handset-000001');
    const victim = await seedSecondAgent('+2347099000402', 'victim-handset-000001');
    const attackerSession = await loginAs(attacker.phone, 'Password123', attacker.deviceIdentifier);
    const victimSession = await loginAs(victim.phone, 'Password123', victim.deviceIdentifier);
    // PRECONDITION: two distinct agents with two distinct sessions.
    assert.notEqual(attacker.agentId, victim.agentId);
    assert.equal(attackerSession.user.agentId, attacker.agentId);
    assert.equal(victimSession.user.agentId, victim.agentId);

    const attackerEndpoint = `https://fcm.googleapis.com/fcm/send/attacker-${randomUUID()}`;
    const victimEndpoint = `https://fcm.googleapis.com/fcm/send/victim-${randomUUID()}`;

    // THE ATTACK: subscribe naming the victim's ids in the body, in every
    // spelling the route might have trusted.
    const subscribed = await post(
      '/push/subscribe',
      {
        subscription: { endpoint: attackerEndpoint, keys: subscriberKeys() },
        userId: victim.userId,
        agentId: victim.agentId,
        user_id: victim.userId,
        agent_id: victim.agentId,
      },
      { token: attackerSession.accessToken, deviceId: attacker.deviceIdentifier },
    );
    assert.equal(subscribed.status, 200, JSON.stringify(subscribed.body));

    const stored = await queryOne<{ user_id: string; agent_id: string }>(
      pool,
      'SELECT user_id, agent_id FROM push_subscriptions WHERE endpoint = $1',
      [attackerEndpoint],
    );
    assert.ok(stored, 'the subscription must have been stored, or the attack never landed');
    assert.equal(stored!.user_id, attacker.userId, 'the attacker claimed another user id');
    assert.equal(stored!.agent_id, attacker.agentId, 'the attacker claimed another agent id');

    await post(
      '/push/subscribe',
      { subscription: { endpoint: victimEndpoint, keys: subscriberKeys() } },
      { token: victimSession.accessToken, deviceId: victim.deviceIdentifier },
    );

    // And the delivery side: a notification addressed to the victim must reach
    // the victim's handset and no other.
    const reached: string[] = [];
    setPushTransportForTesting(async (subscription) => {
      reached.push(subscription.endpoint);
      return { statusCode: 201 };
    });
    const result = await sendPushNotification(
      { userId: victim.userId },
      { title: 'Commission paid', body: 'Your commission of NGN 12,500 has been paid.' },
    );
    resetPushTransport();

    assert.deepEqual(reached, [victimEndpoint], `the attacker's handset received: ${reached.join(',')}`);
    assert.equal(result.sent, 1);
  });

  it('5a: and a subscribe must not seize an endpoint that is already someone else\'s', async () => {
    await reset();
    testVapid();
    const attacker = await seedSecondAgent('+2347099000403', 'attacker-handset-000002');
    const victim = await seedSecondAgent('+2347099000404', 'victim-handset-000002');
    const attackerSession = await loginAs(attacker.phone, 'Password123', attacker.deviceIdentifier);
    const victimSession = await loginAs(victim.phone, 'Password123', victim.deviceIdentifier);

    const victimEndpoint = `https://fcm.googleapis.com/fcm/send/victim-${randomUUID()}`;
    const victimSubscribe = await post(
      '/push/subscribe',
      { subscription: { endpoint: victimEndpoint, keys: subscriberKeys() } },
      { token: victimSession.accessToken, deviceId: victim.deviceIdentifier },
    );
    assert.equal(victimSubscribe.status, 200);
    // PRECONDITION: the endpoint belongs to the victim before the attack.
    const before = await queryOne<{ user_id: string }>(
      pool,
      'SELECT user_id FROM push_subscriptions WHERE endpoint = $1',
      [victimEndpoint],
    );
    assert.equal(before!.user_id, victim.userId);

    // THE ATTACK: the attacker posts the victim's endpoint as their own. The
    // route checks who is asking; it does not check who already holds the row.
    const seized = await post(
      '/push/subscribe',
      { subscription: { endpoint: victimEndpoint, keys: subscriberKeys() } },
      { token: attackerSession.accessToken, deviceId: attacker.deviceIdentifier },
    );

    const after = await queryOne<{ user_id: string; agent_id: string }>(
      pool,
      'SELECT user_id, agent_id FROM push_subscriptions WHERE endpoint = $1',
      [victimEndpoint],
    );

    // The consequence is measured before anything is asserted, so the failure
    // report carries the impact and not merely the mismatch: does the victim
    // still receive the alert that tells them their account is being moved?
    const reached: string[] = [];
    setPushTransportForTesting(async (subscription) => {
      reached.push(subscription.endpoint);
      return { statusCode: 201 };
    });
    const toVictim = await sendPushNotification(
      { userId: victim.userId },
      { title: 'Your bank account is being changed', body: 'If this was not you, call PSIRS now.' },
    );
    const toAttacker = await sendPushNotification(
      { userId: attacker.userId },
      { title: 'Attacker traffic', body: 'delivered to whichever handset now holds the row' },
    );
    resetPushTransport();
    console.log(
      `  endpoint takeover: subscribe answered ${seized.status}; owner ${before!.user_id} -> ` +
        `${after!.user_id}; victim delivery sent=${toVictim.sent}, attacker delivery sent=` +
        `${toAttacker.sent} to ${reached.length} endpoint(s)`,
    );

    assert.equal(
      after!.user_id,
      victim.userId,
      `an endpoint registered to one person was reassigned to another (subscribe answered ${seized.status}); ` +
        `the victim's own alerts then reached ${toVictim.sent} handset(s)`,
    );
    assert.equal(toVictim.sent, 1, 'the victim was silenced by somebody else subscribing');
  });

  it('5b: the VAPID endpoint serves the public key and nothing else', async () => {
    await reset();
    testVapid();
    const keys = vapidKeys();
    assert.ok(keys, 'the test identity must be configured');

    const response = await get('/push/vapid-key');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    console.log('  push/vapid-key →', JSON.stringify(response.body));

    assert.deepEqual(Object.keys(response.body), ['publicKey']);
    const serialised = JSON.stringify(response.body);
    assert.ok(!serialised.includes(keys!.privateKey), 'the private key was served');
    assert.ok(!serialised.includes(keys!.subject), 'the contact address was served');
    assert.ok(!/private|secret|subject/i.test(serialised), `unexpected field: ${serialised}`);

    // It is the raw uncompressed P-256 point a browser can actually subscribe
    // with, and it is exactly the public half — nothing longer.
    const raw = Buffer.from(response.body.publicKey, 'base64url');
    assert.equal(raw.length, 65);
    assert.equal(raw[0], 0x04);
    assert.equal(response.body.publicKey, keys!.publicKey);

    // With no identity at all it must refuse rather than invent one.
    clearVapidForTesting();
    const unconfigured = await get('/push/vapid-key');
    assert.equal(unconfigured.status, 503, JSON.stringify(unconfigured.body));
    assert.ok(
      !JSON.stringify(unconfigured.body).includes('BN-mock'),
      'a placeholder key was served',
    );
    testVapid();
  });

  it('5c: a subscription endpoint pointing at an internal address is refused', async () => {
    await reset();
    testVapid();
    const caller = await seedSecondAgent('+2347099000405', 'ssrf-handset-000001');
    const session = await loginAs(caller.phone, 'Password123', caller.deviceIdentifier);

    const targets = [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'https://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:4000/api/v1/government/approvals',
      'https://10.0.0.5:8443/internal',
      'http://[::1]:5432/',
      'https://attacker.example.net/collect',
    ];

    const accepted: string[] = [];
    for (const endpoint of targets) {
      const response = await post(
        '/push/subscribe',
        { subscription: { endpoint, keys: subscriberKeys() } },
        { token: session.accessToken, deviceId: caller.deviceIdentifier },
      );
      if (response.status === 200) accepted.push(endpoint);
    }

    assert.deepEqual(
      accepted,
      [],
      `the subscription store accepted endpoints the server will later POST to: ${accepted.join(', ')}`,
    );
  });

  it('5c: and the server really does dial whatever address it was given', async () => {
    await reset();
    testVapid();
    const caller = await seedSecondAgent('+2347099000406', 'ssrf-handset-000002');

    // A listener standing in for an internal service. It answers nothing; the
    // fact of the connection is the whole finding.
    const seen: string[] = [];
    const listener: NetServer = createServer((socket) => {
      seen.push(`${socket.remoteAddress}`);
      socket.destroy();
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', () => resolve()));
    const port = (listener.address() as { port: number }).port;

    /*
     * The outbound proxy has to come off for this to be a test of the platform
     * rather than of the proxy: `push.ts` prefers PUSH_PROXY_URL, then
     * HTTPS_PROXY, and with either set every request goes to the proxy
     * whatever the endpoint says.
     */
    const savedProxy = process.env.HTTPS_PROXY;
    const savedPushProxy = process.env.PUSH_PROXY_URL;
    delete process.env.HTTPS_PROXY;
    delete process.env.PUSH_PROXY_URL;

    try {
      resetPushTransport(); // the real web-push transport, not a stub
      const endpoint = `https://127.0.0.1:${port}/push/${randomUUID()}`;

      // Through the front door, with nothing but an ordinary agent session.
      const session = await loginAs(caller.phone, 'Password123', caller.deviceIdentifier);
      const subscribed = await post(
        '/push/subscribe',
        { subscription: { endpoint, keys: subscriberKeys() } },
        { token: session.accessToken, deviceId: caller.deviceIdentifier },
      );
      assert.equal(subscribed.status, 200, JSON.stringify(subscribed.body));

      // PRECONDITION: the row is stored and will be selected for this user.
      const stored = await queryOne<{ endpoint: string }>(
        pool,
        'SELECT endpoint FROM push_subscriptions WHERE user_id = $1 AND expired_at IS NULL',
        [caller.userId],
      );
      assert.equal(stored!.endpoint, endpoint, 'the attacker-chosen endpoint must be stored');

      await sendPushNotification(
        { userId: caller.userId },
        { title: 'PSIRS', body: 'ssrf probe' },
      );
      const overTls = seen.length;

      /*
       * And again over plain http://. `web-push` builds every request with
       * `https.request` and takes only the hostname, port and path from the
       * endpoint, so the scheme is discarded — a filter that only rejected
       * `http:` would not be what stopped this.
       */
      await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [caller.userId]);
      const plain = `http://127.0.0.1:${port}/push/${randomUUID()}`;
      await saveSubscription(
        { endpoint: plain, keys: subscriberKeys() },
        { userId: caller.userId, agentId: caller.agentId },
      );
      await sendPushNotification({ userId: caller.userId }, { title: 'PSIRS', body: 'ssrf probe 2' });
      console.log(
        `  ssrf: ${overTls} connection(s) from an https:// endpoint, ` +
          `${seen.length - overTls} from an http:// one, to 127.0.0.1:${port}`,
      );

      assert.deepEqual(
        seen,
        [],
        `the API opened ${seen.length} connection(s) to an address supplied in a subscription ` +
          `(127.0.0.1:${port}); an unvalidated push endpoint is a server-side request forgery`,
      );
    } finally {
      if (savedProxy !== undefined) process.env.HTTPS_PROXY = savedProxy;
      if (savedPushProxy !== undefined) process.env.PUSH_PROXY_URL = savedPushProxy;
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  it('5: unsubscribing somebody else\'s handset is refused', async () => {
    await reset();
    testVapid();
    const attacker = await seedSecondAgent('+2347099000407', 'attacker-handset-000003');
    const victim = await seedSecondAgent('+2347099000408', 'victim-handset-000003');
    const attackerSession = await loginAs(attacker.phone, 'Password123', attacker.deviceIdentifier);

    const victimEndpoint = `https://fcm.googleapis.com/fcm/send/victim-${randomUUID()}`;
    await saveSubscription(
      { endpoint: victimEndpoint, keys: subscriberKeys() },
      { userId: victim.userId, agentId: victim.agentId },
    );

    const response = await post(
      '/push/unsubscribe',
      { endpoint: victimEndpoint },
      { token: attackerSession.accessToken, deviceId: attacker.deviceIdentifier },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const row = await queryOne<{ expired_at: Date | null }>(
      pool,
      'SELECT expired_at FROM push_subscriptions WHERE endpoint = $1',
      [victimEndpoint],
    );
    assert.equal(row!.expired_at, null, 'one person unsubscribed another person\'s handset');
  });
});
