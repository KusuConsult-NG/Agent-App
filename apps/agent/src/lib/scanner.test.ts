/**
 * What a scan is allowed to conclude.
 *
 * The camera itself is exercised in a browser against a fake video device; the
 * part worth unit-testing is the one decision this module makes — which of the
 * strings a QR code might contain is a PSIRS receipt code, and which are not.
 *
 * Getting that wrong in the permissive direction is the dangerous one. A code
 * that is not a receipt code must never be sent to the verification endpoint
 * as though it might be, because the answer would come back "no such receipt"
 * and read, to an agent standing in front of a taxpayer, like a verdict on the
 * piece of paper rather than on a string that was never a receipt code at all.
 */

import { describe, expect, it } from 'vitest';
import { verificationCodeFrom } from './scanner';

describe('verificationCodeFrom', () => {
  it('reads the URL printed on a receipt', () => {
    expect(verificationCodeFrom('http://localhost:5174/#/verify/T7C72-QTUDN')).toBe('T7C72-QTUDN');
    expect(verificationCodeFrom('https://portal.plateau.gov.ng/#/verify/Q9C34-22H2U')).toBe(
      'Q9C34-22H2U',
    );
  });

  it('still reads the path form, for receipts printed before the routing fix', () => {
    // Receipts already in circulation carry the old shape. They are the ones
    // most likely to be presented for checking.
    expect(verificationCodeFrom('https://portal.plateau.gov.ng/verify/T7C72-QTUDN')).toBe(
      'T7C72-QTUDN',
    );
  });

  it('accepts a bare code, typed or scanned', () => {
    expect(verificationCodeFrom('T7C72-QTUDN')).toBe('T7C72-QTUDN');
    expect(verificationCodeFrom('  t7c72-qtudn  ')).toBe('T7C72-QTUDN');
  });

  it('refuses anything that is not a receipt code', () => {
    for (const scanned of [
      '',
      '   ',
      'https://example.com/',
      'https://portal.plateau.gov.ng/#/verify/',
      'WIFI:S=MarketWifi;T=WPA;P=password;;',
      'tel:+2348000000001',
      'T7C72QTUDN',
      'T7C7-QTUDN',
      'T7C72-QTUDNX',
      'PSIRS/2026/000001',
    ]) {
      expect(verificationCodeFrom(scanned), `should refuse ${JSON.stringify(scanned)}`).toBeNull();
    }
  });

  it('refuses the letters the code alphabet leaves out', () => {
    // I and O are excluded so nobody reading a code aloud confuses them with
    // 1 and 0. A code containing them was misread, not issued.
    expect(verificationCodeFrom('T7CI2-QTUDN')).toBeNull();
    expect(verificationCodeFrom('T7C72-QTUDO')).toBeNull();
  });

  it('does not treat a URL from somewhere else as a PSIRS receipt', () => {
    // The shape alone is not authority: this is why a scan asks the server
    // rather than concluding anything itself.
    expect(verificationCodeFrom('https://not-psirs.example/#/verify/T7C72-QTUDN')).toBe(
      'T7C72-QTUDN',
    );
  });
});
