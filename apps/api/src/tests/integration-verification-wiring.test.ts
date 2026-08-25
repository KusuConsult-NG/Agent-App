/**
 * The go-live gate has to actually ask the providers something.
 *
 * `.github/workflows/integration-verification.yml` runs daily, is named "Ask
 * each provider one real question", and keeps its log for 180 days as the
 * evidence that closes blocker B-4. It runs `npm run verify:integrations` from
 * the repository root.
 *
 * There were two scripts by that name. The root one — `scripts/verify-
 * integrations.mjs` — parsed no arguments, opened no connection to any
 * provider, and printed "All integrations verified successfully" whenever the
 * environment variables were merely non-empty. Pointed at a merchant id of
 * `totally-fake` and a KYC host that does not resolve, it exited 0. The real
 * harness, which does ask, lives in this workspace and was never the one the
 * workflow called.
 *
 * So the daily job asked nobody anything and filed the answer as proof.
 *
 * These tests hold the two halves of that together: the command the workflow
 * runs must reach a script that understands the flags the workflow passes, and
 * a run whose subjects were all mocks must never report itself as evidence.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

const repoRoot = workspaceRoot();
const workflowPath = join(repoRoot, '.github/workflows/integration-verification.yml');

function rootScript(name: string): string {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const script = manifest.scripts?.[name];
  assert.ok(script, `the root package.json has no "${name}" script`);
  return script;
}

/**
 * The files a root npm script would end up executing.
 *
 * Covers the two forms the repository uses: running a file directly
 * (`node scripts/x.mjs`) and delegating into a workspace
 * (`npm run x --workspace @psirs/api`), which is then resolved through that
 * workspace's own manifest. Anything a flag has to survive is in this list.
 */
function resolveScriptTargets(chain: string): string[] {
  // npm appends the caller's arguments to the end of the script, so in an
  // `a && b` chain it is `b` that has to understand them.
  const command = chain.split('&&').at(-1)!.trim();
  const workspace = /--workspace[= ]+(\S+)/.exec(command)?.[1];
  if (workspace) {
    const scriptName = /npm run ([\w:-]+)/.exec(command)?.[1];
    assert.ok(scriptName, `could not read a script name out of "${command}"`);
    const dir = workspace.replace('@psirs/', 'apps/').replace('apps/shared', 'packages/shared');
    const manifestPath = join(repoRoot, dir, 'package.json');
    assert.ok(existsSync(manifestPath), `no manifest at ${manifestPath} for workspace ${workspace}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const inner = manifest.scripts?.[scriptName!];
    assert.ok(inner, `workspace ${workspace} has no "${scriptName}" script`);
    return [...(inner!.match(/[\w./-]+\.(?:ts|mjs|js)/g) ?? [])].map((file) => join(repoRoot, dir, file));
  }
  return [...(command.match(/[\w./-]+\.(?:ts|mjs|js)/g) ?? [])].map((file) => join(repoRoot, file));
}

test('the workflow flags reach a script that understands them', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  // The flags the workflow actually passes, read out of the workflow rather
  // than written here, so adding one to the job without teaching the harness
  // about it fails this test too.
  const invocation = /npm run verify:integrations([\s\S]*?)\n\n/.exec(workflow)?.[1] ?? '';
  const flags = [...new Set(invocation.match(/--[a-z-]+/g) ?? [])];
  assert.ok(flags.length > 0, 'the workflow no longer passes any flags — has the job changed?');

  const targets = resolveScriptTargets(rootScript('verify:integrations'));
  assert.ok(targets.length > 0, 'could not work out which file "verify:integrations" runs');

  const source = targets.map((file) => {
    assert.ok(existsSync(file), `verify:integrations points at ${file}, which does not exist`);
    return readFileSync(file, 'utf8');
  }).join('\n');

  for (const flag of flags) {
    assert.ok(
      source.includes(flag),
      `the daily job passes ${flag}, but the script it runs never reads it. ` +
        `That job is the evidence that closes B-4; a script that ignores the subject ` +
        `it was asked about is not asking anybody anything.`,
    );
  }
});

test('a script named verify:integrations always contacts a provider', () => {
  // Any file reachable under this name must be capable of a request. The
  // failure this guards against was a "readiness audit" that read environment
  // variables and pronounced the integrations verified.
  const targets = resolveScriptTargets(rootScript('verify:integrations'));
  for (const file of targets) {
    const source = readFileSync(file, 'utf8');
    // Naming a provider is not contacting one: the script this replaced
    // printed "Payment Gateway (Remita)" and opened no connection. The test
    // is therefore for a request, or for importing the adapters that make one.
    const reachesOut = /\bfetch\s*\(/.test(source) || /from '[^']*integrations/.test(source);
    assert.ok(
      reachesOut,
      `${file} runs under verify:integrations but never contacts a provider. ` +
        `Reporting on environment variables is not verification.`,
    );
  }
});

test('a run against mocks is not reported as evidence', () => {
  // Every provider here is a mock, and the mocks answer confidently. The run
  // must still refuse to call itself proof: its output is kept for 180 days as
  // the artefact that says the integrations were checked.
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(
      'npx',
      ['tsx', 'src/db/verify-integrations.ts', '--tin', '12345678901', '--nin', '12345678901'],
      {
        cwd: join(repoRoot, 'apps/api'),
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test' },
      },
    );
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    status = failure.status ?? 1;
    stdout = failure.stdout ?? '';
  }

  assert.match(stdout, /mock/i, 'the run did not even mention that it was talking to mocks');
  assert.doesNotMatch(
    stdout,
    /every answer was understood by the platform/,
    'a run whose subjects were all mocks reported a clean pass',
  );
  assert.doesNotMatch(
    stdout,
    /Record this output against the go-live checklist/,
    'a mock run invited itself to be filed as go-live evidence',
  );
  assert.notEqual(status, 0, 'a run that proved nothing about a real provider exited 0');
});
