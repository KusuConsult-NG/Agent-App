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

/*
 * EVERY REFUSAL THIS SCREEN CAN SHOW, IN THE LANGUAGE ITS AGENT READS.
 *
 * Registering somebody is the first thing an agent does for anybody and the
 * gate everything else is behind — nothing can be assessed, collected or
 * receipted against a person who is not on the register. All four refusals
 * were the server's English.
 *
 * Two of them had their next step in Hausa already and their headline in
 * English. `nsTinServiceUnavailable` and `nsTinNotFound` were written when the
 * advice on those two branches was corrected — the advice that used to tell an
 * agent to register a second TIN for somebody who already had one — and the
 * sentence they are advice about was left behind. The agent read what to do in
 * their own language and what had happened in somebody else's.
 *
 * Driven through the real wizard rather than through `errorText`, because
 * every one of these would pass a unit test on the dictionary while the screen
 * printed `error.message`, which is the gap that let this live.
 */
const refusal = (
  code: string,
  message: string,
  nextStep: string,
  details?: { field?: string; issue: string }[],
) =>
  new ApiRequestError(
    409,
    { code, message, moneyStatus: 'NOT_APPLICABLE', nextStep, ...(details ? { details } : {}) },
    null,
  );

/** The alert the screen put up, headline and next step together. */
function alertText(): string {
  return document.querySelector('.alert')?.textContent ?? '';
}

describe('a registration PSIRS refuses, in Hausa', () => {
  it('names who the person is already registered as', async () => {
    const subject = 'Rahila Provisions Store (TIN 274034597)';
    vi.spyOn(api, 'post').mockImplementation((async () => {
      throw refusal(
        'TAXPAYER_ALREADY_EXISTS',
        `This person is already registered as ${subject}. A second record would be a duplicate.`,
        'Open the existing taxpayer record and continue from there.',
        [{ field: 'subject', issue: subject }],
      );
    }) as never);

    await registerSomebody();

    await waitFor(() => expect(alertText()).toContain('An riga an yi rajistar'));
    const said = alertText();
    expect(said, 'the name is the whole of what the agent needs').toContain(subject);
    expect(said).not.toMatch(/\{\{\w+\}\}/);
    expect(said).toContain(ha.nsTaxpayerAlreadyExists!);
    expect(said).not.toContain('is already registered as');
  });

  it('names the TIN the register could not find', async () => {
    vi.spyOn(api, 'post').mockImplementation((async () => {
      throw refusal(
        'TIN_NOT_FOUND',
        'TIN 1234-5678-90 could not be found in the PSIRS TIN service.',
        'Check the number against the taxpayer’s own document first.',
        [
          { field: 'existingTin', issue: 'Not found in the authoritative TIN register' },
          { field: 'tin', issue: '1234-5678-90' },
        ],
      );
    }) as never);

    await registerSomebody();

    await waitFor(() => expect(alertText()).toContain('Ba a sami TIN'));
    const said = alertText();
    // The number read back is how an agent finds the digit they mistyped,
    // which is the likeliest cause by a distance.
    expect(said).toContain('1234-5678-90');
    expect(said).not.toMatch(/\{\{\w+\}\}/);
    expect(said, 'the next step was already Hausa; now the sentence above it is').toContain(
      ha.nsTinNotFound!,
    );
    expect(said).not.toContain('could not be found in the PSIRS');
  });

  it('says the TIN service could not be reached, above the warning that was already Hausa', async () => {
    vi.spyOn(api, 'post').mockImplementation((async () => {
      throw refusal(
        'TIN_SERVICE_UNAVAILABLE',
        'The PSIRS TIN service could not be reached, so this TIN cannot be confirmed.',
        'Try again in a few minutes.',
      );
    }) as never);

    await registerSomebody();

    await waitFor(() => expect(alertText()).toContain(ha.errTinServiceUnavailable!));
    const said = alertText();
    expect(said).toContain(ha.nsTinServiceUnavailable!);
    // The reassurance an agent has to give the person in front of them.
    expect(ha.errTinServiceUnavailable!).toMatch(/ba a yi rajistar kowa ba/i);
    expect(said).not.toContain('could not be reached');
  });

  it('does not tell an agent to set an API flag', async () => {
    vi.spyOn(api, 'post').mockImplementation((async (path: string) => {
      if (path === '/taxpayers/duplicate-check') return { possibleDuplicates: [MATCH] };
      throw refusal(
        'POSSIBLE_DUPLICATE_TAXPAYER',
        'Possible existing taxpayer found. Review before creating a new record.',
        'Check the suggested matches. If none is the same person, resubmit with ' +
          'acknowledgeDuplicates set to true.',
      );
    }) as never);

    await registerSomebody();

    await waitFor(() => expect(alertText()).toContain(ha.errPossibleDuplicateTaxpayer!));
    const said = alertText();
    expect(said).toContain(ha.nsPossibleDuplicateTaxpayer!);
    /*
     * The API's own next step is correct for a client and useless to a person:
     * `acknowledgeDuplicates` is a field in a request body and the agent has a
     * button. It was reaching them, in English, on the screen where they
     * decide whether two records are the same human being.
     */
    expect(said).not.toContain('acknowledgeDuplicates');
    expect(said).not.toContain('Possible existing taxpayer found');
    // And the button that actually does it is still the way through.
    expect(screen.getByRole('button', { name: ha.tpNoneOfThese! })).toBeTruthy();
  });
});
