/**
 * Who opened this person's record.
 *
 * The platform could already answer "who read this identity document"
 * (`kyc_document_access_logs`), "who downloaded this receipt"
 * (`document_access_logs`) and "who ran a coverage query against this citizen,
 * and under what claimed purpose" (`taxpayer_connection_access_logs`). It could
 * not answer the plainest version: who opened the record itself.
 *
 * `GET /government/audit/queries/taxpayer-access` is labelled "Who has looked
 * at one taxpayer's record" on the oversight screen and documented as "All
 * users who accessed taxpayer record X". It read `audit_logs` where
 * `entity_type = 'taxpayer'`, and every one of the nine places that writes such
 * a row writes it on a CHANGE: registered, TIN requested, TIN superseded,
 * identity corrected, status changed, obligations set, a draft synchronised. A
 * read wrote nothing anywhere. The only audit row a read has ever produced is
 * `access.denied`, filed under `entity_type = 'permission'` — so the platform
 * recorded the reads it refused and not the reads it allowed.
 *
 * WHAT A READ DISCLOSES, FOR SCALE
 *
 * `getTaxpayerProfile` selects `t.*`: date of birth, gender, phone, alternate
 * phone, email, address, community, occupation, identity type, TIN — and then
 * the last fifty assessments, fifty transactions, fifty receipts, the vehicles,
 * the compliance record and the incentive programmes. One request, one
 * person's affairs, no trace.
 *
 * WHY THESE FOUR SURFACES
 *
 * The two front ends reach a named person's data by different routes, and
 * logging only one of them would have left a whole population unlogged. The
 * agent application reads `GET /taxpayers/:id`. The officer portal never calls
 * it: it searches, then reads the payment history, the obligations and the
 * incentive standing, each on its own tab. Officers are the population the
 * audit question is usually about.
 *
 * So one portal visit can write three rows for what a person would call one
 * look. That is the honest shape rather than a flaw: the tabs are opened
 * separately and show different things, and a row that says PAYMENT_HISTORY
 * answers a different complaint than one that says OBLIGATIONS.
 *
 * WHAT IS NOT LOGGED, AND WHY
 *
 * `GET /taxpayers/search` is not. A search discloses several people at once and
 * is keyed to a query rather than a taxpayer, so recording it here would mean a
 * row per result — turning one officer's typo into twenty entries on twenty
 * citizens' access logs, which is worse evidence than none. Search belongs in a
 * log of its own, keyed to the query, and is recorded as not done rather than
 * quietly left out.
 */

import { pool } from '../db/pool';
import { bestEffort } from '../lib/best-effort';

/** What was shown. The order is roughly how much of somebody's life it is. */
export type AccessSurface =
  | 'TAXPAYER_RECORD'
  | 'PAYMENT_HISTORY'
  | 'TAX_OBLIGATIONS'
  | 'INCENTIVE_STANDING';

/**
 * Record that somebody read this taxpayer's data.
 *
 * Best-effort, like `document_access_logs`: a read that could not be logged
 * must still answer, because refusing to show an officer a record because the
 * log is down helps nobody — but the failure is reported rather than swallowed,
 * so the control cannot stop working unnoticed.
 *
 * Awaited at the call site. Not awaiting it meant, elsewhere in this codebase,
 * that the insert could land after the request had been answered and after a
 * test reset had emptied the table it pointed into.
 */
export function recordTaxpayerAccess(params: {
  taxpayerId: string;
  accessedBy: string | null;
  actorRole: string | null;
  surface: AccessSurface;
  ipAddress?: string | null;
  deviceId?: string | null;
  requestId?: string | null;
}): Promise<void> {
  return bestEffort(
    'taxpayer_access.record',
    pool.query(
      `INSERT INTO taxpayer_record_access_logs
         (taxpayer_id, accessed_by, actor_role, surface, ip_address, device_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.taxpayerId,
        params.accessedBy,
        params.actorRole,
        params.surface,
        params.ipAddress ?? null,
        params.deviceId ?? null,
      ],
    ),
    {
      // `warn`, the module default, and this is a correction: these two sites
      // were the only `bestEffort` calls in the service that reported a lost
      // record at `error`. The reason given was that a missing row in an
      // access log is not recoverable later and not detectable from anywhere
      // else, which is true — and is true of every record in this module's
      // care. `document_access.record`, the log of who read the receipt book,
      // is one insert of the same kind and reports at `warn`.
      //
      // The line `best-effort.ts` draws is whether the failure *compounds*,
      // not how much the record matters: `error` is for a held advisory lock
      // that stops every later run of a job, and a background pass with no
      // caller left to tell. Neither of these is that. Levelling an audit
      // insert at `error` instead buys nothing and costs the alerting: an
      // unreachable database pages somebody once a minute per surface, and
      // that is how the next real error gets scrolled past.
      detail: {
        taxpayerId: params.taxpayerId,
        surface: params.surface,
        requestId: params.requestId,
      },
    },
  );
}

/**
 * Which fields a search used, and what was typed into them.
 *
 * Only the fields that were actually sent, so a reviewer reading
 * `{"q": "musa"}` knows the officer typed a name and nothing else. `limit` and
 * the scope are left out: they are how much and where the platform would
 * answer, not what was asked for.
 */
export type SearchFilters = Record<string, string | number | boolean>;

/**
 * Record that somebody searched the register.
 *
 * One row per search, not per result. The commit that added
 * `taxpayer_record_access_logs` left the search out on the grounds that a row
 * per match would put one officer's typo on twenty citizens' access logs,
 * which is still true — and was only half the argument, because the search
 * discloses more than the record read that was logged: per match it answers
 * TIN, name, business name, phone, email, address, community, LGA and ward.
 *
 * Best-effort, like the record log. A search that could not be logged still
 * answers, because refusing to let an officer look somebody up because a log
 * is down helps nobody. It reports at `warn`: the row is lost and nothing
 * downstream of it is blocked, which is the line `best-effort.ts` draws.
 */
export function recordTaxpayerSearch(params: {
  searchedBy: string | null;
  actorRole: string | null;
  filters: SearchFilters;
  matched: number;
  ipAddress?: string | null;
  deviceId?: string | null;
  requestId?: string | null;
}): Promise<void> {
  return bestEffort(
    'taxpayer_search.record',
    pool.query(
      `INSERT INTO taxpayer_search_logs
         (searched_by, actor_role, filters, matched, ip_address, device_id)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
      [
        params.searchedBy,
        params.actorRole,
        JSON.stringify(params.filters),
        params.matched,
        params.ipAddress ?? null,
        params.deviceId ?? null,
      ],
    ),
    {
      detail: {
        matched: params.matched,
        fields: Object.keys(params.filters).join(','),
        requestId: params.requestId,
      },
    },
  );
}
