/**
 * An applied migration has to still be in the repository.
 *
 * `migrate.ts` holds an applied migration to its contents: change the file and
 * the checksum no longer matches and the runner refuses, because "applied
 * migrations are immutable". Nothing held one to *existing*. The loop walks
 * the files on disk, so a row in `schema_migrations` naming a file that has
 * been deleted or renamed was never visited and never mentioned — measured on
 * a scratch database, the runner answered "schema is up to date" and exited 0
 * with a migration recorded that nobody could produce.
 *
 * It was not hypothetical. `psirs_test` and all four shard databases held 85
 * applied migrations against 78 files, because seven were renumbered from
 * 055-061 to 068-074 when another branch took those ordinals first. Both
 * halves of that were silent: the old rows named files nobody had, and the
 * files under their new names looked unapplied and were applied a second time.
 * That it did no damage is because those files are `IF NOT EXISTS` throughout
 * — luck, not a property anything checked.
 *
 * What it costs is the ability to rebuild a database from the repository and
 * get the one that is deployed, which is the only reason to keep the table.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { RENAMED, assertEveryAppliedMigrationIsStillHere } from '../db/migrate';

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

const onDisk = () =>
  readdirSync(join(workspaceRoot(), 'apps/api/src/db/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();

const applied = (...names: string[]) => new Map(names.map((name) => [name, 'checksum']));

describe('a migration that is no longer here', () => {
  it('fails the run, and says which one', () => {
    const files = onDisk();
    assert.throws(
      () =>
        assertEveryAppliedMigrationIsStillHere(
          applied(files[0]!, '042_a_migration_somebody_deleted.sql'),
          files,
        ),
      /042_a_migration_somebody_deleted\.sql/,
      'a row naming a file nobody has must not pass in silence',
    );
  });

  it('lets a recorded rename through', () => {
    const files = onDisk();
    const [from] = Object.keys(RENAMED);
    assert.ok(from, 'the seven renumbered migrations should be recorded');
    assert.doesNotThrow(() => assertEveryAppliedMigrationIsStillHere(applied(from), files));
  });

  it('refuses a rename whose target is not on disk either', () => {
    // The excuse has to be worth more than the thing it excuses. A recorded
    // rename pointing at a file that has since been renamed again would
    // otherwise go on quietly admitting the old row for ever.
    assert.throws(
      () => assertEveryAppliedMigrationIsStillHere(applied(), ['001_something_else.sql']),
      /stale/i,
    );
  });

  it('keeps every recorded rename pointing at a file that exists', () => {
    // The same assertion the runner makes, made against the real repository:
    // this is what stops the list rotting between runs.
    const files = onDisk();
    assert.doesNotThrow(() => assertEveryAppliedMigrationIsStillHere(new Map(), files));
    for (const [from, to] of Object.entries(RENAMED)) {
      assert.ok(files.includes(to), `${from} was renamed to ${to}, which is not on disk`);
    }
  });
});
