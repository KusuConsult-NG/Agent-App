/**
 * PDF generation and document registration (PRD §19, §22, §23, §64).
 *
 * Every issued document gets:
 *   * a unique document number and verification code,
 *   * a QR code encoding the public verification URL,
 *   * a SHA-256 checksum of the exact bytes stored.
 *
 * The checksum is what makes PRD §23's "documents must not be silently editable
 * after issuance" checkable rather than aspirational: verification recomputes
 * the digest of the stored file and compares it with the value recorded at
 * issuance, and the documents table forbids updating either.
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { PoolClient } from 'pg';
import { formatNaira, type Kobo } from '@psirs/shared';
import { config } from '../config';
import { verificationUrl as publicVerificationUrl } from '../lib/public-urls';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { queryOne } from '../db/pool';
import { generateVerificationCode } from '../lib/crypto';
import { nextDocumentNumber } from '../lib/references';
import { storage } from './storage';

const COLOURS = {
  ink: '#12211a',
  muted: '#5b6b63',
  rule: '#c9d6cf',
  accent: '#0b6b3a', // Plateau State green
  danger: '#9c2a2a',
} as const;


/**
 * The faces every document is drawn with.
 *
 * PDFKit's built-in fonts are the base-14 Type 1 faces. They use WinAnsi
 * encoding, which has no ₦ (U+20A6), so every amount on every receipt, invoice
 * and certificate rendered with a broken character where the currency should
 * be — on documents whose whole purpose is to be trustworthy evidence that a
 * citizen paid government revenue.
 *
 * Liberation Sans is bundled rather than taken from the host, because a
 * deployed container is not guaranteed to carry it and the failure would be
 * silent in the same way: a receipt that renders, and is wrong. It is metrically
 * compatible with Helvetica, so the layouts written against Helvetica's metrics
 * are unchanged. See assets/fonts/README.md for the licence.
 */
/**
 * Compiled output sits at dist/services and source at src/services, so the
 * fonts are looked for in both places rather than assuming one layout. The
 * build copies them into dist; running from source finds them at the package
 * root. Whichever is found first is used, and finding neither is fatal.
 */
function fontDir(): string {
  const candidates = [
    join(__dirname, '..', 'assets', 'fonts'), // dist/assets/fonts
    join(__dirname, '..', '..', 'assets', 'fonts'), // apps/api/assets/fonts
  ];
  return candidates.find((path) => existsSync(join(path, 'LiberationSans-Regular.ttf'))) ?? candidates[0]!;
}

const FONTS = () => {
  const dir = fontDir();
  return {
    regular: join(dir, 'LiberationSans-Regular.ttf'),
    bold: join(dir, 'LiberationSans-Bold.ttf'),
  };
};

/** Names registered on each document; used everywhere Helvetica once was. */
export const BODY_FONT = 'PSIRS-Sans';
export const BOLD_FONT = 'PSIRS-Sans-Bold';

function registerFonts(doc: PDFKit.PDFDocument): void {
  // Fail loudly at the first document rather than emitting a broken one: a
  // build that did not carry the fonts must not quietly fall back to a face
  // that cannot spell the currency.
  const fonts = FONTS();
  for (const path of Object.values(fonts)) {
    if (!existsSync(path)) {
      throw new Error(
        `Document font missing at ${path}. The build did not include assets/fonts — ` +
          'refusing to issue a document that cannot render the naira sign.',
      );
    }
  }
  doc.registerFont(BODY_FONT, fonts.regular);
  doc.registerFont(BOLD_FONT, fonts.bold);
  doc.font(BODY_FONT);
}

async function renderPdf(build: (doc: PDFKit.PDFDocument) => void | Promise<void>): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Producer: 'PSIRS Revenue Platform' } });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  await build(doc);
  doc.end();
  return finished;
}

async function qrDataUrl(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string): void {
  doc
    .fillColor(COLOURS.accent)
    .fontSize(16)
    .font(BOLD_FONT)
    .text(config.branding.stateName.toUpperCase(), { align: 'center' })
    .fillColor(COLOURS.ink)
    .fontSize(12)
    .text(config.branding.agencyName, { align: 'center' })
    .fillColor(COLOURS.muted)
    .fontSize(8)
    .font(BODY_FONT)
    .text(config.branding.motto, { align: 'center' });

  doc.moveDown(0.8);
  doc
    .strokeColor(COLOURS.accent)
    .lineWidth(2)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();

  doc.moveDown(0.8);
  doc
    .fillColor(COLOURS.ink)
    .fontSize(15)
    .font(BOLD_FONT)
    .text(title, { align: 'center' })
    .fontSize(9)
    .font(BODY_FONT)
    .fillColor(COLOURS.muted)
    .text(subtitle, { align: 'center' });
  doc.moveDown(1);
}

function fieldTable(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const labelWidth = width * 0.38;

  for (const [label, value] of rows) {
    const y = doc.y;
    doc
      .fontSize(9)
      .font(BODY_FONT)
      .fillColor(COLOURS.muted)
      .text(label, left, y, { width: labelWidth });
    doc
      .fontSize(10)
      .font(BOLD_FONT)
      .fillColor(COLOURS.ink)
      .text(value || '—', left + labelWidth, y, { width: width - labelWidth });
    doc.moveDown(0.35);
  }
}

function footer(doc: PDFKit.PDFDocument, verificationUrl: string, note: string): void {
  const y = doc.page.height - doc.page.margins.bottom - 46;
  doc
    .strokeColor(COLOURS.rule)
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc
    .fontSize(7.5)
    .font(BODY_FONT)
    .fillColor(COLOURS.muted)
    .text(note, doc.page.margins.left, y + 8, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
    })
    .text(`Verify at ${verificationUrl}`, { align: 'center' });
}

export interface ReceiptPdfData {
  receiptNumber: string;
  transactionReference: string;
  paymentReference: string;
  gatewayReference: string;
  taxpayerName: string;
  tin: string | null;
  revenueCategory: string;
  revenueItem: string;
  mdaName: string | null;
  amountKobo: Kobo;
  serviceChargeKobo: Kobo;
  paymentMethod: string | null;
  paidAt: Date;
  issuedAt: Date;
  periodLabel: string | null;
  agentCode: string | null;
  lgaName: string;
  verificationCode: string;
}

/** PRD §19 — the official government receipt. */
export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const verificationUrl = publicVerificationUrl(data.verificationCode);
  const qr = await qrDataUrl(verificationUrl);

  return renderPdf((doc) => {
    header(doc, 'OFFICIAL REVENUE RECEIPT', 'Evidence of payment of government revenue');

    doc
      .fontSize(20)
      .font(BOLD_FONT)
      .fillColor(COLOURS.accent)
      .text(data.receiptNumber, { align: 'center' });
    doc.moveDown(0.9);

    fieldTable(doc, [
      ['Taxpayer', data.taxpayerName],
      ['Taxpayer Identification Number', data.tin ?? 'Not yet assigned'],
      ['Revenue category', data.revenueCategory],
      ['Revenue item', data.revenueItem],
      ['Collecting MDA', data.mdaName ?? config.branding.agencyName],
      ['Assessment period', data.periodLabel ?? 'Not period-based'],
      ['Local Government Area', data.lgaName],
    ]);

    doc.moveDown(0.5);
    const boxTop = doc.y;
    const boxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc
      .roundedRect(doc.page.margins.left, boxTop, boxWidth, 54, 4)
      .fillAndStroke('#f2f7f4', COLOURS.accent);
    doc
      .fillColor(COLOURS.muted)
      .fontSize(9)
      .font(BODY_FONT)
      .text('AMOUNT PAID TO GOVERNMENT', doc.page.margins.left + 14, boxTop + 10);
    doc
      .fillColor(COLOURS.ink)
      .fontSize(22)
      .font(BOLD_FONT)
      .text(formatNaira(data.amountKobo), doc.page.margins.left + 14, boxTop + 23);
    doc.y = boxTop + 66;

    if (data.serviceChargeKobo > 0n) {
      doc
        .fontSize(9)
        .font(BODY_FONT)
        .fillColor(COLOURS.muted)
        .text(
          `Approved service charge (shown separately, not government revenue): ${formatNaira(
            data.serviceChargeKobo,
          )}`,
        );
      doc.moveDown(0.5);
    }

    fieldTable(doc, [
      ['Transaction reference', data.transactionReference],
      ['Payment reference', data.paymentReference],
      ['Gateway reference', data.gatewayReference],
      ['Payment method', data.paymentMethod ?? 'Not recorded'],
      ['Payment date', data.paidAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
      ['Receipt issued', data.issuedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
      ['Facilitating agent', data.agentCode ?? 'Not agent-assisted'],
      ['Verification code', data.verificationCode],
    ]);

    const qrX = doc.page.width - doc.page.margins.right - 110;
    const qrY = doc.page.height - doc.page.margins.bottom - 175;
    doc.image(qr, qrX, qrY, { width: 110 });
    doc
      .fontSize(7)
      .fillColor(COLOURS.muted)
      .text('Scan to verify', qrX, qrY + 114, { width: 110, align: 'center' });

    footer(
      doc,
      verificationUrl,
      'This receipt is generated automatically by the Plateau State revenue platform after ' +
        'independent confirmation of payment. It is only valid if it verifies successfully.',
    );
  });
}

export interface VehicleDocumentData {
  documentNumber: string;
  registrationNumber: string;
  ownerName: string;
  make: string | null;
  model: string | null;
  chassisNumber: string | null;
  engineNumber: string | null;
  vehicleType: string;
  colour: string | null;
  renewalPeriodMonths: number;
  periodStart: Date;
  expiryDate: Date;
  issuedAt: Date;
  transactionReference: string;
  verificationCode: string;
}

/** PRD §22 — the digital vehicle renewal document. */
export async function renderVehicleDocumentPdf(data: VehicleDocumentData): Promise<Buffer> {
  const verificationUrl = publicVerificationUrl(data.verificationCode);
  const qr = await qrDataUrl(verificationUrl);

  return renderPdf((doc) => {
    header(doc, 'VEHICLE PARTICULARS RENEWAL', 'Digital evidence of vehicle document renewal');

    doc
      .fontSize(20)
      .font(BOLD_FONT)
      .fillColor(COLOURS.accent)
      .text(data.registrationNumber, { align: 'center' })
      .fontSize(10)
      .fillColor(COLOURS.muted)
      .font(BODY_FONT)
      .text(`Document number ${data.documentNumber}`, { align: 'center' });
    doc.moveDown(1);

    fieldTable(doc, [
      ['Registered owner', data.ownerName],
      ['Vehicle', [data.make, data.model].filter(Boolean).join(' ') || 'Not recorded'],
      ['Vehicle type', data.vehicleType],
      ['Colour', data.colour ?? 'Not recorded'],
      ['Chassis number', data.chassisNumber ?? 'Not recorded'],
      ['Engine number', data.engineNumber ?? 'Not recorded'],
      ['Renewal period', `${data.renewalPeriodMonths} month(s)`],
      ['Valid from', data.periodStart.toISOString().slice(0, 10)],
      ['Valid until', data.expiryDate.toISOString().slice(0, 10)],
      ['Transaction reference', data.transactionReference],
      ['Issued', data.issuedAt.toISOString().slice(0, 10)],
      ['Verification code', data.verificationCode],
    ]);

    const qrX = doc.page.width - doc.page.margins.right - 110;
    const qrY = doc.page.height - doc.page.margins.bottom - 175;
    doc.image(qr, qrX, qrY, { width: 110 });
    doc
      .fontSize(7)
      .fillColor(COLOURS.muted)
      .text('Scan to verify', qrX, qrY + 114, { width: 110, align: 'center' });

    footer(
      doc,
      verificationUrl,
      'This document is issued electronically and can be verified independently at any time.',
    );
  });
}

export interface InvoicePdfData {
  invoiceNumber: string;
  assessmentNumber: string;
  taxpayerName: string;
  tin: string | null;
  revenueCategory: string;
  revenueItem: string;
  mdaName: string | null;
  amountKobo: Kobo;
  serviceChargeKobo: Kobo;
  totalKobo: Kobo;
  periodLabel: string | null;
  issuedAt: Date;
  expiresAt: Date | null;
  agentCode: string | null;
  lgaName: string;
  verificationCode: string;
  trace: { step: string; detail: string; amount?: string }[];
}

/** PRD §15 — the invoice the taxpayer sees before paying anything. */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const verificationUrl = publicVerificationUrl(data.verificationCode);
  const qr = await qrDataUrl(verificationUrl);

  return renderPdf((doc) => {
    header(doc, 'REVENUE INVOICE', 'Demand notice — not evidence of payment');

    doc
      .fontSize(18)
      .font(BOLD_FONT)
      .fillColor(COLOURS.accent)
      .text(data.invoiceNumber, { align: 'center' });
    doc.moveDown(0.9);

    fieldTable(doc, [
      ['Taxpayer', data.taxpayerName],
      ['TIN', data.tin ?? 'Not yet assigned'],
      ['Assessment', data.assessmentNumber],
      ['Revenue category', data.revenueCategory],
      ['Revenue item', data.revenueItem],
      ['Collecting MDA', data.mdaName ?? config.branding.agencyName],
      ['Period', data.periodLabel ?? 'Not period-based'],
      ['Local Government Area', data.lgaName],
      ['Issued', data.issuedAt.toISOString().slice(0, 10)],
      ['Valid until', data.expiresAt ? data.expiresAt.toISOString().slice(0, 10) : 'No expiry'],
      ['Facilitating agent', data.agentCode ?? 'Not agent-assisted'],
    ]);

    doc.moveDown(0.6);
    doc.fontSize(10).font(BOLD_FONT).fillColor(COLOURS.ink).text('How this amount was calculated');
    doc.moveDown(0.3);
    for (const step of data.trace) {
      doc
        .fontSize(8.5)
        .font(BODY_FONT)
        .fillColor(COLOURS.muted)
        .text(
          `${step.step}: ${step.detail}${step.amount ? `  =  ${formatNaira(BigInt(step.amount))}` : ''}`,
        );
    }

    doc.moveDown(0.8);
    fieldTable(doc, [
      ['Government revenue', formatNaira(data.amountKobo)],
      ...(data.serviceChargeKobo > 0n
        ? ([['Approved service charge', formatNaira(data.serviceChargeKobo)]] as [string, string][])
        : []),
      ['Total payable', formatNaira(data.totalKobo)],
    ]);

    const qrX = doc.page.width - doc.page.margins.right - 100;
    const qrY = doc.page.height - doc.page.margins.bottom - 160;
    doc.image(qr, qrX, qrY, { width: 100 });

    footer(
      doc,
      verificationUrl,
      'Payment must be made through an approved government channel. ' +
        'Never pay government revenue in cash to an agent.',
    );
  });
}

export interface RegisterDocumentParams {
  documentType: 'RECEIPT' | 'INVOICE' | 'ASSESSMENT' | 'VEHICLE_RENEWAL' | 'TIN_CONFIRMATION' | 'PAYMENT_EVIDENCE';
  ownerType: 'TAXPAYER' | 'AGENT' | 'VEHICLE';
  ownerId: string;
  entityType?: string;
  entityId?: string;
  bytes: Buffer;
  verificationCode?: string;
  numberPrefix: string;
  expiresAt?: Date | null;
}

/** Persist rendered bytes and register the immutable document row. */
export async function registerDocument(
  client: PoolClient,
  params: RegisterDocumentParams,
): Promise<{ documentId: string; documentNumber: string; verificationCode: string; checksum: string }> {
  const documentNumber = await nextDocumentNumber(client, params.numberPrefix);
  const verificationCode = params.verificationCode ?? generateVerificationCode();
  const key = `${params.documentType.toLowerCase()}/${new Date().getUTCFullYear()}/${documentNumber.replace(
    /[/]/g,
    '-',
  )}.pdf`;

  const stored = await storage.put(key, params.bytes, 'application/pdf');

  const row = await queryOne<{ id: string }>(
    client,
    `INSERT INTO documents (
       document_number, document_type, owner_type, owner_id, entity_type, entity_id,
       storage_reference, content_type, byte_size, checksum, verification_code,
       issuing_authority, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'application/pdf',$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      documentNumber,
      params.documentType,
      params.ownerType,
      params.ownerId,
      params.entityType ?? null,
      params.entityId ?? null,
      stored.storageReference,
      stored.byteSize,
      stored.checksum,
      verificationCode,
      config.branding.agencyName,
      params.expiresAt ?? null,
    ],
  );

  return {
    documentId: row!.id,
    documentNumber,
    verificationCode,
    checksum: stored.checksum,
  };
}

/** What a checksum comparison can honestly conclude. */
export type IntegrityOutcome = 'MATCHED' | 'MISMATCHED' | 'UNAVAILABLE';

/**
 * Confirm a stored document still matches the checksum recorded at issuance.
 * A mismatch means the bytes were changed after issue (PRD §23).
 *
 * Three outcomes, not two. This returned a boolean, and the storage driver
 * throws when a bucket is unreachable exactly as readily as when a file has
 * been altered — so every failure to *reach* the bytes was reported as a
 * failure to *match* them. A storage outage told every citizen in the state
 * that their genuine receipt did not match its fingerprint and to report it to
 * PSIRS. UNAVAILABLE is not a lesser MISMATCHED; it is the absence of a
 * comparison, and the caller has to say so rather than allege one.
 */
export async function verifyDocumentIntegrity(
  storageReference: string,
  expectedChecksum: string,
): Promise<IntegrityOutcome> {
  let bytes: Buffer;
  try {
    bytes = await storage.get(storageReference);
  } catch {
    return 'UNAVAILABLE';
  }
  return createHash('sha256').update(bytes).digest('hex') === expectedChecksum
    ? 'MATCHED'
    : 'MISMATCHED';
}
