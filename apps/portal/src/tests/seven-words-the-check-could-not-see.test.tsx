/**
 * The words a rule meant for identifiers was hiding.
 *
 * `looksLikeCode` excused any single lowercase token, on the reasoning that
 * this is what an identifier looks like. It is also what most short English
 * words look like, so the check had been passing over real copy on a portal
 * that offers Hausa: "or" between two links, "of" between two numbers,
 * "beneficiaries", "each", "to", "identifiers", "for".
 *
 * Removing the rule looked unaffordable — 127 captures — until the captures
 * were counted rather than eyeballed. There were only ten distinct words, and
 * 120 of the 127 were `finally`, `try` and `catch` from ordinary blocks. Two
 * of those three were simply missing from the keyword list that already held
 * `catch` and `else`. With them added the residue was exactly seven, and all
 * seven were real.
 *
 * The guard is what holds this now: with the rule gone it fails on any of the
 * seven coming back. These hold the translations themselves, and the shape of
 * the one that was worse than untranslated.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { translations } from '@psirs/shared';

const ha = translations.ha;
const en = translations.en;

describe('the seven words', () => {
  it('has both languages for each, and they differ', () => {
    const keys = [
      'ofcDbOr',
      'ofcDbDayRange',
      'ofcGpBeneficiaryCount',
      'ofcGpCollectedOfAwarded',
      'ofcGpEachBeneficiaryGets',
      'ofcOvIdentifiers',
    ] as const;
    for (const key of keys) {
      const e = (en as unknown as Record<string, string>)[key];
      const h = (ha as unknown as Record<string, string>)[key];
      expect(typeof h, `${key} missing in ha`).toBe('string');
      expect(h.trim().length, `${key} empty in ha`).toBeGreaterThan(0);
      expect(e, `${key} identical in both languages`).not.toBe(h);
    }
  });

  /*
   * Most of these had to become whole phrases rather than the word alone.
   * Hausa does not put a number, its noun and a preposition where English
   * does, so "{n} beneficiaries" and "{collected} of {awarded}" cannot be
   * assembled by concatenating a translated word between two numbers.
   */
  it('carries the numbers inside the phrase, not around it', () => {
    for (const lang of [en, ha] as const) {
      const d = lang as unknown as Record<string, string>;
      expect(d.ofcGpBeneficiaryCount).toContain('{{count}}');
      expect(d.ofcGpCollectedOfAwarded).toContain('{{collected}}');
      expect(d.ofcGpCollectedOfAwarded).toContain('{{awarded}}');
      expect(d.ofcGpCollectedOfAwarded).toContain('{{rate}}');
      expect(d.ofcGpEachBeneficiaryGets).toContain('{{quantity}}');
      expect(d.ofcDbDayRange).toContain('{{from}}');
      expect(d.ofcDbDayRange).toContain('{{to}}');
    }
  });

  it('fills every placeholder in', () => {
    const said = ha.ofcGpCollectedOfAwarded
      .replace('{{collected}}', '12')
      .replace('{{awarded}}', '40')
      .replace('{{rate}}', '30');
    expect(said).toContain('12');
    expect(said).toContain('40');
    expect(said).not.toContain('{{');
  });
});

describe('the sentence that was split to italicise one word', () => {
  /*
   * `Revenue.tsx` rendered `{body}<em>for</em>{mdaNoItem}`. So `body` ended
   * mid-clause and `mdaNoItem` BEGAN WITH A FULL STOP, in both languages.
   *
   * That is not a translation problem, it is a translatability problem:
   * Hausa does not strand a preposition at the end of a clause, so no
   * translation of the first half could end where the English did, and the
   * reviewer of the second half was handed a fragment opening with
   * punctuation. It is one key now.
   */
  it('is one whole sentence in each language', () => {
    for (const lang of [en, ha] as const) {
      const body = (lang as unknown as Record<string, string>).ofcRvWhoseRevenueBody;
      expect(body.trim().startsWith('.'), 'a sentence must not open with a full stop').toBe(false);
      expect(body.trim().endsWith('.'), 'a sentence must end').toBe(true);
      // Both clauses are present, so nothing was dropped when they were joined.
      expect(body).toMatch(/PSIRS/);
      expect(body.length).toBeGreaterThan(200);
    }
  });

  it('no longer leaves the second half stranded in the dictionary', () => {
    // The half-sentence key is gone rather than orphaned.
    expect((en as unknown as Record<string, string>).ofcRvMdaNoItem).toBeUndefined();
    expect((ha as unknown as Record<string, string>).ofcRvMdaNoItem).toBeUndefined();
  });

  it('carries the preposition inside the translated clause', () => {
    // English strands it; Hausa attaches it. Neither is a separate word now.
    expect(en.ofcRvWhoseRevenueBody).toMatch(/collected for\./);
    expect(ha.ofcRvWhoseRevenueBody).toMatch(/dominsa\./);
  });
});
