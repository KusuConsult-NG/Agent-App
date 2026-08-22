/**
 * Does the schema still enforce what the platform claims it enforces?
 *
 * The financial guarantees here live in PostgreSQL rather than in application
 * code — a receipt cannot be inserted for an unverified payment, a commission
 * cannot exist without verified revenue, financial rows cannot be deleted. That
 * is the right place for them: a trigger holds even against a compromised
 * service account, and the existing suite proves each individual control by
 * attacking it.
 *
 * What nothing checked was the *shape* of that protection across the schema as
 * a whole. Individual controls were tested one at a time, by name, so a table
 * that nobody thought to name was simply absent from the evidence. Three were:
 *
 *   document_access_logs      unprotected, while kyc_document_access_logs was
 *   reconciliation_runs       unprotected, while reconciliation_records was
 *   gateway_statement_lines   unprotected — the gateway's side of the
 *                             three-way reconciliation
 *
 * Each has a sibling that was protected, which is what marks them as
 * oversights rather than decisions. None was found by reading code; they were
 * found by asking the database which tables lacked a delete trigger and
 * looking at the answer.
 *
 * So these tests assert the property rather than the instances. A new table
 * holding financial or audit evidence has to be classified deliberately —
 * either protected, or named here as knowingly mutable — because the failure
 * mode is silence: nobody notices an absent guarantee until the row somebody
 * needed is gone.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase, startTestServer, stopTestServer } from './helpers';

before(async () => {
  await resetDatabase();
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

/** Tables whose rows are evidence: something happened, and this records it. */
const MUST_BE_APPEND_ONLY = [
  // Money.
  'transactions',
  'payments',
  'receipts',
  'commissions',
  'commission_payouts',
  'invoices',
  'assessments',
  'refunds',
  'settlements',
  'reconciliation_records',
  // The record that a control ran, and what the counterparty said.
  'reconciliation_runs',
  'gateway_statement_lines',
  // Who did what, and who looked at what.
  'audit_logs',
  'document_access_logs',
  'kyc_document_access_logs',
  'transaction_events',
  'agent_clearance_events',
  // Identity and clearance decisions.
  'taxpayers',
  'agents',
  'agent_kyc',
  'kyc_documents',
  'referees',
  'referee_kyc',
  'approvals',
  'fraud_flags',
  'vehicles',
  'vehicle_renewals',
  'documents',
  'payment_webhook_events',
] as const;

/**
 * Tables that hold a *computed* answer rather than a record of an event.
 *
 * Listed explicitly so the distinction is a decision somebody made rather than
 * a table nobody got round to. Recomputing these is normal operation —
 * migration 017 clears programme_eligibility deliberately, so that verdicts
 * reached under the old gate rule do not linger as stale refusals against a
 * citizen.
 */
const DELIBERATELY_MUTABLE = new Set([
  'programme_eligibility',
  'taxpayer_compliance',
  'taxpayer_duplicate_checks',
  // Operational churn: sessions expire, OTPs are consumed, drafts sync,
  // notifications are dispatched, idempotency keys age out.
  'sessions',
  'otp_codes',
  'step_up_grants',
  'offline_drafts',
  'notifications',
  'idempotency_keys',
  'verification_attempts',
  'referee_invitations',
  'referee_risk_flags',
  'agent_training_progress',
  'support_tickets',
  'ticket_messages',
  'users',
  // Reference and configuration data, edited by officers through the portal.
  'lgas',
  'wards',
  'territories',
  'mdas',
  'revenue_authorities',
  'revenue_categories',
  'training_modules',
  'notification_templates',
  'agreement_versions',
  'app_versions',
  'schema_migrations',
  'incentive_programmes',
  // Development only.
  'mock_gateway_transactions',
]);

async function tablesWithoutDeleteTrigger(): Promise<string[]> {
  const { rows } = await pool.query<{ relname: string }>(`
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = c.oid
            AND NOT t.tgisinternal
            AND (t.tgtype & 8) <> 0)
     ORDER BY 1`);
  return rows.map((row) => row.relname);
}

// ===========================================================================
describe('Every table holding evidence refuses to lose it', () => {
  it('every one of them carries a BEFORE DELETE trigger', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM pg_trigger t
             WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND (t.tgtype & 8) <> 0)
        ORDER BY 1`,
      [[...MUST_BE_APPEND_ONLY]],
    );

    assert.deepEqual(
      rows.map((row) => row.relname),
      [],
      'these hold evidence and have no BEFORE DELETE trigger — a row in them can be made to have never existed',
    );
  });

  /** A named table that no longer exists would make the list above vacuous. */
  it('names only tables that exist', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT unnest($1::text[]) AS relname
       EXCEPT
       SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      [[...MUST_BE_APPEND_ONLY]],
    );
    assert.deepEqual(
      rows.map((row) => row.relname),
      [],
      'the append-only list names tables that no longer exist, so it is checking less than it appears to',
    );
  });

  /**
   * The check that finds the *next* one.
   *
   * Naming tables individually only ever proves the tables somebody thought of.
   * This fails when a new table appears that is neither protected nor
   * explicitly classified as mutable, so the decision has to be made rather
   * than defaulted into.
   */
  it('leaves no table unclassified', async () => {
    const unprotected = await tablesWithoutDeleteTrigger();
    const unclassified = unprotected.filter((table) => !DELIBERATELY_MUTABLE.has(table));

    assert.deepEqual(
      unclassified,
      [],
      `these tables have no delete protection and are not listed as deliberately mutable: ` +
        `${unclassified.join(', ')}. Either protect them, or add them to DELIBERATELY_MUTABLE ` +
        `with a reason — the point is that somebody decides.`,
    );
  });
});

// ===========================================================================
describe('The gaps found by this audit, pinned individually', () => {
  /**
   * A document access log answers "who looked at this citizen's identity
   * document, and from where". Deleting one removes the only record that an
   * officer opened a file they had no business opening.
   */
  it('refuses to delete a document access log', async () => {
    const doc = await pool.query<{ id: string }>(
      `INSERT INTO documents (document_number, document_type, owner_type, owner_id,
                              storage_reference, byte_size, checksum, verification_code,
                              issuing_authority)
       VALUES ($1,'RECEIPT','TAXPAYER',gen_random_uuid(),'k/1',10,'abc',$2,'PSIRS')
       RETURNING id`,
      [`DOC-SCHEMA-${Date.now()}`, `VC-SCHEMA-${Date.now()}`],
    );

    await pool.query(
      `INSERT INTO document_access_logs (document_id, access_type, ip_address)
       VALUES ($1, 'VIEW', '203.0.113.9'::inet)`,
      [doc.rows[0]!.id],
    );

    await assert.rejects(
      pool.query('DELETE FROM document_access_logs WHERE document_id = $1', [doc.rows[0]!.id]),
      /append-only|cannot be deleted/i,
    );
  });

  /**
   * The reconciliation run is where an ABORTED sweep is recorded, and an
   * aborted sweep means nothing was compared for that period. It is the single
   * most useful row to erase if the goal is to make an unexamined period look
   * examined.
   */
  it('refuses to delete the record that a reconciliation ran', async () => {
    const run = await pool.query<{ id: string }>(
      `INSERT INTO reconciliation_runs (period_start, period_end, status)
       VALUES (CURRENT_DATE - 1, CURRENT_DATE, 'ABORTED') RETURNING id`,
    );

    await assert.rejects(
      pool.query('DELETE FROM reconciliation_runs WHERE id = $1', [run.rows[0]!.id]),
      /append-only|cannot be deleted/i,
    );
  });

  it('refuses to edit a document access log after the fact', async () => {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM document_access_logs LIMIT 1',
    );
    if (rows.length === 0) return; // the delete test above creates one

    await assert.rejects(
      pool.query(`UPDATE document_access_logs SET access_type = 'ALTERED' WHERE id = $1`, [
        rows[0]!.id,
      ]),
      /append-only|cannot be updated/i,
    );
  });
});
