/**
 * Every password field can be shown.
 *
 * There was no reveal control anywhere: three password inputs across the two
 * applications, all of them typed blind. That is hardest exactly where it
 * matters most — the agent PWA, used one handed on a phone in a market, and
 * the application form, whose rule is at least eight characters with a letter
 * and a number. An applicant who cannot see what they typed cannot tell a
 * typo from a rejected password.
 *
 * This is a structural guard rather than a behavioural one: the PWA's test
 * environment is `node` with no DOM, so the toggle itself was verified by
 * driving both applications in a browser. What this can do is stop a new bare
 * password input being added beside the shared ones, which is how the fourth
 * field ends up without a control while the first three have one.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function filesUnder(...segments: string[]): { path: string; source: string }[] {
  const root = join(REPO_ROOT, ...segments);
  const out: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) out.push({ path, source: readFileSync(path, 'utf8') });
    }
  };
  walk(root);
  return out;
}

describe('A password field is never typed blind', () => {
  it('has a reveal control in the agent app', () => {
    const ui = readFileSync(join(REPO_ROOT, 'apps', 'agent', 'src', 'ui.tsx'), 'utf8');
    assert.match(ui, /export function PasswordField/);
    assert.match(ui, /aria-label=\{shown \? 'Hide password' : 'Show password'\}/);
    assert.match(
      ui,
      /type="button"/,
      'the toggle must not submit the form it sits inside',
    );
  });

  it('has one in the portal', () => {
    const login = readFileSync(
      join(REPO_ROOT, 'apps', 'portal', 'src', 'screens', 'Login.tsx'),
      'utf8',
    );
    assert.match(login, /password__toggle/);
    assert.match(login, /type=\{shown \? 'text' : 'password'\}/);
  });

  it('starts hidden in both, because revealing is a deliberate act', () => {
    for (const [app, file] of [
      ['agent', join('apps', 'agent', 'src', 'ui.tsx')],
      ['portal', join('apps', 'portal', 'src', 'screens', 'Login.tsx')],
    ] as const) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      assert.match(
        source,
        /useState\(false\)/,
        `${app}: the reveal state must default to hidden`,
      );
    }
  });

  it('leaves no bare password input behind', () => {
    // A new field added the old way would have no control, and nobody would
    // notice until somebody tried to use it on a phone.
    const offenders: string[] = [];
    for (const app of ['agent', 'portal'] as const) {
      for (const { path, source } of filesUnder('apps', app, 'src')) {
        if (path.endsWith(join('portal', 'src', 'screens', 'Login.tsx'))) continue;
        if (source.includes('type="password"')) offenders.push(path.replace(REPO_ROOT, ''));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these still render a raw password input: ${offenders.join(', ')} — use PasswordField, ` +
        'or add the same toggle',
    );
  });
});
