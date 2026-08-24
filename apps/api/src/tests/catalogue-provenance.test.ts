/**
 * Every price in the catalogue, and where it came from.
 *
 * The catalogue decides what an agent may charge a trader in a market. Each
 * code is a sum somebody will be asked to hand over, so "who says so, and
 * where does the figure come from" has to have an answer that is not
 * "whoever seeded the database".
 *
 * Checking the thirty-seven prices originally seeded turned up one answer for
 * three of them — the Fourth Schedule to the Nigeria Tax Act, 2025 — and no
 * answer at all for most of the rest. That is a fact about this repository,
 * and the useful thing to do with it is not to write it in a document nobody
 * opens but to make it a property CI holds: no item may exist in the
 * catalogue without a recorded classification of its authority.
 *
 * The point is what happens to the forty-third item. Someone adding a revenue
 * code with a figure beside it has to say here where the figure came from, or
 * the build fails. It does not make an unverified price correct. It makes it
 * impossible to add one silently.
 *
 * The classifications are deliberately coarse. This test is not a legal
 * opinion and cannot be one; it records which of a few quite different
 * situations each item is in, so that the ones needing a lawyer, the ones
 * needing a Schedule, and the ones needing nothing are not filed together.
 */

import './env';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase } from './helpers';
import { query } from '../db/pool';
import { seedReferenceData } from '../db/seed';

type Authority =
  /** Set by a federal Act this repository has read. The figure is checked. */
  | 'FEDERAL_STATUTE'
  /**
   * Priced, and the figure appears to exceed a cap in federal law. Left as
   * seeded rather than changed, because the question is whether the cap still
   * governs, and that is not a question to answer by inference.
   */
  | 'EXCEEDS_APPARENT_CAP'
  /**
   * On Part III of the Taxes and Levies (Approved List for Collection) Act —
   * the local government list. The rate for one of these is set by an LGA
   * bye-law, and Plateau has seventeen LGAs, so a single statewide figure
   * cannot be right for all of them whatever its value.
   */
  | 'LOCAL_GOVERNMENT_LIST'
  /** The state's power to charge it at all is under live challenge. */
  | 'CONTESTED_POWER'
  /**
   * The figure belongs to a Schedule of the Plateau State Revenue
   * (Consolidation) Law, 2020, which could not be read from the environment
   * this catalogue was configured in. Nothing here establishes the amount.
   */
  | 'UNVERIFIED'
  /** Catalogued with no rate at all, so it cannot be assessed. */
  | 'AWAITING_SCHEDULE';

const PROVENANCE: Record<string, { authority: Authority; note: string }> = {
  // -- Read and checked ----------------------------------------------------
  'PIT-DIRECT': {
    authority: 'FEDERAL_STATUTE',
    note: 'Fourth Schedule, Nigeria Tax Act 2025. Rates are federal; states administer.',
  },
  'PIT-PAYE': {
    authority: 'FEDERAL_STATUTE',
    note: 'Fourth Schedule. PAYE is the same tax deducted at source.',
  },
  'PIT-CGT': {
    authority: 'FEDERAL_STATUTE',
    note: 'Fourth Schedule. The NTA brought individual gains inside the PIT framework.',
  },

  // -- Priced above what federal law appears to allow -----------------------
  'DEV-LEVY': {
    authority: 'EXCEEDS_APPARENT_CAP',
    note: 'Seeded at ₦2,000. Taxes and Levies Act: development levy on individuals, "not more than ₦100 per annum".',
  },

  // -- Local government revenue, at a single statewide rate -----------------
  //
  // Six of these sit in a category named "Local Government Rates and Fees",
  // so the platform half-knows. The other five are filed as though they were
  // state revenue. None is scoped to an LGA, so each charges one figure in
  // all seventeen.
  'SHOPS-KIOSKS': { authority: 'LOCAL_GOVERNMENT_LIST', note: 'Part III item 1.' },
  'TENEMENT-RATES': { authority: 'LOCAL_GOVERNMENT_LIST', note: 'Part III item 2.' },
  'SLAUGHTER-SLAB': { authority: 'LOCAL_GOVERNMENT_LIST', note: 'Part III item 4.' },
  'ABATTOIR-FEE': {
    authority: 'LOCAL_GOVERNMENT_LIST',
    note: 'Overlaps Part III item 4 (slaughter slab fees), and is filed under Trade rather than LG.',
  },
  'MARRIAGE-REGISTRATION': { authority: 'LOCAL_GOVERNMENT_LIST', note: 'Part III item 5.' },
  'STREET-NAMING': {
    authority: 'LOCAL_GOVERNMENT_LIST',
    note: 'Part III item 6, "excluding any street in the State Capital" — and Jos is the capital.',
  },
  'RIGHT-OCCUPANCY': {
    authority: 'LOCAL_GOVERNMENT_LIST',
    note: 'Part III item 7 covers rural land only, excluding what Federal and State collect. Seeded as one flat figure with no rural qualifier.',
  },
  'MARKET-LEVY': {
    authority: 'LOCAL_GOVERNMENT_LIST',
    note: 'Part III item 8, "excluding any market where State finance is involved".',
  },
  'MOTOR-PARK-LEVY': { authority: 'LOCAL_GOVERNMENT_LIST', note: 'Part III item 9.' },
  'DOMESTIC-ANIMAL-LICENCE': { authority: 'LOCAL_GOVERNMENT_LIST', note: 'Part III item 10.' },
  'SIGNAGE-FEE': {
    authority: 'LOCAL_GOVERNMENT_LIST',
    note: 'Part III, signboard and advertisement permit fees.',
  },

  // -- Power to charge it under challenge ----------------------------------
  'CONSUMPTION-TAX': {
    authority: 'CONTESTED_POWER',
    note: 'The Court of Appeal held VAT covered the field on consumption, superseding state consumption tax law. VAT now sits in the NTA 2025.',
  },

  // -- Figure is in a Plateau Schedule nobody here has read -----------------
  'BP-REG-URBAN': { authority: 'UNVERIFIED', note: 'Second Schedule, urban categorisation.' },
  'BP-RENEW-URBAN': { authority: 'UNVERIFIED', note: 'Second Schedule, urban categorisation.' },
  'BP-REG-RURAL': { authority: 'UNVERIFIED', note: 'Second Schedule, rural categorisation.' },
  'BP-RENEW-RURAL': { authority: 'UNVERIFIED', note: 'Second Schedule, rural categorisation.' },
  'ECON-DEV-LEVY': { authority: 'UNVERIFIED', note: 'No instrument identified.' },
  'SOCIAL-SVC-LEVY': { authority: 'UNVERIFIED', note: 'No instrument identified.' },
  'ECOLOGICAL-FEE': { authority: 'UNVERIFIED', note: 'No instrument identified.' },
  'FIRE-SERVICE-CHARGE': { authority: 'UNVERIFIED', note: 'No instrument identified.' },
  'MINING-FEE': {
    authority: 'UNVERIFIED',
    note: 'Solid minerals are on the Exclusive Legislative List; what a state may charge here needs checking, not only the amount.',
  },
  'ENTERTAINMENT-TAX': { authority: 'UNVERIFIED', note: 'First Schedule.' },
  'GAMING-TAX': { authority: 'UNVERIFIED', note: 'First Schedule.' },
  'INFRA-LEVY': { authority: 'UNVERIFIED', note: 'No instrument identified.' },
  'LAND-USE-CHARGE': { authority: 'UNVERIFIED', note: 'No instrument identified.' },
  'PROPERTY-TAX': {
    authority: 'UNVERIFIED',
    note: 'Sits alongside LAND-USE-CHARGE and TENEMENT-RATES on what may be the same base.',
  },
  'ROAD-TAX': { authority: 'UNVERIFIED', note: 'State MVAA fees are not nationally harmonised.' },
  'VEH-RENEW-PRIVATE': { authority: 'UNVERIFIED', note: '₦625 a month. No source found.' },
  'VEH-RENEW-COMMERCIAL': { authority: 'UNVERIFIED', note: '₦1,250 a month. No source found.' },
  'ANIMAL-TRADE-TAX': { authority: 'UNVERIFIED', note: 'No instrument identified.' },
  'PRODUCE-SALES-TAX': { authority: 'UNVERIFIED', note: 'No instrument identified.' },

  // -- No rate, so nothing can be charged ----------------------------------
  'PIT-PRESUMPTIVE-MICRO': { authority: 'AWAITING_SCHEDULE', note: 'First Schedule table.' },
  'PIT-PRESUMPTIVE-SMALL': { authority: 'AWAITING_SCHEDULE', note: 'First Schedule table.' },
  'PIT-PRESUMPTIVE-MEDIUM': { authority: 'AWAITING_SCHEDULE', note: 'First Schedule table.' },
  'BP-REG-SEMI-URBAN': { authority: 'AWAITING_SCHEDULE', note: 'Second Schedule, semi-urban.' },
  'BP-RENEW-SEMI-URBAN': { authority: 'AWAITING_SCHEDULE', note: 'Second Schedule, semi-urban.' },
  'PIT-WHT': { authority: 'AWAITING_SCHEDULE', note: 'Needs a rate table by payment type.' },
  'PIT-STAMP': { authority: 'AWAITING_SCHEDULE', note: 'Needs a rate table by instrument.' },
};

interface CatalogueRow {
  code: string;
  has_rate: boolean;
  self_assessable: boolean;
  lga_count: number | null;
}

let catalogue: CatalogueRow[] = [];

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  catalogue = await query<CatalogueRow>(
    pool,
    `SELECT ri.code,
            (r.id IS NOT NULL) AS has_rate,
            ri.self_assessable,
            array_length(ri.applicable_lga_ids, 1) AS lga_count
       FROM revenue_items ri
       LEFT JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      ORDER BY ri.code`,
  );
});

describe('every price in the catalogue is accounted for', () => {
  it('has a recorded authority, and records none for an item that is gone', () => {
    // Both directions. An item added without a classification fails here, and
    // so does a classification left behind for an item that was removed.
    const seeded = catalogue.map((row) => row.code).sort();
    const recorded = Object.keys(PROVENANCE).sort();
    assert.deepEqual(
      seeded,
      recorded,
      'the catalogue and the provenance record disagree about which items exist',
    );
  });

  it('charges nothing for an item classified as having no rate', () => {
    const priced = catalogue
      .filter((row) => PROVENANCE[row.code]!.authority === 'AWAITING_SCHEDULE' && row.has_rate)
      .map((row) => row.code);
    assert.deepEqual(priced, [], 'an item recorded as unpriced has acquired a rate');
  });

  it('carries a rate for every item classified as priced', () => {
    // The mirror. An item whose rate was dropped without reclassifying it
    // would silently stop being collectable, which is a different problem
    // from being wrongly priced but just as quiet.
    const unpriced = catalogue
      .filter((row) => PROVENANCE[row.code]!.authority !== 'AWAITING_SCHEDULE' && !row.has_rate)
      .map((row) => row.code);
    assert.deepEqual(unpriced, [], 'an item recorded as priced has lost its rate');
  });

  it('lets a taxpayer self-assess only against a figure that was checked', () => {
    // Self-assessment puts the figure in front of the taxpayer with no
    // officer between them and it. Doing that with an amount nothing in this
    // repository can source is the weakest position of the lot.
    const selfAssessable = catalogue.filter((row) => row.self_assessable);
    for (const row of selfAssessable) {
      assert.equal(
        PROVENANCE[row.code]!.authority,
        'FEDERAL_STATUTE',
        `${row.code} is self-assessable but its rate is ${PROVENANCE[row.code]!.authority}`,
      );
    }
  });
});

describe('what the check found, held as facts rather than prose', () => {
  it('has eleven items on the local government list, none scoped to an LGA', () => {
    // Recorded because the fix is not a number. A rate set by bye-law differs
    // across the seventeen LGAs, and the catalogue has no way to say so: one
    // figure is charged in Jos North and in Wase alike. Whether PSIRS
    // collects these as agent for the LGAs is the question; the flat rate is
    // the defect either way.
    const lgaItems = Object.entries(PROVENANCE)
      .filter(([, value]) => value.authority === 'LOCAL_GOVERNMENT_LIST')
      .map(([code]) => code);
    assert.equal(lgaItems.length, 11);

    const scoped = catalogue.filter(
      (row) => lgaItems.includes(row.code) && (row.lga_count ?? 0) > 0,
    );
    assert.deepEqual(
      scoped.map((r) => r.code),
      [],
      'if an LGA item has become scoped, this expectation is out of date — update it',
    );
  });

  it('leaves nineteen figures with no identified source', () => {
    const unverified = Object.entries(PROVENANCE).filter(
      ([, value]) => value.authority === 'UNVERIFIED',
    );
    assert.equal(
      unverified.length,
      19,
      'the count of unsourced prices changed — if one was verified, reclassify it',
    );
  });

  it('gives every classification a note saying why', () => {
    const silent = Object.entries(PROVENANCE)
      .filter(([, value]) => value.note.trim().length === 0)
      .map(([code]) => code);
    assert.deepEqual(silent, []);
  });
});
