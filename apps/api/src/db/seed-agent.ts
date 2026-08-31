/**
 * A cleared, active demonstration agent (development only).
 *
 * Agents are deliberately not seeded the way government users are. One does not
 * exist until it has been through the whole clearance pipeline, and that is the
 * central rule of the platform rather than a formality:
 *
 *   No KYC + No Referee Clearance  →  No Agent Activation
 *   No Agent Activation            →  No Access to Revenue Collection
 *
 * Inserting a row straight into `agents` with `operational_status = 'ACTIVE'`
 * would be refused by the `agent_activation_requires_clearance` CHECK
 * constraint, and rightly so. So this walks the real pipeline through the real
 * service functions — the same calls the HTTP routes make — and the agent it
 * produces is active because it genuinely satisfied every requirement.
 *
 * That makes it slower than an INSERT and worth it: if a step ever stops
 * working, seeding fails here rather than producing a demonstration agent that
 * could not exist in production.
 */

import { config } from '../config';
import { pool, queryOne } from './pool';
import * as agents from '../services/agents';
import * as referees from '../services/referees';

/** Identity numbers ending 9, 8 or 0 fail, stall or stall at the mock KYC provider. */
const CLEARING_IDENTITY = '12345678901';
const REFEREE_IDENTITY = '22233344455';

export interface DemoAgent {
  agentId: string;
  phone: string;
  password: string;
  deviceIdentifier: string;
}

export async function seedDemoAgent(): Promise<DemoAgent | null> {
  if (config.isProduction) {
    throw new Error('Refusing to seed a demonstration agent in production.');
  }

  const phone = '+2347010000001';
  const password = 'FieldAgent2026';
  const deviceIdentifier = 'demo-agent-device-000001';

  const existing = await queryOne<{ id: string; operational_status: string }>(
    pool,
    `SELECT a.id, a.operational_status FROM agents a
       JOIN users u ON u.id = a.user_id WHERE u.phone = $1`,
    [phone],
  );
  if (existing) {
    console.log(`  demonstration agent already exists (${existing.operational_status})`);
    return { agentId: existing.id, phone, password, deviceIdentifier };
  }

  /*
   * The Local Government Area the demonstration is set in, not whichever one
   * sorts first alphabetically.
   *
   * This used to be `ORDER BY name LIMIT 1`, which is Barkin Ladi — while this
   * agent's own address is on Rwang Pam Street and every taxpayer the UAT seed
   * registers is in Jos. Nobody noticed until the search was scoped by
   * territory, and then the demonstration stack shipped a field agent who
   * could not find a single one of the twelve traders in it. An agent works
   * where the people they collect from are.
   */
  const lga = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM lgas ORDER BY (name = 'Jos North') DESC, name LIMIT 1`,
  );
  if (!lga) {
    console.log('  skipping demonstration agent: reference data is not seeded yet');
    return null;
  }

  const admin = await queryOne<{ id: string; role: string }>(
    pool,
    `SELECT id, role FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`,
  );
  if (!admin) {
    console.log('  skipping demonstration agent: no admin user to approve it (run with --demo)');
    return null;
  }

  console.log('  seeding a demonstration agent through the clearance pipeline...');

  // 1. Application. This creates the user and the agent record, both PENDING.
  const application = await agents.submitApplication({
    input: {
      fullName: 'Demo Field Agent',
      phone,
      email: 'agent@psirs.demo',
      password,
      dateOfBirth: '1992-04-11',
      gender: 'UNSPECIFIED',
      address: '14 Rwang Pam Street, Jos',
      lgaId: lga.id,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Demo Field Agent',
      accountNumber: '0123456781',
    },
  });
  const agentId = application.agentId;
  const actorId = application.userId;

  // 2. Identity. The mock provider clears an identity number ending 1.
  await agents.submitKyc({
    agentId,
    actorId,
    identityType: 'NIN',
    identityNumber: CLEARING_IDENTITY,
  });

  // 3. Referee — nominated by the applicant, answered by the referee. The
  //    invitation token is returned once and never stored in plaintext, so it
  //    has to be carried from here to the response.
  const nomination = await referees.nominateReferee({
    agentId,
    actorId,
    input: {
      fullName: 'Hon. Bitrus Gyang',
      phone: '+2347020000001',
      email: 'referee@psirs.demo',
      category: 'COMMUNITY_LEADER',
      relationship: 'District head of the applicant community',
      occupation: 'Community leader',
    },
  });

  await referees.submitRefereeResponse({
    token: nomination.invitationToken,
    input: {
      confirmsKnowsApplicant: true,
      confirmsInformationAccurate: true,
      willingToActAsReferee: true,
      understandsConsequences: true,
      identityType: 'NIN',
      identityNumber: REFEREE_IDENTITY,
    },
  });

  // 4. Government review. Every decision needs a reason (Addendum §29).
  await agents.reviewApplication({
    agentId,
    decision: 'APPROVE',
    reason: 'Demonstration fixture: identity and referee clearance both complete.',
    actorId: admin.id,
    actorRole: admin.role,
  });

  // 5. Training, bank verification, agreement, device — the remaining
  //    checklist items, in the order the applicant would reach them.
  const status = await agents.getApplicationStatus(pool, agentId);
  for (const module of status.training as { code: string; assessed: boolean }[]) {
    await agents.completeTrainingModule({
      agentId,
      moduleCode: module.code,
      score: module.assessed ? 95 : undefined,
      actorId,
    });
  }

  await agents.verifyBankAccount({ agentId, actorId });

  const agreement = await queryOne<{ version: string }>(
    pool,
    `SELECT version FROM agreement_versions WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
  );
  if (agreement) {
    await agents.acceptAgreement({ agentId, agreementVersion: agreement.version, actorId });
  }

  await agents.registerDevice({
    agentId,
    deviceIdentifier,
    deviceName: 'Demonstration handset',
    pwaVersion: config.pwa.minimumAgentVersion,
    actorId,
  });

  // 6. Activation, which refuses while any item above is outstanding.
  const territory = await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM territories WHERE lga_id = $1 LIMIT 1',
    [lga.id],
  );
  await agents.activate({
    agentId,
    territoryId: territory?.id ?? null,
    actorId: admin.id,
    actorRole: admin.role,
  });

  const final = await queryOne<{ operational_status: string }>(
    pool,
    'SELECT operational_status FROM agents WHERE id = $1',
    [agentId],
  );
  if (final?.operational_status !== 'ACTIVE') {
    throw new Error(
      `Demonstration agent finished the pipeline as ${final?.operational_status}, not ACTIVE. ` +
        'A clearance step is failing — the fixture is not the thing to fix.',
    );
  }

  return { agentId, phone, password, deviceIdentifier };
}
