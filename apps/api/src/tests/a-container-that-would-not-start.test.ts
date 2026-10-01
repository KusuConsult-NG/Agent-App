/**
 * A resolver nginx refuses, and a front end that never starts.
 *
 * `Dockerfile.agent` and `Dockerfile.portal` proxy `/api/` to a variable
 * upstream so the API's address is resolved per request rather than once at
 * startup — see the long note beside that proxy for why, and for what it cost
 * when it was resolved once.
 *
 * A variable upstream needs a `resolver`, and the address comes from the
 * container's own `/etc/resolv.conf`, because Docker's embedded DNS and a
 * platform's own differ. The first version of that script simply printed every
 * nameserver it found. On an IPv4 network it worked, which is what the
 * development container has and why it passed every test here.
 *
 * A private container network is frequently IPv6, and there:
 *
 *     [emerg] invalid port in resolver "fd12:3456:789a::1"
 *
 * nginx will not load the file, so the container never starts, and the
 * platform reports "Deployment failed" with nothing in it naming DNS. That
 * took the front end down — the API deployed fine beside it, which made it
 * look like a front-end build problem when the image had built perfectly in
 * CI. A startup-fatal configuration error is the worst kind: it takes the
 * whole service rather than degrading one part of it.
 *
 * `[fd12:3456:789a::1]` parses. An IPv4 address must NOT be bracketed. So each
 * nameserver is tested for a colon rather than all of them wrapped, and an
 * empty result falls back rather than rendering `resolver ;`, which is fatal
 * in the same way.
 *
 * THIS RUNS THE SCRIPT RATHER THAN READING IT
 *
 * The behaviour lives in a shell script embedded in a Dockerfile, and a test
 * that matched the source with a regular expression would pass against any
 * rewrite that looked similar. This extracts the real script from the real
 * image definition and executes it against fixture resolv.conf files.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

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
const IMAGES = ['Dockerfile.agent', 'Dockerfile.portal'] as const;

/** The resolver script as the image actually carries it. */
function resolverScript(image: string): string {
  const source = readFileSync(join(ROOT, image), 'utf8');
  const match = /COPY <<'SH' \/docker-entrypoint\.d\/15-nginx-resolver\.envsh\n([\s\S]*?)\nSH\n/.exec(
    source,
  );
  assert.ok(
    match,
    `${image} no longer embeds a 15-nginx-resolver.envsh script. The /api/ ` +
      'proxy uses a variable upstream, which cannot resolve anything without ' +
      'a resolver directive',
  );
  return match![1]!;
}

/** Run it with /etc/resolv.conf standing in, and report NGINX_RESOLVER. */
function resolverFor(image: string, resolvConf: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'psirs-resolver-'));
  const fixture = join(directory, 'resolv.conf');
  writeFileSync(fixture, resolvConf);

  const script = resolverScript(image).replaceAll('/etc/resolv.conf', fixture);
  const out = execFileSync('sh', ['-c', `${script}\nprintf '%s' "$NGINX_RESOLVER"`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // The script also echoes a line for the log; the value is what it prints last.
  return out.trim().split('\n').pop()!.trim();
}

for (const image of IMAGES) {
  describe(`${image}'s resolver`, () => {
    it('brackets an IPv6 nameserver, which nginx rejects bare', () => {
      const value = resolverFor(image, 'nameserver fd12:3456:789a::1\nnameserver fd12:3456:789a::2\n');

      assert.equal(
        value,
        '[fd12:3456:789a::1] [fd12:3456:789a::2]',
        'an unbracketed IPv6 nameserver makes nginx refuse to load its ' +
          'configuration — "invalid port in resolver" — so the container never ' +
          'starts and the platform reports only "Deployment failed"',
      );
    });

    it('leaves an IPv4 nameserver alone, which nginx rejects bracketed', () => {
      const value = resolverFor(image, 'nameserver 8.8.8.8\nnameserver 8.8.4.4\noptions timeout:2\n');
      assert.equal(value, '8.8.8.8 8.8.4.4');
    });

    it('handles a file with both', () => {
      const value = resolverFor(image, 'nameserver fd00::1\nnameserver 10.0.0.2\n');
      assert.equal(value, '[fd00::1] 10.0.0.2');
    });

    it('falls back rather than rendering an empty resolver', () => {
      /*
       * `resolver ;` is fatal at load in the same way. A wrong resolver fails
       * at request time instead, which leaves the service up and puts the
       * reason in the log — strictly better than a container that will not
       * start at all.
       */
      const value = resolverFor(image, 'options ndots:0\nsearch example\n');
      assert.equal(value, '127.0.0.11');
    });

    it('ignores everything that is not a nameserver line', () => {
      const value = resolverFor(
        image,
        '# a comment\nsearch internal\noptions ndots:0\nnameserver 10.1.2.3\n',
      );
      assert.equal(value, '10.1.2.3');
    });
  });
}
