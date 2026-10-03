/**
 * A fraud rule an agent could switch off by doing more of their job.
 *
 * REVERSAL_PATTERN is HIGH severity and watches the oldest fraud in revenue
 * collection: take the cash, reverse the electronic record, keep the
 * difference. It fires when an agent's reversal rate passes fifteen per cent
 * over a thirty-day window, on a minimum sample of ten.
 *
 * It divided the reversals by `count(*)` of every transaction the agent had
 * in those thirty days. A transaction row exists from INITIATED onward — one
 * per assessment raised — so that count is dominated by assessments nobody
 * paid. Nothing can reverse an unpaid assessment, and an agent raises as many
 * of them as they like.
 *
 * MEASURED BEFORE ANYTHING WAS CHANGED
 *
 *   8 settled + 2 reversed        -> 20.0%, flag raised, sample 10
 *   the same, + 20 unpaid         ->  6.7%, no flag at all
 *
 * Same collections, same reversals, and the flag disappears. The denominator
 * that hid the agent is the one the agent controls.
 *
 * AND IT COULD FIRE TOO EARLY, WHICH IS THE SAME FAULT POINTING THE OTHER WAY
 *
 * `reversalMinimumSample` is ten, and a minimum sample for a reversal rate
 * has to mean ten things that could be reversed. On the old count it meant
 * ten transactions, so nine collections and one unpaid assessment cleared a
 * minimum the agent had not actually reached — a HIGH flag on an agent's
 * commission, from a sample the threshold was written to refuse.
 *
 * WHY THE DENOMINATOR INCLUDES THE REVERSALS
 *
 * Recognised states plus returned ones. A reversed collection was recognised
 * once; a denominator of recognised-only would drop the numerator's own rows
 * and overstate the rate in the other direction.
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

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  // An approver has to exist before the demonstration agent can collect.
  await createGovernmentUser({
    fullName: 'Reversal Officer',
    phone: '+2348079300001',
    role: 'admin',
  });
  const transactionId = await seedOneCollection('1');
  const agent = await queryOne<{ agent_id: string }>(
    pool,
    'SELECT agent_id::text FROM transactions WHERE id = $1',
    [transactionId],
  );
  agentId = agent!.agent_id;
});

const sweep = () => withTransaction((client) => runFraudSweep(client));

/**
 * Copies of the seeded collection for this agent, at a chosen status.
 *
 * The seeded one is real and went through the whole pipeline; these are rows
 * in the states the pipeline leaves behind. What is under test is which rows
 * a rate is taken over, so the states are the subject and the collection path
 * is not.
 */
async function clone(count: number, status: string, prefix: string): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await query(
      pool,
      `INSERT INTO transactions (
         transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
         lga_id, amount_kobo, total_amount_kobo, status, created_by, territory_id, agent_id
       )
       SELECT $2 || '-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
              t.assessment_id, t.revenue_item_id, t.lga_id, t.amount_kobo,
              t.total_amount_kobo, $3, t.created_by, t.territory_id, t.agent_id
         FROM transactions t WHERE t.agent_id = $1 ORDER BY t.created_at LIMIT 1`,
      [agentId, prefix, status],
    );
  }
}

/** The seeded collection counts as one of the settled ones. */
const settled = (n: number) => clone(n - 1, 'SETTLED', 'TXN-SET');
const reversed = (n: number) => clone(n, 'REVERSED', 'TXN-REV');

/**
 * An assessment nobody paid rests at INVOICE_GENERATED.
 *
 * The first version of this used ASSESSMENT_CREATED, which is not a state a
 * transaction ever rests in: the row is created already INVOICE_GENERATED,
 * because the assessment and the invoice are made together, and
 * ASSESSMENT_CREATED exists as an event in `transaction_events` instead. The
 * enum-coverage guard said so — it keeps a list of states the platform cannot
 * produce and fails when the suite writes one, which is the whole point:
 * every test passed and the fixture was describing a world that does not
 * exist. The dilution behaves identically with the real state, which was
 * re-measured rather than assumed.
 */
const unpaid = (n: number) => clone(n, 'INVOICE_GENERATED', 'TXN-UNP');

async function reversalFlag(): Promise<{ detail: Record<string, number> } | undefined> {
  const rows = await query<{ detail: Record<string, number> }>(
    pool,
    `SELECT detail FROM fraud_flags WHERE agent_id = $1 AND rule = 'REVERSAL_PATTERN'`,
    [agentId],
  );
  return rows[0];
}

describe('an agent reversing a fifth of what they collect', () => {
  it('is flagged', async () => {
    await settled(8);
    await reversed(2);

    await sweep();

    const flag = await reversalFlag();
    assert.ok(flag, 'two reversals in ten collections is twenty per cent and is the rule');
    assert.equal(flag!.detail.reversalRatePercent, 20);
    assert.equal(flag!.detail.sample, 10, 'the sample is the collections the rate was taken over');
    assert.equal(flag!.detail.returned, 2);
  });

  it('is still flagged after raising twenty assessments nobody paid', async () => {
    // THE DEFECT. Identical collections, identical reversals. Only the count
    // of unpaid assessments differs, and nothing can reverse one of those.
    await settled(8);
    await reversed(2);
    await unpaid(20);

    await sweep();

    const flag = await reversalFlag();
    assert.ok(
      flag,
      'the flag disappeared because the agent also raised assessments nobody paid — ' +
        'a denominator the agent controls, hiding the pattern the rule is named for',
    );
    assert.equal(
      flag!.detail.reversalRatePercent,
      20,
      'the rate must not move when work that cannot be reversed is added beside it',
    );
    assert.equal(flag!.detail.sample, 10, 'the unpaid assessments are not part of the sample');
  });

  it('is flagged the same whatever unpaid state the transactions rest in', async () => {
    /*
     * Every resting state before money arrives, and the two ways it does not.
     * A fix that named one of them would pass the case above and leak the
     * rest back into the denominator.
     *
     * ASSESSMENT_CREATED and CANCELLED are deliberately absent: the
     * enum-coverage guard declares them unreachable on this column, and a
     * fixture writing a state the platform cannot produce proves nothing
     * about it.
     */
    await settled(8);
    await reversed(2);
    await clone(6, 'INVOICE_GENERATED', 'TXN-I');
    await clone(6, 'PAYMENT_INITIATED', 'TXN-P');
    await clone(6, 'PAYMENT_PENDING', 'TXN-D');
    await clone(6, 'FAILED', 'TXN-F');
    await clone(6, 'EXPIRED', 'TXN-E');

    await sweep();

    const flag = await reversalFlag();
    assert.ok(flag, 'one of the pre-payment or abandoned states is still in the denominator');
    assert.equal(flag!.detail.sample, 10);
  });
});

describe('the minimum sample', () => {
  it('is not reached by an unpaid assessment standing in for a collection', async () => {
    /*
     * Nine collections, three reversed. Thirty-three per cent, which is well
     * over the threshold — and nine is under the minimum sample of ten, so no
     * flag is correct.
     *
     * One unpaid assessment used to make the total ten and raise it: a HIGH
     * flag against an agent's commission, from a sample the threshold exists
     * to refuse.
     */
    await settled(6);
    await reversed(3);
    await unpaid(1);

    await sweep();

    assert.equal(
      await reversalFlag(),
      undefined,
      'nine collections is under the minimum of ten; an unpaid assessment is not a ' +
        'tenth collection and must not complete the sample',
    );
  });

  it('is reached by a tenth collection', async () => {
    // The bound, and the line between the two cases: one more collection —
    // not one more transaction — is what makes the sample.
    await settled(7);
    await reversed(3);

    await sweep();

    const flag = await reversalFlag();
    assert.ok(flag, 'ten collections with three reversed is the rule, and the sample is met');
    assert.equal(flag!.detail.sample, 10);
    assert.equal(flag!.detail.returned, 3);
  });
});

describe('an agent whose reversals are ordinary', () => {
  it('is left alone, so the queue stays worth reading', async () => {
    // Twenty-one collections, one reversed: four point eight per cent. A rule
    // that fired here would cost an agent their commission for a refund.
    await settled(20);
    await reversed(1);

    await sweep();

    assert.equal(await reversalFlag(), undefined, 'one reversal in twenty-one is not a pattern');
  });

  it('is left alone when they have reversed nothing at all', async () => {
    await settled(15);

    await sweep();

    assert.equal(await reversalFlag(), undefined);
  });
});
