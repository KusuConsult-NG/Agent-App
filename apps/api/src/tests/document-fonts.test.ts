/**
 * The naira sign renders on every document the platform issues.
 *
 * PDFKit's built-in faces are the base-14 Type 1 fonts. They use WinAnsi
 * encoding, which has no ₦ (U+20A6), so the amount line on every receipt,
 * invoice and vehicle certificate came out as a broken character:
 *
 *     AMOUNT PAID TO GOVERNMENT
 *     |3,000.00
 *
 * Seen only by opening a generated receipt and looking at it. The document
 * renders — it is simply wrong, on the one line that matters most, on the
 * artefact whose whole purpose is to be trustworthy evidence that a citizen
 * paid government revenue.
 *
 * These tests check the property rather than the appearance: the bundled font
 * really does carry the glyph (its cmap table is parsed, not trusted), the
 * build really does carry the font, and a generated PDF really does embed it.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderReceiptPdf } from '../services/documents';

const API_ROOT = join(__dirname, '..', '..');
const FONT_DIR = join(API_ROOT, 'assets', 'fonts');
const NAIRA = 0x20a6;

/**
 * Does this TrueType file contain a glyph for `codepoint`?
 *
 * The character map is read out of the file rather than the font being taken
 * on trust, because "we shipped a font" and "the amount can be printed" are
 * different claims and only the second one matters.
 */
function hasGlyph(file: string, codepoint: number): boolean {
  const font = readFileSync(file);
  const tableCount = font.readUInt16BE(4);

  let cmapOffset = 0;
  for (let i = 0; i < tableCount; i += 1) {
    const record = 12 + i * 16;
    if (font.toString('ascii', record, record + 4) === 'cmap') {
      cmapOffset = font.readUInt32BE(record + 8);
    }
  }
  if (!cmapOffset) return false;

  const subtables = font.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < subtables; i += 1) {
    const subtable = cmapOffset + font.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
    const format = font.readUInt16BE(subtable);

    if (format === 4) {
      const segmentsX2 = font.readUInt16BE(subtable + 6);
      const endCodes = subtable + 14;
      const startCodes = endCodes + segmentsX2 + 2;
      for (let segment = 0; segment < segmentsX2 / 2; segment += 1) {
        const end = font.readUInt16BE(endCodes + segment * 2);
        const start = font.readUInt16BE(startCodes + segment * 2);
        if (codepoint >= start && codepoint <= end) return true;
      }
    } else if (format === 12) {
      const groups = font.readUInt32BE(subtable + 12);
      for (let group = 0; group < groups; group += 1) {
        const record = subtable + 16 + group * 12;
        if (codepoint >= font.readUInt32BE(record) && codepoint <= font.readUInt32BE(record + 4)) {
          return true;
        }
      }
    }
  }
  return false;
}

describe('Documents can print the currency they are denominated in', () => {
  it('bundles the fonts the renderer asks for', () => {
    assert.ok(existsSync(FONT_DIR), `no font directory at ${FONT_DIR}`);
    const fonts = readdirSync(FONT_DIR).filter((name) => name.endsWith('.ttf'));
    assert.deepEqual(
      fonts.sort(),
      ['LiberationSans-Bold.ttf', 'LiberationSans-Regular.ttf'],
      'documents.ts registers exactly these two faces',
    );
  });

  it('bundles fonts that actually have a naira glyph', () => {
    for (const name of readdirSync(FONT_DIR).filter((file) => file.endsWith('.ttf'))) {
      assert.ok(
        hasGlyph(join(FONT_DIR, name), NAIRA),
        `${name} has no glyph for ₦ (U+20A6) — every amount would print as a broken character`,
      );
    }
  });

  it('embeds the bundled font in a generated receipt, and prints the sign', async () => {
    // Rendered through the real code path, so this fails if the renderer ever
    // goes back to a built-in face.
    const pdf = await renderReceiptPdf({
      receiptNumber: 'PSIRS/2026/000001',
      verificationCode: 'T7C72-QTUDN',
      taxpayerName: 'Ngozi Dashe',
      tin: null,
      revenueItem: 'Shops and Kiosks Rates',
      revenueCategory: 'Local Government Rates and Fees',
      lgaName: 'Bokkos',
      amountKobo: 300000n,
      serviceChargeKobo: 0n,
      transactionReference: 'TXN-2026-000003',
      paymentReference: 'PSIRSPAY-2026-000004-6094',
      gatewayReference: 'MOCKGW-B491772BFBC84318',
      paymentMethod: null,
      paidAt: new Date('2026-08-17T22:49:49Z'),
      issuedAt: new Date('2026-08-17T22:49:49Z'),
      agentCode: 'AGT-00001',
      mdaName: 'Plateau State Internal Revenue Service',
      periodLabel: null,
    });

    assert.ok(pdf.length > 1000, 'a receipt was produced');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

    // An embedded subset carries the family name in its font descriptor; a
    // built-in face would name Helvetica instead.
    const raw = pdf.toString('latin1');
    assert.match(
      raw,
      /LiberationSans/,
      'the receipt does not embed the bundled font — the naira sign will not print',
    );
    assert.ok(
      !/BaseFont\s*\/Helvetica/.test(raw),
      'the receipt still falls back to Helvetica, which cannot spell ₦',
    );
  });
});
