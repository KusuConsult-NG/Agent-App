/**
 * Government receipts, and the acknowledgement that precedes one
 * (PRD §19, §20, §43).
 *
 * A receipt asserts that the Plateau State Government received the money, so it
 * is issued only once that is true: `issueReceipt` is called from exactly one
 * place — the settlement branch of `settleLinkedTransactions` — and even then
 * the database trigger `receipts_require_verified_payment` re-checks that the
 * payment is VERIFIED, that it carries a `settlement_id`, that it belongs to the
 * transaction and that it matches the amount. There is no API route, admin
 * screen or service function that issues a receipt on request.
 *
 * It used to be issued when the *gateway* confirmed, which is a different fact:
 * the gateway holding the money is not the State having been paid. What the
 * taxpayer gets at that moment is `issueAcknowledgement` below — a verifiable
 * document that says the payment is confirmed, that the State has not yet
 * received it, and that a receipt follows.
 */

import type { PoolClient } from 'pg';
import { parseKobo } from '@psirs/shared';
import type { Db } from '../db/pool';
import { queryOne, query } from '../db/pool';
import { generateVerificationCode, hashIdentityNumber, normaliseVerificationCode } from '../lib/crypto';
import { nextReceiptNumber } from '../lib/references';
import { notFound } from '../lib/errors';
import {
  registerDocument,
  renderAcknowledgementPdf,
  renderReceiptPdf,
  verifyDocumentIntegrity,
} from './documents';

export interface IssuedReceipt {
  receiptId: string;
  receiptNumber: string;
  documentId: string;
  verificationCode: string;
}

export async function issueReceipt(
  client: PoolClient,
  params: { transactionId: string; paymentId: string; actorId?: string | null },
): Promise<IssuedReceipt> {
  const existing = await queryOne<{ id: string; receipt_number: string; document_id: string | null; verification_code: string }>(
    client,
    'SELECT id, receipt_number, document_id, verification_code FROM receipts WHERE transaction_id = $1',
    [params.transactionId],
  );

  if (existing) {
    return {
      receiptId: existing.id,
      receiptNumber: existing.receipt_number,
      documentId: existing.document_id!,
      verificationCode: existing.verification_code,
    };
  }

  const context = await queryOne<{
    transaction_reference: string;
    amount_kobo: string;
    service_charge_kobo: string;
    taxpayer_id: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    tin: string | null;
    revenue_item: string;
    revenue_category: string;
    mda_name: string | null;
    lga_name: string;
    period_label: string | null;
    agent_code: string | null;
    payment_reference: string;
    gateway_reference: string | null;
    payment_method: string | null;
    paid_at: Date | null;
  }>(
    client,
    `SELECT t.transaction_reference, t.amount_kobo, t.service_charge_kobo, t.taxpayer_id,
            tp.first_name, tp.last_name, tp.business_name, tp.tin,
            ri.name AS revenue_item, rc.name AS revenue_category, m.name AS mda_name,
            l.name AS lga_name, a.period_label, ag.agent_code,
            p.payment_reference, p.gateway_reference, p.payment_method, p.paid_at
       FROM transactions t
       JOIN taxpayers tp ON tp.id = t.taxpayer_id
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN revenue_categories rc ON rc.id = ri.category_id
       LEFT JOIN mdas m ON m.id = ri.mda_id
       JOIN lgas l ON l.id = t.lga_id
       JOIN assessments a ON a.id = t.assessment_id
       LEFT JOIN agents ag ON ag.id = t.agent_id
       JOIN payments p ON p.id = $2
      WHERE t.id = $1`,
    [params.transactionId, params.paymentId],
  );

  if (!context) throw notFound('That transaction');

  const receiptNumber = await nextReceiptNumber(client);
  const verificationCode = generateVerificationCode();
  const issuedAt = new Date();

  const taxpayerName =
    context.business_name ?? `${context.first_name ?? ''} ${context.last_name ?? ''}`.trim();

  // The row is inserted first. If the trigger refuses — because the payment is
  // not verified — the PDF is never rendered and nothing is stored.
  const receipt = await queryOne<{ id: string }>(
    client,
    `INSERT INTO receipts
       (receipt_number, transaction_id, payment_id, taxpayer_id, amount_kobo,
        verification_code, issued_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'VALID') RETURNING id`,
    [
      receiptNumber,
      params.transactionId,
      params.paymentId,
      context.taxpayer_id,
      context.amount_kobo,
      verificationCode,
      issuedAt,
    ],
  );

  const pdf = await renderReceiptPdf({
    receiptNumber,
    transactionReference: context.transaction_reference,
    paymentReference: context.payment_reference,
    gatewayReference: context.gateway_reference ?? 'Not recorded',
    taxpayerName,
    tin: context.tin,
    revenueCategory: context.revenue_category,
    revenueItem: context.revenue_item,
    mdaName: context.mda_name,
    amountKobo: parseKobo(context.amount_kobo),
    serviceChargeKobo: parseKobo(context.service_charge_kobo),
    paymentMethod: context.payment_method,
    paidAt: context.paid_at ?? issuedAt,
    issuedAt,
    periodLabel: context.period_label,
    agentCode: context.agent_code,
    lgaName: context.lga_name,
    verificationCode,
  });

  const document = await registerDocument(client, {
    documentType: 'RECEIPT',
    ownerType: 'TAXPAYER',
    ownerId: context.taxpayer_id,
    entityType: 'receipt',
    entityId: receipt!.id,
    bytes: pdf,
    verificationCode,
    numberPrefix: 'PSIRS-RCT',
  });

  await client.query('UPDATE receipts SET document_id = $2 WHERE id = $1', [
    receipt!.id,
    document.documentId,
  ]);

  return {
    receiptId: receipt!.id,
    receiptNumber,
    documentId: document.documentId,
    verificationCode,
  };
}

export interface IssuedAcknowledgement {
  documentId: string;
  documentNumber: string;
  verificationCode: string;
}

/**
 * What the taxpayer holds between the gateway confirming and the State being
 * paid.
 *
 * Not a receipt, and built so it cannot be mistaken for one: its own document
 * type, its own number series, its own wording, and a standing notice above the
 * amount saying the money has not reached a government account yet. The
 * alternative was to give a citizen who has just been debited nothing at all,
 * at a market stall, with an agent who has nothing to show them — which is its
 * own way of making the State look like it took the money and denied it.
 *
 * Idempotent by transaction, because a webhook and a status check can both
 * reach the verified branch and neither should mint a second document.
 */
export async function issueAcknowledgement(
  client: PoolClient,
  params: { transactionId: string; paymentId: string },
): Promise<IssuedAcknowledgement> {
  const existing = await queryOne<{
    id: string;
    document_number: string;
    verification_code: string;
  }>(
    client,
    `SELECT id, document_number, verification_code FROM documents
      WHERE document_type = 'PAYMENT_ACKNOWLEDGEMENT' AND entity_type = 'transaction'
        AND entity_id = $1 AND status <> 'REVOKED'`,
    [params.transactionId],
  );
  if (existing) {
    return {
      documentId: existing.id,
      documentNumber: existing.document_number,
      verificationCode: existing.verification_code,
    };
  }

  const context = await queryOne<{
    transaction_reference: string;
    amount_kobo: string;
    service_charge_kobo: string;
    taxpayer_id: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    tin: string | null;
    revenue_item: string;
    revenue_category: string;
    mda_name: string | null;
    lga_name: string;
    period_label: string | null;
    agent_code: string | null;
    payment_reference: string;
    gateway_reference: string | null;
    payment_method: string | null;
    paid_at: Date | null;
  }>(
    client,
    `SELECT t.transaction_reference, t.amount_kobo, t.service_charge_kobo, t.taxpayer_id,
            tp.first_name, tp.last_name, tp.business_name, tp.tin,
            ri.name AS revenue_item, rc.name AS revenue_category, m.name AS mda_name,
            l.name AS lga_name, a.period_label, ag.agent_code,
            p.payment_reference, p.gateway_reference, p.payment_method, p.paid_at
       FROM transactions t
       JOIN taxpayers tp ON tp.id = t.taxpayer_id
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN revenue_categories rc ON rc.id = ri.category_id
       LEFT JOIN mdas m ON m.id = ri.mda_id
       JOIN lgas l ON l.id = t.lga_id
       JOIN assessments a ON a.id = t.assessment_id
       LEFT JOIN agents ag ON ag.id = t.agent_id
       JOIN payments p ON p.id = $2
      WHERE t.id = $1`,
    [params.transactionId, params.paymentId],
  );
  if (!context) throw notFound('That transaction');

  const verificationCode = generateVerificationCode();
  const issuedAt = new Date();
  const taxpayerName =
    context.business_name ?? `${context.first_name ?? ''} ${context.last_name ?? ''}`.trim();

  const pdf = await renderAcknowledgementPdf({
    // The acknowledgement's own number, not a receipt number: receipt numbers
    // are a government series and one must not be spent on a payment that may
    // never arrive.
    receiptNumber: context.transaction_reference,
    transactionReference: context.transaction_reference,
    paymentReference: context.payment_reference,
    gatewayReference: context.gateway_reference ?? 'Not recorded',
    taxpayerName,
    tin: context.tin,
    revenueCategory: context.revenue_category,
    revenueItem: context.revenue_item,
    mdaName: context.mda_name,
    amountKobo: parseKobo(context.amount_kobo),
    serviceChargeKobo: parseKobo(context.service_charge_kobo),
    paymentMethod: context.payment_method,
    paidAt: context.paid_at ?? issuedAt,
    issuedAt,
    periodLabel: context.period_label,
    agentCode: context.agent_code,
    lgaName: context.lga_name,
    verificationCode,
  });

  const document = await registerDocument(client, {
    documentType: 'PAYMENT_ACKNOWLEDGEMENT',
    ownerType: 'TAXPAYER',
    ownerId: context.taxpayer_id,
    entityType: 'transaction',
    entityId: params.transactionId,
    bytes: pdf,
    verificationCode,
    numberPrefix: 'PSIRS-ACK',
  });

  return {
    documentId: document.documentId,
    documentNumber: document.documentNumber,
    verificationCode,
  };
}

export interface PublicVerificationResult {
  status: 'VALID' | 'INVALID' | 'REVERSED' | 'NOT_FOUND';
  /** Deliberately minimal — PRD §20: "Sensitive taxpayer information must not
   *  be exposed publicly." No name, no phone, no address, no TIN. */
  receiptNumber?: string;
  documentNumber?: string;
  documentType?: string;
  revenueType?: string;
  amountKobo?: string;
  issuedAt?: string;
  lga?: string;
  integrityConfirmed?: boolean;
  message: string;
}

/**
 * Public verification (PRD §20, §43) — no login required.
 *
 * Accepts a receipt number, a document number or a verification code. Beyond
 * checking the record exists, it recomputes the stored PDF's checksum so a
 * doctored file is reported as invalid even though the record is genuine.
 *
 * A receipt is two rows — the receipt and the PDF registered beside it — and
 * only the receipt row carries the validity that reversal changes. So the
 * receipt lookup matches the paired document's number as well, and a receipt
 * answers with its own status whichever of its three handles is presented.
 * Reversal revokes the document row too; this is the belt to that brace, so
 * that a future issuing path which forgets to revoke cannot resurrect a
 * reversed receipt by its document number.
 */
export async function verifyPublicly(
  db: Db,
  input: string,
): Promise<PublicVerificationResult> {
  const raw = input.trim();
  const normalised = normaliseVerificationCode(raw);
  // Receipt and document numbers are generated upper case, so comparing the
  // typed value upper-cased is both case-insensitive and still index-friendly.
  // Verification codes were normalised from the start; the numbers beside them
  // were matched byte-for-byte, and a citizen who typed their own receipt
  // number in lower case was told it had not been issued by PSIRS.
  const typed = raw.toUpperCase();

  const receipt = await queryOne<{
    receipt_number: string;
    amount_kobo: string;
    issued_at: Date;
    status: string;
    revenue_item: string;
    lga_name: string;
    storage_reference: string | null;
    checksum: string | null;
    document_number: string | null;
  }>(
    db,
    `SELECT r.receipt_number, r.amount_kobo, r.issued_at, r.status,
            ri.name AS revenue_item, l.name AS lga_name,
            d.storage_reference, d.checksum, d.document_number
       FROM receipts r
       JOIN transactions t ON t.id = r.transaction_id
       JOIN revenue_items ri ON ri.id = t.revenue_item_id
       JOIN lgas l ON l.id = t.lga_id
       LEFT JOIN documents d ON d.id = r.document_id
      WHERE r.receipt_number = $1
         OR d.document_number = $1
         OR replace(upper(r.verification_code), '-', '') = $2`,
    [typed, normalised],
  );

  if (receipt) {
    const integrity =
      receipt.storage_reference && receipt.checksum
        ? await verifyDocumentIntegrity(receipt.storage_reference, receipt.checksum)
        : 'UNAVAILABLE';

    if (receipt.status !== 'VALID') {
      return {
        status: receipt.status === 'REVERSED' || receipt.status === 'REFUNDED' ? 'REVERSED' : 'INVALID',
        receiptNumber: receipt.receipt_number,
        revenueType: receipt.revenue_item,
        amountKobo: receipt.amount_kobo,
        issuedAt: receipt.issued_at.toISOString(),
        lga: receipt.lga_name,
        message:
          receipt.status === 'REVERSED' || receipt.status === 'REFUNDED'
            ? 'This receipt was issued but the payment has since been reversed or refunded. It is no longer valid evidence of payment.'
            : 'This receipt has been voided and is not valid.',
      };
    }

    if (integrity === 'MISMATCHED') {
      return {
        status: 'INVALID',
        receiptNumber: receipt.receipt_number,
        integrityConfirmed: false,
        message:
          'A receipt with this number exists, but the stored document does not match its original ' +
          'fingerprint. Treat the document you were given as unverified and report it to PSIRS.',
      };
    }

    return {
      status: 'VALID',
      receiptNumber: receipt.receipt_number,
      documentNumber: receipt.document_number ?? undefined,
      documentType: 'RECEIPT',
      revenueType: receipt.revenue_item,
      amountKobo: receipt.amount_kobo,
      issuedAt: receipt.issued_at.toISOString(),
      lga: receipt.lga_name,
      integrityConfirmed: integrity === 'MATCHED' ? true : undefined,
      message:
        integrity === 'MATCHED'
          ? 'This is a genuine government receipt issued by PSIRS.'
          : 'This is a genuine government receipt issued by PSIRS. The stored copy could not be ' +
            'checked just now, so its fingerprint has not been confirmed on this attempt.',
    };
  }

  // Other document types — vehicle renewal papers in particular.
  const document = await queryOne<{
    document_number: string;
    document_type: string;
    issued_at: Date;
    expires_at: Date | null;
    status: string;
    storage_reference: string;
    checksum: string;
  }>(
    db,
    `SELECT document_number, document_type, issued_at, expires_at, status,
            storage_reference, checksum
       FROM documents
      WHERE document_number = $1
         OR replace(upper(verification_code), '-', '') = $2`,
    [typed, normalised],
  );

  if (!document) {
    return {
      status: 'NOT_FOUND',
      message:
        'No government document matches that number or code. If you were given a receipt bearing ' +
        'this number, it was not issued by PSIRS.',
    };
  }

  const integrity = await verifyDocumentIntegrity(
    document.storage_reference,
    document.checksum,
  );

  if (document.status === 'REVOKED') {
    return {
      status: 'INVALID',
      documentNumber: document.document_number,
      documentType: document.document_type,
      issuedAt: document.issued_at.toISOString(),
      message: 'This document has been revoked and is no longer valid.',
    };
  }

  const expired = document.expires_at !== null && document.expires_at.getTime() < Date.now();

  if (integrity === 'MISMATCHED') {
    return {
      status: 'INVALID',
      documentNumber: document.document_number,
      documentType: document.document_type,
      issuedAt: document.issued_at.toISOString(),
      integrityConfirmed: false,
      message: 'The stored document does not match its original fingerprint. Report this to PSIRS.',
    };
  }

  /*
   * An acknowledgement is genuine and is not a receipt, and the difference is
   * the entire point of it. Answering with the wording every other document
   * gets — "a genuine government document issued by PSIRS" — is how the person
   * holding it concludes the State has been paid, which is the confusion this
   * document exists to prevent. So it gets its own answer, saying what it is,
   * what it is not, and what happens next.
   */
  if (document.document_type === 'PAYMENT_ACKNOWLEDGEMENT') {
    return {
      status: 'VALID',
      documentNumber: document.document_number,
      documentType: document.document_type,
      issuedAt: document.issued_at.toISOString(),
      integrityConfirmed: integrity === 'MATCHED' ? true : undefined,
      message:
        'This is a genuine PSIRS acknowledgement of payment, and it is NOT a government receipt. ' +
        'The payment system has confirmed the payment; the money has not yet reached the ' +
        'government account. A receipt is issued automatically once it does, and can be checked ' +
        'here in the same way.',
    };
  }

  return {
    status: expired ? 'INVALID' : 'VALID',
    documentNumber: document.document_number,
    documentType: document.document_type,
    issuedAt: document.issued_at.toISOString(),
    integrityConfirmed: integrity === 'MATCHED' ? true : undefined,
    message: expired
      ? `This document expired on ${document.expires_at!.toISOString().slice(0, 10)}.`
      : integrity === 'MATCHED'
        ? 'This is a genuine government document issued by PSIRS.'
        : 'This is a genuine government document issued by PSIRS. The stored copy could not be ' +
          'checked just now, so its fingerprint has not been confirmed on this attempt.',
  };
}

/** Record a public verification attempt (PRD §91 leakage KPI). */
export async function logVerificationAttempt(
  db: Db,
  params: {
    lookupType: 'RECEIPT' | 'DOCUMENT' | 'INVOICE' | 'TAXPAYER';
    lookupValue: string;
    result: 'VALID' | 'INVALID' | 'REVERSED' | 'NOT_FOUND';
    ipAddress?: string | null;
    /**
     * Hash the value instead of storing it.
     *
     * A receipt number is not personal data. A TIN or a phone number is, and a
     * log of who asked about whom would be a new place for it to sit. Hashing
     * keeps the thing this log exists for — the same identifier probed over
     * and over is still the same hash — and makes the log itself worthless to
     * anybody who takes a copy.
     */
    hashValue?: boolean;
  },
): Promise<void> {
  const value = params.hashValue
    ? hashIdentityNumber(params.lookupValue.trim().toUpperCase())
    : params.lookupValue.slice(0, 128);

  await query(
    db,
    `INSERT INTO verification_attempts
       (lookup_type, lookup_value, result, ip_address, lookup_value_hashed)
     VALUES ($1,$2,$3,$4,$5)`,
    [params.lookupType, value, params.result, params.ipAddress ?? null, params.hashValue === true],
  );
}
