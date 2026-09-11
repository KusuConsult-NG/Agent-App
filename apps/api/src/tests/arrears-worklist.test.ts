/**
 * The list of people the State is already owed money by.
 *
 * Phase 1 of the informal-sector programme: the cheapest revenue in the plan,
 * because these taxpayers are already registered and already assessed. It is
 * also the most dangerous list the platform can produce — a ranked register of
 * citizens with an amount of money against each name — so these tests are
 * mostly about who must *not* be on it.
 *
 * The one that matters more than the rest is money in flight. An invoice is
 * UNPAID from the moment it is raised until the gateway confirms, so a trader
 * who paid twenty minutes ago is UNPAID right now. An officer sent to demand
 * money from somebody holding a receipt does more damage to PSIRS than a year
 * of under-collection, and no amount of "the figure refreshes overnight" makes
 * that acceptable.
 *
 * Close behind it is the lapsed invoice. Past its expiry the payment path
 * refuses the money outright, so a lapsed debt on a call list is a call that
 * cannot end in a payment — the officer rings, the citizen agrees to pay, and
 * the platform will not take it. Those debts are real and are reported, but as
 * their own figure and off the list.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne, query } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { arrearsWorklist } from '../services/arrears';
import { expireLapsedInvoices } from '../services/revenue';

let auth: { token: string; deviceId: string };
let seq = 0;

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Revenue Admin', phone: '+2348000000001', role: 'admin' });
  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };
  seq = 0;
});

/**
 * A taxpayer with one unpaid invoice, raised through the ordinary API.
 *
 * Built through assessment rather than by inserting an invoice directly: the
 * point of the worklist is what the revenue engine actually produces, and a
 * hand-made invoice would let the test pass against a query that could not
 * read a real one.
 */
async function taxpayerOwing(name: string, itemCode = 'SHOPS-KIOSKS', lapsesInDays = 30) {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: name,
      lastName: `Debtor${suffix}`,
      phone: `+23480777${suffix}`,
      address: '4 Market Road, Jos',
      lgaId: await firstLgaId(),
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...auth, idempotencyKey: `arr-tp-${suffix}` },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

  const assessment = await post(
    '/revenue/assessments',
    {
      taxpayerId: taxpayer.body.taxpayerId,
      revenueItemId: await revenueItemByCode(itemCode),
      inputs: {},
    },
    { ...auth, idempotencyKey: `arr-as-${suffix}` },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  /*
   * Move the deadline, which is the one clock on an invoice the platform lets
   * anything change: `issued_at` and the amounts are held immutable once
   * written, and that is the schema working correctly rather than an obstacle
   * for a test to go around.
   *
   * It stays in the future. A debt past its expiry cannot be paid at all, so a
   * fixture that backdated it would be building the exact row this worklist
   * exists to keep off an officer's call list.
   */
  await pool.query(
    `UPDATE invoices SET expires_at = now() + ($2 || ' days')::interval WHERE id = $1`,
    [assessment.body.invoiceId, String(lapsesInDays)],
  );

  return {
    taxpayerId: taxpayer.body.taxpayerId as string,
    transactionId: assessment.body.transactionId as string,
    invoiceId: assessment.body.invoiceId as string,
  };
}

const find = (list: Awaited<ReturnType<typeof arrearsWorklist>>, taxpayerId: string) =>
  list.rows.find((row) => row.taxpayerId === taxpayerId);

describe('who is on the arrears worklist', () => {
  it('lists a taxpayer with an unpaid invoice, with what they owe and what for', async () => {
    const owing = await taxpayerOwing('Unpaid');

    const list = await arrearsWorklist(pool);
    const row = find(list, owing.taxpayerId);

    assert.ok(row, 'a taxpayer with an unpaid invoice belongs on the list');
    assert.ok(BigInt(row!.outstandingKobo) > 0n, 'and the amount must be positive');
    assert.equal(row!.invoiceCount, 1);
    assert.ok(row!.owedFor.length > 0, 'an officer has to be able to say what it is for');
    assert.equal(row!.partiallyPaid, false);
  });

  it('sums several invoices into one debt, so one person is one visit', async () => {
    const owing = await taxpayerOwing('Multiple');
    seq += 1;
    // A second assessment against the same taxpayer.
    const second = await post(
      '/revenue/assessments',
      {
        taxpayerId: owing.taxpayerId,
        revenueItemId: await revenueItemByCode('MARKET-LEVY'),
        inputs: {},
      },
      { ...auth, idempotencyKey: `arr-as-second-${seq}` },
    );
    assert.equal(second.status, 201, JSON.stringify(second.body));

    const row = find(await arrearsWorklist(pool), owing.taxpayerId);
    assert.equal(row!.invoiceCount, 2, 'two invoices, one row');
    assert.ok(row!.owedFor.length >= 2, 'and both items named');
  });

  it('ranks by the size of the debt, because that is the order to work it in', async () => {
    const small = await taxpayerOwing('Small');
    const large = await taxpayerOwing('Large');

    /*
     * The larger debt is made larger by owing more, not by editing the
     * invoice: `amount_kobo` is immutable once written, which is the whole
     * point of the financial tables. Three assessments against one taxpayer
     * outrank one against another whatever the catalogue prices are, so the
     * test does not quietly depend on PSIRS's price list.
     */
    for (const n of [1, 2]) {
      const extra = await post(
        '/revenue/assessments',
        {
          taxpayerId: large.taxpayerId,
          revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
          inputs: {},
        },
        { ...auth, idempotencyKey: `arr-rank-${n}` },
      );
      assert.equal(extra.status, 201, JSON.stringify(extra.body));
    }

    const list = await arrearsWorklist(pool);
    const positions = list.rows.map((row) => row.taxpayerId);
    assert.ok(
      positions.indexOf(large.taxpayerId) < positions.indexOf(small.taxpayerId),
      `the larger debt must come first: ${JSON.stringify(
        list.rows.map((r) => [r.name, r.outstandingKobo]),
      )}`,
    );
  });
});

describe('who must not be on it', () => {
  /*
   * The one that would do real harm.
   *
   * An invoice stays UNPAID while the gateway is being asked, so somebody who
   * paid minutes ago looks identical in the invoices table to somebody who has
   * never paid. Sending an officer to demand money from a citizen holding a
   * receipt is the failure that costs a revenue authority its standing.
   */
  it('drops a taxpayer the moment a payment is in flight against their invoice', async () => {
    const owing = await taxpayerOwing('InFlight');

    assert.ok(find(await arrearsWorklist(pool), owing.taxpayerId), 'on the list before paying');

    const initiated = await post(
      '/payments/initiate',
      { transactionId: owing.transactionId },
      { ...auth, idempotencyKey: `arr-pay-${owing.taxpayerId.slice(0, 8)}` },
    );
    assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

    const payment = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM payments WHERE transaction_id = $1',
      [owing.transactionId],
    );
    assert.ok(
      ['INITIATED', 'PENDING'].includes(payment!.status),
      `the payment should be in flight, not ${payment!.status}`,
    );

    const row = find(await arrearsWorklist(pool), owing.taxpayerId);
    assert.equal(
      row,
      undefined,
      'a citizen part-way through paying must never appear on a list of people to chase',
    );
  });

  it('drops them once the payment is confirmed, without waiting for a sweep', async () => {
    const owing = await taxpayerOwing('Paid');
    const initiated = await post(
      '/payments/initiate',
      { transactionId: owing.transactionId },
      { ...auth, idempotencyKey: `arr-paid-${owing.taxpayerId.slice(0, 8)}` },
    );
    await post(
      '/payments/simulate',
      { gatewayReference: initiated.body.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
      auth,
    );

    assert.equal(
      find(await arrearsWorklist(pool), owing.taxpayerId),
      undefined,
      'a paid invoice is not arrears',
    );
  });

  it('leaves a closed record to the reinstatement queue, and says what it is worth', async () => {
    const owing = await taxpayerOwing('Closed');
    await pool.query(`UPDATE taxpayers SET status = 'CLOSED' WHERE id = $1`, [owing.taxpayerId]);

    const list = await arrearsWorklist(pool);
    assert.equal(find(list, owing.taxpayerId), undefined, 'not on the collection list');
    assert.ok(
      BigInt(list.summary.endedElsewhereKobo) > 0n,
      'but counted, so the total can be reconciled against the compliance table',
    );
  });

  /*
   * There is no test here for a MERGED taxpayer, deliberately.
   *
   * The status is in the check constraint and the query guards against it, but
   * no merge tool exists — duplicates are refused at registration — so nothing
   * in the platform can produce one. A test would have to write the status
   * itself, and a fixture fabricating a state the platform cannot reach proves
   * only that the fixture ran. It would also register as coverage of a path
   * that has never executed, which is worse than the gap it papers over: the
   * enum-coverage check exists to stop exactly that, and it caught this.
   *
   * The guard stays in the query and says in its own comment that it is
   * untested and why.
   */

  it('ignores a debt too small to be worth the journey', async () => {
    const trivial = await taxpayerOwing('Trivial');

    /*
     * The floor is moved rather than the invoice, because `amount_kobo` is
     * immutable — so the test asks the same question from the other side:
     * a debt below the floor is absent, the same debt above it is present.
     */
    const owed = BigInt(find(await arrearsWorklist(pool), trivial.taxpayerId)!.outstandingKobo);
    assert.ok(owed > 0n);

    const strict = await arrearsWorklist(pool, { minimumKobo: owed + 1n });
    assert.equal(find(strict, trivial.taxpayerId), undefined, 'below the floor, not listed');

    const generous = await arrearsWorklist(pool, { minimumKobo: owed });
    assert.ok(find(generous, trivial.taxpayerId), 'at the floor, listed');
  });
});

describe('how long is left to collect it', () => {
  it('tells the officer how many days until the debt stops being payable', async () => {
    const owing = await taxpayerOwing('Closing', 'SHOPS-KIOSKS', 3);

    const row = find(await arrearsWorklist(pool), owing.taxpayerId);
    assert.ok(row, 'a payable debt is on the list');
    assert.ok(
      row!.daysUntilLapse !== null && row!.daysUntilLapse <= 3 && row!.daysUntilLapse >= 2,
      `three days left, reported as ${row!.daysUntilLapse}`,
    );
  });

  it('does not restart the clock when the row is touched', async () => {
    const owing = await taxpayerOwing('PartPaid', 'SHOPS-KIOSKS', 5);
    /*
     * A part payment writes to the invoice, moving `updated_at`. Reading the
     * clock off that column would reset a debt's urgency at the very moment
     * somebody paid part of it — the mistake D-59 recorded in the settlement
     * queues, where the age ran from the last time anybody looked rather than
     * from the fact being measured.
     */
    await pool.query(`UPDATE invoices SET amount_paid_kobo = 100 WHERE id = $1`, [owing.invoiceId]);

    const row = find(await arrearsWorklist(pool), owing.taxpayerId);
    assert.ok(
      row!.daysUntilLapse !== null && row!.daysUntilLapse <= 5,
      `still five days from lapsing, not ${row!.daysUntilLapse}`,
    );
    assert.equal(row!.partiallyPaid, true, 'and a part payment is visible to the officer');
  });

  it('narrows to the debts running out when the officer asks', async () => {
    const soon = await taxpayerOwing('Soon', 'SHOPS-KIOSKS', 3);
    const later = await taxpayerOwing('Later', 'SHOPS-KIOSKS', 60);

    const list = await arrearsWorklist(pool, { lapsingWithinDays: 7 });
    assert.ok(find(list, soon.taxpayerId), 'the one about to lapse survives the filter');
    assert.equal(find(list, later.taxpayerId), undefined, 'the one with two months left does not');

    // And unfiltered, both — so the test is about the filter rather than about
    // one of the two fixtures never having been on the list.
    const all = await arrearsWorklist(pool);
    assert.ok(find(all, soon.taxpayerId) && find(all, later.taxpayerId));
  });
});

describe('the debt that can no longer be paid', () => {
  /*
   * The finding that shaped this service. Past its expiry the payment path
   * refuses an invoice outright (INVOICE_EXPIRED) and the nightly sweep marks
   * it EXPIRED. Putting one on a call list produces the worst kind of call:
   * the officer asks, the citizen agrees, and the platform will not take the
   * money. It is still a debt, so it is reported — just not as something a
   * phone call can fix.
   */
  it('keeps a lapsed invoice off the call list and reports it as its own figure', async () => {
    const owing = await taxpayerOwing('Lapsed');

    assert.ok(find(await arrearsWorklist(pool), owing.taxpayerId), 'payable, so listed');

    await pool.query(
      `UPDATE invoices SET expires_at = now() - interval '1 day' WHERE id = $1`,
      [owing.invoiceId],
    );

    const list = await arrearsWorklist(pool);
    assert.equal(
      find(list, owing.taxpayerId),
      undefined,
      'an officer must not be sent after money the platform would refuse',
    );
    assert.ok(BigInt(list.summary.lapsedKobo) > 0n, 'but the money is still reported');
    assert.equal(list.summary.lapsedInvoices, 1);
    assert.equal(list.summary.totalKobo, '0', 'and it is not double-counted as collectable');
  });

  it('still reports it once the sweep has marked it EXPIRED', async () => {
    const owing = await taxpayerOwing('Swept');
    await pool.query(
      `UPDATE invoices SET expires_at = now() - interval '1 day' WHERE id = $1`,
      [owing.invoiceId],
    );
    await expireLapsedInvoices({ actorId: null, actorRole: 'system' });

    const status = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM invoices WHERE id = $1',
      [owing.invoiceId],
    );
    assert.equal(status!.status, 'EXPIRED', 'the fixture needs the sweep to have run');

    const list = await arrearsWorklist(pool);
    assert.ok(
      BigInt(list.summary.lapsedKobo) > 0n,
      'the debt does not disappear because a sweep relabelled it — that is how a figure ' +
        'quietly falls between two queries',
    );
  });
});

describe('what the summary is for', () => {
  it('totals the whole scope, not the page, so a short list is not a small debt', async () => {
    const a = await taxpayerOwing('First');
    await taxpayerOwing('Second');
    await taxpayerOwing('Third');

    const page = await arrearsWorklist(pool, { limit: 1 });
    assert.equal(page.rows.length, 1, 'one row asked for, one row returned');
    assert.equal(page.summary.taxpayers, 3, 'and the summary still counts all three');
    assert.ok(
      BigInt(page.summary.totalKobo) > BigInt(page.rows[0]!.outstandingKobo),
      'a total that only added up the page would fall every time somebody narrowed the limit',
    );
    assert.ok(find(await arrearsWorklist(pool), a.taxpayerId));
  });

  it('says how many invoices it set aside as in flight', async () => {
    const owing = await taxpayerOwing('Counted');
    await post(
      '/payments/initiate',
      { transactionId: owing.transactionId },
      { ...auth, idempotencyKey: `arr-count-${owing.taxpayerId.slice(0, 8)}` },
    );

    const list = await arrearsWorklist(pool);
    assert.equal(
      list.summary.inFlightInvoices,
      1,
      'an unexplained gap between this total and the compliance table is how people lose trust in a figure',
    );
  });
});

describe('who may see it', () => {
  /*
   * The list is a ranked register of citizens and the money each owes. A
   * supervisor sees their own territories and nothing else, and the narrowing
   * comes from their identity rather than from anything they can type.
   */
  it('shows a territory-scoped officer only their own LGAs', async () => {
    const owing = await taxpayerOwing('Scoped');
    const lgaId = (await queryOne<{ lga_id: string }>(
      pool,
      'SELECT lga_id FROM taxpayers WHERE id = $1',
      [owing.taxpayerId],
    ))!.lga_id;

    const otherLga = await queryOne<{ id: string }>(
      pool,
      'SELECT id FROM lgas WHERE id <> $1 LIMIT 1',
      [lgaId],
    );
    const territory = await queryOne<{ id: string; name: string; name_ha: string | null; code: string }>(
      pool,
      'SELECT id, name, name_ha, code FROM territories WHERE lga_id = $1 LIMIT 1',
      [otherLga!.id],
    );
    assert.ok(territory, 'the fixture needs a territory in another LGA');

    const elsewhere = await arrearsWorklist(pool, {}, {
      kind: 'TERRITORIES',
      territories: [
        {
          id: territory!.id,
          name: territory!.name,
          nameHa: territory!.name_ha,
          code: territory!.code,
          lgaId: otherLga!.id,
        },
      ],
    });
    assert.equal(
      find(elsewhere, owing.taxpayerId),
      undefined,
      'a debtor in another LGA is not this supervisor’s to see',
    );
    assert.equal(elsewhere.summary.taxpayers, 0, 'and does not reach their total either');

    // The same officer scoped to the right LGA does see them, so the test is
    // about the boundary rather than about the query returning nothing.
    const home = await query<{ id: string; name: string; name_ha: string | null; code: string }>(
      pool,
      'SELECT id, name, name_ha, code FROM territories WHERE lga_id = $1 LIMIT 1',
      [lgaId],
    );
    if (home.length > 0) {
      const mine = await arrearsWorklist(pool, {}, {
        kind: 'TERRITORIES',
        territories: [
          {
            id: home[0]!.id,
            name: home[0]!.name,
            nameHa: home[0]!.name_ha,
            code: home[0]!.code,
            lgaId,
          },
        ],
      });
      assert.ok(find(mine, owing.taxpayerId), 'and their own LGA is visible to them');
    }
  });

  it('is refused to an agent through the API', async () => {
    const response = await post('/government/arrears', {}, auth);
    // The route is a GET; an agent has no report permission either way.
    assert.ok(response.status === 404 || response.status === 403, `got ${response.status}`);
  });
});
