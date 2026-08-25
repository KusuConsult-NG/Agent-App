/**
 * What the constraint promises, and what it delivers.
 *
 * `agents` carries a CHECK constraint whose comment in 002_identity.sql reads:
 * "A misbehaving service or a hand-run UPDATE cannot produce an active agent
 * that skipped clearance." Clearance is seven gates. The constraint names four
 * of them — kyc_status, referee_status, training_status and clearance_status —
 * because a CHECK cannot see another table, and the other three live in
 * `agent_clearance`: the agreement the agent is bound by, the bank account
 * their commission is paid into, and the handset they collect on.
 *
 * So the promise overshoots by three, and the overshoot is repeated where it
 * does damage. `requireActiveAgent` re-derives all seven blockers on every
 * request and refuses, under a comment that calls itself "defence in depth"
 * because "the DB CHECK constraint should make an active agent with unmet
 * requirements unreachable". That reading makes the middleware check look
 * redundant. It is not redundant: for the agreement, the bank account and the
 * device it is the only thing standing there, and the next person tidying a
 * hot path has been told otherwise in a comment.
 *
 * Nothing today reaches this. `activate()` checks all seven and is the only
 * writer of operational_status = 'ACTIVE'. This is about what the database
 * would allow if that stopped being true — which is the entire reason the
 * constraint exists rather than a comment saying "remember to check".
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

let agentId = '';
let officerId = '';
let approverId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Clearance Admin', phone: '+2348000000110', role: 'admin' });
  // The database refuses an approval whose requester is its approver, so an
  // override fixture needs two people — the control doing its job on a test.
  await createGovernmentUser({ fullName: 'Second Officer', phone: '+2348000000111', role: 'admin' });
  const demo = await seedDemoAgent();
  assert.ok(demo);

  const row = await queryOne<{ id: string }>(
    pool,
    'SELECT a.id FROM agents a JOIN users u ON u.id = a.user_id WHERE u.phone = $1',
    [demo!.phone],
  );
  agentId = row!.id;

  const officer = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM users WHERE phone = '+2348000000110'`,
  );
  officerId = officer!.id;

  const second = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM users WHERE phone = '+2348000000111'`,
  );
  approverId = second!.id;

  // Start from inactive, so each case is a transition into ACTIVE.
  await pool.query(`UPDATE agents SET operational_status = 'INACTIVE' WHERE id = $1`, [agentId]);
});

/** Withdraw one clearance flag and try to make the agent active by hand. */
async function activateWithout(flag: string) {
  await pool.query(`UPDATE agent_clearance SET ${flag} = false WHERE agent_id = $1`, [agentId]);
  return pool.query(`UPDATE agents SET operational_status = 'ACTIVE' WHERE id = $1`, [agentId]);
}

describe('The database refuses an active agent who skipped a gate', () => {
  it('refuses to activate an agent who has never accepted the agent agreement', async () => {
    await assert.rejects(
      activateWithout('agreement_accepted'),
      /agreement has not been accepted/i,
      'the database allowed an active agent bound by terms they never accepted',
    );

    const after = await queryOne<{ operational_status: string }>(
      pool,
      'SELECT operational_status FROM agents WHERE id = $1',
      [agentId],
    );
    assert.notEqual(after!.operational_status, 'ACTIVE');
  });

  /*
   * The bank account and the device are NOT enforced here, and that is a
   * decision rather than an omission — recorded so the next reader does not
   * take the silence for coverage. `activate()` refuses all seven and the
   * middleware re-derives all seven per request; what the database adds is
   * the agreement alone, because it is the only one of the three with no
   * legitimate later ordering. See 029 for the reasoning.
   */
  it('leaves the bank account and the device to the application, on purpose', async () => {
    for (const flag of ['bank_verified', 'device_registered'] as const) {
      await pool.query(`UPDATE agents SET operational_status = 'INACTIVE' WHERE id = $1`, [agentId]);
      await pool.query(`UPDATE agent_clearance SET ${flag} = false WHERE agent_id = $1`, [agentId]);
      await pool.query(`UPDATE agents SET operational_status = 'ACTIVE' WHERE id = $1`, [agentId]);
      await pool.query(`UPDATE agent_clearance SET ${flag} = true WHERE agent_id = $1`, [agentId]);
    }
  });

  it('still allows it when a recorded override says so', async () => {
    // Addendum §41: an override is possible only as an explicit, reasoned,
    // approved exception. The database asks for the record, not the reasoning.
    const approval = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO approvals (approval_type, entity_type, entity_id, payload, requested_reason,
                              requested_by, approved_by, status, approved_at, decision_reason)
       VALUES ('AGENT_OVERRIDE_ACTIVATION','agent',$1,'{}'::jsonb,'Urgent market coverage',
               $2,$3,'APPROVED',now(),'Approved for urgent market coverage')
       RETURNING id`,
      [agentId, officerId, approverId],
    );
    await pool.query(
      `UPDATE agent_clearance
          SET agreement_accepted = false, override_approval_id = $2,
              override_reason = 'Activated with outstanding: agreement'
        WHERE agent_id = $1`,
      [agentId, approval!.id],
    );

    await pool.query(`UPDATE agents SET operational_status = 'ACTIVE' WHERE id = $1`, [agentId]);
    const after = await queryOne<{ operational_status: string }>(
      pool,
      'SELECT operational_status FROM agents WHERE id = $1',
      [agentId],
    );
    assert.equal(after!.operational_status, 'ACTIVE');
  });

  // --- controls ---

  it('still activates an agent who has met every gate', async () => {
    await pool.query(`UPDATE agents SET operational_status = 'ACTIVE' WHERE id = $1`, [agentId]);
    const after = await queryOne<{ operational_status: string }>(
      pool,
      'SELECT operational_status FROM agents WHERE id = $1',
      [agentId],
    );
    assert.equal(after!.operational_status, 'ACTIVE');
  });

  it('still lets an already-active agent be updated after a device is revoked', async () => {
    // The check is on becoming active, not on being active. Revoking a handset
    // clears device_registered, and an agent in that state still has to be
    // suspendable, reassignable and correctable.
    await pool.query(`UPDATE agents SET operational_status = 'ACTIVE' WHERE id = $1`, [agentId]);
    await pool.query(`UPDATE agent_clearance SET device_registered = false WHERE agent_id = $1`, [
      agentId,
    ]);

    await pool.query(`UPDATE agents SET supervisor_id = NULL WHERE id = $1`, [agentId]);
    await pool.query(`UPDATE agents SET operational_status = 'SUSPENDED' WHERE id = $1`, [agentId]);

    const after = await queryOne<{ operational_status: string }>(
      pool,
      'SELECT operational_status FROM agents WHERE id = $1',
      [agentId],
    );
    assert.equal(after!.operational_status, 'SUSPENDED');
  });

  it('still refuses the four gates the CHECK constraint already covered', async () => {
    await pool.query(`UPDATE agents SET training_status = 'IN_PROGRESS' WHERE id = $1`, [agentId]);
    await assert.rejects(
      pool.query(`UPDATE agents SET operational_status = 'ACTIVE' WHERE id = $1`, [agentId]),
      /agent_activation_requires_clearance|clearance/i,
    );
  });
});
