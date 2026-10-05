/**
 * A development allowance left inside a production security policy.
 *
 * Both front ends declare their Content-Security-Policy in a `<meta>` in
 * `index.html`, and the comment above the agent's says what it is for: to
 * stop "a compromised CDN from reaching a screen that handles government
 * money". Both of them permitted one more thing than that:
 *
 *   connect-src 'self' http://localhost:4000
 *
 * Nothing needs it. Both clients call a relative `API_BASE = '/api/v1'`, and
 * in development `apps/*\/vite.config.ts` proxies `/api` to
 * `http://localhost:4000` — a proxy whose own comment says it exists so that
 * "cookies, CSP and CORS behaviour" match production. So the browser talks to
 * the vite origin in development and to its own origin in production, and has
 * never opened a connection to port 4000 from either. The test harnesses do
 * not use it either: happy-dom resolves relative URLs against port 3000.
 *
 * What it cost is small and entirely one-directional: a policy that is meant
 * to bound where a compromised bundle can send government data permitted a
 * plaintext HTTP origin on the machine running the browser. There was no test
 * on either policy to notice, which is the other half of why it survived.
 *
 * `sw.js` carried the matching exception — its origin check read
 * `url.origin !== self.location.origin && !url.href.startsWith('http://localhost:4000')`
 * — a branch for requests that are never made.
 *
 * This guard is in the API suite for the reason the installability guard
 * beside it gives: it reads files rather than exercising browser behaviour,
 * and the agent's own tsconfig is browser-targeted with no node types.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

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

/** Source with block and line comments removed. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const FRONT_ENDS = [
  { app: 'the agent app', index: 'apps/agent/index.html' },
  { app: 'the officer portal', index: 'apps/portal/index.html' },
] as const;

/** The policy out of the `<meta http-equiv>`, or null if there is none. */
function policyOf(html: string): string | null {
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  return meta?.[1] ?? null;
}

function directive(policy: string, name: string): string | null {
  for (const part of policy.split(';')) {
    const trimmed = part.trim();
    if (trimmed === name || trimmed.startsWith(`${name} `)) {
      return trimmed.slice(name.length).trim();
    }
  }
  return null;
}

describe('what each front end permits itself to connect to', () => {
  for (const { app, index } of FRONT_ENDS) {
    /*
     * The policy has to still be there and still be strict. A guard that only
     * forbade localhost would be satisfied by deleting the whole `<meta>`,
     * which is the opposite of what it is for.
     */
    it(`${app} still declares a strict policy`, () => {
      const policy = policyOf(read(index));
      assert.ok(policy, `${index} no longer declares a Content-Security-Policy at all`);

      for (const [name, expected] of [
        ['default-src', "'self'"],
        ['script-src', "'self'"],
        ['object-src', "'none'"],
        ['base-uri', "'none'"],
        ['form-action', "'self'"],
      ] as const) {
        assert.equal(
          directive(policy!, name),
          expected,
          `${index}: ${name} is no longer ${expected}`,
        );
      }
    });

    it(`${app} connects only to its own origin`, () => {
      const policy = policyOf(read(index))!;
      assert.equal(
        directive(policy, 'connect-src'),
        "'self'",
        `${index}: connect-src permits something besides its own origin. Both ` +
          'clients call a relative /api/v1 and the vite dev proxy forwards it, ' +
          'so no other origin is ever opened — and this policy is what bounds ' +
          'where a compromised bundle could send government data',
      );
    });

    it(`${app} permits no local address anywhere in its policy`, () => {
      const policy = policyOf(read(index))!;
      assert.doesNotMatch(
        policy,
        /localhost|127\.0\.0\.1|\[::1\]/,
        `${index}: a development address is still inside the production policy`,
      );
    });
  }

  it('the service worker makes no exception for a local API either', () => {
    /*
     * The file with its comments taken out, which the first version of this
     * guard forgot — and it failed against the fixed worker, because the
     * comment recording the removal names the address it removed. Every
     * file-reading guard in this suite strips comments for exactly this
     * reason: a repository that explains itself quotes the thing being
     * checked.
     */
    assert.doesNotMatch(
      withoutComments(read('apps/agent/public/sw.js')),
      /localhost|127\.0\.0\.1/,
      'apps/agent/public/sw.js special-cases a local address. Both clients ' +
        'call a relative /api/v1 which the dev proxy forwards, so the branch ' +
        'is for requests that are never made',
    );
  });

  it('the dev proxy is what makes that true, so it has to still be there', () => {
    // If the proxy went away, the clients' relative /api/v1 would stop
    // reaching anything in development and somebody would reach for an
    // absolute URL — which is how the allowance got into the policy.
    for (const config of ['apps/agent/vite.config.ts', 'apps/portal/vite.config.ts']) {
      assert.match(
        read(config),
        /'\/api':\s*\{\s*target:\s*'http:\/\/localhost:4000'/,
        `${config} no longer proxies /api in development, so a relative ` +
          'API_BASE reaches nothing and the CSP above is about to be widened',
      );
    }
  });
});
