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
import { pool, queryOne } from '../db/pool';
import { rateLimit } from '../middleware/security';
import { validateQuery } from '../middleware/validate';
import { syncTaxpayerComplianceAndIncentives } from '../services/incentives';
import { logVerificationAttempt } from '../services/receipts';

export const citizenRouter = Router();

/**
 * Record that somebody asked, and what they got.
 *
 * This endpoint answers, without a login, what a named person owes. The rate
 * limit stops it being hammered from one address; it does not leave anything
 * behind, so a patient enumeration across addresses was invisible. Receipt
 * verification has always recorded every attempt including the misses, for
 * exactly this reason, and a TIN is far more guessable than a receipt number.
 *
 * The value is hashed rather than stored. Repetition stays visible — the same
 * TIN probed two hundred times is two hundred identical hashes — and the log
 * does not become somewhere a taxpayer's phone number sits in the clear.
 *
 * A failure to write the log must never fail the citizen's lookup: this is
 * evidence, not a control, and refusing to tell somebody what they owe because
 * an audit insert failed would be the wrong trade.
 */
async function recordLookup(
  ipAddress: string | null | undefined,
  value: string,
  result: 'VALID' | 'NOT_FOUND',
): Promise<void> {
  await logVerificationAttempt(pool, {
    lookupType: 'TAXPAYER',
    lookupValue: value,
    result,
    ipAddress: ipAddress ?? null,
    hashValue: true,
  }).catch(() => undefined);
}

// Strict rate limit — 10 per minute per IP — to prevent TIN/phone enumeration.
citizenRouter.use(rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'citizen-status', keyBy: 'ip' }));

const citizenQuerySchema = z.object({
  tin:   z.string().min(3).max(30).optional(),
  phone: z.string().min(8).max(20).optional(),
  name:  z.string().min(2).max(120).optional(),
});

citizenRouter.get(
  '/',
  validateQuery(citizenQuerySchema, async (req, res, data) => {
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
      await recordLookup(req.clientIp, name, count > 0 ? 'VALID' : 'NOT_FOUND');
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
      await recordLookup(req.clientIp, (tin ?? phone)!, 'NOT_FOUND');
      res.json({
        found: false,
        message: tin
          ? 'No active taxpayer record found for that TIN.'
          : 'No active taxpayer record found for that phone number.',
      });
      return;
    }

    await recordLookup(req.clientIp, (tin ?? phone)!, 'VALID');

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

    // WHAT AN ANONYMOUS CALLER IS TOLD, AND WHY IT IS THIS LITTLE.
    //
    // This endpoint cannot tell the taxpayer from anyone else who knows their
    // phone number, and a phone number is not a secret: a rival trader, a
    // lender, a former partner or a local official may all have it. So every
    // field here is read as though a stranger asked for it, because one can.
    //
    // Three things used to be returned that do not survive that reading.
    //
    // The TIN itself. The caller supplied a phone number and received a
    // government identifier they did not have — and this platform's own
    // duplicate detection treats a matching TIN as identity-grade, blocking
    // at 100 where a shared phone scores 85. Handing out the stronger
    // identifier in exchange for the weaker one inverts that judgement.
    //
    // The numeric compliance score, and the programmes it makes the taxpayer
    // eligible for. Under the incentive design these decide access to
    // fertiliser, health insurance and farm inputs, which makes a person's
    // score socially and economically consequential — and so nobody else's
    // business.
    //
    // The obligation names and the last payment date. A list like "Cattle
    // Dealer Levy" describes someone's trade and livelihood, and a payment
    // date describes their circumstances.
    //
    // What remains is what a person needs in order to act: whether anything
    // is owed, whether a TIN has been issued, and where to go. The detail is
    // still available in full through the agent and officer channels, which
    // establish who they are speaking to first. The queries that fetched the
    // obligation names and the eligible programmes are gone with the fields
    // they fed — syncTaxpayerComplianceAndIncentives above already refreshes
    // both, so nothing else depended on them.
    res.json({
      found: true,
      tinStatus: taxpayer.tin_status,
      complianceStatus,
      hasOutstanding,
      message: statusMessages[complianceStatus] ?? '',
      detail:
        'For your TIN, your compliance score, what you owe and which support programmes you ' +
        'qualify for, visit any PSIRS office or an authorised revenue agent. They will confirm ' +
        'who you are first, which is why those details are not shown here.',
    });
  }),
);
