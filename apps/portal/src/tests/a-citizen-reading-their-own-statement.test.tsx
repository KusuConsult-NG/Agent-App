/**
 * The citizen portal offering somebody their own payment history.
 *
 * The page cannot tell the taxpayer from anybody else who knows their phone
 * number, which is the premise the whole public surface is built on. So the
 * statement is not offered on the strength of having been found — it is
 * offered on the strength of a code sent to the number on the record, and the
 * screen has to say that plainly or the citizen will expect it at the number
 * they typed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CitizenPortalScreen } from '../screens/Public';
import { api } from '../lib/api';
import { setPublicLanguage } from '../lib/i18n';

const FOUND = {
  found: true,
  complianceStatus: 'COMPLIANT',
  tinStatus: 'ISSUED',
  hasOutstanding: false,
  message: 'Your tax records are up to date.',
};

const BY_NAME = { found: true, count: 3, message: '3 records found with a similar name.' };

const STATEMENT = {
  from: '2026-01-01',
  to: '2026-12-31',
  summary: {
    payments: 3,
    totalKobo: '340000',
    returnedKobo: '0',
    byItem: [
      { revenueItem: 'Shops and Kiosks Rates', revenueItemHa: 'Kudin Shago da Rumfa', payments: 1, totalKobo: '300000' },
      { revenueItem: 'Market Tax and Levy', revenueItemHa: null, payments: 2, totalKobo: '40000' },
    ],
  },
  rows: [
    { paidAt: '2026-04-01T09:00:00.000Z', revenueItem: 'Shops and Kiosks Rates',
      revenueItemHa: 'Kudin Shago da Rumfa',
      periodLabel: '2026', amountKobo: '300000', returned: false },
    { paidAt: '2026-03-11T09:00:00.000Z', revenueItem: 'Market Tax and Levy',
      revenueItemHa: null,
      periodLabel: null, amountKobo: '20000', returned: false },
  ],
};

let posted: { path: string; body: any }[] = [];

beforeEach(() => {
  cleanup();
  posted = [];
  vi.spyOn(api, 'publicGet').mockImplementation(async (path: string) =>
    (path.includes('name=') ? BY_NAME : FOUND) as never,
  );
  vi.spyOn(api, 'publicPost').mockImplementation(async (path: string, body?: unknown) => {
    posted.push({ path, body });
    return (path.endsWith('/request') ? { sent: true } : STATEMENT) as never;
  });
});

afterEach(() => {
  setPublicLanguage('en');
  vi.restoreAllMocks();
});

async function lookUp(mode: 'By TIN' | 'By phone' | 'By name', value: string) {
  render(<CitizenPortalScreen />);
  fireEvent.click(screen.getByRole('button', { name: mode }));
  fireEvent.change(screen.getByLabelText(/TIN|phone|name/i), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /Check status/i }));
  await waitFor(() => expect(screen.queryByText(/up to date|records found/i)).toBeTruthy());
}

describe('a citizen reading their own statement', () => {
  it('says the code goes to the number on the record, not the one typed', async () => {
    /*
     * The one thing the citizen must understand before pressing it. A person
     * who types a TIN and expects an SMS at the phone in their hand will
     * conclude the platform is broken when nothing arrives — and a person who
     * typed somebody else's TIN needs to know the code is not coming to them.
     */
    await lookUp('By TIN', '841446134');
    expect(screen.getByText(/never sent to a number typed here/i)).toBeTruthy();
  });

  it('offers nothing to a name search, which found no specific person', async () => {
    await lookUp('By name', 'Amina');
    expect(screen.queryByRole('button', { name: /Send me a code/i })).toBeNull();
  });

  it('asks for the code against the same identifier that was looked up', async () => {
    await lookUp('By TIN', '841446134');
    fireEvent.click(screen.getByRole('button', { name: /Send me a code/i }));

    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]!.path).toBe('/citizen-status/statement/request');
    expect(posted[0]!.body).toEqual({ tin: '841446134' });
  });

  it('will not send a code that is too short to be one', async () => {
    await lookUp('By phone', '08031000011');
    fireEvent.click(screen.getByRole('button', { name: /Send me a code/i }));
    await waitFor(() => expect(screen.getByLabelText(/Code from the SMS/i)).toBeTruthy());

    const show = screen.getByRole('button', { name: /Show my payments/i });
    expect(show).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/Code from the SMS/i), { target: { value: '12' } });
    expect(show).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText(/Code from the SMS/i), { target: { value: '123456' } });
    expect(show).toHaveProperty('disabled', false);
  });

  it('asks for the period before it asks for a code, not after', async () => {
    /*
     * The code is consumed by the statement it opens. A citizen who picked the
     * window afterwards would spend a code discovering they could not change
     * it — so the dates are on the screen before the button that sends one.
     */
    await lookUp('By TIN', '841446134');
    expect(screen.getByLabelText(/^From$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^To$/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Send me a code/i }));
    await waitFor(() => expect(screen.getByLabelText(/Code from the SMS/i)).toBeTruthy());
  });

  it('sends the period the citizen chose', async () => {
    await lookUp('By TIN', '841446134');
    fireEvent.change(screen.getByLabelText(/^From$/i), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText(/^To$/i), { target: { value: '2025-12-31' } });

    fireEvent.click(screen.getByRole('button', { name: /Send me a code/i }));
    await waitFor(() => expect(screen.getByLabelText(/Code from the SMS/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Code from the SMS/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Show my payments/i }));

    await waitFor(() => {
      const shown = posted.find((entry) => entry.path === '/citizen-status/statement');
      expect(shown!.body).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    });
  });

  it('will not spend a code on a period that runs backwards', async () => {
    /*
     * The server refuses it too, but by then the code is gone. Saying so here
     * costs the citizen nothing; learning it from a 400 costs them an SMS and
     * a second wait.
     */
    await lookUp('By TIN', '841446134');
    fireEvent.change(screen.getByLabelText(/^From$/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/^To$/i), { target: { value: '2026-01-01' } });

    expect(screen.getByText(/start of the period is after its end/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send me a code/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(posted, 'nothing was asked of the server').toEqual([]);
  });

  it('says a different period needs a new code, rather than failing quietly', async () => {
    await lookUp('By TIN', '841446134');
    fireEvent.click(screen.getByRole('button', { name: /Send me a code/i }));
    await waitFor(() => expect(screen.getByLabelText(/Code from the SMS/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Code from the SMS/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Show my payments/i }));
    await waitFor(() => expect(screen.getByText(/What it went to/i)).toBeTruthy());

    const again = screen.getByRole('button', { name: /Look at a different period/i });
    expect(again.textContent, 'the cost is on the button, not discovered later').toMatch(
      /new code/i,
    );

    fireEvent.click(again);
    await waitFor(() => expect(screen.getByLabelText(/^From$/i)).toBeTruthy());
    expect(screen.queryByText(/What it went to/i)).toBeNull();
  });

  it('shows what was paid and what it went to', async () => {
    await lookUp('By TIN', '841446134');
    fireEvent.click(screen.getByRole('button', { name: /Send me a code/i }));
    await waitFor(() => expect(screen.getByLabelText(/Code from the SMS/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Code from the SMS/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Show my payments/i }));

    await waitFor(() => expect(screen.getByText(/What it went to/i)).toBeTruthy());
    // Twice over, and deliberately: once as the year's total for that levy,
    // once as the payment itself. A citizen reconciling against a bank
    // statement wants both.
    expect(screen.getAllByText(/Shops and Kiosks Rates/)).toHaveLength(2);
    expect(screen.getAllByText('₦3,000.00').length).toBeGreaterThan(0);
    // The phone carried the code, so the request carried it too.
    const shown = posted.find((entry) => entry.path === '/citizen-status/statement');
    expect(shown!.body).toMatchObject({ tin: '841446134', code: '123456' });
  });

  it('tells them the receipt is the proof and this is only the record', async () => {
    /*
     * The statement deliberately carries no receipt numbers, so it cannot be
     * used to prove a payment to anybody. Saying so is the difference between
     * a citizen keeping their receipts and throwing them away.
     */
    await lookUp('By TIN', '841446134');
    fireEvent.click(screen.getByRole('button', { name: /Send me a code/i }));
    await waitFor(() => expect(screen.getByLabelText(/Code from the SMS/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Code from the SMS/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Show my payments/i }));

    await waitFor(() => expect(screen.getByText(/Keep your receipts/i)).toBeTruthy());
    expect(screen.getByText(/the receipt is the proof/i)).toBeTruthy();
  });
});

describe('the same statement, read in Hausa', () => {
  /*
   * `/citizen-status` is public and unauthenticated, so it has nobody to
   * resolve a language from and answers in English. Every one of these checks
   * is about the screen doing what the endpoint cannot.
   */
  it('says the compliance status in Hausa rather than repeating the server', async () => {
    setPublicLanguage('ha');
    render(<CitizenPortalScreen />);
    fireEvent.change(screen.getByLabelText(/Lambar Shaidar Haraji/i), {
      target: { value: '841446134' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Duba matsayi/i }));

    await waitFor(() => expect(screen.queryByText(/Bayanan harajinka sun cika/)).toBeTruthy());
    // And not the English sentence the endpoint sent alongside it.
    expect(screen.queryByText(/Your tax records are up to date/)).toBeNull();
  });

  it('names the levies out of the catalogue, and keeps English where there is no Hausa', async () => {
    /*
     * A levy's Hausa is in `revenue_items.name_ha`, not in the dictionary, so
     * a catalogue entry nobody has translated yet has no Hausa to show. The
     * English name is then the right answer: a citizen can still tell which
     * levy it was, which an empty cell would not let them do.
     */
    setPublicLanguage('ha');
    render(<CitizenPortalScreen />);
    fireEvent.change(screen.getByLabelText(/Lambar Shaidar Haraji/i), {
      target: { value: '841446134' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Duba matsayi/i }));
    await waitFor(() => expect(screen.queryByText(/Bayanan harajinka sun cika/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Aiko min da lamba/i }));
    await waitFor(() => expect(screen.queryByLabelText(/Lambar da ke cikin sakon/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Lambar da ke cikin sakon/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Nuna min biyayyata/i }));

    await waitFor(() => expect(screen.getAllByText(/Kudin Shago da Rumfa/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Shops and Kiosks Rates/)).toBeNull();
    // The one with no Hausa keeps its English name rather than going blank.
    expect(screen.getAllByText(/Market Tax and Levy/).length).toBeGreaterThan(0);
  });

  it('leaves the English reader reading English', async () => {
    // The guard on the check above: a screen that showed Hausa to everybody
    // would satisfy it just as well.
    await lookUp('By TIN', '841446134');
    expect(screen.queryByText(/Bayanan harajinka sun cika/)).toBeNull();
    expect(screen.queryByText(/Your tax records are up to date/)).toBeTruthy();
  });
});
