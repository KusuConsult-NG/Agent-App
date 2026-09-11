/**
 * Something the API computes, the screen declares, and no column draws.
 *
 * This shape has come back five times, and each time the cost was the same:
 * the platform knew the answer and the person looking at it did not.
 *
 *   - `lastDetail` on the unattended-work board. A HEALTHY row said the job
 *     ran and nothing about whether it found anything — the difference
 *     between a reminder sweep working and one running over an empty queue.
 *   - `body` on the officer inbox. An administrator woken by a CRITICAL
 *     alert read the subject and had to go elsewhere for the error.
 *   - `status` and `occurred_at` on a search hit. A reversed receipt looked
 *     exactly like a paid one.
 *   - `oldestDaysOutstanding`, `monthsSinceLastFiling`, `last_message_at` on
 *     three worklists. None of them could be put in order.
 *   - `last_message_at` again, on the agent's own ticket list — the twin of
 *     the officer queue, fixed an hour apart, because fixing one side of a
 *     class and not the other is exactly how this keeps happening.
 *
 * In every case a test fixture already carried a value for the field. The
 * data was arriving. Nobody had looked.
 *
 * WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Only fields carrying STATE or TIME — a status, a timestamp, a count, an
 * age, a reason, a detail. Those are the ones whose absence changes what a
 * reader concludes. A broader rule over every unread field would flag about
 * ninety, most of them typed for completeness, and an exemption list that
 * long stops being read — which is the failure mode this is meant to prevent,
 * not reproduce.
 *
 * It is a source lint because there is no type that expresses "and somebody
 * renders this". A field is read or it is not, and `tsc` is happy either way.
 *
 * It lives in the API suite rather than beside either application, for two
 * reasons. It has to read both of them — the last instance was the agent's
 * ticket list carrying the very field the officer queue had just been given,
 * and a per-application check would have caught one half of that and not the
 * other — and Vite refuses a file outside its own root, so only a plain
 * `readFileSync` reaches both. The reachability guard next to this one reads
 * `app.ts` from disk for the same reason.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * Read from disk rather than through `import.meta.glob`.
 *
 * The glob is the usual way here, and it cannot reach the agent application:
 * Vite refuses a file outside the portal's own root. Both applications have
 * to be in one check, because the last instance of this defect was the agent's
 * ticket list carrying the very field the officer queue had just been given —
 * two halves of one class, and a per-application check would have caught one
 * of them and not the other.
 */
/**
 * The repository root, found by walking up until both applications are under
 * it.
 *
 * Not `process.cwd()`, which is the repository root when vitest is invoked
 * with `--root apps/portal` from above and `apps/portal` when it is invoked
 * from inside — and not `import.meta.url`, which vitest does not hand back as
 * a file URL. Walking is the one form that does not care how it was started.
 */
function repositoryRoot(): string {
  let at = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(join(at, 'apps', 'portal', 'src', 'screens'))) return at;
    at = dirname(at);
  }
  throw new Error(`Could not find the repository root from ${process.cwd()}`);
}

const ROOT = repositoryRoot();

const SOURCES: Record<string, string> = Object.fromEntries(
  (['portal', 'agent'] as const).flatMap((app) => {
    const dir = join(ROOT, 'apps', app, 'src', 'screens');
    return readdirSync(dir)
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => [`${app}/${file}`, readFileSync(join(dir, file), 'utf8')] as const);
  }),
);

/**
 * The field names whose absence changes an answer.
 *
 * Timestamps, statuses, counts, ages, and the two words this platform uses
 * for "what actually happened" — `detail` and `reason`.
 */
const CARRIES_STATE =
  /^(.*_at|.*At|status|.*Status|.*_status|.*[Cc]ount|days.*|months.*|.*Total|reason|body|detail|.*Detail)$/;

/**
 * Fields that are declared and not drawn, each with why that is right.
 *
 * A reason per entry, not a bare list: the point of this check is that each
 * one was judged once, and a name with no argument beside it is a backlog
 * pretending to be a decision.
 */
const NOT_DRAWN_ON_PURPOSE: Record<string, string> = {
  'portal/Oversight.tsx JobReport.lastStartedAt': `
    The board shows when a job last SUCCEEDED, and says why in its own
    comment: "Not 'last run'. A job throwing since Tuesday has a recent run
    and no recent success, and that is the distinction worth a column." The
    start time is consumed server-side to compute OVERDUE and STALLED, which
    is where it does its work.`,

  'portal/MyAccess.tsx SessionRow.expires_at': `
    The table already shows issued, last used and status. Status is the
    answer to "is this session live", and it is the one an officer can act
    on — they revoke a session rather than wait for it to lapse. An expiry
    adds a column that supports no decision.`,

  'portal/MyAccess.tsx SessionRow.device_status': `
    The device's own status has its own table below this one, where the
    controls that change it live. Repeating it against every session would
    show the same value on every row and invite somebody to act on it in the
    place where they cannot.`,

  'portal/Charge.tsx InvoiceRecord.transaction_status': `
    The invoice screen renders the invoice's own status, and the transaction
    is a link away with its own badge. Two statuses side by side on one
    record is how somebody reads the wrong one.`,

  'agent/Collect.tsx Obligation.transaction_status': `
    Same reason. The outstanding list is a list of debts; a transaction
    status belongs to the payment attempt and is shown on the transaction
    screen the row opens.`,

  'agent/Collect.tsx Obligation.issued_at': `
    The list shows what is owed and what it is for. An agent standing in
    front of somebody collects against the debt, not against its age, and
    the arrears worklist is where age is the question.`,

  'portal/Workbench.tsx SampleItem.transaction_status': `
    An audit sample item is reviewed on its own merits; the transaction's
    current status is what the auditor goes and checks, not what the
    worksheet asserts for them.`,

  'portal/Platform.tsx IntegrationReport.lastCalledAt': `
    The integration board reports the outcome of the last call and whether
    the service is answering. When it was last called is only meaningful
    against the call interval, which this screen does not know — the
    unattended-work board is where that comparison is made.`,

  'agent/Application.tsx KycDocument.uploaded_at': `
    The applicant sees whether each document is accepted, rejected or still
    being reviewed. When they uploaded it does not change what they should
    do next, and the rejection reason — which does — is rendered.`,

  'agent/More.tsx BankChange.requestedAt': `
    The list shows the change and its status. An agent has one bank change
    in flight at a time, so there is nothing to order and no second row to
    tell it apart from.`,

  'portal/Groups.tsx MemberRow.attested_at': `
    Attestation is shown as a state on the row. The date is on the
    attestation record itself, which is what an officer opens when they are
    checking whether it was done properly rather than whether it was done.`,

  'portal/Groups.tsx MemberRow.left_at': `
    A member who has left is rendered by their membership state. The list is
    of who is in the group now.`,

  'portal/Cases.tsx CaseRow.comment_count': `
    The list is for deciding which case to open, and status, priority, due
    date and assignee answer that. How much has been said on a case does not:
    a busy thread may be one being handled well. The evidence count beside it
    IS drawn, because a case with nothing attached cannot be concluded at all,
    which is a different kind of fact.`,

  'portal/Workbench.tsx SampleRow.completed_at': `
    The worksheet shows the sample's status and how many items are still
    pending, which together say whether it is finished and how much is left —
    the two things an auditor picking up the work needs. When it finished is
    part of the audit record the signed report cites, not part of choosing
    what to do next.`,

  'portal/Workbench.tsx SampleItem.reviewed_at': `
    Each item shows its outcome, which is what says whether it has been looked
    at and what was found. The timestamp belongs to the audit trail behind the
    report rather than to the worksheet somebody is working through.`,

  'portal/Workbench.tsx ReportRow.signed_at': `
    The table draws who signed it, with a dash when nobody has — so signed and
    unsigned are already distinguishable, which is the decision. The report
    itself carries a checksum precisely so the artefact is the record; a
    signing time on the row would be a second, weaker copy of it.`,

  'portal/Groups.tsx AwardRow.awarded_at': `
    The allocations screen is where a round's dates are shown and compared.
    This list answers who received what.`,
};

/** Fields that SHOULD be drawn and are — listed so a regression is visible. */
function declaredButNeverRead(source: string): string[] {
  const found: string[] = [];
  for (const block of source.matchAll(/(?:^|\n)(?:export )?interface (\w+) \{([\s\S]*?)\n\}/g)) {
    const [, name, body] = block;
    const outside = source.slice(0, block.index) + source.slice(block.index! + block[0].length);
    for (const field of [...body!.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!)) {
      if (!CARRIES_STATE.test(field)) continue;
      if ((outside.match(new RegExp(`\\b${field}\\b`, 'g')) || []).length === 0) {
        found.push(`${name}.${field}`);
      }
    }
  }
  return found;
}

describe('nothing the server sends is dropped without a reason', () => {
  it('reads both applications', () => {
    // A reader that stopped finding files would make the checks below pass by
    // looking at nothing, which is this test's own version of the bug.
    const apps = [...new Set(Object.keys(SOURCES).map((path) => path.split('/')[0]))].sort();
    assert.deepEqual(apps, ['agent', 'portal']);
    assert.ok(
      Object.keys(SOURCES).length > 40,
      `only ${Object.keys(SOURCES).length} screens were read`,
    );
  });

  it('draws every field that carries state, or says why not', () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      for (const field of declaredButNeverRead(source)) {
        const site = `${path} ${field}`;
        if (!(site in NOT_DRAWN_ON_PURPOSE)) offenders.push(site);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('has no exemption for a field that is now drawn', () => {
    /*
     * The other direction. An exemption left behind after somebody renders
     * the field is a reason nobody will re-read, and it would silently excuse
     * the field going missing again later.
     */
    const live = new Set<string>();
    for (const [path, source] of Object.entries(SOURCES)) {
      for (const field of declaredButNeverRead(source)) live.add(`${path} ${field}`);
    }
    const stale = Object.keys(NOT_DRAWN_ON_PURPOSE).filter((site) => !live.has(site));
    assert.deepEqual(stale, []);
  });

  it('gives every exemption an actual argument', () => {
    // A name with no reason beside it is a backlog pretending to be a
    // decision, which is what this check exists to stop.
    for (const [site, reason] of Object.entries(NOT_DRAWN_ON_PURPOSE)) {
      assert.ok(reason.trim().length > 60, `${site} has no reason beside it`);
    }
  });
});
