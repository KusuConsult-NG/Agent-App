/**
 * What a step-up code is worth.
 *
 * Two properties, and the gate is worthless without either: the code has to
 * reach the account it authorises, and it has to buy exactly one action.
 *
 * `requireStepUp` exists so that a captured access token is not enough to
 * approve a payout, rewrite an identity, or set the price of a public service:
 * each of those needs a fresh one-time code, and the grant that code produces
 * is *consumed* rather than merely checked. Its own docstring says so — "one
 * OTP authorises exactly one high-risk action — a captured token cannot be
 * replayed to approve a second payout or change a second bank account".
 *
 * Consuming a grant is a read followed by a write, and between the two there
 * is a window. Two requests arriving inside that window both read an unspent
 * grant, both pass, and both write `consumed_at` over the top of each other —
 * one code, two actions. Nothing in the ordinary use of a portal produces that
 * timing, which is exactly why it is worth pinning: whoever holds a stolen
 * token chooses when the second request arrives, and can send it in the same
 * millisecond as the first.
 *
 * The rate changes raced below are each legitimate on their own — six
 * different revenue items, any one of which this officer may reprice. They
 * contend for nothing: the route locks the current rate row per item, so six
 * different items take six different locks. The only thing that may stop the
 * second is the spent grant, so if more than one is accepted, it is the
 * step-up guarantee that failed and nothing else.
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
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { config } from '../config';
import { sha256 } from '../lib/crypto';
import { consumeStepUpGrant } from '../middleware/auth';
import { seedReferenceData } from '../db/seed';

const OFFICER = '+2348030000210';
const OTHER_OFFICER = '+2348030000211';

let officerToken = '';
let itemIds: string[] = [];

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({ role: 'revenue_officer', phone: OFFICER, fullName: 'Revenue Officer' });
  officerToken = (await loginAs(OFFICER)).accessToken;

  const items = await query<{ id: string }>(
    pool,
    `SELECT ri.id FROM revenue_items ri
       JOIN revenue_item_rates r ON r.revenue_item_id = ri.id
      WHERE r.effective_to IS NULL AND r.lga_id IS NULL AND r.rate_type = 'FIXED'
      ORDER BY ri.code LIMIT 6`,
  );
  assert.equal(items.length, 6, 'the seeded catalogue should offer six statewide fixed rates');
  itemIds = items.map((item) => item.id);
});

const reprice = (itemId: string, amountKobo: string) =>
  post(
    `/revenue/items/${itemId}/rates`,
    {
      rateType: 'FIXED',
      fixedAmountKobo: amountKobo,
      effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
      reason: 'Rate revised by the Board for the coming year.',
    },
    { token: officerToken },
  );

const liveGrants = async (phone: string) => {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM step_up_grants
      WHERE user_id = (SELECT id FROM users WHERE phone = $1)
        AND consumed_at IS NULL AND expires_at > now()`,
    [phone],
  );
  return Number(row!.n);
};

const rateVersions = async () => {
  const row = await queryOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM revenue_item_rates
      WHERE revenue_item_id = ANY($1::uuid[]) AND version > 1`,
    [itemIds],
  );
  return Number(row!.n);
};

describe('a step-up grant is spent, not just checked', () => {
  it('lets the code through once and refuses the replay', async () => {
    await grantStepUp(officerToken, OFFICER, 'catalogue.rate.change');

    const first = await reprice(itemIds[0], '150000');
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await reprice(itemIds[1], '250000');
    assert.equal(second.status, 403, JSON.stringify(second.body));
    assert.equal(second.body.error.code, 'STEP_UP_REQUIRED');

    assert.equal(await rateVersions(), 1, 'only the first repricing should have landed');
  });

  it('is spent once even when six requests arrive together', async () => {
    await grantStepUp(officerToken, OFFICER, 'catalogue.rate.change');
    assert.equal(await liveGrants(OFFICER), 1, 'exactly one code was confirmed');

    // Open the sockets first. Without this the six requests below leave in a
    // staggered line — each paying for its own TCP handshake — and arrive far
    // enough apart that a racy consume sometimes gets away with it. Warming
    // the connection pool makes the timing the test is about the only variable
    // left.
    await Promise.all(itemIds.map(() => get('/auth/me', { token: officerToken })));

    // Six repricings, each valid on its own, sent without waiting for any
    // reply. Which one wins is not the point; how many win is.
    const replies = await Promise.all(
      itemIds.map((itemId, index) => reprice(itemId, String(100000 + index * 1000))),
    );

    const accepted = replies.filter((reply) => reply.status === 201);
    assert.equal(
      accepted.length,
      1,
      `one code must authorise one rate change; ${accepted.length} of ${replies.length} were accepted`,
    );

    for (const refused of replies.filter((reply) => reply.status !== 201)) {
      assert.equal(refused.status, 403, JSON.stringify(refused.body));
      assert.equal(refused.body.error.code, 'STEP_UP_REQUIRED');
    }

    assert.equal(await rateVersions(), 1, 'one code, one new price');
    assert.equal(await liveGrants(OFFICER), 0, 'the grant is spent');
  });

  /*
   * The same property with the network taken out of it.
   *
   * Six HTTP requests leave in a staggered line no matter how they are sent,
   * and a consume that is only *usually* atomic can get away with it often
   * enough to look green. Calling the consume directly puts eight attempts
   * inside the same tick, which is the timing an attacker with a stolen token
   * would arrange, and leaves no room for luck to stand in for correctness.
   */
  it('hands the grant to exactly one of eight simultaneous consumers', async () => {
    await grantStepUp(officerToken, OFFICER, 'catalogue.rate.change');
    const officer = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      OFFICER,
    ]);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => consumeStepUpGrant(officer!.id, 'catalogue.rate.change')),
    );

    assert.equal(
      outcomes.filter(Boolean).length,
      1,
      `one grant must satisfy one consumer; ${outcomes.filter(Boolean).length} of 8 were satisfied`,
    );
    assert.equal(await liveGrants(OFFICER), 0);
  });

  /*
   * The other direction, so the fix cannot over-correct.
   *
   * An officer who confirmed two codes may take two actions. Serialising every
   * consume onto one row would refuse the second — safe, but wrong, and the
   * kind of wrong that shows up as an unexplained 403 in the field rather than
   * as a failing test. Two grants, two simultaneous consumers, two actions.
   */
  it('lets two confirmed codes authorise two simultaneous actions', async () => {
    await grantStepUp(officerToken, OFFICER, 'catalogue.rate.change');
    await grantStepUp(officerToken, OFFICER, 'catalogue.rate.change');
    assert.equal(await liveGrants(OFFICER), 2, 'two codes were confirmed');

    const officer = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      OFFICER,
    ]);
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => consumeStepUpGrant(officer!.id, 'catalogue.rate.change')),
    );

    assert.equal(
      outcomes.filter(Boolean).length,
      2,
      `two grants must satisfy two consumers; ${outcomes.filter(Boolean).length} of 8 were satisfied`,
    );
    assert.equal(await liveGrants(OFFICER), 0);
  });

  it('will not accept a grant that has expired, however recently', async () => {
    await grantStepUp(officerToken, OFFICER, 'catalogue.rate.change');
    await pool.query(
      `UPDATE step_up_grants SET expires_at = now() - interval '1 second'
        WHERE user_id = (SELECT id FROM users WHERE phone = $1)`,
      [OFFICER],
    );

    const response = await reprice(itemIds[0], '150000');
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'STEP_UP_REQUIRED');
    assert.equal(await rateVersions(), 0);
  });

  it("does not let one officer spend another officer's grant", async () => {
    await createGovernmentUser({
      role: 'revenue_officer',
      phone: OTHER_OFFICER,
      fullName: 'Another Officer',
    });
    const otherToken = (await loginAs(OTHER_OFFICER)).accessToken;
    await grantStepUp(otherToken, OTHER_OFFICER, 'catalogue.rate.change');

    const response = await reprice(itemIds[0], '150000');
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'STEP_UP_REQUIRED');
    assert.equal(await rateVersions(), 0);
    assert.equal(
      await liveGrants(OTHER_OFFICER),
      1,
      "and the other officer's grant is still unspent",
    );
  });
});

/**
 * Where the code goes.
 *
 * A second factor is only a second factor if it arrives somewhere the account
 * holder controls. `POST /auth/step-up` takes the destination the code was
 * sent to from the request body, and the body is written by whoever holds the
 * token — so if nothing checks that the destination is the account's own
 * number, an attacker with a captured token sends the code to their own phone,
 * reads it there, and confirms it against the victim's account. The step-up
 * gate then stands open for exactly the person it exists to stop, and the
 * audit trail records the victim as the one who confirmed it.
 *
 * `POST /auth/otp/request` is deliberately unauthenticated — signing in and
 * resetting a password both need a code before there is a session — so an
 * attacker does not even need the token for the first step.
 */
describe('a step-up code has to reach the account it authorises', () => {
  const ATTACKER = '+2348030000212';

  const requestStepUpCode = (destination: string, token?: string) =>
    post('/auth/otp/request', { destination, purpose: 'STEP_UP' }, token ? { token } : {});

  /*
   * A live, unexpired, correct step-up code sitting at a number that is not
   * the officer's — planted rather than requested, because requesting one is
   * itself refused now. Confirming it is checked separately from sending it:
   * either check alone would close the hole, and a gate this load-bearing
   * should not depend on which of the two somebody edits next.
   */
  const plantStepUpCode = async (destination: string) => {
    const code = '1'.repeat(config.auth.otpLength);
    await pool.query(
      `INSERT INTO otp_codes (destination, purpose, code_hash, expires_at)
       VALUES ($1, 'STEP_UP', $2, now() + interval '10 minutes')`,
      [destination, sha256(code)],
    );
    return code;
  };

  it("refuses a code that was sent to somebody else's number", async () => {
    const code = await plantStepUpCode(ATTACKER);

    const granted = await post(
      '/auth/step-up',
      { action: 'catalogue.rate.change', destination: ATTACKER, code },
      { token: officerToken },
    );
    assert.equal(granted.status, 403, JSON.stringify(granted.body));
    assert.equal(await liveGrants(OFFICER), 0, 'no grant should have been issued');
  });

  it('leaves the price of a public service where it was', async () => {
    const code = await plantStepUpCode(ATTACKER);
    await post(
      '/auth/step-up',
      { action: 'catalogue.rate.change', destination: ATTACKER, code },
      { token: officerToken },
    );

    const response = await reprice(itemIds[0], '999900');
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'STEP_UP_REQUIRED');
    assert.equal(await rateVersions(), 0, 'no rate may change on a code the officer never saw');
  });

  it("will not send a step-up code to a number that is not the caller's", async () => {
    const response = await requestStepUpCode(ATTACKER, officerToken);
    assert.equal(response.status, 403, JSON.stringify(response.body));

    const sent = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM otp_codes WHERE destination = $1 AND purpose = 'STEP_UP'`,
      [ATTACKER],
    );
    assert.equal(Number(sent!.n), 0, 'nothing should have been sent');
  });

  it('will not issue a step-up code to an anonymous caller at all', async () => {
    // Signing in needs a code before there is a session, so this route stays
    // open — but a step-up code belongs to a session that already exists.
    // Left anonymous, anyone who knows an officer's number can supersede the
    // code that officer is halfway through typing.
    const response = await requestStepUpCode(OFFICER);
    assert.equal(response.status, 401, JSON.stringify(response.body));
  });

  it('still lets the officer confirm a code sent to their own number', async () => {
    const otp = await requestStepUpCode(OFFICER, officerToken);
    const code = (otp.body as { developmentCode?: string }).developmentCode;
    assert.ok(code, JSON.stringify(otp.body));
    assert.equal((code as string).length, config.auth.otpLength);

    const granted = await post(
      '/auth/step-up',
      { action: 'catalogue.rate.change', destination: OFFICER, code },
      { token: officerToken },
    );
    assert.equal(granted.status, 200, JSON.stringify(granted.body));

    const response = await reprice(itemIds[0], '150000');
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });
});

/**
 * A live code belongs to the person it was sent to.
 *
 * `verifyOtp` consumes a code once its attempt budget is exhausted — five
 * wrong guesses and the code is dead, which is the right answer to somebody
 * guessing at it. It is the wrong answer when the guessing can be done by a
 * stranger against somebody else's code, and `POST /auth/otp/verify` took a
 * destination, a purpose and a code from an unauthenticated body, so anybody
 * who knew an officer's phone number could spend that officer's attempt budget
 * while the officer was still reading the SMS.
 *
 * What that buys an attacker is not the officer's code — it is the officer's
 * inability to use it. Step-up guards reversals, payouts, rate changes and
 * agent suspension, so a code that can be burned on demand is a way to hold
 * those four controls shut from outside the building, repeatedly, for as long
 * as somebody cares to.
 */
describe('a live step-up code cannot be spent by a stranger', () => {
  const burn = (destination: string, code: string) =>
    post('/auth/otp/verify', { destination, purpose: 'STEP_UP', code });

  it("survives a stranger exhausting its attempt budget", async () => {
    const otp = await post(
      '/auth/otp/request',
      { destination: OFFICER, purpose: 'STEP_UP' },
      { token: officerToken },
    );
    const code = (otp.body as { developmentCode?: string }).developmentCode;
    assert.ok(code, JSON.stringify(otp.body));

    // Enough wrong guesses to exhaust the budget several times over, from a
    // caller holding nothing but the officer's phone number.
    const wrong = '9'.repeat(config.auth.otpLength);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const guess = await burn(OFFICER, wrong);
      assert.notEqual(guess.status, 200, 'a guessed code was accepted');
    }

    const granted = await post(
      '/auth/step-up',
      { action: 'catalogue.rate.change', destination: OFFICER, code },
      { token: officerToken },
    );
    assert.equal(
      granted.status,
      200,
      `the officer's own code should still work: ${JSON.stringify(granted.body)}`,
    );
  });
});

/**
 * The attempt budget.
 *
 * `otp_codes.max_attempts` is five, and `verifyOtp` counts wrong guesses
 * against it — it increments `attempts`, and consumes the code once the budget
 * is gone. Both of those writes happened inside the transaction that then
 * threw, so both were rolled back with it: the counter never moved off zero,
 * the exhaustion branch was unreachable, and the message under the code entry
 * box told every caller, on every wrong guess, that they had four attempts
 * left. A six-digit code with no attempt limit is a six-digit code that can be
 * guessed, and this one authorises reversals, payouts and rate changes.
 *
 * The rule is that a refusal still has to be recorded. What the caller is told
 * afterwards is decided outside the transaction, so that saying no cannot undo
 * the counting of it.
 */
describe('wrong guesses are counted', () => {
  const guess = (code: string) =>
    post(
      '/auth/step-up',
      { action: 'catalogue.rate.change', destination: OFFICER, code },
      { token: officerToken },
    );

  const wrong = (n: number) => String(n).repeat(config.auth.otpLength);

  it('counts down, and says the same number the record holds', async () => {
    await post(
      '/auth/otp/request',
      { destination: OFFICER, purpose: 'STEP_UP' },
      { token: officerToken },
    );

    for (const [attempt, expected] of [
      [1, 4],
      [2, 3],
      [3, 2],
    ] as const) {
      const response = await guess(wrong(attempt));
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.match(
        response.body.error.message,
        new RegExp(`${expected} attempt`),
        `guess ${attempt} should leave ${expected}: ${response.body.error.message}`,
      );

      const row = await queryOne<{ attempts: number }>(
        pool,
        `SELECT attempts FROM otp_codes WHERE destination = $1 AND purpose = 'STEP_UP'
          ORDER BY created_at DESC LIMIT 1`,
        [OFFICER],
      );
      assert.equal(row!.attempts, attempt, 'the count has to survive the refusal');
    }
  });

  it('stops accepting the right code once the budget is gone', async () => {
    const otp = await post(
      '/auth/otp/request',
      { destination: OFFICER, purpose: 'STEP_UP' },
      { token: officerToken },
    );
    const code = (otp.body as { developmentCode?: string }).developmentCode;
    assert.ok(code);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal((await guess(wrong(attempt))).status, 400);
    }

    const correct = await guess(code as string);
    assert.equal(correct.status, 400, JSON.stringify(correct.body));
    assert.match(correct.body.error.message, /too many/i);
    assert.equal(await liveGrants(OFFICER), 0, 'and no grant was issued');
  });
});
