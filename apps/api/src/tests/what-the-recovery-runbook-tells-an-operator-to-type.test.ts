/**
 * The commands a person pastes into a terminal while the platform is down.
 *
 * A recovery runbook is read once, under the worst conditions the platform
 * will ever see, by someone who did not write it. Every line in it is going to
 * be pasted verbatim, in order, without the reader stopping to reason about
 * whether it applies to the machine they are sitting at. That makes a runbook
 * the one document where a stale path is not a typo.
 *
 * `docs/DISASTER-RECOVERY-PLAN.md` opened its restoration scenario with
 *
 *     cd /Users/mac/Agent-App
 *
 * which is a directory on one person's laptop. Run on a recovery host the `cd`
 * fails, prints "No such file or directory", and leaves the shell wherever it
 * started; the operator reads one error and carries on; and step 2 —
 * `bash deploy/backup/restore.sh …`, a relative path — then fails with a second
 * "No such file or directory" and exit 127. Measured, by running the scenario
 * verbatim from `/`. The restore script itself was never the problem: from the
 * checkout it restored the seeded database and reported all eight financial
 * tables and 198 audit rows. The distance between an operator and a working
 * database was a directory name.
 *
 * WHAT THIS CANNOT DO. It checks that a runbook names no machine that is not
 * the reader's and cites no script that is absent. A personal path quoted in
 * backticks in prose is read as discussion and allowed, so a document could
 * still instruct in prose what it may not instruct in a code block. It cannot check that the
 * commands, run in order, recover anything — that is what the restoration test
 * in `DISASTER-RECOVERY.md` and `deploy/backup/verify-backup.sh` are for. A
 * guard that implied otherwise would be the same defect one level up.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const RUNBOOKS = [
  join(REPO_ROOT, 'docs', 'DISASTER-RECOVERY.md'),
  join(REPO_ROOT, 'docs', 'DISASTER-RECOVERY-PLAN.md'),
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

function everyMarkdownFile(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everyMarkdownFile(full, found);
    else if (entry.endsWith('.md')) found.push(full);
  }
  return found;
}

describe('the recovery runbook', () => {
  /**
   * Every document, not only the two runbooks.
   *
   * The defect is not specific to disaster recovery — it is what happens when
   * a command is pasted out of a working shell into a document. A deployment
   * note or an SOP carrying somebody's home directory fails the same way, so
   * the sweep is over every Markdown file in the repository.
   */
  it('sends nobody to a directory on somebody else s machine', () => {
    const personalHome = /(\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+)/;
    const offences: string[] = [];

    for (const file of everyMarkdownFile(REPO_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let inFence = false;

      lines.forEach((line, index) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          return;
        }

        const hit = personalHome.exec(line);
        if (!hit) return;

        /**
         * A path inside a fenced block is something to paste. The same path in
         * prose, wrapped in backticks, is a quotation — the paragraph that
         * explains this defect has to be able to name it. Anything else in
         * prose is read as an instruction and is treated as one.
         */
        const quoted = !inFence && new RegExp('`[^`]*' + hit[1].replace(/[/]/g, '\\/') + '[^`]*`').test(line);
        if (quoted) return;

        offences.push(`${relative(REPO_ROOT, file)}:${index + 1}  ${hit[1]}`);
      });
    }

    assert.deepEqual(
      offences,
      [],
      'A document names a path inside a personal home directory. On the machine ' +
        'that reads it, that path does not exist. Name the checkout in a variable ' +
        'the reader sets, or use a path the deployment actually has:\n  ' +
        offences.join('\n  '),
    );
  });

  it('cites no script that is not in the repository', () => {
    const missing: string[] = [];

    for (const runbook of RUNBOOKS) {
      const lines = readFileSync(runbook, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(/(?:^|\s)((?:\.\/)?[A-Za-z0-9_./-]+\.sh)\b/g)) {
          const cited = match[1].replace(/^\.\//, '');
          // Only repository-relative citations; an absolute path on the
          // recovery host is the deployment's, not this repository's.
          if (cited.startsWith('/')) continue;
          if (!existsSync(join(REPO_ROOT, cited))) {
            missing.push(`${relative(REPO_ROOT, runbook)}:${index + 1}  ${cited}`);
          }
        }
      });
    }

    assert.deepEqual(missing, [], `A runbook names a script that does not exist:\n  ${missing.join('\n  ')}`);
  });

  /**
   * Two representations of one fact, bound together.
   *
   * §2.1 used to state "Daily at 02:00 UTC" as established practice. Nothing
   * in this repository runs it: the only `cron:` entries are Dependabot and
   * the nightly integration check, neither of which takes a backup, and there
   * is no systemd timer or crontab anywhere. The section now says so.
   *
   * This binds the two. When somebody does schedule a backup, the assertion
   * fails and points at the paragraph that has to stop saying nothing does.
   */
  it('does not claim a backup schedule the repository does not keep', () => {
    const schedulers: string[] = [];

    const workflowDir = join(REPO_ROOT, '.github', 'workflows');
    for (const entry of readdirSync(workflowDir)) {
      if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
      const source = readFileSync(join(workflowDir, entry), 'utf8');
      if (/^\s*-?\s*cron:/m.test(source) && /backup[a-z-]*\.sh/.test(source)) {
        schedulers.push(`.github/workflows/${entry}`);
      }
    }

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.timer$/.test(entry) || /^crontab/.test(entry)) {
          schedulers.push(relative(REPO_ROOT, full));
        }
      }
    };
    walk(REPO_ROOT);

    const plan = readFileSync(join(REPO_ROOT, 'docs', 'DISASTER-RECOVERY-PLAN.md'), 'utf8');
    const saysNothingSchedulesIt = plan.includes('no cron entry, no systemd timer, no scheduled workflow');

    assert.deepEqual(
      schedulers,
      [],
      'Something in this repository now schedules a backup. That is the gap ' +
        'DISASTER-RECOVERY-PLAN.md §2.1 and DISASTER-RECOVERY.md "What is still ' +
        'outstanding" both record as open — update them, then update this test:\n  ' +
        schedulers.join('\n  '),
    );
    assert.equal(
      saysNothingSchedulesIt,
      true,
      'DISASTER-RECOVERY-PLAN.md §2.1 no longer says that nothing in the ' +
        'repository schedules a backup, and nothing in the repository does. ' +
        'A cadence stated as fact is read as a cadence somebody is keeping.',
    );
  });
});
