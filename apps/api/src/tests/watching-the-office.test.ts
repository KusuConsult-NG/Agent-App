/**
 * The four anomaly rules that watch the platform's own people.
 *
 * Every rule the fraud engine had asked whether an *agent* was behaving oddly:
 * collecting too fast, out of territory, on a shared phone, reversing too much.
 * None of them could see an officer at all, which is the wrong way round. The
 * field can steal a receipt; the back office can rewrite what a receipt says.
 *
 * WHAT EACH RULE HAS TO GET RIGHT
 *
 * A flag costs an officer's attention and, on an agent, their commission. So
 * each test below checks the rule fires on the shape it is for *and* stays
 * quiet on the ordinary case next to it — a rule that fires on a busy Monday
 * teaches the queue's readers to ignore it, which is worse than not having it.
 *
 *   * Repeated receipt regeneration — several documents for one entity, and
 *     one person pulling the same document down again and again.
 *   * Unusual transaction timing — a habit of collections written in the small
 *     hours, read in Africa/Lagos rather than in UTC.
 *   * Unusual officer activity — against the officer's own preceding weeks,
 *     never against a fleet average, and never against a baseline of zero.
 *   * Frequent manual intervention — the pattern nobody sees, because each
 *     correction was looked at once, alone, weeks apart.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  pool,
  resetDatabase,
  seedOneCollection,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { runFraudSweep } from '../services/fraud';

let agentId = '';
let officerId = '';
let transactionId = '';

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
    fullName: 'Watched Officer',
    phone: '+2348079000001',
    role: 'admin',
  });
  transactionId = await seedOneCollection('1');
  const agent = await queryOne<{ agent_id: string }>(
    pool,
    'SELECT agent_id::text FROM transactions WHERE id = $1',
    [transactionId],
  );
  agentId = agent!.agent_id;
});

const sweep = () => withTransaction((client) => runFraudSweep(client));

async function flagsFor(rule: string) {
  return query<{ rule: string; entity_type: string; entity_id: string; detail: Record<string, unknown> }>(
    pool,
    'SELECT rule, entity_type, entity_id::text, detail FROM fraud_flags WHERE rule = $1',
    [rule],
  );
}

/** A document against the transaction, as many times as asked. */
async function issueDocuments(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO documents (
         document_number, document_type, owner_type, owner_id, entity_type, entity_id,
         storage_reference, byte_size, checksum, verification_code, issuing_authority
       )
       SELECT 'PSIRS-RCT/' || gen_random_uuid()::text, 'RECEIPT', 'TAXPAYER', t.taxpayer_id,
              'transaction', t.id, 'memory://' || gen_random_uuid()::text, 1024,
              md5(random()::text), upper(substr(md5(random()::text), 1, 10)), 'PSIRS'
         FROM transactions t WHERE t.id = $1
       RETURNING id`,
      [transactionId],
    );
    ids.push(row!.id);
  }
  return ids;
}

// ===========================================================================
describe('a document that should exist once, existing several times', () => {
  it('flags a receipt issued again and again for the same transaction', async () => {
    const documents = await issueDocuments(3);
    await sweep();

    const flags = await flagsFor('REPEATED_RECEIPT_REGENERATION');
    assert.equal(flags.length, 1, JSON.stringify(flags));
    assert.equal(flags[0]!.entity_type, 'DOCUMENT');
    assert.equal(flags[0]!.entity_id, documents[documents.length - 1], 'against the latest issue');
    assert.equal(flags[0]!.detail.reason, 'REISSUED');
    assert.equal(flags[0]!.detail.documentsIssued, 3);
  });

  it('says nothing about a reversal and a single reissue', async () => {
    await issueDocuments(2);
    await sweep();
    assert.deepEqual(await flagsFor('REPEATED_RECEIPT_REGENERATION'), []);
  });

  it('flags one person fetching the same document over and over', async () => {
    const [document] = await issueDocuments(1);
    for (let index = 0; index < 13; index += 1) {
      await query(
        pool,
        `INSERT INTO document_access_logs (document_id, accessed_by, access_type)
         VALUES ($1, $2, 'DOWNLOAD')`,
        [document, officerId],
      );
    }
    await sweep();

    const flags = await flagsFor('REPEATED_RECEIPT_REGENERATION');
    assert.equal(flags.length, 1, JSON.stringify(flags));
    assert.equal(flags[0]!.detail.reason, 'RETRIEVED');
    assert.equal(flags[0]!.detail.byUserId, officerId);
  });

  /*
   * The count is per person for a reason: a receipt a hundred citizens verify
   * is a receipt doing its job. Counting retrievals per document would flag
   * the most useful documents on the platform.
   */
  it('says nothing about a popular document fetched once each by many people', async () => {
    const [document] = await issueDocuments(1);
    for (let index = 0; index < 20; index += 1) {
      const reader = await createGovernmentUser({
        fullName: `Reader ${index}`,
        phone: `+23480790100${String(index).padStart(2, '0')}`,
        role: 'auditor',
      });
      await query(
        pool,
        `INSERT INTO document_access_logs (document_id, accessed_by, access_type)
         VALUES ($1, $2, 'DOWNLOAD')`,
        [document, reader],
      );
    }
    await sweep();
    assert.deepEqual(await flagsFor('REPEATED_RECEIPT_REGENERATION'), []);
  });
});

// ===========================================================================
describe('collections written in the middle of the night', () => {
  /** Backdate the seeded transaction into a given local hour, `count` times. */
  async function collectionsAt(hour: number, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await query(
        pool,
        `INSERT INTO transactions (
           transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
           lga_id, amount_kobo, total_amount_kobo, status, created_by, agent_id, created_at
         )
         SELECT 'TXN-NGT-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
                t.assessment_id, t.revenue_item_id, t.lga_id, 100000, 100000,
                'SETTLED', t.created_by, t.agent_id,
                (date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') - interval '1 day'
                  + ($1 || ' hours')::interval) AT TIME ZONE 'Africa/Lagos'
           FROM transactions t WHERE t.id = $2`,
        [String(hour), transactionId],
      );
    }
  }

  it('flags an agent with a habit of collections at two in the morning', async () => {
    await collectionsAt(2, 7);
    await sweep();

    const flags = await flagsFor('UNUSUAL_TRANSACTION_TIMING');
    assert.equal(flags.length, 1, JSON.stringify(flags));
    assert.equal(flags[0]!.entity_type, 'AGENT');
    assert.equal(flags[0]!.entity_id, agentId);
    assert.equal(flags[0]!.detail.timeZone, 'Africa/Lagos');
    assert.ok(Number(flags[0]!.detail.nightTransactionsInLastWeek) >= 7);
  });

  /*
   * A motor park at eight in the evening is a working place, and a market that
   * closes at ten closes at ten. The window has to leave both alone or the
   * rule is a report on ordinary trading hours.
   */
  it('says nothing about a busy evening', async () => {
    await collectionsAt(20, 12);
    await sweep();
    assert.deepEqual(await flagsFor('UNUSUAL_TRANSACTION_TIMING'), []);
  });

  it('says nothing about one late transaction', async () => {
    await collectionsAt(2, 2);
    await sweep();
    assert.deepEqual(await flagsFor('UNUSUAL_TRANSACTION_TIMING'), []);
  });
});

// ===========================================================================
describe('an officer whose day does not look like their other days', () => {
  /** Audit entries attributed to the officer, `count` of them, `daysAgo` old. */
  async function activity(count: number, daysAgo: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await query(
        pool,
        `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, hash, created_at)
         VALUES ($1, 'admin', 'taxpayer.corrected', 'taxpayer', gen_random_uuid()::text,
                 md5(random()::text), now() - ($2 || ' days')::interval)`,
        [officerId, String(daysAgo)],
      );
    }
  }

  it('flags a day several times the officer’s own usual', async () => {
    // Roughly two a day for a fortnight, then a hundred in one day.
    for (let day = 2; day <= 15; day += 1) await activity(2, day);
    await activity(100, 0);
    await sweep();

    const flags = await flagsFor('UNUSUAL_OFFICER_ACTIVITY');
    assert.equal(flags.length, 1, JSON.stringify(flags));
    assert.equal(flags[0]!.entity_type, 'USER');
    assert.equal(flags[0]!.entity_id, officerId);
    assert.ok(Number(flags[0]!.detail.multiple) > 4);
  });

  /*
   * The floor, doing its job. Four times a baseline of two is eight actions,
   * which is a Tuesday; without the floor the rule would spend its life
   * reporting officers who normally do very little and today did a little more.
   */
  it('says nothing when the multiple is large but the day is small', async () => {
    for (let day = 2; day <= 15; day += 1) await activity(1, day);
    await activity(20, 0);
    await sweep();
    assert.deepEqual(await flagsFor('UNUSUAL_OFFICER_ACTIVITY'), []);
  });

  /*
   * A new officer's first working day is not a spike. Dividing by a baseline
   * of zero would make every joiner's first afternoon an anomaly and teach the
   * queue's readers to dismiss the rule.
   */
  it('says nothing about an officer’s very first day', async () => {
    await activity(200, 0);
    await sweep();
    assert.deepEqual(await flagsFor('UNUSUAL_OFFICER_ACTIVITY'), []);
  });

  it('says nothing about a busy officer who is always this busy', async () => {
    for (let day = 1; day <= 15; day += 1) await activity(80, day);
    await activity(90, 0);
    await sweep();
    assert.deepEqual(await flagsFor('UNUSUAL_OFFICER_ACTIVITY'), []);
  });
});

// ===========================================================================
describe('how often one officer has had to change the record by hand', () => {
  async function corrections(count: number, approvalType = 'MANUAL_CORRECTION'): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await query(
        pool,
        `INSERT INTO approvals (
           approval_type, entity_type, entity_id, payload, status,
           requested_by, requested_reason, decision_reason
         ) VALUES ($1, 'transaction', gen_random_uuid()::text, '{}'::jsonb, 'APPROVED', $2,
                   'Correcting a figure the upstream register got wrong.', $3)`,
        [approvalType, officerId, 'Agreed; the register was wrong.'],
      );
    }
  }

  it('flags the pattern nobody sees, because each one was looked at alone', async () => {
    await corrections(16);
    await sweep();

    const flags = await flagsFor('FREQUENT_MANUAL_INTERVENTION');
    assert.equal(flags.length, 1, JSON.stringify(flags));
    assert.equal(flags[0]!.entity_type, 'USER');
    assert.equal(flags[0]!.entity_id, officerId);
    assert.equal(flags[0]!.detail.interventionsInLastMonth, 16);
    assert.deepEqual(flags[0]!.detail.kinds, ['MANUAL_CORRECTION']);
  });

  it('says nothing about an ordinary month of corrections', async () => {
    await corrections(10);
    await sweep();
    assert.deepEqual(await flagsFor('FREQUENT_MANUAL_INTERVENTION'), []);
  });

  /*
   * Only decided interventions count. A request somebody made and nobody
   * granted changed nothing, and counting it would let one officer's rejected
   * requests raise a flag against them.
   */
  it('does not count corrections that were never approved', async () => {
    for (let index = 0; index < 20; index += 1) {
      await query(
        pool,
        `INSERT INTO approvals (
           approval_type, entity_type, entity_id, payload, status,
           requested_by, requested_reason, decision_reason
         ) VALUES ('MANUAL_CORRECTION', 'transaction', gen_random_uuid()::text, '{}'::jsonb,
                   'REJECTED', $1, 'Asked for, and refused.', 'No evidence the figure was wrong.')`,
        [officerId],
      );
    }
    await sweep();
    assert.deepEqual(await flagsFor('FREQUENT_MANUAL_INTERVENTION'), []);
  });
});

// ===========================================================================
describe('the sweep as a whole', () => {
  /*
   * The engine raises a signal for a person to review. It never blocks, never
   * deletes and never decides — PRD §32 — and a new rule that quietly acquired
   * teeth would be the one change nobody would notice from the flag queue.
   */
  it('changes nothing but the flag queue', async () => {
    await issueDocuments(4);
    await corrections();
    const before = await snapshot();
    await sweep();
    assert.deepEqual(await snapshot(), before, 'the sweep wrote no record but its own flags');
  });

  async function corrections(): Promise<void> {
    for (let index = 0; index < 16; index += 1) {
      await query(
        pool,
        `INSERT INTO approvals (
           approval_type, entity_type, entity_id, payload, status, requested_by,
           requested_reason, decision_reason
         ) VALUES ('MANUAL_CORRECTION', 'transaction', gen_random_uuid()::text, '{}'::jsonb,
                   'APPROVED', $1, 'A correction that will be counted.', 'Agreed.')`,
        [officerId],
      );
    }
  }

  async function snapshot() {
    const row = await queryOne<Record<string, string>>(
      pool,
      `SELECT (SELECT count(*)::text FROM transactions) AS transactions,
              (SELECT count(*)::text FROM documents) AS documents,
              (SELECT count(*)::text FROM approvals) AS approvals,
              (SELECT count(*)::text FROM commissions) AS commissions,
              (SELECT coalesce(sum(amount_kobo), 0)::text FROM transactions) AS collected`,
    );
    return row;
  }
});
