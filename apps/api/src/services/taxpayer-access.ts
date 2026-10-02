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
      // `error`, not `warn`. A missing row in an access log is not recoverable
      // later and not detectable from anywhere else: the evidence is simply
      // absent, and the question it answers is asked months afterwards.
      level: 'error',
      detail: {
        taxpayerId: params.taxpayerId,
        surface: params.surface,
        requestId: params.requestId,
      },
    },
  );
}
