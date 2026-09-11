/**
 * The ward list of the Local Government Area the agent has just left.
 *
 * Wards are fetched per LGA, so the path changes the moment the agent picks a
 * different one. `useReferenceList` held the previous list until the new
 * request answered, which leaves the old LGA's wards sitting in the dropdown,
 * selectable, for as long as that takes — and on the connections this
 * application is built for, that is not an instant.
 *
 * The registration screen already says why that must not happen. Clearing the
 * chosen ward when the LGA changes carries this comment:
 *
 *   "Leaving it selected would file this registration in a ward of a
 *    different LGA; the server refuses that, but the agent should not have to
 *    be told."
 *
 * That clears the SELECTION. These are the OPTIONS, and the same sentence
 * applies to them: the server refuses the filing, so nothing wrong reaches the
 * register, but the agent is sent round the form again for a mistake the
 * screen offered them.
 *
 * Introduced by the commit that replaced six bare `fetch` calls with this
 * hook, so it is mine rather than inherited.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { RegisterTaxpayerScreen } from '../screens/Taxpayers';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;

const LGAS = [
  { id: 'lga-1', name: 'Jos North', name_ha: null, zone: 'Central' },
  { id: 'lga-2', name: 'Langtang South', name_ha: null, zone: 'Southern' },
];

const JOS_WARDS = [{ id: 'ward-1', code: 'W1', name: 'Naraguta' }];

function answer(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function toTheAddressStep() {
  const field = (label: string) => screen.getByLabelText(label, { exact: false });
  fireEvent.click(screen.getByRole('button', { name: en.tpContinue! }));
  fireEvent.change(field(en.tpFirstName!), { target: { value: 'Ladi' } });
  fireEvent.change(field(en.tpLastName!), { target: { value: 'Bala' } });
  fireEvent.change(field(en.tpPhoneNumber!), { target: { value: '08030000001' } });
  fireEvent.click(screen.getByRole('button', { name: en.tpContinue! }));
  fireEvent.click(screen.getByRole('button', { name: en.tpContinue! }));
  fireEvent.change(field(en.tpStepAddress!), { target: { value: '14 Rukuba Road' } });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  setAppLanguage('en');
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
});

afterEach(() => cleanup());

describe('changing the Local Government Area', () => {
  it('stops offering the wards of the one just left', async () => {
    /*
     * Jos North's wards answer. Langtang South's never do — which is the
     * whole point: the window this closes is however long the second request
     * takes, and on a market connection it is long.
     */
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/reference/lgas')) return answer(LGAS);
      if (url.includes('lgaId=lga-1')) return answer(JOS_WARDS);
      if (url.includes('lgaId=lga-2')) return new Promise(() => {});
      return answer([]);
    }) as never);

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();

    await screen.findByText('Jos North');
    fireEvent.change(screen.getByLabelText(en.tpLga!, { exact: false }), {
      target: { value: 'lga-1' },
    });
    await screen.findByText('Naraguta');

    // Now to an LGA whose wards have not arrived.
    fireEvent.change(screen.getByLabelText(en.tpLga!, { exact: false }), {
      target: { value: 'lga-2' },
    });

    await waitFor(() => expect(screen.queryByText('Naraguta')).toBeNull());
  });
});

describe('what this must not have changed', () => {
  it('still offers the wards of the LGA that was chosen', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/reference/lgas')) return answer(LGAS);
      if (url.includes('lgaId=lga-1')) return answer(JOS_WARDS);
      return answer([]);
    }) as never);

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();

    await screen.findByText('Jos North');
    fireEvent.change(screen.getByLabelText(en.tpLga!, { exact: false }), {
      target: { value: 'lga-1' },
    });

    await screen.findByText('Naraguta');
  });

  it('still says nothing false about a ward list that could not be read', async () => {
    // The list being cleared must not read as "this LGA has no wards".
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/reference/lgas')) return answer(LGAS);
      if (url.includes('/reference/wards')) throw new TypeError('Failed to fetch');
      return answer([]);
    }) as never);

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();

    await screen.findByText('Jos North');
    fireEvent.change(screen.getByLabelText(en.tpLga!, { exact: false }), {
      target: { value: 'lga-1' },
    });

    await waitFor(() => expect(screen.getByText(en.tpListCouldNotLoad!)).toBeTruthy());
    expect(screen.queryByText(en.tpNoWardsListed!)).toBeNull();
  });
});
