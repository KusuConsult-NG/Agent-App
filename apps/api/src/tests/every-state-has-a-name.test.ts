/**
 * A state the database allows, and no word for it in either language.
 *
 * Every state on this platform is a string in a CHECK constraint. Both front
 * ends rendered them by taking the underscores out, so a status badge said
 * "partially paid" and a group said "farmers cooperative" whatever language
 * the app was set to. `ENUM_LABELS` gives each one a dictionary key; this
 * asks the database whether that map is complete.
 *
 * IT READS THE SCHEMA, NOT A LIST. A list of values in a test file is a copy,
 * and a copy of a schema goes stale the first time somebody adds a state
 * without opening this file — which is precisely the case worth catching,
 * because the new state is the one nobody remembered to translate. The
 * constraints are the definition, so they are what is read.
 *
 * The failure is legible on purpose: it names the table, the column and the
 * value, which is everything needed to write the two lines that fix it.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_STATES,
  APPROVAL_TYPES,
  DOCUMENT_TYPES,
  ENUM_LABELS,
  FRAUD_RULES,
  FRAUD_SEVERITIES,
  FREQUENCIES,
  PAYMENT_METHODS,
  RATE_TYPES,
  TAXPAYER_TYPES,
  TICKET_STATES,
  translations,
} from '@psirs/shared';
import { pool, resetDatabase, stopTestServer } from './helpers';
import { query } from '../db/pool';

/**
 * Values the schema allows that are not states anybody reads.
 *
 * Each line is a claim that the value never reaches a person's eyes, not that
 * translating it was inconvenient. Nothing is here yet, and the empty list is
 * deliberate: it is easier to argue about a line somebody added than about a
 * mechanism nobody knew existed.
 */
const NOT_SHOWN_TO_ANYBODY: Record<string, string> = {};

interface Constraint {
  table_name: string;
  column_name: string;
  definition: string;
}

let constraints: Constraint[] = [];

before(async () => {
  await resetDatabase();
  constraints = await query<Constraint>(
    pool,
    `SELECT rel.relname AS table_name,
            col.attname AS column_name,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class rel ON rel.oid = c.conrelid
       JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
       JOIN pg_attribute col ON col.attrelid = rel.oid AND col.attnum = k.attnum
      WHERE c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%ANY (ARRAY%'
      ORDER BY 1, 2`,
  );
});

after(async () => {
  await stopTestServer();
});

/** Every quoted value inside `= ANY (ARRAY[...])`. */
function allowedValues(definition: string): string[] {
  return [...definition.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((match) => match[1]);
}

describe('every state the database allows has a name a person can read', () => {
  it('found the constraints to check against', () => {
    /*
     * Without this the assertions below pass on an empty schema, which is the
     * one result that looks like success and means the test did nothing.
     */
    assert.ok(
      constraints.length > 60,
      `only ${constraints.length} enumerated columns found; the schema query is not working`,
    );
  });

  it('has a dictionary key for every allowed value', () => {
    const missing: string[] = [];
    for (const constraint of constraints) {
      for (const value of allowedValues(constraint.definition)) {
        const where = `${constraint.table_name}.${constraint.column_name}: ${value}`;
        if (NOT_SHOWN_TO_ANYBODY[where] || NOT_SHOWN_TO_ANYBODY[value]) continue;
        if (!ENUM_LABELS[value]) missing.push(where);
      }
    }
    assert.deepEqual(
      [...new Set(missing)].sort(),
      [],
      'these states would reach a screen as themselves, in English',
    );
  });

  it('has a name for the enumerations that live in code rather than the schema', () => {
    /*
     * Not every enumeration is a CHECK constraint. The fraud signals are a
     * list in `reference.ts` — `rule` is a free text column, deliberately, so
     * a new detection can be deployed without a migration — and they were the
     * ten values the first pass over the schema missed. An officer deciding
     * whether to uphold a flag reads the rule's name as the first line of the
     * reason, which is the last place an identifier belongs.
     */
    const lists: Record<string, readonly string[]> = {
      TAXPAYER_TYPES,
      RATE_TYPES,
      FREQUENCIES,
      PAYMENT_METHODS,
      DOCUMENT_TYPES,
      FRAUD_RULES,
      FRAUD_SEVERITIES,
      APPROVAL_TYPES,
      APPROVAL_STATES,
      TICKET_STATES,
    };
    const missing: string[] = [];
    for (const [name, values] of Object.entries(lists)) {
      for (const value of values) {
        if (!ENUM_LABELS[value]) missing.push(`${name}: ${value}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('points every value at a key the dictionary actually holds', () => {
    /*
     * The other direction. A key can be renamed in `i18n.ts` and leave this
     * map pointing at nothing, which TypeScript catches at build time — but
     * only for the literal map, and only while the two stay in the same
     * package. Asserting it here costs nothing and does not depend on that.
     */
    const dangling = Object.entries(ENUM_LABELS)
      .filter(([, key]) => !(key in translations.en) || !(key in translations.ha))
      .map(([value, key]) => `${value} -> ${key}`);
    assert.deepEqual(dangling, []);
  });

  it('keeps the exception list honest', () => {
    // A value listed as unseen that the schema no longer allows is a line
    // nobody will delete unless something says so.
    const allowed = new Set<string>();
    for (const constraint of constraints) {
      for (const value of allowedValues(constraint.definition)) {
        allowed.add(value);
        allowed.add(`${constraint.table_name}.${constraint.column_name}: ${value}`);
      }
    }
    const stale = Object.keys(NOT_SHOWN_TO_ANYBODY).filter((entry) => !allowed.has(entry));
    assert.deepEqual(stale, []);
  });
});
