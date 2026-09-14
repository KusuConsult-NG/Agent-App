/**
 * Backup and restore, exercised rather than described.
 *
 * A backup nobody has restored is a rumour, and a restore script nobody runs
 * rots quietly until the day it is needed. So this drives the real scripts
 * against a real database: take a database the application itself has filled
 * with a verified payment, dump it, restore it into an empty database, and then
 * check the things that actually matter.
 *
 * "What matters" is not that `pg_restore` exited 0. It is that the receipt came
 * back byte for byte, and that the restored database still refuses a receipt
 * with no verified payment. On this platform the financial controls *are* the
 * schema, so a restore that brought the tables but not the triggers would look
 * like a successful recovery and would leave a revenue platform with nothing
 * enforcing its rules.
 *
 * The data is created through the ordinary application path rather than by
 * hand-written fixture SQL, so what gets dumped is the shape production
 * produces — and every row in it had to satisfy the same triggers.
 *
 * Skips itself when the PostgreSQL client tools are absent, which is an
 * environment gap rather than a defect.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  post,
  settleTransaction,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const SCRIPTS = join(__dirname, '..', '..', 'scripts');
const ADMIN_URL = 'postgres://postgres:postgres@localhost:5432/postgres';
const SOURCE_URL = process.env.DATABASE_URL!;
const RESTORE_DB = 'psirs_restore_target_test';
const RESTORE_URL = `postgres://postgres:postgres@localhost:5432/${RESTORE_DB}`;
const AGENT_DEVICE = 'demo-agent-device-000001';

function have(command: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const toolsPresent = have('pg_dump') && have('pg_restore') && have('psql');

let workDir = '';
let admin: Pool;

before(async () => {
  if (!toolsPresent) return;
  workDir = mkdtempSync(join(tmpdir(), 'psirs-backup-'));
  admin = new Pool({ connectionString: ADMIN_URL });
  await startTestServer();
});

after(async () => {
  if (!toolsPresent) return;
  await admin?.query(`DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)`).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  await stopTestServer();
});

function run(script: string, args: string[], env: Record<string, string>): string {
  return execFileSync('bash', [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, PGPASSWORD: 'postgres', ...env },
  });
}

/** One complete revenue collection, driven through the real application. */
async function collectRealRevenue(): Promise<{ receiptNumber: string; verificationCode: string }> {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'DR Admin', phone: '+2348000000001', role: 'admin' });

  const agent = await seedDemoAgent();
  assert.ok(agent, 'the demo agent should seed');
  const session = await loginAs(agent!.phone, agent!.password, AGENT_DEVICE);

  const lgaId = await firstLgaId();
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Disaster',
      lastName: 'Recovery',
      phone: '+2349088800001',
      gender: 'UNSPECIFIED',
      lgaId,
      address: '1 Recovery Road, Jos',
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: session.accessToken, deviceId: AGENT_DEVICE },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode('MARKET-LEVY'),
      inputs: {},
    },
    { token: session.accessToken, deviceId: AGENT_DEVICE },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  const initiation = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId, paymentMethod: 'CARD' },
    { token: session.accessToken, deviceId: AGENT_DEVICE, idempotencyKey: `dr-${Date.now()}` },
  );
  assert.equal(initiation.status, 201, JSON.stringify(initiation.body));

  const simulated = await post(
    '/payments/simulate',
    { gatewayReference: initiation.body.gatewayReference, outcome: 'SUCCESS' },
    { token: session.accessToken, deviceId: AGENT_DEVICE },
  );
  assert.equal(simulated.status, 200, JSON.stringify(simulated.body));
  // A receipt exists once the money has reached a government account, so the
  // fixture settles the collection before asking for one to back up.
  await settleTransaction(assessment.body.transactionId);

  const source = new Pool({ connectionString: SOURCE_URL });
  try {
    const receipt = await source.query<{ receipt_number: string; verification_code: string }>(
      'SELECT receipt_number, verification_code FROM receipts LIMIT 1',
    );
    assert.equal(receipt.rows.length, 1, 'a receipt should exist to be backed up');
    return {
      receiptNumber: receipt.rows[0].receipt_number,
      verificationCode: receipt.rows[0].verification_code,
    };
  } finally {
    await source.end();
  }
}

describe(
  'Backup and restore',
  { skip: !toolsPresent && 'PostgreSQL client tools are not installed' },
  () => {
    it('dumps, verifies, restores into an empty database, and keeps the controls', async () => {
      const expected = await collectRealRevenue();

      // ---- back up -----------------------------------------------------
      const backupOutput = run('backup.sh', [], { DATABASE_URL: SOURCE_URL, BACKUP_DIR: workDir });
      assert.match(backupOutput, /verifying archive is readable/);
      assert.match(backupOutput, /backup: done/);
      // It must say plainly that a local-only dump is not a backup.
      assert.match(backupOutput, /local only, which is not a backup/);

      const archives = readdirSync(workDir).filter((f) => f.endsWith('.dump'));
      assert.ok(archives.length >= 1, 'an archive should have been written');
      const archive = join(workDir, archives.sort()[archives.length - 1]);

      const manifest = JSON.parse(readFileSync(`${archive}.manifest.json`, 'utf8'));
      assert.equal(manifest.verified, true);
      assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
      assert.ok(manifest.bytes > 0);

      // ---- restore into a database that starts with nothing in it -------
      await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${RESTORE_DB}`);

      const empty = new Pool({ connectionString: RESTORE_URL });
      try {
        const before = await empty.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public'`,
        );
        assert.equal(before.rows[0].n, '0', 'the restore target must genuinely be empty');
      } finally {
        await empty.end();
      }

      const restoreOutput = run('restore.sh', [archive], { RESTORE_TARGET_URL: RESTORE_URL });
      assert.match(restoreOutput, /checksum matches the manifest/);
      assert.match(restoreOutput, /central control verified/);
      assert.match(restoreOutput, /restore: complete and verified/);

      // ---- verify, independently of what the script reported ------------
      const restored = new Pool({ connectionString: RESTORE_URL });
      try {
        const receipt = await restored.query<{
          receipt_number: string;
          verification_code: string;
          amount_kobo: string;
        }>('SELECT receipt_number, verification_code, amount_kobo FROM receipts');

        assert.equal(receipt.rows.length, 1, 'the receipt must come back');
        assert.equal(receipt.rows[0].receipt_number, expected.receiptNumber);
        assert.equal(receipt.rows[0].verification_code, expected.verificationCode);

        // The whole financial chain, not just the receipt.
        const counts = await restored.query<{
          transactions: string;
          payments: string;
          commissions: string;
          audit: string;
        }>(`SELECT (SELECT count(*)::text FROM transactions)  AS transactions,
                   (SELECT count(*)::text FROM payments)      AS payments,
                   (SELECT count(*)::text FROM commissions)   AS commissions,
                   (SELECT count(*)::text FROM audit_logs)    AS audit`);
        assert.equal(counts.rows[0].transactions, '1');
        assert.equal(counts.rows[0].payments, '1');
        assert.equal(counts.rows[0].commissions, '1');
        assert.ok(
          Number(counts.rows[0].audit) > 0,
          'the audit trail is not something a restore may quietly drop',
        );

        // The rule that makes the data trustworthy must have come back too.
        await assert.rejects(
          restored.query(`
            INSERT INTO receipts (receipt_number, transaction_id, payment_id, taxpayer_id,
                                  amount_kobo, verification_code)
            SELECT 'POST-RESTORE-FORGERY', t.id, p.id, t.taxpayer_id, 999999, 'FORGEDAFTER'
              FROM transactions t JOIN payments p ON p.transaction_id = t.id LIMIT 1
          `),
          /does not match (verified )?payment amount/,
          'a restored database that accepts a forged receipt is not a recovered platform',
        );
      } finally {
        await restored.end();
      }
    });

    it('refuses an archive whose checksum does not match its manifest', async () => {
      const backupOutput = run('backup.sh', [], { DATABASE_URL: SOURCE_URL, BACKUP_DIR: workDir });
      assert.match(backupOutput, /backup: done/);

      const archives = readdirSync(workDir).filter((f) => f.endsWith('.dump')).sort();
      const archive = join(workDir, archives[archives.length - 1]);

      // Corrupt the archive after the manifest was written — which is what
      // bit-rot or a truncated transfer looks like.
      execFileSync('bash', ['-c', `printf 'corruption' >> ${JSON.stringify(archive)}`]);

      await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${RESTORE_DB}`);

      let refused = false;
      let output = '';
      try {
        run('restore.sh', [archive], { RESTORE_TARGET_URL: RESTORE_URL });
      } catch (error) {
        refused = true;
        const e = error as { stdout?: string; stderr?: string };
        output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }

      assert.ok(refused, 'a corrupted archive must not be restored');
      assert.match(output, /checksum mismatch/);
    });
  },
);
