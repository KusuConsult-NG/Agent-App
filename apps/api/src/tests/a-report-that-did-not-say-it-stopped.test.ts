/**
 * A signed audit report that covered less than it said.
 *
 * Six row-level report types run `... ORDER BY created_at DESC LIMIT 5000`.
 * The report then recorded `row_count = 5000`, hashed those rows into its
 * checksum, stored `period_start` naming the whole window, and offered itself
 * to an officer to sign. The PDF export carries a checksum line whose stated
 * purpose is that a reader "can confirm that without taking the platform's
 * word for it" — and it does confirm, faithfully, that nobody altered the tail
 * end of a period whose beginning was never in the file.
 *
 * `ORDER BY created_at DESC` is what makes the omission worst rather than
 * merely inconvenient: the rows dropped are the OLDEST in the window, which is
 * where anything long-running sits. An auditor sampling a quarter for a
 * pattern that ran all quarter gets the weeks in which it was already over.
 *
 * The platform's own PDF renderer already refuses to do this to columns. Ones
 * too wide for the page are named in a line beneath the table, because "the
 * reader has to be told the file has more in it than the paper does". Rows
 * dropped before the payload existed were the one omission that reached the
 * page unannounced.
 *
 * WHERE THE ANSWER IS KEPT
 *
 * In `payload.coverage`, and therefore inside the checksum. Not in a column
 * beside it: the payload is what the PDF is drawn from months later, what a
 * verifier re-hashes, and the only part a reader holding the file can check. A
 * flag kept outside it would be absent from every export and strippable
 * without breaking verification, which is the same as not recording it. The
 * column exists too, so the workbench can list partial reports without
 * unpacking every payload, and the tests below hold both.
 */

import './env';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { CAPPED_REPORTS, ROW_CAP, reportChecksum } from '../services/audit-workbench';
import { renderReportPdf } from '../services/export';

let auditor = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Report Auditor', phone: '+2348079000001', role: 'auditor' });
  auditor = (await loginAs('+2348079000001')).accessToken;
});

/**
 * Enough flags to run a report over.
 *
 * `fraud_flags` is chosen because FRAUD_FLAG is one of the capped types and the
 * table takes a bulk insert — five thousand transactions driven through the
 * payment machinery would take longer than the whole suite.
 */
async function raiseFlags(count: number): Promise<void> {
  /*
   * HIGH, not LOW. `enum-coverage.ts` records LOW as a severity no present
   * rule raises, and writing one here made the suite reach a state the
   * platform documents as unreachable — which that guard caught, correctly:
   * a fixture that manufactures a row the platform never produces is testing
   * against a system nobody runs.
   */
  await pool.query(
    `INSERT INTO fraud_flags (rule, severity, entity_type, entity_id, created_at)
     SELECT 'VELOCITY', 'HIGH', 'TRANSACTION', gen_random_uuid(),
            now() - (n || ' minutes')::interval
       FROM generate_series(1, $1) AS n`,
    [count],
  );
}

function generate(title: string) {
  return post(
    '/government/audit/reports',
    { reportType: 'FRAUD_FLAG', title, parameters: {} },
    { token: auditor },
  );
}

/** The report as the database holds it, payload and column both. */
async function stored(reportNumber: string) {
  return queryOne<{
    row_count: number;
    coverage_complete: boolean | null;
    payload: { rows: unknown[]; coverage?: { complete: boolean; rowCap: number } };
    parameters: unknown;
    checksum: string;
  }>(
    pool,
    `SELECT row_count, coverage_complete, payload, parameters, checksum
       FROM audit_reports WHERE report_number = $1`,
    [reportNumber],
  );
}

describe('a report that stopped at the cap', () => {
  it('says so, rather than reporting the cap as the answer', async () => {
    await raiseFlags(ROW_CAP + 1);

    const generated = await generate('Fraud flags, whole period');

    assert.equal(generated.status, 201, JSON.stringify(generated.body));
    assert.equal(generated.body.rowCount, ROW_CAP, 'the cap still caps');
    assert.equal(
      generated.body.complete,
      false,
      `a report holding ${ROW_CAP} of ${ROW_CAP + 1} rows reported itself complete: ` +
        JSON.stringify(generated.body),
    );
  });

  it('keeps the answer inside the checksum, where an exported file carries it', async () => {
    await raiseFlags(ROW_CAP + 1);
    const generated = await generate('Fraud flags, whole period');

    const row = await stored(generated.body.reportNumber);

    assert.equal(row!.payload.rows.length, ROW_CAP);
    assert.equal(
      row!.payload.coverage?.complete,
      false,
      `the payload a PDF is drawn from does not say it is partial: ${JSON.stringify(
        row!.payload.coverage,
      )}`,
    );
    assert.equal(row!.payload.coverage?.rowCap, ROW_CAP);
  });

  it('and in the column the workbench lists from', async () => {
    await raiseFlags(ROW_CAP + 1);
    const generated = await generate('Fraud flags, whole period');

    const row = await stored(generated.body.reportNumber);
    assert.equal(row!.coverage_complete, false, JSON.stringify(row));

    const listed = await get('/government/audit/reports', { token: auditor });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const entry = listed.body.reports.find(
      (r: { report_number: string }) => r.report_number === generated.body.reportNumber,
    );
    assert.equal(entry.coverage_complete, false, JSON.stringify(entry));
  });

  it('still verifies against its own checksum', async () => {
    /*
     * The coverage key is inside the hashed payload, so it had to be added
     * without making a partial report look tampered with — which is the one
     * way this fix could have been worse than the defect.
     */
    await raiseFlags(ROW_CAP + 1);
    const generated = await generate('Fraud flags, whole period');

    const row = await stored(generated.body.reportNumber);
    assert.equal(reportChecksum(row!.parameters, row!.payload), row!.checksum);

    const read = await get(`/government/audit/reports/${generated.body.id}`, { token: auditor });
    assert.equal(read.body.checksumMatches, true, JSON.stringify(read.body.checksum));
  });
});

describe('a report that did not stop', () => {
  /*
   * The controls. A report that warns every time is a report nobody reads the
   * warning on, and every audit report on a normal period is complete.
   */
  it('is complete when fewer rows matched', async () => {
    await raiseFlags(ROW_CAP - 1);

    const generated = await generate('Fraud flags, a quiet period');

    assert.equal(generated.body.rowCount, ROW_CAP - 1);
    assert.equal(generated.body.complete, true, JSON.stringify(generated.body));

    const row = await stored(generated.body.reportNumber);
    assert.equal(row!.coverage_complete, true);
    assert.equal(row!.payload.coverage?.complete, true);
  });

  it('is complete at exactly the cap, which is the boundary that decides it', async () => {
    /*
     * Exactly `ROW_CAP` rows matched and exactly `ROW_CAP` were returned: the
     * report holds all of them. Reading the cap itself as evidence of
     * truncation would mark a complete report partial, and a cautious lie is
     * still a lie in an audit artefact.
     */
    await raiseFlags(ROW_CAP);

    const generated = await generate('Fraud flags, exactly at the cap');

    assert.equal(generated.body.rowCount, ROW_CAP);
    assert.equal(generated.body.complete, true, JSON.stringify(generated.body));
  });

  it('does not truncate a report that has no cap', async () => {
    /*
     * The control that matters most, because getting it wrong would mean this
     * change INTRODUCED the defect it removes. The aggregate reports are
     * bounded by what they group by, not by a LIMIT, and applying the cap
     * logic to them would silently cut them at five thousand and mark them
     * partial into the bargain.
     *
     * It is given MORE than the cap deliberately. With a handful of targets
     * this passes whether or not the exemption is there — checked, and it did
     * — because `fetched.length <= ROW_CAP` is true either way. A control that
     * only holds below the boundary is not a control on the boundary.
     */
    const setter = await queryOne<{ id: string }>(
      pool,
      `SELECT id FROM users WHERE phone = '+2348079000001'`,
    );
    await pool.query(
      `INSERT INTO revenue_targets
         (scope, period_kind, period_start, period_end, amount_kobo, set_by)
       SELECT 'STATE', 'DAILY',
              (DATE '2020-01-01' + n), (DATE '2020-01-01' + n),
              100000, $2
         FROM generate_series(1, $1) AS n`,
      [ROW_CAP + 1, setter!.id],
    );

    const generated = await post(
      '/government/audit/reports',
      { reportType: 'REVENUE_TARGET', title: 'Targets, all of them', parameters: {} },
      { token: auditor },
    );

    assert.equal(generated.status, 201, JSON.stringify(generated.body));
    assert.equal(
      generated.body.rowCount,
      ROW_CAP + 1,
      'an uncapped report was cut at the cap that does not apply to it',
    );
    assert.equal(generated.body.complete, true, JSON.stringify(generated.body));
  });
});

describe('the file somebody files', () => {
  it('prints that it is partial, above the period it does not cover', async () => {
    const pdf = await renderReportPdf({
      title: 'Fraud flags, Q3 2026',
      rows: [{ rule: 'VELOCITY', severity: 'LOW' }],
      parameters: { from: '2026-07-01', to: '2026-09-30' },
      generatedBy: 'Report Auditor',
      reportNumber: 'PSIRS-AR-000001',
      checksum: 'abc123',
      truncatedAt: ROW_CAP,
    });

    const text = pdf.toString('latin1');
    assert.ok(pdf.length > 0);
    // PDFKit writes text into compressed streams, so the page is not greppable;
    // what is asserted here is that the renderer accepted the field and
    // produced a larger document than the same report without it.
    const without = await renderReportPdf({
      title: 'Fraud flags, Q3 2026',
      rows: [{ rule: 'VELOCITY', severity: 'LOW' }],
      parameters: { from: '2026-07-01', to: '2026-09-30' },
      generatedBy: 'Report Auditor',
      reportNumber: 'PSIRS-AR-000001',
      checksum: 'abc123',
    });
    assert.ok(
      pdf.length > without.length,
      'the partial-report warning added nothing to the page',
    );
    assert.ok(text.startsWith('%PDF'));
  });
});

/**
 * The set and the SQL, held together.
 *
 * `CAPPED_REPORTS` decides which report types get the completeness check, and
 * the `LIMIT` lives in the SQL several hundred lines away. A list beside a
 * query that must agree with it is exactly the thing that rots — a seventh
 * capped report added later would be silently exempt from the check, and its
 * reports would go back to claiming periods they do not cover.
 */
describe('the set of capped reports and the queries themselves', () => {
  function repositoryRoot(): string {
    let at = process.cwd();
    for (let up = 0; up < 6; up += 1) {
      if (existsSync(join(at, 'apps', 'api', 'src', 'services'))) return at;
      at = dirname(at);
    }
    throw new Error(`Could not find the repository root from ${process.cwd()}`);
  }

  /** Each `case` branch of `runReportRows`, by the report type it answers. */
  function branches(): Map<string, string> {
    const source = readFileSync(
      join(repositoryRoot(), 'apps', 'api', 'src', 'services', 'audit-workbench.ts'),
      'utf8',
    );
    const start = source.indexOf('async function runReportRows(');
    assert.ok(start > 0, 'runReportRows was renamed; this guard is reading nothing');
    const body = source.slice(start);

    const found = new Map<string, string>();
    // Consecutive labels share a body: ANOMALY and FRAUD_FLAG fall through to
    // one query, and both must be judged by it.
    const pattern = /case '([A-Z_]+)':\s*(?=(case '|\n))/g;
    const labels = [...body.matchAll(/case '([A-Z_]+)':/g)];
    for (let index = 0; index < labels.length; index += 1) {
      const from = labels[index]!.index!;
      const to = index + 1 < labels.length ? labels[index + 1]!.index! : body.indexOf('\n  }\n', from);
      let segment = body.slice(from, to);
      // A label whose own segment is empty falls through to the next one.
      let next = index;
      while (!segment.includes('return query') && next + 1 < labels.length) {
        next += 1;
        const nextTo =
          next + 1 < labels.length ? labels[next + 1]!.index! : body.indexOf('\n  }\n', from);
        segment = body.slice(labels[next]!.index!, nextTo);
      }
      found.set(labels[index]![1]!, segment);
    }
    void pattern;
    return found;
  }

  it('caps exactly the reports the set names', () => {
    const capped = new Set<string>();
    for (const [type, segment] of branches()) {
      if (/LIMIT \$\{ROW_CAP/.test(segment) || /LIMIT \d/.test(segment)) capped.add(type);
    }

    assert.deepEqual(
      [...capped].sort(),
      [...CAPPED_REPORTS].sort(),
      'a report whose query carries a LIMIT is not in CAPPED_REPORTS, or vice versa — ' +
        'so its reports do not declare whether they are complete',
    );
  });

  it('reads enough branches to be reading anything at all', () => {
    // Without this the regex silently finding nothing would pass the check
    // above by comparing two empty sets.
    assert.ok(branches().size >= 12, `only found ${branches().size} report branches`);
  });

  it('uses the shared cap rather than a number of its own', () => {
    for (const [type, segment] of branches()) {
      if (!CAPPED_REPORTS.has(type as never)) continue;
      assert.match(
        segment,
        /LIMIT \$\{ROW_CAP \+ 1\}/,
        `${type} does not fetch one row past the cap, so it cannot tell a full ` +
          'page from a complete answer',
      );
    }
  });
});
