/**
 * The registration that stopped dead and blamed the agent for it.
 *
 * Six places loaded reference geography and taxonomy with a bare `fetch`:
 *
 *   fetch('/api/v1/reference/lgas')
 *     .then((response) => (response.ok ? response.json() : []))
 *     .catch(() => setLgas([]));
 *
 * Both branches end at the same place. A 500 becomes an empty list. A dropped
 * connection becomes an empty list. Nothing recorded, nothing shown.
 *
 * On the taxpayer registration wizard the Local Government Area is a REQUIRED
 * field on step three. So when its list did not arrive, the agent could not
 * continue — and the sentence under the greyed-out button read:
 *
 *   "Choose the Local Government Area."
 *
 * There was nothing to choose. An agent standing in front of somebody who has
 * agreed to register is stopped, and told they have failed to do the one thing
 * that cannot be done. No message names the real cause. Nothing can be pressed.
 *
 * This is the same family as the lists that answered a failed read with "there
 * are none", and it is the worst version of it: not a false report but a false
 * instruction, on the agent's primary task, with a citizen waiting.
 *
 * The read goes through `useReferenceList` now, which keeps "empty" and "could
 * not be read" apart, and through `request` rather than `fetch` so a lost
 * connection produces something rather than an empty array.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { RegisterTaxpayerScreen } from '../screens/Taxpayers';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

const LGAS = [{ id: 'lga-1', name: 'Jos North', name_ha: null, zone: 'Central' }];

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Walk the wizard as far as step three, where the LGA is asked for. */
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

afterEach(() => {
  cleanup();
  setAppLanguage('en');
});

describe('registering somebody when the LGA list did not arrive', () => {
  it('does not tell the agent to choose from a list that is not there', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();

    // The hint under the greyed-out button is where "Choose the Local
    // Government Area" used to sit. `role="status"` is what an agent's screen
    // reader announces, so it is the sentence that actually reaches them.
    const blocked = await screen.findByRole('status');
    expect(blocked.textContent).toBe(en.tpListCouldNotLoad);
    expect(screen.queryByText(en.needLga!)).toBeNull();
  });

  it('says so in the dropdown as well, and offers the read again', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();

    await screen.findByRole('button', { name: en.actionTryAgain! });
    // "Select LGA" invites a choice that cannot be made.
    expect(screen.queryByText(en.tpSelectLga!)).toBeNull();
  });

  it('lets the registration go on when the list arrives on the second ask', async () => {
    // The whole worth of the retry: a citizen is waiting, and the agent gets
    // to finish without abandoning the form and starting again.
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      if (!String(input).includes('/reference/lgas')) return answer([]);
      call += 1;
      if (call === 1) throw new TypeError('Failed to fetch');
      return answer(LGAS);
    }) as never);

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();

    fireEvent.click(await screen.findByRole('button', { name: en.actionTryAgain! }));

    await screen.findByText('Jos North');
    expect(screen.queryByText(en.tpListCouldNotLoad!)).toBeNull();
  });

  it('says it in the language the agent is reading', async () => {
    // An agent working a Hausa-speaking market reads this screen in Hausa,
    // and a blocked registration is exactly when the sentence has to land.
    setAppLanguage('ha');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    const field = (label: string) => screen.getByLabelText(label, { exact: false });
    fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));
    fireEvent.change(field(ha.tpFirstName!), { target: { value: 'Ladi' } });
    fireEvent.change(field(ha.tpLastName!), { target: { value: 'Bala' } });
    fireEvent.change(field(ha.tpPhoneNumber!), { target: { value: '08030000001' } });
    fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));
    fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));
    fireEvent.change(field(ha.tpStepAddress!), { target: { value: '14 Rukuba Road' } });

    const blocked = await screen.findByRole('status');
    expect(blocked.textContent).toBe(ha.tpListCouldNotLoad);
  });
});

describe('what this must not have changed', () => {
  it('still tells an agent to choose when there IS a list and they have not', async () => {
    // The control that matters. "Choose the Local Government Area" is correct
    // whenever the list arrived, and must survive.
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) =>
      answer(String(input).includes('/reference/lgas') ? LGAS : [])) as never);

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();

    await screen.findByText('Jos North');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(en.needLga));
    expect(screen.queryByText(en.tpListCouldNotLoad!)).toBeNull();
    expect(screen.queryByRole('button', { name: en.actionTryAgain! })).toBeNull();
  });

  it('still lets the agent past the step once they choose', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) =>
      answer(String(input).includes('/reference/lgas') ? LGAS : [])) as never);

    render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);
    toTheAddressStep();
    await screen.findByText('Jos North');

    fireEvent.change(screen.getByLabelText(en.tpLga!, { exact: false }), {
      target: { value: 'lga-1' },
    });

    await waitFor(() => expect(screen.queryByText(en.needLga!)).toBeNull());
  });
});
