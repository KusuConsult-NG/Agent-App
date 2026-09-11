/**
 * What a deployment's database actually grants, as opposed to what the code says.
 *
 * `a-map-that-moved.test.ts` already asserts that every role holds precisely
 * what `ROLE_PERMISSIONS` grants it, in both directions, by name. It passes
 * whatever is true, because it cannot fail: `role_permissions` is in
 * `TRANSACTIONAL_TABLES`, so `resetDatabase()` empties it before every file,
 * and `seedReferenceData()` then reaches the one branch of `seedRoles()` that
 * inserts — the one guarded by the role holding nothing:
 *
 *     if (Number(held!.count) > 0) continue;
 *
 * So the table is refilled from the compiled map, and an assertion comparing
 * the table to the compiled map compares the map with itself.
 *
 * A deployment goes the other way. Migration 059 fills `role_permissions`, the
 * seed then finds rows and skips, and a permission added to the map afterwards
 * never arrives. Eight had gone in that way before migration 067 —
 * `data:export` for all five officer roles and `audit:sample`, `audit:report`
 * and `audit:sign` for the auditor — so no officer could export anything and
 * the audit workbench could not be reached by the only role meant to reach it.
 * Every test passed throughout, because no test had ever run that path.
 *
 * This one does: a scratch database, migrated and seeded the way a deployment
 * is, compared against the compiled map. It is the slowest test in the suite by
 * some way, and it is the only one that answers the question.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ROLE_PERMISSIONS, ROLES } from '@psirs/shared';
import { NOTIFICATION_TEMPLATES } from '../db/seed';

/*
 * A database of its own, because the point is the starting state.
 *
 * Reusing a shard database would defeat the test: those have been through
 * `resetDatabase()`, which is exactly the path being avoided here.
 */
const SCRATCH = `psirs_grants_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/postgres';
  return url.toString();
}

function scratchUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${SCRATCH}`;
  return url.toString();
}

async function withAdmin<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  const admin = new Pool({ connectionString: adminUrl() });
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
}

describe('the grants a migration leaves behind', () => {
  let scratch: Pool;

  before(async () => {
    await withAdmin(async (admin) => {
      await admin.query(`CREATE DATABASE "${SCRATCH}"`);
    });

    /*
     * Migrate and seed as separate child processes, the way CI and a deployment
     * do, rather than by calling the functions in this process. Both read
     * configuration at import time from `DATABASE_URL`, and this process is
     * already pointed at a shard database.
     */
    for (const script of ['src/db/migrate.ts', 'src/db/seed.ts']) {
      const run = spawnSync('npx', ['tsx', script], {
        env: { ...process.env, DATABASE_URL: scratchUrl() },
        encoding: 'utf8',
      });
      assert.equal(
        run.status,
        0,
        `${script} failed against the scratch database:\n${run.stdout}\n${run.stderr}`,
      );
    }

    scratch = new Pool({ connectionString: scratchUrl() });
  });

  after(async () => {
    await scratch?.end();
    await withAdmin(async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`);
    });
  });

  /*
   * Both directions, by name.
   *
   * Missing is the failure that shipped: capability the code believes it has
   * and the deployment refuses. Extra is the other one, and worse — a
   * deployment granting something the code never meant to give away, which is a
   * privilege escalation nobody would find by reading either side alone.
   */
  it('grants each shipped role exactly what the compiled map grants it', async () => {
    for (const role of ROLES) {
      const compiled = [...(ROLE_PERMISSIONS[role] as readonly string[])].sort();
      const { rows } = await scratch.query<{ permission: string }>(
        'SELECT permission FROM role_permissions WHERE role = $1 ORDER BY permission',
        [role],
      );
      const stored = rows.map((row) => row.permission);

      const missing = compiled.filter((permission) => !stored.includes(permission));
      const extra = stored.filter((permission) => !compiled.includes(permission));

      assert.deepEqual(
        missing,
        [],
        `${role} cannot do what the code says it can: a migrated and seeded ` +
          `database does not grant ${missing.join(', ')}. A permission added to ` +
          'ROLE_PERMISSIONS needs a migration granting it, because seedRoles() ' +
          'skips any role that already holds something.',
      );
      assert.deepEqual(
        extra,
        [],
        `${role} is granted ${extra.join(', ')} by the database and not by the code.`,
      );
    }
  });

  /*
   * The same question about the other reference data a migration also writes.
   *
   * Forty of the sixty templates the seed list names are also inserted by a
   * migration, and the seed inserts `ON CONFLICT DO NOTHING`. For those forty
   * the migration's row is the one a clean install ends up with, so editing the
   * wording in seed.ts alone changes nothing anywhere. That is not
   * hypothetical: migration 042 exists purely to carry one corrected body to
   * databases the seed could no longer reach, and PR #70 had to do the same for
   * revenue item names.
   *
   * They agree today. This is here so they stay agreeing, and it costs one
   * query on a scratch database the test above has already paid for.
   *
   * `incentive_programmes` is deliberately not checked the same way: no
   * migration inserts into it, so the seed always wins and the assertion could
   * not fail. A check that cannot fail is what put the eight missing grants
   * into production in the first place.
   */
  it('holds the notification templates the seed list actually specifies', async () => {
    const { rows } = await scratch.query<{ code: string; subject: string | null; body: string }>(
      'SELECT code, subject, body FROM notification_templates',
    );
    const stored = new Map(rows.map((row) => [row.code, row]));

    for (const template of NOTIFICATION_TEMPLATES) {
      const row = stored.get(template.code);
      assert.ok(row, `no template ${template.code} on a migrated and seeded database`);
      assert.equal(
        row!.body,
        template.body,
        `${template.code} reads differently in the database than in the seed list. ` +
          'A template inserted by a migration wins over the seed, so changing the ' +
          'wording here needs a migration carrying it, as migration 042 does.',
      );
      assert.equal(
        row!.subject ?? null,
        template.subject ?? null,
        `${template.code} has a different subject in the database than in the seed list.`,
      );
    }
  });

});
