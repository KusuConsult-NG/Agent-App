/**
 * Finding one thing, and then seeing the whole of it.
 *
 * Two questions, and the platform could answer neither.
 *
 * The first is "what is TXN-2026-000182?" An officer holding a reference — off
 * a citizen's SMS, a bank statement, a note on a desk — had to already know
 * what kind of thing it was, then open the screen for that kind, then filter.
 * Get the guess wrong and you search three screens before finding out the
 * reference was a receipt number. Nobody investigating anything works that way.
 *
 * The second is "what happened to it?" A transaction is spread across eleven
 * tables by the time it is done, and every one of them was reachable and none
 * of them together. Answering "did the money arrive, and who touched it" meant
 * opening reconciliation, then payments, then commissions, then the audit log,
 * and holding the joins in your head. That is not an audit trail, it is the
 * raw material for one.
 *
 * WHAT THIS IS NOT
 *
 * There is no new source of truth here. Every figure below is read from the
 * table that owns it — this file has no writes at all, and that is deliberate:
 * an investigation surface that could alter what it shows would be worthless as
 * evidence. The transaction an auditor sees here is the same row the revenue
 * officer sees on their dashboard and the finance officer settles. What differs
 * between the four roles is which parts come back, and that is decided by
 * permission, one section at a time.
 *
 * PERMISSIONS, SECTION BY SECTION
 *
 * Both functions gate each part of their answer on the permission that the
 * dedicated screen for that part already requires. Commission needs
 * `commission:read:all`; reconciliation needs `report:financial`; the audit
 * history needs `audit:read`. So a supervisor gets the transaction and the
 * receipt and no settlement, and nobody gets a wider view here than they could
 * assemble the slow way. A 360 view that ignored permissions would be the
 * fastest privilege escalation in the platform.
 *
 * Territory scope applies on top: a supervisor searching gets hits inside their
 * own territories, and a transaction outside them is not found rather than
 * found-and-refused, because "no such reference" and "not yours" are the same
 * answer to somebody who should not know the row exists.
 */

import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import { forbidden, notFound } from '../lib/errors';
import {
  type ReportScope,
  scopeParams,
  transactionScopeSql,
} from './report-scope';

export interface Viewer {
  userId: string;
  role: string;
  permissions: readonly string[];
}

const holds = (viewer: Viewer, ...permissions: string[]) =>
  permissions.some((permission) => viewer.permissions.includes(permission));

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

export type SearchKind =
  | 'transaction'
  | 'taxpayer'
  | 'agent'
  | 'officer'
  | 'invoice'
  | 'receipt'
  | 'payment'
  | 'assessment'
  | 'vehicle'
  | 'revenue_item'
  | 'place'
  | 'case';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  /** The thing's own reference — what an officer would quote on the phone. */
  reference: string;
  title: string;
  subtitle: string | null;
  /** Where in the portal this opens. */
  path: string;
  amount_kobo?: string | null;
  status?: string | null;
  occurred_at?: string | null;
}

/**
 * What could this string be?
 *
 * Running twelve queries on every keystroke is how a search box becomes the
 * heaviest endpoint on the platform, so the shape of the term decides which
 * ones are worth running. The rules are deliberately loose — a term that
 * *might* be a TIN also gets searched as a name — because a false candidate
 * costs one indexed lookup and a missed one costs the officer the answer.
 *
 * Everything falls back to the name and phone searches, which is what an
 * officer typing "Musa" wants.
 */
function candidateKinds(term: string): Set<SearchKind> {
  const kinds = new Set<SearchKind>();
  const upper = term.toUpperCase();

  // TXN-2026-000789, and the bare number somebody types without the prefix.
  if (/TXN/.test(upper) || /^\d{4}-\d{6}$/.test(upper)) kinds.add('transaction');
  // PSIRS/2026/000123
  if (/PSIRS|^\d{6}$/.test(upper) || upper.includes('/')) kinds.add('receipt');
  if (/INV/.test(upper) || upper.includes('/')) kinds.add('invoice');
  if (/ASM|ASSESS/.test(upper)) kinds.add('assessment');
  if (/PAY|PSP|REF/.test(upper) || /^[A-Z0-9_-]{8,}$/.test(upper)) kinds.add('payment');
  if (/AGT|AGENT|APP/.test(upper)) kinds.add('agent');
  if (/CASE/.test(upper)) kinds.add('case');
  // A plate is letters and digits with no separator conventions we can rely on.
  if (/^[A-Z]{2,3}[- ]?\d{2,4}[- ]?[A-Z]{0,3}$/.test(upper)) kinds.add('vehicle');
  // A TIN is digits. So is a phone number, so both get asked.
  if (/^\d{8,}$/.test(term.replace(/\D/g, '')) && term.replace(/\D/g, '').length >= 8) {
    kinds.add('taxpayer');
  }

  // The fallbacks. Anything at all could be somebody's name.
  kinds.add('taxpayer');
  kinds.add('agent');
  kinds.add('officer');
  kinds.add('revenue_item');
  kinds.add('place');
  kinds.add('case');
  kinds.add('vehicle');
  return kinds;
}

/**
 * Search everything this officer is allowed to look at.
 *
 * `limit` is per kind, not overall: an officer searching "Musa" wants a few
 * taxpayers and a few agents, not twenty taxpayers and nothing else because
 * taxpayers sorted first.
 */
export async function globalSearch(
  db: Db,
  viewer: Viewer,
  params: { term: string; limit?: number },
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<{ term: string; hits: SearchHit[] }> {
  const term = params.term.trim();
  const limit = Math.min(params.limit ?? 5, 25);
  if (term.length < 2) return { term, hits: [] };

  const like = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;
  const digits = term.replace(/\D/g, '');
  const kinds = candidateKinds(term);
  const { statewide, territoryIds, lgaIds } = scopeParams(scope);

  const wanted = (kind: SearchKind, ...permissions: string[]) =>
    kinds.has(kind) && holds(viewer, ...permissions);

  const searches: Promise<SearchHit[]>[] = [];

  if (wanted('transaction', 'payment:read:all', 'report:read:all', 'report:read:territory')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'transaction' AS kind, t.id::text AS id,
                t.transaction_reference AS reference,
                t.transaction_reference AS title,
                COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,''))
                  || ' · ' || ri.name AS subtitle,
                '/transaction/' || t.id AS path,
                t.amount_kobo::text AS amount_kobo,
                t.status, t.created_at::text AS occurred_at
           FROM transactions t
           JOIN taxpayers tp ON tp.id = t.taxpayer_id
           JOIN revenue_items ri ON ri.id = t.revenue_item_id
          WHERE t.transaction_reference ILIKE $1 AND ${transactionScopeSql('t', 2, 3)}
          ORDER BY t.created_at DESC LIMIT $4`,
        [like, statewide, territoryIds, limit],
      ),
    );
  }

  if (wanted('receipt', 'receipt:read:all')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'receipt' AS kind, r.id::text AS id, r.receipt_number AS reference,
                r.receipt_number AS title,
                COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,''))
                  AS subtitle,
                '/transaction/' || r.transaction_id AS path,
                r.amount_kobo::text AS amount_kobo, r.status,
                r.issued_at::text AS occurred_at
           FROM receipts r
           JOIN taxpayers tp ON tp.id = r.taxpayer_id
           JOIN transactions t ON t.id = r.transaction_id
          WHERE (r.receipt_number ILIKE $1 OR r.verification_code ILIKE $1)
            AND ${transactionScopeSql('t', 2, 3)}
          ORDER BY r.issued_at DESC LIMIT $4`,
        [like, statewide, territoryIds, limit],
      ),
    );
  }

  if (wanted('invoice', 'invoice:read:all')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'invoice' AS kind, i.id::text AS id, i.invoice_number AS reference,
                i.invoice_number AS title,
                COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,''))
                  AS subtitle,
                /*
                 * The invoice itself, always.
                 *
                 * This was a COALESCE of '/transaction/' with the
                 * transaction id, falling back to '/outstanding'
                 * — the transaction when one existed, and otherwise the
                 * outstanding worklist, which is a list of everybody's unpaid
                 * invoices and says nothing about the one searched for. An
                 * invoice with no transaction is an invoice raised and never
                 * paid, so the officer holding a number and asking about it
                 * was sent to a list in exactly the case they needed the
                 * record. The invoice screen carries the link to the
                 * transaction when there is one.
                 */
                '/invoice/' || i.id AS path,
                i.total_amount_kobo::text AS amount_kobo, i.status,
                i.issued_at::text AS occurred_at
           FROM invoices i
           JOIN taxpayers tp ON tp.id = i.taxpayer_id
          WHERE (i.invoice_number ILIKE $1 OR i.verification_code ILIKE $1)
            AND ($2 OR tp.lga_id = ANY($3::uuid[]))
          ORDER BY i.issued_at DESC LIMIT $4`,
        [like, statewide, lgaIds, limit],
      ),
    );
  }

  if (wanted('assessment', 'assessment:read:all')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'assessment' AS kind, asm.id::text AS id,
                asm.assessment_number AS reference, asm.assessment_number AS title,
                COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,''))
                  || ' · ' || ri.name AS subtitle,
                -- Same as the invoice above: an assessment not yet charged
                -- has no transaction, and that is the assessment somebody is
                -- asking about.
                '/assessment/' || asm.id AS path,
                asm.amount_kobo::text AS amount_kobo, asm.status,
                asm.created_at::text AS occurred_at
           FROM assessments asm
           JOIN taxpayers tp ON tp.id = asm.taxpayer_id
           JOIN revenue_items ri ON ri.id = asm.revenue_item_id
          WHERE asm.assessment_number ILIKE $1
            AND ($2 OR asm.lga_id = ANY($3::uuid[]))
          ORDER BY asm.created_at DESC LIMIT $4`,
        [like, statewide, lgaIds, limit],
      ),
    );
  }

  if (wanted('payment', 'payment:read:all')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'payment' AS kind, p.id::text AS id, p.payment_reference AS reference,
                p.payment_reference AS title,
                p.gateway || COALESCE(' · ' || p.gateway_reference, '') AS subtitle,
                '/transaction/' || p.transaction_id AS path,
                p.amount_kobo::text AS amount_kobo, p.status,
                p.initiated_at::text AS occurred_at
           FROM payments p
           JOIN transactions t ON t.id = p.transaction_id
          WHERE (p.payment_reference ILIKE $1 OR p.gateway_reference ILIKE $1)
            AND ${transactionScopeSql('t', 2, 3)}
          ORDER BY p.initiated_at DESC LIMIT $4`,
        [like, statewide, territoryIds, limit],
      ),
    );
  }

  if (wanted('taxpayer', 'taxpayer:read:all')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'taxpayer' AS kind, tp.id::text AS id,
                COALESCE(tp.tin, 'No TIN') AS reference,
                COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,''))
                  AS title,
                COALESCE(tp.tin || ' · ', '') || l.name AS subtitle,
                '/taxpayer-records?taxpayer=' || tp.id AS path,
                NULL AS amount_kobo, tp.status, tp.created_at::text AS occurred_at
           FROM taxpayers tp
           JOIN lgas l ON l.id = tp.lga_id
          WHERE (tp.tin ILIKE $1
                 OR tp.business_name ILIKE $1
                 OR (tp.first_name || ' ' || COALESCE(tp.last_name,'')) ILIKE $1
                 OR ($5 <> '' AND tp.phone LIKE '%' || $5))
            AND ($2 OR tp.lga_id = ANY($3::uuid[]))
          ORDER BY tp.created_at DESC LIMIT $4`,
        [like, statewide, lgaIds, limit, digits],
      ),
    );
  }

  if (wanted('agent', 'agent:read:all', 'agent:read:assigned')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'agent' AS kind, a.id::text AS id,
                COALESCE(a.agent_code, a.application_number) AS reference,
                u.full_name AS title,
                COALESCE(a.agent_code || ' · ', '') || COALESCE(l.name, 'No LGA') AS subtitle,
                '/agents?agent=' || a.id AS path,
                NULL AS amount_kobo, a.operational_status AS status,
                a.created_at::text AS occurred_at
           FROM agents a
           JOIN users u ON u.id = a.user_id
           LEFT JOIN lgas l ON l.id = a.lga_id
          WHERE (a.agent_code ILIKE $1 OR a.application_number ILIKE $1
                 OR u.full_name ILIKE $1 OR ($5 <> '' AND u.phone LIKE '%' || $5))
            AND ($2 OR a.territory_id = ANY($3::uuid[]))
          ORDER BY a.created_at DESC LIMIT $4`,
        [like, statewide, territoryIds, limit, digits],
      ),
    );
  }

  /*
   * Officers, and only for the roles that supervise or audit them.
   *
   * `user:manage` is the administrator; `audit:read` is the auditor, who has to
   * be able to look up the officer named in an audit entry. A revenue officer
   * has no business enumerating the staff list from a search box.
   */
  if (wanted('officer', 'user:manage', 'audit:read')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'officer' AS kind, u.id::text AS id, u.role AS reference,
                u.full_name AS title,
                u.role || COALESCE(' · last seen ' || to_char(u.last_login_at, 'DD Mon YYYY'), '')
                  AS subtitle,
                '/users?officer=' || u.id AS path,
                NULL AS amount_kobo, u.status, u.created_at::text AS occurred_at
           FROM users u
          WHERE u.role <> 'agent'
            AND (u.full_name ILIKE $1 OR u.email ILIKE $1
                 OR ($3 <> '' AND u.phone LIKE '%' || $3))
          ORDER BY u.full_name LIMIT $2`,
        [like, limit, digits],
      ),
    );
  }

  if (wanted('vehicle', 'vehicle:read:all')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'vehicle' AS kind, v.id::text AS id, v.registration_number AS reference,
                v.registration_number AS title,
                COALESCE(v.make || ' ' || v.model || ' · ', '') || v.owner_name AS subtitle,
                '/taxpayer-records?vehicle=' || v.id AS path,
                NULL AS amount_kobo,
                CASE WHEN v.current_expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE 'CURRENT' END
                  AS status,
                v.created_at::text AS occurred_at
           FROM vehicles v
          WHERE v.registration_number ILIKE $1 OR v.chassis_number ILIKE $1
                OR v.owner_name ILIKE $1
          ORDER BY v.created_at DESC LIMIT $2`,
        [like, limit],
      ),
    );
  }

  if (wanted('revenue_item', 'catalogue:read')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'revenue_item' AS kind, ri.id::text AS id, ri.code AS reference,
                ri.name AS title, rc.name AS subtitle,
                '/catalogue?item=' || ri.id AS path,
                NULL AS amount_kobo, ri.status, NULL AS occurred_at
           FROM revenue_items ri
           JOIN revenue_categories rc ON rc.id = ri.category_id
          WHERE ri.name ILIKE $1 OR ri.code ILIKE $1 OR rc.name ILIKE $1
          ORDER BY ri.name LIMIT $2`,
        [like, limit],
      ),
    );
  }

  if (wanted('place', 'report:read:all', 'report:read:territory')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'place' AS kind, l.id::text AS id, l.code AS reference,
                l.name AS title, 'LGA · ' || l.zone AS subtitle,
                '/intelligence?lga=' || l.id AS path,
                NULL AS amount_kobo, NULL AS status, NULL AS occurred_at
           FROM lgas l
          WHERE l.name ILIKE $1 AND ($2 OR l.id = ANY($3::uuid[]))
          ORDER BY l.name LIMIT $4`,
        [like, statewide, lgaIds, limit],
      ),
    );
  }

  if (wanted('case', 'case:read:all')) {
    searches.push(
      query<SearchHit>(
        db,
        `SELECT 'case' AS kind, c.id::text AS id, c.case_number AS reference,
                c.subject AS title,
                c.category || COALESCE(' · ' || assignee.full_name, ' · unassigned') AS subtitle,
                '/cases?case=' || c.id AS path,
                NULL AS amount_kobo, c.status, c.created_at::text AS occurred_at
           FROM cases c
           LEFT JOIN users assignee ON assignee.id = c.assignee_id
          WHERE c.case_number ILIKE $1 OR c.subject ILIKE $1
          ORDER BY c.created_at DESC LIMIT $2`,
        [like, limit],
      ),
    );
  }

  const results = await Promise.all(searches);
  return { term, hits: results.flat() };
}

// ---------------------------------------------------------------------------
// Transaction 360
// ---------------------------------------------------------------------------

/**
 * One transaction, told whole.
 *
 * Accepts an id or a reference, because an officer arriving from a citizen's
 * SMS has the reference and an officer arriving from a list has the id, and
 * making them care which is a needless way to lose people.
 */
export async function transaction360(db: Db, viewer: Viewer, key: string, scope: ReportScope) {
  const { statewide, territoryIds } = scopeParams(scope);
  /*
   * The key is passed twice, as an id and as a reference, with the one it is
   * not set to null.
   *
   * The obvious shape — one parameter compared against both columns — makes
   * PostgreSQL infer the parameter's type from its first use and then refuse
   * the second comparison. Casting the *column* instead (`t.id::text = $1`)
   * type-checks and costs the primary key index, turning a single lookup into
   * a sequential scan of every transaction on the platform. Two parameters
   * keep both indexes.
   */
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const byId = isUuid ? key : null;
  const byReference = isUuid ? null : key;

  const core = await queryOne<Record<string, unknown> & { id: string }>(
    db,
    `SELECT t.id, t.transaction_reference, t.status, t.status_reason, t.channel,
            t.amount_kobo::text, t.service_charge_kobo::text, t.total_amount_kobo::text,
            t.created_at, t.verified_at, t.settled_at, t.reversed_at,
            t.latitude, t.longitude,
            t.taxpayer_id, t.agent_id, t.invoice_id, t.assessment_id, t.revenue_item_id,

            tp.tin, tp.taxpayer_type, tp.phone AS taxpayer_phone,
            COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,''))
              AS taxpayer_name,

            a.agent_code, agent_user.full_name AS agent_name,
            agent_user.phone AS agent_phone, a.operational_status AS agent_status,

            creator.full_name AS created_by_name, creator.role AS created_by_role,

            ri.name AS revenue_item, ri.code AS revenue_item_code,
            rc.name AS revenue_category,
            m.name AS mda,

            l.name AS lga, w.name AS ward, ter.name AS territory,

            asm.assessment_number, asm.base_amount_kobo::text, asm.discount_kobo::text,
            asm.period_label, asm.computation_inputs, asm.computation_trace,
            asm.assessment_type, asm.created_at AS assessed_at,

            inv.invoice_number, inv.total_amount_kobo::text AS invoice_total_kobo,
            inv.amount_paid_kobo::text, inv.status AS invoice_status,
            inv.issued_at AS invoiced_at, inv.expires_at AS invoice_expires_at
       FROM transactions t
       JOIN taxpayers tp        ON tp.id = t.taxpayer_id
       JOIN revenue_items ri    ON ri.id = t.revenue_item_id
       JOIN revenue_categories rc ON rc.id = ri.category_id
       LEFT JOIN mdas m         ON m.id = ri.mda_id
       JOIN lgas l              ON l.id = t.lga_id
       LEFT JOIN wards w        ON w.id = t.ward_id
       LEFT JOIN territories ter ON ter.id = t.territory_id
       LEFT JOIN agents a       ON a.id = t.agent_id
       LEFT JOIN users agent_user ON agent_user.id = a.user_id
       JOIN users creator       ON creator.id = t.created_by
       JOIN assessments asm     ON asm.id = t.assessment_id
       JOIN invoices inv        ON inv.id = t.invoice_id
      WHERE ($1::uuid IS NULL OR t.id = $1::uuid)
        AND ($2::text IS NULL OR t.transaction_reference = $2)
        AND ${transactionScopeSql('t', 3, 4)}`,
    [byId, byReference, statewide, territoryIds],
  );

  /*
   * Out of scope reads as not found.
   *
   * A supervisor asking about a transaction in another territory learns
   * nothing, including that it exists. Distinguishing "no such reference" from
   * "not yours" would turn this endpoint into a way to confirm any reference
   * by its error message.
   */
  if (!core) throw notFound('That transaction');

  const canSeeMoney = holds(viewer, 'payment:read:all', 'report:financial');
  const canSeeSettlement = holds(viewer, 'report:financial', 'payment:reconcile', 'audit:read');
  const canSeeCommission = holds(viewer, 'commission:read:all');
  const canSeeAudit = holds(viewer, 'audit:read');
  const canSeeCases = holds(viewer, 'case:read:all');
  const canSeeFraud = holds(viewer, 'fraud:read');

  const [
    payments,
    receipt,
    refunds,
    settlement,
    reconciliation,
    commission,
    events,
    auditEntries,
    cases,
    flags,
  ] = await Promise.all([
    canSeeMoney
      ? query(
          db,
          `SELECT p.id, p.payment_reference, p.gateway, p.gateway_reference,
                  p.payment_method, p.amount_kobo::text, p.status, p.failure_reason,
                  p.initiated_at, p.paid_at, p.verified_at, p.verified_by_source,
                  p.reversed_at, p.settlement_id
             FROM payments p WHERE p.transaction_id = $1
            ORDER BY p.initiated_at`,
          [core.id],
        )
      : Promise.resolve([]),

    holds(viewer, 'receipt:read:all')
      ? queryOne(
          db,
          `SELECT r.id, r.receipt_number, r.verification_code, r.amount_kobo::text,
                  r.issued_at, r.status, r.void_reason, r.voided_at,
                  voider.full_name AS voided_by_name,
                  d.document_number, d.status AS document_status
             FROM receipts r
             LEFT JOIN users voider ON voider.id = r.voided_by
             LEFT JOIN documents d ON d.id = r.document_id
            WHERE r.transaction_id = $1`,
          [core.id],
        )
      : Promise.resolve(null),

    canSeeMoney
      ? query(
          db,
          `SELECT rf.refund_reference, rf.amount_kobo::text, rf.refund_type, rf.reason,
                  rf.status, rf.created_at, rf.completed_at, rf.gateway_reference,
                  requester.full_name AS requested_by_name,
                  approver.full_name AS approved_by_name
             FROM refunds rf
             LEFT JOIN users requester ON requester.id = rf.requested_by
             LEFT JOIN users approver  ON approver.id = rf.approved_by
            WHERE rf.transaction_id = $1 ORDER BY rf.created_at`,
          [core.id],
        )
      : Promise.resolve([]),

    canSeeSettlement
      ? queryOne(
          db,
          `SELECT s.settlement_reference, s.gateway, s.bank_reference, s.settlement_date,
                  s.expected_amount_kobo::text, s.received_amount_kobo::text,
                  s.transaction_count, s.status, s.received_at, s.reconciled_at,
                  reconciler.full_name AS reconciled_by_name,
                  ba.account_name AS government_account
             FROM payments p
             JOIN settlements s ON s.id = p.settlement_id
             LEFT JOIN users reconciler ON reconciler.id = s.reconciled_by
             LEFT JOIN bank_accounts ba ON ba.id = s.government_account_id
            WHERE p.transaction_id = $1
            ORDER BY s.settlement_date DESC LIMIT 1`,
          [core.id],
        )
      : Promise.resolve(null),

    canSeeSettlement
      ? query(
          db,
          `SELECT rr.status, rr.expected_amount_kobo::text, rr.received_amount_kobo::text,
                  rr.variance_kobo::text, rr.gateway_reference, rr.settlement_reference,
                  rr.detail, rr.resolution_note, rr.reconciled_at, rr.created_at,
                  reconciler.full_name AS reconciled_by_name
             FROM reconciliation_records rr
             LEFT JOIN users reconciler ON reconciler.id = rr.reconciled_by
            WHERE rr.transaction_id = $1 ORDER BY rr.created_at DESC`,
          [core.id],
        )
      : Promise.resolve([]),

    canSeeCommission
      ? queryOne(
          db,
          `SELECT c.amount_kobo::text, c.rate_basis_points, c.basis_amount_kobo::text,
                  c.status, c.hold_reason, c.eligible_at, c.approved_at, c.paid_at,
                  c.reversed_at, c.reversal_reason,
                  approver.full_name AS approved_by_name,
                  po.payout_reference, po.status AS payout_status, po.paid_at AS payout_paid_at,
                  po.bank_reference AS payout_bank_reference, po.failure_reason AS payout_failure,
                  cp.name AS policy_name
             FROM commissions c
             LEFT JOIN users approver ON approver.id = c.approved_by
             LEFT JOIN commission_payouts po ON po.id = c.payout_id
             LEFT JOIN commission_policies cp ON cp.id = c.policy_id
            WHERE c.transaction_id = $1`,
          [core.id],
        )
      : Promise.resolve(null),

    /*
     * The state machine's own record, which every role gets.
     *
     * This is the transaction telling its own story — created, invoiced, paid,
     * verified, receipted — and it is not privileged information about anybody.
     * The audit log below it is, because it names officers and carries the
     * before and after of what they changed.
     */
    query(
      db,
      `SELECT e.from_status, e.to_status, e.reason, e.source, e.metadata, e.created_at,
              u.full_name AS actor_name, u.role AS actor_role
         FROM transaction_events e
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.transaction_id = $1 ORDER BY e.created_at, e.id`,
      [core.id],
    ),

    /*
     * Every audit entry touching this transaction or anything hanging off it.
     *
     * Entity ids are TEXT in `audit_logs` — it records things that are not rows
     * as well as things that are — so the match is on the string. The list of
     * ids is assembled here rather than joined, because there is no foreign key
     * to join on and inventing one would mean rewriting the audit table.
     */
    canSeeAudit
      ? query(
          db,
          `SELECT al.sequence_no, al.created_at, al.action, al.entity_type, al.entity_id,
                  al.result, al.reason, al.old_value, al.new_value, al.actor_role,
                  al.ip_address, al.hash,
                  u.full_name AS actor_name
             FROM audit_logs al
             LEFT JOIN users u ON u.id = al.actor_id
            WHERE al.entity_id = ANY(
                    SELECT x FROM unnest(ARRAY[
                      $1::text,
                      $2::text,
                      $3::text,
                      $4::text,
                      $5::text
                    ]) AS x WHERE x IS NOT NULL
                    UNION
                    SELECT p.id::text FROM payments p WHERE p.transaction_id = $1::uuid
                    UNION
                    SELECT r.id::text FROM receipts r WHERE r.transaction_id = $1::uuid
                  )
            ORDER BY al.sequence_no`,
          [
            core.id,
            core.invoice_id,
            core.assessment_id,
            core.taxpayer_id,
            core.transaction_reference,
          ],
        )
      : Promise.resolve([]),

    canSeeCases
      ? query(
          db,
          `SELECT c.id, c.case_number, c.subject, c.status, c.priority, c.risk_level,
                  c.category, c.created_at, assignee.full_name AS assignee_name
             FROM cases c
             LEFT JOIN users assignee ON assignee.id = c.assignee_id
            WHERE c.transaction_id = $1 ORDER BY c.created_at DESC`,
          [core.id],
        )
      : Promise.resolve([]),

    canSeeFraud
      ? query(
          db,
          `SELECT f.id, f.rule, f.severity, f.status, f.detail, f.created_at,
                  f.resolution_note, reviewer.full_name AS reviewed_by_name
             FROM fraud_flags f
             LEFT JOIN users reviewer ON reviewer.id = f.reviewed_by
            WHERE f.transaction_id = $1 ORDER BY f.created_at DESC`,
          [core.id],
        )
      : Promise.resolve([]),
  ]);

  return {
    transaction: core,
    payments,
    receipt,
    refunds,
    settlement,
    reconciliation,
    commission,
    timeline: mergeTimeline(events, auditEntries),
    cases,
    flags,
    /*
     * What was withheld, and why.
     *
     * An empty `commission` could mean the agent earned none or that the
     * viewer may not see it, and an investigator has to be able to tell those
     * apart — an auditor reading a 360 with a silently missing section would
     * conclude something false about the transaction. So the answer says which
     * sections it is not showing.
     */
    withheld: [
      canSeeMoney ? null : 'payments',
      canSeeSettlement ? null : 'settlement',
      canSeeCommission ? null : 'commission',
      canSeeAudit ? null : 'audit',
      canSeeCases ? null : 'cases',
      canSeeFraud ? null : 'flags',
    ].filter((section): section is string => section !== null),
  };
}

export interface TimelineEntry {
  at: string;
  source: 'STATE' | 'AUDIT';
  label: string;
  detail: string | null;
  actor: string | null;
  actor_role: string | null;
  old_value?: unknown;
  new_value?: unknown;
  result?: string;
}

/**
 * The state machine and the audit log, interleaved by time.
 *
 * Two records of the same events, kept apart everywhere else in the platform
 * and both needed to answer the auditor's question. `transaction_events` says
 * what the transaction did; `audit_logs` says what a person did to it, and
 * carries the before and after. Reading them separately means holding two
 * clocks in your head, and the moment that matters in an investigation is
 * usually the one where they disagree — an officer's change landing between two
 * state transitions.
 *
 * Ties are broken with the state event first: a status change is caused by the
 * action recorded beside it, and showing the effect above the cause reads
 * backwards.
 */
export function mergeTimeline(
  events: Record<string, unknown>[],
  auditEntries: Record<string, unknown>[],
): TimelineEntry[] {
  const fromState: TimelineEntry[] = events.map((event) => ({
    at: new Date(event.created_at as string).toISOString(),
    source: 'STATE',
    label: event.from_status
      ? `${event.from_status} → ${event.to_status}`
      : String(event.to_status),
    detail: (event.reason as string) ?? null,
    actor: (event.actor_name as string) ?? String(event.source ?? 'SYSTEM'),
    actor_role: (event.actor_role as string) ?? null,
  }));

  const fromAudit: TimelineEntry[] = auditEntries.map((entry) => ({
    at: new Date(entry.created_at as string).toISOString(),
    source: 'AUDIT',
    label: String(entry.action),
    detail: (entry.reason as string) ?? null,
    actor: (entry.actor_name as string) ?? null,
    actor_role: (entry.actor_role as string) ?? null,
    old_value: entry.old_value ?? null,
    new_value: entry.new_value ?? null,
    result: String(entry.result ?? 'SUCCESS'),
  }));

  return [...fromState, ...fromAudit].sort((left, right) => {
    if (left.at !== right.at) return left.at < right.at ? -1 : 1;
    if (left.source === right.source) return 0;
    return left.source === 'STATE' ? -1 : 1;
  });
}
