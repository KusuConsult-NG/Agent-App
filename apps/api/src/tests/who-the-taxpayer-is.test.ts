/**
 * Two things the platform records about a taxpayer that nothing ever recorded.
 *
 * `taxpayers.gender` is accepted on registration and on correction, and every
 * taxpayer the suite had ever created left it out — so the column existed, the
 * form offered it, and no run of this suite had ever stored a value in it.
 * It is not decoration: PRD §40 ties compliance to programmes like the
 * fertiliser subsidy, and who receives State support, broken down by sex, is
 * a figure a government is asked for.
 *
 * `assessments.assessment_type` had the same shape of gap for a bigger reason.
 * SELF_ASSESSMENT is a citizen declaring their own income rather than an agent
 * assessing them, which is a different act with a different evidential
 * standing — and the guard that stops it being used on an item nobody may
 * self-assess had never been reached from either side.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nairaToKobo } from '@psirs/shared';
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
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agent: { token: string; device: string };
let lgaId = '';
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
  await createGovernmentUser({ fullName: 'Register Admin', phone: '+2348036000001', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
  lgaId = await firstLgaId();
  sequence = 0;
});

const asAgent = () => ({ token: agent.token, deviceId: agent.device });

async function register(overrides: Record<string, unknown> = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(2, '0');
  const response = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Register',
      lastName: `Subject${suffix}`,
      phone: `+23481060000${suffix}`,
      address: '2 Zaria Road, Jos',
      lgaId,
      consentGiven: true,
      declarationAccepted: true,
      ...overrides,
    },
    { ...asAgent(), idempotencyKey: `reg-${suffix}` },
  );
  return response;
}

describe('A taxpayer’s own particulars', () => {
  for (const gender of ['MALE', 'FEMALE'] as const) {
    it(`records ${gender.toLowerCase()} when the register says so`, async () => {
      const created = await register({ gender });
      assert.equal(created.status, 201, JSON.stringify(created.body));

      const stored = await queryOne<{ gender: string | null }>(
        pool,
        'SELECT gender FROM taxpayers WHERE id = $1',
        [created.body.taxpayerId],
      );
      assert.equal(stored?.gender, gender);
    });
  }

  it('leaves it unset rather than guessing when nobody said', async () => {
    const created = await register();
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const stored = await queryOne<{ gender: string | null }>(
      pool,
      'SELECT gender FROM taxpayers WHERE id = $1',
      [created.body.taxpayerId],
    );
    assert.equal(stored?.gender, null, 'a blank field is not UNSPECIFIED, and neither is a guess');
  });
});

describe('A citizen declaring their own income', () => {
  it('is recorded as a self-assessment rather than as an agent’s figure', async () => {
    const taxpayer = await register({ gender: 'FEMALE' });
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        revenueItemId: await revenueItemByCode('PIT-DIRECT'),
        assessmentType: 'SELF_ASSESSMENT',
        inputs: { baseAmountKobo: nairaToKobo('2400000').toString() },
      },
      { ...asAgent(), idempotencyKey: 'self-assessment-1' },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    const stored = await queryOne<{ assessment_type: string; computation_inputs: unknown }>(
      pool,
      'SELECT assessment_type, computation_inputs FROM assessments WHERE id = $1',
      [assessment.body.assessmentId],
    );
    assert.equal(stored?.assessment_type, 'SELF_ASSESSMENT');
    assert.ok(stored!.computation_inputs, 'the figures the citizen declared are kept');
  });

  it('is refused on an item nobody may self-assess', async () => {
    const taxpayer = await register();
    const refused = await post(
      '/revenue/assessments',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        // A market stall fee is set by the schedule, not declared by the trader.
        revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
        assessmentType: 'SELF_ASSESSMENT',
        inputs: {},
      },
      { ...asAgent(), idempotencyKey: 'self-assessment-2' },
    );
    assert.notEqual(refused.status, 201, JSON.stringify(refused.body));

    const count = await queryOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM assessments WHERE assessment_type = 'SELF_ASSESSMENT'`,
    );
    assert.equal(count?.n, '0');
  });
});
