/**
 * Informal-sector groups, and the allocation of physical benefits.
 *
 * Two halves of one problem: how the state finds people who do not arrive on
 * their own, and how it hands out something there is only a finite amount of.
 *
 * A group — a farmers' cooperative, a market association, a transport union —
 * identifies and vouches. It does not transact. Every liability and every
 * benefit stays attached to an individual taxpayer, so the audit trail keeps
 * naming a person rather than a body. That is a deliberate limit: a
 * cooperative paying a bulk levy for its members is a different design.
 *
 * Membership is a claim until the group's leader attests to it, and nothing
 * downstream may rely on an unattested claim. The reason is specific: the
 * agent who registers members is paid commission on collections, so an agent
 * who could also confirm membership would be attesting to the size of their
 * own opportunity. The leader attests through a tokenised link, the same
 * pattern as a referee confirming an agent, because a cooperative chairman in
 * a village should not need an account to answer a question about his own
 * members.
 */

import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound } from '../lib/errors';
import { nextGroupCode } from '../lib/references';
import { generateVerificationCode, sha256 } from '../lib/crypto';
import { recordAudit } from './audit';
import { groupAttestationUrl } from '../lib/public-urls';

const ATTESTATION_TTL_DAYS = 14;

export interface GroupInput {
  name: string;
  groupType: string;
  economicSector?: string | null;
  lgaId: string;
  wardId?: string | null;
  community?: string | null;
  leaderTaxpayerId?: string | null;
  leaderName: string;
  leaderPhone: string;
  memberEstimate?: number | null;
}

/** Register a group. It starts PENDING: an officer decides whether it is real. */
export async function registerGroup(params: {
  input: GroupInput;
  actorId: string;
  actorRole: string;
}): Promise<{ groupId: string; code: string }> {
  return withTransaction(async (client) => {
    const ward = params.input.wardId;
    if (ward) {
      // A ward that is not in the stated LGA would put the group on a map in
      // the wrong place, and every geographic report downstream with it.
      const belongs = await queryOne<{ id: string }>(
        client,
        'SELECT id FROM wards WHERE id = $1 AND lga_id = $2',
        [ward, params.input.lgaId],
      );
      if (!belongs) {
        throw badRequest('That ward is not in the local government area given for this group.', [
          { field: 'wardId', issue: 'Choose a ward inside the selected LGA.' },
        ]);
      }
    }

    const code = await nextGroupCode(client);
    const group = await queryOne<{ id: string }>(
      client,
      `INSERT INTO taxpayer_groups
         (code, name, group_type, economic_sector, lga_id, ward_id, community,
          leader_taxpayer_id, leader_name, leader_phone, member_estimate, registered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        code,
        params.input.name,
        params.input.groupType,
        params.input.economicSector ?? null,
        params.input.lgaId,
        ward ?? null,
        params.input.community ?? null,
        params.input.leaderTaxpayerId ?? null,
        params.input.leaderName,
        params.input.leaderPhone,
        params.input.memberEstimate ?? null,
        params.actorId,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'group.registered',
      entityType: 'taxpayer_group',
      entityId: group!.id,
      newValue: { code, name: params.input.name, groupType: params.input.groupType },
    });

    return { groupId: group!.id, code };
  });
}

/** An officer's decision on whether a group is genuine. */
export async function reviewGroup(params: {
  groupId: string;
  decision: 'APPROVE' | 'SUSPEND';
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<{ status: string }> {
  return withTransaction(async (client) => {
    const group = await queryOne<{ id: string; status: string }>(
      client,
      'SELECT id, status FROM taxpayer_groups WHERE id = $1 FOR UPDATE',
      [params.groupId],
    );
    if (!group) throw notFound('That group');

    const status = params.decision === 'APPROVE' ? 'ACTIVE' : 'SUSPENDED';
    await client.query(
      `UPDATE taxpayer_groups
          SET status = $2, approved_by = $3, approved_at = now(),
              suspension_reason = CASE WHEN $2 = 'SUSPENDED' THEN $4 ELSE NULL END
        WHERE id = $1`,
      [params.groupId, status, params.actorId, params.reason],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'group.reviewed',
      entityType: 'taxpayer_group',
      entityId: params.groupId,
      oldValue: { status: group.status },
      newValue: { status },
      reason: params.reason,
    });

    return { status };
  });
}

/**
 * Record that a taxpayer says they belong to a group.
 *
 * A claim, not a fact, until the leader attests. Re-adding somebody who left
 * reopens their existing row rather than creating a second one, because a
 * person's history with a cooperative is one story.
 */
export async function addMember(params: {
  groupId: string;
  taxpayerId: string;
  memberReference?: string | null;
  joinedOn?: string | null;
  actorId: string;
  actorRole: string;
}): Promise<{ membershipId: string; status: string }> {
  return withTransaction(async (client) => {
    const group = await queryOne<{ id: string; status: string }>(
      client,
      'SELECT id, status FROM taxpayer_groups WHERE id = $1',
      [params.groupId],
    );
    if (!group) throw notFound('That group');
    if (group.status !== 'ACTIVE') {
      throw conflict(
        'GROUP_NOT_ACTIVE',
        `Members cannot be added while the group is ${group.status.toLowerCase()}.`,
        'An officer has to approve the group first.',
      );
    }

    const taxpayer = await queryOne<{ id: string }>(
      client,
      'SELECT id FROM taxpayers WHERE id = $1',
      [params.taxpayerId],
    );
    if (!taxpayer) throw notFound('That taxpayer');

    const membership = await queryOne<{ id: string; status: string }>(
      client,
      `INSERT INTO taxpayer_group_members
         (group_id, taxpayer_id, member_reference, joined_on, added_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (group_id, taxpayer_id) DO UPDATE
         SET status = 'PENDING_ATTESTATION',
             member_reference = COALESCE(EXCLUDED.member_reference,
                                         taxpayer_group_members.member_reference),
             joined_on = COALESCE(EXCLUDED.joined_on, taxpayer_group_members.joined_on),
             rejection_reason = NULL,
             updated_at = now()
       RETURNING id, status`,
      [
        params.groupId,
        params.taxpayerId,
        params.memberReference ?? null,
        params.joinedOn ?? null,
        params.actorId,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'group.member_claimed',
      entityType: 'taxpayer_group_member',
      entityId: membership!.id,
      newValue: { groupId: params.groupId, taxpayerId: params.taxpayerId },
    });

    return { membershipId: membership!.id, status: membership!.status };
  });
}

/**
 * A link the group's leader can open to confirm their membership list.
 *
 * One link for the group rather than one per member: a chairman with three
 * hundred farmers is not going to follow three hundred links, and a design
 * nobody can complete is a control that does not exist.
 */
export async function inviteLeaderToAttest(params: {
  groupId: string;
  actorId: string;
  actorRole: string;
}): Promise<{ invitationUrl: string; expiresAt: Date }> {
  return withTransaction(async (client) => {
    const group = await queryOne<{ id: string; status: string; leader_phone: string }>(
      client,
      'SELECT id, status, leader_phone FROM taxpayer_groups WHERE id = $1',
      [params.groupId],
    );
    if (!group) throw notFound('That group');
    if (group.status !== 'ACTIVE') {
      throw conflict('GROUP_NOT_ACTIVE', 'The group has to be approved before its leader is asked.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ATTESTATION_TTL_DAYS * 86_400_000);

    await client.query(
      `INSERT INTO group_attestation_invitations
         (group_id, invitation_token_hash, expires_at)
       VALUES ($1,$2,$3)`,
      [params.groupId, sha256(token), expiresAt],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'group.attestation_requested',
      entityType: 'taxpayer_group',
      entityId: params.groupId,
    });

    return {
      invitationUrl: groupAttestationUrl(token),
      expiresAt,
    };
  });
}

/** Resolve a leader's token to the list they are being asked about. */
export async function openAttestation(db: Db, token: string) {
  const invitation = await queryOne<{
    id: string;
    group_id: string;
    expires_at: Date;
    status: string;
    group_name: string;
    group_code: string;
    leader_name: string;
    lga_name: string;
  }>(
    db,
    `SELECT i.id, i.group_id, i.expires_at, i.status,
            g.name AS group_name, g.code AS group_code, g.leader_name,
            l.name AS lga_name
       FROM group_attestation_invitations i
       JOIN taxpayer_groups g ON g.id = i.group_id
       JOIN lgas l ON l.id = g.lga_id
      WHERE i.invitation_token_hash = $1`,
    [sha256(token)],
  );
  if (!invitation) throw notFound('That attestation request');
  if (invitation.expires_at.getTime() < Date.now()) {
    throw conflict('ATTESTATION_EXPIRED', 'This link has expired. Ask PSIRS for a new one.');
  }

  const members = await query<{
    id: string;
    status: string;
    full_name: string;
    phone: string;
    member_reference: string | null;
  }>(
    db,
    `SELECT m.id, m.status, m.member_reference,
            COALESCE(t.business_name, t.first_name || ' ' || COALESCE(t.last_name,'')) AS full_name,
            t.phone
       FROM taxpayer_group_members m
       JOIN taxpayers t ON t.id = m.taxpayer_id
      WHERE m.group_id = $1 AND m.status IN ('PENDING_ATTESTATION', 'ATTESTED')
      ORDER BY m.created_at`,
    [invitation.group_id],
  );

  return {
    groupName: invitation.group_name,
    groupCode: invitation.group_code,
    leaderName: invitation.leader_name,
    lga: invitation.lga_name,
    members,
  };
}

/**
 * The leader's answer: these people are members, those are not.
 *
 * Named on the record. `attested_by_name` is the leader as the group recorded
 * them, so a later enquiry can ask a specific person why somebody was on the
 * list, which is the whole value of an attestation over an assertion.
 */
export async function submitAttestation(params: {
  token: string;
  confirmedMemberIds: string[];
  rejectedMemberIds: string[];
  rejectionReason?: string | null;
}): Promise<{ attested: number; rejected: number }> {
  return withTransaction(async (client) => {
    const invitation = await queryOne<{
      id: string;
      group_id: string;
      expires_at: Date;
      leader_name: string;
    }>(
      client,
      `SELECT i.id, i.group_id, i.expires_at, g.leader_name
         FROM group_attestation_invitations i
         JOIN taxpayer_groups g ON g.id = i.group_id
        WHERE i.invitation_token_hash = $1
        FOR UPDATE OF i`,
      [sha256(params.token)],
    );
    if (!invitation) throw notFound('That attestation request');
    if (invitation.expires_at.getTime() < Date.now()) {
      throw conflict('ATTESTATION_EXPIRED', 'This link has expired. Ask PSIRS for a new one.');
    }

    const overlap = params.confirmedMemberIds.filter((id) =>
      params.rejectedMemberIds.includes(id),
    );
    if (overlap.length > 0) {
      throw badRequest('The same person cannot be both confirmed and rejected.');
    }

    // Scoped to this group: a token for one cooperative must not be able to
    // attest to another's membership by id.
    const attested = await query<{ id: string }>(
      client,
      `UPDATE taxpayer_group_members
          SET status = 'ATTESTED', attested_at = now(), attested_by_name = $3,
              rejection_reason = NULL
        WHERE group_id = $1 AND id = ANY($2::uuid[])
          AND status = 'PENDING_ATTESTATION'
        RETURNING id`,
      [invitation.group_id, params.confirmedMemberIds, invitation.leader_name],
    );

    const rejected = await query<{ id: string }>(
      client,
      `UPDATE taxpayer_group_members
          SET status = 'REJECTED', attested_at = now(), attested_by_name = $3,
              rejection_reason = $4
        WHERE group_id = $1 AND id = ANY($2::uuid[])
          AND status IN ('PENDING_ATTESTATION', 'ATTESTED')
        RETURNING id`,
      [
        invitation.group_id,
        params.rejectedMemberIds,
        invitation.leader_name,
        params.rejectionReason ?? 'The group leader did not confirm this membership',
      ],
    );

    await client.query(
      `UPDATE group_attestation_invitations
          SET status = 'OPENED', opened_at = COALESCE(opened_at, now()), last_used_at = now()
        WHERE id = $1`,
      [invitation.id],
    );

    await recordAudit(client, {
      actorId: null,
      actorRole: 'group_leader',
      action: 'group.membership_attested',
      entityType: 'taxpayer_group',
      entityId: invitation.group_id,
      newValue: {
        attested: attested.length,
        rejected: rejected.length,
        attestedBy: invitation.leader_name,
      },
    });

    return { attested: attested.length, rejected: rejected.length };
  });
}

/** The groups a taxpayer is an attested member of. */
export async function attestedGroupsFor(db: Db, taxpayerId: string) {
  return query<{ group_id: string; code: string; name: string; group_type: string }>(
    db,
    `SELECT g.id AS group_id, g.code, g.name, g.group_type
       FROM taxpayer_group_members m
       JOIN taxpayer_groups g ON g.id = m.group_id
      WHERE m.taxpayer_id = $1 AND m.status = 'ATTESTED' AND g.status = 'ACTIVE'`,
    [taxpayerId],
  );
}

export async function groupDetail(db: Db, groupId: string) {
  const group = await queryOne(
    db,
    `SELECT g.*, l.name AS lga_name, w.name AS ward_name,
            (SELECT count(*) FROM taxpayer_group_members m
              WHERE m.group_id = g.id AND m.status = 'ATTESTED') AS attested_members,
            (SELECT count(*) FROM taxpayer_group_members m
              WHERE m.group_id = g.id AND m.status = 'PENDING_ATTESTATION') AS pending_members
       FROM taxpayer_groups g
       JOIN lgas l ON l.id = g.lga_id
       LEFT JOIN wards w ON w.id = g.ward_id
      WHERE g.id = $1`,
    [groupId],
  );
  if (!group) throw notFound('That group');
  return group;
}

export async function listGroups(
  db: Db,
  options: { status?: string; lgaId?: string; sector?: string; limit?: number } = {},
) {
  return query(
    db,
    `SELECT g.id, g.code, g.name, g.group_type, g.economic_sector, g.status,
            l.name AS lga_name, g.leader_name, g.leader_phone,
            (SELECT count(*) FROM taxpayer_group_members m
              WHERE m.group_id = g.id AND m.status = 'ATTESTED') AS attested_members
       FROM taxpayer_groups g
       JOIN lgas l ON l.id = g.lga_id
      WHERE ($1::text IS NULL OR g.status = $1)
        AND ($2::uuid IS NULL OR g.lga_id = $2)
        AND ($3::text IS NULL OR g.economic_sector = $3)
      ORDER BY g.created_at DESC
      LIMIT $4`,
    [options.status ?? null, options.lgaId ?? null, options.sector ?? null, options.limit ?? 100],
  );
}
