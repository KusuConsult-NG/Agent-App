/**
 * Plateau State reference geography and platform-wide enumerations.
 *
 * Plateau State has 17 Local Government Areas grouped into three senatorial
 * zones. Geography is reference data rather than configuration: it changes
 * only by law, and revenue is reported against it (PRD §38, §73).
 */

export interface LgaDefinition {
  readonly code: string;
  readonly name: string;
  readonly zone: 'Plateau North' | 'Plateau Central' | 'Plateau South';
  readonly headquarters: string;
}

export const PLATEAU_LGAS: readonly LgaDefinition[] = [
  { code: 'PL-BAR', name: 'Barkin Ladi', zone: 'Plateau North', headquarters: 'Barkin Ladi' },
  { code: 'PL-BAS', name: 'Bassa', zone: 'Plateau North', headquarters: 'Bassa' },
  { code: 'PL-JOE', name: 'Jos East', zone: 'Plateau North', headquarters: 'Angware' },
  { code: 'PL-JON', name: 'Jos North', zone: 'Plateau North', headquarters: 'Jos' },
  { code: 'PL-JOS', name: 'Jos South', zone: 'Plateau North', headquarters: 'Bukuru' },
  { code: 'PL-RIY', name: 'Riyom', zone: 'Plateau North', headquarters: 'Riyom' },
  { code: 'PL-BOK', name: 'Bokkos', zone: 'Plateau Central', headquarters: 'Bokkos' },
  { code: 'PL-KAN', name: 'Kanam', zone: 'Plateau Central', headquarters: 'Dengi' },
  { code: 'PL-KNK', name: 'Kanke', zone: 'Plateau Central', headquarters: 'Kwal' },
  { code: 'PL-MAN', name: 'Mangu', zone: 'Plateau Central', headquarters: 'Mangu' },
  { code: 'PL-PAN', name: 'Pankshin', zone: 'Plateau Central', headquarters: 'Pankshin' },
  { code: 'PL-LAN', name: 'Langtang North', zone: 'Plateau South', headquarters: 'Langtang' },
  { code: 'PL-LAS', name: 'Langtang South', zone: 'Plateau South', headquarters: 'Mabudi' },
  { code: 'PL-MIK', name: 'Mikang', zone: 'Plateau South', headquarters: 'Tunkus' },
  { code: 'PL-QUA', name: "Qua'an Pan", zone: 'Plateau South', headquarters: 'Baap' },
  { code: 'PL-SHE', name: 'Shendam', zone: 'Plateau South', headquarters: 'Shendam' },
  { code: 'PL-WAS', name: 'Wase', zone: 'Plateau South', headquarters: 'Wase' },
];

export const TAXPAYER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export type TaxpayerType = (typeof TAXPAYER_TYPES)[number];

export const RATE_TYPES = ['FIXED', 'PERCENTAGE', 'TIERED', 'FORMULA'] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const FREQUENCIES = ['ONE_OFF', 'DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const PAYMENT_METHODS = [
  'CARD',
  'BANK_TRANSFER',
  'USSD',
  'ACCOUNT_TRANSFER',
  'POS',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DOCUMENT_TYPES = [
  'RECEIPT',
  'INVOICE',
  'ASSESSMENT',
  'VEHICLE_RENEWAL',
  'TIN_CONFIRMATION',
  'PAYMENT_EVIDENCE',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Fraud signals evaluated on every field transaction (PRD §32). */
export const FRAUD_RULES = [
  'DEVICE_VELOCITY',
  'SHARED_PHONE_NUMBER',
  'DUPLICATE_TAXPAYER_DETAILS',
  'OUT_OF_TERRITORY',
  'REPEATED_FAILED_PAYMENTS',
  'REVERSAL_PATTERN',
  'UNUSUAL_VOLUME',
  'RAPID_SUCCESSION',
  'COMMISSION_ANOMALY',
  /*
   * The gateway paid in less — or more — than the collections it was settling.
   *
   * Raised against the settlement itself rather than any one collection: the
   * variance is a fact about the batch, and which of the day's transactions it
   * belongs to is exactly what nobody knows yet. It was being raised under
   * this name already, from a direct insert, with a rule string no list here
   * knew about and an entity type that said 'TRANSACTION'.
   */
  'SETTLEMENT_VARIANCE',
] as const;
export type FraudRule = (typeof FRAUD_RULES)[number];

export const FRAUD_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type FraudSeverity = (typeof FRAUD_SEVERITIES)[number];

export const APPROVAL_TYPES = [
  'AGENT_ACTIVATION',
  'AGENT_SUSPENSION',
  'COMMISSION_ADJUSTMENT',
  'COMMISSION_PAYOUT',
  'REFUND',
  'PAYMENT_REVERSAL',
  'REVENUE_RATE_CHANGE',
  'MANUAL_CORRECTION',
  'BANK_ACCOUNT_CHANGE',
  'TAXPAYER_ADJUSTMENT',
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATES = [
  'REQUESTED',
  'REVIEWED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXECUTED',
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const TICKET_STATES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketState = (typeof TICKET_STATES)[number];

// ---------------------------------------------------------------------------
// Economic sector taxonomy (PRD §10, §41)
// ---------------------------------------------------------------------------
// Used for structured taxpayer profiling during agent onboarding. Each sector
// maps to a curated list of revenue item codes that commonly apply to it, so
// the Agent PWA can suggest relevant taxes without requiring the agent to know
// the full catalogue. Suggestions are not obligations — the agent confirms.
//
// hausa: Hausa-language display label for the Agent PWA.
// suggestedRevenueCodes: revenue_items.code values likely applicable to this
//   sector. The backend derives the actual UUIDs at runtime from these codes.

export interface EconomicSectorDefinition {
  readonly code: string;
  readonly label: string;
  readonly hausa: string;
  readonly suggestedRevenueCodes: readonly string[];
}

export const ECONOMIC_SECTORS: readonly EconomicSectorDefinition[] = [
  // ─── Primary sector ──────────────────────────────────────────────────────
  {
    code: 'AGRICULTURE',
    label: 'Farmer / Agriculture',
    hausa: 'Noma',
    // Farmer owes: Development Levy (all taxable adults), Produce Sales Tax on crops
    // sold, Ecological Fee for land use, Road Tax if using farm-to-market vehicles.
    suggestedRevenueCodes: ['DEV-LEVY', 'PRODUCE-SALES-TAX', 'ECOLOGICAL-FEE'],
  },
  {
    code: 'LIVESTOCK',
    label: 'Livestock / Animal Husbandry / Herder',
    hausa: 'Kiwo',
    // Herders: Animal Trade Tax on sales, Abattoir Fee when slaughtering for sale,
    // Domestic Animal Licence for kept animals, Development Levy.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'ANIMAL-TRADE-TAX', 'ABATTOIR-FEE', 'DOMESTIC-ANIMAL-LICENCE',
    ],
  },
  {
    code: 'FISHING',
    label: 'Fishing / Aquaculture',
    hausa: 'Kamun Kifi',
    suggestedRevenueCodes: ['DEV-LEVY', 'ECOLOGICAL-FEE'],
  },
  {
    code: 'AGRICULTURE_PROCESSING',
    label: 'Agro-Processing / Mill / Silo / Groundnut Oil',
    hausa: 'Sarrafa Amfanin Gona',
    // Processes primary produce: Produce Sales Tax on output, Economic Dev Levy,
    // Ecological Fee, Fire Service (machinery/heat risk), Business Premises.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'PRODUCE-SALES-TAX', 'ECON-DEV-LEVY',
      'ECOLOGICAL-FEE', 'FIRE-SERVICE-CHARGE',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'MINING',
    label: 'Mining / Quarrying / Tin / Columbite',
    hausa: "Hakar Ma'adini",
    // Plateau State is historically a mining state (tin, columbite, limestone).
    suggestedRevenueCodes: [
      'MINING-FEE', 'ECOLOGICAL-FEE', 'ROAD-TAX', 'DEV-LEVY', 'ECON-DEV-LEVY',
    ],
  },

  // ─── Secondary / Industry ────────────────────────────────────────────────
  {
    code: 'MANUFACTURING',
    label: 'Manufacturing / Factory / Workshop',
    hausa: "Masana'antu",
    suggestedRevenueCodes: [
      'DEV-LEVY', 'ECON-DEV-LEVY', 'FIRE-SERVICE-CHARGE',
      'ECOLOGICAL-FEE', 'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'CONSTRUCTION',
    label: 'Construction / Building Contractor / Developer',
    hausa: 'Gine-gine',
    // Contractors: Land Use Charge on land held, Tenement Rates on structures,
    // Infrastructure Levy, Road Tax (heavy machinery), Fire Service on sites.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'LAND-USE-CHARGE', 'TENEMENT-RATES',
      'INFRA-LEVY', 'ROAD-TAX', 'FIRE-SERVICE-CHARGE',
    ],
  },
  {
    code: 'ARTISAN_CRAFT',
    label: 'Artisan / Craftsman / Tailor / Welder / Carpenter',
    hausa: "Sana'ar Hannu",
    // Small-scale trade: Development Levy, Shops & Kiosks if operating from a fixed
    // location, Business Premises (rural if outside Jos city).
    suggestedRevenueCodes: [
      'DEV-LEVY', 'SHOPS-KIOSKS', 'BP-REG-RURAL', 'BP-RENEW-RURAL',
    ],
  },

  // ─── Commerce ────────────────────────────────────────────────────────────
  {
    code: 'RETAIL_TRADE',
    label: 'Retail Trader / Market Seller / Shop Owner',
    hausa: 'Kasuwanci',
    // Market Levy for market-based trading, Shops & Kiosks for fixed premises,
    // Business Premises Registration (rural if in LGA market, urban if in Jos).
    suggestedRevenueCodes: [
      'DEV-LEVY', 'MARKET-LEVY', 'SHOPS-KIOSKS',
      'BP-REG-RURAL', 'BP-RENEW-RURAL',
    ],
  },
  {
    code: 'WHOLESALE_TRADE',
    label: 'Wholesale Dealer / Distributor / Importer',
    hausa: 'Manya-manya Kasuwanci',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'SHOPS-KIOSKS', 'ECON-DEV-LEVY',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'FOOD_BEVERAGE',
    label: 'Food Seller / Restaurant / Canteen / Caterer',
    hausa: 'Abinci da Sha',
    // Hotels/restaurants pay Consumption Tax under Plateau State law.
    // Fire Service Charge for cooking establishments. Shops & Kiosks for fixed spots.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'CONSUMPTION-TAX', 'FIRE-SERVICE-CHARGE',
      'SHOPS-KIOSKS', 'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'HOTEL_HOSPITALITY',
    label: 'Hotel / Guest House / Lodging / Event Centre',
    hausa: 'Masauki',
    // Full Consumption Tax on room nights and F&B, Entertainment Tax on live events,
    // Fire Service mandatory for lodging, Signage Fee for billboards.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'CONSUMPTION-TAX', 'ENTERTAINMENT-TAX',
      'FIRE-SERVICE-CHARGE', 'SIGNAGE-FEE',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },

  // ─── Transport ───────────────────────────────────────────────────────────
  {
    code: 'TRANSPORT_PASSENGER',
    label: 'Passenger Transport / Taxi / Okada / Keke Napep',
    hausa: 'Sufurin Mutane (Mota, Okada, Keke)',
    // Motor Park Levy collected daily at designated parks. Road Tax. Vehicle renewal.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'MOTOR-PARK-LEVY', 'ROAD-TAX', 'VEH-RENEW-COMMERCIAL',
    ],
  },
  {
    code: 'TRANSPORT_HAULAGE',
    label: 'Haulage / Freight Truck / Logistics',
    hausa: 'Hanyar Kaya',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'ROAD-TAX', 'VEH-RENEW-COMMERCIAL', 'ECON-DEV-LEVY',
    ],
  },
  {
    code: 'MOTOR_VEHICLE',
    label: 'Vehicle Dealer / Auto Parts / Mechanic Garage',
    hausa: 'Sayar da Motoci / Gyaran Mota',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'ROAD-TAX', 'VEH-RENEW-COMMERCIAL',
      'SIGNAGE-FEE', 'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },

  // ─── Services ────────────────────────────────────────────────────────────
  {
    code: 'ICT_TELECOMS',
    label: 'ICT / Telecoms / Cybercafé / Printing / Media',
    hausa: 'Fasahar Sadarwa',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'ECON-DEV-LEVY', 'SIGNAGE-FEE',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'FINANCIAL_SERVICES',
    label: 'Banking / Finance / Insurance / Cooperative / Microfinance',
    hausa: 'Banki da Inshora',
    // Stamp Duties on instruments (individual or group transactions).
    suggestedRevenueCodes: [
      'DEV-LEVY', 'PIT-STAMP', 'ECON-DEV-LEVY',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'PROFESSIONAL_SERVICES',
    label: 'Professional / Lawyer / Doctor / Consultant / Accountant',
    hausa: "Sana'ar Kwararru",
    // Self-employed professionals file annual Direct Assessment. WHT deducted
    // from fees received from companies. Stamp Duties on professional instruments.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'PIT-DIRECT', 'PIT-WHT', 'PIT-STAMP', 'ROAD-TAX',
    ],
  },
  {
    code: 'HEALTHCARE',
    label: 'Hospital / Clinic / Pharmacy / Laboratory / Optician',
    hausa: 'Lafiya',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'FIRE-SERVICE-CHARGE', 'ECON-DEV-LEVY',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'EDUCATION',
    label: 'Private School / Nursery / Vocational Training / Tutoring',
    hausa: 'Makaranta / Ilimi',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'INFRA-LEVY', 'FIRE-SERVICE-CHARGE',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'ENTERTAINMENT_ARTS',
    label: 'Entertainment / Events / Arts / Photography / Salon / Barber',
    hausa: 'Nishadì / Fasaha',
    // Entertainment Tax on shows/events. Signage for outdoor promotions.
    suggestedRevenueCodes: [
      'DEV-LEVY', 'ENTERTAINMENT-TAX', 'SIGNAGE-FEE',
      'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },
  {
    code: 'GAMING_BETTING',
    label: 'Betting Shop / Gaming / Pool / Lottery',
    hausa: 'Caca / Lottery',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'GAMING-TAX', 'BP-REG-URBAN', 'BP-RENEW-URBAN',
    ],
  },

  // ─── Real property ───────────────────────────────────────────────────────
  {
    code: 'REAL_PROPERTY',
    label: 'Landlord / Property Owner / Estate Developer',
    hausa: 'Hayar Gida / Mai Gidaje',
    suggestedRevenueCodes: [
      'DEV-LEVY', 'PROPERTY-TAX', 'TENEMENT-RATES',
      'LAND-USE-CHARGE', 'RIGHT-OCCUPANCY',
    ],
  },

  // ─── Employment ──────────────────────────────────────────────────────────
  {
    code: 'CIVIL_SERVANT',
    label: 'Civil Servant / Government Employee (Plateau State)',
    hausa: "Ma'aikacin Gwamnati",
    // PAYE deducted by employer and remitted to PSIRS. Dev Levy also applicable.
    suggestedRevenueCodes: ['DEV-LEVY', 'PIT-PAYE'],
  },
  {
    code: 'PRIVATE_EMPLOYEE',
    label: 'Private Sector Employee (Formal Employment)',
    hausa: "Ma'aikacin Kamfani",
    // PAYE deducted by employer. WHT may apply to investment income.
    suggestedRevenueCodes: ['DEV-LEVY', 'PIT-PAYE', 'PIT-WHT'],
  },
  {
    code: 'SELF_EMPLOYED',
    label: 'Self-Employed / Freelancer (No fixed employer)',
    hausa: "Mai Sana'a",
    // Files annual Direct Assessment return by March 31.
    suggestedRevenueCodes: ['DEV-LEVY', 'PIT-DIRECT', 'ROAD-TAX'],
  },

  // ─── Non-profit / social ─────────────────────────────────────────────────
  {
    code: 'RELIGIOUS_NGO',
    label: 'Religious Organisation / NGO / Community Group',
    hausa: 'Addini / Agaji / \'Yan Uwa',
    // Generally exempt from income tax but Development Levy still applies to
    // individual members and staff. Staff pay PAYE through the organisation.
    suggestedRevenueCodes: ['DEV-LEVY'],
  },

  // ─── Informal economy ────────────────────────────────────────────────────
  {
    code: 'INFORMAL_WORKER',
    label: 'Informal / Casual / Daily-Wage Worker',
    hausa: "Ma'aikacin Yau da Kullum",
    suggestedRevenueCodes: ['DEV-LEVY'],
  },
  {
    code: 'STUDENT_UNEMPLOYED',
    label: 'Student / Unemployed / Dependent',
    hausa: "Ɗalibi / Marasa Aiki",
    suggestedRevenueCodes: ['DEV-LEVY'],
  },
  {
    code: 'OTHER',
    label: 'Other / Not Listed Above',
    hausa: 'Wasu',
    suggestedRevenueCodes: ['DEV-LEVY'],
  },
] as const;

export type EconomicSectorCode = (typeof ECONOMIC_SECTORS)[number]['code'];

/**
 * The sector codes alone, derived rather than retyped.
 *
 * Needed as a plain tuple for request validation. Deriving it means a sector
 * added to the list above is accepted by the API without a second edit — the
 * database CHECK and this list having drifted apart once already is what makes
 * a second hand-maintained copy a bad idea.
 */
export const ECONOMIC_SECTOR_CODES = ECONOMIC_SECTORS.map((s) => s.code) as unknown as [
  EconomicSectorCode,
  ...EconomicSectorCode[],
];

export function sectorByCode(code: string): EconomicSectorDefinition | undefined {
  return ECONOMIC_SECTORS.find((s) => s.code === code);
}
