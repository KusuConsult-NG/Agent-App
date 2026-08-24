/**
 * What each Council is owed.
 *
 * PSIRS collects local government revenue on the Councils' behalf. That makes
 * remittance a first-class question and the platform could not answer it: it
 * knew what it had collected, and had no view of what any one of the
 * seventeen Councils was due. `settlements` tracks money arriving from the
 * gateway into a government account and stops there.
 *
 * Collecting for somebody and being unable to tell them their share is the
 * kind of gap that gets discovered by an aggrieved Council rather than by an
 * accountant, so the properties below are about attribution rather than
 * presentation.
 *
 *   * Money collected in one Council's area is that Council's. Never
 *     another's, never the pool's.
 *   * State revenue collected in a Council's area is not the Council's. A
 *     personal income tax assessment raised in Wase is the State's, and
 *     including it would overstate what Wase is owed by whatever the State
 *     took there.
 *   * Only recognised revenue counts. A payment that has not been verified is
 *     not yet anybody's money, and a remittance figure built on invoices
 *     rather than confirmations is a promise the platform cannot keep.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { localGovernmentRemittance } from '../services/reports';

let officerId: string;
let adminToken: string;
let here: { id: string; name: string };
let there: { id: string; name: string };

/**
 * Book a settled collection.
 *
 * `code` decides whether it is the Council's revenue or the State's, which is
 * the distinction every assertion below turns on.
 */
async function collect(params: {
  code: string;
  lgaId: string;
  amountKobo: bigint;
  suffix: string;
  status?: string;
}) {
  const item = await queryOne<{ id: string; rate_id: string }>(
    pool,
    `SELECT ri.id, r.id AS rate_id
       FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE ri.code = $1 AND (r.lga_id = $2 OR r.lga_id IS NULL)
      ORDER BY (r.lga_id IS NOT NULL) DESC LIMIT 1`,
    [params.code, params.lgaId],
  );
  assert.ok(item, `${params.code} has no rate for this LGA`);

  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Remit','Fixture',$1,'1 Market Rd',$2,'ACTIVE','AGENT') RETURNING id`,
    [`+2348091${params.suffix}`, params.lgaId],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments
       (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
        computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,$5,$5,$6,'INVOICED',$7) RETURNING id`,
    [`ASMT-REM-${params.suffix}`, taxpayer!.id, item!.id, item!.rate_id,
     params.amountKobo.toString(), params.lgaId, officerId],
  );
  const invoice = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices (invoice_number, assessment_id, taxpayer_id, amount_kobo,
       total_amount_kobo, verification_code, created_by)
     VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id`,
    [`INV-REM-${params.suffix}`, assessment!.id, taxpayer!.id,
     params.amountKobo.toString(), `REM${params.suffix}`, officerId],
  );
  await query(
    pool,
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
        amount_kobo, total_amount_kobo, status, lga_id, channel, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'AGENT_PWA',$9)`,
    [`TXN-REM-${params.suffix}`, taxpayer!.id, invoice!.id, assessment!.id, item!.id,
     params.amountKobo.toString(), params.status ?? 'RECEIPT_GENERATED', params.lgaId, officerId],
  );
}

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  await startTestServer();

  officerId = await createGovernmentUser({
    fullName: 'Remittance Officer',
    phone: '+2348091000001',
    role: 'revenue_officer',
  });
  await createGovernmentUser({
    fullName: 'Remittance Admin',
    phone: '+2348091000002',
    role: 'admin',
  });
  adminToken = (await loginAs('+2348091000002')).accessToken;

  const lgas = await query<{ id: string; name: string }>(
    pool,
    'SELECT id, name FROM lgas ORDER BY name LIMIT 2',
  );
  here = lgas[0]!;
  there = lgas[1]!;

  // The Council's own revenue, in two different Councils.
  await collect({ code: 'MARKET-LEVY', lgaId: here.id, amountKobo: 20_000n, suffix: '00001' });
  await collect({ code: 'MARKET-LEVY', lgaId: here.id, amountKobo: 20_000n, suffix: '00002' });
  await collect({ code: 'SHOPS-KIOSKS', lgaId: here.id, amountKobo: 300_000n, suffix: '00003' });
  await collect({ code: 'MARKET-LEVY', lgaId: there.id, amountKobo: 20_000n, suffix: '00004' });

  // The State's own revenue, collected in the first Council's area.
  await collect({ code: 'INFRA-LEVY', lgaId: here.id, amountKobo: 500_000n, suffix: '00005' });

  // Assessed but never paid for.
  await collect({
    code: 'MARKET-LEVY',
    lgaId: here.id,
    amountKobo: 20_000n,
    suffix: '00006',
    status: 'INVOICE_GENERATED',
  });
});

after(async () => {
  await stopTestServer();
});

describe('what each Council is owed', () => {
  it('gives a Council the revenue collected in its own area', async () => {
    const rows = (await localGovernmentRemittance(pool)) as unknown as {
      lga: string;
      amount_kobo: string;
      transactions: string;
    }[];
    const row = rows.find((r) => r.lga === here.name);
    assert.ok(row, `nothing recorded for ${here.name}`);
    // 200 + 200 + 3,000 in naira. Not the State's infrastructure levy, and
    // not the unpaid invoice.
    assert.equal(row!.amount_kobo, '340000');
    assert.equal(row!.transactions, '3');
  });

  it('does not give one Council another Council’s money', async () => {
    const rows = (await localGovernmentRemittance(pool)) as unknown as {
      lga: string;
      amount_kobo: string;
    }[];
    const other = rows.find((r) => r.lga === there.name);
    assert.ok(other, `nothing recorded for ${there.name}`);
    assert.equal(other!.amount_kobo, '20000');
  });

  it('leaves State revenue out of it', async () => {
    /*
     * An infrastructure levy raised in this Council's area is the State's.
     * Counting it would overstate what the Council is owed by exactly the
     * amount the State took there — the kind of error that is invisible
     * until somebody reconciles and then is very visible indeed.
     */
    const rows = (await localGovernmentRemittance(pool)) as unknown as {
      lga: string;
      amount_kobo: string;
    }[];
    const row = rows.find((r) => r.lga === here.name)!;
    assert.ok(
      !row.amount_kobo.includes('840000'),
      'State revenue has been added to a Council’s share',
    );
    assert.equal(row.amount_kobo, '340000');
  });

  it('counts only revenue a payment confirmed', async () => {
    // The unpaid invoice is real, and it is not money. A remittance figure
    // built on invoices is a promise the platform cannot keep.
    const rows = (await localGovernmentRemittance(pool)) as unknown as {
      lga: string;
      transactions: string;
    }[];
    assert.equal(rows.find((r) => r.lga === here.name)!.transactions, '3');
  });

  it('says which items the money came from, so a Council can check it', async () => {
    const rows = (await localGovernmentRemittance(pool)) as unknown as {
      lga: string;
      items: { code: string; name: string; amount_kobo: string }[];
    }[];
    const row = rows.find((r) => r.lga === here.name)!;
    const codes = row.items.map((i) => i.code).sort();
    assert.deepEqual(codes, ['MARKET-LEVY', 'SHOPS-KIOSKS']);
    const market = row.items.find((i) => i.code === 'MARKET-LEVY')!;
    assert.equal(market.amount_kobo, '40000');
  });

  it('lists a Council that collected nothing rather than dropping it', async () => {
    // Seventeen Councils, and a remittance run has to account for all of
    // them. A Council absent from the list looks the same as one nobody ran
    // the report for.
    const rows = (await localGovernmentRemittance(pool)) as unknown as { lga: string }[];
    const total = await queryOne<{ n: string }>(pool, 'SELECT count(*)::text AS n FROM lgas');
    assert.equal(rows.length, Number(total!.n));
  });
});

describe('the remittance an officer opens', () => {
  it('is on the revenue summary', async () => {
    const response = await get('/government/revenue/summary', { token: adminToken });
    assert.equal(response.status, 200);
    assert.ok('localGovernment' in response.body, 'the summary carries no remittance figures');
    assert.equal(
      (response.body.localGovernment as unknown[]).length > 0,
      true,
      'no Council is listed',
    );
  });
});
