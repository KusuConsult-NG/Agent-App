/**
 * The day the notice told everyone to come in by.
 *
 * `incentive_programmes.end_date` is a DATE, so `pg` returns midnight at the
 * START of the day a programme closes. `evaluateEligibility` compared that
 * instant against `now`:
 *
 *     if (programme.end_date && programme.end_date < now)
 *       reasons.push('The programme has closed');
 *
 * — which is true from one second after midnight on the closing date. For the
 * whole of a programme's final day, everyone who applied was told it had
 * already closed. That is the day the radio announcement names, the day the
 * reminder SMS names, and therefore the day people actually turn up: the queue
 * at a tax amnesty is longest on the last day, and every one of them was
 * refused.
 *
 * The schema permits `end_date = start_date` — `CHECK (end_date IS NULL OR
 * end_date >= start_date)` — so a one-day programme was never open at all, at
 * any instant of its existence.
 *
 * The window was also inconsistent with itself. `start_date > now` is false
 * from midnight, so the opening day was included; the closing day was not. The
 * same interval was inclusive at one end and exclusive at the other.
 *
 * These checks sit in the SCOPE half of the evaluation, above the split
 * between a gated and an additive programme, so they deny in both modes. An
 * additive benefit is one PRD §40 forbids withdrawing on tax grounds — and on
 * its closing day this withdrew it anyway, and nulled the entitlement tier
 * with it.
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
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { evaluateEligibility } from '../services/incentives';

let agent: { token: string; device: string };
let lgaId = '';
let taxpayerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();
  await createGovernmentUser({ fullName: 'Amnesty Admin', phone: '+2348000000081', role: 'admin' });
  await loginAs('+2348000000081');

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };

  taxpayerId = await registerTaxpayer();
});

/**
 * A calendar day as THIS PROCESS reckons it.
 *
 * Deliberately not `CURRENT_DATE`, which is the database session's idea of
 * today. The comparison under test is made in Node against `new Date()`, so
 * the fixture has to name the same day the code will, whatever either is
 * configured to.
 */
function day(offset: number): string {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
    at.getDate(),
  ).padStart(2, '0')}`;
}

/** A taxpayer in scope for anything: individual, with a TIN, no arrears. */
async function registerTaxpayer(): Promise<string> {
  const created = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Amnesty',
      lastName: 'Applicant',
      phone: '+2348066600021',
      address: '8 Market Road, Bokkos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agent.token, deviceId: agent.device, idempotencyKey: 'tp-amnesty' },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await pool.query(
    `UPDATE taxpayers SET tin = 'PL90000021', tin_status = 'ASSIGNED' WHERE id = $1`,
    [created.body.taxpayerId],
  );
  return created.body.taxpayerId as string;
}

/**
 * An open programme with nothing to fail but the window.
 *
 * Score zero, no periods required, arrears ignored — so `eligible` says
 * exactly one thing: whether the programme was running on the day it was
 * asked.
 */
async function programme(options: {
  code: string;
  startDate: string;
  endDate: string | null;
  mode?: 'ELIGIBILITY_GATE' | 'ADDITIVE_BENEFIT';
}): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO incentive_programmes
       (name, code, description, benefit_type, benefit_description, eligibility_rules,
        minimum_score, minimum_compliance_periods, requires_no_arrears,
        start_date, end_date, approval_authority, status, linkage_mode)
     VALUES ($1,$2,'fixture','TAX_AMNESTY','fixture','{}'::jsonb,0,0,false,
             $3::date, $4::date, 'Test Authority', 'ACTIVE', $5)
     RETURNING id`,
    [
      `Programme ${options.code}`,
      options.code,
      options.startDate,
      options.endDate,
      options.mode ?? 'ELIGIBILITY_GATE',
    ],
  );
  return row.rows[0]!.id;
}

const CLOSED = 'The programme has closed';
const NOT_OPEN = 'The programme has not opened yet';

describe('a programme on the date it closes', () => {
  it('is still open', async () => {
    const programmeId = await programme({
      code: 'AMN-LAST',
      startDate: day(-30),
      endDate: day(0),
    });

    const verdict = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(
      verdict.reasons.includes(CLOSED),
      false,
      `refused on its own closing date: ${JSON.stringify(verdict.reasons)}`,
    );
    assert.equal(verdict.eligible, true, JSON.stringify(verdict.reasons));
  });

  it('is open even when that is also the day it opened', async () => {
    /*
     * A one-day programme, which the schema's `end_date >= start_date` check
     * exists to permit. Under the old comparison it was closed from midnight
     * and open from midnight — never open, at any instant.
     */
    const programmeId = await programme({
      code: 'AMN-ONEDAY',
      startDate: day(0),
      endDate: day(0),
    });

    const verdict = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(
      verdict.reasons.includes(CLOSED),
      false,
      `a one-day programme was never open: ${JSON.stringify(verdict.reasons)}`,
    );
    assert.equal(verdict.reasons.includes(NOT_OPEN), false, JSON.stringify(verdict.reasons));
    assert.equal(verdict.eligible, true, JSON.stringify(verdict.reasons));
  });

  it('still awards the entitlement an additive programme may never withdraw', async () => {
    /*
     * The window is checked in the scope half, above the mode split, so this
     * denial reached past the one guarantee ADDITIVE_BENEFIT makes — and a
     * denied scope check nulls `benefitTier` outright.
     */
    const programmeId = await programme({
      code: 'AMN-ADD',
      startDate: day(-30),
      endDate: day(0),
      mode: 'ADDITIVE_BENEFIT',
    });

    const verdict = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(verdict.eligible, true, JSON.stringify(verdict.reasons));
    assert.equal(
      verdict.benefitTier,
      'FULL',
      `an additive benefit was withdrawn on the closing day: ${JSON.stringify(verdict)}`,
    );
  });
});

describe('the window still closes, and still opens', () => {
  /*
   * The controls. Widening the closing end to the day it names must not widen
   * it past that day, and must not touch the opening end, which was already
   * right.
   */
  it('a programme that ended yesterday is closed', async () => {
    const programmeId = await programme({
      code: 'AMN-OVER',
      startDate: day(-30),
      endDate: day(-1),
    });

    const verdict = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(verdict.eligible, false, JSON.stringify(verdict.reasons));
    assert.ok(verdict.reasons.includes(CLOSED), JSON.stringify(verdict.reasons));
  });

  it('a programme that opens tomorrow has not opened', async () => {
    const programmeId = await programme({
      code: 'AMN-SOON',
      startDate: day(1),
      endDate: day(30),
    });

    const verdict = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(verdict.eligible, false, JSON.stringify(verdict.reasons));
    assert.ok(verdict.reasons.includes(NOT_OPEN), JSON.stringify(verdict.reasons));
  });

  it('a programme with no closing date is open', async () => {
    const programmeId = await programme({
      code: 'AMN-OPEN',
      startDate: day(-30),
      endDate: null,
    });

    const verdict = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(verdict.eligible, true, JSON.stringify(verdict.reasons));
    assert.equal(verdict.reasons.includes(CLOSED), false, JSON.stringify(verdict.reasons));
  });
});
