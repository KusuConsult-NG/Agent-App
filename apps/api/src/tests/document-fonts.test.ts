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
 *
 * THE CURRENCY IS NOT THE ONLY THING A DOCUMENT HAS TO SPELL.
 *
 * Every receipt, invoice and certificate carries a taxpayer's name, and a name
 * is free text an agent typed in Plateau State. Written Hausa uses four hooked
 * consonants — ɓ ɗ ƙ ƴ and their capitals — and they are ordinary in names
 * here: Ɗanjuma, Ƙasimu, Ɓala. They sit in Latin Extended-B and IPA
 * Extensions, which plenty of otherwise respectable Latin faces omit.
 *
 * Liberation Sans carries all eight, so nothing is broken today. What was
 * missing is any statement that it must. The reason recorded beside the font
 * choice is the naira sign alone, and this file pinned the naira sign alone —
 * so a future swap to another metrically-compatible face, justified by "it
 * still has ₦", would pass every check here and quietly stop being able to
 * write half the names in the state. The failure would look exactly like the
 * one this file was written for: a document that renders, and is wrong.
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
/**
 * Every character a document must be able to draw, and why.
 *
 * Not an alphabet — the characters whose absence would be silent and would
 * matter. ASCII needs no test; a face that cannot draw `A` fails visibly on
 * the first document.
 */
const MUST_RENDER: [string, number, string][] = [
  ['₦', 0x20a6, 'every amount on every document'],
  ['Ɓ', 0x0181, 'Hausa, capitalised — Ɓala'],
  ['ɓ', 0x0253, 'Hausa'],
  ['Ɗ', 0x018a, 'Hausa, capitalised — Ɗanjuma'],
  ['ɗ', 0x0257, 'Hausa'],
  ['Ƙ', 0x0198, 'Hausa, capitalised — Ƙasimu'],
  ['ƙ', 0x0199, 'Hausa'],
  ['Ƴ', 0x01b3, 'Hausa, capitalised'],
  ['ƴ', 0x01b4, 'Hausa'],
];

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

  it('bundles fonts that can draw every character a document must carry', () => {
    const missing: string[] = [];
    for (const file of readdirSync(FONT_DIR).filter((name) => name.endsWith('.ttf'))) {
      for (const [character, codepoint, why] of MUST_RENDER) {
        if (!hasGlyph(join(FONT_DIR, file), codepoint)) {
          const hex = codepoint.toString(16).toUpperCase().padStart(4, '0');
          missing.push(`${file}: no glyph for ${character} (U+${hex}) — ${why}`);
        }
      }
    }
    assert.deepEqual(
      missing,
      [],
      'a bundled face cannot draw a character every document needs. It would not ' +
        `fail — it would print a broken character:\n  ${missing.join('\n  ')}`,
    );
  });

  it('embeds the bundled font in a generated receipt, and prints the sign', async () => {
    // Rendered through the real code path, so this fails if the renderer ever
    // goes back to a built-in face.
    const pdf = await renderReceiptPdf({
      receiptNumber: 'PSIRS/2026/000001',
      verificationCode: 'T7C72-QTUDN',
      taxpayerName: 'Ɗanjuma Ƙasimu Ɓala',
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
  periodStart: null,
  periodEnd: null,
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
