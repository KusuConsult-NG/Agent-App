/**
 * The social incentive programme routes, none of which had a test.
 *
 * These programmes do not pay anyone. They score a taxpayer's compliance and
 * decide whether they qualify for a service government already provides —
 * health insurance, fertiliser subsidy, a housing scheme, a bursary — which is
 * why the safeguards below are about eligibility and denial rather than about
 * money.
 *
 * The one defect here is small and of a familiar shape: changing a
 * programme's status ran `UPDATE incentive_programmes SET status = $2 WHERE
 * id = $1` and then reported success without asking whether the row existed.
 * A wrong or stale id updated nothing, returned `200 {"status":"ACTIVE"}`,
 * and wrote an audit entry recording a status change to a programme that is
 * not there.
 *
 * The wasted call matters less than the entry. The audit chain is what
 * government reads to find out what happened, and a row saying a programme was
 * activated — sealed, hash-linked, indistinguishable from a true one — when no
 * programme was activated makes the record say something that is not so. An
 * operator who saw 200 would also have no reason to look again.
 *
 * The rest of these are coverage rather than repair: evaluation, the
 * beneficiary list and the bulk sweep behaved correctly when finally exercised,
 * and this pins that down.
 */

import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let adminToken = '';
let programmeId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  await createGovernmentUser({
    role: 'admin',
    phone: '+2348030000095',
    fullName: 'Incentive Admin',
  });
  adminToken = (await loginAs('+2348030000095')).accessToken;

  const created = await post(
    '/government/programmes',
    {
      name: 'Compliant Trader Housing Scheme',
      code: `CTH-${Date.now().toString().slice(-6)}`,
      benefitType: 'HOUSING_SUBSIDY',
      benefitDescription: 'Access to the state housing scheme for consistently compliant traders.',
      targetLgaIds: [await firstLgaId()],
      targetTaxpayerTypes: ['INDIVIDUAL'],
      minimumScore: 60,
      startDate: '2026-01-01',
      approvalAuthority: 'Plateau State Executive Council',
    },
    { token: adminToken },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  programmeId = created.body.programmeId ?? created.body.id;
  assert.ok(programmeId, `no programme id in ${JSON.stringify(created.body)}`);
});

const setStatus = (id: string, status: string) =>
  post(`/government/programmes/${id}/status`, { status }, { token: adminToken });

const auditCountFor = async (entityId: string) =>
  Number(
    (
      await queryOne<{ count: string }>(
        pool,
        `SELECT count(*)::text AS count FROM audit_logs
          WHERE action = 'incentive.programme_status_changed' AND entity_id = $1`,
        [entityId],
      )
    )!.count,
  );

describe('social incentive programmes', () => {
  it('activates a programme that exists', async () => {
    const response = await setStatus(programmeId, 'ACTIVE');

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const row = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM incentive_programmes WHERE id = $1',
      [programmeId],
    );
    assert.equal(row!.status, 'ACTIVE');
    assert.equal(await auditCountFor(programmeId), 1);
  });

  it('will not report a status change for a programme that does not exist', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';

    const response = await setStatus(missing, 'ACTIVE');

    assert.equal(response.status, 404, JSON.stringify(response.body));
    assert.equal(
      await auditCountFor(missing),
      0,
      'the audit log must not record a change that did not happen',
    );
  });

  it('evaluates a taxpayer against a programme', async () => {
    await setStatus(programmeId, 'ACTIVE');
    const taxpayer = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                              consent_given, declaration_accepted)
       VALUES ('INDIVIDUAL','Incentive','Candidate','+2348044440001','1 Road', $1, true, true)
       RETURNING id`,
      [await firstLgaId()],
    );

    const response = await post(
      `/government/programmes/${programmeId}/evaluate`,
      { taxpayerId: taxpayer!.id },
      { token: adminToken },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(
      typeof response.body.eligible,
      'boolean',
      `evaluation must state eligibility: ${JSON.stringify(response.body)}`,
    );
  });

  it('lists beneficiaries', async () => {
    await setStatus(programmeId, 'ACTIVE');

    const response = await get(`/government/programmes/${programmeId}/beneficiaries`, {
      token: adminToken,
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it('can create an additive essential-service programme', async () => {
    /*
     * PRD §40 allows an essential service to be linked to compliance in one of
     * two ways: additively, where compliance raises the benefit tier and never
     * withdraws the benefit, or as a gate, which needs a recorded legal basis.
     *
     * `linkageMode` reached the service, the §40 guard and the database — but
     * not the route's schema, and zod strips unknown keys silently. So every
     * programme created through the API was a gate, and the additive option,
     * the one that cannot deny a citizen health cover, could not be chosen.
     * An officer wanting a purely additive health programme was pushed into
     * recording a legal authority for a denial their programme does not make.
     */
    const response = await post(
      '/government/programmes',
      {
        name: 'Compliance Health Cover Uplift',
        code: `CHU-${Date.now().toString().slice(-6)}`,
        benefitType: 'HEALTH_INSURANCE',
        benefitDescription: 'Compliant taxpayers move to a higher cover tier.',
        linkageMode: 'ADDITIVE_BENEFIT',
        startDate: '2026-01-01',
        approvalAuthority: 'Plateau State Executive Council',
      },
      { token: adminToken },
    );

    assert.equal(response.status, 201, JSON.stringify(response.body));
    const row = await queryOne<{ linkage_mode: string }>(
      pool,
      'SELECT linkage_mode FROM incentive_programmes WHERE id = $1',
      [response.body.programmeId ?? response.body.id],
    );
    assert.equal(
      row!.linkage_mode,
      'ADDITIVE_BENEFIT',
      'the linkage the officer asked for must be the one stored',
    );
  });

  it('still refuses to gate an essential service without a legal basis', async () => {
    const response = await post(
      '/government/programmes',
      {
        name: 'Health Cover Compliance Gate',
        code: `HCG-${Date.now().toString().slice(-6)}`,
        benefitType: 'HEALTH_INSURANCE',
        benefitDescription: 'Cover withdrawn from taxpayers in arrears.',
        linkageMode: 'ELIGIBILITY_GATE',
        startDate: '2026-01-01',
        approvalAuthority: 'Plateau State Executive Council',
      },
      { token: adminToken },
    );

    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  it('runs the bulk evaluation', async () => {
    await setStatus(programmeId, 'ACTIVE');

    const response = await post(
      `/government/programmes/${programmeId}/evaluate-all`,
      {},
      { token: adminToken },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
  });
});
