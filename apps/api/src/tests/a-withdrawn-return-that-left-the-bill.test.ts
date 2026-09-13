/**
 * A PAYE return withdrawn, and the bill that stayed behind.
 *
 * `filePayeSchedule` raises an assessment, which raises an invoice, which is
 * what the employer owes. `cancelPayeSchedule` marks the schedule CANCELLED,
 * writes an audit entry, and stops. It never touches the assessment or the
 * invoice, so withdrawing a return leaves the employer billed for it.
 *
 * WHAT MAKES THIS WORSE THAN AN OVERSIGHT
 *
 * The filing path refuses a second return for the same month and tells the
 * officer exactly what to do about it:
 *
 *     A return has already been filed for this employer and month. Cancel it
 *     first if it was wrong — a second filing would double what they appear
 *     to owe.
 *     Open the existing return to cancel and replace it.
 *
 * So the platform names cancellation as the remedy that prevents doubling. An
 * officer who files September wrong, cancels it, and re-files the corrected
 * figures leaves the employer owing BOTH — which is precisely the doubling
 * the message promised cancelling would avoid. The instruction causes the
 * harm it warns about.
 *
 * WHY NOTHING CAUGHT IT
 *
 * No test reaches `POST /government/paye/returns/:id/cancel`. The repository's
 * own route-coverage tool puts it among fourteen declared routes nothing
 * exercises, all of them in subsystems built since the last certification
 * revision. This file closes that one.
 *
 * THE REMEDY IS THE PLATFORM'S OWN
 *
 * `enumeration.ts` already withdraws a bill when an objection is upheld, and
 * says why: "An upheld objection that left the bill standing would be a
 * decision in the taxpayer's favour that cost them exactly nothing — and the
 * arrears worklist would go on chasing them for it." A withdrawn PAYE return
 * is the same act. The fix mirrors it, including its guard: only a bill that
 * has not been paid is withdrawn.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

const OFFICER = '+2348083000001';
let officer = '';
let employerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'PAYE Officer',
    phone: OFFICER,
    role: 'revenue_officer',
  });
  officer = (await loginAs(OFFICER)).accessToken;

  const lgaId = await firstLgaId();
  const employer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, business_name, phone, address, lga_id, status,
                            consent_given, declaration_accepted)
     VALUES ('BUSINESS', 'Jos Haulage Limited', '+2348083099999', '9 Yard Road, Jos',
             $1, 'ACTIVE', true, true)
     RETURNING id`,
    [lgaId],
  );
  employerId = employer!.id;
});

const auth = () => ({ token: officer });

/** The month before this one, which has ended and so can be returned. */
function lastMonth(): { year: number; month: number } {
  const now = new Date();
  const when = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: when.getUTCFullYear(), month: when.getUTCMonth() + 1 };
}

async function fileReturn(grossKobo = '90000000') {
  const { year, month } = lastMonth();
  const filed = await post(
    '/government/paye/returns',
    {
      employerTaxpayerId: employerId,
      periodYear: year,
      periodMonth: month,
      lines: [
        { employeeName: 'Amina Bala', grossEmolumentKobo: grossKobo },
        { employeeName: 'Danjuma Pam', grossEmolumentKobo: grossKobo },
      ],
    },
    auth(),
  );
  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  return filed.body as { scheduleId: string; taxDueKobo: string; assessmentId: string };
}

/** What the employer is actually being asked for, by invoice status. */
async function billsFor(): Promise<{ status: string; total: string }[]> {
  return query<{ status: string; total: string }>(
    pool,
    `SELECT status, total_amount_kobo::text AS total
       FROM invoices WHERE taxpayer_id = $1 ORDER BY created_at`,
    [employerId],
  );
}

// ===========================================================================
describe('withdrawing a PAYE return withdraws the bill it raised', () => {
  it('leaves no unpaid bill standing against the employer', async () => {
    const filed = await fileReturn();

    const before = await billsFor();
    assert.equal(before.length, 1, 'filing raised exactly one bill');
    assert.ok(['UNPAID', 'PARTIALLY_PAID'].includes(before[0]!.status));

    const cancelled = await post(
      `/government/paye/returns/${filed.scheduleId}/cancel`,
      { reason: 'Filed against the wrong employer record.' },
      auth(),
    );
    // 204: the withdrawal returns no body, which is why the bill has to be
    // checked in the database rather than read off a response.
    assert.equal(cancelled.status, 204, JSON.stringify(cancelled.body));

    const after = await billsFor();
    assert.equal(
      after[0]!.status,
      'CANCELLED',
      `the return was withdrawn and the employer is still billed ${after[0]!.total} kobo`,
    );
  });

  /*
   * The consequence the filing path's own refusal names. This is the sequence
   * an officer is instructed to follow, and it is what the message promises
   * will not double the liability.
   */
  it('so cancel-and-refile does not double what the employer appears to owe', async () => {
    const first = await fileReturn('90000000');

    await post(
      `/government/paye/returns/${first.scheduleId}/cancel`,
      { reason: 'Gross figures were taken from the wrong column.' },
      auth(),
    );

    const second = await fileReturn('45000000');
    assert.ok(second.scheduleId, 'the corrected return was accepted');

    const outstanding = (await billsFor())
      .filter((bill) => bill.status !== 'CANCELLED')
      .reduce((total, bill) => total + BigInt(bill.total), 0n);

    const onlyTheCorrection = BigInt(second.taxDueKobo);
    assert.equal(
      outstanding,
      onlyTheCorrection,
      'the withdrawn return is still being demanded alongside the corrected one',
    );
  });

  /*
   * The control on the remedy. A bill the employer has already paid is not a
   * bill to withdraw — that is a refund decision, and the objection path this
   * mirrors guards it the same way. Cancelling the return must not quietly
   * erase a settled liability.
   */
  it('does not withdraw a bill the employer has already paid', async () => {
    const filed = await fileReturn();
    await query(pool, `UPDATE invoices SET status = 'PAID' WHERE taxpayer_id = $1`, [employerId]);

    await post(
      `/government/paye/returns/${filed.scheduleId}/cancel`,
      { reason: 'Withdrawn after payment, which is a refund question.' },
      auth(),
    );

    const after = await billsFor();
    assert.equal(after[0]!.status, 'PAID', 'a paid bill is not cancelled by withdrawing the return');
  });

  /* The control that the withdrawal itself still happens and is accountable. */
  it('still records the withdrawal against the officer who made it', async () => {
    const filed = await fileReturn();
    await post(
      `/government/paye/returns/${filed.scheduleId}/cancel`,
      { reason: 'Duplicate of the return filed by the LGA office.' },
      auth(),
    );

    const schedule = await queryOne<{ status: string; cancelled_by: string | null }>(
      pool,
      `SELECT status, cancelled_by FROM paye_schedules WHERE id = $1`,
      [filed.scheduleId],
    );
    assert.equal(schedule!.status, 'CANCELLED');
    assert.ok(schedule!.cancelled_by, 'the officer who withdrew it is on the record');
  });
});
