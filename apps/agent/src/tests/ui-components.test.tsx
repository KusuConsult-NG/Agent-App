/**
 * In-Depth UI Component & Screen Interaction Tests for Agent Mobile PWA.
 *
 * Exercises rendering, input events, validation feedback, and state transitions
 * across all major mobile screens.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LoginScreen, ApplyScreen } from '../screens/Auth';
import { HomeScreen } from '../screens/Home';
import { VerifyScreen } from '../screens/Verify';
import { api } from '../lib/api';
import { Badge } from '../ui';
import { getTranslation } from '@psirs/shared';

describe('1. Authentication UI Screens (Login & Application)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders login form with required phone and password fields', () => {
    const onSignedIn = vi.fn();
    const onApply = vi.fn();
    render(<LoginScreen onSignedIn={onSignedIn} onApply={onApply} />);

    expect(screen.getByText(/Plateau State Revenue Agent/i)).toBeTruthy();
    expect(screen.getByLabelText(/Phone number/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeTruthy();
  });

  it('navigates to apply screen when clicking candidate agent registration link', () => {
    const onSignedIn = vi.fn();
    const onApply = vi.fn();
    render(<LoginScreen onSignedIn={onSignedIn} onApply={onApply} />);

    const applyButton = screen.getByRole('button', { name: /Apply to become an agent/i });
    fireEvent.click(applyButton);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('renders agent application form with personal and referee requirements', () => {
    const onDone = vi.fn();
    render(<ApplyScreen onDone={onDone} />);

    expect(screen.getByText(/Apply to become a revenue agent/i)).toBeTruthy();
    expect(screen.getByLabelText(/Full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Bank name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Account number/i)).toBeTruthy();
  });
});

describe('2. Home Dashboard & Quick Actions', () => {
  beforeEach(() => {
    cleanup();
    vi.spyOn(api, 'get').mockResolvedValue({
      today: { collected_kobo: '500000', successful: '5', total: '5', pending: '0' },
      commission: { lifetime_kobo: '25000', available_kobo: '15000', today_kobo: '7500' },
      taxpayersOnboarded: { today: '3', total: '24' },
      recentTransactions: [],
    });
  });

  it('renders home screen navigation cards for all core civic workflows', async () => {
    const navigate = vi.fn();
    render(<HomeScreen navigate={navigate} />);

    expect(await screen.findByText(/Register taxpayer/i)).toBeTruthy();
    expect(screen.getByText(/Collect revenue/i)).toBeTruthy();
    expect(screen.getByText(/Renew vehicle/i)).toBeTruthy();
    expect(screen.getByText(/Find taxpayer/i)).toBeTruthy();
    expect(screen.getByText(/Check a receipt/i)).toBeTruthy();
  });

  it('renders summary metrics for collected revenue and commission', async () => {
    const navigate = vi.fn();
    render(<HomeScreen navigate={navigate} />);

    expect(await screen.findByText(/Collected today/i)).toBeTruthy();
    expect(screen.getByText(/Available for payout/i)).toBeTruthy();
    expect(screen.getByText(/Commission earned/i)).toBeTruthy();
  });
});

describe('3. Public Receipt & Particulars Verification UI', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders verification input with formatting helper and scan button', () => {
    render(<VerifyScreen connection="ONLINE" />);

    expect(screen.getByText(/Check a receipt/i)).toBeTruthy();
    const input = screen.getByPlaceholderText(/T7C72-QTUDN/i);
    expect(input).toBeTruthy();

    const scanBtn = screen.getByRole('button', { name: /Scan the QR code/i });
    expect(scanBtn).toBeTruthy();
  });

  it('allows typing verification code and converts to standard uppercase', () => {
    render(<VerifyScreen connection="ONLINE" />);

    const input = screen.getByPlaceholderText(/T7C72-QTUDN/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 't7c72-qtudn' } });
    expect(input.value).toBe('T7C72-QTUDN');
  });
});

describe('4. Grassroots Localisation (Hausa & English i18n)', () => {
  it('provides complete Hausa dictionary matching all primary civic terms', () => {
    const ha = getTranslation('ha');
    expect(ha.payRevenue).toBe('Biyan Haraji');
    expect(ha.receiptNumber).toBe('Lambar Rasit');
    expect(ha.taxpayerTin).toBe('Lambar Shaida ta Haraji (TIN)');
    expect(ha.verify).toBe('Tabbatar da Rasit');
    expect(ha.printBluetooth).toContain('Bluetooth');
  });

  it('provides complete English dictionary matching all primary civic terms', () => {
    const en = getTranslation('en');
    expect(en.payRevenue).toBe('Pay Revenue');
    expect(en.receiptNumber).toBe('Receipt Number');
    expect(en.taxpayerTin).toBe('Tax Identification Number (TIN)');
    expect(en.verify).toBe('Verify Receipt');
  });
});

/**
 * The status chip on the handset of the person collecting the money.
 *
 * This app carried its own copy of the portal's classifier and its own copy
 * of the portal's bug: the colour was chosen by asking whether the status
 * *contained* a good-news word, so INACTIVE contained ACTIVE and UNPAID
 * contained PAID. An agent looking at an unpaid invoice saw the colour the
 * app uses for a settled one.
 *
 * Both now go through `statusSeverity` in @psirs/shared, which matches whole
 * words. This holds the agent's end of it — the property itself is tested
 * once, with the function, in the portal suite.
 */
describe('5. A status chip in the colour of what happened', () => {
  beforeEach(() => cleanup());

  it('does not render a negated status as its own opposite', () => {
    render(
      <>
        <Badge status="UNPAID" />
        <Badge status="INACTIVE" />
        <Badge status="UNVERIFIED" />
      </>,
    );

    expect(screen.getByText('UNPAID').className).toContain('badge--pending');
    expect(screen.getByText('INACTIVE').className).toContain('badge--danger');
    expect(screen.getByText('UNVERIFIED').className).toContain('badge--danger');
  });

  it('still renders the good news as good news', () => {
    render(
      <>
        <Badge status="PAID" />
        <Badge status="SYNCED" />
        <Badge status="PENDING_SYNC" />
      </>,
    );

    expect(screen.getByText('PAID').className).toContain('badge--success');
    expect(screen.getByText('SYNCED').className).toContain('badge--success');
    expect(screen.getByText('PENDING SYNC').className).toContain('badge--pending');
  });
});
