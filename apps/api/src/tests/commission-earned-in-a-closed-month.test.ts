/**
 * Commission earned in a month that has since been closed.
 *
 * A commission is created when the payment it is earned on is verified and
 * paid weeks later — ELIGIBLE once the money settles and the hold passes,
 * APPROVED when the agent asks, PAID when the bank pays. Migration 058 locked
 * every commission row in a closed month against any write, so that whole
 * life stopped at the close. Measured, with last month closed over one
 * ELIGIBLE commission and one PENDING one due for promotion: promotion threw,
 * and because it promotes every due commission in one database transaction,
 * nothing anywhere became payable; the agent's payout request threw too, and
 * a payout takes every ELIGIBLE commission they have, so they could be paid
 * nothing at all.
 *
 * Migration 094 locks what the close froze — each commission's amount and
 * month, and whether it is REVERSED — and nothing else.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernmentUser, pool, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { promoteEligibleCommissions, requestPayout } from '../services/commission';

let officerId = '';
let agentId = '';
let agentUserId = '';
let sequence = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  officerId = await createGovernmentUser({
    role: 'finance_officer',
    phone: '+2348098900001',
    fullName: 'Commission Officer',
  });
  await createGovernmentUser({ role: 'admin', phone: '+2348098900002', fullName: 'Commission Admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must seed');
  const row = await queryOne<{ id: string; user_id: string }>(
    pool,
    'SELECT a.id, a.user_id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  );
  agentId = row!.id;
  agentUserId = row!.user_id;
  sequence = 0;
});

function lastMonth() {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
    during: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 10)),
  };
}

/**
 * A settled collection last month, and the commission the agent earned on it.
 * Written as rows rather than collected through the handset, because the
 * month it is dated in is the whole point and `created_at` is set only once.
 */
async function earnedLastMonth(status: 'PENDING' | 'ELIGIBLE'): Promise<string> {
  sequence += 1;
  const suffix = String(sequence).padStart(2, '0');
  const when = lastMonth().during;
  const item = await queryOne<{ id: string; rate_id: string }>(
    pool,
    `SELECT ri.id, r.id AS rate_id
       FROM revenue_items ri JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE ri.code = 'MARKET-LEVY' LIMIT 1`,
  );
  const taxpayer = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source)
     VALUES ('INDIVIDUAL','Closed',$1,$2,'3 Market Rd',(SELECT id FROM lgas ORDER BY name LIMIT 1),
             'ACTIVE','AGENT')
     RETURNING id`,
    [`Month${suffix}`, `+2348098910${suffix}`],
  );
  const assessment = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO assessments
       (assessment_number, taxpayer_id, revenue_item_id, rate_version_id, computation_inputs,
        computation_trace, base_amount_kobo, amount_kobo, lga_id, status, created_by)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb,50000,50000,
             (SELECT id FROM lgas ORDER BY name LIMIT 1),'INVOICED',$5)
     RETURNING id`,
    [`ASMT-CLS-${suffix}`, taxpayer!.id, item!.id, item!.rate_id, officerId],
  );
  const invoice = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO invoices
       (invoice_number, assessment_id, taxpayer_id, amount_kobo, total_amount_kobo,
        verification_code, created_by)
     VALUES ($1,$2,$3,50000,50000,$4,$5) RETURNING id`,
    [`INV-CLS-${suffix}`, assessment!.id, taxpayer!.id, `CLS${suffix}`, officerId],
  );
  const transaction = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO transactions
       (transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id, agent_id,
        amount_kobo, total_amount_kobo, status, lga_id, channel, created_by, created_at, settled_at)
     VALUES ($1,$2,$3,$4,$5,$6,50000,50000,'SETTLED',(SELECT id FROM lgas ORDER BY name LIMIT 1),
             'AGENT_PWA',$7,$8,$8)
     RETURNING id`,
    [`CLS-${suffix}-0001`, taxpayer!.id, invoice!.id, assessment!.id, item!.id, agentId, officerId, when],
  );
  const commission = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO commissions
       (agent_id, transaction_id, policy_id, rate_basis_points, basis_amount_kobo, amount_kobo,
        status, eligible_at, created_at)
     VALUES ($1,$2,(SELECT id FROM commission_policies LIMIT 1),500,50000,2500,$3,
             CASE WHEN $3 = 'ELIGIBLE' THEN now() END,$4)
     RETURNING id`,
    [agentId, transaction!.id, status, when],
  );
  return commission!.id;
}

async function closeLastMonth() {
  await query(
    pool,
    `INSERT INTO financial_periods (label, period_start, period_end, status, closed_at, closed_by, closing_note)
     VALUES ('Last month', $1, $2, 'CLOSED', now(), $3, 'Reconciled and reported.')`,
    [lastMonth().start, lastMonth().end, officerId],
  );
}

const statusOf = async (id: string) =>
  (await queryOne<{ status: string }>(pool, 'SELECT status FROM commissions WHERE id = $1', [id]))!.status;

describe('commission earned in a month since closed', () => {
  it('still becomes payable, and is paid', async () => {
    const due = await earnedLastMonth('PENDING');
    const ready = await earnedLastMonth('ELIGIBLE');
    await closeLastMonth();

    assert.equal(await promoteEligibleCommissions(), 1, 'nothing anywhere was promoted');
    assert.equal(await statusOf(due), 'ELIGIBLE');

    const payout = await requestPayout({ agentId, actorId: agentUserId, actorRole: 'agent' });
    assert.ok(payout.payoutId, 'the agent could be paid nothing at all');
    assert.deepEqual([await statusOf(due), await statusOf(ready)], ['APPROVED', 'APPROVED']);
  });

  it('cannot be clawed back while its month is closed', async () => {
    // That would take it out of the commission figure the close froze. (Its
    // amount cannot change at all: the immutability trigger holds that.)
    const id = await earnedLastMonth('ELIGIBLE');
    await closeLastMonth();
    await assert.rejects(
      query(pool, `UPDATE commissions SET status = 'REVERSED' WHERE id = $1`, [id]),
      /is closed; the commissions in it cannot be changed/,
    );
  });

  it('cannot be written into the closed month', async () => {
    await closeLastMonth();
    await assert.rejects(earnedLastMonth('PENDING'), /is closed/);
  });
});
