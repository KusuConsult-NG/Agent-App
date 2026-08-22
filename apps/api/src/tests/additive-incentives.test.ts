/**
 * Compliance may raise a benefit. It may not withdraw an essential one.
 *
 * PRD §40:
 *
 *   "The platform should not automatically deny essential public services
 *    merely because a person is not tax-compliant, unless such linkage is
 *    specifically authorized by applicable law or policy."
 *
 * The state health insurance scheme and the scholarship bursary were seeded as
 * gates: no arrears and a minimum score, or the citizen was recorded ineligible.
 * Both were created by raw SQL, which never reaches `createProgramme`, and both
 * were typed HEALTH_INSURANCE / EDUCATION_BURSARY while the guard matched the
 * strings HEALTHCARE / EDUCATION — so it could not have fired even through the
 * service. The safeguard was bypassed twice and no decision to bypass it was
 * ever recorded.
 *
 * `linkage_mode` makes the distinction the policy actually turns on:
 *
 *   ELIGIBILITY_GATE   compliance decides whether the citizen qualifies.
 *   ADDITIVE_BENEFIT   compliance decides how much; it never denies.
 *
 * These tests hold the line in both directions — that an additive programme
 * cannot be made to refuse anyone on tax grounds, and that a gated one still
 * refuses, because turning every programme additive would be its own kind of
 * wrong.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProgramme, evaluateEligibility } from '../services/incentives';
import { firstLgaId, pool, resetDatabase, startTestServer, stopTestServer } from './helpers';

let lgaId = '';
let officerId = '';

/** A score no fresh taxpayer reaches, so every fixture has a shortfall. */
const UNREACHABLE_SCORE = 95;

async function taxpayerWithTin(): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO taxpayers
       (taxpayer_type, first_name, last_name, phone, address, lga_id, tin, tin_status, status)
     VALUES ('INDIVIDUAL', 'Additive', 'Fixture', $1, 'Jos North', $2, $3, 'ASSIGNED', 'ACTIVE')
     RETURNING id`,
    [
      `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      lgaId,
      `PL${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    ],
  );
  return row.rows[0]!.id;
}

async function activeProgramme(params: {
  code: string;
  benefitType: string;
  linkageMode: 'ELIGIBILITY_GATE' | 'ADDITIVE_BENEFIT';
  minimumScore: number;
}): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO incentive_programmes
       (name, code, description, benefit_type, benefit_description, eligibility_rules,
        minimum_score, minimum_compliance_periods, requires_no_arrears,
        start_date, approval_authority, status, linkage_mode)
     VALUES ($1,$2,'fixture',$3,'fixture','{}'::jsonb,$4,0,false,
             CURRENT_DATE, 'Test Authority', 'ACTIVE', $5)
     RETURNING id`,
    [`Programme ${params.code}`, params.code, params.benefitType, params.minimumScore, params.linkageMode],
  );
  return row.rows[0]!.id;
}

before(async () => {
  await resetDatabase();
  await startTestServer();
  lgaId = await firstLgaId();

  const officer = await pool.query<{ id: string }>(
    `INSERT INTO users (full_name, phone, password_hash, role, status)
     VALUES ('Incentive Officer', '+2348079000001', 'x', 'revenue_officer', 'ACTIVE')
     RETURNING id`,
  );
  officerId = officer.rows[0]!.id;
});

after(async () => {
  await stopTestServer();
});

// ===========================================================================
describe('An additive programme never denies on tax grounds', () => {
  /**
   * The case the whole change exists for: a citizen behind on their taxes,
   * holding a TIN, asking for health cover.
   */
  it('keeps a non-compliant citizen eligible, at the base tier', async () => {
    const taxpayerId = await taxpayerWithTin();
    const programmeId = await activeProgramme({
      code: `ADD-HEALTH-${Date.now()}`,
      benefitType: 'HEALTH_INSURANCE',
      linkageMode: 'ADDITIVE_BENEFIT',
      minimumScore: UNREACHABLE_SCORE,
    });

    const result = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(
      result.eligible,
      true,
      'an additive essential-service programme must not refuse a citizen for being behind',
    );
    assert.equal(result.benefitTier, 'BASE', 'the shortfall should reduce the tier, not remove the benefit');
    assert.ok(
      result.reasons.some((reason) => reason.includes('never withdrawn')),
      'the citizen should be told the benefit is not withdrawn for arrears',
    );
  });

  it('awards the full tier once the requirements are met', async () => {
    const taxpayerId = await taxpayerWithTin();
    const programmeId = await activeProgramme({
      code: `ADD-FULL-${Date.now()}`,
      benefitType: 'HEALTH_INSURANCE',
      linkageMode: 'ADDITIVE_BENEFIT',
      minimumScore: 0,
    });

    const result = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(result.eligible, true);
    assert.equal(result.benefitTier, 'FULL', 'no shortfall should mean the full entitlement');
  });

  /**
   * Additive is not the same as unconditional. Scope still applies: a programme
   * targeted at one LGA, or requiring a TIN, is simply not for everybody, and
   * that is not a compliance penalty.
   */
  it('still refuses someone out of scope, with no tier awarded', async () => {
    const noTin = await pool.query<{ id: string }>(
      `INSERT INTO taxpayers
         (taxpayer_type, first_name, last_name, phone, address, lga_id, tin_status, status)
       VALUES ('INDIVIDUAL', 'No', 'Tin', $1, 'Jos North', $2, 'NOT_REQUESTED', 'ACTIVE')
       RETURNING id`,
      [`+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, lgaId],
    );
    const programmeId = await activeProgramme({
      code: `ADD-SCOPE-${Date.now()}`,
      benefitType: 'HEALTH_INSURANCE',
      linkageMode: 'ADDITIVE_BENEFIT',
      minimumScore: 0,
    });

    const result = await evaluateEligibility({ programmeId, taxpayerId: noTin.rows[0]!.id });

    assert.equal(result.eligible, false, 'a TIN is the entry condition, not a compliance test');
    assert.equal(result.benefitTier, null, 'no tier for someone the programme is not for');
  });

  it('records the tier so it can be acted on later', async () => {
    const taxpayerId = await taxpayerWithTin();
    const programmeId = await activeProgramme({
      code: `ADD-STORE-${Date.now()}`,
      benefitType: 'HEALTH_INSURANCE',
      linkageMode: 'ADDITIVE_BENEFIT',
      minimumScore: UNREACHABLE_SCORE,
    });

    await evaluateEligibility({ programmeId, taxpayerId });

    const { rows } = await pool.query<{ eligible: boolean; benefit_tier: string }>(
      'SELECT eligible, benefit_tier FROM programme_eligibility WHERE programme_id = $1 AND taxpayer_id = $2',
      [programmeId, taxpayerId],
    );
    assert.equal(rows[0]!.eligible, true);
    assert.equal(rows[0]!.benefit_tier, 'BASE');
  });
});

// ===========================================================================
describe('A gated programme still gates', () => {
  /**
   * The other half. Making everything additive would be as wrong as making
   * everything a gate: allocating a finite quantity of subsidised fertilizer
   * between applicants is the state choosing between claimants on a scarce
   * good, not withdrawing a service from anyone.
   */
  it('refuses a citizen who falls short, on identical facts', async () => {
    const taxpayerId = await taxpayerWithTin();
    const programmeId = await activeProgramme({
      code: `GATE-${Date.now()}`,
      benefitType: 'AGRICULTURAL_SUBSIDY',
      linkageMode: 'ELIGIBILITY_GATE',
      minimumScore: UNREACHABLE_SCORE,
    });

    const result = await evaluateEligibility({ programmeId, taxpayerId });

    assert.equal(result.eligible, false, 'a gated programme must still deny on a shortfall');
    assert.equal(result.benefitTier, null, 'a gate has no tiers — it is a yes or a no');
  });
});

// ===========================================================================
describe('The §40 guard, which had never fired', () => {
  const base = {
    description: 'fixture',
    benefitDescription: 'fixture',
    startDate: new Date().toISOString().slice(0, 10),
    approvalAuthority: 'Test Authority',
  };

  /**
   * The exact bypass that let PLASHIA through: the guard listed HEALTHCARE and
   * the programme was typed HEALTH_INSURANCE, so nothing matched. Matching is
   * now by prefix.
   */
  it('refuses a gated HEALTH_INSURANCE programme with no legal basis', async () => {
    await assert.rejects(
      createProgramme({
        input: { ...base, name: 'Gated health', code: `G-HEALTH-${Date.now()}`, benefitType: 'HEALTH_INSURANCE' },
        actorId: officerId,
        actorRole: 'revenue_officer',
      }),
      (error: Error) => /essential public service/i.test(error.message),
      'a programme that would deny health cover on tax grounds must not be creatable unrecorded',
    );
  });

  it('refuses a gated EDUCATION_BURSARY programme the same way', async () => {
    await assert.rejects(
      createProgramme({
        input: { ...base, name: 'Gated bursary', code: `G-EDU-${Date.now()}`, benefitType: 'EDUCATION_BURSARY' },
        actorId: officerId,
        actorRole: 'revenue_officer',
      }),
      (error: Error) => /essential public service/i.test(error.message),
    );
  });

  it('allows the same programme when it is additive', async () => {
    const created = await createProgramme({
      input: {
        ...base,
        name: 'Additive health',
        code: `A-HEALTH-${Date.now()}`,
        benefitType: 'HEALTH_INSURANCE',
        linkageMode: 'ADDITIVE_BENEFIT',
      },
      actorId: officerId,
      actorRole: 'revenue_officer',
    });
    assert.ok(created.programmeId, 'additive needs no legal citation — it denies nobody');
  });

  it('allows a gated one when the legal authority is recorded', async () => {
    const created = await createProgramme({
      input: {
        ...base,
        name: 'Authorised health gate',
        code: `L-HEALTH-${Date.now()}`,
        benefitType: 'HEALTH_INSURANCE',
        essentialServiceLegalBasis: 'Plateau State Health Insurance Law 2024, s.14(2)',
      },
      actorId: officerId,
      actorRole: 'revenue_officer',
    });
    assert.ok(created.programmeId);
  });

  it('leaves a non-essential benefit alone', async () => {
    const created = await createProgramme({
      input: {
        ...base,
        name: 'Fertilizer',
        code: `AGRI-${Date.now()}`,
        benefitType: 'AGRICULTURAL_SUBSIDY',
      },
      actorId: officerId,
      actorRole: 'revenue_officer',
    });
    assert.ok(created.programmeId, 'a scarce agricultural allocation is not an essential service');
  });

  /**
   * The §40 decision is two facts — how the programme treats a non-compliant
   * citizen, and on whose authority — and both belong in the audit trail, not
   * only in whoever remembers the meeting.
   */
  it('records the linkage mode in the audit trail', async () => {
    const code = `AUDIT-${Date.now()}`;
    const created = await createProgramme({
      input: {
        ...base,
        name: 'Audited additive',
        code,
        benefitType: 'HEALTH_INSURANCE',
        linkageMode: 'ADDITIVE_BENEFIT',
      },
      actorId: officerId,
      actorRole: 'revenue_officer',
    });

    const { rows } = await pool.query<{ new_value: { linkageMode?: string } }>(
      `SELECT new_value FROM audit_logs
        WHERE entity_type = 'incentive_programme' AND entity_id = $1
        ORDER BY sequence_no DESC LIMIT 1`,
      [created.programmeId],
    );
    assert.equal(rows[0]!.new_value.linkageMode, 'ADDITIVE_BENEFIT');
  });
});

// ===========================================================================
describe('The seeded state programmes', () => {
  it('makes health insurance and the bursary additive, and leaves the rest gated', async () => {
    const { seedReferenceData } = await import('../db/seed');
    await pool.query('DELETE FROM programme_eligibility');
    await pool.query('DELETE FROM incentive_programmes');
    await seedReferenceData();

    const { rows } = await pool.query<{ code: string; linkage_mode: string }>(
      `SELECT code, linkage_mode FROM incentive_programmes
        WHERE code IN ('PLASHIA','SCHOLARSHIP-BURSARY','FERTILIZER-SUBSIDY','STATE-HOUSING-FUND')
        ORDER BY code`,
    );
    const modes = Object.fromEntries(rows.map((row) => [row.code, row.linkage_mode]));

    assert.equal(modes['PLASHIA'], 'ADDITIVE_BENEFIT', 'health cover must never be withdrawn for arrears');
    assert.equal(modes['SCHOLARSHIP-BURSARY'], 'ADDITIVE_BENEFIT', "a child's bursary follows the same rule");
    assert.equal(modes['FERTILIZER-SUBSIDY'], 'ELIGIBILITY_GATE', 'a scarce allocation may be gated');
    assert.equal(modes['STATE-HOUSING-FUND'], 'ELIGIBILITY_GATE', 'credit may be gated on a payment record');
  });
});
