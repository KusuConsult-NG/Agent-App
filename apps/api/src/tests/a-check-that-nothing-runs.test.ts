/**
 * A list of checks longer than the list of checks that run.
 *
 * The root `package.json` has a `verify` script, and it is the closest thing
 * this repository has to a statement of what "verified" means:
 *
 *     npm run typecheck && npm run check:hausa-review &&
 *     npm run check:action-matrix && npm run check:dead-predicates &&
 *     npm run test && npm run test:concurrency
 *
 * `.github/workflows/ci.yml` runs those steps individually rather than calling
 * `verify`, and it ran five of the six. `check:action-matrix` was not there.
 *
 * IT WAS FAILING. `docs/ROLE-ACTION-MATRIX.md` is generated from the
 * permissions the route files actually name, and it no longer matched: moving
 * `POST /usage/expire` off `report:read:all` and onto `system:configure`
 * changed two counts in the committed table, which went on telling a
 * government that an auditor could reach a route they no longer can. The
 * script's own words: "A matrix PSIRS has signed off which no longer describes
 * the platform is worse than no matrix, because somebody is relying on it."
 *
 * The gap had been found once already and only half closed. The step above the
 * hole says so: "This was in `npm run verify` and CI runs the steps
 * individually, so nothing was running it" — written when the Hausa sheet was
 * added, without anyone asking whether a sibling had the same problem. One
 * did.
 *
 * So this checks the property rather than the instance: every script `verify`
 * names must be invoked by the workflow. Adding a check to `verify` and
 * forgetting the workflow is now a failing test rather than a quiet hole.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const CI = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

/** The scripts `verify` chains together, in the order it runs them. */
function verifyChain(): string[] {
  const scripts = (JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: Record<string, string>;
  }).scripts;
  const verify = scripts.verify;
  assert.ok(verify, 'the root package.json no longer has a `verify` script');

  return verify
    .split('&&')
    .map((part) => part.trim())
    .map((part) => part.replace(/^npm run /, '').replace(/^npm /, ''))
    .filter(Boolean);
}

describe('the checks `verify` names', () => {
  it('are all invoked by the CI workflow', () => {
    const named = verifyChain();
    assert.ok(named.length >= 6, `expected the verify chain, parsed ${named.length}`);

    const workflow = readFileSync(CI, 'utf8');
    // Only `run:` lines: a script mentioned in a comment is not a script that
    // runs, which is the whole subject of this file.
    const commands = workflow
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('run:') || line.startsWith('- run:'))
      .join('\n');
    // A `run: |` block puts its commands on following lines; take those too.
    const runnable = `${commands}\n${workflow
      .split('\n')
      .filter((line) => /npm (run )?[a-z:]+/.test(line) && !line.trim().startsWith('#'))
      .join('\n')}`;

    const missing = named.filter((script) => {
      const asRun = new RegExp(`npm run ${script.replace(/:/g, ':')}(\\s|$)`);
      const asBare = new RegExp(`npm ${script}(\\s|$)`);
      return !asRun.test(runnable) && !asBare.test(runnable);
    });

    assert.deepEqual(
      missing,
      [],
      'named in `verify` and never run by ci.yml:\n' +
        missing.map((script) => `  npm run ${script}`).join('\n'),
    );
  });

  it('does not count a script named only in a comment', () => {
    /*
     * The guard on this guard. `ci.yml` explains several of its steps in
     * comments that name the script, so a check that searched the whole file
     * would have passed on the very gap this file exists for — the same
     * mistake as a citation checker reading its own prose.
     */
    const workflow = readFileSync(CI, 'utf8');
    const commented = workflow
      .split('\n')
      .filter((line) => line.trim().startsWith('#') && /npm run [a-z:]+/.test(line));
    assert.ok(
      commented.length > 0,
      'expected ci.yml to mention scripts in comments; if it no longer does, ' +
        'this test has stopped proving anything and should be rewritten',
    );
  });
});
