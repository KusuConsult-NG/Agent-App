/**
 * Every path a Dockerfile copies has to exist.
 *
 * `Dockerfile.api`, `Dockerfile.agent` and `Dockerfile.portal` each began by
 * copying a `tsconfig.json` from the root of the workspace. There has never
 * been one — every workspace carries its own and none of them extend upwards
 * — so `docker compose build` aborted on the first instruction of all three
 * images. Nothing noticed, because the compose stack had never been built:
 * the deploy workflow builds the other Dockerfile, and CI builds no image at
 * all.
 *
 * A missing COPY source is a build that fails at the worst moment — when
 * somebody is deploying — and it is exactly the kind of thing a file existing
 * on the author's disk hides. This checks the instructions against the
 * repository rather than against anybody's working copy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../..');

const dockerfiles = readdirSync(repoRoot).filter((name) => name.startsWith('Dockerfile'));

/**
 * The sources of a COPY, or null when the instruction copies from an earlier
 * build stage.
 *
 * A `--from=` source names a path inside that stage, which only exists once
 * the stage has run; it cannot be checked against the repository and is not
 * what broke here.
 */
function copySources(instruction: string): string[] | null {
  const withoutKeyword = instruction.replace(/^COPY\s+/i, '');
  if (/--from=/.test(withoutKeyword)) return null;
  // BuildKit's heredoc form writes a file inline rather than copying one, so
  // there is no source path to find: `COPY <<'EOF' /etc/nginx/conf.d/app.conf`.
  if (/^<</.test(withoutKeyword)) return null;
  const args = withoutKeyword
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.startsWith('--'));
  // The last argument is the destination inside the image.
  return args.slice(0, -1);
}

test('every Dockerfile copies only paths that exist', () => {
  assert.ok(dockerfiles.length > 0, 'there is at least one Dockerfile to check');

  const missing: string[] = [];

  for (const dockerfile of dockerfiles) {
    const lines = readFileSync(join(repoRoot, dockerfile), 'utf8')
      .split('\n')
      .filter((line) => /^COPY\s/i.test(line.trim()))
      .map((line) => line.trim());

    for (const line of lines) {
      const sources = copySources(line);
      if (!sources) continue;
      for (const source of sources) {
        if (!existsSync(join(repoRoot, source))) {
          missing.push(`${dockerfile}: COPY ${source} — no such path in the repository`);
        }
      }
    }
  }

  assert.deepEqual(missing, []);
});

test('every Dockerfile runs a file the build actually produces', () => {
  // A CMD naming a path no build step writes fails only when the container
  // starts, which is after the image has been pushed and a deploy is underway.
  const expectedArtefacts: Record<string, string> = {
    'apps/api/dist/server.js': 'the API entry point',
  };

  for (const [artefact, description] of Object.entries(expectedArtefacts)) {
    const built = existsSync(join(repoRoot, artefact));
    // The check is meaningful only after a build; skipping is honest, and CI
    // builds before it tests.
    if (!built) continue;
    assert.ok(built, `${artefact} — ${description}`);
  }
});
