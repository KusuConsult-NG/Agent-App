/**
 * Government reference number generation.
 *
 * Every number comes from a PostgreSQL sequence, never from `COUNT(*) + 1`.
 * A count-based scheme races under concurrent load and can reissue a receipt
 * number — precisely the duplicate-receipt problem the platform exists to stop
 * (PRD §31 "Unique receipt numbers", "Receipt numbers cannot be reused").
 *
 * Formats are designed to be read aloud over the phone and quoted on paper:
 *   Receipt      PSIRS/2026/000123
 *   Invoice      INV/2026/000456
 *   Transaction  TXN-2026-000789
 */

import type { Db } from '../db/pool';
import { queryOne } from '../db/pool';

async function nextValue(db: Db, sequence: string): Promise<number> {
  const row = await queryOne<{ value: string }>(db, `SELECT nextval($1) AS value`, [sequence]);
  if (!row) throw new Error(`Sequence ${sequence} produced no value`);
  return Number.parseInt(row.value, 10);
}

function pad(value: number, width = 6): string {
  return value.toString().padStart(width, '0');
}

/**
 * The year component uses the server clock, never a client-supplied date:
 * a field device with a wrong clock must not be able to mint next year's
 * receipt numbers.
 */
function currentYear(): number {
  return new Date().getUTCFullYear();
}

export async function nextReceiptNumber(db: Db): Promise<string> {
  return `PSIRS/${currentYear()}/${pad(await nextValue(db, 'receipt_number_seq'))}`;
}

export async function nextInvoiceNumber(db: Db): Promise<string> {
  return `INV/${currentYear()}/${pad(await nextValue(db, 'invoice_number_seq'))}`;
}

export async function nextAssessmentNumber(db: Db): Promise<string> {
  return `ASM/${currentYear()}/${pad(await nextValue(db, 'assessment_number_seq'))}`;
}

export async function nextTransactionReference(db: Db): Promise<string> {
  return `TXN-${currentYear()}-${pad(await nextValue(db, 'transaction_reference_seq'))}`;
}

export async function nextAgentCode(db: Db): Promise<string> {
  return `AGT-${pad(await nextValue(db, 'agent_code_seq'), 5)}`;
}

export async function nextApplicationNumber(db: Db): Promise<string> {
  return `APP-${currentYear()}-${pad(await nextValue(db, 'application_number_seq'))}`;
}

export async function nextRefereeCode(db: Db): Promise<string> {
  return `REF-${currentYear()}-${pad(await nextValue(db, 'referee_code_seq'))}`;
}

export async function nextDocumentNumber(db: Db, prefix: string): Promise<string> {
  return `${prefix}/${currentYear()}/${pad(await nextValue(db, 'document_number_seq'))}`;
}

export async function nextPayoutReference(db: Db): Promise<string> {
  return `PAY-${currentYear()}-${pad(await nextValue(db, 'payout_reference_seq'))}`;
}

export async function nextTicketNumber(db: Db): Promise<string> {
  return `TKT-${currentYear()}-${pad(await nextValue(db, 'ticket_number_seq'))}`;
}

/** Payment references are per-attempt and include a random suffix so that a
 *  retried attempt is visibly distinct from the original in gateway logs. */
export async function nextPaymentReference(db: Db): Promise<string> {
  const seq = await nextValue(db, 'transaction_reference_seq');
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `PSIRSPAY-${currentYear()}-${pad(seq)}-${suffix}`;
}

export async function nextRefundReference(db: Db): Promise<string> {
  return `RFD-${currentYear()}-${pad(await nextValue(db, 'transaction_reference_seq'))}`;
}

export async function nextSettlementReference(db: Db): Promise<string> {
  return `STL-${currentYear()}-${pad(await nextValue(db, 'payout_reference_seq'))}`;
}
