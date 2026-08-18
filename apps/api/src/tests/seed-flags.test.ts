/**
 * `--demo-agent` produces a demo agent.
 *
 * It used to be `demo && argv.includes('--demo-agent')`, so asking for the
 * agent without also asking for the officers seeded the catalogue, printed
 * "Seed complete" and created no users at all — while saying nothing about the
 * flag it had just discarded. The next thing that happens is a sign-in
 * answered "Phone number or password is incorrect", which sends the operator
 * looking at their password rather than at the seed that never ran.
 *
 * The dependency is real — the agent is walked through the clearance pipeline
 * and that pipeline needs an officer to approve the application — so the fix
 * is to apply the implied flag and say so, not to drop the request.
 *
 * This test runs the seed the way an operator does: as the command, with the
 * flag, against a real database.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { query } from '../db/pool';

const SEED = join(__dirname, '..', 'db', 'seed.ts');

function runSeed(...flags: string[]): string {
  return execFileSync('npx', ['tsx', SEED, ...flags], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('Seeding with --demo-agent', () => {
  it('creates the agent, without being asked for --demo as well', async () => {
    const output = runSeed('--demo-agent');

    const users = await query<{ phone: string; role: string }>(
      pool,
      'SELECT phone, role FROM users ORDER BY role',
    );
    const agent = users.find((user) => user.role === 'agent');

    assert.ok(
      agent,
      'no agent was created — the flag was accepted and quietly discarded, and ' +
        `the seed still reported success:\n${output}`,
    );
    assert.equal(agent!.phone, '+2347010000001');
  });

  it('creates the officers the clearance pipeline needs, and says why', () => {
    const output = runSeed('--demo-agent');
    assert.match(
      output,
      /--demo has been applied as well/,
      'applying an implied flag silently is how the last confusion started',
    );
  });

  it('leaves an agent out when nobody asked for one', async () => {
    runSeed('--demo');
    const agents = await query(pool, 'SELECT id FROM agents');
    assert.equal(agents.length, 0, '--demo alone must not walk the clearance pipeline');
  });

  it('prints credentials that actually work', async () => {
    // The output is what an operator types next; if it names an account the
    // seed did not create, they meet "Phone number or password is incorrect".
    const output = runSeed('--demo-agent');
    const printed = [...output.matchAll(/(\+234\d{10})\s+password:\s+(\S+)/g)].map((m) => ({
      phone: m[1]!,
      password: m[2]!,
    }));
    assert.ok(printed.length >= 6, `expected the printed sign-ins, got ${printed.length}`);

    const users = await query<{ phone: string }>(pool, 'SELECT phone FROM users');
    const known = new Set(users.map((user) => user.phone));
    for (const account of printed) {
      assert.ok(known.has(account.phone), `${account.phone} was printed but never created`);
    }
  });
});
