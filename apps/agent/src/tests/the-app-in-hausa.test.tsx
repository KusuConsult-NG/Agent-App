/**
 * Not "is there English left in the source" — "does the app come out in Hausa".
 *
 * `nothing-new-in-english.test.tsx` reads source text, and it can only ever
 * prove an absence: no English literal was left where one would be rendered.
 * That is worth having, and it is not the same claim as the one an agent
 * cares about. A screen can be free of English literals and still render
 * English, because the wiring in between is where the mistakes live — a key
 * that resolves to the wrong language, a module-level array holding keys that
 * nothing looks up, a hook that was never called in the component that needed
 * it.
 *
 * That last one is not hypothetical. Several of these screens hold their
 * labels in `const` arrays declared outside any component — the clearance
 * stages, the registration steps, the support categories, the group types, the
 * home tiles — because a hook cannot reach module scope. Each of them now
 * stores dictionary *keys* resolved at render, and every one of those is a
 * place where a key could be stored and never read.
 *
 * So this renders the screens and reads what comes out.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { RegisterTaxpayerScreen } from '../screens/Taxpayers';
import { RaiseTicketScreen } from '../screens/Support';
import { RegisterGroupScreen } from '../screens/Groups';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

beforeEach(() => {
  cleanup();
  setAppLanguage('en');
});
afterEach(() => {
  setAppLanguage('en');
});

function inHausa(ui: React.ReactElement) {
  setAppLanguage('ha');
  return render(ui);
}

describe('the registration wizard, in Hausa', () => {
  const wizard = () => (
    <RegisterTaxpayerScreen navigate={() => undefined} connection="ONLINE" />
  );

  it('asks the first question in Hausa', () => {
    inHausa(wizard());
    expect(screen.getByText(ha.tpHasTin)).toBeTruthy();
    expect(screen.queryByText(en.tpHasTin)).toBeNull();
  });

  it('names the step it is on in Hausa', () => {
    /*
     * The progress line reads out of `STEPS`, which is module-level and holds
     * dictionary keys. If those keys were stored and never resolved, the agent
     * would read the literal string `tpStepTin` — which is neither language.
     */
    inHausa(wizard());
    expect(screen.getByText(ha.tpStepTin)).toBeTruthy();
    expect(screen.queryByText(/tpStep/)).toBeNull();
  });

  it('offers Yes and No in Hausa', () => {
    // The pair that made the negation test learn `a’a`.
    inHausa(wizard());
    expect(screen.getByText(ha.tpYes)).toBeTruthy();
    expect(screen.getByText(ha.tpNo)).toBeTruthy();
  });

  it('is in English when the app is', () => {
    // Otherwise a test that only ever renders Hausa would pass against a
    // dictionary hardcoded to Hausa in both languages.
    render(wizard());
    expect(screen.getByText(en.tpHasTin)).toBeTruthy();
    expect(screen.queryByText(ha.tpHasTin)).toBeNull();
  });
});

describe('reporting a problem, in Hausa', () => {
  it('lists the categories in Hausa', () => {
    /*
     * `CATEGORIES` is the other module-level array, and the one whose entries
     * a distressed agent reads fastest: the list includes "someone was charged
     * money they should not have been".
     */
    inHausa(<RaiseTicketScreen navigate={() => undefined} />);
    expect(screen.getByText(ha.supCatUnauthorised)).toBeTruthy();
    expect(screen.queryByText(en.supCatUnauthorised)).toBeNull();
  });
});

describe('registering a group, in Hausa', () => {
  it('names the kinds of body an agent meets, in Hausa', () => {
    // `GROUP_TYPES` is the third module-level array, and `readable()` resolves
    // it through a dictionary passed in rather than a hook it cannot call.
    inHausa(<RegisterGroupScreen navigate={() => undefined} />);
    expect(screen.getByText(ha.grpFarmers)).toBeTruthy();
    expect(screen.queryByText(en.grpFarmers)).toBeNull();
  });

  it('says what registering does and does not do, in Hausa', () => {
    // The sentence that stops an agent telling a cooperative it has been
    // assessed. Its negations are the reason it is in the safety tier.
    inHausa(<RegisterGroupScreen navigate={() => undefined} />);
    expect(screen.getByText(ha.grpNoAssessmentBody)).toBeTruthy();
  });
});
