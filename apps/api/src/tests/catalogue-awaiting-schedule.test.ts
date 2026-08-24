/**
 * An item in the catalogue with no rate must refuse to be assessed.
 *
 * The Plateau State Revenue (Consolidation) Law, 2020 fixes several amounts by
 * Schedule — presumptive income tax by enterprise category in the First
 * Schedule, consolidated business premises rates by urban / semi-urban / rural
 * categorisation in the Second. Those items are catalogued here so government
 * can see they exist and must be configured, and seeded with no rate, because
 * the Schedule is the legal authority for the figure and this repository is
 * not it.
 *
 * That arrangement is only safe if the platform refuses to charge anybody for
 * one. A revenue item that quietly assessed at zero, or at some default, would
 * be an agent collecting a sum no law had set.
 */

import './env';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase } from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { createAssessment } from '../services/revenue';

/** Codes seeded deliberately without a rate. */
const AWAITING_SCHEDULE = [
  'PIT-PRESUMPTIVE-MICRO',
  'PIT-PRESUMPTIVE-SMALL',
  'PIT-PRESUMPTIVE-MEDIUM',
  'BP-REG-SEMI-URBAN',
  'BP-RENEW-SEMI-URBAN',
];

/**
 * Which kind of taxpayer each is for.
 *
 * Presumptive income tax is charged to an individual whose business keeps no
 * accounts; business premises registration is charged to the premises. Using
 * one taxpayer for both hides the rate check behind an applicability check —
 * the platform refuses a business item for an individual first, and correctly,
 * which is not the refusal this test is about.
 */
const BUSINESS_ITEMS = new Set(['BP-REG-SEMI-URBAN', 'BP-RENEW-SEMI-URBAN']);

before(async () => {
  await resetDatabase();
  await seedReferenceData();
});

describe('revenue items whose amount belongs to a Schedule', () => {
  it('are in the catalogue, so government can see they need configuring', async () => {
    const rows = await query<{ code: string }>(
      pool,
      `SELECT code FROM revenue_items WHERE code = ANY($1::text[])`,
      [AWAITING_SCHEDULE],
    );
    assert.deepEqual(rows.map((r) => r.code).sort(), [...AWAITING_SCHEDULE].sort());
  });

  it('carry no rate, rather than a rate somebody guessed', async () => {
    const withRates = await query<{ code: string }>(
      pool,
      `SELECT ri.code FROM revenue_items ri
         JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
        WHERE ri.code = ANY($1::text[])`,
      [AWAITING_SCHEDULE],
    );
    assert.deepEqual(
      withRates.map((r) => r.code),
      [],
    );
  });

  it('refuse to be assessed until government sets the amount', async () => {
    // The whole safety of cataloguing an unpriced item rests on this.
    const officer = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO users (full_name, phone, email, password_hash, role, status)
       VALUES ('Schedule Test Officer', '+2348096000001', 'sched@psirs.invalid',
               'not-a-usable-hash', 'revenue_officer', 'ACTIVE')
       ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role
       RETURNING id`,
    );
    const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1');
    const individual = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers
         (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
       VALUES ('INDIVIDUAL','Schedule','Fixture','+2348096000002','1 Market Rd, Jos',$1,
               'ACTIVE','AGENT')
       RETURNING id`,
      [lga!.id],
    );
    const business = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers
         (taxpayer_type, business_name, phone, address, lga_id, status, source)
       VALUES ('BUSINESS','Schedule Fixture Enterprises','+2348096000003',
               '1 Market Rd, Jos',$1,'ACTIVE','AGENT')
       RETURNING id`,
      [lga!.id],
    );

    for (const code of AWAITING_SCHEDULE) {
      const item = await queryOne<{ id: string }>(
        pool,
        'SELECT id FROM revenue_items WHERE code = $1',
        [code],
      );

      await assert.rejects(
        () =>
          createAssessment({
            taxpayerId: (BUSINESS_ITEMS.has(code) ? business : individual)!.id,
            revenueItemId: item!.id,
            inputs: {},
            actorId: officer!.id,
            actorRole: 'revenue_officer',
            channel: 'OFFICER',
          }),
        (error: { code?: string; message?: string }) => {
          assert.equal(error.code, 'NO_EFFECTIVE_RATE', `${code}: ${error.message}`);
          return true;
        },
        `${code} must not be assessable without a rate`,
      );
    }
  });

  it('leaves no invoice or transaction behind when it refuses', async () => {
    // A refusal that had already written a row would be worse than charging:
    // the taxpayer would owe a sum nothing had computed.
    const stray = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM transactions t
         JOIN revenue_items ri ON ri.id = t.revenue_item_id
        WHERE ri.code = ANY($1::text[])`,
      [AWAITING_SCHEDULE],
    );
    assert.equal(stray!.n, '0');
  });
});
