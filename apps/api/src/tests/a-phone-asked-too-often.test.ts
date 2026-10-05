/**
 * A trader's phone, and how often a stranger can make it buzz.
 *
 * Asking for a statement sends a code to the phone on the taxpayer's record —
 * never to a number in the request — when anybody names the TIN. Nothing
 * limited how often. Each request superseded the last code and queued another
 * SMS: measured, five requests for one TIN within a second sent five codes and
 * five text messages to one trader, four of them useless on arrival, and the
 * only stop was the route's five a minute per address, which a second address
 * resets.
 *
 * A number is now sent at most one code a minute and five a day for each
 * purpose. A request inside a limit sends nothing, leaves the code already
 * sent usable, and gets the same answer as any other — the endpoint still
 * says nothing about whether a record exists.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, queryOne } from '../db/pool';
import {
  createGovernmentUser,
  grantStepUp,
  loginAs,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { requestOtp } from '../services/auth';

const ON_THE_RECORD = '+2348031000077';
const TIN = '841446177';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  const lgaId = (await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1', []))!.id;
  await pool.query(
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, status, source, tin)
     VALUES ('INDIVIDUAL','Amina','Bulus',$1,'7 Terminus Market, Jos',$2,'ACTIVE','AGENT',$3)`,
    [ON_THE_RECORD, lgaId, TIN],
  );
});

const ask = () => post('/citizen-status/statement/request', { tin: TIN });

/*
 * The route also limits each address to five requests a minute, and that
 * limit lasts across the tests in this file. The tests that need more than a
 * couple of requests ask the service the route calls, so what they measure is
 * the limit on the number rather than the one on the address.
 */
const send = () => requestOtp({ destination: ON_THE_RECORD, purpose: 'CITIZEN_STATEMENT' });

async function textsSent(): Promise<string[]> {
  const { rows } = await pool.query<{ message: string }>(
    `SELECT COALESCE(secret_message, message) AS message FROM notifications
      WHERE channel = 'SMS' AND recipient = $1 ORDER BY created_at`,
    [ON_THE_RECORD],
  );
  return rows.map((row) => row.message);
}

/** Move every code this number has had back in time, as though it were older. */
const age = (seconds: number) =>
  pool.query(
    `UPDATE otp_codes SET created_at = created_at - make_interval(secs => $2) WHERE destination = $1`,
    [ON_THE_RECORD, seconds],
  );

describe('a second request inside a minute', () => {
  it('sends nothing more, and answers exactly as the first did', async () => {
    const first = await ask();
    const second = await ask();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body, 'the answer must not say whether a code went');
    assert.equal((await textsSent()).length, 1, 'the phone was sent a second code');
  });

  it('leaves the code already sent usable', async () => {
    await ask();
    const code = /(\d{4,10})/.exec((await textsSent())[0]!)![1];
    await ask();

    const statement = await post('/citizen-status/statement', { tin: TIN, code });
    assert.equal(statement.status, 200, JSON.stringify(statement.body));
  });

  it('sends a fresh code once the minute has passed', async () => {
    await send();
    await age(61);
    await send();
    assert.equal((await textsSent()).length, 2);
  });
});

describe('a day of requests', () => {
  it('stops at five codes, however the requests are spaced', async () => {
    for (let i = 0; i < 7; i += 1) {
      await send();
      await age(61);
    }
    assert.equal((await textsSent()).length, 5);
  });

  it('starts again once the oldest of them is a day old', async () => {
    for (let i = 0; i < 5; i += 1) {
      await send();
      await age(61);
    }
    await age(24 * 60 * 60);
    await send();
    assert.equal((await textsSent()).length, 6);
  });
});

describe('what the service says when it sends nothing', () => {
  it('reports that nothing was sent, and when to try again', async () => {
    const first = await send();
    const second = await send();
    assert.equal(first.sent, true);
    assert.equal(second.sent, false);
    assert.ok(second.retryAfterSeconds! > 0 && second.retryAfterSeconds! <= 60, String(second.retryAfterSeconds));
  });
});

describe('a step-up code', () => {
  /*
   * Exempt: it goes only to the caller's own registered number, from a
   * session that already exists. An officer asked twice in a minute for a
   * code to approve one thing and then another.
   */
  it('can be asked for twice in a minute by the officer it belongs to', async () => {
    await createGovernmentUser({ fullName: 'Step-up Officer', phone: '+2348077900001', role: 'admin' });
    const token = (await loginAs('+2348077900001')).accessToken;
    await grantStepUp(token, '+2348077900001', 'user.role.change');
    await grantStepUp(token, '+2348077900001', 'user.role.change');
  });
});
