/**
 * Registering somebody who already has a TIN.
 *
 * An agent supplying an existing TIN does not get to assert it — it is checked
 * against the authoritative register first, and that guard is right. What was
 * wrong is what the check was given to look up.
 *
 * PSIRS prints a TIN with separators, and people write them the way they read
 * them: `12345678-0001`, `1234 5678 90`. Those went to the register exactly as
 * typed, matched nothing, and came back NOT_FOUND — so a taxpayer holding a
 * perfectly good TIN could not be registered against it, and the agent was
 * told the number could not be found when the number was fine.
 *
 * The advice that came with it made that worse. "Check the number, or register
 * the taxpayer as a new TIN applicant" is exactly the instruction that mints a
 * second TIN for somebody who already has one — the outcome the UNAVAILABLE
 * branch above it goes out of its way to prevent, and a duplicate in a UNIQUE
 * column on an undeletable row is permanent.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  createGovernmentUser,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let token: string;
let deviceId: string;
let lgaId: string;
let wardId: string;
let counter = 0;

/** Register a fresh person, supplying a TIN in whatever shape. */
async function registerWithTin(existingTin: string) {
  counter += 1;
  return post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: `Tin${counter}`,
      lastName: `Shape${counter}`,
      phone: `+23480935000${String(counter).padStart(2, '0')}`,
      address: `${counter} Market Road, Jos`,
      lgaId,
      wardId,
      consentGiven: true,
      declarationAccepted: true,
      existingTin,
    },
    { token, deviceId, idempotencyKey: `tin-shape-${counter}` },
  );
}

before(async () => {
  await resetDatabase();
  await seedReferenceData();
  await startTestServer();
  await createGovernmentUser({
    fullName: 'TIN Test Admin',
    phone: '+2348000000001',
    role: 'admin',
  });
  const agent = await seedDemoAgent();
  assert.ok(agent, 'the demo agent should seed');
  deviceId = agent!.deviceIdentifier;
  token = (await loginAs(agent!.phone, agent!.password, deviceId)).accessToken;

  lgaId = await firstLgaId();
  wardId = (await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM wards WHERE lga_id = $1 LIMIT 1',
    [lgaId],
  ))!.id;
});

after(async () => {
  await stopTestServer();
});

describe('a TIN written the way people write it', () => {
  it('accepts one with a hyphen, as PSIRS prints it', async () => {
    const response = await registerWithTin('12345678-90');
    assert.equal(
      response.status,
      201,
      `a hyphenated TIN was refused: ${JSON.stringify(response.body)}`,
    );
  });

  it('accepts one with spaces, as somebody reads it aloud', async () => {
    const response = await registerWithTin('1234 5678 91');
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  it('stores what the register calls it, not what the agent typed', async () => {
    // The register is authoritative on the canonical form. Storing the
    // agent's punctuation would give one taxpayer several spellings of one
    // TIN, and TIN is a UNIQUE column.
    const response = await registerWithTin('1234-5678-92');
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.tin, '1234567892');
  });

  it('still refuses a number the register does not know', async () => {
    // Normalising must not turn "not found" into "found". The guard is the
    // point: an agent does not get to assert a TIN.
    const response = await registerWithTin('nonsense-tin');
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_REQUEST');
  });
});

describe('what an agent is told when a TIN is not found', () => {
  it('does not tell them to create a second TIN', async () => {
    /*
     * The failure this prevents: a mistyped TIN comes back not-found, the
     * agent follows the advice, and a person who already has a TIN acquires
     * another one. The column is UNIQUE and the row cannot be deleted, so it
     * is permanent.
     */
    const response = await registerWithTin('definitely-not-a-tin');
    const said = `${response.body.error.message} ${response.body.error.nextStep ?? ''}`;
    assert.ok(
      !/register (the taxpayer|them) as a new TIN applicant/i.test(said),
      `still advises minting a duplicate TIN: ${said}`,
    );
  });

  it('tells them to check the number first', async () => {
    const response = await registerWithTin('also-not-a-tin');
    const said = `${response.body.error.message} ${response.body.error.nextStep ?? ''}`;
    assert.match(said, /check the number/i);
  });

  it('says what to do if the taxpayer genuinely has no TIN', async () => {
    // The legitimate case still has to be reachable, or an agent with a
    // genuinely unregistered trader is stuck.
    const response = await registerWithTin('yet-another-non-tin');
    const said = `${response.body.error.message} ${response.body.error.nextStep ?? ''}`;
    assert.match(said, /never had a TIN/i);
  });
});
