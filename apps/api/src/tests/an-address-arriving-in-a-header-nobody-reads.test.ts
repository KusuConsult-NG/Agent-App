/**
 * The caller's address, forwarded and ignored.
 *
 * `TRUST_PROXY` is off by default. When it is off Express takes `req.ip` from
 * the socket, and the front-end image serves `/api/` by proxying to this
 * service -- so the socket address is nginx and the caller's address arrives
 * only in `X-Forwarded-For`.
 *
 * Measured against the config rendered out of `Dockerfile.agent`, with that
 * nginx as the only hop in front of a stub reporting what it received: a
 * caller sending nothing gets `X-Forwarded-For: <its address>`, and a caller
 * sending `102.89.33.7` gets `102.89.33.7, <its address>`. One hop, appending
 * what it saw. So with trust off the address is in the request and discarded.
 *
 * Two costs follow, and neither announces itself. Every `keyBy: 'ip'` rate
 * limit becomes one bucket for all callers at once -- the sharpest being the
 * public citizen lookup at ten requests a minute and five for a statement, so
 * it starts refusing ordinary citizens almost immediately. And the audit log
 * and `verification_attempts` record the proxy's address as the place a lookup
 * came from, which is the column read as evidence.
 *
 * A boot check cannot see any of this: whether anything forwards an address
 * depends on what sits in front of the API, which it learns when a request
 * arrives and not before. Hence a runtime warning, once per process.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../middleware/context';
import { config } from '../config';

/** Every line written while `run` executed. */
function capture(run: () => void): string[] {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const collect = (line: unknown) => void lines.push(String(line));
  console.log = collect;
  console.warn = collect;
  console.error = collect;
  try {
    run();
  } finally {
    Object.assign(console, original);
  }
  return lines;
}

function requestWith(headers: Record<string, string>): {
  req: Request;
  res: Response;
  next: NextFunction;
} {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
    ip: '10.0.0.7',
    socket: { remoteAddress: '10.0.0.7' },
  } as unknown as Request;
  const res = { setHeader: () => undefined } as unknown as Response;
  return { req, res, next: (() => undefined) as NextFunction };
}

describe('a forwarded address this deployment is not told to read', () => {
  /*
   * Ordered, and they have to be: the warning is once per process, so the
   * second test can only observe silence after the first has spent it. Run
   * alone, the second would pass for the wrong reason, which is why it asserts
   * the first one's line was seen rather than only that this one is quiet.
   */
  let firstLines: string[] = [];

  it('says so the first time a request carries one', () => {
    assert.equal(
      config.security.trustProxy,
      false,
      'this test describes the TRUST_PROXY=false case; the suite has it set',
    );

    const { req, res, next } = requestWith({ 'x-forwarded-for': '102.89.33.7, 10.0.0.1' });
    firstLines = capture(() => requestContext(req, res, next));

    assert.equal(firstLines.length, 1, JSON.stringify(firstLines));
    const line = firstLines[0]!;
    assert.match(line, /X-Forwarded-For but TRUST_PROXY is not set/);
    assert.match(line, /102\.89\.33\.7/, 'the line does not show the address being ignored');
    assert.match(line, /rate limit shares one bucket/, 'the line does not name what it costs');
    assert.match(line, /TRUST_PROXY/, 'the line does not name the remedy');
  });

  it('does not say so again, having said it once', () => {
    assert.equal(firstLines.length, 1, 'the first request did not warn, so this proves nothing');

    const { req, res, next } = requestWith({ 'x-forwarded-for': '41.58.1.2, 10.0.0.1' });
    const lines = capture(() => requestContext(req, res, next));

    assert.deepEqual(lines, [], 'a warning on every request is a warning nobody reads');
  });

  it('stays quiet when the deployment is configured to read the address', () => {
    /*
     * The other half of the condition, which cannot be reached in this
     * process: `config` is a module singleton read at import, so TRUST_PROXY
     * is whatever the suite booted with. A mutation that drops
     * `!config.security.trustProxy` therefore survived every test above --
     * measured, not assumed -- and this is what pins it.
     *
     * Run in a child with TRUST_PROXY set, the way `certification-audit`
     * boots config under a different environment for the same reason. A
     * warning on a correctly configured deployment is noise that teaches
     * people to ignore the log.
     */
    /*
     * `spawnSync`, and both streams joined. The first version of this used
     * `execFileSync`, which returns stdout alone on success -- and `log.warn`
     * writes to stderr, so it inspected a stream the warning never reaches and
     * passed whatever the middleware did. The mutation that drops
     * `!config.security.trustProxy` survived it, which is how I know.
     */
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const { join } = require('node:path') as typeof import('node:path');
    const contextModule = join(__dirname, '..', 'middleware', 'context.ts');

    const script = `
      const { requestContext } = require(${JSON.stringify(contextModule)});
      const req = {
        header: (name) =>
          name.toLowerCase() === 'x-forwarded-for' ? '102.89.33.7, 10.0.0.1' : undefined,
        ip: '10.0.0.7',
        socket: { remoteAddress: '10.0.0.7' },
      };
      requestContext(req, { setHeader() {} }, () => {});
      console.log('REACHED THE END');
    `;

    const child = spawnSync('npx', ['tsx', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TRUST_PROXY: 'true' },
    });
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;

    assert.equal(child.status, 0, `the child exited ${child.status}: ${output}`);
    assert.match(output, /REACHED THE END/, 'the child did not run the middleware');
    assert.doesNotMatch(
      output,
      /TRUST_PROXY is not set/,
      'the warning fired on a deployment that does read the forwarded address',
    );
  });

  it('still sets the request context it exists for', () => {
    // The warning must not have displaced the work. Note `clientIp` is the
    // socket address and deliberately not the forwarded one: guessing a hop
    // count is how a spoofed header becomes a trusted address.
    const { req, res, next } = requestWith({
      'x-forwarded-for': '102.89.33.7',
      'x-device-id': 'portal-abcdefgh',
      'x-app-version': '1.2.3',
    });

    requestContext(req, res, next);

    assert.equal(req.clientIp, '10.0.0.7');
    assert.equal(req.deviceIdentifier, 'portal-abcdefgh');
    assert.equal(req.appVersion, '1.2.3');
    assert.ok(req.requestId);
  });
});
