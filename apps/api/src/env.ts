/**
 * Load `.env` before anything reads configuration.
 *
 * `.env.example` has always documented every setting the platform takes, and
 * nothing ever read the `.env` a person made from it. The result was silent:
 * the process started, picked development fallbacks for the database URL and
 * every integration, and gave no indication it had ignored the file. Running
 * `npm run migrate` after pointing `DATABASE_URL` at a new database migrated
 * the old one instead.
 *
 * Node's own loader is used rather than a dependency, and it has the ordering
 * that matters here: a variable already present in the real environment wins,
 * and the file only fills what is missing. So a deployment that injects secrets
 * directly cannot be quietly overridden by a stray `.env` left in the image.
 *
 * Test runs skip the file entirely. `src/tests/env.ts` points the suite at
 * `psirs_test` and the suite truncates tables between cases; a developer's
 * `.env` naming their working database must never be able to reach that.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the file was found, or null if there wasn't one. Exported for the boot log. */
export const envFileLoaded = load();

/**
 * The database a connection string points at, without its credentials.
 *
 * Every line that reports which database is about to be written to goes
 * through here, because the obvious thing — printing the URL — puts a password
 * into the terminal and then into whatever captured it.
 */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, '') || '(none)';
    return `${name} on ${parsed.hostname}:${parsed.port || '5432'}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

function load(): string | null {
  if (process.env.NODE_ENV === 'test') return null;

  // From this module outwards: apps/api (src or dist), then apps, then the
  // repository root — so it works whether the process was started from the
  // workspace directory or the root.
  let directory = __dirname;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return null;
}
