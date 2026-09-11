/**
 * The one document a citizen takes away, in the language they read.
 *
 * A taxpayer holds no account on this platform. They are approached, they pay,
 * and a printed slip plus an SMS are the only copies of the transaction they
 * ever get. Migration 047 gave `taxpayers` a `preferred_language` for exactly
 * that reason — set by the agent standing in front of them at registration —
 * and the message queue has honoured it ever since.
 *
 * The printed receipt did not. Its template was hardcoded English, and two of
 * its fields were being filled from the *agent's* dictionary, so a
 * Hausa-reading agent printed a Hausa job title onto an English-reading
 * citizen's paper while every label around it stayed English. The receipt was
 * in nobody's language in particular.
 *
 * Two properties are asserted here, and the second is the one that would have
 * failed in a market rather than in CI.
 */

import { describe, it, expect } from 'vitest';
import {
  encodeReceiptEscpos,
  encodeVehicleRenewalEscpos,
  translations,
  type Language,
  type ReceiptPrintData,
} from '@psirs/shared';

const RECEIPT: ReceiptPrintData = {
  receiptNumber: 'PSIRS/2026/000123',
  paymentReference: 'PAY-8842119',
  taxpayerName: 'Sa’idu Dan’azumi',
  taxpayerTin: '841446134',
  taxpayerPhone: '08012345678',
  revenueItemName: 'Market stall levy',
  revenueCategoryName: 'Informal sector',
  amountKobo: '500000',
  paymentMethod: 'POS',
  channel: 'FIELD_AGENT',
  lgaName: 'Jos North',
  wardName: 'Naraguta',
  agentName: 'Ladi Dung',
  agentCode: 'AGT-014',
  issuedAt: '2026-09-09T11:04:22.000Z',
  verificationCode: 'T7C72-QTUDN',
};

const VEHICLE = {
  registrationNumber: 'JOS123AB',
  documentNumber: 'VRN/2026/00044',
  receiptNumber: 'PSIRS/2026/000124',
  ownerName: 'Sa’idu Dan’azumi',
  ownerPhone: '08012345678',
  vehicleMake: 'Toyota',
  vehicleModel: 'Hilux',
  vehicleYear: 2014,
  chassisNumber: 'AHTFR22G80',
  amountKobo: '1500000',
  validFrom: '2026-01-01',
  validUntil: '2026-12-31',
  issuedAt: '2026-09-09T11:04:22.000Z',
  verificationCode: 'T7C72-QTUDN',
};

/** What the printer receives, as lines of text. */
function printed(bytes: Uint8Array): string[] {
  return Array.from(bytes)
    .map((byte) => String.fromCharCode(byte))
    .join('')
    // Strip the ESC/GS control sequences so what is left is what is read.
    .replace(/\x1b[@!aE]?.?/g, '')
    .replace(/\x1dV?A?\x00?/g, '')
    .split('\n');
}

describe('the receipt a citizen keeps', () => {
  it('prints in the taxpayer’s language, not the agent’s', () => {
    const english = printed(encodeReceiptEscpos(RECEIPT, '58mm', 'en')).join('\n');
    const hausa = printed(encodeReceiptEscpos(RECEIPT, '58mm', 'ha')).join('\n');

    expect(english).toContain(translations.en.rcpTitle);
    expect(hausa).toContain(translations.ha.rcpTitle);
    // The Hausa receipt carries none of the English template.
    expect(hausa).not.toContain(translations.en.rcpTitle);
    expect(hausa).not.toContain(translations.en.rcpGovernment);
    expect(hausa).not.toContain('Taxpayer:');
  });

  it('prints the citizen’s name as the citizen’s name, in either language', () => {
    for (const language of ['en', 'ha'] as Language[]) {
      const out = printed(encodeReceiptEscpos(RECEIPT, '58mm', language)).join('\n');
      expect(out).toContain("Sa'idu Dan'azumi");
      expect(out).not.toContain('Sa?idu');
    }
  });

  /**
   * The property that would have failed on paper rather than here.
   *
   * A 58mm roll is thirty-two columns and there is no wrapping — a line longer
   * than that is truncated by the printer, silently, at whatever character
   * falls off the end. Hausa is routinely longer than its English: `Jimlar
   * Kudin da Aka Biya` is twenty-four characters where `Total Paid` is ten. So
   * translating a receipt is not only a translation question, and the width
   * belongs in a test rather than in somebody's judgement.
   *
   * `keyValuePair` already drops a too-long pair onto two lines, which is why
   * this passes; the assertion is here so that a longer label added later
   * fails in CI instead of cutting an amount in half on a market day.
   */
  it('never prints a line wider than the paper', () => {
    const widths = [
      ['58mm', 32],
      ['80mm', 48],
    ] as const;

    const overflowing: string[] = [];
    for (const [paper, columns] of widths) {
      for (const language of ['en', 'ha'] as Language[]) {
        for (const line of printed(encodeReceiptEscpos(RECEIPT, paper, language))) {
          if (line.length > columns) {
            overflowing.push(`receipt ${paper}/${language}: ${line.length} cols: ${line}`);
          }
        }
        for (const line of printed(encodeVehicleRenewalEscpos(VEHICLE, paper, language))) {
          if (line.length > columns) {
            overflowing.push(`vehicle ${paper}/${language}: ${line.length} cols: ${line}`);
          }
        }
      }
    }
    expect(overflowing).toEqual([]);
  });

  it('translates the vehicle clearance too', () => {
    const bytes = encodeVehicleRenewalEscpos(VEHICLE, '58mm', 'ha');
    const out = printed(bytes).join('\n');
    expect(out).toContain(translations.ha.rcpVehTitle);
    expect(out).not.toContain('VEHICLE RENEWAL CLEARANCE');
  });
});
