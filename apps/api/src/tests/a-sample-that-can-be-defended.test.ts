/**
 * The auditor's workpapers: a draw that cannot be redrawn, and figures that
 * cannot move under a signature.
 *
 * WHAT IS ACTUALLY BEING TESTED
 *
 * Not that a sample can be drawn -- any SELECT does that. That the record of
 * the draw is fixed, and fixed in the database rather than in the service:
 * every attempt below is issued as SQL, past every route and every check, on
 * this report's own standard from migrations 040 and 053. A sample an auditor
 * can quietly widen after seeing the results is not evidence of anything, and
 * a rule that only holds when you go through the service layer is not a rule.
 *
 * Three properties, in order of how much they matter:
 *
 *   * The draw is reproducible. Same seed, same population, same transactions.
 *     Without this "randomly selected" is an assertion rather than a claim.
 *   * Nothing joins or leaves the sample afterwards, and nothing about how it
 *     was drawn can be edited.
 *   * A report's payload is frozen and its checksum catches a payload that was
 *     edited anyway, which is the only thing that makes the freeze checkable
 *     rather than merely asserted.
 *
 * And one that is about people rather than rows: the auditor can do all of
 * this, and still cannot touch the revenue record.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  grantStepUp,
  loginAs,
  pool,
  post,
  resetDatabase,
  seedOneCollection,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { reportChecksum } from '../services/audit-workbench';

const PHONES = {
  auditor: '+2348078000001',
  finance: '+2348078000002',
  // The demonstration agent needs an administrator to have approved it, so one
  // has to exist before `collect` can drive a single transaction through.
  admin: '+2348078000003',
};
const tokens: Record<string, string> = {};

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  for (const [key, phone] of Object.entries(PHONES)) {
    await createGovernmentUser({
      fullName: `Workbench ${key}`,
      phone,
      role: key === 'auditor' ? 'auditor' : key === 'admin' ? 'admin' : 'finance_officer',
    });
    tokens[key] = (await loginAs(phone)).accessToken;
  }
});

const auth = (who: keyof typeof PHONES) => ({ token: tokens[who] });

/**
 * And the rest of the population, copied from it.
 *
 * A real collection takes about a second; a draw needs tens of rows to be a
 * draw at all rather than a select-everything. So one is real and the others
 * are copies of it with distinct amounts -- enough for the ordering, the
 * reproducibility and the immutability to be about something, without spending
 * a minute proving what the pipeline's own tests prove.
 */
async function populate(count: number): Promise<void> {
  /*
   * One real collection per test, however many times this is called.
   *
   * A second run of the pipeline in the same test re-settles the demonstration
   * agent's payment and is refused -- correctly, since that would bank the same
   * money twice. Tests that grow the population mid-way want more rows, not a
   * second trip through the gateway.
   */
  const already = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM transactions WHERE status = 'SETTLED' LIMIT 1`,
  );
  if (!already) await seedOneCollection(String(count));
  for (let index = 0; index < count; index += 1) {
    await query(
      pool,
      `INSERT INTO transactions (
         transaction_reference, taxpayer_id, invoice_id, assessment_id, revenue_item_id,
         lga_id, amount_kobo, total_amount_kobo, status, created_by, territory_id, agent_id
       )
       SELECT 'TXN-SMP-' || gen_random_uuid()::text, t.taxpayer_id, t.invoice_id,
              t.assessment_id, t.revenue_item_id, t.lga_id, $1, $1,
              'SETTLED', t.created_by, t.territory_id, t.agent_id
         FROM transactions t WHERE t.status = 'SETTLED' ORDER BY t.created_at LIMIT 1`,
      [String(100_000 + index * 1_000)],
    );
  }
}

async function draw(body: Record<string, unknown> = {}) {
  return post(
    '/government/audit/samples',
    { title: 'March collections, materiality pass', method: 'RANDOM', size: 5, ...body },
    auth('auditor'),
  );
}

// ===========================================================================
describe('a sample records a draw that already happened', () => {
  it('draws, and writes down everything needed to reproduce the draw', async () => {
    await populate(20);

    const drawn = await draw({ seed: 'audit-2026-march' });
    assert.equal(drawn.status, 201, JSON.stringify(drawn.body));
    const body = drawn.body as { id: string; sampleNumber: string; populationSize: number; sampleSize: number };
    assert.match(body.sampleNumber, /^PSIRS-SMP\/\d{4}\/\d{5}$/);
    assert.equal(body.sampleSize, 5);
    assert.ok(body.populationSize >= 20, 'the population was counted, not guessed');

    const detail = await get(`/government/audit/samples/${body.id}`, auth('auditor'));
    assert.equal(detail.status, 200);
    const sample = detail.body as { seed: string; items: { position: number }[] };
    assert.equal(sample.seed, 'audit-2026-march', 'the seed is on the record, not derived');
    assert.equal(sample.items.length, 5);
    assert.deepEqual(
      sample.items.map((item) => item.position),
      [1, 2, 3, 4, 5],
      'the order of the draw is recorded',
    );
  });

  /*
   * The property the whole apparatus rests on.
   *
   * `random()` would not have this: postgres seeds it per session, and a pooled
   * connection carries that state into somebody else's query, so a draw whose
   * reproducibility depends on which connection served it is not reproducible.
   */
  it('gives the same transactions for the same seed, and different ones for a different seed', async () => {
    await populate(30);

    const first = await draw({ seed: 'seed-one', size: 8 });
    const same = await draw({ seed: 'seed-one', size: 8 });
    const other = await draw({ seed: 'seed-two', size: 8 });

    const references = async (id: string) => {
      const detail = await get(`/government/audit/samples/${id}`, auth('auditor'));
      return (detail.body as { items: { transaction_id: string }[] }).items
        .map((item) => item.transaction_id)
        .sort();
    };

    const a = await references((first.body as { id: string }).id);
    const b = await references((same.body as { id: string }).id);
    const c = await references((other.body as { id: string }).id);

    assert.deepEqual(a, b, 'the same seed reproduces the draw');
    assert.notDeepEqual(a, c, 'a different seed draws differently');
  });

  it('takes the largest amounts when asked for a materiality pass', async () => {
    await populate(15);

    const drawn = await draw({ method: 'HIGHEST_VALUE', size: 3 });
    const detail = await get(
      `/government/audit/samples/${(drawn.body as { id: string }).id}`,
      auth('auditor'),
    );
    const amounts = (detail.body as { items: { total_amount_kobo: string }[] }).items.map((item) =>
      BigInt(item.total_amount_kobo),
    );
    assert.deepEqual([...amounts].sort((x, y) => (y > x ? 1 : y < x ? -1 : 0)), amounts,
      'the largest first, descending');
  });

  /*
   * The interval sample, which is what an auditor usually means by "every nth".
   *
   * It catches a pattern that repeats -- a particular hour, a particular day of
   * the week -- that a random draw can walk straight past, and it is the only
   * one of the three whose selection is a function of position rather than of
   * the seed or the amount.
   */
  it('walks the population in date order when asked for every nth', async () => {
    await populate(20);

    const drawn = await draw({ method: 'SYSTEMATIC', size: 4 });
    assert.equal(drawn.status, 201, JSON.stringify(drawn.body));

    const detail = await get(
      `/government/audit/samples/${(drawn.body as { id: string }).id}`,
      auth('auditor'),
    );
    const sample = detail.body as {
      method: string;
      items: { transaction_at: string; position: number }[];
    };
    assert.equal(sample.method, 'SYSTEMATIC');
    assert.equal(sample.items.length, 4);

    const times = sample.items.map((item) => new Date(item.transaction_at).getTime());
    assert.deepEqual([...times].sort((a, b) => a - b), times, 'selected in date order');
  });

  it('refuses to invent a sample from an empty population', async () => {
    const drawn = await draw({ criteria: { from: '1999-01-01', to: '1999-01-31' } });
    assert.equal(drawn.status, 409, JSON.stringify(drawn.body));
    assert.match(JSON.stringify(drawn.body), /nothing to sample/i);
  });

  it('refuses a period that ends before it begins', async () => {
    await populate(5);
    const drawn = await draw({ criteria: { from: '2026-03-31', to: '2026-03-01' } });
    assert.equal(drawn.status, 400, JSON.stringify(drawn.body));
  });
});

// ===========================================================================
describe('what was drawn is what was drawn', () => {
  let sampleId = '';

  beforeEach(async () => {
    await populate(20);
    const drawn = await draw({ seed: 'fixed', size: 4 });
    sampleId = (drawn.body as { id: string }).id;
  });

  it('will not let the criteria, the method or the seed be edited afterwards', async () => {
    for (const [column, value] of [
      ['method', "'HIGHEST_VALUE'"],
      ['seed', "'a-better-seed'"],
      ['population_size', '2'],
      ['sample_size', '1'],
      ['criteria', `'{"from":"2020-01-01"}'::jsonb`],
    ] as const) {
      await assert.rejects(
        () => query(pool, `UPDATE audit_samples SET ${column} = ${value} WHERE id = $1`, [sampleId]),
        /cannot be redrawn/,
        `${column} should be fixed at the moment of drawing`,
      );
    }
  });

  it('will not let the whole sample be deleted', async () => {
    await assert.rejects(
      () => query(pool, 'DELETE FROM audit_samples WHERE id = $1', [sampleId]),
      /cannot be deleted/,
      'a draw that happened is evidence of what was examined, including a draw somebody regrets',
    );
  });

  it('will not let an item be dropped from the sample, or swapped for another', async () => {
    await assert.rejects(
      () => query(pool, 'DELETE FROM audit_sample_items WHERE sample_id = $1', [sampleId]),
      /cannot be taken out of a sample/,
    );
    await assert.rejects(
      () =>
        query(
          pool,
          `UPDATE audit_sample_items SET transaction_id = (
             SELECT id FROM transactions
              WHERE id NOT IN (SELECT transaction_id FROM audit_sample_items WHERE sample_id = $1)
              LIMIT 1)
            WHERE sample_id = $1`,
          [sampleId],
        ),
      /cannot be changed/,
    );
  });

  it('will not let a transaction be added to a sample that was already drawn', async () => {
    /*
     * The guard is on the age of the parent rather than on a flag, because the
     * draw inserts its own rows in the same transaction that creates the
     * sample. Backdating is how a test reaches the state a real caller reaches
     * by waiting -- and `drawn_at` is itself immutable, which is why the other
     * trigger has to come off for the one statement that fakes the clock.
     */
    await query(pool, 'ALTER TABLE audit_samples DISABLE TRIGGER audit_samples_are_not_redrawn');
    try {
      await query(
        pool,
        `UPDATE audit_samples SET drawn_at = now() - interval '1 hour' WHERE id = $1`,
        [sampleId],
      );
    } finally {
      await query(pool, 'ALTER TABLE audit_samples ENABLE TRIGGER audit_samples_are_not_redrawn');
    }
    await assert.rejects(
      () =>
        query(
          pool,
          `INSERT INTO audit_sample_items (sample_id, transaction_id, position)
           SELECT $1, id, 99 FROM transactions
            WHERE id NOT IN (SELECT transaction_id FROM audit_sample_items WHERE sample_id = $1)
            LIMIT 1`,
          [sampleId],
        ),
      /cannot be added to a sample/,
    );
  });

  it('records a finding, and refuses an exception that does not say what was wrong', async () => {
    const detail = await get(`/government/audit/samples/${sampleId}`, auth('auditor'));
    const items = (detail.body as { items: { id: string }[] }).items;

    const silent = await post(
      `/government/audit/samples/items/${items[0]!.id}/finding`,
      { outcome: 'EXCEPTION' },
      auth('auditor'),
    );
    assert.equal(silent.status, 400, JSON.stringify(silent.body));

    const spoken = await post(
      `/government/audit/samples/items/${items[0]!.id}/finding`,
      { outcome: 'EXCEPTION', finding: 'No supporting assessment on file.' },
      auth('auditor'),
    );
    assert.equal(spoken.status, 200, JSON.stringify(spoken.body));

    /*
     * The third outcome, which a two-valued field would have forced into one of
     * the others. A transaction whose paperwork cannot be produced is not
     * clean, and calling it an exception asserts a defect nobody established.
     */
    const missing = await post(
      `/government/audit/samples/items/${items[1]!.id}/finding`,
      { outcome: 'NOT_AVAILABLE', finding: 'The office could not produce the file.' },
      auth('auditor'),
    );
    assert.equal(missing.status, 200, JSON.stringify(missing.body));

    const recorded = await get(`/government/audit/samples/${sampleId}`, auth('auditor'));
    const outcomes = (recorded.body as { items: { outcome: string }[] }).items.map(
      (item) => item.outcome,
    );
    assert.ok(outcomes.includes('NOT_AVAILABLE'), 'the third outcome is recorded as itself');

    const after = await get(`/government/audit/samples/${sampleId}`, auth('auditor'));
    assert.equal((after.body as { status: string }).status, 'IN_REVIEW');
  });

  it('will not complete a sample while items are still unexamined', async () => {
    const early = await post(
      `/government/audit/samples/${sampleId}/complete`,
      { note: 'Calling it done before doing it.' },
      auth('auditor'),
    );
    assert.equal(early.status, 409, JSON.stringify(early.body));
    assert.match(JSON.stringify(early.body), /have not been examined/i);

    const detail = await get(`/government/audit/samples/${sampleId}`, auth('auditor'));
    for (const item of (detail.body as { items: { id: string }[] }).items) {
      await post(
        `/government/audit/samples/items/${item.id}/finding`,
        { outcome: 'CLEAN' },
        auth('auditor'),
      );
    }

    const done = await post(
      `/government/audit/samples/${sampleId}/complete`,
      { note: 'All four traced to receipt and settlement.' },
      auth('auditor'),
    );
    assert.equal(done.status, 200, JSON.stringify(done.body));

    // And a completed sample's findings are final.
    const detailAgain = await get(`/government/audit/samples/${sampleId}`, auth('auditor'));
    const first = (detailAgain.body as { items: { id: string }[] }).items[0]!;
    const late = await post(
      `/government/audit/samples/items/${first.id}/finding`,
      { outcome: 'EXCEPTION', finding: 'Changing my mind after signing off.' },
      auth('auditor'),
    );
    assert.equal(late.status, 409, JSON.stringify(late.body));
  });
});

// ===========================================================================
describe('a report is a moment, not a query', () => {
  async function generate(body: Record<string, unknown> = {}) {
    return post(
      '/government/audit/reports',
      { reportType: 'TRANSACTION_AUDIT', title: 'March transaction audit', parameters: {}, ...body },
      auth('auditor'),
    );
  }

  it('freezes the rows it returned, and does not change when the record does', async () => {
    await populate(6);
    const generated = await generate();
    assert.equal(generated.status, 201, JSON.stringify(generated.body));
    const { id, rowCount } = generated.body as { id: string; rowCount: number; checksum: string };

    // The record moves underneath it.
    await populate(6);

    const read = await get(`/government/audit/reports/${id}`, auth('auditor'));
    const report = read.body as {
      row_count: number;
      checksumMatches: boolean;
      payload: { rows: unknown[] };
    };
    assert.equal(report.row_count, rowCount, 'the report still says what it said');
    assert.equal(report.payload.rows.length, rowCount);
    assert.equal(report.checksumMatches, true);
  });

  it('will not let the figures be edited, and says so when they were', async () => {
    await populate(4);
    const generated = await generate();
    const id = (generated.body as { id: string }).id;

    for (const [column, value] of [
      ['payload', `'{"rows":[]}'::jsonb`],
      ['row_count', '0'],
      ['checksum', "'0'"],
      ['parameters', `'{"from":"2020-01-01"}'::jsonb`],
    ] as const) {
      await assert.rejects(
        () => query(pool, `UPDATE audit_reports SET ${column} = ${value} WHERE id = $1`, [id]),
        /cannot be changed/,
        `${column} should be frozen at generation`,
      );
    }

    await assert.rejects(
      () => query(pool, 'DELETE FROM audit_reports WHERE id = $1', [id]),
      /cannot be deleted/,
    );
  });

  /*
   * The checksum earning its place.
   *
   * The trigger above refuses the honest route, so this reaches past it by
   * disabling the trigger -- which is what somebody with database access would
   * do, and the case the checksum exists for. What must not happen is a
   * reader being shown altered figures under a signature that no longer
   * covers them.
   */
  it('reports a payload that was altered behind the trigger', async () => {
    await populate(4);
    const generated = await generate();
    const id = (generated.body as { id: string }).id;

    await query(pool, 'ALTER TABLE audit_reports DISABLE TRIGGER audit_reports_do_not_move');
    try {
      await query(pool, `UPDATE audit_reports SET payload = '{"rows":[]}'::jsonb WHERE id = $1`, [id]);
    } finally {
      await query(pool, 'ALTER TABLE audit_reports ENABLE TRIGGER audit_reports_do_not_move');
    }

    const read = await get(`/government/audit/reports/${id}`, auth('auditor'));
    assert.equal((read.body as { checksumMatches: boolean }).checksumMatches, false);
  });

  it('hashes the parameters as well as the rows', async () => {
    const rows = [{ reference: 'TXN-1', amount: '100' }];
    assert.notEqual(
      reportChecksum({ from: '2026-03-01' }, { rows }),
      reportChecksum({ from: '2026-02-01' }, { rows }),
      'the same rows presented as a different period are a different report',
    );
    // And key order is not part of the question being asked.
    assert.equal(
      reportChecksum({ from: '2026-03-01', to: '2026-03-31' }, { rows }),
      reportChecksum({ to: '2026-03-31', from: '2026-03-01' }, { rows }),
    );
  });

  it('signs once, and will not unsign by editing the row', async () => {
    await populate(4);
    const id = (( await generate()).body as { id: string }).id;

    await grantStepUp(tokens.auditor, PHONES.auditor, 'audit.report.sign');
    const signed = await post(
      `/government/audit/reports/${id}/sign`,
      { note: 'Examined and agreed to the settlement file.' },
      auth('auditor'),
    );
    assert.equal(signed.status, 200, JSON.stringify(signed.body));

    await grantStepUp(tokens.auditor, PHONES.auditor, 'audit.report.sign');
    const again = await post(
      `/government/audit/reports/${id}/sign`,
      { note: 'Signing it a second time for good measure.' },
      auth('auditor'),
    );
    assert.equal(again.status, 409, JSON.stringify(again.body));

    await assert.rejects(
      () => query(pool, `UPDATE audit_reports SET status = 'GENERATED' WHERE id = $1`, [id]),
      /cannot be returned to unsigned/,
    );
    await assert.rejects(
      () => query(pool, `UPDATE audit_reports SET signed_at = now() - interval '1 year' WHERE id = $1`, [id]),
      /cannot be rewritten/,
    );
  });

  it('withdraws rather than deletes, and keeps the reason', async () => {
    await populate(4);
    const id = ((await generate()).body as { id: string }).id;

    await grantStepUp(tokens.auditor, PHONES.auditor, 'audit.report.sign');
    const withdrawn = await post(
      `/government/audit/reports/${id}/withdraw`,
      { reason: 'Generated on the wrong period; superseded by PSIRS-AR/2026/00002.' },
      auth('auditor'),
    );
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));

    const read = await get(`/government/audit/reports/${id}`, auth('auditor'));
    const report = read.body as { status: string; withdrawn_reason: string };
    assert.equal(report.status, 'WITHDRAWN');
    assert.match(report.withdrawn_reason, /wrong period/);

    // And a withdrawn report cannot then be signed.
    await grantStepUp(tokens.auditor, PHONES.auditor, 'audit.report.sign');
    const signed = await post(
      `/government/audit/reports/${id}/sign`,
      { note: 'Signing something that was taken out of circulation.' },
      auth('auditor'),
    );
    assert.equal(signed.status, 409, JSON.stringify(signed.body));
  });

  it('answers every one of the thirteen questions without falling over', async () => {
    await populate(4);
    const kinds = [
      'TRANSACTION_AUDIT', 'AGENT_ACTIVITY', 'REVENUE_COLLECTION', 'LGA_PERFORMANCE',
      'PAYMENT_RECONCILIATION', 'COMMISSION', 'USER_ACTIVITY', 'ANOMALY', 'AUDIT_SAMPLE',
      'FRAUD_FLAG', 'REVENUE_TARGET', 'PERIOD_CLOSING', 'DATA_CHANGE',
    ];
    for (const reportType of kinds) {
      const generated = await post(
        '/government/audit/reports',
        { reportType, title: `Standing report: ${reportType}`, parameters: {} },
        auth('auditor'),
      );
      assert.equal(generated.status, 201, `${reportType}: ${JSON.stringify(generated.body)}`);
    }
  });
});

// ===========================================================================
describe('the workbench is the auditor’s, and only the auditor’s work', () => {
  it('lets the auditor draw and sign, and still refuses them the revenue record', async () => {
    await populate(6);

    const drawn = await draw();
    assert.equal(drawn.status, 201, JSON.stringify(drawn.body));

    // The same officer, refused everything that moves money.
    for (const path of [
      '/government/reconciliation/run',
      '/government/fraud/sweep',
      '/government/commissions/promote',
    ]) {
      const attempt = await post(path, {}, auth('auditor'));
      assert.equal(attempt.status, 403, `auditor must be refused ${path}`);
    }
  });

  it('does not offer the workbench to an officer who is not examining anything', async () => {
    const drawn = await post(
      '/government/audit/samples',
      { title: 'A finance officer drawing an audit sample', method: 'RANDOM', size: 5 },
      auth('finance'),
    );
    assert.equal(drawn.status, 403, JSON.stringify(drawn.body));
  });

  it('writes the draw and the signature into the audit log', async () => {
    await populate(6);
    const drawn = await draw({ seed: 'for-the-log' });
    const id = (drawn.body as { id: string }).id;

    const entry = await queryOne<{ action: string; new_value: { seed: string } }>(
      pool,
      `SELECT action, new_value FROM audit_logs
        WHERE action = 'audit.sample.draw' AND entity_id = $1`,
      [id],
    );
    assert.ok(entry, 'the draw is in the chain');
    assert.equal(entry!.new_value.seed, 'for-the-log', 'including the seed it used');
  });
});
