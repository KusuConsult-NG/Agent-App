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
  }[];
}[] = [
  {
    category: 'Personal Income Tax',
    code: 'PIT',
    items: [
      {
        code: 'PIT-DIRECT',
        name: 'Direct Assessment / Self-Assessment',
        rateType: 'TIERED',
        // Nigerian PIT bands applied to taxable income supplied as
        // baseAmountKobo. Progressive: each band taxes only its own portion.
        tiers: {
          tiers: [
            { upToKobo: nairaToKobo('300000').toString(), basisPoints: 700 },
            { upToKobo: nairaToKobo('600000').toString(), basisPoints: 1100 },
            { upToKobo: nairaToKobo('1100000').toString(), basisPoints: 1500 },
            { upToKobo: nairaToKobo('1600000').toString(), basisPoints: 1900 },
            { upToKobo: nairaToKobo('3200000').toString(), basisPoints: 2100 },
            { upToKobo: null, basisPoints: 2400 },
          ],
        },
        minimumNaira: '5000',
        frequency: 'ANNUAL',
        taxpayerTypes: ['INDIVIDUAL'],
        selfAssessable: true,
      },
      {
        code: 'PIT-PAYE',
        name: 'Pay As You Earn (PAYE)',
        rateType: 'PERCENTAGE',
        basisPoints: 700,
        frequency: 'MONTHLY',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'PIT-WHT',
        name: 'Withholding Tax (individuals)',
        rateType: 'PERCENTAGE',
        basisPoints: 500,
        frequency: 'ONE_OFF',
      },
      {
        code: 'PIT-CGT',
        name: 'Capital Gains Tax (individuals)',
        rateType: 'PERCENTAGE',
        basisPoints: 1000,
        frequency: 'ONE_OFF',
      },
      {
        code: 'PIT-STAMP',
        name: 'Stamp Duties on instruments executed by individuals',
        rateType: 'PERCENTAGE',
        basisPoints: 75,
        minimumNaira: '500',
        frequency: 'ONE_OFF',
      },
    ],
  },
  {
    category: 'Business Premises and Development',
    code: 'BPD',
    items: [
      {
        code: 'BP-REG-URBAN',
        name: 'Business Premises Registration (urban)',
        rateType: 'FIXED',
        fixedNaira: '10000',
        frequency: 'ONE_OFF',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'BP-RENEW-URBAN',
        name: 'Business Premises Renewal (urban)',
        rateType: 'FIXED',
        fixedNaira: '5000',
        frequency: 'ANNUAL',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'BP-REG-RURAL',
        name: 'Business Premises Registration (rural)',
        rateType: 'FIXED',
        fixedNaira: '2000',
        frequency: 'ONE_OFF',
        taxpayerTypes: ['BUSINESS'],
      },
      {
        code: 'BP-RENEW-RURAL',
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
        name: 'Vehicle Particulars Renewal (commercial)',
        rateType: 'FORMULA',
        formula: '1250 * renewalPeriodMonths * 100',
        minimumNaira: '7500',
        frequency: 'ANNUAL',
      },
      {
        code: 'ROAD-TAX',
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
      { code: 'RIGHT-OCCUPANCY', name: 'Right of Occupancy Fees', rateType: 'FIXED', fixedNaira: '50000', frequency: 'ONE_OFF' },
      { code: 'LAND-USE-CHARGE', name: 'Land Use Charge', rateType: 'PERCENTAGE', basisPoints: 50, minimumNaira: '5000', frequency: 'ANNUAL' },
      { code: 'PROPERTY-TAX', name: 'Property Tax', rateType: 'PERCENTAGE', basisPoints: 100, minimumNaira: '10000', frequency: 'ANNUAL' },
      { code: 'STREET-NAMING', name: 'Naming of Street Registration Fees', rateType: 'FIXED', fixedNaira: '25000', frequency: 'ONE_OFF' },
      { code: 'INFRA-LEVY', name: 'Infrastructure Maintenance Charge/Levy', rateType: 'FIXED', fixedNaira: '5000', frequency: 'ANNUAL' },
    ],
  },
  {
    category: 'Trade, Markets and Produce',
    code: 'TRADE',
    items: [
      { code: 'MARKET-LEVY', name: 'Market Taxes and Levies', rateType: 'FIXED', fixedNaira: '200', frequency: 'DAILY' },
      { code: 'ANIMAL-TRADE-TAX', name: 'Animal Trade Tax', rateType: 'FIXED', fixedNaira: '1500', frequency: 'ONE_OFF' },
      { code: 'PRODUCE-SALES-TAX', name: 'Produce Sales Tax', rateType: 'PERCENTAGE', basisPoints: 200, minimumNaira: '500', frequency: 'ONE_OFF' },
      { code: 'ABATTOIR-FEE', name: 'Slaughter / Abattoir Fees', rateType: 'FIXED', fixedNaira: '1000', frequency: 'DAILY' },
    ],
  },
  {
    category: 'Hospitality, Entertainment and Gaming',
    code: 'HOSP',
    items: [
      { code: 'CONSUMPTION-TAX', name: 'Hotel, Restaurant or Event Centre Consumption Tax', rateType: 'PERCENTAGE', basisPoints: 500, frequency: 'MONTHLY', taxpayerTypes: ['BUSINESS'] },
      { code: 'ENTERTAINMENT-TAX', name: 'Entertainment Tax', rateType: 'PERCENTAGE', basisPoints: 500, minimumNaira: '2000', frequency: 'ONE_OFF' },
      { code: 'GAMING-TAX', name: 'Pool, Betting, Lottery, Gaming and Casino Taxes', rateType: 'PERCENTAGE', basisPoints: 1000, minimumNaira: '10000', frequency: 'MONTHLY', taxpayerTypes: ['BUSINESS'] },
    ],
  },
  {
    category: 'Environment, Mining and Safety',
    code: 'ENV',
    items: [
      { code: 'ECOLOGICAL-FEE', name: 'Environmental / Ecological Fees', rateType: 'FIXED', fixedNaira: '5000', frequency: 'ANNUAL' },
      { code: 'MINING-FEE', name: 'Mining, Milling and Quarrying Fees', rateType: 'FIXED', fixedNaira: '150000', frequency: 'ANNUAL', taxpayerTypes: ['BUSINESS'] },
      { code: 'FIRE-SERVICE-CHARGE', name: 'Fire Service Charge', rateType: 'FIXED', fixedNaira: '3000', frequency: 'ANNUAL' },
    ],
  },
  {
    category: 'Advertising and Signage',
    code: 'ADVERT',
    items: [
      { code: 'SIGNAGE-FEE', name: 'Signage and Mobile Advertisement', rateType: 'FIXED', fixedNaira: '15000', frequency: 'ANNUAL', taxpayerTypes: ['BUSINESS'] },
    ],
  },
];

/** Local-government revenue heads PSIRS identifies separately (PRD §8). */
const LOCAL_GOVERNMENT_CATALOGUE = {
  category: 'Local Government Rates and Fees',
  code: 'LGR',
  items: [
    { code: 'SHOPS-KIOSKS', name: 'Shops and Kiosks Rates', rateType: 'FIXED' as const, fixedNaira: '3000', frequency: 'ANNUAL' as const },
    { code: 'TENEMENT-RATES', name: 'Tenement Rates', rateType: 'FIXED' as const, fixedNaira: '5000', frequency: 'ANNUAL' as const },
    { code: 'SLAUGHTER-SLAB', name: 'Slaughter Slab Fees', rateType: 'FIXED' as const, fixedNaira: '500', frequency: 'DAILY' as const },
    { code: 'MOTOR-PARK-LEVY', name: 'Motor Park Levies', rateType: 'FIXED' as const, fixedNaira: '300', frequency: 'DAILY' as const },
    { code: 'DOMESTIC-ANIMAL-LICENCE', name: 'Domestic Animal Licence Fees', rateType: 'FIXED' as const, fixedNaira: '1000', frequency: 'ANNUAL' as const },
    { code: 'MARRIAGE-REGISTRATION', name: 'Marriage, Birth and Death Registration Fees', rateType: 'FIXED' as const, fixedNaira: '2000', frequency: 'ONE_OFF' as const },
  ],
};

const NOTIFICATION_TEMPLATES = [
  { code: 'TIN_CREATED_SMS', event: 'TIN_CREATED', channel: 'SMS', body: 'PSIRS: Your Taxpayer Identification Number is {{tin}}. Keep it safe — you will need it for every government payment.' },
  { code: 'INVOICE_SMS', event: 'INVOICE_GENERATED', channel: 'SMS', body: 'PSIRS: Invoice {{reference}} for {{amount}} has been raised. Pay only through approved government channels.' },
  { code: 'PAYMENT_SUCCESS_SMS', event: 'PAYMENT_SUCCESSFUL', channel: 'SMS', body: 'PSIRS: Your payment of {{amount}} has been confirmed. Receipt: {{receiptNumber}}. Verify it at any time using the receipt number.' },
  { code: 'PAYMENT_SUCCESS_EMAIL', event: 'PAYMENT_SUCCESSFUL', channel: 'EMAIL', subject: 'Payment confirmed — receipt {{receiptNumber}}', body: 'Dear {{name}},\n\nYour payment of {{amount}} has been received and confirmed. Your official receipt number is {{receiptNumber}} (transaction {{reference}}).\n\nYou can verify this receipt at any time without signing in.\n\nPlateau State Internal Revenue Service' },
  { code: 'PAYMENT_FAILED_SMS', event: 'PAYMENT_FAILED', channel: 'SMS', body: 'PSIRS: Payment for {{reference}} did not go through. No money has been taken. You can try again.' },
  { code: 'VEHICLE_RENEWAL_SMS', event: 'VEHICLE_RENEWAL_COMPLETED', channel: 'SMS', body: 'PSIRS: Vehicle {{registration}} has been renewed and is valid until {{expiry}}. Download your document from the portal.' },
  { code: 'COMMISSION_EARNED_SMS', event: 'COMMISSION_EARNED', channel: 'SMS', body: 'PSIRS: You earned {{amount}} commission on transaction {{reference}}. It becomes payable after settlement.' },
  { code: 'COMMISSION_PAID_SMS', event: 'COMMISSION_PAID', channel: 'SMS', body: 'PSIRS: Commission of {{amount}} has been paid to your verified bank account. Reference {{reference}}.' },
  { code: 'AGENT_APPROVED_SMS', event: 'AGENT_APPROVED', channel: 'SMS', body: 'PSIRS: Your agent application has been approved. Complete training and register your device to begin work.' },
  { code: 'AGENT_REJECTED_SMS', event: 'AGENT_REJECTED', channel: 'SMS', body: 'PSIRS: Your agent application was not approved. Reason: {{reason}}' },
  { code: 'AGENT_SUSPENDED_SMS', event: 'AGENT_SUSPENDED', channel: 'SMS', body: 'PSIRS: Your agent account has been suspended. Reason: {{reason}}. Contact your supervisor.' },
  { code: 'REFEREE_INVITATION_SMS', event: 'REFEREE_INVITATION', channel: 'SMS', body: 'PSIRS: {{applicant}} has named you as referee for a revenue agent application ({{reference}}). Confirm at {{link}} before {{expiry}}.' },
  { code: 'KYC_ACTION_SMS', event: 'KYC_ACTION_REQUIRED', channel: 'SMS', body: 'PSIRS: Your identity verification needs attention. {{reason}}. Open the app to resubmit.' },
  { code: 'SUPPORT_REPLY_SMS', event: 'SUPPORT_TICKET_UPDATED', channel: 'SMS', body: 'PSIRS: There is a reply on your support ticket {{ticketNumber}}. Open the app to read it.' },
  { code: 'SECURITY_OTP_SMS', event: 'SECURITY_ALERT', channel: 'SMS', body: 'PSIRS: Your verification code is {{code}}. It expires in {{minutes}} minutes. Never share it with anyone, including PSIRS staff.' },
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
          mda!.id,
          item.code,
          item.name,
          item.taxpayerTypes ?? ['INDIVIDUAL', 'BUSINESS'],
          item.frequency ?? 'ANNUAL',
          item.selfAssessable ?? false,
        ],
      );

      await client.query(
        `INSERT INTO revenue_item_rates
           (revenue_item_id, version, rate_type, fixed_amount_kobo, rate_basis_points, tiers,
            formula, minimum_amount_kobo, maximum_amount_kobo, effective_from)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8, now())`,
        [
          row!.id,
          item.rateType,
          item.fixedNaira ? nairaToKobo(item.fixedNaira).toString() : null,
          item.basisPoints ?? null,
          item.tiers ? JSON.stringify(item.tiers) : null,
          item.formula ?? null,
          item.minimumNaira ? nairaToKobo(item.minimumNaira).toString() : null,
          item.maximumNaira ? nairaToKobo(item.maximumNaira).toString() : null,
        ],
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
        `INSERT INTO notification_templates (code, event, channel, subject, body)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING`,
        [template.code, template.event, template.channel, template.subject ?? null, template.body],
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
