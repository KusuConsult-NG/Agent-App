/**
 * A demonstration where the collection never completes.
 *
 * `DEMO_RELAX_DEVICE_BINDING` got a presenter's own browser as far as taking
 * an assessment. It could not get them any further. On a demonstration
 * deployment — a real deployment, production image, `NODE_ENV=production` —
 * `config.ts` refuses to boot with `PAYMENT_GATEWAY=mock`, so the gateway is
 * a real one nobody has credentials for, and `POST /payments/simulate` is
 * refused outright. The agent starts a payment and watches it stay PENDING
 * for ever: the app is dead at the one screen it exists for.
 *
 * The refusal is right where money is real. A mock gateway in production
 * accepts payments nobody ever made, and this is tax. So, exactly as device
 * binding did, the deployment names itself instead:
 *
 *     DEMO_ALLOW_MOCK_GATEWAY=true
 *
 * WHAT IT MUST NOT TOUCH
 *
 * Everything else the production check refuses — a mock TIN service, local
 * storage, a per-process rate limiter — and the webhook signature rules. This
 * permits the *development* gateway; it does not loosen a real one. Those are
 * the assertions worth having here; that simulation works with the flag on is
 * the easy half.
 *
 * AND THE BUTTON THAT HID ITSELF
 *
 * `Collect.tsx` decided whether to offer "simulate" with `import.meta.env.DEV`
 * — right while the only deployment that could simulate was a developer's, and
 * wrong the moment this flag existed, because a production build hid the
 * control on exactly the deployment that had just been given it. The server
 * now answers that question on every transaction status, which is why
 * `simulation_available` is asserted below rather than left to the client.
 */

import './demo-gateway-env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createGovernmentUser,
  get,
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
import { config } from '../config';

let agentToken = '';
let handset = '';
let taxpayerId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  // seedDemoAgent returns null without an admin to clear the agent, which
  // would leave every assertion below failing on the fixture.
  await createGovernmentUser({
    fullName: 'Gateway Admin',
    phone: '+2348000000042',
    role: 'admin',
  });
  const demo = await seedDemoAgent();
  assert.ok(demo, 'the demonstration agent must seed for this suite to mean anything');
  handset = demo!.deviceIdentifier;
  agentToken = (await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier)).accessToken;

  const lga = await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1');
  const taxpayer = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      lastName: 'Bulus',
      phone: '+2348031999002',
      address: '2 Ahmadu Bello Way, Jos',
      lgaId: lga!.id,
      consentGiven: true,
      declarationAccepted: true,
    },
    { token: agentToken, deviceId: handset },
  );
  assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));
  taxpayerId = taxpayer.body.taxpayerId;
});

/** Assess and start a payment — the agent's job, right up to the gateway. */
let nextKey = 0;
async function startCollection(): Promise<{ reference: string; gatewayReference: string }> {
  const assessment = await post(
    '/revenue/assessments',
    { taxpayerId, revenueItemId: await revenueItemByCode('DEV-LEVY'), inputs: {} },
    { token: agentToken, deviceId: handset },
  );
  assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

  nextKey += 1;
  const initiated = await post(
    '/payments/initiate',
    { transactionId: assessment.body.transactionId, paymentMethod: 'POS' },
    { token: agentToken, deviceId: handset, idempotencyKey: `demo-gateway-${nextKey}` },
  );
  assert.equal(initiated.status, 201, JSON.stringify(initiated.body));

  const gatewayReference = initiated.body.gatewayReference as string;
  assert.ok(gatewayReference, 'the mock gateway should have issued a reference');
  return { reference: assessment.body.transactionReference as string, gatewayReference };
}

/** Same walk as `a-demonstration-nobody-can-give.test.ts`, for the same reason:
 *  these assertions read the source, and the suite's cwd is not fixed. */
function workspaceRoot(): string {
  let directory = process.cwd();
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (parsed.workspaces) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('no workspace root above ' + process.cwd());
    directory = parent;
  }
}

describe('with the mock gateway permitted for a demonstration', () => {
  it('is actually permitted, or nothing below means anything', () => {
    // The ordering trap `demo-gateway-env.ts` exists for.
    assert.equal(
      config.payments.demoAllowMockGateway,
      true,
      'DEMO_ALLOW_MOCK_GATEWAY did not reach config — demo-gateway-env.ts must ' +
        'be the first import in this file, before anything pulls in config',
    );
  });

  it('tells the app the simulate control would answer, so it can show it', async () => {
    const { reference } = await startCollection();
    const status = await get(`/payments/transactions/${reference}/status`, {
      token: agentToken,
      deviceId: handset,
    });

    assert.equal(
      status.body.simulation_available,
      true,
      'the status payload must say so: the app no longer decides this from its ' +
        'own build mode, because a production build hid the control on exactly ' +
        'the deployment that had been given it',
    );
  });

  it('completes a collection end to end, which is the whole point', async () => {
    const { reference, gatewayReference } = await startCollection();

    const simulated = await post(
      '/payments/simulate',
      { gatewayReference, outcome: 'SUCCESS' },
      { token: agentToken, deviceId: handset },
    );
    assert.equal(simulated.status, 200, JSON.stringify(simulated.body));

    const status = await get(`/payments/transactions/${reference}/status`, {
      token: agentToken,
      deviceId: handset,
    });
    // VERIFIED, not SUCCESS: the webhook the simulation delivers is put
    // through the real handler, which only closes a payment once it has
    // verified the amount against the invoice.
    assert.equal(status.body.transaction.payment_status, 'VERIFIED');
    /*
     * An acknowledgement, not a receipt. The receipt is issued when the
     * settlement covering the payment is reconciled; what the taxpayer is
     * handed at the stall, the moment the gateway confirms, is the
     * acknowledgement — and that is the screen the demonstration could never
     * reach before.
     */
    assert.ok(
      status.body.transaction.acknowledgement_number,
      'a confirmed collection issues an acknowledgement — without one the ' +
        'demonstration stops at exactly the screen it stopped at before',
    );
  });
});

describe('what the flag deliberately does not do', () => {
  it('relaxes the mock gateway and nothing else the production check refuses', () => {
    /*
     * The refusals that share that block — a mock TIN service, local storage,
     * a per-instance rate limiter — are not conveniences this flag was asked
     * to buy. Asserted against the source because the block only runs in a
     * production process, which this suite is not.
     */
    const source = readFileSync(join(workspaceRoot(), 'apps/api/src/config.ts'), 'utf8');
    const block = source.slice(source.indexOf('if (isProduction) {'));

    for (const refusal of ['TIN_SERVICE is still', 'STORAGE_DRIVER is still', 'RATE_LIMIT_STORE is']) {
      const line = block.split('\n').find((candidate) => candidate.includes(refusal));
      assert.ok(line, `config.ts no longer refuses on ${refusal}`);
      assert.doesNotMatch(
        line!,
        /demoAllowMockGateway/,
        `${refusal} is now conditioned on DEMO_ALLOW_MOCK_GATEWAY — the flag was ` +
          'asked to permit a mock payment gateway, not to wave the deployment through',
      );
    }
  });

  it('is not forced off in production, which is the only place it is needed', () => {
    /*
     * The same trap `DEVICE_AUTO_APPROVE` fell into: written as
     * `isProduction ? false : …` it would be inert on exactly the deployments
     * it exists for, and the demonstration would silently stop working on the
     * only one that matters.
     */
    const source = readFileSync(join(workspaceRoot(), 'apps/api/src/config.ts'), 'utf8');
    const line = source
      .split('\n')
      .find((candidate) => candidate.includes('demoAllowMockGateway:'));

    assert.ok(line, 'config.ts no longer defines demoAllowMockGateway');
    assert.doesNotMatch(line!, /isProduction/, 'demoAllowMockGateway is now gated on isProduction');
  });

  it('actually consults the flag, which running this suite cannot show', () => {
    /*
     * Written as `return !config.isProduction`, every behavioural test above
     * still passes: NODE_ENV is 'test' here, so the first half is true and
     * the flag is never read. The predicate would then be exactly what it
     * was before — and the demonstration deployment it exists for, which IS
     * production, would still have no way to complete a collection.
     *
     * Mutation-checked: replacing the return with `!config.isProduction`
     * leaves all six other tests green and fails only this one.
     */
    const source = readFileSync(join(workspaceRoot(), 'apps/api/src/routes/payments.ts'), 'utf8');
    const start = source.indexOf('export function simulationAvailable');
    assert.notEqual(start, -1, 'payments.ts no longer defines simulationAvailable');
    const body = source.slice(start, source.indexOf('\n}', start));

    assert.match(
      body,
      /demoAllowMockGateway/,
      'simulationAvailable no longer reads DEMO_ALLOW_MOCK_GATEWAY, so a ' +
        'demonstration deployment is back to a collection that cannot complete',
    );
    assert.match(
      body,
      /isMockGateway/,
      'simulationAvailable no longer requires the mock gateway — there is ' +
        'nothing to simulate against a live one, and offering to would be a lie',
    );
  });

  it('is announced at every boot rather than refusing to boot', () => {
    // A flag that refuses to start is a flag nobody can use. A warning in
    // every container's log is the other way of making it impossible to run
    // a deployment whose payments are fictional without saying so.
    const server = readFileSync(join(workspaceRoot(), 'apps/api/src/server.ts'), 'utf8');
    assert.match(
      server,
      /demoAllowMockGateway[\s\S]{0,300}log\.warn/,
      'server.ts no longer warns at boot when the gateway is a mock, so a ' +
        'deployment could issue receipts for payments nobody made and nothing ' +
        'in its log would say so',
    );
  });
});
