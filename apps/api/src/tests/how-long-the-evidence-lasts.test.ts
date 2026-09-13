/**
 * How long the integration-verification evidence actually survives.
 *
 * `integration-verification.yml` uploads `verification.log` as the evidence
 * that closes blocker B-4, and asked to keep it for 180 days under a comment
 * saying that evidence vanishing in ninety days "is not much use to an auditor
 * asking in month four".
 *
 * It was never 180. GitHub caps artifact retention at ninety days for a public
 * repository — the upload action's own `action.yml` documents the input as
 * "Max: 90 days" — so the request was reduced on arrival. The number in the
 * file said four months and the artifact expired in three, which is worse than
 * asking for ninety would have been: a figure nobody can act on reads as a
 * problem already solved.
 *
 * `docs/INTEGRATION-VERIFICATION.md` repeated the same 180, so two files
 * agreed with each other and neither agreed with GitHub. That is the shape
 * this repository keeps finding: two representations of one fact, with nothing
 * holding them to the thing they describe.
 *
 * WHAT THIS CANNOT DO. It cannot ask GitHub what the cap is. The ninety below
 * is written down here, from the action's documented maximum, and a repository
 * made private could raise its own ceiling to 400 — at which point this test
 * is the thing to change, deliberately, rather than a number quietly drifting
 * again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const workflowDir = join(repoRoot, '.github', 'workflows');

/** The most a public repository may keep an artifact for. */
const CAP_DAYS = 90;

test('no workflow asks to keep an artifact longer than GitHub will keep it', () => {
  const overLong: string[] = [];

  for (const entry of readdirSync(workflowDir)) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    readFileSync(join(workflowDir, entry), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const asked = line.match(/^\s*retention-days:\s*(\d+)/);
        if (!asked) return;
        const days = Number(asked[1]);
        if (days > CAP_DAYS) {
          overLong.push(`${entry}:${index + 1}  asks for ${days} days, cap is ${CAP_DAYS}`);
        }
      });
  }

  assert.deepEqual(
    overLong,
    [],
    'A workflow asks to keep an artifact longer than a public repository can. ' +
      'The request is reduced on arrival, so the file states a retention nobody ' +
      'gets:\n  ' + overLong.join('\n  '),
  );
});

test('the document and the workflow agree on how long the evidence lasts', () => {
  const workflow = readFileSync(join(workflowDir, 'integration-verification.yml'), 'utf8');
  const document = readFileSync(join(repoRoot, 'docs', 'INTEGRATION-VERIFICATION.md'), 'utf8');

  const inWorkflow = workflow.match(/^\s*retention-days:\s*(\d+)/m);
  assert.ok(inWorkflow, 'integration-verification.yml no longer sets retention-days');

  const inDocument = document.match(/kept as a build artifact for \*\*(\d+) days\*\*/);
  assert.ok(
    inDocument,
    'docs/INTEGRATION-VERIFICATION.md no longer states how long the evidence is kept',
  );

  assert.equal(
    Number(inDocument[1]),
    Number(inWorkflow[1]),
    'the document and the workflow state different retentions for the same ' +
      'artifact; the document is what an auditor reads, and the workflow is ' +
      'what actually happens',
  );
});
