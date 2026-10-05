/**
 * One trader, one presumptive bill for the year.
 *
 * `assessFromObservation` refused to assess one observation twice, so a
 * retried request could not double a bill. It did nothing about two
 * observations of the same trader — a second visit, or a second agent at the
 * same stall — and assessed each as if it were the only one. Measured with the
 * tailor `what-the-agent-saw` uses: two observations, two assessments, and two
 * invoices of 4,800,000 kobo, both for 2026. The trader owed one year's
 * presumptive tax and had been billed for two.
 *
 * A year's bill now counts while its assessment stands and its invoice has not
 * been cancelled. A lapsed bill is still owed, so it still counts. One
 * withdrawn after an upheld objection, or withdrawn as raised in error, does
 * not — which is how a trader whose first assessment was wrong is assessed
 * again.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { withdrawUnpaidBill } from '../services/revenue';
import {
  assessFromObservation,
  decideObjection,
  raiseObjection,
  recordObservation,
} from '../services/enumeration';
import { adoptNanoPolicy, classifyLga, publishScheduleEntry } from '../services/presumptive';
import { currentYearInPlateau } from '../lib/calendar-day';

let auth: { token: string; deviceId: string };
let officerId: string;
let secondOfficerId: string;
let lgaId: string;
let seq = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    fullName: 'Assessing Officer',
    phone: '+2348000000101',
    role: 'admin',
  });
  secondOfficerId = await createGovernmentUser({
    fullName: 'Reviewing Officer',
    phone: '+2348000000102',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  lgaId = (await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1', []))!.id;
  seq = 0;

  await adoptNanoPolicy(pool, {
    construction: 'CONJUNCTIVE',
    turnoverCeilingKobo: '1200000000',
    legalBasis: 'Opinion of the Attorney-General of Plateau State, 12 January 2026',
    effectiveFrom: '2026-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
  await classifyLga(pool, {
    lgaId,
    classCode: 'A',
    indexInputs: { roadAccess: 'paved' },
    indexSource: 'National Bureau of Statistics',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2029-01-01',
    actorId: officerId,
    actorRole: 'admin',
  });
  for (const [band, turnover] of [['MICRO', '90000000'], ['SMALL', '480000000']] as const) {
    await publishScheduleEntry(pool, {
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: band,
      lgaClass: 'A',
      assumedAnnualTurnoverKobo: turnover,
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
      effectiveFrom: '2026-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });
  }
});

async function trader(name: string) {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: name,
      lastName: `Twice${suffix}`,
      phone: `+23480445${suffix}`,
      address: '7 Terminus Market, Jos',
      lgaId,
      economicSector: 'ARTISAN_CRAFT',
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `twice-tp-${suffix}` },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.taxpayerId as string;
}

/** The tailor: a lock-up shop, two machines, one apprentice. SMALL, and billed. */
const observe = (taxpayerId: string, premises: 'LOCK_UP_SHOP' | 'NONE' = 'LOCK_UP_SHOP') =>
  recordObservation(pool, {
    taxpayerId,
    premises,
    equipmentCount: premises === 'NONE' ? 0 : 2,
    peopleWorking: premises === 'NONE' ? 0 : 1,
    economicSector: 'ARTISAN_CRAFT',
    actorId: officerId,
    actorRole: 'admin',
  });

const assess = (observationId: string) =>
  assessFromObservation(pool, { observationId, actorId: officerId, actorRole: 'admin' });

async function liveBills(taxpayerId: string) {
  return query<{ invoice_number: string; amount_kobo: string; period_label: string }>(
    pool,
    `SELECT i.invoice_number, i.amount_kobo::text AS amount_kobo, a.period_label
       FROM invoices i JOIN assessments a ON a.id = i.assessment_id
      WHERE a.taxpayer_id = $1 AND i.status <> 'CANCELLED'
      ORDER BY i.created_at`,
    [taxpayerId],
  );
}

describe('a second observation of a trader already billed for the year', () => {
  it('is refused, and names the bill that already stands', async () => {
    const taxpayer = await trader('Amina');
    const first = await assess((await observe(taxpayer)).id);
    const second = await observe(taxpayer);

    await assert.rejects(assess(second.id), (error: { code?: string; message?: string }) => {
      assert.equal(error.code, 'ALREADY_BILLED_THIS_YEAR');
      assert.ok(error.message?.includes(first.invoiceNumber!), String(error.message));
      return true;
    });

    const bills = await liveBills(taxpayer);
    assert.equal(bills.length, 1, `billed ${bills.length} times: ${JSON.stringify(bills)}`);
    assert.equal(bills[0]!.invoice_number, first.invoiceNumber);
  });

  it('leaves the second observation unassessed, so it can be assessed later', async () => {
    const taxpayer = await trader('Bala');
    await assess((await observe(taxpayer)).id);
    const second = await observe(taxpayer);
    await assess(second.id).catch(() => undefined);

    const row = await queryOne<{ n: string }>(
      pool,
      'SELECT count(*)::text AS n FROM presumptive_assessments WHERE observation_id = $1',
      [second.id],
    );
    assert.equal(row!.n, '0', 'the refusal rolled back with nothing recorded');
  });

  it('is refused over the HTTP route too, as a conflict the officer can read', async () => {
    const taxpayer = await trader('Chinwe');
    await assess((await observe(taxpayer)).id);
    const second = await observe(taxpayer);
    const officer = await loginAs('+2348000000101');

    const response = await post(
      `/government/enumeration/observations/${second.id}/assess`,
      {},
      { token: officer.accessToken },
    );
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'ALREADY_BILLED_THIS_YEAR');
    assert.match(response.body.error.nextStep, /objects/i);
  });
});

describe('when the first bill no longer stands', () => {
  it('assesses the second observation once an objection to the first is upheld', async () => {
    const taxpayer = await trader('Danjuma');
    const first = await assess((await observe(taxpayer)).id);
    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: first.id,
      ground: 'FACTS_WRONG',
      statement: 'There is no apprentice and one of the machines is broken.',
      actorId: officerId,
      actorRole: 'admin',
    });
    await decideObjection(pool, {
      objectionId: objection.id,
      uphold: true,
      reason: 'Re-checked on site; the facts were wrong.',
      actorId: secondOfficerId,
      actorRole: 'admin',
    });

    const second = await assess((await observe(taxpayer)).id);
    const bills = await liveBills(taxpayer);
    assert.deepEqual(
      bills.map((bill) => bill.invoice_number),
      [second.invoiceNumber],
      'the withdrawn bill is gone and the new one stands',
    );
  });

  /*
   * A paid bill is not cancelled when an objection to it is upheld: the money
   * was taken, so the invoice stays PAID and a refund is asked for. The year's
   * bill no longer stands even though its invoice does, and the trader still
   * owes a correct one.
   */
  it('assesses the second observation once an objection to a paid bill is upheld', async () => {
    const taxpayer = await trader('Dauda');
    const first = await assess((await observe(taxpayer)).id);
    const charge = (await queryOne<{ id: string }>(
      pool,
      `SELECT t.id FROM presumptive_assessments pa
         JOIN invoices i ON i.assessment_id = pa.assessment_id
         JOIN transactions t ON t.invoice_id = i.id
        WHERE pa.id = $1`,
      [first.id],
    ))!;
    const started = await post(
      '/payments/initiate',
      { transactionId: charge.id },
      { ...auth, idempotencyKey: 'twice-paid' },
    );
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const settled = await post(
      '/payments/simulate',
      { gatewayReference: started.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      auth,
    );
    assert.equal(settled.status, 200, JSON.stringify(settled.body));

    const objection = await raiseObjection(pool, {
      presumptiveAssessmentId: first.id,
      ground: 'FACTS_WRONG',
      statement: 'The shop is a stall and there is no apprentice.',
      actorId: officerId,
      actorRole: 'admin',
    });
    const decided = await decideObjection(pool, {
      objectionId: objection.id,
      uphold: true,
      reason: 'Re-checked on site; the facts were wrong.',
      actorId: secondOfficerId,
      actorRole: 'admin',
    });
    assert.equal(decided.refundsRequested.length, 1, 'the money taken is being returned');

    const second = await assess((await observe(taxpayer)).id);
    assert.ok(second.invoiceNumber, 'a withdrawn assessment is not a bill for the year');
  });

  it('assesses the second observation once the first bill is withdrawn as raised in error', async () => {
    const taxpayer = await trader('Esther');
    const first = await assess((await observe(taxpayer)).id);
    const assessmentId = (await queryOne<{ assessment_id: string }>(
      pool,
      'SELECT assessment_id FROM presumptive_assessments WHERE id = $1',
      [first.id],
    ))!.assessment_id;
    await withTransaction((client) =>
      withdrawUnpaidBill(client, assessmentId, { actorId: officerId, reason: 'raised in error' }),
    );

    const second = await assess((await observe(taxpayer)).id);
    assert.ok(second.invoiceNumber, 'a cancelled bill is not a bill for the year');
  });
});

describe('what still counts, and what never did', () => {
  it('counts a bill that lapsed unpaid, because a lapsed bill is still owed', async () => {
    const taxpayer = await trader('Fatima');
    await assess((await observe(taxpayer)).id);
    await pool.query(
      `UPDATE invoices SET status = 'EXPIRED'
        WHERE assessment_id IN (SELECT id FROM assessments WHERE taxpayer_id = $1)`,
      [taxpayer],
    );

    await assert.rejects(assess((await observe(taxpayer)).id), /already has a presumptive bill/);
  });

  it('does not count last year’s bill against this year', async () => {
    const taxpayer = await trader('Garba');
    await assess((await observe(taxpayer)).id);
    await pool.query(`UPDATE assessments SET period_label = $2 WHERE taxpayer_id = $1`, [
      taxpayer,
      String(currentYearInPlateau() - 1),
    ]);

    const second = await assess((await observe(taxpayer)).id);
    assert.ok(second.invoiceNumber, 'this year has not been billed');
  });

  it('does not count an exemption as a bill', async () => {
    const taxpayer = await trader('Hauwa');
    const exempt = await assess((await observe(taxpayer, 'NONE')).id);
    assert.equal(exempt.taxTier, 'NANO');

    const billed = await assess((await observe(taxpayer)).id);
    assert.equal(billed.taxTier, 'PRESUMPTIVE');
    assert.equal((await liveBills(taxpayer)).length, 1);
  });

  it('does not stop a different trader being billed', async () => {
    await assess((await observe(await trader('Ibrahim'))).id);
    const other = await assess((await observe(await trader('Jummai'))).id);
    assert.ok(other.invoiceNumber);
  });
});
