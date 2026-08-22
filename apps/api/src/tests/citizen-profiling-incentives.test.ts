/**
 * Taxpayer profiling, tax obligations, and social incentive eligibility.
 *
 * WHY THIS FILE WAS REWRITTEN
 *
 * The original version could not fail for the right reason. Its only
 * substantive assertions sat inside:
 *
 *     if (taxpayerRes.rows.length > 0) { ... }
 *
 * with no fixture creating that taxpayer — so on a clean database the block was
 * skipped and the test reported success having asserted nothing about the
 * feature. It also had no `before` hook and no `resetDatabase()`, which meant it
 * both depended on residue from earlier test files and left its own behind. In
 * the full suite that contributed to sixteen failures in *other* files.
 *
 * The two problems were one problem: a missing fixture, worked around with a
 * conditional instead of built.
 *
 * WHAT IS ACTUALLY WORTH ASSERTING HERE
 *
 * The feature's promise to a citizen is a chain — sector → obligations →
 * compliance → eligibility — and every link is a place a wrong answer costs
 * somebody something real. A missed obligation is revenue the state never
 * bills. A spurious one is a citizen billed for a tax that does not apply to
 * them. A wrong eligibility verdict is a farmer who does not get fertilizer.
 *
 * So each link is tested against a fixture this file creates itself.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMIC_SECTORS, sectorByCode } from '@psirs/shared';
import {
  deriveSuggestedObligations,
  getObligationsForTaxpayer,
  upsertObligations,
} from '../services/obligations';
import { getTaxpayerIncentives } from '../services/incentives';
import { firstLgaId, pool, resetDatabase, startTestServer, stopTestServer } from './helpers';

let lgaId = '';

/** A taxpayer this file owns, rather than one it hopes to find. */
async function createTaxpayer(params: {
  sector: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  tin?: string | null;
}): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO taxpayers
       (taxpayer_type, first_name, last_name, phone, address, lga_id,
        economic_sector, tin, tin_status, status)
     VALUES ($1, 'Profiling', 'Fixture', $2, 'Jos North', $3, $4, $5, $6, 'ACTIVE')
     RETURNING id`,
    [
      params.type,
      `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      lgaId,
      params.sector,
      params.tin ?? null,
      params.tin ? 'ASSIGNED' : 'NOT_REQUESTED',
    ],
  );
  return row.rows[0]!.id;
}

before(async () => {
  await resetDatabase();
  await startTestServer();
  lgaId = await firstLgaId();
});

after(async () => {
  await stopTestServer();
});

// ===========================================================================
describe('The sector taxonomy an agent picks from', () => {
  it('offers enough sectors to describe Plateau State livelihoods', () => {
    assert.ok(
      ECONOMIC_SECTORS.length >= 25,
      `expected a usable taxonomy, found ${ECONOMIC_SECTORS.length} sectors`,
    );
  });

  /**
   * Every sector must name revenue codes that exist.
   *
   * A typo here is silent and expensive: the sector simply yields no
   * obligations, so a whole livelihood is profiled as owing nothing and nobody
   * sees an error. This is the check that turns that into a failure.
   */
  it('names only revenue codes that exist in the catalogue', async () => {
    const { rows } = await pool.query<{ code: string }>('SELECT code FROM revenue_items');
    const known = new Set(rows.map((row) => row.code));

    const unknown: string[] = [];
    for (const sector of ECONOMIC_SECTORS) {
      for (const code of sector.suggestedRevenueCodes) {
        if (!known.has(code)) unknown.push(`${sector.code} → ${code}`);
      }
    }

    assert.deepEqual(unknown, [], `sectors reference revenue codes that do not exist: ${unknown.join(', ')}`);
  });

  it('gives the farmer the taxes a farmer actually owes', () => {
    const farmer = sectorByCode('AGRICULTURE');
    assert.ok(farmer, 'AGRICULTURE must exist — the fertilizer programme targets it');
    assert.equal(farmer!.hausa, 'Noma');
    assert.ok(
      farmer!.suggestedRevenueCodes.includes('DEV-LEVY'),
      'every taxable adult owes the Development Levy',
    );
  });
});

// ===========================================================================
describe('Sector decides which taxes are suggested', () => {
  it('suggests produce tax to a farmer', async () => {
    const suggested = await deriveSuggestedObligations('AGRICULTURE', 'INDIVIDUAL');
    const codes = suggested.map((item) => item.code);

    assert.ok(codes.length > 0, 'a farmer must be offered something');
    assert.ok(codes.includes('DEV-LEVY'), `expected DEV-LEVY, got ${codes.join(', ')}`);
  });

  /**
   * The complaint that started this feature: taxes citizens do not know about.
   * The answer is only useful if it is *different* per livelihood — a taxonomy
   * that suggests the same list to everyone has told nobody anything.
   */
  it('suggests a different set to a different livelihood', async () => {
    const farmer = await deriveSuggestedObligations('AGRICULTURE', 'INDIVIDUAL');
    const gaming = await deriveSuggestedObligations('GAMING_BETTING', 'BUSINESS');

    const farmerCodes = new Set(farmer.map((item) => item.code));
    const gamingCodes = new Set(gaming.map((item) => item.code));

    assert.notDeepEqual(
      [...farmerCodes].sort(),
      [...gamingCodes].sort(),
      'a farmer and a betting shop must not be told they owe the same taxes',
    );
  });

  /**
   * `applicable_taxpayer_types` is enforced at assessment time and must be
   * honoured here too. Suggesting a business-only tax to an individual sets up
   * a rejection later, after the agent has already told the citizen they owe it.
   */
  it('never suggests a business-only tax to an individual', async () => {
    for (const sector of ECONOMIC_SECTORS) {
      const suggested = await deriveSuggestedObligations(sector.code, 'INDIVIDUAL');
      if (suggested.length === 0) continue;

      const { rows } = await pool.query<{ code: string }>(
        `SELECT code FROM revenue_items
          WHERE id = ANY($1::uuid[]) AND NOT ('INDIVIDUAL' = ANY(applicable_taxpayer_types))`,
        [suggested.map((item) => item.revenueItemId)],
      );

      assert.deepEqual(
        rows.map((row) => row.code),
        [],
        `${sector.code} suggests business-only item(s) to an individual`,
      );
    }
  });

  it('returns nothing for a sector it does not recognise', async () => {
    assert.deepEqual(await deriveSuggestedObligations('NOT_A_SECTOR', 'INDIVIDUAL'), []);
  });
});

// ===========================================================================
describe('Recording what a taxpayer owes', () => {
  it('records confirmed obligations against the taxpayer', async () => {
    const taxpayerId = await createTaxpayer({ sector: 'AGRICULTURE', type: 'INDIVIDUAL' });
    const suggested = await deriveSuggestedObligations('AGRICULTURE', 'INDIVIDUAL');

    const result = await upsertObligations(
      taxpayerId,
      suggested.map((item) => item.revenueItemId),
      'AGENT_ONBOARDING',
      null,
      { role: 'revenue_officer', mayWaive: true },
    );

    assert.equal(result.added, suggested.length);

    const held = await getObligationsForTaxpayer(pool, taxpayerId);
    assert.equal(held.filter((row) => row.status === 'ACTIVE').length, suggested.length);
  });

  /**
   * The back-fill case: an existing taxpayer gains an obligation nobody had
   * recorded. This is the "taxes citizens are not aware of" path, and it must
   * add without disturbing what is already there.
   */
  it('adds a newly-recognised obligation to an existing profile', async () => {
    const taxpayerId = await createTaxpayer({ sector: 'AGRICULTURE', type: 'INDIVIDUAL' });
    const suggested = await deriveSuggestedObligations('AGRICULTURE', 'INDIVIDUAL');
    assert.ok(suggested.length >= 2, 'this test needs a sector with at least two obligations');

    // Onboard with only the first.
    await upsertObligations(taxpayerId, [suggested[0]!.revenueItemId], 'AGENT_ONBOARDING', null, { role: 'revenue_officer', mayWaive: true });
    assert.equal((await getObligationsForTaxpayer(pool, taxpayerId)).filter((r) => r.status === 'ACTIVE').length, 1);

    // Later the full set is recognised.
    await upsertObligations(
      taxpayerId,
      suggested.map((item) => item.revenueItemId),
      'OFFICER_REVIEW',
      null,
      { role: 'revenue_officer', mayWaive: true },
    );

    const held = await getObligationsForTaxpayer(pool, taxpayerId);
    assert.equal(held.filter((row) => row.status === 'ACTIVE').length, suggested.length);
  });

  /**
   * An obligation is a statement that a citizen owes government money. The
   * migration says it is never deleted, only WAIVED — so that a dispute has a
   * record and a removed obligation cannot be made to have never existed.
   */
  it('waives rather than deletes an obligation that no longer applies', async () => {
    const taxpayerId = await createTaxpayer({ sector: 'AGRICULTURE', type: 'INDIVIDUAL' });
    const suggested = await deriveSuggestedObligations('AGRICULTURE', 'INDIVIDUAL');
    await upsertObligations(taxpayerId, suggested.map((i) => i.revenueItemId), 'AGENT_ONBOARDING', null, { role: 'revenue_officer', mayWaive: true });

    // Re-confirm with only the first item; the rest should be waived, not gone.
    await upsertObligations(taxpayerId, [suggested[0]!.revenueItemId], 'OFFICER_REVIEW', null, { role: 'revenue_officer', mayWaive: true });

    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM taxpayer_tax_obligations WHERE taxpayer_id = $1',
      [taxpayerId],
    );
    assert.equal(
      Number(rows[0]!.count),
      suggested.length,
      'every obligation ever recorded must still be on the row, waived rather than removed',
    );

    const held = await getObligationsForTaxpayer(pool, taxpayerId);
    assert.ok(held.some((row) => row.status === 'WAIVED'), 'the dropped obligation must read WAIVED');
  });

  /**
   * The answer to the third onboarding question: notify, do not auto-assess.
   *
   * Recording an obligation must not raise an invoice. Billing somebody for a
   * tax they have never discussed is how a revenue platform loses public trust,
   * and it was an explicit product decision not to.
   */
  it('raises no invoice or assessment when an obligation is recorded', async () => {
    const taxpayerId = await createTaxpayer({ sector: 'AGRICULTURE', type: 'INDIVIDUAL' });
    const suggested = await deriveSuggestedObligations('AGRICULTURE', 'INDIVIDUAL');

    await upsertObligations(taxpayerId, suggested.map((i) => i.revenueItemId), 'AGENT_ONBOARDING', null, { role: 'revenue_officer', mayWaive: true });

    for (const table of ['invoices', 'assessments', 'transactions']) {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE taxpayer_id = $1`,
        [taxpayerId],
      );
      assert.equal(
        Number(rows[0]!.count),
        0,
        `recording an obligation created a row in ${table} — the citizen has been billed for a tax nobody discussed with them`,
      );
    }
  });
});

// ===========================================================================
describe('Social incentives follow the TIN', () => {
  /**
   * Every seeded programme requires a TIN, and that is the mechanism the whole
   * scheme hangs on: the incentive is what registering *buys* you.
   */
  it('offers a taxpayer without a TIN no programme', async () => {
    const taxpayerId = await createTaxpayer({ sector: 'AGRICULTURE', type: 'INDIVIDUAL', tin: null });

    const incentives = await getTaxpayerIncentives(pool, taxpayerId);
    assert.ok(Array.isArray(incentives.programmes));
    for (const programme of incentives.programmes as { eligible?: boolean }[]) {
      assert.notEqual(programme.eligible, true, 'no programme may clear a taxpayer with no TIN');
    }
  });

  /**
   * A DRAFT programme must never clear anybody.
   *
   * The four state programmes are seeded as DRAFT precisely so that nobody
   * becomes a beneficiary because a migration ran — an officer has to activate
   * them. That is only worth anything if DRAFT is honoured at evaluation time,
   * which is what this checks, against a programme the test creates itself.
   *
   * (It creates one rather than reading the seeded four: `incentive_programmes`
   * is in the test helper's truncation list, and the seeds live only in a
   * migration `INSERT` that has already run — so after any reset they are gone
   * and cannot come back. That is a real fragility in how the programmes are
   * provisioned, but it is not this test's subject.)
   */
  /**
   * The programmes must survive losing them.
   *
   * They shipped as an `INSERT` inside a checksum-locked migration, so once
   * `incentive_programmes` was truncated they were gone for good: migrations
   * skip an applied file and refuse an edited one. This asserts the recovery
   * path — seeding restores them — and that a second run neither duplicates
   * them nor resurrects a programme an officer deliberately closed.
   */
  it('restores the state programmes on re-seed, without reviving a closed one', async () => {
    const { seedReferenceData } = await import('../db/seed.js');

    await pool.query('DELETE FROM programme_eligibility');
    await pool.query('DELETE FROM incentive_programmes');

    await seedReferenceData();
    const first = await pool.query<{ code: string; status: string }>(
      `SELECT code, status FROM incentive_programmes ORDER BY code`,
    );
    assert.ok(
      first.rows.length >= 4,
      `seeding must restore the state programmes, found ${first.rows.length}`,
    );
    for (const row of first.rows) {
      assert.equal(row.status, 'DRAFT', `${row.code} was seeded already active`);
    }

    // An officer closes one, then the seed runs again — as it does on every
    // deployment that re-runs reference data.
    await pool.query(`UPDATE incentive_programmes SET status = 'CLOSED' WHERE code = 'PLASHIA'`);
    await seedReferenceData();

    const second = await pool.query<{ code: string; status: string; n: string }>(
      `SELECT code, status, count(*) OVER ()::text AS n FROM incentive_programmes WHERE code = 'PLASHIA'`,
    );
    assert.equal(second.rows.length, 1, 're-seeding duplicated a programme');
    assert.equal(
      second.rows[0]!.status,
      'CLOSED',
      're-seeding reopened a programme an officer had closed',
    );
  });

  it('never clears anyone against a programme that is still DRAFT', async () => {
    const taxpayerId = await createTaxpayer({
      sector: 'AGRICULTURE',
      type: 'INDIVIDUAL',
      tin: `PL${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    });

    await pool.query(
      `INSERT INTO incentive_programmes
         (name, code, description, benefit_type, benefit_description, eligibility_rules,
          minimum_score, minimum_compliance_periods, requires_no_arrears,
          start_date, approval_authority, status)
       VALUES ('Draft Test Programme', $1, 'fixture', 'AGRICULTURAL_SUBSIDY', 'fixture',
               '{}'::jsonb, 0, 0, false, CURRENT_DATE, 'Test Authority', 'DRAFT')`,
      [`DRAFT-FIXTURE-${Date.now()}`],
    );

    const incentives = await getTaxpayerIncentives(pool, taxpayerId);
    for (const programme of incentives.programmes as { status?: string; eligible?: boolean }[]) {
      if (programme.status === 'DRAFT') {
        assert.notEqual(
          programme.eligible,
          true,
          'a DRAFT programme cleared a taxpayer — activation is the officer control that makes seeding safe',
        );
      }
    }
  });
});
