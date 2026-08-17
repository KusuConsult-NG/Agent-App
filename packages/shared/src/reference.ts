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
