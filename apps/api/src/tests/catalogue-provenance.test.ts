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
   * Priced on the platform owner's instruction rather than from an instrument
   * this repository has read.
   *
   * Weaker than FEDERAL_STATUTE and recorded as such: what is known is who
   * decided, not which section says so. It exists so a figure nobody can
   * source is distinguishable from one that was merely never questioned.
   */
  | 'OWNER_DIRECTED'
  /**
   * On Part III of the Taxes and Levies (Approved List for Collection) Act —
   * the local government list. The rate comes from a Council's own bye-law
   * and Plateau has seventeen Councils, so these now carry a rate each rather
   * than one statewide figure that could only be right for all of them by
   * coincidence. The seventeen still hold the amount the catalogue originally
   * carried; what changed is that they are seventeen decisions.
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
    note:
      'Fourth Schedule, Nigeria Tax Act 2025. Rates are federal; states administer. Accepted by ' +
      'the platform owner on 24 August 2026 without gazette confirmation, which could not be ' +
      'reached from here; the bands are consistent across every published source found.',
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
    authority: 'OWNER_DIRECTED',
    note:
      '₦2,000, confirmed by the platform owner on 24 August 2026 after the ₦100 federal cap was ' +
      'put to them. The instrument setting ₦2,000 has still not been seen here, and the query to ' +
      'PSIRS remains open — what is recorded is the decision, not its authority.',
  },

  // -- Local government revenue, now a rate per Council ---------------------
  //
  // Six of these sit in a category named "Local Government Rates and Fees",
  // so the platform half-knew. The other five were filed as though they were
  // state revenue. All eleven now carry a rate for each of the seventeen
  // Councils, seeded at the figure the catalogue already held, so nothing
  // charged today changed and every Council's figure is separately settable.
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
    note:
      'Part III item 6, "excluding any street in the State Capital" — and Jos is the capital, ' +
      'so Jos North and Jos South carry no rate and the item is refused there.',
  },
  'RIGHT-OCCUPANCY': {
    authority: 'LOCAL_GOVERNMENT_LIST',
    note:
      'Part III item 7 covers rural land only, excluding what Federal and State collect. Per-Council ' +
      'now, so the urban Councils can be emptied once PSIRS says which they are.',
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
  /** How many of the seventeen Councils have set a rate for this item. */
  council_rates: number;
  self_assessable: boolean;
  lga_count: number | null;
}

let catalogue: CatalogueRow[] = [];

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  // Grouped, not joined. Eleven items now carry a rate for each of the
  // seventeen Councils, so a plain join returns one row per Council and the
  // catalogue appears to have two hundred items in it.
  catalogue = await query<CatalogueRow>(
    pool,
    `SELECT ri.code,
            count(r.id) > 0 AS has_rate,
            count(r.id) FILTER (WHERE r.lga_id IS NOT NULL)::int AS council_rates,
            ri.self_assessable,
            array_length(ri.applicable_lga_ids, 1) AS lga_count
       FROM revenue_items ri
       LEFT JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      GROUP BY ri.code, ri.self_assessable, ri.applicable_lga_ids
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
  it('has eleven items on the local government list, each priced per Council', () => {
    /*
     * This test used to assert the opposite — eleven items, none scoped, one
     * figure charged from Jos North to Wase — because that was the state of
     * things and naming it was all that could be done without knowing what
     * seventeen bye-laws say.
     *
     * That is still unknown. What changed is that it no longer has to be
     * known all at once: each Council has its own row, seeded at the figure
     * the catalogue already carried, correctable one Council at a time. The
     * amounts are no better sourced than they were; the structure no longer
     * claims a single bye-law governs the state.
     */
    const lgaItems = Object.entries(PROVENANCE)
      .filter(([, value]) => value.authority === 'LOCAL_GOVERNMENT_LIST')
      .map(([code]) => code);
    assert.equal(lgaItems.length, 11);

    const unscoped = catalogue
      .filter((row) => lgaItems.includes(row.code) && row.council_rates === 0)
      .map((row) => row.code);
    assert.deepEqual(
      unscoped,
      [],
      'a local government item still carries a statewide figure',
    );
  });

  it('gives street naming every Council but the two in the State Capital', () => {
    // Part III excludes it in the capital, and Jos is the capital. Fifteen
    // Councils, not seventeen — the absence is the exclusion.
    const streetNaming = catalogue.find((row) => row.code === 'STREET-NAMING')!;
    assert.equal(streetNaming.council_rates, 15);
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
