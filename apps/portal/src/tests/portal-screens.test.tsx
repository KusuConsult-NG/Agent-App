/**
 * In-Depth UI Component & Screen Interaction Tests for Government Portal.
 *
 * Tests:
 * 1. Login Screen rendering & validation
 * 2. Public Verification Screen (Valid, Voided, Tampered outcomes)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LoginScreen } from '../screens/Login';
import { VerifyScreen } from '../screens/Public';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';
import { getTranslation } from '@psirs/shared';

const en = getTranslation('en');

describe('1. Government Portal Authentication UI', () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('renders government portal sign in form with phone and password inputs', () => {
    const onSignedIn = vi.fn();
    render(<LoginScreen onSignedIn={onSignedIn} />);

    expect(screen.getByText(/PSIRS Revenue Portal/i)).toBeTruthy();
    expect(screen.getByLabelText(/Phone number/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeTruthy();
  });

  it('submits login payload when valid phone and password provided', async () => {
    const onSignedIn = vi.fn();
    const loginSpy = vi.spyOn(apiModule, 'login').mockResolvedValue({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        fullName: 'Admin Officer',
        phone: '+2348000000001',
        email: null,
        role: 'admin',
        permissions: ['*'],
      },
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
    });

    render(<LoginScreen onSignedIn={onSignedIn} />);

    const phoneInput = screen.getByLabelText(/Phone number/i);
    const passInput = screen.getByLabelText(/^Password/i);
    const submitBtn = screen.getByRole('button', { name: /Sign in/i });

    fireEvent.change(phoneInput, { target: { value: '08000000001' } });
    fireEvent.change(passInput, { target: { value: 'Password123' } });
    fireEvent.click(submitBtn);

    expect(loginSpy).toHaveBeenCalledWith('08000000001', 'Password123');
  });
});

describe('2. Public Receipt & Particulars Verification Portal', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders public lookup interface with search input and guidance', () => {
    render(<VerifyScreen code="" />);

    expect(screen.getByText(/Verify a government receipt/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/PSIRS\/2026\/000123/i)).toBeTruthy();
  });

  it('displays genuine verification badge when receipt is verified and valid', async () => {
    vi.spyOn(apiModule.api, 'publicGet').mockResolvedValue({
      status: 'VALID',
      receiptNumber: 'PSIRS/2026/000001',
      revenueType: 'Development Levy',
      amountKobo: '200000',
      issuedAt: '2026-08-18T12:00:00.000Z',
      lga: 'Jos North',
      integrityConfirmed: true,
      reason: 'RECEIPT_GENUINE',
      message: 'This is a genuine government receipt issued by PSIRS.',
    });

    render(<VerifyScreen code="T7C72-QTUDN" />);

    expect(await screen.findByText(/This is a genuine government receipt issued by PSIRS\./i)).toBeTruthy();
    expect(screen.getByText(/PSIRS\/2026\/000001/i)).toBeTruthy();
    expect(screen.getByText(/Development Levy/i)).toBeTruthy();
  });

  it('does not let an acknowledgement read as a paid receipt at a glance', async () => {
    /*
     * The verdict is a large green tick and one word. A market trader, a
     * checkpoint officer or the taxpayer reads that mark and stops; the
     * paragraph underneath it is for the people who do not. So the mark itself
     * has to say which of the two documents this is, or an acknowledgement is
     * a receipt to everybody who glances at it \u2014 which is the confusion the
     * document exists to prevent.
     */
    vi.spyOn(apiModule.api, 'publicGet').mockResolvedValue({
      status: 'VALID',
      documentNumber: 'PSIRS-ACK/2026/000008',
      documentType: 'PAYMENT_ACKNOWLEDGEMENT',
      issuedAt: '2026-08-27T10:00:36.396Z',
      integrityConfirmed: true,
      reason: 'ACKNOWLEDGEMENT_NOT_RECEIPT',
      message:
        'This is a genuine PSIRS acknowledgement of payment, and it is NOT a government receipt.',
    });

    render(<VerifyScreen code="NA76E-2DC3F" />);

    // The dictionary's wording, not the server's: the screen composes this
    // now, and a test pinned to the API's sentence would pass while the
    // page rendered `undefined`.
    expect(await screen.findByText(new RegExp('NOT a government receipt', 'i'))).toBeTruthy();
    const verdict = document.querySelector('.verdict__label');
    expect(verdict, 'the verdict must be rendered').toBeTruthy();
    expect(
      /not a receipt|acknowledge/i.test(verdict!.textContent ?? ''),
      `the verdict read "${verdict!.textContent}", which a glance takes as paid`,
    ).toBe(true);
  });

  it('does not show a citizen the name of a database column value', async () => {
    /*
     * An acknowledgement has no revenue item, and the row fell back to the
     * document type — which is a `documents.document_type` value, not a
     * sentence. A citizen checking their paper on the State's own website
     * read `PAYMENT_ACKNOWLEDGEMENT`, in capitals, with the underscores in
     * it. Every other enum on this platform reaches a person through
     * `enumLabel`; this one row did not.
     */
    vi.spyOn(apiModule.api, 'publicGet').mockResolvedValue({
      status: 'VALID',
      documentNumber: 'PSIRS-ACK/2026/000008',
      documentType: 'PAYMENT_ACKNOWLEDGEMENT',
      issuedAt: '2026-08-27T10:00:36.396Z',
      integrityConfirmed: true,
      reason: 'ACKNOWLEDGEMENT_NOT_RECEIPT',
      message:
        'This is a genuine PSIRS acknowledgement of payment, and it is NOT a government receipt.',
    });

    render(<VerifyScreen code="NA76E-2DC3F" />);

    await screen.findByText(/PSIRS-ACK\/2026\/000008/);
    expect(
      screen.queryByText(/PAYMENT_ACKNOWLEDGEMENT/),
      'the raw enum value must not appear anywhere on a citizen-facing page',
    ).toBeNull();
    expect(
      screen.getByText(en.enumPaymentAcknowledgement),
      'the document type must be rendered through the enum dictionary',
    ).toBeTruthy();
  });

  it('renders the revenue item in the language the citizen is reading', async () => {
    /*
     * The API sends the revenue item's Hausa name alongside its English one,
     * because the catalogue carries both. This page offers Hausa and was
     * dropping the Hausa name on the floor — so a citizen who had switched
     * the page to Hausa still read the English catalogue entry.
     */
    setPortalLanguage('ha');
    try {
      vi.spyOn(apiModule.api, 'publicGet').mockResolvedValue({
        status: 'VALID',
        receiptNumber: 'PSIRS/2026/000001',
        revenueType: 'Development Levy',
        revenueTypeHa: 'Haraji Ci gaba',
        amountKobo: '250000',
        issuedAt: '2026-08-27T10:00:36.396Z',
        integrityConfirmed: true,
        reason: 'RECEIPT_GENUINE',
        message: 'This is a genuine government receipt issued by PSIRS.',
      });

      render(<VerifyScreen code="T7C72-QTUDN" />);

      expect(await screen.findByText('Haraji Ci gaba')).toBeTruthy();
      expect(
        screen.queryByText('Development Levy'),
        'the English catalogue name must not survive onto a Hausa page',
      ).toBeNull();
    } finally {
      setPortalLanguage('en');
    }
  });

  it('displays warning alert when receipt was revoked or voided', async () => {
    vi.spyOn(apiModule.api, 'publicGet').mockResolvedValue({
      status: 'REVERSED',
      receiptNumber: 'PSIRS/2026/000002',
      revenueType: 'Signage Levy',
      amountKobo: '500000',
      reason: 'RECEIPT_REVERSED',
      message: 'This receipt was issued but the payment has since been reversed or refunded.',
    });

    render(<VerifyScreen code="VOIDED-CODE" />);

    expect(await screen.findByText(/This receipt was issued but the payment has since been reversed or refunded\./i)).toBeTruthy();
  });
});
