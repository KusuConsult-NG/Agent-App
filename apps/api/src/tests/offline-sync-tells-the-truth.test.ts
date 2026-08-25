/**
 * What the queue says happened, and what happened.
 *
 * The sync protocol is idempotent by client reference: an agent whose
 * connection dies mid-request re-sends the same drafts, and the server is
 * meant to recognise them rather than register the same citizen twice. That
 * recognition was a single branch — if a row with this reference exists, reply
 * DUPLICATE, "This draft was already synchronised. It has not been
 * duplicated." — and it was asked no questions about what the row actually
 * says.
 *
 * The phone acts on that answer by deleting its copy, because a synchronised
 * capture on the device is only a liability. So a draft the server *rejected*,
 * re-sent after a lost reply, was reported as synchronised and then erased —
 * along with the rejection reason the agent needed in order to fix it. A draft
 * the server stored but never finished processing was reported the same way,
 * and left behind a row in `PENDING_SYNC` that nothing would ever look at
 * again. Either way the citizen was registered in the agent's telling and
 * nowhere else.
 *
 * A reply about a draft has to be a reply about that draft.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent = { id: '', token: '', device: '' };
let lgaId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();

  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000300',
    fullName: 'Records Administrator',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent should be seeded');
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { id: demo!.agentId, token: session.accessToken, device: demo!.deviceIdentifier };
});

const sync = (drafts: unknown[]) =>
  post('/drafts/sync', { drafts }, { token: agent.token, deviceId: agent.device });

const registration = (clientReference: string, overrides: Record<string, unknown> = {}) => ({
  clientReference,
  draftType: 'TAXPAYER_REGISTRATION',
  capturedAt: new Date().toISOString(),
  payload: {
    taxpayerType: 'INDIVIDUAL',
    firstName: 'Ladi',
    lastName: 'Danjuma',
    phone: '+2348037000411',
    address: '4 Market Road, Jos',
    lgaId,
    identityType: 'NIN',
    identityNumber: '11122233366',
    consentGiven: true,
    declarationAccepted: true,
    ...overrides,
  },
});

const storedDraft = (clientReference: string) =>
  queryOne<{
    status: string;
    rejection_reason: string | null;
    result_entity_id: string | null;
    synced_at: Date | null;
  }>(
    pool,
    `SELECT status, rejection_reason, result_entity_id, synced_at
       FROM offline_drafts WHERE agent_id = $1 AND client_reference = $2`,
    [agent.id, clientReference],
  );

const draftRows = async (clientReference: string) =>
  (
    await query<{ id: string }>(
      pool,
      'SELECT id FROM offline_drafts WHERE agent_id = $1 AND client_reference = $2',
      [agent.id, clientReference],
    )
  ).length;

describe('re-sending a draft after a lost reply', () => {
  it('answers a rejected capture with its rejection, not with success', async () => {
    // A capture the server cannot accept: the registration number is too short
    // to be one and there is no owner.
    const draft = {
      clientReference: 'draft-lost-reply-vehicle',
      draftType: 'VEHICLE_CAPTURE',
      capturedAt: new Date().toISOString(),
      payload: { registrationNumber: 'X', vehicleType: 'PRIVATE' },
    };

    const first = await sync([draft]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.results[0].status, 'REJECTED');
    const reason = first.body.results[0].message as string;

    // The agent never saw that reply — the connection dropped — so the phone
    // still holds the draft and sends it again.
    const again = await sync([draft]);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(
      again.body.results[0].status,
      'REJECTED',
      'a rejected capture reported as synchronised is a capture the phone then deletes',
    );
    assert.equal(again.body.results[0].message, reason, 'and the agent needs the same reason');
    assert.ok(
      !/already synchronised/i.test(again.body.results[0].message),
      'nothing was synchronised',
    );

    assert.equal(await draftRows(draft.clientReference), 1, 'still one draft, not two');
    assert.equal((await storedDraft(draft.clientReference))!.status, 'REJECTED');
  });

  it('finishes a capture it stored but never processed', async () => {
    // A row in PENDING_SYNC is what a crash between the INSERT and the handler
    // leaves behind. Nothing ever looked at those again: the retry was
    // answered "already synchronised" and the phone deleted the only other
    // copy.
    const draft = registration('draft-half-processed');
    await pool.query(
      `INSERT INTO offline_drafts (agent_id, client_reference, draft_type, payload, captured_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [agent.id, draft.clientReference, draft.draftType, JSON.stringify(draft.payload), draft.capturedAt],
    );

    const response = await sync([draft]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(
      response.body.results[0].status,
      'SYNCED',
      'the capture was never completed, so completing it is the only honest answer',
    );
    assert.ok(response.body.results[0].entityId, 'and it names the record it made');

    const stored = await storedDraft(draft.clientReference);
    assert.equal(stored!.status, 'SYNCED');
    assert.equal(stored!.result_entity_id, response.body.results[0].entityId);
    assert.notEqual(stored!.synced_at, null);
    assert.equal(await draftRows(draft.clientReference), 1);

    const taxpayer = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM taxpayers WHERE phone = $1`,
      ['+2348037000411'],
    );
    assert.equal(Number(taxpayer!.n), 1, 'the citizen is registered exactly once');
  });

  it('answers a completed capture with the record it made', async () => {
    const draft = registration('draft-completed');

    const first = await sync([draft]);
    assert.equal(first.body.results[0].status, 'SYNCED', JSON.stringify(first.body));
    const entityId = first.body.results[0].entityId as string;
    assert.ok(entityId);

    const again = await sync([draft]);
    assert.equal(again.body.results[0].status, 'DUPLICATE');
    assert.equal(again.body.results[0].entityId, entityId, 'the same record, not a second one');
    assert.match(again.body.results[0].message, /already synchronised/i);

    const taxpayers = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM taxpayers WHERE phone = $1`,
      ['+2348037000411'],
    );
    assert.equal(Number(taxpayers!.n), 1, 'one citizen, however many times the sync is replayed');
  });

  it('leaves nothing in a state nothing will ever process', async () => {
    await sync([
      registration('draft-sweep-good'),
      {
        clientReference: 'draft-sweep-bad',
        draftType: 'VEHICLE_CAPTURE',
        capturedAt: new Date().toISOString(),
        payload: { registrationNumber: 'X', vehicleType: 'PRIVATE' },
      },
    ]);

    const limbo = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM offline_drafts WHERE status = 'PENDING_SYNC'`,
    );
    assert.equal(Number(limbo!.n), 0);
  });
});

/**
 * A duplicate acknowledgement cannot travel in the queue.
 *
 * `acknowledgeDuplicates` means a person looked at the matches the server
 * offered and said none of them is this citizen. The phone cannot produce that
 * decision offline — it has no duplicate list without a connection — so the
 * only way the flag reaches the queue is an attempt that was made *online*,
 * refused as a possible duplicate, acknowledged, resubmitted, and then lost
 * its reply. Which is the one case where the flag is most certainly wrong: the
 * record the agent is about to duplicate is the one their own retry created a
 * moment earlier.
 *
 * Registration blocks an exact identity match whatever the flag says, so a
 * capture carrying a NIN is safe either way. A capture without one — and the
 * identity document is optional, because plenty of citizens do not have one to
 * hand — matches at 85 on a shared phone and name, which the flag waves
 * through. Two records for one person, two TINs, and a compliance history that
 * from then on describes neither of them properly.
 *
 * A decision about what the server was showing at the time is not a decision
 * the queue can carry. The draft is refused with the matches as they stand
 * now, and the agent makes the call with the current record in front of them.
 */
describe('an acknowledgement made before the queue', () => {
  const CITIZEN_PHONE = '+2348037000512';

  const online = (overrides: Record<string, unknown> = {}) => ({
    taxpayerType: 'INDIVIDUAL',
    firstName: 'Rifkatu',
    lastName: 'Bala',
    phone: CITIZEN_PHONE,
    address: '17 Zaria Road, Jos',
    lgaId,
    consentGiven: true,
    declarationAccepted: true,
    ...overrides,
  });

  const registered = async () => {
    const row = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM taxpayers WHERE phone = $1`,
      [CITIZEN_PHONE],
    );
    return Number(row!.n);
  };

  it('does not register the citizen a second time', async () => {
    // The attempt that reached the server. Its reply never reached the phone.
    const first = await post('/taxpayers', online(), {
      token: agent.token,
      deviceId: agent.device,
      idempotencyKey: 'sync-ack-online',
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(await registered(), 1);

    // The phone still holds the capture, acknowledgement and all, and syncs it.
    const response = await sync([
      {
        clientReference: 'draft-acknowledged-duplicate',
        draftType: 'TAXPAYER_REGISTRATION',
        capturedAt: new Date().toISOString(),
        payload: online({ acknowledgeDuplicates: true }),
      },
    ]);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(
      response.body.results[0].status,
      'REJECTED',
      'a queued acknowledgement waved a second record for the same citizen through',
    );
    assert.match(
      response.body.results[0].message,
      /already registered|possible existing taxpayer/i,
      `the agent needs the platform's own words, not the database's: ${response.body.results[0].message}`,
    );
    assert.equal(await registered(), 1, 'one citizen, one record');
  });

  it('still registers a capture that duplicates nobody', async () => {
    const response = await sync([
      {
        clientReference: 'draft-not-a-duplicate',
        draftType: 'TAXPAYER_REGISTRATION',
        capturedAt: new Date().toISOString(),
        payload: online({ acknowledgeDuplicates: true }),
      },
    ]);

    assert.equal(response.body.results[0].status, 'SYNCED', JSON.stringify(response.body));
    assert.equal(await registered(), 1);
  });
});

/**
 * What a fault is allowed to say.
 *
 * Every draft that fails for any reason at all was rejected with
 * `error.message` — whatever that happened to be. A considered refusal reads
 * well there: "This person is already registered as Rifkatu Bala (TIN
 * 481...)". A fault does not. An agent standing in a market with a queued
 * capture was shown, and the platform stored for good, sentences like
 * `duplicate key value violates unique constraint "taxpayers_tin_key"` —
 * which tells them nothing they can act on and tells anyone reading over their
 * shoulder the names of our tables.
 *
 * A refusal the platform composed is worth showing. Anything else gets a plain
 * sentence and a reference to quote, and the detail goes to the log where
 * support can find it.
 */
describe('a capture that fails for a reason nobody wrote', () => {
  it('is refused in words, not in database', async () => {
    // A NUL byte in a captured name: what a mis-scanned document leaves in a
    // field that every layer above the database is happy to carry.
    const response = await sync([
      {
        clientReference: 'draft-mis-scanned',
        draftType: 'TAXPAYER_REGISTRATION',
        capturedAt: new Date().toISOString(),
        payload: {
          taxpayerType: 'INDIVIDUAL',
          firstName: 'Ng\u0000o',
          lastName: 'Pam',
          phone: '+2348037000613',
          address: '2 Yakubu Gowon Way, Jos',
          lgaId,
          consentGiven: true,
          declarationAccepted: true,
        },
      },
    ]);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const result = response.body.results[0];
    assert.equal(result.status, 'REJECTED');

    const stored = await storedDraft('draft-mis-scanned');
    for (const text of [result.message as string, stored?.rejection_reason ?? '']) {
      assert.ok(
        !/constraint|violates|null value|relation |column |syntax error|psql/i.test(text),
        `the database should not be quoted at a field agent: ${text}`,
      );
    }
    assert.match(
      result.message,
      /draft-mis-scanned/,
      'and the agent needs the reference to quote to support',
    );
  });

  it('does not take the rest of the batch down with it', async () => {
    // Fifty captures may travel in one sync. Before, a draft the database
    // would not hold answered the whole request with a 500: the other
    // forty-nine went unanswered, the phone kept all of them, and the next
    // sync died on the same one. The queue could never drain, and nothing told
    // the agent which capture was holding it shut.
    const response = await sync([
      {
        clientReference: 'draft-batch-poison',
        draftType: 'TAXPAYER_REGISTRATION',
        capturedAt: new Date().toISOString(),
        payload: {
          taxpayerType: 'INDIVIDUAL',
          firstName: 'Ng\u0000o',
          lastName: 'Pam',
          phone: '+2348037000614',
          address: '2 Yakubu Gowon Way, Jos',
          lgaId,
          consentGiven: true,
          declarationAccepted: true,
        },
      },
      registration('draft-batch-good'),
    ]);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.results.length, 2, 'every draft gets an answer');
    assert.equal(response.body.results[0].status, 'REJECTED');
    assert.equal(
      response.body.results[1].status,
      'SYNCED',
      'a capture behind a corrupt one still reaches the register',
    );
    assert.ok(response.body.results[1].entityId);
  });

  /*
   * The phone sends the queue in batches of fifty because that is what this
   * route takes. The two numbers have to stay equal: lowering the cap here
   * without telling the phone brings back the queue that cannot drain, so the
   * cap is asserted rather than assumed.
   */
  it('takes a full batch of fifty in one request', async () => {
    const response = await sync(
      Array.from({ length: 50 }, (_unused, index) => ({
        clientReference: `draft-full-batch-${index}`,
        draftType: 'VEHICLE_CAPTURE',
        capturedAt: new Date().toISOString(),
        payload: { registrationNumber: 'X', vehicleType: 'PRIVATE' },
      })),
    );

    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 200));
    assert.equal(response.body.results.length, 50);
  });

  it('still shows a refusal the platform composed', async () => {
    const response = await sync([
      {
        clientReference: 'draft-refused-in-words',
        draftType: 'VEHICLE_CAPTURE',
        capturedAt: new Date().toISOString(),
        payload: { registrationNumber: 'X', vehicleType: 'PRIVATE' },
      },
    ]);
    assert.match(response.body.results[0].message, /could not be accepted/i);
  });
});
