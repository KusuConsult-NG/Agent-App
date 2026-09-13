/**
 * The migration count in the acceptance walkthrough, held to the migrations.
 *
 * `docs/UAT-WALKTHROUGH.md` is what somebody follows to accept this platform.
 * Its second step says the harness "applies all N migrations and seeds the
 * reference data: 17 LGAs, 187 wards, 9 revenue categories, 42 revenue items,
 * 12 training modules, 73 notification templates".
 *
 * All seven figures were checked against a database created for the purpose,
 * migrated and seeded from nothing. Six were right. The migration count was
 * not, and it had drifted twice — the second time by this branch's own hand,
 * which added two migrations for the notification work and left the sentence
 * saying 78.
 *
 * WHY ONLY ONE OF THE SEVEN IS CHECKED HERE
 *
 * The other six are counts of seeded rows, and the honest place to count them
 * is a database built from nothing. The suite's databases are not that: they
 * live across runs, `resetDatabase` truncates the transactional tables and
 * leaves reference data behind, and `schema_migrations` keeps every row it has
 * ever had. Asked of a test database this morning they answered 87 migrations
 * and 74 notification templates — neither a fact about the platform, both
 * facts about a database that has been used.
 *
 * A guard reporting those numbers would fail for reasons that are not defects,
 * and a guard that cries wolf is deleted by the third person it interrupts. So
 * the six are verified by hand, once, and recorded as verified; and the one
 * that actually drifts is held mechanically, against the files, which needs no
 * database and cannot drift for a reason that is not real.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

describe('what the walkthrough counts', () => {
  it('is the number of migrations this repository ships', () => {
    const root = workspaceRoot();
    const walkthrough = readFileSync(join(root, 'docs', 'UAT-WALKTHROUGH.md'), 'utf8');

    const match = walkthrough.match(/applies all (\d+) migrations/);
    assert.ok(
      match,
      'UAT-WALKTHROUGH.md no longer says how many migrations the harness applies; ' +
        'if that sentence was rewritten, this check needs rewriting with it',
    );

    const shipped = readdirSync(join(root, 'apps/api/src/db/migrations')).filter((name) =>
      name.endsWith('.sql'),
    ).length;

    // A floor as well as the equality: a directory read that returned nothing
    // would otherwise only need the document to say 0.
    assert.ok(shipped > 50, `only ${shipped} migration files found; has the directory moved?`);

    assert.equal(
      Number(match[1]),
      shipped,
      `the walkthrough says the harness applies ${match[1]} migrations and this repository ` +
        `ships ${shipped}. Somebody accepting the platform counts what they were told to expect.`,
    );
  });
});
