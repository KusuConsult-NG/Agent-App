/**
 * Being told it might be a duplicate, and not being shown the duplicate.
 *
 * When the register refuses a registration as a possible duplicate, the screen
 * makes a second request to fetch the records that matched, so the agent can
 * look at them and decide whether the person in front of them is already on
 * the register. The panel that shows those records also carries the "None of
 * these" button — the override that actually completes the registration.
 *
 * The catch on that second request set the list to `[]`. The panel renders on
 * `length > 0`, so a failed fetch took the panel away and the override with
 * it: the agent was told PSIRS thinks this is a duplicate, shown nothing it
 * matched, and left with no button to press. A citizen is standing in front of
 * them and the registration is simply dead.
 *
 * The mirror image of the report screens that answered a failed read with a
 * confident zero — same cause, `[]` meaning two different things, but here it
 * manufactures a dead end rather than an all-clear.
 *
 * The reasons were the other half. Five sentences composed in `apps/api` and
 * printed with `reasons.join('; ')` — English, on the screen where an agent
 * decides whether two records are the same human being.
 *
 * This walks the whole six-step wizard, which no test had done either.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { RegisterTaxpayerScreen } from '../screens/Taxpayers';
import { ApiRequestError, api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

const LGAS = [{ id: 'lga-1', name: 'Jos North', name_ha: null }];

const MATCH = {
  taxpayerId: 'tp-1',
  displayName: 'Ladi Bala',
  tin: 'P-0000001',
  phone: '+2348030000001',
  score: 85,
  reasons: ['PHONE_AND_NAME', 'NAME_IN_LGA'],
};

const duplicateRefusal = () =>
  new ApiRequestError(
    409,
    {
      code: 'POSSIBLE_DUPLICATE_TAXPAYER',
      message: 'This may already be registered.',
      moneyStatus: 'NOT_APPLICABLE',
    },
    null,
  );

/**
 * Fill the wizard and press Register.
 *
 * Six steps, driven by their labels rather than their order — the steps have
 * been renumbered once already, and an index would have made this test walk
 * past the one it cares about.
 */
async function registerSomebody() {
  render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);

  // Step 0: no existing TIN. The default is already "no", so continue.
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 1: who they are. `Field` appends " *" to a required label, so these
  // are matched loosely rather than by an exact string.
  const field = (label: string) => screen.getByLabelText(label, { exact: false });
  fireEvent.change(field(ha.tpFirstName!), { target: { value: 'Ladi' } });
  fireEvent.change(field(ha.tpLastName!), { target: { value: 'Bala' } });
  fireEvent.change(field(ha.tpPhoneNumber!), { target: { value: '08030000001' } });
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 2: identity, all optional.
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 3: where they are. The address field shares its key with the step
  // heading, which `getByLabelText` does not look at.
  fireEvent.change(field(ha.tpStepAddress!), { target: { value: '14 Rukuba Road' } });
  await waitFor(() => expect(screen.getByText('Jos North')).toBeTruthy());
  fireEvent.change(field(ha.tpLga!), { target: { value: 'lga-1' } });
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 4: livelihood, all optional.
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 5: consent and declaration, both required.
  fireEvent.click(screen.getByLabelText(ha.tpConsent!, { exact: false }));
  fireEvent.click(screen.getByLabelText(ha.tpDeclaration!, { exact: false }));

  fireEvent.click(screen.getByRole('button', { name: ha.tpRegisterTaxpayer! }));
}

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
  /*
   * The reference lists go through `useReferenceList`, which reads them with
   * the api client rather than a bare `fetch` — so this answers with a real
   * `Response` that `rawRequest` can read, not a `json()` stub.
   *
   * They are still mocked at the transport rather than through `api.get`,
   * which is the point of the hook: the LGA list is a required field on step
   * three, and a list that does not arrive stops the wizard there. Nothing
   * below gets past that step without this.
   */
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/reference/lgas') ? LGAS : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as never);
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
});

afterEach(() => {
  setAppLanguage('en');
  vi.restoreAllMocks();
});

describe('a registration the register thinks it already has', () => {
  it('shows what it matched, in the agent’s language', async () => {
    vi.spyOn(api, 'post').mockImplementation((async (path: string) => {
      if (path === '/taxpayers/duplicate-check') return { possibleDuplicates: [MATCH] };
      throw duplicateRefusal();
    }) as never);

    await registerSomebody();

    await waitFor(() => expect(screen.getByText('Ladi Bala')).toBeTruthy());
    expect(screen.getByText(new RegExp(ha.tpDupPhoneAndName!))).toBeTruthy();
    expect(screen.getByText(new RegExp(ha.tpDupNameInLga!))).toBeTruthy();
    // And not the sentences the API composed.
    expect(document.body.textContent).not.toContain(en.tpDupPhoneAndName!);
    expect(document.body.textContent).not.toContain('PHONE_AND_NAME');
    // The override is there, as it always was.
    expect(screen.getByRole('button', { name: ha.tpNoneOfThese! })).toBeTruthy();
  });

  /*
   * The defect. The refusal stands, the list does not arrive, and the agent
   * must still be able to act — either to try the list again or to go ahead on
   * the warning alone, which is the server's own offer and is recorded.
   */
  it('still offers a way forward when the matches could not be listed', async () => {
    vi.spyOn(api, 'post').mockImplementation((async (path: string) => {
      if (path === '/taxpayers/duplicate-check') throw new Error('gateway went away');
      throw duplicateRefusal();
    }) as never);

    await registerSomebody();

    await waitFor(() => expect(screen.getByText(ha.tpDupCouldNotList!)).toBeTruthy());
    expect(screen.getByText(ha.tpDupCouldNotListBody!)).toBeTruthy();
    // Both ways out are on the screen.
    expect(screen.getByRole('button', { name: ha.tpDupTryAgain! })).toBeTruthy();
    expect(screen.getByRole('button', { name: ha.tpNoneOfThese! })).toBeTruthy();
  });

  /*
   * And the state that must not change: a registration nobody objects to
   * shows no panel at all.
   */
  it('says nothing about duplicates when the register accepted it', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ taxpayerId: 'tp-9', tin: 'P-0000009' } as never);

    await registerSomebody();

    await waitFor(() => expect(screen.queryByText(ha.tpPossibleExisting!)).toBeNull());
    expect(screen.queryByText(ha.tpDupCouldNotList!)).toBeNull();
  });
});
