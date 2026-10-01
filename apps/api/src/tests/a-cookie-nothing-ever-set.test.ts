/**
 * A refresh-token cookie that four places named and nothing ever set.
 *
 * `docs/DEPLOYMENT.md` said "the refresh-token cookie, the CSP and the absence
 * of any CORS preflight all rest on it"; `apps/agent/vite.config.ts` said the
 * dev proxy "keeps cookies, CSP and CORS behaviour the same in development";
 * and `apps/api/src/config.ts` said twice that taking `NODE_ENV` off
 * production would also turn off "the cookie hardening".
 *
 * This platform sets no cookies. Both clients hold the refresh token in web
 * storage and read it from JavaScript to build an `Authorization` header.
 *
 * The direction of the error is what made it worth a guard rather than a
 * quiet edit. An httpOnly cookie cannot be read by injected script and web
 * storage can, so a reader who believed the old sentence would have ruled out
 * the exposure this platform actually has — in the same document that tells
 * them how to deploy it.
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT A SEARCH FOR THE WORD "COOKIE"
 *
 * Pinning the old phrases would fail against the section that now explains
 * them, and would miss a new false claim written in different words. So it
 * pins the facts underneath instead: nothing writes a cookie, the token is in
 * web storage under known keys, and the section saying so is still there. Add
 * a real cookie later and the second check fails, which is the right moment
 * to be sent back to that section rather than a moment to work around.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

/** Every API source file except its tests, which may say anything. */
function apiSources(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'tests') walk(path);
      } else if (path.endsWith('.ts')) {
        out.push({ path: path.slice(ROOT.length + 1), source: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(join(ROOT, 'apps', 'api', 'src'));
  return out;
}

/*
 * Writing a cookie, in the forms this codebase could use. `res.cookie` is
 * Express's; the two header spellings are what reaching past it looks like.
 * Comments are stripped first, because this repository explains itself at
 * length and the explanations quote the thing being checked — the note above
 * this test names `set-cookie` twice.
 */
const WRITES_A_COOKIE = /res\.cookie\s*\(|setHeader\s*\(\s*['"`]set-cookie|append\s*\(\s*['"`]set-cookie/i;

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('what actually holds a refresh token', () => {
  it('nothing in the API writes a cookie', () => {
    const offenders = apiSources()
      .filter(({ source }) => WRITES_A_COOKIE.test(withoutComments(source)))
      .map(({ path }) => path);

    assert.deepEqual(
      offenders,
      [],
      'the API now sets a cookie. That is not forbidden, but *Where the ' +
        'refresh token actually lives* in docs/DEPLOYMENT.md says it sets ' +
        'none and explains what follows from that, and it is now wrong: ' +
        offenders.join(', '),
    );
  });

  it('both clients keep it in web storage under the keys the documentation names', () => {
    for (const [client, key] of [
      ['apps/agent/src/lib/api.ts', 'psirs.refresh'],
      ['apps/portal/src/lib/api.ts', 'psirs.portal.refresh'],
    ] as const) {
      const source = read(client);
      assert.match(
        source,
        new RegExp(`REFRESH_KEY = '${key.replace(/\./g, '\\.')}'`),
        `${client} no longer stores the refresh token under ${key}, so the ` +
          'table in docs/DEPLOYMENT.md is wrong',
      );
      assert.match(
        source,
        /localStorage|sessionStorage/,
        `${client} no longer uses web storage for it`,
      );
      assert.doesNotMatch(
        withoutComments(source),
        /document\.cookie/,
        `${client} reaches for document.cookie, which the deployment notes say ` +
          'nothing does',
      );
    }
  });

  it('the documentation still says where it lives', () => {
    // The explanation is the deliverable here. Deleting it would put the
    // next reader back where the false sentence left them.
    const deployment = read('docs/DEPLOYMENT.md');
    assert.match(
      deployment,
      /### Where the refresh token actually lives/,
      'docs/DEPLOYMENT.md lost the section recording that this platform sets ' +
        'no cookie and that the token is script-readable',
    );
    for (const key of ['psirs.refresh', 'psirs.portal.refresh']) {
      assert.ok(
        deployment.includes(key),
        `docs/DEPLOYMENT.md no longer names ${key}`,
      );
    }
  });
});
