/**
 * A production deployment must not boot on a secret anybody can read.
 *
 * `config.ts` has always said, in its first paragraph, that production
 * "refuses to start if a security-critical secret is missing or left at a
 * development default". It implemented the first half. `secret()` asked
 * whether the value was at least 32 characters, and every placeholder this
 * repository publishes is padded past 32 characters so that it passes.
 *
 * `docker-compose.yml` then set `NODE_ENV: production` and supplied three of
 * them as `${VAR:-<placeholder>}` defaults, so `docker compose up` with no
 * `.env` beside it started a production-mode platform signing its tokens with
 * a key printed in this repository. A known signing key is not a weak one: it
 * mints an access token for any role, for anybody who can read a git history.
 *
 * Two properties, and the second is the one that lasts. The first is that the
 * check refuses those values. The second is that the list cannot fall behind
 * the files it is a list *of* — a placeholder added to a workflow next year,
 * and not added here, would be exactly as reachable and exactly as invisible.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { PUBLISHED_SECRETS } from '../config';

/** The repository root, found by walking up to the workspace manifest. */
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

/**
 * Everything in the repository that sets one of these by hand.
 *
 * `.env` and `.env.local` are deliberately absent: they are git-ignored, so
 * whatever an operator keeps there is theirs and is not published by us.
 */
const FILES = [
  'docker-compose.yml',
  '.env.production.example',
  'scripts/uat/stack.sh',
  'scripts/browser-test.sh',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/integration-verification.yml',
];

const NAMES = ['JWT_SECRET', 'IDENTITY_HASH_SECRET', 'PAYMENT_WEBHOOK_SECRET'];

/**
 * The literal a file assigns to one of those names, in any of the four shapes
 * this repository writes: `NAME: value`, `NAME=value`, `NAME="value"`, and
 * compose's `${NAME:-value}` default.
 */
function publishedIn(text: string): { name: string; value: string }[] {
  const found: { name: string; value: string }[] = [];
  for (const name of NAMES) {
    /*
     * `[ \t]*`, not `\\s*`, on both sides of the separator.
     *
     * With `\\s*` the match crossed a newline, so an empty assignment took the
     * next line as its value: `.env.example` writes `PAYMENT_WEBHOOK_SECRET=`
     * on one line and `ACCESS_TOKEN_TTL_SECONDS` on the next, and the scan
     * reported the variable name as a published secret. None of the files in
     * `FILES` leaves one empty, so nothing surfaced it until the walk below
     * started reading files that do — a guard finding a bug in the guard.
     */
    const pattern = new RegExp(
      `${name}[ \\t]*(?::-|[:=])[ \\t]*["']?([A-Za-z0-9_.:\\-]{8,})["']?`,
      'g',
    );
    for (const match of text.matchAll(pattern)) {
      const value = match[1]!;
      // `JWT_SECRET: ${JWT_SECRET:-...}` matches twice; the outer capture is
      // the variable reference, which is not a value anybody deploys.
      if (NAMES.includes(value)) continue;
      found.push({ name, value });
    }
  }
  return found;
}

describe('a secret this repository publishes', () => {
  it('is listed, for every file that sets one', () => {
    const root = workspaceRoot();
    const missing: string[] = [];
    let seen = 0;

    for (const file of FILES) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const { name, value } of publishedIn(text)) {
        seen += 1;
        if (!PUBLISHED_SECRETS.has(value)) missing.push(`${file}: ${name} = ${value}`);
      }
    }

    /*
     * The scan finding nothing would pass this silently, which is the way a
     * guard like this dies: a regex that stops matching is indistinguishable
     * from a repository that stopped publishing secrets.
     *
     * A floor rather than the exact number. Files legitimately stop setting
     * these — docker-compose.yml did, in the commit that added this test, and
     * an exact count would have failed for the right change.
     */
    assert.ok(seen >= 12, `the scan found only ${seen} assignments; has the pattern stopped matching?`);
    assert.deepEqual(
      missing,
      [],
      'these are set in the repository and would be accepted by a production boot:\n  ' +
        missing.join('\n  '),
    );
  });

  it('is set by no file this list does not name', () => {
    /*
     * THE LIST ABOVE IS ITSELF A LIST THAT CAN FALL BEHIND.
     *
     * The header of this file promises that "the list cannot fall behind the
     * files it is a list *of*", and the test above delivers that for
     * `PUBLISHED_SECRETS` against `FILES`. `FILES` is seven paths somebody
     * typed. A new workflow, a second compose file, another example env — any
     * of them could publish a placeholder and neither list would notice,
     * which is the same failure one level up.
     *
     * So the tree is walked and every file that assigns one of these names
     * must be one this test already reads. Naming them explicitly above is
     * still worth it: the list says which files are *expected* to carry a
     * placeholder, and this says nothing else does.
     */
    const root = workspaceRoot();
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);
    /*
     * `.env` and `.env.local` are git-ignored, and the note above `FILES` says
     * why they are out of scope: whatever an operator keeps there is theirs
     * and is not published by this repository. Walking the tree reaches them
     * anyway, so the rule has to be repeated here rather than assumed.
     */
    const NOT_OURS = new Set(['.env', '.env.local']);
    const listed = new Set(FILES);
    const unlisted: string[] = [];

    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        // Binary and bulk files cannot set an environment variable, and
        // reading them would make this walk the slowest test in the suite.
        if (!/\.(ya?ml|sh|env|example|json|ts|tsx|js|mjs|md|toml|ini|conf|Dockerfile)$/i.test(entry.name)
          && !/^(Dockerfile|\.env)/.test(entry.name)) {
          continue;
        }
        const path = relative(root, full).split(sep).join('/');
        if (listed.has(path) || NOT_OURS.has(path)) continue;

        // This file quotes the names it looks for, and `config.ts` holds the
        // values; neither assigns one, so neither matches the pattern — but
        // both are skipped explicitly so that a future edit to either cannot
        // turn this test into a report about itself.
        if (path.endsWith('a-secret-this-repository-publishes.test.ts')) continue;
        if (path.endsWith('apps/api/src/config.ts')) continue;

        let text: string;
        try {
          text = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        for (const { name, value } of publishedIn(text)) {
          unlisted.push(`${path}: ${name} = ${value}`);
        }
      }
    };
    walk(root);

    assert.deepEqual(
      unlisted,
      [],
      'these publish a secret and are not among the files this test reads, so ' +
        'nothing was checking them:\n  ' + unlisted.join('\n  '),
    );
  });

  it('is refused by the check that says it refuses one', () => {
    // `secret()` is not exported, and importing config twice under a different
    // NODE_ENV is not possible in one process. The property under test is the
    // membership the production branch consults, which is this.
    for (const value of [
      'psirs_development_secret_key_minimum_32_characters_long_12345',
      'psirs_identity_hash_secret_minimum_32_chars_12345',
      'psirs_payment_webhook_secret_minimum_32_chars',
    ]) {
      assert.ok(
        PUBLISHED_SECRETS.has(value),
        `${value} is a docker-compose default and must never pass a production boot`,
      );
      assert.ok(value.length >= 32, 'and it is long enough that only a list would catch it');
    }
  });
});
