/**
 * One URL, two applications, and the four ways that goes wrong.
 *
 * Everything the platform ever hands to someone outside government points at
 * the portal: the QR code on a receipt, a referee's invitation, a cooperative
 * chairman's attestation link, the SMS telling a taxpayer what they owe. The
 * agents' app lives somewhere else entirely. `Dockerfile.web` serves both from
 * one origin so there is one address to publish, secure and explain —
 *
 *     /          the agent PWA
 *     /portal/   the officer portal, and with it /verify, /referee,
 *                /group-attestation and /citizen
 *     /api/      proxied to the API
 *
 * — and the whole arrangement rests on three facts that are invisible in the
 * file that depends on them, which is what this guards.
 *
 * WHY EACH CHECK IS HERE, MEASURED RATHER THAN REASONED
 *
 * 1. Vite writes ABSOLUTE asset URLs into index.html. Built normally the
 *    portal's index.html names `/assets/index-<hash>.js` and `/icon.svg`;
 *    served under /portal/ each of those is a 404 at the root, answered by
 *    the agent's SPA fallback with the agent's shell — 200, text/html — and
 *    the page is blank with a console full of MIME errors and nothing naming
 *    the cause. `--base=/portal/` is what makes them `/portal/assets/...`.
 *    Verified: built with the flag, the emitted index.html names
 *    /portal/assets/... and /portal/icon.svg.
 *
 * 2. The mount path and that base have to be the same string. They are
 *    written in two places a hundred lines apart, and disagreeing silently
 *    produces exactly the blank page above.
 *
 * 3. The /portal/ fallback has to name /portal/index.html. With the root
 *    fallback, an unknown path under /portal/ is answered with the AGENT's
 *    shell: 200, right content type, wrong application.
 *
 * 4. Every public URL comes from VERIFICATION_BASE_URL through
 *    lib/public-urls.ts. Moving the portal to a subpath and forgetting that
 *    setting points every receipt QR code printed since at the agent app.
 *    That one cannot be checked from here — it is configuration — so it is
 *    asserted to still be the single source it is, and documented in
 *    docs/DEPLOYMENT.md.
 *
 * The routing itself was measured against real nginx with both apps' real
 * build output in place, not inferred from the matching rules: / and
 * /nonexistent-route give the agent shell; /portal/ and
 * /portal/nonexistent-route give the portal's; /portal 301s to /portal/;
 * /portals-of-jos is the agent's, so the prefix is precise; /api/v1/... comes
 * back as application/json. Both apps then booted in Chromium from that one
 * origin with zero failed requests and zero console errors, and the public
 * verify screen rendered at /portal/#/verify/<code>.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { citizenPath, groupAttestationPath, refereePath, verifyPath } from '../lib/public-urls';

/**
 * The repository root, found by walking up to the manifest that declares the
 * workspaces.
 *
 * `import.meta.dirname` would be shorter and does not compile: the API's test
 * tsconfig targets CommonJS, and tsc refuses `import.meta` there outright.
 * This is the same walk the sibling Dockerfile guards use, and it survives a
 * shard being started from any directory.
 */
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
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The file with its comments taken out.
 *
 * This Dockerfile explains itself at length and the explanations quote the
 * directives being checked — the note on the fallback contains the words
 * `/portal/index.html` as an illustration of what must NOT be written. A
 * guard satisfied by a sentence about a directive rather than the directive
 * is a mistake this repository has made before.
 */
function directivesOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && !trimmed.startsWith('#');
    })
    .join('\n');
}

const IMAGE = 'Dockerfile.web';

describe('the portal served from a subpath of the agent', () => {
  test('is built for the subpath rather than for the root', () => {
    const source = directivesOnly(read(IMAGE));
    const build = /npm run build --workspace @psirs\/portal -- --base=(\S+)/.exec(source);
    assert.ok(
      build,
      `${IMAGE} does not build the portal with an explicit --base. Vite then ` +
        'writes /assets/... into its index.html, those 404 under /portal/, ' +
        "and the agent's SPA fallback answers each one with the agent's " +
        'shell: a blank page whose console says only that a module had the ' +
        'wrong MIME type',
    );
    assert.equal(
      build![1],
      '/portal/',
      `${IMAGE} builds the portal for base ${build![1]}, which is not the ` +
        'path it is served from',
    );
  });

  test('mounts it at the path it was built for', () => {
    const source = directivesOnly(read(IMAGE));
    const base = /--base=(\S+)/.exec(source)![1]!;
    const mount = /location (\S+ )?(\/portal\/)/.exec(source);

    assert.ok(mount, `${IMAGE} builds for ${base} but has no location serving it`);
    assert.equal(
      mount![2],
      base,
      `${IMAGE} serves ${mount![2]} but built for ${base}. These are written ` +
        'a hundred lines apart and every asset URL depends on them agreeing',
    );

    // And the build output has to be copied to the path that location serves.
    assert.match(
      source,
      /COPY --from=builder \/app\/apps\/portal\/dist \/usr\/share\/nginx\/html\/portal\b/,
      `${IMAGE} does not copy the portal build to the directory ${base} ` +
        'resolves to under the nginx root',
    );
  });

  test('falls back to the portal shell, not the agent shell', () => {
    const source = directivesOnly(read(IMAGE));
    const block = /location \/portal\/ \{([^}]*)\}/.exec(source);
    assert.ok(block, `${IMAGE} has no "location /portal/" block`);

    assert.match(
      block![1]!,
      /try_files \$uri \$uri\/ \/portal\/index\.html/,
      `${IMAGE}'s /portal/ block does not fall back to /portal/index.html. ` +
        'With the root fallback an unknown path under /portal/ is answered ' +
        "with the AGENT's shell — 200, correct content type, entirely the " +
        'wrong application',
    );
  });

  test('keeps the agent shell for a path that merely begins like the portal', () => {
    // Measured: /portals-of-jos is answered by the agent, /portal/ by the
    // portal. A fallback written as a regex, or the prefix losing its
    // trailing slash, would take the first of those.
    const source = directivesOnly(read(IMAGE));
    assert.match(
      source,
      /location \/portal\/ \{/,
      `${IMAGE} no longer mounts the portal on the prefix "/portal/" with ` +
        'its trailing slash, so a path like /portals-of-jos may now be ' +
        'answered by the portal',
    );
  });
});

describe("the agent's service worker on a shared origin", () => {
  /*
   * The worker registers with scope "/" because the agent IS the root app,
   * so every portal request passes through it, and every branch of it was
   * written for an origin with one application on it. The exclusion lives in
   * sw.js and the agent suite exercises the real file against a mocked worker
   * global; this checks only that the line is still there, because the cost
   * of losing it is paid on a handset in a market rather than in CI.
   */
  test('leaves the portal alone', () => {
    const source = read('apps/agent/public/sw.js');
    assert.match(
      source,
      /url\.pathname\s*===\s*'\/portal'\s*\|\|\s*url\.pathname\.startsWith\('\/portal\/'\)/,
      "apps/agent/public/sw.js no longer excludes /portal/. Its navigation " +
        "branch caches whatever HTML came back under the literal key " +
        "'/index.html', so one officer opening the portal replaces the " +
        "agent's offline shell with a government sign-in page; and its " +
        'static branch falls back to that same key, so a portal asset ' +
        'fetched offline comes back as HTML and the portal dies parsing it',
    );
  });

  test('carries a version that makes a handset install the exclusion', () => {
    /*
     * A browser installs a new worker only when these bytes differ, and
     * `activate` — which clears the caches the worker no longer owns — runs
     * only then. A handset that reached /portal/ under an older worker has
     * the portal's HTML sitting in its shell cache under '/index.html'; new
     * cache names are what stop that outliving the fix.
     */
    const version = /const VERSION = '([^']+)'/.exec(read('apps/agent/public/sw.js'))?.[1];
    assert.ok(version, 'sw.js no longer declares VERSION');
    assert.notEqual(
      version,
      'psirs-agent-v2',
      'sw.js still carries the version it had before the /portal/ exclusion, ' +
        'so no handset that already has the old worker will install this one',
    );
  });
});

describe('what a citizen is sent', () => {
  /*
   * Four kinds of public link, and one setting behind all four. Moving the
   * portal under /portal/ without moving VERIFICATION_BASE_URL with it points
   * every receipt QR code, every referee invitation, every attestation link
   * and every arrears SMS at the agent app's sign-in form — which renders
   * perfectly, so nothing looks like an error.
   */
  test('all comes from one setting, so a subpath move is one change', () => {
    const source = read('apps/api/src/lib/public-urls.ts');
    const reads = source.match(/config\.branding\.verificationBaseUrl/g) ?? [];
    assert.equal(
      reads.length,
      1,
      'public-urls.ts reads verificationBaseUrl in ' +
        `${reads.length} places rather than one. The point of that module is ` +
        'that the portal origin is derived once, so moving the portal is one ' +
        'configuration change and cannot be half-applied',
    );

    // And every public path still goes through it.
    for (const path of [verifyPath, refereePath, groupAttestationPath, citizenPath]) {
      assert.match(
        source,
        new RegExp(`\\\${portalOrigin\\(\\)}/#/\\\${${
          { verify: 'verifyPath', referee: 'refereePath', 'group-attestation': 'groupAttestationPath', citizen: 'citizenPath' }[path]
        }}`),
        `the ${path} URL is no longer built from portalOrigin(), so it will ` +
          'not follow the portal to a subpath',
      );
    }
  });

  test('is documented as needing the subpath', () => {
    // The one thing this test file cannot enforce is configuration, so the
    // least it can do is fail when the instruction for it disappears.
    const doc = read('docs/DEPLOYMENT.md');
    assert.match(
      doc,
      /VERIFICATION_BASE_URL[\s\S]{0,400}\/portal/,
      'docs/DEPLOYMENT.md no longer says that VERIFICATION_BASE_URL has to ' +
        'carry the /portal subpath when both apps share one origin. Nothing ' +
        'in the code can catch that being missed',
    );
  });
});
