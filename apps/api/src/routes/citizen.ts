/**
 * Public citizen self-service status endpoint.
 *
 * Unauthenticated, rate-limited at 10 requests/minute per IP (separate from
 * the general rate limit). Citizens can look up their own tax status using
 * their TIN, exact phone number, or name.
 *
 * Privacy rules enforced here:
 *   - TIN search: full safe data returned (TIN is the strongest identifier)
 *   - Phone search: exact match only; same data as TIN
 *   - Name search: count-only response — no individual data shown
 *   - Identity numbers, addresses, officer notes are NEVER returned
 *   - Outstanding figure is shown only on TIN search
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool, queryOne, query } from '../db/pool';
import { rateLimit } from '../middleware/security';
import { validateQuery } from '../middleware/validate';
import { syncTaxpayerComplianceAndIncentives } from '../services/incentives';

export const citizenRouter = Router();

// Strict rate limit — 10 per minute per IP — to prevent TIN/phone enumeration.
citizenRouter.use(rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'citizen-status', keyBy: 'ip' }));

const citizenQuerySchema = z.object({
  tin:   z.string().min(3).max(30).optional(),
  phone: z.string().min(8).max(20).optional(),
  name:  z.string().min(2).max(120).optional(),
});

citizenRouter.get(
  '/',
  validateQuery(citizenQuerySchema, async (_req, res, data) => {
    const { tin, phone, name } = data;

    if (!tin && !phone && !name) {
      res.status(400).json({
        found: false,
        message: 'Please provide a TIN, phone number, or name to search.',
      });
      return;
    }

    // Name-only search: count + redirect to use TIN/phone.
    if (name && !tin && !phone) {
      const result = await queryOne<{ cnt: string }>(
        pool,
        `SELECT count(*)::text AS cnt FROM taxpayers
          WHERE status = 'ACTIVE'
            AND (
              lower(first_name || ' ' || coalesce(last_name,'')) LIKE lower($1)
              OR lower(coalesce(business_name,'')) LIKE lower($1)
            )`,
        [`%${name}%`],
      );
      const count = Number.parseInt(result?.cnt ?? '0', 10);
      res.json({
        found: count > 0,
        count,
        message:
          count === 0
            ? 'No record found with that name.'
            : count === 1
              ? 'One matching record found. Use your TIN or phone number to see full details.'
              : `${count} records found with a similar name. Use your TIN or phone number to see your specific record.`,
      });
      return;
    }

    // TIN or phone search: return the safe data subset.
    let taxpayer: {
      id: string;
      tin: string | null;
      tin_status: string;
      phone: string;
      status: string;
    } | null = null;

    if (tin) {
      taxpayer = await queryOne(
        pool,
        `SELECT id, tin, tin_status, phone, status FROM taxpayers WHERE tin = $1 AND status = 'ACTIVE'`,
        [tin.trim().toUpperCase()],
      );
    } else if (phone) {
      taxpayer = await queryOne(
        pool,
        `SELECT id, tin, tin_status, phone, status FROM taxpayers WHERE phone = $1 AND status = 'ACTIVE'`,
        [phone.trim()],
      );
    }

    if (!taxpayer) {
      res.json({
        found: false,
        message: tin
          ? 'No active taxpayer record found for that TIN.'
          : 'No active taxpayer record found for that phone number.',
      });
      return;
    }

    // Refresh compliance score and active incentive programme eligibility live.
    await syncTaxpayerComplianceAndIncentives(pool, taxpayer.id);

    // Compliance record.
    const compliance = await queryOne<{
      score: number;
      has_valid_tin: boolean;
      outstanding_amount_kobo: string;
      last_payment_at: Date | null;
      compliant_periods: number;
    }>(
      pool,
      `SELECT score, has_valid_tin, outstanding_amount_kobo, last_payment_at, compliant_periods
         FROM taxpayer_compliance WHERE taxpayer_id = $1`,
      [taxpayer.id],
    );

    const hasOutstanding = compliance
      ? BigInt(compliance.outstanding_amount_kobo) > 0n
      : false;

    // Obligation names (revenue item names only — no amounts or rates).
    const obligationNames = await query<{ name: string }>(
      pool,
      `SELECT ri.name FROM taxpayer_tax_obligations o
       JOIN revenue_items ri ON ri.id = o.revenue_item_id
       WHERE o.taxpayer_id = $1 AND o.status = 'ACTIVE'
       ORDER BY ri.name`,
      [taxpayer.id],
    );

    // Eligible social programmes.
    const programmes = await query<{ name: string }>(
      pool,
      `SELECT ip.name
         FROM programme_eligibility pe
         JOIN incentive_programmes ip ON ip.id = pe.programme_id
        WHERE pe.taxpayer_id = $1
          AND pe.eligible = true
          AND ip.status = 'ACTIVE'
        ORDER BY ip.name`,
      [taxpayer.id],
    );

    const score = compliance?.score ?? 0;
    const complianceStatus =
      !compliance
        ? 'NOT_ASSESSED'
        : hasOutstanding
          ? 'HAS_ARREARS'
          : score >= 60
            ? 'COMPLIANT'
            : 'NEEDS_ATTENTION';

    const statusMessages: Record<string, string> = {
      COMPLIANT: 'Your tax records are up to date. Keep paying on time to maintain your status.',
      HAS_ARREARS: 'You have outstanding tax obligations. Please contact your nearest PSIRS office or a revenue agent to pay.',
      NEEDS_ATTENTION: 'Your compliance score needs improvement. Paying your obligations on time will raise it.',
      NOT_ASSESSED: 'Your compliance has not been assessed yet. This will update after your first payment.',
    };

    res.json({
      found: true,
      tin: taxpayer.tin,
      tinStatus: taxpayer.tin_status,
      complianceStatus,
      complianceScore: score,
      lastPaymentDate: compliance?.last_payment_at?.toISOString().slice(0, 10) ?? null,
      hasOutstanding,
      // Outstanding figure is shown only on TIN search (strongest identifier).
      outstandingAmountKobo: tin && hasOutstanding ? compliance?.outstanding_amount_kobo : undefined,
      obligations: obligationNames.map((o) => o.name),
      eligibleProgrammes: programmes.map((p) => p.name),
      message: statusMessages[complianceStatus] ?? '',
    });
  }),
);
