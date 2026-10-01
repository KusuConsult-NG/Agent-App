/**
 * A pool with no limit on waiting, and a sign-in that spun for two minutes.
 *
 * Found on a real deployment, from a proxy log rather than this service's:
 *
 *     upstream timed out (110: Operation timed out) while reading response
 *     header from upstream, request: "POST /api/v1/auth/login" -> 504
 *
 * The proxy had reached the API. The API never answered. Its own log showed
 * only background jobs failing:
 *
 *     (EMAXCONNSESSION) max clients reached in session mode - max clients are
 *     limited to pool_size: 15
 *
 * Two instances of this API, each with `DB_POOL_SIZE` at its default of 10,
 * against a hosted pooler allowing 15 clients in session mode, plus fifteen
 * scheduled jobs each taking a connection. Exhausted.
 *
 * WHY IT WAS SO HARD TO SEE, WHICH IS THE PART WORTH FIXING
 *
 * `pg` waits for ever for a connection by default. A request that cannot get
 * one does not fail — it stops. Nothing is logged, because nothing has gone
 * wrong yet. The background jobs logged because they have their own timeout;
 * the web requests were still waiting when the proxy gave up on them. So the
 * only visible artefact pointed at the proxy, and the cause was in the
 * database layer two services away.
 *
 * Bounded, the same exhaustion answers in seconds and says "database". That
 * is the whole of this change: it does not add a connection, it makes the
 * absence of one legible.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config';

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

const ROOT = workspaceRoot();

describe('waiting for a database connection', () => {
  it('is bounded, so an exhausted pool fails rather than hangs', () => {
    assert.ok(
      config.database.connectionTimeoutMs > 0,
      'config.database.connectionTimeoutMs is not set. Unbounded, a request ' +
        'that cannot get a connection waits for ever: nothing is logged here ' +
        'and a sign-in spins until a proxy answers 504',
    );
  });

  it('is long enough that a healthy pool under load never reaches it', () => {
    // A bound so tight it fires in normal operation would turn a slow moment
    // into an outage, which is the opposite of the point.
    assert.ok(
      config.database.connectionTimeoutMs >= 5_000,
      `connectionTimeoutMs is ${config.database.connectionTimeoutMs}ms, which a ` +
        'busy pool can hit legitimately',
    );
  });

  it('is actually given to the pool, not merely configured', () => {
    /*
     * The gap this closes: a setting that exists in config and is never read
     * is indistinguishable from the bug. `pg` names it
     * `connectionTimeoutMillis`, which is close enough to the config key to
     * be dropped in a rename without anything noticing.
     */
    const source = readFileSync(join(ROOT, 'apps/api/src/db/pool.ts'), 'utf8');
    assert.match(
      source,
      /connectionTimeoutMillis:\s*config\.database\.connectionTimeoutMs/,
      'db/pool.ts does not pass connectionTimeoutMs to the Pool as ' +
        'connectionTimeoutMillis, so the bound is configured and not applied',
    );
  });
});

describe('a session-mode pooler', () => {
  it('is named at boot, because the symptom points somewhere else', () => {
    /*
     * Not a refusal — the deployment may have a pooler sized for it, and this
     * cannot know. But it must not be silent: the observable failure was a
     * 504 from the proxy, and nothing anywhere said "database".
     */
    const source = readFileSync(join(ROOT, 'apps/api/src/server.ts'), 'utf8');

    // A plain substring rather than a regex: the thing being looked for is
    // itself a regex literal in the source, and escaping one inside the other
    // is how the first draft of this test failed for its own reasons.
    assert.ok(
      source.includes('pooler\\.supabase\\.com:5432'),
      'server.ts no longer recognises a session-mode pooler URL, so a ' +
        'deployment whose client limit is smaller than its pool size gets no ' +
        'warning and the next person debugs it from the proxy log again',
    );
    assert.match(
      source,
      /6543/,
      'the warning no longer names the transaction-mode port, which is the ' +
        'remedy — a warning without one is just noise',
    );
  });
});
