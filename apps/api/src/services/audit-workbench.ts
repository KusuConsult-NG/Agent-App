/**
 * The auditor's workpapers: a sample they can defend, and a report that stays
 * the report.
 *
 * Everything an auditor needed to *ask* was already here. What was missing was
 * everywhere the asking has to leave a trace.
 *
 * SAMPLING. "I examined forty transactions from March" is worth nothing
 * without which forty and who chose them. A query re-run later is a different
 * query, and an auditor who can draw repeatedly until the results look
 * interesting has done something indistinguishable, afterwards, from drawing
 * once. So a draw is an event: criteria, method, seed, population size and
 * every selected row are written down at the moment of drawing and fixed
 * there by migration 062. What moves afterwards is the finding on each item,
 * which is the actual work.
 *
 * REPORTS. A finding signed in March and opened in June has to be the same
 * document. Reversals land, corrections are approved, a taxpayer is merged,
 * and a live query quietly changes its mind about what it said. Generating a
 * report freezes its rows and takes a SHA-256 over the canonical form, so the
 * freeze is checkable rather than merely asserted.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not compute an opinion, a risk
 * score or a pass mark. A number with a formula behind it becomes the thing
 * people manage to, and an audit conclusion is a person's judgement with their
 * name on it.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import type { Permission } from '@psirs/shared';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound } from '../lib/errors';
import { canonicalJson, recordAudit } from './audit';
import {
  resolveReportScope,
  scopeParams,
  transactionScopeSql,
  type ReportScope,
} from './report-scope';

export interface Viewer {
  userId: string;
  role: string;
  permissions: readonly Permission[];
}

// ===========================================================================
// Sampling
// ===========================================================================

export type SampleMethod = 'RANDOM' | 'SYSTEMATIC' | 'HIGHEST_VALUE';

export interface SampleCriteria {
  from?: string | null;
  to?: string | null;
  revenueCategoryId?: string | null;
  lgaId?: string | null;
  agentId?: string | null;
  minimumKobo?: string | null;
  maximumKobo?: string | null;
  status?: string | null;
}

export interface DrawInput {
  title: string;
  method: SampleMethod;
  size: number;
  criteria: SampleCriteria;
  /** Supplied only so a reviewer can reproduce a draw; otherwise generated. */
  seed?: string | null;
}

/*
 * A sample bigger than this is not a sample, it is a re-export of the ledger
 * with extra ceremony -- and every row of it has to be held in memory, written
 * as a row, and worked through by a person. The cap is on what one auditor can
 * actually examine rather than on what postgres can return.
 */
const MAXIMUM_SAMPLE = 500;

/**
 * The population, as a WHERE clause and its parameters.
 *
 * Built once and used twice -- to count the population and to draw from it --
 * because a count taken against different criteria than the draw would put a
 * defensible-looking denominator underneath an undefensible sample.
 */
function populationSql(
  criteria: SampleCriteria,
  scope: ReturnType<typeof scopeParams>,
): { where: string; params: unknown[] } {
  const params: unknown[] = [scope.statewide, scope.territoryIds];
  const conditions: string[] = [transactionScopeSql('t', 1, 2)];

  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace('$?', `$${params.length}`));
  };

  if (criteria.from) add('t.created_at >= $?::date', criteria.from);
  // The end of the day, not the start of it: an auditor asking for March means
  // the whole of the 31st, and a half-open bound would silently drop it.
  if (criteria.to) add("t.created_at < ($?::date + interval '1 day')", criteria.to);
  if (criteria.revenueCategoryId) add('ri.category_id = $?', criteria.revenueCategoryId);
  if (criteria.lgaId) add('t.lga_id = $?', criteria.lgaId);
  if (criteria.agentId) add('t.agent_id = $?', criteria.agentId);
  if (criteria.minimumKobo) add('t.total_amount_kobo >= $?::bigint', criteria.minimumKobo);
  if (criteria.maximumKobo) add('t.total_amount_kobo <= $?::bigint', criteria.maximumKobo);
  if (criteria.status) add('t.status = $?', criteria.status);

  return { where: conditions.join(' AND '), params };
}

/**
 * Draw a sample.
 *
 * The seed is stored, not derived. A seed you cannot see is not something
 * anybody can check, and the whole claim being made here -- that the selection
 * was not steered -- rests on a reviewer being able to reproduce it.
 *
 * Ordering is by `md5(seed || id)` rather than by `random()`. Postgres's
 * `setseed` is per-session state that a pooled connection carries into
 * somebody else's query, and a draw whose reproducibility depends on which
 * connection served it is not reproducible at all. Hashing the row's own id
 * with the seed is deterministic, independent of the connection, and gives the
 * same order for the same seed and the same population forever.
 */
export async function drawSample(
  viewer: Viewer,
  input: DrawInput,
): Promise<{ id: string; sampleNumber: string; populationSize: number; sampleSize: number }> {
  if (input.size < 1 || input.size > MAXIMUM_SAMPLE) {
    throw badRequest(
      `A sample is between 1 and ${MAXIMUM_SAMPLE} transactions.`,
      [{ field: 'size', issue: `Between 1 and ${MAXIMUM_SAMPLE}.` }],
    );
  }
  if (input.criteria.from && input.criteria.to && input.criteria.from > input.criteria.to) {
    throw badRequest('The sample period ends before it begins.', [
      { field: 'criteria.to', issue: 'Must not be before the start date.' },
    ]);
  }

  const scope = scopeParams(await resolveReportScope(pool, viewer));
  const seed = input.seed?.trim() || randomUUID();

  return withTransaction(async (client) => {
    const { where, params } = populationSql(input.criteria, scope);

    const population = await queryOne<{ count: string }>(
      client,
      `SELECT count(*)::text AS count
         FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
        WHERE ${where}`,
      params,
    );
    const populationSize = Number.parseInt(population!.count, 10);
    if (populationSize === 0) {
      throw conflict(
        'EMPTY_POPULATION',
        'No transactions match those criteria, so there is nothing to sample.',
        'Widen the period, the category or the value band.',
      );
    }

    /*
     * Three orderings, one draw.
     *
     * RANDOM is the hash order described above. SYSTEMATIC walks the
     * population in chronological order and takes every nth, which is what an
     * auditor means by an interval sample and which catches a pattern that
     * repeats -- a particular hour, a particular day of the week -- that a
     * random draw can miss. HIGHEST_VALUE is not a sample and is named so that
     * nobody writes it up as one; it is the materiality pass.
     */
    const size = Math.min(input.size, populationSize);
    const interval = Math.max(1, Math.floor(populationSize / size));

    /*
     * Each method binds exactly what it reads.
     *
     * An earlier draft shared one parameter list across all three and passed a
     * null where the seed would have gone; postgres refuses a bind with more
     * parameters than the statement mentions, so the materiality pass failed
     * outright. Building the tail per method is both shorter and the only
     * version that runs.
     */
    const next = params.length;
    const drawn = await (async () => {
      if (input.method === 'SYSTEMATIC') {
        return query<{ id: string }>(
          client,
          `SELECT id FROM (
             SELECT t.id, row_number() OVER (ORDER BY t.created_at, t.id) AS rn
               FROM transactions t
               JOIN revenue_items ri ON ri.id = t.revenue_item_id
              WHERE ${where}
           ) ordered
            WHERE (rn - 1) % $${next + 1}::int = 0
            ORDER BY rn
            LIMIT $${next + 2}`,
          [...params, interval, size],
        );
      }
      if (input.method === 'HIGHEST_VALUE') {
        return query<{ id: string }>(
          client,
          `SELECT t.id
             FROM transactions t
             JOIN revenue_items ri ON ri.id = t.revenue_item_id
            WHERE ${where}
            ORDER BY t.total_amount_kobo DESC, t.id
            LIMIT $${next + 1}`,
          [...params, size],
        );
      }
      return query<{ id: string }>(
        client,
        `SELECT t.id
           FROM transactions t
           JOIN revenue_items ri ON ri.id = t.revenue_item_id
          WHERE ${where}
          ORDER BY md5($${next + 1} || t.id::text)
          LIMIT $${next + 2}`,
        [...params, seed, size],
      );
    })();

    const sampleNumber = await nextNumber(client, 'audit_sample_number_seq', 'PSIRS-SMP');

    const sample = await queryOne<{ id: string }>(
      client,
      `INSERT INTO audit_samples (
         sample_number, title, method, criteria, seed,
         population_size, sample_size, drawn_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        sampleNumber,
        input.title.trim(),
        input.method,
        JSON.stringify({ ...input.criteria, scope: scope.statewide ? 'STATEWIDE' : 'TERRITORY' }),
        seed,
        populationSize,
        drawn.length,
        viewer.userId,
      ],
    );

    for (const [index, row] of drawn.entries()) {
      await client.query(
        `INSERT INTO audit_sample_items (sample_id, transaction_id, position)
         VALUES ($1,$2,$3)`,
        [sample!.id, row.id, index + 1],
      );
    }

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'audit.sample.draw',
      entityType: 'audit_sample',
      entityId: sample!.id,
      newValue: {
        sampleNumber,
        method: input.method,
        seed,
        populationSize,
        sampleSize: drawn.length,
        criteria: input.criteria,
      },
      reason: input.title.trim(),
    });

    return {
      id: sample!.id,
      sampleNumber,
      populationSize,
      sampleSize: drawn.length,
    };
  });
}

/** The auditor's finding on one drawn item. */
export async function recordFinding(
  viewer: Viewer,
  itemId: string,
  input: { outcome: 'CLEAN' | 'EXCEPTION' | 'NOT_AVAILABLE'; finding?: string | null; caseId?: string | null },
): Promise<void> {
  await withTransaction(async (client) => {
    const item = await queryOne<{
      id: string;
      sample_id: string;
      outcome: string;
      transaction_id: string;
      sample_status: string;
    }>(
      client,
      `SELECT i.id, i.sample_id, i.outcome, i.transaction_id, s.status AS sample_status
         FROM audit_sample_items i
         JOIN audit_samples s ON s.id = i.sample_id
        WHERE i.id = $1`,
      [itemId],
    );
    if (!item) throw notFound('Sample item');
    if (item.sample_status === 'COMPLETED') {
      throw conflict(
        'SAMPLE_COMPLETED',
        'This sample has been completed and its findings are final.',
        'Draw a new sample to examine these transactions again.',
      );
    }
    /*
     * An exception has to say what it is.
     *
     * A finding of "exception" with no words is the least useful thing an
     * audit file can contain: it stops the transaction and tells the next
     * reader nothing about why.
     */
    if (input.outcome === 'EXCEPTION' && !input.finding?.trim()) {
      throw badRequest('An exception needs a finding that says what was wrong.', [
        { field: 'finding', issue: 'Required when the outcome is an exception.' },
      ]);
    }

    await client.query(
      `UPDATE audit_sample_items
          SET outcome = $2, finding = $3, case_id = $4,
              reviewed_by = $5, reviewed_at = now()
        WHERE id = $1`,
      [itemId, input.outcome, input.finding?.trim() ?? null, input.caseId ?? null, viewer.userId],
    );

    // The sample moves to IN_REVIEW on its first finding; nothing else moves it.
    await client.query(
      `UPDATE audit_samples SET status = 'IN_REVIEW' WHERE id = $1 AND status = 'DRAWN'`,
      [item.sample_id],
    );

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'audit.sample.finding',
      entityType: 'audit_sample_item',
      entityId: itemId,
      oldValue: { outcome: item.outcome },
      newValue: { outcome: input.outcome, transactionId: item.transaction_id },
      reason: input.finding?.trim() ?? null,
    });
  });
}

/**
 * Close a sample.
 *
 * Refused while items are still PENDING. A sample abandoned half way through
 * and reported as complete is worse than no sample: the denominator says forty
 * and the work says eleven, and nothing on the page distinguishes them.
 */
export async function completeSample(
  viewer: Viewer,
  sampleId: string,
  note: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const sample = await queryOne<{ id: string; status: string; pending: string }>(
      client,
      `SELECT s.id, s.status,
              (SELECT count(*)::text FROM audit_sample_items i
                WHERE i.sample_id = s.id AND i.outcome = 'PENDING') AS pending
         FROM audit_samples s
        WHERE s.id = $1`,
      [sampleId],
    );
    if (!sample) throw notFound('Sample');
    if (sample.status === 'COMPLETED') {
      throw conflict('SAMPLE_COMPLETED', 'This sample is already complete.');
    }
    if (Number.parseInt(sample.pending, 10) > 0) {
      throw conflict(
        'SAMPLE_INCOMPLETE',
        `${sample.pending} item(s) in this sample have not been examined.`,
        'Record a finding on each item first.',
      );
    }

    await client.query(
      `UPDATE audit_samples SET status = 'COMPLETED', completed_at = now(), note = $2
        WHERE id = $1`,
      [sampleId, note.trim()],
    );

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'audit.sample.complete',
      entityType: 'audit_sample',
      entityId: sampleId,
      oldValue: { status: sample.status },
      newValue: { status: 'COMPLETED' },
      reason: note.trim(),
    });
  });
}

export async function listSamples(db: Db, filters: { status?: string | null; limit?: number }) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return query(
    db,
    `SELECT s.id, s.sample_number, s.title, s.method, s.criteria, s.seed,
            s.population_size, s.sample_size, s.status, s.drawn_at, s.completed_at,
            u.full_name AS drawn_by_name,
            (SELECT count(*)::int FROM audit_sample_items i
              WHERE i.sample_id = s.id AND i.outcome = 'EXCEPTION') AS exceptions,
            (SELECT count(*)::int FROM audit_sample_items i
              WHERE i.sample_id = s.id AND i.outcome = 'PENDING') AS pending
       FROM audit_samples s
       LEFT JOIN users u ON u.id = s.drawn_by
      WHERE ($1::text IS NULL OR s.status = $1)
      ORDER BY s.drawn_at DESC
      LIMIT $2`,
    [filters.status ?? null, limit],
  );
}

export async function getSample(db: Db, sampleId: string) {
  const sample = await queryOne(
    db,
    `SELECT s.id, s.sample_number, s.title, s.method, s.criteria, s.seed,
            s.population_size, s.sample_size, s.status, s.drawn_at, s.completed_at, s.note,
            u.full_name AS drawn_by_name
       FROM audit_samples s
       LEFT JOIN users u ON u.id = s.drawn_by
      WHERE s.id = $1`,
    [sampleId],
  );
  if (!sample) throw notFound('Sample');

  const items = await query(
    db,
    `SELECT i.id, i.position, i.outcome, i.finding, i.reviewed_at,
            i.case_id, c.case_number,
            r.full_name AS reviewed_by_name,
            t.id AS transaction_id, t.transaction_reference, t.total_amount_kobo,
            t.status AS transaction_status, t.created_at AS transaction_at,
            l.name AS lga_name,
            a.agent_code,
            COALESCE(tp.business_name,
                     tp.first_name || ' ' || COALESCE(tp.last_name, '')) AS taxpayer_name
       FROM audit_sample_items i
       JOIN transactions t ON t.id = i.transaction_id
       JOIN lgas l ON l.id = t.lga_id
       JOIN taxpayers tp ON tp.id = t.taxpayer_id
       LEFT JOIN agents a ON a.id = t.agent_id
       LEFT JOIN users r ON r.id = i.reviewed_by
       LEFT JOIN cases c ON c.id = i.case_id
      WHERE i.sample_id = $1
      ORDER BY i.position`,
    [sampleId],
  );

  return { ...sample, items };
}

// ===========================================================================
// Reports
// ===========================================================================

export const REPORT_TYPES = [
  'TRANSACTION_AUDIT',
  'AGENT_ACTIVITY',
  'REVENUE_COLLECTION',
  'LGA_PERFORMANCE',
  'PAYMENT_RECONCILIATION',
  'COMMISSION',
  'USER_ACTIVITY',
  'ANOMALY',
  'AUDIT_SAMPLE',
  'FRAUD_FLAG',
  'REVENUE_TARGET',
  'PERIOD_CLOSING',
  'DATA_CHANGE',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportParameters {
  from?: string | null;
  to?: string | null;
  lgaId?: string | null;
  agentId?: string | null;
  sampleId?: string | null;
  userId?: string | null;
}

/**
 * The checksum a reviewer recomputes.
 *
 * Over the payload *and* the parameters, because a report is only as
 * meaningful as the question it answers: the same rows presented as "March"
 * when they were drawn for February is exactly the substitution this is meant
 * to catch, and hashing the rows alone would not notice it.
 */
export function reportChecksum(parameters: unknown, payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ parameters: canonicalJson(parameters), payload: canonicalJson(payload) }))
    .digest('hex');
}

/**
 * Generate a report: run the query once, freeze what it returned, sign nothing.
 *
 * Signing is a separate act by a separate endpoint, and often a separate
 * person. Conflating them would mean every generated draft carried somebody's
 * name whether or not they had read it.
 */
export async function generateReport(
  viewer: Viewer,
  input: { reportType: ReportType; title: string; parameters: ReportParameters },
): Promise<{ id: string; reportNumber: string; rowCount: number; checksum: string }> {
  const scope = await resolveReportScope(pool, viewer);

  return withTransaction(async (client) => {
    const rows = await runReportQuery(client, input.reportType, input.parameters, scope);
    /*
     * Hashed after the round trip that JSONB will do anyway.
     *
     * The driver hands back `Date` objects for timestamp columns. Stored, they
     * become ISO strings; hashed as objects, they contribute nothing, because
     * `canonicalJson` walks own keys and a Date has none. So the checksum taken
     * at generation described a payload with the dates missing, and the one
     * recomputed on read described the payload as stored -- and every report
     * reported itself as altered the first time anybody checked one. Doing the
     * serialisation once, here, is what makes the two ends comparable.
     */
    const payload = JSON.parse(JSON.stringify({ rows, generatedFor: scope.kind })) as unknown;
    const checksum = reportChecksum(input.parameters, payload);
    const reportNumber = await nextNumber(client, 'audit_report_number_seq', 'PSIRS-AR');

    const report = await queryOne<{ id: string }>(
      client,
      `INSERT INTO audit_reports (
         report_number, report_type, title, parameters, period_start, period_end,
         payload, row_count, checksum, generated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        reportNumber,
        input.reportType,
        input.title.trim(),
        JSON.stringify(input.parameters),
        input.parameters.from ?? null,
        input.parameters.to ?? null,
        JSON.stringify(payload),
        rows.length,
        checksum,
        viewer.userId,
      ],
    );

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'audit.report.generate',
      entityType: 'audit_report',
      entityId: report!.id,
      newValue: {
        reportNumber,
        reportType: input.reportType,
        rowCount: rows.length,
        checksum,
        parameters: input.parameters,
      },
      reason: input.title.trim(),
    });

    return { id: report!.id, reportNumber, rowCount: rows.length, checksum };
  });
}

/** Put an officer's name to the figures. */
export async function signReport(
  viewer: Viewer,
  reportId: string,
  note: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const report = await queryOne<{ id: string; status: string; report_number: string }>(
      client,
      'SELECT id, status, report_number FROM audit_reports WHERE id = $1',
      [reportId],
    );
    if (!report) throw notFound('Report');
    if (report.status === 'SIGNED') {
      throw conflict('ALREADY_SIGNED', `${report.report_number} has already been signed.`);
    }
    if (report.status === 'WITHDRAWN') {
      throw conflict(
        'REPORT_WITHDRAWN',
        `${report.report_number} was withdrawn and cannot be signed.`,
        'Generate a fresh report.',
      );
    }

    await client.query(
      `UPDATE audit_reports
          SET status = 'SIGNED', signed_by = $2, signed_at = now(), signature_note = $3
        WHERE id = $1`,
      [reportId, viewer.userId, note.trim()],
    );

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'audit.report.sign',
      entityType: 'audit_report',
      entityId: reportId,
      oldValue: { status: report.status },
      newValue: { status: 'SIGNED' },
      reason: note.trim(),
    });
  });
}

/**
 * Withdraw a report.
 *
 * The alternative -- deleting it -- is the thing the whole table exists to
 * prevent. "This report was issued and later withdrawn, for this reason, by
 * this officer" is itself a finding.
 */
export async function withdrawReport(
  viewer: Viewer,
  reportId: string,
  reason: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const report = await queryOne<{ id: string; status: string; report_number: string }>(
      client,
      'SELECT id, status, report_number FROM audit_reports WHERE id = $1',
      [reportId],
    );
    if (!report) throw notFound('Report');
    if (report.status === 'WITHDRAWN') {
      throw conflict('ALREADY_WITHDRAWN', `${report.report_number} is already withdrawn.`);
    }

    await client.query(
      `UPDATE audit_reports SET status = 'WITHDRAWN', withdrawn_reason = $2 WHERE id = $1`,
      [reportId, reason.trim()],
    );

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'audit.report.withdraw',
      entityType: 'audit_report',
      entityId: reportId,
      oldValue: { status: report.status },
      newValue: { status: 'WITHDRAWN' },
      reason: reason.trim(),
    });
  });
}

/**
 * The list, with every checksum rechecked rather than repeated.
 *
 * `getReport` has recomputed the checksum since the column was added, and an
 * API test proves it goes false when a stored payload is edited. Nothing ever
 * called it: the screen reads this list and only this list, and this list
 * returned `r.checksum` — the value recorded at generation, which is precisely
 * the value that does not change when somebody edits the rows underneath it.
 *
 * So a tampered report displayed its original checksum, in a column headed
 * "Checksum", beside a signature. A reader takes a checksum on a screen for a
 * checked one; there is no other reason to print a hash at a person. The
 * detection existed and reached nobody, which is the same as not having it,
 * except that it reads in code review as though the problem were solved.
 *
 * The payload is loaded to hash and then dropped — it is never returned, so
 * the list costs one hash per row on the server and nothing on the wire. That
 * is real work, bounded by `limit` and paid on an auditor's screen rather than
 * a hot path. Verifying on demand instead was the cheaper design and the wrong
 * one: nobody clicks "verify" on the report they have no reason to suspect,
 * which leaves the tampered one exactly as invisible as it was before.
 */
export async function listReports(db: Db, filters: { reportType?: string | null; limit?: number }) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const rows = await query<StoredReport>(
    db,
    `SELECT r.id, r.report_number, r.report_type, r.title, r.parameters,
            r.period_start, r.period_end, r.row_count, r.checksum, r.status,
            r.generated_at, r.signed_at, r.signature_note, r.withdrawn_reason,
            r.payload,
            g.full_name AS generated_by_name,
            s.full_name AS signed_by_name
       FROM audit_reports r
       LEFT JOIN users g ON g.id = r.generated_by
       LEFT JOIN users s ON s.id = r.signed_by
      WHERE ($1::text IS NULL OR r.report_type = $1)
      ORDER BY r.generated_at DESC
      LIMIT $2`,
    [filters.reportType ?? null, limit],
  );

  return rows.map(({ payload, ...row }) => ({
    ...row,
    checksumMatches: reportChecksum(row.parameters, payload) === row.checksum,
  }));
}

/**
 * One report, with its checksum recomputed rather than repeated.
 *
 * `checksumMatches` is the whole reason the column exists: a stored payload
 * that no longer hashes to the value recorded at generation has been altered
 * in the database, and the reader needs to be told so rather than shown
 * figures under a signature that no longer covers them.
 */
export interface StoredReport {
  id: string;
  report_number: string;
  report_type: string;
  title: string;
  parameters: unknown;
  period_start: string | null;
  period_end: string | null;
  payload: unknown;
  row_count: number;
  checksum: string;
  status: string;
  generated_at: string;
  signed_at: string | null;
  signature_note: string | null;
  withdrawn_reason: string | null;
  generated_by_name: string | null;
  signed_by_name: string | null;
}

export async function getReport(
  db: Db,
  reportId: string,
): Promise<StoredReport & { checksumMatches: boolean; recomputedChecksum: string }> {
  const report = await queryOne<StoredReport>(
    db,
    `SELECT r.id, r.report_number, r.report_type, r.title, r.parameters,
            r.period_start, r.period_end, r.payload, r.row_count, r.checksum,
            r.status, r.generated_at, r.signed_at, r.signature_note, r.withdrawn_reason,
            g.full_name AS generated_by_name,
            s.full_name AS signed_by_name
       FROM audit_reports r
       LEFT JOIN users g ON g.id = r.generated_by
       LEFT JOIN users s ON s.id = r.signed_by
      WHERE r.id = $1`,
    [reportId],
  );
  if (!report) throw notFound('Report');

  const recomputed = reportChecksum(report.parameters, report.payload);
  return { ...report, checksumMatches: recomputed === report.checksum, recomputedChecksum: recomputed };
}

// ===========================================================================

async function nextNumber(client: PoolClient, sequence: string, prefix: string): Promise<string> {
  const row = await queryOne<{ value: string }>(client, `SELECT nextval('${sequence}') AS value`);
  const year = new Date().getUTCFullYear();
  return `${prefix}/${year}/${String(row!.value).padStart(5, '0')}`;
}

/**
 * The thirteen questions, each frozen the same way.
 *
 * Every one of these was already answerable as a live query; what they were
 * missing was a moment. They are deliberately plain SELECTs returning rows
 * rather than computed verdicts -- see the note at the top of the file about
 * not producing an opinion.
 */
async function runReportQuery(
  client: PoolClient,
  reportType: ReportType,
  parameters: ReportParameters,
  scope: ReportScope,
): Promise<Record<string, unknown>[]> {
  const s = scopeParams(scope);
  const from = parameters.from ?? null;
  const to = parameters.to ?? null;

  /*
   * Two parameter shapes, not one.
   *
   * Reports that read transactions carry the territory scope; reports about
   * the platform's own machinery -- samples, periods, targets, the audit log
   * -- have no territory to be scoped by, and an earlier draft of this
   * function padded their parameter lists with predicates that were always
   * true so that every branch could share one array. That reads as a scope
   * check and is not one, which is exactly the confusion `report-scope.ts`
   * exists to prevent. Each branch now takes the parameters it uses.
   *
   * Both windows include the whole of the closing day. An auditor asking for
   * March means the 31st included, and a half-open bound silently drops it.
   */
  const scoped: unknown[] = [s.statewide, s.territoryIds, from, to];
  const dates: unknown[] = [from, to];
  const window = (alias: string, firstIndex: number) =>
    `($${firstIndex}::date IS NULL OR ${alias}.created_at >= $${firstIndex}::date)
     AND ($${firstIndex + 1}::date IS NULL OR ${alias}.created_at < ($${firstIndex + 1}::date + interval '1 day'))`;

  switch (reportType) {
    case 'TRANSACTION_AUDIT':
      return query(
        client,
        `SELECT t.transaction_reference, t.created_at, t.status,
                t.amount_kobo::text, t.service_charge_kobo::text, t.total_amount_kobo::text,
                t.channel, l.name AS lga, a.agent_code, ri.name AS revenue_item,
                COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,'')) AS taxpayer
           FROM transactions t
           JOIN lgas l ON l.id = t.lga_id
           JOIN revenue_items ri ON ri.id = t.revenue_item_id
           JOIN taxpayers tp ON tp.id = t.taxpayer_id
           LEFT JOIN agents a ON a.id = t.agent_id
          WHERE ${transactionScopeSql('t', 1, 2)} AND ${window('t', 3)}
          ORDER BY t.created_at DESC
          LIMIT 5000`,
        scoped,
      );

    case 'AGENT_ACTIVITY':
      return query(
        client,
        `SELECT a.agent_code, u.full_name AS agent_name, l.name AS lga,
                count(*)::text AS transactions,
                count(*) FILTER (WHERE t.status IN ('REVERSED','REFUNDED'))::text AS reversed,
                COALESCE(sum(t.amount_kobo) FILTER (
                  WHERE t.status IN ('PAYMENT_VERIFIED','RECEIPT_GENERATED','SETTLED')), 0)::text
                  AS collected_kobo
           FROM transactions t
           JOIN agents a ON a.id = t.agent_id
           JOIN users u ON u.id = a.user_id
           JOIN lgas l ON l.id = t.lga_id
          WHERE ${transactionScopeSql('t', 1, 2)} AND ${window('t', 3)}
          GROUP BY a.agent_code, u.full_name, l.name
          ORDER BY collected_kobo DESC`,
        scoped,
      );

    case 'REVENUE_COLLECTION':
      return query(
        client,
        `SELECT rc.name AS revenue_category, ri.name AS revenue_item,
                count(*)::text AS transactions,
                COALESCE(sum(t.amount_kobo), 0)::text AS revenue_kobo,
                COALESCE(sum(t.service_charge_kobo), 0)::text AS service_charge_kobo
           FROM transactions t
           JOIN revenue_items ri ON ri.id = t.revenue_item_id
           JOIN revenue_categories rc ON rc.id = ri.category_id
          WHERE ${transactionScopeSql('t', 1, 2)} AND ${window('t', 3)}
            AND t.status IN ('PAYMENT_VERIFIED','RECEIPT_GENERATED','SETTLED')
          GROUP BY rc.name, ri.name
          ORDER BY revenue_kobo DESC`,
        scoped,
      );

    case 'LGA_PERFORMANCE':
      return query(
        client,
        `SELECT l.name AS lga, l.code,
                count(*)::text AS transactions,
                count(DISTINCT t.taxpayer_id)::text AS taxpayers,
                COALESCE(sum(t.amount_kobo), 0)::text AS revenue_kobo
           FROM transactions t
           JOIN lgas l ON l.id = t.lga_id
          WHERE ${transactionScopeSql('t', 1, 2)} AND ${window('t', 3)}
            AND t.status IN ('PAYMENT_VERIFIED','RECEIPT_GENERATED','SETTLED')
          GROUP BY l.name, l.code
          ORDER BY revenue_kobo DESC`,
        scoped,
      );

    case 'PAYMENT_RECONCILIATION':
      return query(
        client,
        `SELECT p.payment_reference, p.gateway_reference, p.payment_method, p.status,
                p.amount_kobo::text, p.created_at, p.verified_at,
                t.transaction_reference,
                st.settlement_reference, st.status AS settlement_status
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
           LEFT JOIN settlements st ON st.id = p.settlement_id
          WHERE ${transactionScopeSql('t', 1, 2)} AND ${window('p', 3)}
          ORDER BY p.created_at DESC
          LIMIT 5000`,
        scoped,
      );

    case 'COMMISSION':
      return query(
        client,
        `SELECT a.agent_code, u.full_name AS agent_name, c.status,
                count(*)::text AS entries,
                COALESCE(sum(c.amount_kobo), 0)::text AS commission_kobo
           FROM commissions c
           JOIN transactions t ON t.id = c.transaction_id
           JOIN agents a ON a.id = c.agent_id
           JOIN users u ON u.id = a.user_id
          WHERE ${transactionScopeSql('t', 1, 2)} AND ${window('c', 3)}
          GROUP BY a.agent_code, u.full_name, c.status
          ORDER BY commission_kobo DESC`,
        scoped,
      );

    case 'USER_ACTIVITY':
      return query(
        client,
        `SELECT u.full_name, u.role, al.action,
                count(*)::text AS times,
                max(al.created_at) AS most_recent
           FROM audit_logs al
           JOIN users u ON u.id = al.actor_id
          WHERE ${window('al', 1)}
            AND ($3::uuid IS NULL OR al.actor_id = $3)
          GROUP BY u.full_name, u.role, al.action
          ORDER BY times DESC
          LIMIT 5000`,
        [...dates, parameters.userId ?? null],
      );

    case 'ANOMALY':
    case 'FRAUD_FLAG':
      return query(
        client,
        `SELECT f.rule, f.severity, f.status, f.entity_type, f.entity_id::text,
                f.detail, f.created_at, f.reviewed_at, f.resolution_note,
                a.agent_code
           FROM fraud_flags f
           LEFT JOIN agents a ON a.id = f.agent_id
          WHERE ${window('f', 1)}
          ORDER BY f.created_at DESC
          LIMIT 5000`,
        dates,
      );

    case 'AUDIT_SAMPLE':
      return query(
        client,
        `SELECT s.sample_number, s.title, s.method, s.population_size, s.sample_size,
                s.status, s.drawn_at, s.completed_at,
                count(*) FILTER (WHERE i.outcome = 'EXCEPTION')::text AS exceptions,
                count(*) FILTER (WHERE i.outcome = 'CLEAN')::text AS clean,
                count(*) FILTER (WHERE i.outcome = 'NOT_AVAILABLE')::text AS not_available
           FROM audit_samples s
           LEFT JOIN audit_sample_items i ON i.sample_id = s.id
          WHERE ($1::date IS NULL OR s.drawn_at >= $1::date)
            AND ($2::date IS NULL OR s.drawn_at < ($2::date + interval '1 day'))
          GROUP BY s.id
          ORDER BY s.drawn_at DESC`,
        dates,
      );

    case 'REVENUE_TARGET':
      return query(
        client,
        `SELECT rt.scope, rt.period_kind, rt.period_start, rt.period_end,
                rt.amount_kobo::text, rt.status, rt.created_at,
                l.name AS lga, rc.name AS revenue_category
           FROM revenue_targets rt
           LEFT JOIN lgas l ON l.id = rt.lga_id
           LEFT JOIN revenue_categories rc ON rc.id = rt.category_id
          WHERE ($1::date IS NULL OR rt.period_end >= $1::date)
            AND ($2::date IS NULL OR rt.period_start <= $2::date)
          ORDER BY rt.period_start DESC`,
        dates,
      );

    case 'PERIOD_CLOSING':
      return query(
        client,
        `SELECT fp.label, fp.period_start, fp.period_end, fp.status,
                fp.created_at, fp.closed_at, fp.closing_note, fp.reopened_at,
                o.full_name AS closed_by_name
           FROM financial_periods fp
           LEFT JOIN users o ON o.id = fp.closed_by
          WHERE ($1::date IS NULL OR fp.period_end >= $1::date)
            AND ($2::date IS NULL OR fp.period_start <= $2::date)
          ORDER BY fp.period_start DESC`,
        dates,
      );

    case 'DATA_CHANGE':
      return query(
        client,
        `SELECT al.created_at, u.full_name AS actor, al.actor_role, al.action,
                al.entity_type, al.entity_id, al.reason,
                al.old_value, al.new_value
           FROM audit_logs al
           LEFT JOIN users u ON u.id = al.actor_id
          WHERE al.old_value IS NOT NULL
            AND ${window('al', 1)}
          ORDER BY al.created_at DESC
          LIMIT 5000`,
        dates,
      );
  }
}
