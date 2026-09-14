/**
 * Not "is there English left in the source" — "does the portal come out in
 * Hausa".
 *
 * `nothing-new-in-english.test.tsx` reads source text and can only prove an
 * absence. The compiler proves a shape. Neither says what an officer sees,
 * and that is where this change's risk actually sits: it moved almost every
 * label in the portal from a string into a key resolved somewhere else, and
 * added the indirection that makes a wrong resolution possible.
 *
 * Three things could go wrong and pass everything written so far. The menu
 * could render the key `ofcNavReconciliation` instead of a word. A `Stat`
 * could resolve against English while the officer chose Hausa. The toggle
 * could set a language nothing re-reads. So this signs in, renders, and looks.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { Stat, Table, LanguageToggle } from '../ui';
import { availableGroups } from '../lib/permissions';
import { setPortalLanguage, getPortalLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
});
afterEach(() => setPortalLanguage('en'));

describe('the shared primitives resolve the key, not the word', () => {
  it('renders a Stat in the chosen language', () => {
    setPortalLanguage('ha');
    render(<Stat label="ofcFnVariance" value="1" hint="ofcFnTotalExpected" />);
    expect(screen.getByText(ha.ofcFnVariance)).toBeTruthy();
    expect(screen.getByText(ha.ofcFnTotalExpected)).toBeTruthy();
    expect(screen.queryByText('ofcFnVariance')).toBeNull();
  });

  it('renders a Stat in English when English is chosen', () => {
    // Otherwise a dictionary that had gone Hausa in both languages would
    // satisfy the assertion above.
    render(<Stat label="ofcFnVariance" value="1" />);
    expect(screen.getByText(en.ofcFnVariance)).toBeTruthy();
    expect(screen.queryByText(ha.ofcFnVariance)).toBeNull();
  });

  it('leaves a label that is data alone', () => {
    /*
     * An LGA's name, a column headed by whatever a query returned. These pass
     * `{ text }` precisely because they are not translatable, and putting them
     * through the dictionary would render `undefined`.
     */
    setPortalLanguage('ha');
    render(<Stat label={{ text: 'Bokkos' }} value="1" />);
    expect(screen.getByText('Bokkos')).toBeTruthy();
  });

  it('renders table headings and the empty state in Hausa', () => {
    setPortalLanguage('ha');
    render(
      <Table columns={[{ key: 'a', label: 'ofcFnDate' }]} rows={[]} empty="ofcNoneAccessRecorded" />,
    );
    expect(screen.getByText(ha.ofcNoneAccessRecorded)).toBeTruthy();
  });
});

describe('the officer’s menu', () => {
  it('holds dictionary keys, every one of which resolves', () => {
    /*
     * The catalogue is module-level, so a key stored there and never added to
     * the dictionary would render as `undefined` — a blank sidebar entry an
     * officer cannot click and nobody can explain.
     */
    for (const role of ['admin', 'revenue_officer', 'finance_officer', 'auditor', 'supervisor']) {
      const groups = availableGroups({ id: 'u', role, permissions: ALL } as never);
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(ha[group.group], `${role}: group ${group.group}`).toBeTruthy();
        for (const item of group.items) {
          expect(ha[item.label], `${role}: item ${item.label}`).toBeTruthy();
        }
      }
    }
  });
});

describe('the language toggle', () => {
  it('changes the language the rest of the portal reads', () => {
    render(<LanguageToggle />);
    const hausa = screen.getByText(en.pubHausa);
    hausa.click();
    expect(getPortalLanguage()).toBe('ha');
  });
});

/** Every permission, so the menu is exercised at its widest per role. */
const ALL = [
  'report:read:all',
  'report:read:territory',
  'report:financial',
  'payment:read:all',
  'agent:read:all',
  'commission:read:all',
  'approval:review',
  'fraud:read',
  'support:read:all',
  'audit:read',
  'catalogue:read',
  'incentive:read:all',
  'group:manage',
  'taxpayer:correct',
  'user:manage',
  'system:configure',
  'allocation:manage',
];
