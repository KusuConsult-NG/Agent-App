/**
 * Tax obligation derivation and persistence (PRD §10, §41).
 *
 * An obligation ties a specific taxpayer to a specific revenue item they are
 * liable for. The source field records how the obligation was identified:
 *
 *   AGENT_ONBOARDING   — the registering agent confirmed it at the time of
 *                        registration, based on a system suggestion.
 *   OFFICER_REVIEW     — a Revenue Officer added or changed it after the fact,
 *                        for example after a TIN sync reveals a trade not
 *                        captured at registration.
 *   AUTO_RECOMMENDATION — the system derived it automatically (future: when a
 *                         new revenue item is added to the catalogue, existing
 *                         taxpayers whose sector matches are flagged).
 *
 * Obligations are append-only. The database trigger prevents DELETE; this
 * module WAIVES rather than removes.
 */

import { ECONOMIC_SECTORS } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { recordAudit } from './audit';
import { forbidden } from '../lib/errors';

export interface SuggestedObligation {
  revenueItemId: string;
  code: string;
  name: string;
  frequency: string;
  rationale: string;
}

export interface ObligationRecord {
  id: string;
  revenueItemId: string;
  code: string;
  name: string;
  frequency: string;
  categoryName: string;
  source: string;
  status: string;
  notes: string | null;
  createdAt: Date;
}

/**
 * Derive suggested revenue item obligations for a taxpayer based on their
 * economic sector and taxpayer type.
 *
 * Returns items in the catalogue that match the sector's suggested codes AND
 * are applicable to the taxpayer's type (INDIVIDUAL / BUSINESS).
 */
export async function deriveSuggestedObligations(
  sector: string,
  taxpayerType: 'INDIVIDUAL' | 'BUSINESS',
): Promise<SuggestedObligation[]> {
  const sectorDef = ECONOMIC_SECTORS.find((s) => s.code === sector);
  if (!sectorDef || sectorDef.suggestedRevenueCodes.length === 0) return [];

  const codes = [...sectorDef.suggestedRevenueCodes];

  const items = await query<{
    id: string;
    code: string;
    name: string;
    frequency: string;
    applicable_taxpayer_types: string[];
  }>(
    pool,
    `SELECT id, code, name, frequency, applicable_taxpayer_types
       FROM revenue_items
      WHERE code = ANY($1::text[])
        AND status = 'ACTIVE'
      ORDER BY name`,
    [codes],
  );

  return items
    .filter((item) => item.applicable_taxpayer_types.includes(taxpayerType))
    .map((item) => ({
      revenueItemId: item.id,
      code: item.code,
      name: item.name,
      frequency: item.frequency,
      rationale: `Suggested for ${sectorDef.label} taxpayers`,
    }));
}

/**
 * Return the current obligation records for a taxpayer, enriched with revenue
 * item details.
 */
export async function getObligationsForTaxpayer(
  db: Db,
  taxpayerId: string,
): Promise<ObligationRecord[]> {
  return query<ObligationRecord>(
    db,
    `SELECT
       o.id,
       o.revenue_item_id  AS "revenueItemId",
       ri.code,
       ri.name,
       ri.frequency,
       rc.name            AS "categoryName",
       o.source,
       o.status,
       o.notes,
       o.created_at       AS "createdAt"
     FROM taxpayer_tax_obligations o
     JOIN revenue_items  ri ON ri.id = o.revenue_item_id
     JOIN revenue_categories rc ON rc.id = ri.category_id
    WHERE o.taxpayer_id = $1
    ORDER BY o.status, ri.name`,
    [taxpayerId],
  );
}

/**
 * Bulk-set obligations for a taxpayer.
 *
 * - Items in `itemIds` that do not yet have an obligation row are inserted.
 * - Items previously set that are not in `itemIds` are WAIVED (not deleted).
 * - Items already present with the same status are left unchanged (idempotent).
 *
 * This is the single write path used both by the Agent PWA at registration
 * time and by the Government Portal when a Revenue Officer updates the profile.
 */
export async function upsertObligations(
  taxpayerId: string,
  itemIds: string[],
  source: 'AGENT_ONBOARDING' | 'OFFICER_REVIEW' | 'AUTO_RECOMMENDATION',
  actorId: string | null,
  actor: { role: string; mayWaive: boolean },
): Promise<{ added: number; waived: number }> {
  return withTransaction(async (client) => {
    /*
     * Waiving is a separate authority from adding.
     *
     * This endpoint takes the whole list, so dropping an item from it cancels
     * that obligation and an empty list cancels all of them. Adding is
     * onboarding and belongs to the agent registering the taxpayer; removing
     * is a revenue decision. The check happens here, before anything is
     * written, because only here is it known which obligations the submitted
     * list would actually remove — the caller may simply not have realised
     * what they were leaving out.
     */
    if (!actor.mayWaive) {
      const wouldWaive = await query<{ id: string }>(
        client,
        itemIds.length > 0
          ? `SELECT id FROM taxpayer_tax_obligations
              WHERE taxpayer_id = $1 AND status = 'ACTIVE' AND revenue_item_id <> ALL($2::uuid[])`
          : `SELECT id FROM taxpayer_tax_obligations
              WHERE taxpayer_id = $1 AND status = 'ACTIVE'`,
        itemIds.length > 0 ? [taxpayerId, itemIds] : [taxpayerId],
      );
      if (wouldWaive.length > 0) {
        throw forbidden(
          `This would cancel ${wouldWaive.length} obligation(s) already on file, which a ` +
            'revenue officer has to do. Submit the full list of what this taxpayer owes, ' +
            'including the ones already recorded.',
        );
      }
    }

    // Insert new obligations (ignore duplicates).
    let added = 0;
    for (const itemId of itemIds) {
      const result = await client.query(
        `INSERT INTO taxpayer_tax_obligations
           (taxpayer_id, revenue_item_id, source, status, created_by)
         VALUES ($1, $2, $3, 'ACTIVE', $4)
         ON CONFLICT (taxpayer_id, revenue_item_id) DO UPDATE
           SET status = 'ACTIVE', source = $3, updated_at = now()
           WHERE taxpayer_tax_obligations.status <> 'ACTIVE'`,
        [taxpayerId, itemId, source, actorId],
      );
      if ((result.rowCount ?? 0) > 0) added++;
    }

    // Waive obligations that are no longer in the confirmed list.
    let waived = 0;
    if (itemIds.length > 0) {
      const result = await client.query(
        `UPDATE taxpayer_tax_obligations
            SET status = 'WAIVED', updated_at = now()
          WHERE taxpayer_id = $1
            AND revenue_item_id <> ALL($2::uuid[])
            AND status = 'ACTIVE'`,
        [taxpayerId, itemIds],
      );
      waived = result.rowCount ?? 0;
    } else {
      // Empty list: waive all active obligations.
      const result = await client.query(
        `UPDATE taxpayer_tax_obligations
            SET status = 'WAIVED', updated_at = now()
          WHERE taxpayer_id = $1 AND status = 'ACTIVE'`,
        [taxpayerId],
      );
      waived = result.rowCount ?? 0;
    }

    if (added > 0 || waived > 0) {
      await recordAudit(client, {
        actorId,
        // The role comes from the authenticated caller, never from `source` —
        // that is a field in the request body, and deriving the audited role
        // from it let an agent file their own change as a revenue officer's.
        actorRole: actor.role,
        action: 'OBLIGATION_SET',
        entityType: 'taxpayer',
        entityId: taxpayerId,
        newValue: { source, itemIds, added, waived },
      });
    }

    return { added, waived };
  });
}
