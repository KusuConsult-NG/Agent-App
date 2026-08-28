/**
 * Seed data.
 *
 * Splits into two parts:
 *   * Reference data the platform cannot run without — Plateau's 17 LGAs and
 *     their wards, the PSIRS revenue catalogue, commission policy, training
 *     curriculum, notification templates, the agent agreement.
 *   * Demonstration data (`--demo`) — government users and a worked example,
 *     for development and acceptance testing only.
 *
 * Seeding is idempotent: every insert is ON CONFLICT DO NOTHING or guarded, so
 * it can be re-run against an existing database without duplicating anything.
 */

import { PLATEAU_LGAS, TRAINING_MODULES, nairaToKobo } from '@psirs/shared';
import { pool, queryOne, withTransaction, closePool } from './pool';
import { config } from '../config';
import { describeDatabase } from '../env';
import { hashPassword } from '../lib/crypto';
import { runMigrations } from './migrate';
import { seedDemoAgent } from './seed-agent';

/** Representative wards per LGA. A full ward register is loaded from the
 *  official gazette during deployment; these support development and reporting. */
const WARDS: Record<string, string[]> = {
  'PL-JON': ['Jos Jarawa', 'Naraguta A', 'Naraguta B', 'Tudun Wada/Kabong', 'Gangare', 'Sarkin Arab', 'Ali Kazaure', 'Vanderpuye', 'Jenta Adamu', 'Ibrahim Katsina', 'Jos Township'],
  'PL-JOS': ['Bukuru', 'Gyel A', 'Gyel B', 'Kuru', 'Vwang', 'Du', 'Giring', 'Zawan A', 'Zawan B', 'Turu', 'Shen'],
  'PL-JOE': ['Angware', 'Fobur', 'Federe', 'Fursum', 'Jarawan Kogi', 'Maijuju', 'Shere East', 'Shere West', 'Zandi'],
  'PL-BAR': ['Barkin Ladi', 'Gassa', 'Foron', 'Fan', 'Heipang', 'Kapwis', 'Lobiring', 'Gindin Akwati', 'Ropp', 'Sho', 'Ta Hoss', 'Zabot'],
  'PL-BAS': ['Bassa', 'Buji', 'Gurum', 'Jengre', 'Kadamo', 'Kimakpa', 'Kishika', 'Mafara', 'Miango', 'Rimi', 'Ta Hoss', 'Zabolo', 'Zele'],
  'PL-RIY': ['Riyom', 'Bum', 'Danto', 'Ganawuri', 'Jol', 'Attakar', 'Rahoss', 'Sharubutu', 'Sopp', 'Tahoss', 'Wereng'],
  'PL-BOK': ['Bokkos', 'Butura', 'Daffo', 'Kamwai', 'Manguna', 'Mandar', 'Mbar', 'Mushere East', 'Mushere West', 'Richa', 'Sha', 'Tangur', 'Toff'],
  'PL-MAN': ['Mangu', 'Ampang West', 'Chakfem', 'Gindiri', 'Jannaret', 'Kadunu', 'Kombun', 'Mangu Halle', 'Mangun', 'Panyam', 'Pushit', 'Sabon Gari', 'Kerang'],
  'PL-PAN': ['Pankshin North', 'Pankshin South', 'Pankshin Central', 'Chip', 'Dokpai', 'Fier', 'Jiblik', 'Kadung', 'Kangshu', 'Lankan', 'Tal', 'Wokkos'],
  'PL-KNK': ['Kwal', 'Amper', 'Ampang East', 'Dawaki', 'Garram', 'Gyangyang', 'Kabwir', 'Langshi', 'Nemel', 'Pai', 'Seri'],
  'PL-KAN': ['Dengi', 'Gagdi', 'Garga', 'Gumsher', 'Jarmai', 'Jom', 'Kanam', 'Kantana', 'Kunkyam', 'Namaran', 'Pyaknasar'],
  'PL-LAN': ['Langtang', 'Bwarat', 'Funyallang', 'Gani', 'Jat', 'Kuffen', 'Lipchok', 'Nyer', 'Pilgani', 'Reak', 'Timbol', 'Zamko'],
  'PL-LAS': ['Mabudi', 'Fajul', 'Gamakai', 'Lashel', 'Magama', 'Sabon Gida', 'Talgwang', 'Timbol'],
  'PL-MIK': ['Tunkus', 'Baltep', 'Garkawa Central', 'Garkawa North', 'Garkawa South', 'Koenoem', 'Lalin', 'Piapung', 'Tunkus/Dokan Tofa'],
  'PL-QUA': ['Baap', 'Bwall', 'Doemak', 'Kurgwi', 'Kwa', 'Kwalla', 'Kwande', 'Lalin', 'Namu', 'Yarke'],
  'PL-SHE': ['Shendam Central', 'Derteng', 'Kalong', 'Kurgwi', 'Moekat', 'Pangshom', 'Poeship', 'Shimankar', 'Yelwa'],
  'PL-WAS': ['Wase', 'Bashar', 'Danbiram', 'Gudus', 'Kadarko', 'Kumbong', 'Lamba', 'Mavo', 'Nyaram', 'Saluwe', 'Wase Tofa', 'Yuli'],
};

/**
 * PSIRS-published state revenue categories (PRD §8) and their items.
 *
 * Amounts are illustrative starting points for a development environment;
 * government sets the real figures through the approval workflow, and every
 * change creates a new rate version rather than editing these.
 */
const STATE_CATALOGUE: {
  category: string;
  code: string;
  items: {
    code: string;
    name: string;
    rateType: 'FIXED' | 'PERCENTAGE' | 'TIERED' | 'FORMULA';
    fixedNaira?: string;
    basisPoints?: number;
    tiers?: unknown;
    formula?: string;
    minimumNaira?: string;
    maximumNaira?: string;
    frequency?: 'ONE_OFF' | 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
    taxpayerTypes?: ('INDIVIDUAL' | 'BUSINESS')[];
    selfAssessable?: boolean;
    /**
     * The item is in the catalogue but carries no rate, because the amount is
     * fixed by a Schedule to the Revenue (Consolidation) Law and this seed is
     * not the place to guess it.
     *
     * `revenue.ts` already refuses to assess such an item — NO_EFFECTIVE_RATE,
     * "no approved rate in force… it cannot be assessed until government sets
     * one" — which is exactly the outcome wanted. The item is visible to
     * officers so they know it must be configured, and unusable by an agent
     * until somebody with the Schedule in front of them enters the figure.
     */
    awaitingSchedule?: boolean;
    /**
     * Local government revenue: a rate per Council, not one for the State.
     *
     * Part III of the Taxes and Levies Act puts these on the local government
     * list, so the figure comes from a Council's bye-law and Plateau has
     * seventeen Councils. Each is seeded with the figure the catalogue already
     * carried — nothing charged today changes — but as seventeen rows a Council
     * can correct one at a time rather than one number that could only be right
     * for all of them by coincidence.
     */
    perLga?: boolean;
    /** Councils where the item is not collectable at all, by name. */
    excludeLgas?: string[];
    /**
     * The MDA this revenue belongs to, by code.
     *
     * PSIRS collects it; this says who it is collected *for*. Defaults to
     * PSIRS-HQ, which is right for the taxes the Service levies in its own
     * name and wrong for a fee that exists because another ministry
     * regulates something.
     */
    mda?: string;
  }[];
}[] = [
  {
    category: 'Personal Income Tax',
    code: 'PIT',
    items: [
      /*
       * Presumptive Income Tax — Plateau State Revenue (Consolidation) Law,
       * 2020, First Schedule.
       *
       * The instrument for the people this platform exists to serve. The law
       * provides that an individual whose trade or business keeps no
       * accounting records, or whose profit cannot practicably be
       * ascertained, is assessed presumptively by enterprise category rather
       * than on accounts that do not exist. The amount is set per trade,
       * business, vocation and profession by the Administrative Table in the
       * First Schedule; reported bands run from ₦2,500 to ₦100,000.
       *
       * No rate is seeded here, deliberately. The Administrative Table is the
       * legal authority for the figure and it is not reproduced from memory:
       * a wrong band means an agent collecting the wrong sum from a trader
       * under colour of law. The items are catalogued so government can see
       * they need configuring, and `revenue.ts` refuses to assess an item
       * with no rate in force until somebody with the Schedule enters it.
       */
      {
        code: 'PIT-PRESUMPTIVE-MICRO',
        name: 'Presumptive Income Tax (micro enterprise)',
        rateType: 'FIXED',
        frequency: 'ANNUAL',
        taxpayerTypes: ['INDIVIDUAL'],
        awaitingSchedule: true,
      },
      {
        code: 'PIT-PRESUMPTIVE-SMALL',
        name: 'Presumptive Income Tax (small enterprise)',
        rateType: 'FIXED',
        frequency: 'ANNUAL',
        taxpayerTypes: ['INDIVIDUAL'],
        awaitingSchedule: true,
      },
      {
        code: 'PIT-PRESUMPTIVE-MEDIUM',
        name: 'Presumptive Income Tax (medium enterprise)',
        rateType: 'FIXED',
        frequency: 'ANNUAL',
        taxpayerTypes: ['INDIVIDUAL'],
        awaitingSchedule: true,
      },
      /*
       * The Fourth Schedule to the Nigeria Tax Act, 2025, in force since
       * 1 January 2026.
       *
       * What was here before was the old PITA schedule — 7% from the first
       * naira, rising through 11/15/19/21 to 24%, with a ₦5,000 floor — and
       * the Act that set it has been repealed, along with the Capital Gains
       * Tax Act and the Stamp Duties Act. A trader on ₦300,000 owed 7% and a
       * ₦5,000 minimum under those figures and owes nothing under the law.
       *
       * Note there is no minimum any more, and that is the point rather than
       * an omission: the first ₦800,000 is exempt, and a floor would collect
       * from exactly the people the exemption is for.
       *
       * These rates are federal. Personal income tax is administered by the
       * states but its rates are set by the Act, so unlike the Plateau fee
       * Schedules this is not a figure PSIRS chooses — it is the one PSIRS
       * applies. The bands are consistent across KPMG, PwC, EY and the
       * published PAYE tables; the gazette itself could not be reached from
       * the environment this was configured in, which is recorded in
       * REVENUE-CATALOGUE-SOURCES.md along with what still needs checking
       * against it.
       */
      {
        code: 'PIT-DIRECT',
        name: 'Direct Assessment / Self-Assessment',
        rateType: 'TIERED',
        tiers: {
          tiers: [
            { upToKobo: nairaToKobo('800000').toString(), basisPoints: 0 },
            { upToKobo: nairaToKobo('3000000').toString(), basisPoints: 1500 },
            { upToKobo: nairaToKobo('12000000').toString(), basisPoints: 1800 },
            { upToKobo: nairaToKobo('25000000').toString(), basisPoints: 2100 },
            { upToKobo: nairaToKobo('50000000').toString(), basisPoints: 2300 },
            { upToKobo: null, basisPoints: 2500 },
          ],
        },
        frequency: 'ANNUAL',
        taxpayerTypes: ['INDIVIDUAL'],
        selfAssessable: true,
      },
      {
        code: 'PIT-PAYE',
        name: 'Pay As You Earn (PAYE)',
        rateType: 'TIERED',
        // The same schedule: PAYE is this tax collected at source, not a
        // different one. It sat at a flat 7%, which was wrong before the
        // reform too — a flat rate overcharges everyone in the lowest band
        // and undercharges everyone above it.
        tiers: {
          tiers: [
            { upToKobo: nairaToKobo('800000').toString(), basisPoints: 0 },
            { upToKobo: nairaToKobo('3000000').toString(), basisPoints: 1500 },
            { upToKobo: nairaToKobo('12000000').toString(), basisPoints: 1800 },
            { upToKobo: nairaToKobo('25000000').toString(), basisPoints: 2100 },
            { upToKobo: nairaToKobo('50000000').toString(), basisPoints: 2300 },
            { upToKobo: null, basisPoints: 2500 },
          ],
        },
        frequency: 'MONTHLY',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'PIT-WHT',
        name: 'Withholding Tax (individuals)',
        rateType: 'PERCENTAGE',
        frequency: 'ONE_OFF',
        /*
         * Left unpriced, and not for want of looking. Withholding is not one
         * rate: it differs by what is being paid for — rent, dividends,
         * professional fees, construction, ordinary contracts — and a single
         * figure here would be wrong for every transaction except whichever
         * one it happened to match. It needs the rate table and an input that
         * says which kind of payment this is, which is a change to the item
         * rather than a number to fill in.
         */
        awaitingSchedule: true,
      },
      {
        code: 'PIT-CGT',
        name: 'Capital Gains Tax (individuals)',
        rateType: 'TIERED',
        /*
         * The Nigeria Tax Act, 2025 repealed the flat 10% of the Capital
         * Gains Tax Act and brought chargeable gains for individuals inside
         * the personal income tax framework, so they are taxed at the same
         * progressive rates.
         */
        tiers: {
          tiers: [
            { upToKobo: nairaToKobo('800000').toString(), basisPoints: 0 },
            { upToKobo: nairaToKobo('3000000').toString(), basisPoints: 1500 },
            { upToKobo: nairaToKobo('12000000').toString(), basisPoints: 1800 },
            { upToKobo: nairaToKobo('25000000').toString(), basisPoints: 2100 },
            { upToKobo: nairaToKobo('50000000').toString(), basisPoints: 2300 },
            { upToKobo: null, basisPoints: 2500 },
          ],
        },
        frequency: 'ONE_OFF',
        taxpayerTypes: ['INDIVIDUAL'],
      },
      {
        code: 'PIT-STAMP',
        name: 'Stamp Duties on instruments executed by individuals',
        rateType: 'PERCENTAGE',
        frequency: 'ONE_OFF',
        /*
         * Also left unpriced, for the same reason as withholding rather than
         * for want of a source. Stamp duty is set per instrument — a lease is
         * not a receipt is not a share transfer — so the 0.75% that was here
         * was wrong for nearly everything it would have been charged on, both
         * before the Stamp Duties Act was repealed into the 2025 Act and
         * after.
         */
        awaitingSchedule: true,
      },
    ],
  },
  {
    category: 'Business Premises and Development',
    code: 'BPD',
    items: [
      {
        code: 'BP-REG-URBAN',
        mda: 'MDA-LANDS',
        name: 'Business Premises Registration (urban)',
        rateType: 'FIXED',
        fixedNaira: '10000',
        frequency: 'ONE_OFF',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'BP-RENEW-URBAN',
        mda: 'MDA-LANDS',
        name: 'Business Premises Renewal (urban)',
        rateType: 'FIXED',
        fixedNaira: '5000',
        frequency: 'ANNUAL',
        taxpayerTypes: ['BUSINESS'],
      },
      /*
       * The law categorises Local Government Areas as Urban, **Semi-Urban**
       * and Rural, and consolidates rates and fees by that categorisation in
       * the Second Schedule. The catalogue carried only the two ends, so a
       * business in a semi-urban LGA had to be charged as though it were in
       * Jos or as though it were in a village — and one of those is wrong.
       *
       * Rates await the Second Schedule for the same reason as above.
       */
      {
        code: 'BP-REG-SEMI-URBAN',
        mda: 'MDA-LANDS',
        name: 'Business Premises Registration (semi-urban)',
        rateType: 'FIXED',
        frequency: 'ONE_OFF',
        taxpayerTypes: ['BUSINESS'],
        awaitingSchedule: true,
      },
      {
        code: 'BP-RENEW-SEMI-URBAN',
        mda: 'MDA-LANDS',
        name: 'Business Premises Renewal (semi-urban)',
        rateType: 'FIXED',
        frequency: 'ANNUAL',
        taxpayerTypes: ['BUSINESS'],
        awaitingSchedule: true,
      },
      {
        code: 'BP-REG-RURAL',
        mda: 'MDA-LANDS',
        name: 'Business Premises Registration (rural)',
        rateType: 'FIXED',
        fixedNaira: '2000',
        frequency: 'ONE_OFF',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'BP-RENEW-RURAL',
        mda: 'MDA-LANDS',
        name: 'Business Premises Renewal (rural)',
        rateType: 'FIXED',
        fixedNaira: '1000',
        frequency: 'ANNUAL',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'DEV-LEVY',
        name: 'Development Levy',
        rateType: 'FIXED',
        fixedNaira: '2000',
        frequency: 'ANNUAL',
        taxpayerTypes: ['INDIVIDUAL'],
      },
      {
        code: 'ECON-DEV-LEVY',
        name: 'Economic Development Levy',
        rateType: 'FIXED',
        fixedNaira: '5000',
        frequency: 'ANNUAL',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'SOCIAL-SVC-LEVY',
        mda: 'MDA-EDU',
        name: 'Social Services Contribution Levy',
        rateType: 'PERCENTAGE',
        basisPoints: 50,
        minimumNaira: '1000',
        frequency: 'ANNUAL',
      },
    ],
  },
  {
    category: 'Road Taxes and Vehicle Services',
    code: 'ROAD',
    items: [
      {
        code: 'VEH-RENEW-PRIVATE',
        mda: 'MDA-TRANS',
        name: 'Vehicle Particulars Renewal (private)',
        rateType: 'FORMULA',
        // Monthly rate scaled by the requested period. renewalPeriodMonths is
        // supplied by the renewal flow, never typed as an amount by an agent.
        formula: '625 * renewalPeriodMonths * 100',
        minimumNaira: '3750',
        frequency: 'ANNUAL',
      },
      {
        code: 'VEH-RENEW-COMMERCIAL',
        mda: 'MDA-TRANS',
        name: 'Vehicle Particulars Renewal (commercial)',
        rateType: 'FORMULA',
        formula: '1250 * renewalPeriodMonths * 100',
        minimumNaira: '7500',
        frequency: 'ANNUAL',
      },
      {
        code: 'ROAD-TAX',
        mda: 'MDA-TRANS',
        name: 'Road Taxes',
        rateType: 'FIXED',
        fixedNaira: '7500',
        frequency: 'ANNUAL',
      },
    ],
  },
  {
    category: 'Land, Property and Occupancy',
    code: 'LAND',
    items: [
      { code: 'RIGHT-OCCUPANCY', name: 'Right of Occupancy Fees', rateType: 'FIXED', fixedNaira: '50000', frequency: 'ONE_OFF', perLga: true, mda: 'MDA-LANDS', },
      { code: 'LAND-USE-CHARGE', name: 'Land Use Charge', rateType: 'PERCENTAGE', basisPoints: 50, minimumNaira: '5000', frequency: 'ANNUAL', mda: 'MDA-LANDS', },
      { code: 'PROPERTY-TAX', name: 'Property Tax', rateType: 'PERCENTAGE', basisPoints: 100, minimumNaira: '10000', frequency: 'ANNUAL', mda: 'MDA-LANDS', },
      { code: 'STREET-NAMING', name: 'Naming of Street Registration Fees', rateType: 'FIXED', fixedNaira: '25000', frequency: 'ONE_OFF', perLga: true, excludeLgas: ['Jos North', 'Jos South'], mda: 'MDA-LANDS', },
      { code: 'INFRA-LEVY', name: 'Infrastructure Maintenance Charge/Levy', rateType: 'FIXED', fixedNaira: '5000', frequency: 'ANNUAL', mda: 'MDA-LANDS', },
    ],
  },
  {
    category: 'Trade, Markets and Produce',
    code: 'TRADE',
    items: [
      { code: 'MARKET-LEVY', name: 'Market Taxes and Levies', rateType: 'FIXED', fixedNaira: '200', frequency: 'DAILY', perLga: true, mda: 'MDA-COMMERCE', },
      { code: 'ANIMAL-TRADE-TAX', name: 'Animal Trade Tax', rateType: 'FIXED', fixedNaira: '1500', frequency: 'ONE_OFF', mda: 'MDA-HEALTH', },
      { code: 'PRODUCE-SALES-TAX', name: 'Produce Sales Tax', rateType: 'PERCENTAGE', basisPoints: 200, minimumNaira: '500', frequency: 'ONE_OFF', mda: 'MDA-COMMERCE', },
      { code: 'ABATTOIR-FEE', name: 'Slaughter / Abattoir Fees', rateType: 'FIXED', fixedNaira: '1000', frequency: 'DAILY', perLga: true, mda: 'MDA-HEALTH', },
    ],
  },
  {
    category: 'Hospitality, Entertainment and Gaming',
    code: 'HOSP',
    items: [
      { code: 'CONSUMPTION-TAX', name: 'Hotel, Restaurant or Event Centre Consumption Tax', rateType: 'PERCENTAGE', basisPoints: 500, frequency: 'MONTHLY', taxpayerTypes: ['BUSINESS'], mda: 'MDA-COMMERCE', },
      { code: 'ENTERTAINMENT-TAX', name: 'Entertainment Tax', rateType: 'PERCENTAGE', basisPoints: 500, minimumNaira: '2000', frequency: 'ONE_OFF', mda: 'MDA-COMMERCE', },
      { code: 'GAMING-TAX', name: 'Pool, Betting, Lottery, Gaming and Casino Taxes', rateType: 'PERCENTAGE', basisPoints: 1000, minimumNaira: '10000', frequency: 'MONTHLY', taxpayerTypes: ['BUSINESS'], mda: 'MDA-COMMERCE', },
    ],
  },
  {
    category: 'Environment, Mining and Safety',
    code: 'ENV',
    items: [
      { code: 'ECOLOGICAL-FEE', name: 'Environmental / Ecological Fees', rateType: 'FIXED', fixedNaira: '5000', frequency: 'ANNUAL', mda: 'MDA-ENV', },
      { code: 'MINING-FEE', name: 'Mining, Milling and Quarrying Fees', rateType: 'FIXED', fixedNaira: '150000', frequency: 'ANNUAL', taxpayerTypes: ['BUSINESS'], mda: 'MDA-ENV', },
      { code: 'FIRE-SERVICE-CHARGE', name: 'Fire Service Charge', rateType: 'FIXED', fixedNaira: '3000', frequency: 'ANNUAL', mda: 'MDA-ENV', },
    ],
  },
  {
    category: 'Advertising and Signage',
    code: 'ADVERT',
    items: [
      { code: 'SIGNAGE-FEE', name: 'Signage and Mobile Advertisement', rateType: 'FIXED', fixedNaira: '15000', frequency: 'ANNUAL', taxpayerTypes: ['BUSINESS'], perLga: true, mda: 'MDA-COMMERCE', },
    ],
  },
];

/** Local-government revenue heads PSIRS identifies separately (PRD §8). */
const LOCAL_GOVERNMENT_CATALOGUE = {
  category: 'Local Government Rates and Fees',
  code: 'LGR',
  items: [
    { code: 'SHOPS-KIOSKS', name: 'Shops and Kiosks Rates', rateType: 'FIXED' as const, fixedNaira: '3000', frequency: 'ANNUAL' as const, perLga: true, mda: 'MDA-COMMERCE', },
    { code: 'TENEMENT-RATES', name: 'Tenement Rates', rateType: 'FIXED' as const, fixedNaira: '5000', frequency: 'ANNUAL' as const, perLga: true, mda: 'MDA-LANDS', },
    { code: 'SLAUGHTER-SLAB', name: 'Slaughter Slab Fees', rateType: 'FIXED' as const, fixedNaira: '500', frequency: 'DAILY' as const, perLga: true, mda: 'MDA-HEALTH', },
    { code: 'MOTOR-PARK-LEVY', name: 'Motor Park Levies', rateType: 'FIXED' as const, fixedNaira: '300', frequency: 'DAILY' as const, perLga: true, mda: 'MDA-TRANS', },
    { code: 'DOMESTIC-ANIMAL-LICENCE', name: 'Domestic Animal Licence Fees', rateType: 'FIXED' as const, fixedNaira: '1000', frequency: 'ANNUAL' as const, perLga: true, mda: 'MDA-HEALTH', },
    { code: 'MARRIAGE-REGISTRATION', name: 'Marriage, Birth and Death Registration Fees', rateType: 'FIXED' as const, fixedNaira: '2000', frequency: 'ONE_OFF' as const, perLga: true, mda: 'MDA-LG', },
  ],
};

/**
 * Plateau State social incentive programmes (PRD §40, §41).
 *
 * These arrived as an `INSERT` inside migration 016, which made them
 * unrecoverable. Migrations run exactly once and are checksum-locked, so a
 * database that had `incentive_programmes` truncated — or restored from a dump
 * predating the rows — could never get them back: re-running migrations skips
 * an applied file, and editing one is refused. The four programmes are the
 * substance of the incentive feature, so "gone until somebody writes SQL by
 * hand" is not an acceptable resting state for them.
 *
 * Reference data belongs here, with the LGAs, the revenue catalogue and the
 * notification templates, where `npm run seed` is idempotent and re-runnable.
 * Migration 016 is left exactly as it is: it is checksummed, and its own insert
 * is `ON CONFLICT (code) DO NOTHING`, so a fresh deploy running both is fine.
 *
 * Two properties are deliberate and load-bearing:
 *
 *   * every programme seeds as DRAFT. Nobody becomes a beneficiary of a state
 *     scheme because a command ran — an officer with `incentive:configure` has
 *     to activate it. `citizen-profiling-incentives.test.ts` pins that a DRAFT
 *     programme clears nobody.
 *   * `ON CONFLICT (code) DO NOTHING`, never `DO UPDATE`. Re-seeding must not
 *     reactivate a programme an officer deliberately closed, nor overwrite
 *     thresholds they tuned. The seed establishes these programmes; it does not
 *     own them afterwards.
 */
const INCENTIVE_PROGRAMMES = [
  {
    name: 'Plateau State Health Insurance Scheme',
    code: 'PLASHIA',
    description:
      'Subsidised health insurance cover for registered taxpayers and their immediate ' +
      'families under the Plateau State Health Insurance Authority (PLASHIA).',
    benefitType: 'HEALTH_INSURANCE',
    benefitDescription:
      'Basic health insurance cover for the taxpayer and up to 4 dependants. ' +
      'Enrolment at any PLASHIA-accredited facility in Plateau State.',
    eligibilityRules: { requires_tin: true, min_score: 40, no_arrears: true },
    minimumScore: 40,
    minimumCompliancePeriods: 1,
    requiresNoArrears: true,
    approvalAuthority: 'Plateau State Health Insurance Authority',
    /*
     * Additive, not a gate (PRD §40).
     *
     * Health cover is an essential public service, and the platform must not
     * withdraw one because a citizen is behind on a levy. The thresholds above
     * are deliberately kept: under ADDITIVE_BENEFIT they no longer deny anyone
     * — they separate the base entitlement from the full one, which is the
     * reward this programme was always meant to offer. Zeroing them would
     * remove the incentive along with the penalty.
     */
    linkageMode: 'ADDITIVE_BENEFIT',
  },
  {
    name: 'Input Fertilizer Distribution Programme',
    code: 'FERTILIZER-SUBSIDY',
    description:
      'Subsidised agricultural inputs (fertilizer, seed, pesticide) distributed through ' +
      'LGA-level collection points for registered farmers and livestock keepers.',
    benefitType: 'AGRICULTURAL_SUBSIDY',
    benefitDescription:
      'Access to subsidised fertilizer allocation at LGA collection point. ' +
      'Quantity determined by farm size declared at registration.',
    eligibilityRules: {
      requires_tin: true,
      min_score: 30,
      no_arrears: false,
      sectors: ['AGRICULTURE', 'LIVESTOCK', 'FISHING', 'AGRICULTURE_PROCESSING'],
    },
    minimumScore: 30,
    minimumCompliancePeriods: 1,
    requiresNoArrears: false,
    approvalAuthority: 'Plateau State Ministry of Agriculture and Food Security',
    // A gate, and defensibly so: a finite quantity of subsidised fertilizer is
    // allocated between applicants, so this is the state choosing between
    // claimants on a scarce good rather than withdrawing a service.
    linkageMode: 'ELIGIBILITY_GATE',
  },
  {
    name: 'State Housing Fund (Low-Income Subsidy)',
    code: 'STATE-HOUSING-FUND',
    description:
      'Access to the Plateau State Housing Corporation low-income loan scheme for ' +
      'compliant taxpayers with a clean payment record.',
    benefitType: 'HOUSING_SUBSIDY',
    benefitDescription:
      'Preferential interest rate on housing loans from the Plateau State Housing ' +
      'Corporation. Requires 2 years of compliance history.',
    eligibilityRules: { requires_tin: true, min_score: 60, no_arrears: true, min_periods: 2 },
    minimumScore: 60,
    minimumCompliancePeriods: 2,
    requiresNoArrears: true,
    approvalAuthority: 'Plateau State Housing Corporation',
    // A gate: a subsidised loan is credit, extended at the state's discretion,
    // and a payment record is a legitimate input to that decision.
    linkageMode: 'ELIGIBILITY_GATE',
  },
  {
    name: 'Scholarship and Bursary Scheme',
    code: 'SCHOLARSHIP-BURSARY',
    description:
      'Annual bursary for children and dependants of compliant taxpayers, awarded ' +
      'through the Plateau State Scholarship Board.',
    benefitType: 'EDUCATION_BURSARY',
    benefitDescription:
      'Annual bursary award for up to 2 qualifying dependants in secondary or tertiary ' +
      'education. Subject to Scholarship Board approval.',
    eligibilityRules: { requires_tin: true, min_score: 50, no_arrears: false },
    minimumScore: 50,
    minimumCompliancePeriods: 1,
    requiresNoArrears: false,
    approvalAuthority: 'Plateau State Scholarship Board',
    // Education is an essential public service on the same §40 footing as
    // health: a child's bursary is not withheld because a parent is in arrears.
    linkageMode: 'ADDITIVE_BENEFIT',
  },
] as const;

const NOTIFICATION_TEMPLATES = [
  /*
   * The agent's own money, on the three occasions it moves.
   *
   * `COMMISSION_PAID` was here from the beginning and nothing queued it, so an
   * agent learned their payout had arrived by checking their bank — and learned
   * a transfer had bounced by not finding it there, which is indistinguishable
   * from PSIRS not having paid them. That is the belief that becomes a support
   * ticket, or an agent who starts asking citizens for cash.
   */
  { code: 'COMMISSION_PAYOUT_FAILED_SMS', event: 'COMMISSION_PAYOUT_FAILED', channel: 'SMS', body: 'PSIRS: Your commission payout {{reference}} could not be paid into your account: {{reason}}. The money has not been lost — it returns to your available balance and will go out again once the account details are correct. Check your bank details in the app.' },
  { code: 'COMMISSION_PAYOUT_REFUSED_SMS', event: 'COMMISSION_PAYOUT_REFUSED', channel: 'SMS', body: 'PSIRS: Your commission payout request {{reference}} was not approved: {{reason}}. The money has not been lost — it stays in your available balance and you can request it again.' },
  /*
   * Push, for the messages an agent needs while they are in the field.
   *
   * Additive: every one of these still goes by SMS, because an agent may have
   * declined the browser prompt or replaced the handset, and suspension is
   * exactly the message they must not miss. Push is free and immediate; the
   * SMS is the one that always arrives.
   *
   * Only events that resolve to a user account. A taxpayer holds none, so a
   * push template on a taxpayer-facing event would queue nothing.
   */
  { code: 'AGENT_SUSPENDED_PUSH', event: 'AGENT_SUSPENDED', channel: 'PUSH', subject: 'You have been suspended', body: 'Stop collecting now. Reason: {{reason}}. Open the app for what happens next.' },
  { code: 'AGENT_APPROVED_PUSH', event: 'AGENT_APPROVED', channel: 'PUSH', subject: 'You are cleared to collect', body: 'Your application has been approved. Open the app to register your device and begin.' },
  { code: 'KYC_ACTION_REQUIRED_PUSH', event: 'KYC_ACTION_REQUIRED', channel: 'PUSH', subject: 'Your application needs something', body: '{{reason}}' },
  { code: 'COMMISSION_PAID_PUSH', event: 'COMMISSION_PAID', channel: 'PUSH', subject: 'Commission paid', body: 'Your payout {{reference}} has been sent to your bank.' },
  { code: 'COMMISSION_PAYOUT_FAILED_PUSH', event: 'COMMISSION_PAYOUT_FAILED', channel: 'PUSH', subject: 'Payout could not be paid', body: '{{reason}}. The money is still yours — check your bank details in the app.' },
  { code: 'TIN_CREATED_SMS', event: 'TIN_CREATED', channel: 'SMS', body: 'PSIRS: Your Taxpayer Identification Number is {{tin}}. Keep it safe — you will need it for every government payment.' },
  { code: 'INVOICE_SMS', event: 'INVOICE_GENERATED', channel: 'SMS', body: 'PSIRS: Invoice {{reference}} for {{amount}} has been raised. Pay only through approved government channels.' },
  // Confirmation gives the taxpayer an acknowledgement, not a receipt, and this
  // is the only channel that reaches a citizen who holds no account. Migration
  // 042 carries the same wording to deployments that already have these rows —
  // templates are inserted ON CONFLICT DO NOTHING, so editing here alone would
  // fix it only for installations that do not exist yet.
  { code: 'PAYMENT_SUCCESS_SMS', event: 'PAYMENT_SUCCESSFUL', channel: 'SMS', body: 'PSIRS: Your payment of {{amount}} is confirmed. This is your acknowledgement {{receiptNumber}} - it is NOT a receipt. Your government receipt follows once the money reaches the government account. Check it at any time with this number.' },
  { code: 'PAYMENT_SUCCESS_EMAIL', event: 'PAYMENT_SUCCESSFUL', channel: 'EMAIL', subject: 'Payment confirmed - acknowledgement {{receiptNumber}}', body: 'Dear {{name}},\n\nYour payment of {{amount}} has been confirmed by the payment system (transaction {{reference}}).\n\nThis message is your ACKNOWLEDGEMENT OF PAYMENT, number {{receiptNumber}}. It is not a government receipt. The money reaches the Plateau State Government account shortly, and your official receipt is issued automatically when it does - we will send you its number.\n\nYou can check this acknowledgement at any time without signing in.\n\nPlateau State Internal Revenue Service' },
  // And the message for the moment the money actually arrives, which had no
  // template and no event: the receipt was issued and nobody told the taxpayer.
  { code: 'RECEIPT_GENERATED_SMS', event: 'RECEIPT_GENERATED', channel: 'SMS', body: 'PSIRS: Government has received your payment of {{amount}}. Your official receipt is {{receiptNumber}} (transaction {{reference}}). Check it at any time with this number.' },
  { code: 'RECEIPT_GENERATED_EMAIL', event: 'RECEIPT_GENERATED', channel: 'EMAIL', subject: 'Your government receipt {{receiptNumber}}', body: 'Dear {{name}},\n\nThe Plateau State Government has now received your payment of {{amount}} (transaction {{reference}}).\n\nYour official receipt number is {{receiptNumber}}. This replaces the acknowledgement you were sent earlier and is your evidence of payment.\n\nYou can verify it at any time without signing in.\n\nPlateau State Internal Revenue Service' },
  { code: 'PAYMENT_FAILED_SMS', event: 'PAYMENT_FAILED', channel: 'SMS', body: 'PSIRS: Payment for {{reference}} did not go through. No money has been taken. You can try again.' },
  { code: 'VEHICLE_RENEWAL_SMS', event: 'VEHICLE_RENEWAL_COMPLETED', channel: 'SMS', body: 'PSIRS: Vehicle {{registration}} has been renewed and is valid until {{expiry}}. Download your document from the portal.' },
  /*
   * Told by push, and not by SMS.
   *
   * An agent collects many times a day. An SMS for each costs real money per
   * message and would drown the payout notifications beside it, which is why
   * this event was seeded and then never raised by anything. Push costs nothing
   * and is what a handset notification is for.
   *
   * The SMS row stays on the record, switched off rather than deleted: a
   * template that vanishes makes the notification history unreadable, and
   * INACTIVE is one UPDATE away from being reversed if PSIRS decides the
   * message was worth its cost after all.
   */
  { code: 'COMMISSION_EARNED_SMS', event: 'COMMISSION_EARNED', channel: 'SMS', status: 'INACTIVE', body: 'PSIRS: You earned {{amount}} commission on transaction {{reference}}. It becomes payable after settlement.' },
  { code: 'COMMISSION_EARNED_PUSH', event: 'COMMISSION_EARNED', channel: 'PUSH', subject: 'Commission recorded', body: '{{amount}} on {{reference}}. It becomes payable after settlement.' },
  { code: 'COMMISSION_PAID_SMS', event: 'COMMISSION_PAID', channel: 'SMS', body: 'PSIRS: Commission of {{amount}} has been paid to your verified bank account. Reference {{reference}}.' },
  { code: 'AGENT_APPROVED_SMS', event: 'AGENT_APPROVED', channel: 'SMS', body: 'PSIRS: Your agent application has been approved. Complete training and register your device to begin work.' },
  { code: 'AGENT_REJECTED_SMS', event: 'AGENT_REJECTED', channel: 'SMS', body: 'PSIRS: Your agent application was not approved. Reason: {{reason}}' },
  { code: 'AGENT_SUSPENDED_SMS', event: 'AGENT_SUSPENDED', channel: 'SMS', body: 'PSIRS: Your agent account has been suspended. Reason: {{reason}}. Contact your supervisor.' },
  { code: 'REFEREE_INVITATION_SMS', event: 'REFEREE_INVITATION', channel: 'SMS', body: 'PSIRS: {{applicant}} has named you as referee for a revenue agent application ({{reference}}). Confirm at {{link}} before {{expiry}}.' },
  { code: 'KYC_ACTION_SMS', event: 'KYC_ACTION_REQUIRED', channel: 'SMS', body: 'PSIRS: Your identity verification needs attention. {{reason}}. Open the app to resubmit.' },
  { code: 'SUPPORT_REPLY_SMS', event: 'SUPPORT_TICKET_UPDATED', channel: 'SMS', body: 'PSIRS: There is a reply on your support ticket {{ticketNumber}}. Open the app to read it.' },
  { code: 'SECURITY_OTP_SMS', event: 'SECURITY_ALERT', channel: 'SMS', body: 'PSIRS: Your verification code is {{code}}. It expires in {{minutes}} minutes. Never share it with anyone, including PSIRS staff.' },
  // Sent to the number already on the agent's record, never to anything supplied
  // with the request: if somebody else asked for the change, this is how the
  // agent finds out while it is still only a proposal.
  { code: 'AGENT_BANK_CHANGE_REQUESTED_SMS', event: 'AGENT_BANK_CHANGE_REQUESTED', channel: 'SMS', body: 'PSIRS: A request was made to pay your commission into {{bank}} {{account}}. Nothing has changed yet. If this was not you, contact your supervisor now.' },
  { code: 'AGENT_BANK_CHANGE_APPLIED_SMS', event: 'AGENT_BANK_CHANGE_APPLIED', channel: 'SMS', body: 'PSIRS: Your commission will now be paid into {{bank}} {{account}}. If this was not you, contact your supervisor now.' },
  { code: 'AGENT_BANK_CHANGE_REFUSED_SMS', event: 'AGENT_BANK_CHANGE_REFUSED', channel: 'SMS', body: 'PSIRS: The request to change your commission account was not approved. Reason: {{reason}}. Your existing account is unchanged.' },
  // Told on the number already on the record, so a correction somebody else
  // asked for is noticed by the person it was made to.
  { code: 'TAXPAYER_RECORD_CORRECTED_SMS', event: 'TAXPAYER_RECORD_CORRECTED', channel: 'SMS', body: 'PSIRS: {{fields}} on your taxpayer record has been corrected by a revenue officer. If you did not ask for this, visit any PSIRS office.' },
  { code: 'USER_ROLE_CHANGED_SMS', event: 'USER_ROLE_CHANGED', channel: 'SMS', body: 'PSIRS: Your access has been changed from {{previousRole}} to {{newRole}}. You have been signed out and must sign in again. If this was not expected, contact your administrator now.' },

  // ---------------------------------------------------------------------
  // The same thirty, in Hausa.
  //
  // A taxpayer holds no account here, so an SMS is the only copy of their
  // receipt they will ever have — and a receipt somebody cannot read is a
  // receipt they cannot check, which is PRD §95 undone at the last step.
  //
  // Held fixed while translating: every placeholder and every code an eye
  // reads and a hand types back; every negation, each carried by ba, bai,
  // babu or kada; and the glossary the agent application already uses —
  // rasit, kwamishan, asusu, kudi, tabbatar, mai biyan haraji.
  //
  // NOT YET READ BY A NATIVE SPEAKER. docs/HAUSA-REVIEW.md carries them.
  // ---------------------------------------------------------------------
  { code: 'COMMISSION_PAYOUT_FAILED_SMS_HA', event: 'COMMISSION_PAYOUT_FAILED', channel: 'SMS', language: 'ha', body: "PSIRS: Ba a iya tura kwamishan dinka {{reference}} zuwa asusunka ba: {{reason}}. Kudin bai bata ba — ya koma cikin kudin da ake bin ka, kuma za a sake turawa idan an gyara bayanan asusun. Duba bayanan bankinka a cikin manhajar." },
  { code: 'COMMISSION_PAYOUT_REFUSED_SMS_HA', event: 'COMMISSION_PAYOUT_REFUSED', channel: 'SMS', language: 'ha', body: "PSIRS: Ba a amince da bukatarka ta biyan kwamishan {{reference}} ba: {{reason}}. Kudin bai bata ba — ya kasance cikin kudin da ake bin ka kuma kana iya sake nema." },
  { code: 'AGENT_SUSPENDED_PUSH_HA', event: 'AGENT_SUSPENDED', channel: 'PUSH', language: 'ha', subject: "An dakatar da kai", body: "Ka daina karbar kudi yanzu. Dalili: {{reason}}. Bude manhajar don ka ga abin da zai biyo baya." },
  { code: 'AGENT_APPROVED_PUSH_HA', event: 'AGENT_APPROVED', channel: 'PUSH', language: 'ha', subject: "An amince ka fara karba", body: "An amince da bukatarka. Bude manhajar don ka yi rajistar na’urarka ka fara aiki." },
  { code: 'KYC_ACTION_REQUIRED_PUSH_HA', event: 'KYC_ACTION_REQUIRED', channel: 'PUSH', language: 'ha', subject: "Bukatarka na bukatar wani abu", body: "Tabbatar da shaidarka bai cika ba: {{reason}}. Bude manhajar don ka sake turawa." },
  { code: 'COMMISSION_PAID_PUSH_HA', event: 'COMMISSION_PAID', channel: 'PUSH', language: 'ha', subject: "An biya kwamishan", body: "An tura kwamishan dinka {{reference}} zuwa bankinka." },
  { code: 'COMMISSION_PAYOUT_FAILED_PUSH_HA', event: 'COMMISSION_PAYOUT_FAILED', channel: 'PUSH', language: 'ha', subject: "Ba a iya biyan kwamishan ba", body: "{{reason}}. Kudin naka ne har yanzu — duba bayanan bankinka a cikin manhajar." },
  { code: 'TIN_CREATED_SMS_HA', event: 'TIN_CREATED', channel: 'SMS', language: 'ha', body: "PSIRS: Lambar Shaidar Biyan Haraji taka ita ce {{tin}}. Ka adana ta — za ka bukace ta a duk biyan kudi na gwamnati." },
  { code: 'INVOICE_SMS_HA', event: 'INVOICE_GENERATED', channel: 'SMS', language: 'ha', body: "PSIRS: An bayar da takardar biya {{reference}} na {{amount}}. Ka biya ta hanyoyin gwamnati da aka amince da su kadai." },
  { code: 'PAYMENT_SUCCESS_SMS_HA', event: 'PAYMENT_SUCCESSFUL', channel: 'SMS', language: 'ha', body: "PSIRS: An tabbatar da biyan kudin ka na {{amount}}. Wannan shaidar karba ce {{receiptNumber}} — BA rasit ba ne. Rasit din gwamnati zai zo bayan kudin ya isa asusun gwamnati. Kana iya duba shi a kowane lokaci da wannan lambar." },
  { code: 'PAYMENT_SUCCESS_EMAIL_HA', event: 'PAYMENT_SUCCESSFUL', channel: 'EMAIL', language: 'ha', body: "Ranka ya dade {{name}},\n\nAn tabbatar da biyan kudin ka na {{amount}} ta tsarin biyan kudi (ma’amala {{reference}}).\n\nWannan sakon SHAIDAR KARBA ce, lamba {{receiptNumber}}. BA rasit din gwamnati ba ne. Kudin zai isa asusun Gwamnatin Jihar Plateau nan ba da jimawa ba, kuma za a bayar da rasit din ka kai tsaye idan ya isa — za mu tura maka lambarsa.\n\nKana iya duba wannan shaidar karba a kowane lokaci ba tare da shiga asusu ba.\n\nHukumar Haraji ta Jihar Plateau" },
  { code: 'RECEIPT_GENERATED_SMS_HA', event: 'RECEIPT_GENERATED', channel: 'SMS', language: 'ha', body: "PSIRS: Gwamnati ta karbi biyan kudin ka na {{amount}}. Rasit din ka na gwamnati shi ne {{receiptNumber}} (ma’amala {{reference}}). Kana iya duba shi a kowane lokaci da wannan lambar." },
  { code: 'RECEIPT_GENERATED_EMAIL_HA', event: 'RECEIPT_GENERATED', channel: 'EMAIL', language: 'ha', body: "Ranka ya dade {{name}},\n\nGwamnatin Jihar Plateau ta karbi biyan kudin ka na {{amount}} (ma’amala {{reference}}).\n\nLambar rasit din ka ta gwamnati ita ce {{receiptNumber}}. Wannan ya maye gurbin shaidar karba da aka tura maka a baya, kuma shi ne shaidar biyan kudin ka.\n\nKana iya tabbatar da shi a kowane lokaci ba tare da shiga asusu ba.\n\nHukumar Haraji ta Jihar Plateau" },
  { code: 'PAYMENT_FAILED_SMS_HA', event: 'PAYMENT_FAILED', channel: 'SMS', language: 'ha', body: "PSIRS: Biyan kudi na {{reference}} bai yi nasara ba. Ba a karbi kudi ba. Kana iya sake gwadawa." },
  { code: 'VEHICLE_RENEWAL_SMS_HA', event: 'VEHICLE_RENEWAL_COMPLETED', channel: 'SMS', language: 'ha', body: "PSIRS: An sabunta motar {{registration}}, tana aiki har zuwa {{expiry}}. Sauke takardarka daga shafin." },
  { code: 'COMMISSION_EARNED_SMS_HA', event: 'COMMISSION_EARNED', channel: 'SMS', language: 'ha', status: 'INACTIVE', body: "PSIRS: Ka samu kwamishan {{amount}} a kan ma’amala {{reference}}. Za a iya biyan sa bayan an sasanta kudin." },
  { code: 'COMMISSION_EARNED_PUSH_HA', event: 'COMMISSION_EARNED', channel: 'PUSH', language: 'ha', subject: "An rubuta kwamishan", body: "{{amount}} a kan {{reference}}. Za a iya biyan sa bayan an sasanta kudin." },
  { code: 'COMMISSION_PAID_SMS_HA', event: 'COMMISSION_PAID', channel: 'SMS', language: 'ha', body: "PSIRS: An biya kwamishan {{amount}} zuwa asusun bankin ka da aka tabbatar. Lamba {{reference}}." },
  { code: 'AGENT_APPROVED_SMS_HA', event: 'AGENT_APPROVED', channel: 'SMS', language: 'ha', body: "PSIRS: An amince da bukatarka ta zama wakili. Ka kammala horo ka yi rajistar na’urarka don fara aiki." },
  { code: 'AGENT_REJECTED_SMS_HA', event: 'AGENT_REJECTED', channel: 'SMS', language: 'ha', body: "PSIRS: Ba a amince da bukatarka ta zama wakili ba. Dalili: {{reason}}" },
  { code: 'AGENT_SUSPENDED_SMS_HA', event: 'AGENT_SUSPENDED', channel: 'SMS', language: 'ha', body: "PSIRS: An dakatar da asusun wakilcin ka. Dalili: {{reason}}. Ka tuntubi shugabanka." },
  { code: 'REFEREE_INVITATION_SMS_HA', event: 'REFEREE_INVITATION', channel: 'SMS', language: 'ha', body: "PSIRS: {{applicant}} ya sa ka a matsayin mai shaida a kan bukatar zama wakilin karbar haraji ({{reference}}). Ka tabbatar a {{link}} kafin {{expiry}}." },
  { code: 'KYC_ACTION_SMS_HA', event: 'KYC_ACTION_REQUIRED', channel: 'SMS', language: 'ha', body: "PSIRS: Tabbatar da shaidarka na bukatar kulawa. {{reason}}. Bude manhajar don ka sake turawa." },
  { code: 'SUPPORT_REPLY_SMS_HA', event: 'SUPPORT_TICKET_UPDATED', channel: 'SMS', language: 'ha', body: "PSIRS: An amsa takardar korafinka {{ticketNumber}}. Bude manhajar don ka karanta." },
  { code: 'SECURITY_OTP_SMS_HA', event: 'SECURITY_ALERT', channel: 'SMS', language: 'ha', body: "PSIRS: Lambar tabbatarwarka ita ce {{code}}. Za ta kare cikin mintuna {{minutes}}. Kada ka fada wa kowa, hatta ma’aikatan PSIRS." },
  { code: 'AGENT_BANK_CHANGE_REQUESTED_SMS_HA', event: 'AGENT_BANK_CHANGE_REQUESTED', channel: 'SMS', language: 'ha', body: "PSIRS: An nemi a rika biyan kwamishan dinka a {{bank}} {{account}}. Babu abin da ya canza tukuna. Idan ba kai ba ne, ka tuntubi shugabanka yanzu." },
  { code: 'AGENT_BANK_CHANGE_APPLIED_SMS_HA', event: 'AGENT_BANK_CHANGE_APPLIED', channel: 'SMS', language: 'ha', body: "PSIRS: Yanzu za a rika biyan kwamishan dinka a {{bank}} {{account}}. Idan ba kai ba ne, ka tuntubi shugabanka yanzu." },
  { code: 'AGENT_BANK_CHANGE_REFUSED_SMS_HA', event: 'AGENT_BANK_CHANGE_REFUSED', channel: 'SMS', language: 'ha', body: "PSIRS: Ba a amince da bukatar canza asusun kwamishan dinka ba. Dalili: {{reason}}. Asusun ka na yanzu bai canza ba." },
  { code: 'TAXPAYER_RECORD_CORRECTED_SMS_HA', event: 'TAXPAYER_RECORD_CORRECTED', channel: 'SMS', language: 'ha', body: "PSIRS: An gyara {{fields}} a kan bayananka na mai biyan haraji ta hannun jami’in haraji. Idan ba kai ka nema ba, ka je kowane ofishin PSIRS." },
  { code: 'USER_ROLE_CHANGED_SMS_HA', event: 'USER_ROLE_CHANGED', channel: 'SMS', language: 'ha', body: "PSIRS: An canza matsayinka daga {{previousRole}} zuwa {{newRole}}. An fitar da kai, dole ka sake shiga. Idan ba a sa ran haka ba, ka tuntubi mai gudanarwarka yanzu." },
];

const AGENT_AGREEMENT = `PLATEAU STATE INTERNAL REVENUE SERVICE
AUTHORISED REVENUE AGENT AGREEMENT (Version 1.0)

1. APPOINTMENT
You are appointed as an authorised service channel of the Plateau State Internal
Revenue Service. You are not an employee, and you have no authority to assess,
waive, vary or forgive any government revenue.

2. COLLECTION RULES
2.1 You must never collect government revenue in cash into your own hands, your
    personal bank account, or any account other than the approved government
    payment channel presented in the application.
2.2 Every payment must be made by the taxpayer through the approved gateway.
2.3 You must show the taxpayer the assessed amount before payment is made.
2.4 You must never demand any payment that is not shown on the invoice.

3. COMMISSION
3.1 Your commission is calculated by the platform at the approved rate and is
    paid separately into your verified bank account.
3.2 You must never deduct your commission from money owed to government.
3.3 Commission is payable only on transactions that are verified and settled.
    No commission arises on failed, reversed or fraudulent transactions.

4. RECEIPTS AND DOCUMENTS
4.1 Only the platform may issue a government receipt, and only after payment has
    been independently confirmed.
4.2 You must never issue, write, alter or promise any other form of receipt.
4.3 You must give the taxpayer their receipt or its verification code.

5. DATA PROTECTION
5.1 Taxpayer information may be used only to deliver the service requested.
5.2 You must not disclose, copy, sell or retain taxpayer information.
5.3 You must comply with applicable Nigerian data protection law.

6. ANTI-FRAUD
6.1 You must not create duplicate or fictitious taxpayer records.
6.2 You must not share your login, PIN or device with anyone.
6.3 You must report any attempted inducement or fraud immediately.

7. DEVICE AND SECURITY
7.1 You may transact only from a device registered to you and approved.
7.2 You must report a lost or compromised device immediately.
7.3 You must keep the application updated to a supported version.

8. TERRITORY
You must operate within your assigned Local Government Area, wards and
communities unless expressly authorised otherwise.

9. SUSPENSION AND TERMINATION
Government may suspend or terminate your appointment immediately where there is
reason to believe any part of this agreement has been breached, including
unauthorised collection, fraud, misuse of taxpayer data or misrepresentation of
your authority.

10. ACKNOWLEDGEMENT
By accepting, you confirm that you have read and understood this agreement and
that the information in your application is true.`;

async function seedReferenceData(): Promise<void> {
  console.log('  seeding geography...');
  await withTransaction(async (client) => {
    for (const lga of PLATEAU_LGAS) {
      const row = await queryOne<{ id: string }>(
        client,
        `INSERT INTO lgas (code, name, zone, headquarters) VALUES ($1,$2,$3,$4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [lga.code, lga.name, lga.zone, lga.headquarters],
      );

      for (const [index, ward] of (WARDS[lga.code] ?? []).entries()) {
        await client.query(
          `INSERT INTO wards (lga_id, code, name) VALUES ($1,$2,$3)
           ON CONFLICT (lga_id, name) DO NOTHING`,
          [row!.id, `${lga.code}-W${String(index + 1).padStart(2, '0')}`, ward],
        );
      }

      // One default territory per LGA so agents can be assigned immediately.
      await client.query(
        `INSERT INTO territories (name, code, lga_id) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO NOTHING`,
        [`${lga.name} Territory`, `TER-${lga.code}`, row!.id],
      );
    }
  });

  console.log('  seeding revenue catalogue...');
  await withTransaction(async (client) => {
    const stateAuthority = await queryOne<{ id: string }>(
      client,
      `INSERT INTO revenue_authorities (name, code, tier)
       VALUES ($1,'PSIRS','STATE')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [config.branding.agencyName],
    );

    const lgAuthority = await queryOne<{ id: string }>(
      client,
      `INSERT INTO revenue_authorities (name, code, tier)
       VALUES ('Plateau State Local Governments','PLG','LOCAL_GOVERNMENT')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );

    const mda = await queryOne<{ id: string }>(
      client,
      `INSERT INTO mdas (authority_id, name, code) VALUES ($1,$2,'PSIRS-HQ')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [stateAuthority!.id, config.branding.agencyName],
    );

    /*
     * The Ministries, Departments and Agencies revenue is collected for.
     *
     * Every one of the forty-two items was mapped to PSIRS-HQ, so the
     * dashboard's "revenue by MDA" was one row saying the Internal Revenue
     * Service collects all of the state's revenue. True of who *collects* it
     * and useless for the question government actually asks, which is which
     * arm of government a naira belongs to — PSIRS is the collector, not the
     * beneficiary.
     *
     * Five are named here as priorities. They are seeded whether or not the
     * catalogue has anything for them yet, because an MDA with no revenue
     * item is itself the finding: it means nothing is being collected on its
     * behalf through this platform, and that is visible only if the MDA
     * exists to show a zero against.
     */
    const MDAS = [
      { code: 'MDA-EDU', name: 'Ministry of Education' },
      { code: 'MDA-LANDS', name: 'Ministry of Lands, Survey and Town Planning' },
      { code: 'MDA-TRANS', name: 'Ministry of Transport' },
      { code: 'MDA-HEALTH', name: 'Ministry of Health' },
      { code: 'MDA-WATER', name: 'Ministry of Water Resources and Energy' },
      { code: 'MDA-ENV', name: 'Ministry of Environment' },
      { code: 'MDA-COMMERCE', name: 'Ministry of Commerce and Industry' },
      { code: 'MDA-LG', name: 'Local Government Councils' },
    ] as const;

    const mdaByCode = new Map<string, string>([['PSIRS-HQ', mda!.id]]);
    for (const entry of MDAS) {
      const row = await queryOne<{ id: string }>(
        client,
        `INSERT INTO mdas (authority_id, name, code) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [entry.code === 'MDA-LG' ? lgAuthority!.id : stateAuthority!.id, entry.name, entry.code],
      );
      mdaByCode.set(entry.code, row!.id);
    }

    const seedCategory = async (
      authorityId: string,
      definition: { category: string; code: string; items: unknown[] },
    ) => {
      const category = await queryOne<{ id: string }>(
        client,
        `INSERT INTO revenue_categories (authority_id, name, code)
         VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [authorityId, definition.category, definition.code],
      );
      return category!.id;
    };

    const seedItem = async (
      categoryId: string,
      item: {
        code: string;
        name: string;
        rateType: 'FIXED' | 'PERCENTAGE' | 'TIERED' | 'FORMULA';
        fixedNaira?: string;
        basisPoints?: number;
        tiers?: unknown;
        formula?: string;
        minimumNaira?: string;
        maximumNaira?: string;
        frequency?: string;
        taxpayerTypes?: string[];
        selfAssessable?: boolean;
        awaitingSchedule?: boolean;
        /**
         * Local government revenue: a rate per Council, not one for the State.
         *
         * Part III of the Taxes and Levies Act puts these on the local government
         * list, so the figure comes from a Council's bye-law and Plateau has
         * seventeen Councils. Each is seeded with the figure the catalogue already
         * carried — nothing charged today changes — but as seventeen rows a Council
         * can correct one at a time rather than one number that could only be right
         * for all of them by coincidence.
         */
        perLga?: boolean;
        /** Councils where the item is not collectable at all, by name. */
        excludeLgas?: string[];
        /**
         * The MDA this revenue belongs to, by code.
         *
         * PSIRS collects it; this says who it is collected *for*. Defaults to
         * PSIRS-HQ, which is right for the taxes the Service levies in its own
         * name and wrong for a fee that exists because another ministry
         * regulates something.
         */
        mda?: string;
      },
    ) => {
      const existing = await queryOne<{ id: string }>(
        client,
        'SELECT id FROM revenue_items WHERE code = $1',
        [item.code],
      );
      if (existing) return;

      const row = await queryOne<{ id: string }>(
        client,
        `INSERT INTO revenue_items
           (category_id, mda_id, code, name, applicable_taxpayer_types, frequency,
            self_assessable, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE') RETURNING id`,
        [
          categoryId,
          mdaByCode.get(item.mda ?? 'PSIRS-HQ') ?? mda!.id,
          item.code,
          item.name,
          item.taxpayerTypes ?? ['INDIVIDUAL', 'BUSINESS'],
          item.frequency ?? 'ANNUAL',
          item.selfAssessable ?? false,
        ],
      );

      // Catalogued, but with no rate in force: the amount belongs to a
      // Schedule of the Revenue (Consolidation) Law, and until government
      // enters it `revenue.ts` refuses to assess the item rather than
      // inventing a figure to charge somebody.
      if (item.awaitingSchedule) return;

      const values = [
        item.rateType,
        item.fixedNaira ? nairaToKobo(item.fixedNaira).toString() : null,
        item.basisPoints ?? null,
        item.tiers ? JSON.stringify(item.tiers) : null,
        item.formula ?? null,
        item.minimumNaira ? nairaToKobo(item.minimumNaira).toString() : null,
        item.maximumNaira ? nairaToKobo(item.maximumNaira).toString() : null,
      ];

      /*
       * A rate per Council, for the items a Council sets.
       *
       * These are on Part III of the Taxes and Levies Act — the local
       * government list — and their rate comes from a Council's own bye-law.
       * Seventeen Councils, seventeen bye-laws, and this repository knows what
       * none of them say. What it can do is stop pretending one figure governs
       * all of them.
       *
       * Each Council is seeded with the figure the catalogue already carried,
       * so nothing charged today changes. What changes is that the figure is
       * now seventeen rows a Council can correct one at a time, instead of one
       * shared number that could only be right by coincidence — and that a
       * Council with no row is refused rather than charged its neighbour's
       * rate.
       */
      if (item.perLga) {
        const lgas = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM lgas WHERE status = 'ACTIVE' ORDER BY name`,
        );
        let version = 0;
        for (const lga of lgas.rows) {
          if (item.excludeLgas?.includes(lga.name)) continue;
          version += 1;
          await client.query(
            `INSERT INTO revenue_item_rates
               (revenue_item_id, lga_id, version, rate_type, fixed_amount_kobo, rate_basis_points,
                tiers, formula, minimum_amount_kobo, maximum_amount_kobo, effective_from)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
            [row!.id, lga.id, version, ...values],
          );
        }
        return;
      }

      await client.query(
        `INSERT INTO revenue_item_rates
           (revenue_item_id, version, rate_type, fixed_amount_kobo, rate_basis_points, tiers,
            formula, minimum_amount_kobo, maximum_amount_kobo, effective_from)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8, now())`,
        [row!.id, ...values],
      );
    };

    for (const definition of STATE_CATALOGUE) {
      const categoryId = await seedCategory(stateAuthority!.id, definition);
      for (const item of definition.items) await seedItem(categoryId, item);
    }

    const lgCategoryId = await seedCategory(lgAuthority!.id, LOCAL_GOVERNMENT_CATALOGUE);
    for (const item of LOCAL_GOVERNMENT_CATALOGUE.items) await seedItem(lgCategoryId, item);
  });

  console.log('  seeding commission policy, training, templates...');
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO commission_policies
         (name, code, rate_basis_points, hold_period_hours, settlement_schedule,
          requires_settlement_confirmation, effective_from)
       VALUES ('Standard grassroots agent incentive','STANDARD',$1,$2,'WEEKLY',true, now())
       ON CONFLICT (code) DO NOTHING`,
      [config.commission.defaultBasisPoints, config.commission.defaultHoldPeriodHours],
    );

    for (const [index, module] of TRAINING_MODULES.entries()) {
      await client.query(
        `INSERT INTO training_modules (code, title, content, sequence_no, assessed, pass_mark, mandatory)
         VALUES ($1,$2,$3,$4,$5,$6,true)
         ON CONFLICT (code) DO NOTHING`,
        [
          module.code,
          module.title,
          `Training content for "${module.title}". This module covers the rules, the correct ` +
            `procedure, and the common mistakes that lead to taxpayer complaints or suspension.`,
          index + 1,
          module.assessed,
          module.passMark,
        ],
      );
    }

    for (const template of NOTIFICATION_TEMPLATES) {
      await client.query(
        `INSERT INTO notification_templates (code, event, channel, subject, body, status, language)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`,
        [
          template.code,
          template.event,
          template.channel,
          template.subject ?? null,
          template.body,
          // A template can be seeded switched off. Migrations run before this
          // on a fresh database, so a migration that deactivates a row would
          // run before the row existed — the status has to be seeded, not
          // patched afterwards.
          ('status' in template ? template.status : null) ?? 'ACTIVE',
          // English unless the row says otherwise. Selection prefers the
          // recipient's own language and falls back to this.
          ('language' in template ? template.language : null) ?? 'en',
        ],
      );
    }

    await client.query(
      `INSERT INTO agreement_versions (version, title, body, status)
       VALUES ('1.0','Authorised Revenue Agent Agreement',$1,'ACTIVE')
       ON CONFLICT (version) DO NOTHING`,
      [AGENT_AGREEMENT],
    );

    await client.query(
      `INSERT INTO app_versions (app, minimum_version, recommended_version, notes)
       SELECT 'AGENT_PWA', $1, $2, 'Initial release'
        WHERE NOT EXISTS (SELECT 1 FROM app_versions WHERE app = 'AGENT_PWA')`,
      [config.pwa.minimumAgentVersion, config.pwa.recommendedAgentVersion],
    );

    // The government collection account. Revenue settles here; agent commission
    // never does, and an agent account can never be substituted for it.
    await client.query(
      `INSERT INTO bank_accounts
         (owner_type, owner_id, bank_name, account_name, account_number, verification_status, verified_at)
       SELECT 'GOVERNMENT', gen_random_uuid(), 'Central Bank of Nigeria',
              'Plateau State Government Consolidated Revenue Account', '0000000001', 'VERIFIED', now()
        WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE owner_type = 'GOVERNMENT')`,
    );

    for (const programme of INCENTIVE_PROGRAMMES) {
      await client.query(
        `INSERT INTO incentive_programmes
           (name, code, description, benefit_type, benefit_description, eligibility_rules,
            minimum_score, minimum_compliance_periods, requires_no_arrears,
            start_date, approval_authority, status, linkage_mode)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,CURRENT_DATE,$10,'DRAFT',$11)
         ON CONFLICT (code) DO NOTHING`,
        [
          programme.name,
          programme.code,
          programme.description,
          programme.benefitType,
          programme.benefitDescription,
          JSON.stringify(programme.eligibilityRules),
          programme.minimumScore,
          programme.minimumCompliancePeriods,
          programme.requiresNoArrears,
          programme.approvalAuthority,
          programme.linkageMode,
        ],
      );
    }
  });
}

/**
 * Government users for development and acceptance testing.
 *
 * Refuses to run in production, for the same reason `seedDemoAgent` does and
 * with more at stake: these are ACTIVE government accounts — including an
 * `admin` — sharing one published password. `seedDemoAgent` has always had this
 * guard and this function did not, which left the more dangerous of the two
 * unprotected.
 *
 * The exposure was not theoretical. Reference data (LGAs, wards, the revenue
 * catalogue) is seeded by this same command and production genuinely needs it,
 * so an operator setting up production runs `npm run seed` — and on success it
 * used to print "Re-run with --demo to add demonstration government users",
 * recommending the dangerous flag at exactly the wrong moment. The hint below
 * is now suppressed in production, and reaching it anyway fails here.
 */
async function seedDemoUsers(): Promise<void> {
  if (config.isProduction) {
    throw new Error(
      'Refusing to seed demonstration government users in production. ' +
        'These are ACTIVE accounts, including an administrator, sharing one ' +
        'well-known password. Create real accounts instead.',
    );
  }

  console.log('  seeding demonstration government users...');

  const users = [
    { name: 'Admin Officer', phone: '+2348000000001', email: 'admin@psirs.demo', role: 'admin' },
    { name: 'Revenue Officer', phone: '+2348000000002', email: 'revenue@psirs.demo', role: 'revenue_officer' },
    { name: 'Finance Officer', phone: '+2348000000003', email: 'finance@psirs.demo', role: 'finance_officer' },
    { name: 'Agent Supervisor', phone: '+2348000000004', email: 'supervisor@psirs.demo', role: 'supervisor' },
    { name: 'State Auditor', phone: '+2348000000005', email: 'auditor@psirs.demo', role: 'auditor' },
    /*
     * A second finance officer, because several of the money controls require
     * two of them and one is therefore not a working finance office.
     *
     * Closing a disputed settlement releases the commission on every collection
     * in the batch, so the officer who recorded it may not be the one to close
     * it. With a single seeded finance officer that path cannot be walked at
     * all — not in a demonstration, not in UAT, and not by anyone checking that
     * the separation actually holds.
     */
    { name: 'Finance Officer (Second)', phone: '+2348000000006', email: 'finance2@psirs.demo', role: 'finance_officer' },
  ];

  const passwordHash = await hashPassword('Password123');

  await withTransaction(async (client) => {
    for (const user of users) {
      await client.query(
        `INSERT INTO users (full_name, phone, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE')
         ON CONFLICT (phone) DO NOTHING`,
        [user.name, user.phone, user.email, passwordHash, user.role],
      );
    }
  });

  console.log('\n  Demonstration sign-in details (development only):');
  for (const user of users) {
    console.log(`    ${user.role.padEnd(16)} ${user.phone}  password: Password123`);
  }
}

async function main(): Promise<void> {
  const wantsAgent = process.argv.includes('--demo-agent');

  /*
   * `--demo-agent` implies `--demo`, and says so.
   *
   * It used to be `demo && argv.includes('--demo-agent')`, so asking for the
   * agent without also asking for the officers produced a run that seeded the
   * catalogue, printed "Seed complete" and created no users at all — while
   * saying nothing about the flag it had just discarded. The next thing that
   * happens is a sign-in attempt answered "Phone number or password is
   * incorrect", which sends you looking at your password rather than at the
   * seed.
   *
   * The dependency is real: the agent is walked through the clearance pipeline
   * rather than inserted, and that pipeline needs an officer to approve the
   * application. So the right response to being given one flag is to apply the
   * other, not to drop the request on the floor.
   */
  const demo = process.argv.includes('--demo') || wantsAgent;

  // Refuse before touching anything. `seedDemoUsers` and `seedDemoAgent` both
  // refuse on their own, but they run after migrations and the reference data,
  // so the operator would watch a long successful-looking run end in an error
  // and have to work out how much of it had happened. Say no to the flag while
  // the answer is still simple.
  if (demo && config.isProduction) {
    throw new Error(
      'Refusing --demo/--demo-agent in production: they create ACTIVE government ' +
        'accounts, including an administrator, sharing one well-known password. ' +
        'Run the seed without flags for reference data only.',
    );
  }

  console.log('Seeding Plateau State Revenue Platform...');
  console.log(`  target: ${describeDatabase(config.database.url)}`);
  if (wantsAgent && !process.argv.includes('--demo')) {
    console.log(
      '  note: --demo-agent needs an officer to approve the application, ' +
        'so --demo has been applied as well.',
    );
  }
  await runMigrations({ silent: true });
  await seedReferenceData();
  if (demo) await seedDemoUsers();

  // The agent has to be walked through the clearance pipeline rather than
  // inserted, so it is opt-in: it makes several service calls and its failure
  // would otherwise obscure an ordinary reference-data seed.
  const agent = wantsAgent ? await seedDemoAgent() : null;

  const summary = await queryOne<Record<string, string>>(
    pool,
    `SELECT
       (SELECT count(*)::text FROM lgas) AS lgas,
       (SELECT count(*)::text FROM wards) AS wards,
       (SELECT count(*)::text FROM revenue_categories) AS categories,
       (SELECT count(*)::text FROM revenue_items) AS items,
       (SELECT count(*)::text FROM training_modules) AS training_modules,
       (SELECT count(*)::text FROM notification_templates) AS templates`,
  );

  console.log('\nSeed complete:');
  console.log(`  ${summary?.lgas} LGAs, ${summary?.wards} wards`);
  console.log(`  ${summary?.categories} revenue categories, ${summary?.items} revenue items`);
  console.log(`  ${summary?.training_modules} training modules, ${summary?.templates} notification templates`);
  if (agent) {
    console.log('\n  Demonstration agent (development only) — cleared and ACTIVE:');
    console.log(`    agent            ${agent.phone}  password: ${agent.password}`);
    console.log(`    device id        ${agent.deviceIdentifier}`);
    console.log('    The agent PWA generates its own device id, so the first sign-in from');
    console.log('    a browser registers that device instead — approve it in the portal');
    console.log('    under Agents → Devices, or sign in and register it from the app.');
  }

  // Never advertise the demonstration flags in production: the seed there is a
  // legitimate step (the revenue catalogue has to come from somewhere), and it
  // must not close by suggesting the one thing that would compromise the
  // platform. Both flags now refuse in production anyway; this stops an
  // operator being pointed at a wall.
  if (config.isProduction) {
    console.log('\n  Reference data only. Demonstration users and agents are refused in production.');
  } else if (!demo) {
    console.log('\n  Re-run with --demo to add demonstration government users.');
  } else if (!agent) {
    console.log('\n  Add --demo-agent to also create a cleared, active field agent.');
  }
}

if (require.main === module) {
  main()
    .then(async () => {
      await closePool();
    })
    .catch(async (error) => {
      console.error('Seed failed:', error);
      await closePool();
      process.exit(1);
    });
}

export { seedReferenceData, seedDemoUsers };
export { seedDemoAgent } from './seed-agent';
