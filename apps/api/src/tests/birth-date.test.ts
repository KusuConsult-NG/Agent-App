/**
 * A date of birth must describe a living person.
 *
 * `dateOfBirth` was declared as `z.string().date()` on both the taxpayer and
 * the agent application routes. That checks the shape of the string and
 * nothing else, so `2099-01-01` passed validation, passed the service layer,
 * and was stored in a bare `DATE` column with no constraint on it. An agent
 * who slipped a digit in the year registered a taxpayer who has not been born.
 *
 * The consequence is not cosmetic. Date of birth is one of the fields the
 * duplicate-detection weighting compares when deciding whether two
 * registrations are the same person, and it is printed on the taxpayer's
 * identity card. A value nobody can hold corrupts both.
 *
 * Three layers are checked here, because each was independently permissive:
 * the shared rule the registration form uses, the request schema, and the
 * database constraint that has to hold even if a future caller bypasses both.
 */

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
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { birthDateMessage, birthDateProblem, isRecordableBirthDate } from '@psirs/shared';

let agent: { token: string; device: string };
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
    phone: '+2348030000160',
    fullName: 'Birth Date Admin',
  });

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

let unique = 0;
function registration(extra: Record<string, unknown> = {}) {
  unique += 1;
  return {
    taxpayerType: 'INDIVIDUAL',
    firstName: 'Birth',
    lastName: `Probe${unique}`,
    phone: `080311${String(unique).padStart(5, '0')}`,
    address: '12 Probe Street, Jos',
    lgaId,
    consentGiven: true,
    declarationAccepted: true,
    ...extra,
  };
}

const asAgent = () => ({
  token: agent.token,
  deviceId: agent.device,
  idempotencyKey: `birth-${unique}-${Math.random().toString(36).slice(2)}`,
});

describe('the shared rule the form and the API share', () => {
  it('refuses a date in the future', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.equal(birthDateProblem(tomorrow), 'IN_THE_FUTURE');
    assert.equal(isRecordableBirthDate('2099-01-01'), false);
  });

  it('refuses a year before the platform will believe it', () => {
    assert.equal(birthDateProblem('1799-06-01'), 'TOO_LONG_AGO');
  });

  it('refuses a date the calendar would silently rewrite', () => {
    // 2025-02-30 becomes 2025-03-02 if it is simply handed to Date.
    assert.equal(birthDateProblem('2025-02-30'), 'MALFORMED');
    assert.equal(birthDateProblem('not-a-date'), 'MALFORMED');
  });

  it('accepts today, so somebody born this morning can be registered', () => {
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(birthDateProblem(today), null);
  });

  it('accepts an ordinary birth date', () => {
    assert.equal(birthDateProblem('1972-03-14'), null);
  });

  it('says something the person filling the form can act on', () => {
    for (const problem of ['IN_THE_FUTURE', 'TOO_LONG_AGO', 'MALFORMED'] as const) {
      const message = birthDateMessage(problem);
      assert.ok(message.length > 10, `${problem} has no message`);
      assert.ok(
        !/invalid|required|expected|constraint|zod/i.test(message),
        `${problem} message reads like a validator: ${message}`,
      );
    }
  });
});

describe('registering a taxpayer', () => {
  it('refuses a date of birth in the future', async () => {
    const response = await post('/taxpayers', registration({ dateOfBirth: '2099-01-01' }), asAgent());
    assert.equal(response.status, 422, `expected a refusal, got ${response.status}`);
    assert.match(JSON.stringify(response.body), /future/i);
  });

  it('refuses a date of birth before 1900', async () => {
    const response = await post('/taxpayers', registration({ dateOfBirth: '1804-01-01' }), asAgent());
    assert.equal(response.status, 422);
  });

  it('still accepts an ordinary date of birth', async () => {
    const response = await post('/taxpayers', registration({ dateOfBirth: '1988-07-21' }), asAgent());
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  it('still accepts a registration with no date of birth at all', async () => {
    const response = await post('/taxpayers', registration(), asAgent());
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });
});

describe('the database, if a future caller ever bypasses the schema', () => {
  it('refuses to store a taxpayer born in the future', async () => {
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id, date_of_birth)
           VALUES ('INDIVIDUAL', 'Direct', 'Insert', '+2348039990001', '1 Street', $1, DATE '2099-01-01')`,
          [lgaId],
        ),
      /taxpayers_birth_date_recordable/,
    );
  });

  it('refuses to store an agent born in the future', async () => {
    await assert.rejects(
      () =>
        pool.query(
          `UPDATE agents SET date_of_birth = DATE '2099-01-01'
           WHERE id = (SELECT id FROM agents LIMIT 1)`,
        ),
      /agents_birth_date_recordable/,
    );
  });
});
