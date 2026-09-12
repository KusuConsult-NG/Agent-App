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
import { badRequest } from '../lib/errors';
import { rateLimit } from '../middleware/security';
import { validateBody, validateQuery } from '../middleware/validate';
import { syncTaxpayerComplianceAndIncentives } from '../services/incentives';
import { requestOtp, verifyOtp } from '../services/auth';
import { paymentHistory } from '../services/payment-history';
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
      status_reason: string | null;
    } | null = null;

    /*
     * Any record that is still this person's, not only an active one.
     *
     * Both lookups required `status = 'ACTIVE'`, which was harmless for as
     * long as no record could be anything else. Migration 038 gave a record an
     * end, and the moment one is closed that filter starts telling a citizen
     * who may still owe money that PSIRS has no record of them at all. A
     * closed record does not stop being owed; it stops being chased. Saying
     * "no record found" to the person holding the debt is the platform
     * asserting something untrue about money, which is the one thing §95 is
     * there to prevent.
     *
     * MERGED is the exception and stays excluded: that record was folded into
     * another one, and the answer for the person is on the record it went
     * into, not on the shell it left behind.
     */
    if (tin) {
      taxpayer = await queryOne(
        pool,
        `SELECT id, tin, tin_status, phone, status, status_reason FROM taxpayers
          WHERE tin = $1 AND status <> 'MERGED'`,
        [tin.trim().toUpperCase()],
      );
    } else if (phone) {
      taxpayer = await queryOne(
        pool,
        `SELECT id, tin, tin_status, phone, status, status_reason FROM taxpayers
          WHERE phone = $1 AND status <> 'MERGED'
          ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1`,
        [phone.trim()],
      );
    }

    if (!taxpayer) {
      await recordLookup(req.clientIp, (tin ?? phone)!, 'NOT_FOUND');
      res.json({
        found: false,
        message: tin
          ? 'No taxpayer record found for that TIN.'
          : 'No taxpayer record found for that phone number.',
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
      disputed_amount_kobo: string;
      last_payment_at: Date | null;
      compliant_periods: number;
      assessments_raised: number;
    }>(
      pool,
      `SELECT score, has_valid_tin, outstanding_amount_kobo, disputed_amount_kobo,
              last_payment_at, compliant_periods, assessments_raised
         FROM taxpayer_compliance WHERE taxpayer_id = $1`,
      [taxpayer.id],
    );

    /*
     * What is owed and still being pursued, and what is on hold.
     *
     * An open objection suspends enforcement, and this page is where a citizen
     * finds out where they stand. It was reading the gross figure, so a trader
     * who had formally objected was told "You have outstanding tax
     * obligations. Please contact your nearest PSIRS office or a revenue agent
     * to pay" — the State pressing for money it had agreed not to press for,
     * on a bill the objection might be about to overturn.
     *
     * Netting it off alone would replace that with "Your tax records are up to
     * date", which is not true either. A live objection is its own answer and
     * gets its own status.
     */
    const disputed = compliance ? BigInt(compliance.disputed_amount_kobo) : 0n;
    const hasOutstanding = compliance
      ? BigInt(compliance.outstanding_amount_kobo) - disputed > 0n
      : false;

    const score = compliance?.score ?? 0;

    /*
     * NOT_ASSESSED is about history, not about the absence of a row.
     *
     * Every read path calls syncTaxpayerComplianceAndIncentives first, so by
     * the time this runs a row always exists — which made the NOT_ASSESSED
     * branch below unreachable in practice. A taxpayer registered the same
     * morning, assessed nothing and owing nothing, therefore fell through to
     * NEEDS_ATTENTION and was told their "compliance score needs improvement".
     * They had not been asked for anything yet.
     *
     * `assessments_raised` is the denominator the score's ratios are taken
     * over. Zero means there is nothing to judge, which is a different answer
     * from a low judgement.
     */
    const complianceStatus =
      !compliance || compliance.assessments_raised === 0
        ? 'NOT_ASSESSED'
        : hasOutstanding
          ? 'HAS_ARREARS'
          : disputed > 0n
            ? 'UNDER_OBJECTION'
            : score >= 60
              ? 'COMPLIANT'
              : 'NEEDS_ATTENTION';

    const statusMessages: Record<string, string> = {
      COMPLIANT: 'Your tax records are up to date. Keep paying on time to maintain your status.',
      HAS_ARREARS: 'You have outstanding tax obligations. Please contact your nearest PSIRS office or a revenue agent to pay.',
      NEEDS_ATTENTION: 'Your compliance score needs improvement. Paying your obligations on time will raise it.',
      NOT_ASSESSED: 'Nothing has been assessed against you yet, so there is no compliance score to report. This will update after your first assessment.',
      UNDER_OBJECTION: 'An assessment against you is under objection, so nothing is being enforced while PSIRS decides it. You do not need to do anything, and you are not treated as being in arrears in the meantime.',
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
    /*
     * A record that has been taken off the register says so, but not in the
     * officer's words.
     *
     * This returned `status_reason` verbatim, on the reasoning that a person
     * told the State has closed their record is owed the reason, and that the
     * commonest cause of a closure in error is a shop assumed shut that was
     * not — which the person can only correct if they are told. The intent was
     * right and the channel was wrong: this endpoint cannot tell the taxpayer
     * from anybody else who knows their phone number, which is the premise the
     * rest of this file is built on. An officer writing "Trader died in April;
     * family says the stall was sold to settle a moneylender" is writing to a
     * colleague, and it was being handed to any caller who could guess a
     * number. The header three hundred lines above says officer notes are
     * NEVER returned; this was the exception nobody had noticed making.
     *
     * What survives is everything the person needs in order to act: that the
     * record is closed, whether anything is still owed, and that any office can
     * put it back. The reason itself is on the agent and officer channels,
     * which establish who they are speaking to first — the same trade the
     * `detail` field below already explains for the TIN, the score and the
     * amount.
     *
     * `hasOutstanding` is untouched by any of this. What is owed is owed
     * whether or not the record is still on the register.
     */
    const ended =
      taxpayer.status === 'ACTIVE'
        ? null
        : {
            status: taxpayer.status,
            message:
              `This record has been ${taxpayer.status.toLowerCase()} and no new charge will be ` +
              'raised against it. ' +
              (hasOutstanding
                ? 'What was already owed is still owed and can still be paid.'
                : 'Nothing is outstanding.') +
              ' If this is wrong, any PSIRS office can put the record back on the register, and ' +
              'they can tell you why it was closed once they have confirmed who you are.',
          };

    res.json({
      found: true,
      tinStatus: taxpayer.tin_status,
      complianceStatus,
      hasOutstanding,
      ...(ended ? { ended } : {}),
      message: statusMessages[complianceStatus] ?? '',
      detail:
        'For your TIN, your compliance score, what you owe and which support programmes you ' +
        'qualify for, visit any PSIRS office or an authorised revenue agent. They will confirm ' +
        'who you are first, which is why those details are not shown here.',
    });
  }),
);


/* ---------------------------------------------------------------------------
 * "What have I already paid?"
 *
 * The question a taxpayer asks most and the platform could not answer. It
 * cannot be answered by the endpoint above, and the reasoning is that
 * endpoint's own: it cannot tell the taxpayer from anybody who knows their
 * phone number, which is why the date of the last payment was taken out of it.
 * A year of payments is that judgement a hundred times over — every levy, when,
 * and how much, which together describe somebody's trade, their takings and
 * their movements.
 *
 * So this is not a stricter identifier, it is a different kind of proof. A TIN
 * and a phone number are both things a stranger can know. A code sent to the
 * number ON THE RECORD is something only the person holding that handset can
 * read.
 * ------------------------------------------------------------------------- */

/** Find the record without saying whether one was found. */
async function taxpayerFor(tin?: string, phone?: string) {
  if (tin) {
    return queryOne<{ id: string; phone: string }>(
      pool,
      `SELECT id, phone FROM taxpayers WHERE tin = $1 AND status <> 'MERGED'`,
      [tin.trim().toUpperCase()],
    );
  }
  if (phone) {
    return queryOne<{ id: string; phone: string }>(
      pool,
      `SELECT id, phone FROM taxpayers WHERE phone = $1 AND status <> 'MERGED'
        ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
      [phone.trim()],
    );
  }
  return null;
}

const identifierSchema = z
  .object({
    tin: z.string().min(3).max(30).optional(),
    phone: z.string().min(8).max(20).optional(),
  })
  .refine((value) => Boolean(value.tin || value.phone), {
    message: 'Give your TIN or the phone number on your record.',
  });

citizenRouter.post(
  '/statement/request',
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'citizen-statement-request', keyBy: 'ip' }),
  validateBody(identifierSchema, async (req, res, data) => {
    const taxpayer = await taxpayerFor(data.tin, data.phone);

    if (taxpayer) {
      /*
       * To the number on the record. Never to a number in the request.
       *
       * This is the whole control. A stranger who knows somebody's TIN gets
       * one outcome from this endpoint: that person's phone buzzes. They learn
       * nothing, and the taxpayer finds out somebody asked.
       */
      await requestOtp({
        destination: taxpayer.phone,
        purpose: 'CITIZEN_STATEMENT',
        userId: null,
      });
    }

    /*
     * The same answer either way.
     *
     * A "no record found" here would turn this into a TIN validity oracle that
     * costs nothing to query — worse than the one on the status endpoint,
     * because that one at least answers a question the citizen came to ask.
     * This endpoint's answer is "if that record exists, its phone has a code",
     * which is true whether or not it does.
     */
    res.json({
      sent: true,
      message:
        'If a record matches, a code has been sent to the phone number on it. ' +
        'The code is not sent to a number you type here.',
    });
  }),
);

citizenRouter.post(
  '/statement',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'citizen-statement', keyBy: 'ip' }),
  validateBody(
    identifierSchema.and(
      z.object({
        code: z.string().min(4).max(10),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
      }),
    ),
    async (req, res, data) => {
      const taxpayer = await taxpayerFor(data.tin, data.phone);
      if (!taxpayer) {
        throw badRequest('That code is not valid, or it has expired. Ask for a new one.');
      }

      /*
       * `verifyOtp` counts the attempt and refuses on its own budget, so a
       * six-digit code cannot be walked through. It is checked against the
       * number on the record, which is where it was sent.
       */
      await verifyOtp({
        destination: taxpayer.phone,
        purpose: 'CITIZEN_STATEMENT',
        code: data.code,
      });

      const to = data.to ?? new Date().toISOString().slice(0, 10);
      const from =
        data.from ??
        (() => {
          const start = new Date(to);
          start.setFullYear(start.getFullYear() - 1);
          return start.toISOString().slice(0, 10);
        })();

      const history = await paymentHistory(pool, { taxpayerId: taxpayer.id, from, to });

      res.json({
        from: history.from,
        to: history.to,
        summary: history.summary,
        /*
         * Without the receipt numbers.
         *
         * A receipt number is verification material in this platform — the
         * public verification endpoint takes one and confirms a payment
         * against it. Handing the set out here would let whoever passed the
         * code check verify payments elsewhere as though they held the
         * receipts. The taxpayer has the paper; this is the list, not the
         * proof.
         */
        rows: history.rows.map((row) => ({
          paidAt: row.paidAt,
          revenueItem: row.revenueItem,
          revenueItemHa: row.revenueItemHa,
          periodLabel: row.periodLabel,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          amountKobo: row.amountKobo,
          returned: row.returned,
        })),
      });
    },
  ),
);
