/**
 * Copy the SQL migrations into the build output.
 *
 * `tsc` compiles TypeScript and nothing else, so `dist/db/migrations` was empty
 * and `node dist/server.js` died at boot:
 *
 *   ENOENT: no such file or directory, scandir '…/dist/db/migrations'
 *
 * The test suite never caught it because tests run the TypeScript source
 * through `tsx`, where the `.sql` files sit next to their module. Only the
 * built artefact — the thing that actually gets deployed — was broken.
 *
 * The migrations are not incidental assets. `migrate.ts` runs them before the
 * server accepts traffic, and it verifies each applied file against a stored
 * checksum, so the deployed copy must be byte-identical to the one in source
 * control. Copying rather than regenerating is the point.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(apiRoot, 'src', 'db', 'migrations');
const to = join(apiRoot, 'dist', 'db', 'migrations');

if (!existsSync(from)) {
  throw new Error(`No migrations directory at ${from}. Refusing to produce a build without one.`);
}

cpSync(from, to, { recursive: true });

const copied = readdirSync(to).filter((name) => name.endsWith('.sql'));
const expected = readdirSync(from).filter((name) => name.endsWith('.sql'));

// A partial copy would leave a build that starts and then applies an
// incomplete schema, which is worse than one that refuses to start.
if (copied.length !== expected.length) {
  throw new Error(
    `Copied ${copied.length} migration(s) but source has ${expected.length}. Build aborted.`,
  );
}

console.log(`[build] copied ${copied.length} migration(s) into dist/db/migrations`);
