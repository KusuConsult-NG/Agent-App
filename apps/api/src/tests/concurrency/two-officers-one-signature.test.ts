/**
 * Two officers signing one audit report at the same moment.
 *
 * `signReport` reads the report's status and refuses `ALREADY_SIGNED` if it is
 * signed, then writes the signature. The read takes no lock — no `FOR UPDATE`,
 * unlike `closePeriod` and `setTaxpayerStatus`, which lock the row they are
 * about to change. So two officers who open the same unsigned report both read
 * GENERATED and both go on to write.
 *
 * WHAT STOPS IT, AND WHAT THAT COSTS
 *
 * Nothing is overwritten: migration 062's trigger refuses the second write —
 * "who signed an audit report, and when, cannot be rewritten" — and the error
 * handler turns a P0001 into a 409. The integrity of the record is not the
 * problem.
 *
 * The sentence is. That message is about rewriting a signature, and rewriting
 * is not what the second officer did: they signed a report that was unsigned
 * when they looked at it. `ALREADY_SIGNED` says what happened and names the
 * report; `FINANCIAL_CONTROL_BLOCKED` names neither, carries a support
 * reference the officer has no use for, and is not in the portal's translation
 * map — so a Hausa-reading officer gets the database's English for a rule the
 * service was perfectly able to state itself.
 *
 * Signing an audit report is the act an officer's name goes on. It is also the
 * row `HAUSA-REVIEW-QUESTIONS.md` §7 names as the tier, for that reason.
 *
 * This is the fourth instance of one shape — read a status, refuse on it, write
 * without having locked it — after the agent application, the department code
 * and the KYC submission. The fix is the same three words.
 */

import '../env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from '../helpers';
import { query, queryOne } from '../../db/pool';
import { seedReferenceData } from '../../db/seed';
import { signReport, withdrawReport, type Viewer } from '../../services/audit-workbench';
import { ROLE_PERMISSIONS } from '@psirs/shared';

let first: Viewer;
let second: Viewer;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  const a = await createGovernmentUser({
    fullName: 'First Auditor',
    phone: '+2348089500001',
    role: 'auditor',
  });
  const b = await createGovernmentUser({
    fullName: 'Second Auditor',
    phone: '+2348089500002',
    role: 'auditor',
  });
  const permissions = ROLE_PERMISSIONS.auditor;
  first = { userId: a, role: 'auditor', permissions };
  second = { userId: b, role: 'auditor', permissions };
});

/**
 * A generated report, inserted rather than produced.
 *
 * `generateReport` runs thirteen report types against the whole schema and
 * none of what it computes matters here: this is about two writes to one row.
 */
async function generatedReport(): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO audit_reports
       (report_number, report_type, title, parameters, payload, row_count, checksum,
        generated_by, status)
     VALUES ('PSIRS-AR/2026/09001', 'TRANSACTION_AUDIT', 'A report two people open',
             '{}'::jsonb, '{"rows": []}'::jsonb, 0, 'deadbeef', $1, 'GENERATED')
     RETURNING id`,
    [first.userId],
  );
  return row!.id;
}

/** What each caller was told: 'ok', or the refusal's code. */
async function outcomes(
  calls: Promise<unknown>[],
): Promise<string[]> {
  const settled = await Promise.allSettled(calls);
  return settled
    .map((result) =>
      result.status === 'fulfilled'
        ? 'ok'
        : ((result.reason as { code?: string }).code ?? String(result.reason)),
    )
    .sort();
}

describe('two officers signing one report at the same moment', () => {
  it('tells the second that it is already signed, by name', async () => {
    const reportId = await generatedReport();

    const said = await outcomes([
      signReport(first, reportId, 'Examined and agreed to the settlement file.'),
      signReport(second, reportId, 'Examined the same report, a moment later.'),
    ]);

    assert.deepEqual(
      said,
      ['ALREADY_SIGNED', 'ok'],
      'FINANCIAL_CONTROL_BLOCKED here means the pre-check lost to the trigger, and the ' +
        'officer was told their signature could not be rewritten rather than that ' +
        'somebody else had already signed — a sentence about something they did not do, ' +
        'and one the portal cannot say in Hausa',
    );
  });

  it('records one signature, and whose it is', async () => {
    const reportId = await generatedReport();

    await outcomes([
      signReport(first, reportId, 'The first officer’s examination.'),
      signReport(second, reportId, 'The second officer’s examination.'),
    ]);

    const report = await queryOne<{ status: string; signed_by: string; signature_note: string }>(
      pool,
      'SELECT status, signed_by, signature_note FROM audit_reports WHERE id = $1',
      [reportId],
    );
    assert.equal(report!.status, 'SIGNED');
    assert.ok(
      [first.userId, second.userId].includes(report!.signed_by),
      'the signature belongs to one of the two officers who signed',
    );
    // The note has to be the note of whoever the signature says signed it.
    const expected = report!.signed_by === first.userId ? 'first officer' : 'second officer';
    assert.match(report!.signature_note, new RegExp(expected));
  });

  /*
   * And the audit trail does not claim two people signed it.
   *
   * `recordAudit` runs inside the same transaction as the write, so a refused
   * signature unwinds its own journal entry. That is worth asserting rather
   * than assuming: an audit trail saying two officers signed a report that
   * names one is worse than either alone.
   */
  it('journals one signing, not two', async () => {
    const reportId = await generatedReport();

    await outcomes([
      signReport(first, reportId, 'One examination.'),
      signReport(second, reportId, 'Another examination.'),
    ]);

    const entries = await query<{ actor_id: string }>(
      pool,
      `SELECT actor_id FROM audit_logs WHERE action = 'audit.report.sign' AND entity_id = $1`,
      [reportId],
    );
    assert.equal(entries.length, 1, JSON.stringify(entries));
  });
});

describe('two officers withdrawing one report at the same moment', () => {
  it('tells the second that it is already withdrawn, by name', async () => {
    const reportId = await generatedReport();

    const said = await outcomes([
      withdrawReport(first, reportId, 'Generated on the wrong period.'),
      withdrawReport(second, reportId, 'Also the wrong period.'),
    ]);

    assert.deepEqual(said, ['ALREADY_WITHDRAWN', 'ok'], JSON.stringify(said));
  });

  it('keeps the reason of the withdrawal that happened', async () => {
    const reportId = await generatedReport();

    await outcomes([
      withdrawReport(first, reportId, 'Withdrawn for the first reason.'),
      withdrawReport(second, reportId, 'Withdrawn for the second reason.'),
    ]);

    const report = await queryOne<{ status: string; withdrawn_reason: string }>(
      pool,
      'SELECT status, withdrawn_reason FROM audit_reports WHERE id = $1',
      [reportId],
    );
    assert.equal(report!.status, 'WITHDRAWN');
    assert.match(report!.withdrawn_reason, /the (first|second) reason/);
  });
});
