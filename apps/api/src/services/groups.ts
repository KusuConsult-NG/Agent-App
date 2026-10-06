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
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nextGroupCode } from '../lib/references';
import { generateVerificationCode, maskPhone, sha256 } from '../lib/crypto';
import { recordAudit } from './audit';
import { queueNotification } from './notifications';
import { groupAttestationUrl } from '../lib/public-urls';
import { canonicalPhoneOrRaw } from '../lib/phone';

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
    /*
     * Not the person registering it.
     *
     * The leader's phone is where the attestation link goes, and the leader's
     * confirmation is what checks the members the registering agent claims. A
     * group registered with the agent's own number as the leader's would send
     * the agent their own confirmation. The officer approving the group sees
     * the number, but has no reason to know whose it is; this does.
     */
    const registrar = await queryOne<{ phone: string }>(
      client,
      'SELECT phone FROM users WHERE id = $1',
      [params.actorId],
    );
    if (
      registrar &&
      canonicalPhoneOrRaw(registrar.phone) === canonicalPhoneOrRaw(params.input.leaderPhone)
    ) {
      throw badRequest(
        'The leader’s phone is your own number. The leader confirms the members you record, ' +
          'so it has to be their phone, not yours.',
        [{ field: 'leaderPhone', issue: 'Enter the group leader’s own phone number.' }],
      );
    }

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

/**
 * The officer who registered a group is not the one who vouches for it.
 *
 * `group:manage` both registers a group and approves it, and nothing kept
 * the two apart. Measured: a revenue officer registered a farmers' union with
 * a leader phone of their choosing (201), approved it themselves (200,
 * ACTIVE) and gave it the ATTESTATION role (200), with the same officer as
 * `registered_by` and `approved_by`. Approval is what makes its attested
 * members eligible for incentive programmes, and ATTESTATION lets the group's
 * word on a member's stall stand against an agent's count. Approval is the
 * check that somebody other than the person making the claim looked at it.
 *
 * So approving the group, and conferring a part in enumeration on it, take an
 * officer other than the one who registered it. Suspending it, or taking its
 * part away, do not: both only reduce what the group can do.
 */
function assertNotRegistrant(
  group: { registered_by: string | null },
  actorId: string,
  what: string,
): void {
  if (group.registered_by !== actorId) return;
  throw forbidden(
    `You registered this group, so another officer has to ${what}.`,
    'Ask a colleague with group management to review it.',
  );
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
    const group = await queryOne<{ id: string; status: string; registered_by: string | null }>(
      client,
      'SELECT id, status, registered_by FROM taxpayer_groups WHERE id = $1 FOR UPDATE',
      [params.groupId],
    );
    if (!group) throw notFound('That group');
    if (params.decision === 'APPROVE') assertNotRegistrant(group, params.actorId, 'approve it');

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
 * Give a group a part to play in enumeration, or take it away.
 *
 * A registered association is not automatically an attesting body. Standing
 * over what its members are assessed on is something PSIRS confers, on the
 * record, with a reason — and the reason is the whole point: a leader who can
 * contradict an agent's count has real power over a member's bill, and a group
 * that acquired that power because somebody ticked a box on a registration
 * form would be a governance failure waiting to be discovered.
 *
 * Withdrawing it back to NONE is deliberately allowed. A union that starts
 * inflating its members' figures should stop being consulted the same day, and
 * that cannot wait on a schema change.
 */
export async function setGroupTaxRole(params: {
  groupId: string;
  taxRole: 'ENUMERATION' | 'ATTESTATION' | 'NONE';
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<{ taxRole: string }> {
  return withTransaction(async (client) => {
    const group = await queryOne<{
      id: string;
      status: string;
      tax_role: string;
      registered_by: string | null;
    }>(
      client,
      'SELECT id, status, tax_role, registered_by FROM taxpayer_groups WHERE id = $1 FOR UPDATE',
      [params.groupId],
    );
    if (!group) throw notFound('That group');
    /*
     * Only a group PSIRS has approved. A pending registration is a claim that
     * an association exists; giving it standing before anybody has checked
     * would let a group confer authority on itself by registering.
     */
    if (group.status !== 'ACTIVE' && params.taxRole !== 'NONE') {
      throw conflict(
        'GROUP_NOT_ACTIVE',
        `This group is ${group.status.toLowerCase()} and cannot be given a part in enumeration ` +
          'until it has been approved.',
      );
    }
    if (params.taxRole !== 'NONE') {
      assertNotRegistrant(group, params.actorId, 'give it a part in enumeration');
    }

    await client.query('UPDATE taxpayer_groups SET tax_role = $2 WHERE id = $1', [
      params.groupId,
      params.taxRole,
    ]);

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'group.tax_role_set',
      entityType: 'taxpayer_group',
      entityId: params.groupId,
      oldValue: { taxRole: group.tax_role },
      newValue: { taxRole: params.taxRole },
      reason: params.reason,
    });

    return { taxRole: params.taxRole };
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
 *
 * SENT TO THE LEADER, AND RETURNED TO NOBODY.
 *
 * This returned the link to whoever asked, and agents may ask: they hold
 * `group:register`, and the field screen showed the link under "send this to
 * the group leader". Nothing sent it to the leader. So an agent could record
 * members, open the link and confirm them, and the record named the leader as
 * the person who had. Measured end to end before this change: the claimed
 * member went to ATTESTED, attested by the leader's name, with no message to
 * the leader's phone. ATTESTED is what allocations award on.
 *
 * Now it goes by SMS to the leader's phone as the group was registered and
 * approved, and the caller is told the number it went to, masked. If no
 * message can be queued the request is refused and nothing is recorded: with
 * the link held by nobody, an invitation without a message is one nobody can
 * ever answer.
 */
export async function inviteLeaderToAttest(params: {
  groupId: string;
  actorId: string;
  actorRole: string;
}): Promise<{ sentTo: string; expiresAt: Date }> {
  return withTransaction(async (client) => {
    const group = await queryOne<{
      id: string;
      status: string;
      name: string;
      code: string;
      leader_name: string;
      leader_phone: string;
      leader_taxpayer_id: string | null;
    }>(
      client,
      `SELECT id, status, name, code, leader_name, leader_phone, leader_taxpayer_id
         FROM taxpayer_groups WHERE id = $1`,
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

    const leaderPhone = canonicalPhoneOrRaw(group.leader_phone);
    const queued = await queueNotification(client, {
      event: 'GROUP_ATTESTATION_INVITATION',
      recipientOverride: leaderPhone,
      // For the language they read, when the leader is a registered taxpayer.
      // The number is still the group's: the override wins over theirs.
      taxpayerId: group.leader_taxpayer_id,
      channels: ['SMS'],
      variables: {
        name: group.leader_name,
        group: group.name,
        code: group.code,
        link: groupAttestationUrl(token),
        expiry: expiresAt.toISOString().slice(0, 10),
      },
      // The link is the credential, as a referee's is: kept only until the
      // gateway takes it, and masked in the copy the platform keeps.
      secretVariables: ['link'],
      entityType: 'taxpayer_group',
      entityId: params.groupId,
    });
    if (queued === 0) {
      throw new AppError({
        statusCode: 503,
        code: 'ATTESTATION_NOT_SENT',
        message:
          'The confirmation link could not be sent to the group leader, so no request was made. ' +
          'Try again later.',
        nextStep: 'If this keeps happening, tell PSIRS support: the leader’s message is not being sent.',
      });
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'group.attestation_requested',
      entityType: 'taxpayer_group',
      entityId: params.groupId,
    });

    return { sentTo: maskPhone(leaderPhone), expiresAt };
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
  /*
   * Written for the person holding the link, not for the developer reading the
   * log. A cooperative chairman who mistypes a URL or follows an old message
   * gets a sentence telling him what happened and who can fix it — the same
   * courtesy the referee invitation extends, and for the same reason: neither
   * of them has an account, a support portal, or any idea what an
   * "attestation request" is.
   */
  if (!invitation) {
    throw new AppError({
      statusCode: 404,
      code: 'ATTESTATION_NOT_FOUND',
      message:
        'This membership link is not valid. Ask PSIRS to send you a new one.',
    });
  }
  if (invitation.expires_at.getTime() < Date.now()) {
    /*
     * Marked, not merely refused.
     *
     * The refusal reached the leader and left nothing behind, so the row went
     * on saying the link had been sent and was awaiting an answer. An officer
     * chasing an attestation could not tell a leader who is ignoring the
     * message from one whose link died before they opened it, and those are
     * different things to do about. The referee invitations have always marked
     * their own expiry; this is the same rule in the other place it applies.
     */
    await query(
      db,
      `UPDATE group_attestation_invitations SET status = 'EXPIRED'
        WHERE id = $1 AND status <> 'RESPONDED'`,
      [invitation.id],
    );
    throw new AppError({
      statusCode: 410,
      code: 'ATTESTATION_EXPIRED',
      message:
        'This membership link has expired. Ask PSIRS to send you a new one — ' +
        'your earlier answers are still on record.',
    });
  }

  /*
   * The roster, read as though a stranger asked for it — because one can.
   *
   * This route is unauthenticated by design and the token arrives by SMS on a
   * village chairman's handset, where (in the words of the test that narrowed
   * the write side) "a forwarded message is a forwarded capability". The
   * invitation is deliberately reusable and never becomes spent, so the link
   * stays live for its whole fourteen days.
   *
   * It returned every member's telephone number in full. That is the
   * cooperative's phone book, handed to whoever kept the message — and the
   * standard this platform applies elsewhere is explicit: `citizen.ts` strips
   * the TIN, the compliance score, the obligation names and the officer's note
   * from its public answer on the reasoning that "every field here is read as
   * though a stranger asked for it", and the agent application masks the
   * number a code was sent to as "enough to recognise, not to publish".
   *
   * The number is masked and not dropped, because the screen's whole question
   * is "is this person really one of yours" and two members can share a name.
   * Three digits answer that for a leader who knows their own members; they
   * answer nothing at all for anyone else.
   */
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
    members: members.map((member) => ({ ...member, phone: maskPhone(member.phone) })),
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
    if (!invitation) {
      throw new AppError({
        statusCode: 404,
        code: 'ATTESTATION_NOT_FOUND',
        message: 'This membership link is not valid. Ask PSIRS to send you a new one.',
      });
    }
    if (invitation.expires_at.getTime() < Date.now()) {
      /*
       * Not marked here, unlike the read above, and deliberately.
       *
       * This runs inside the transaction that holds `FOR UPDATE OF i`, and the
       * refusal below rolls that transaction back — so a mark written here
       * would be undone on its way out, and writing it on a second connection
       * would wait for a lock this transaction is still holding. Opening the
       * link is what marks it, and a leader who reaches this branch reached it
       * through a page that had already been opened.
       */
      throw new AppError({
        statusCode: 410,
        code: 'ATTESTATION_EXPIRED',
        message:
          'This membership link expired before your answers were sent. Ask PSIRS for a ' +
          'new one — nothing you entered has been lost from the list.',
      });
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

    /*
     * Outstanding questions only, exactly as the confirm above.
     *
     * `ATTESTED` used to be on this line, which meant a confirmation could be
     * taken back through the link at any point in its fourteen days by anybody
     * holding it. The invitation is deliberately reusable — a cooperative
     * grows and the leader answers about whoever is new — so it never becomes
     * spent, and these arrive by SMS to a village chairman's handset where a
     * forwarded message is a forwarded capability. `openAttestation` hands out
     * every member's id, so no guessing was needed either.
     *
     * `allocations.ts` awards only to a member whose status is ATTESTED, so
     * flipping somebody back removed their claim on fertiliser and farm
     * inputs — and the audit entry named the leader as the person who did it,
     * because the token is all this endpoint has to go on.
     *
     * A leader who confirmed somebody in error goes through PSIRS, as a
     * referee withdrawing a response does. A recorded decision is not undone
     * through a public endpoint by whoever kept the message.
     */
    const rejected = await query<{ id: string }>(
      client,
      `UPDATE taxpayer_group_members
          SET status = 'REJECTED', attested_at = now(), attested_by_name = $3,
              rejection_reason = $4
        WHERE group_id = $1 AND id = ANY($2::uuid[])
          AND status = 'PENDING_ATTESTATION'
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

/**
 * Who recorded this group, or null if there is no such group.
 *
 * Used by the routes that act on a single group so an agent can be narrowed to
 * their own before anything is written, rather than after.
 */
export async function groupVisibility(
  db: Db,
  groupId: string,
  userId: string | null,
): Promise<'MISSING' | 'VISIBLE' | 'ANOTHER_AGENTS'> {
  const row = await queryOne<{ registered_by: string | null; by_an_agent: boolean }>(
    db,
    `SELECT g.registered_by,
            EXISTS (SELECT 1 FROM agents a WHERE a.user_id = g.registered_by) AS by_an_agent
       FROM taxpayer_groups g WHERE g.id = $1`,
    [groupId],
  );
  if (!row) return 'MISSING';
  if (!row.by_an_agent) return 'VISIBLE';
  return row.registered_by === userId ? 'VISIBLE' : 'ANOTHER_AGENTS';
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

/**
 * Who is in a group, and who is no longer.
 *
 * Departed members stay on the list rather than vanishing from it. A group
 * whose members silently disappear cannot be audited: an allocation awarded
 * last season to somebody who is not on today's list reads as an award to a
 * non-member, when in fact they were one at the time.
 */
export async function listMembers(db: Db, groupId: string) {
  return query(
    db,
    `SELECT m.id, m.status, m.member_reference, m.joined_on, m.attested_at,
            m.rejection_reason, m.left_at, m.left_reason,
            tp.id AS taxpayer_id, tp.tin,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', tp.first_name, tp.last_name)), ''),
                     tp.business_name) AS member_name
       FROM taxpayer_group_members m
       JOIN taxpayers tp ON tp.id = m.taxpayer_id
      WHERE m.group_id = $1
      ORDER BY CASE m.status
                 WHEN 'PENDING_ATTESTATION' THEN 0
                 WHEN 'ATTESTED' THEN 1
                 WHEN 'REJECTED' THEN 2
                 ELSE 3
               END,
               member_name`,
    [groupId],
  );
}

export async function listGroups(
  db: Db,
  options: {
    status?: string;
    lgaId?: string;
    sector?: string;
    limit?: number;
    /**
     * Narrow to what one field user may see.
     *
     * Set for a caller holding `group:read:own` rather than `group:read:all` —
     * an agent, who registers cooperatives in the field and has no business
     * reading the State's whole register of them.
     *
     * "Theirs" is not simply `registered_by = them`. An officer may record a
     * large cooperative centrally, from a ministry register, and hand it to an
     * agent to enrol the members — a handoff `group-device-binding.test.ts`
     * already documents, and which strict ownership breaks: the agent cannot
     * even see the group they were told to work.
     *
     * So the rule is: mine, or nobody's in particular. What an agent may not
     * see is *another agent's*, which is the disclosure that matters — every
     * row carries the group leader's name and phone number.
     */
    registeredBy?: string | null;
  } = {},
) {
  return query(
    db,
    `SELECT g.id, g.code, g.name, g.group_type, g.economic_sector, g.status, g.tax_role,
            l.name AS lga_name, g.leader_name, g.leader_phone,
            (SELECT count(*) FROM taxpayer_group_members m
              WHERE m.group_id = g.id AND m.status = 'ATTESTED') AS attested_members
       FROM taxpayer_groups g
       JOIN lgas l ON l.id = g.lga_id
      WHERE ($1::text IS NULL OR g.status = $1)
        AND ($2::uuid IS NULL OR g.lga_id = $2)
        AND ($3::text IS NULL OR g.economic_sector = $3)
        AND (
          $5::uuid IS NULL
          OR g.registered_by = $5
          OR NOT EXISTS (SELECT 1 FROM agents a WHERE a.user_id = g.registered_by)
        )
      ORDER BY g.created_at DESC
      LIMIT $4`,
    [
      options.status ?? null,
      options.lgaId ?? null,
      options.sector ?? null,
      options.limit ?? 100,
      options.registeredBy ?? null,
    ],
  );
}

/**
 * Record that a member has left the group (PRD §33).
 *
 * Membership decides who gets things. `allocations.ts` awards a subsidised
 * benefit only to a taxpayer whose membership is ATTESTED, and `incentives.ts`
 * gates a programme requiring group membership on the same status. Both were
 * right; what neither could survive was that membership never ended. A trader
 * who left the market association, a farmer who moved to another LGA, a member
 * expelled by the cooperative — all of them stayed ATTESTED for as long as the
 * row existed, and kept a claim on fertiliser meant for the people still in
 * the group. `LEFT` was in the constraint from the first migration and nothing
 * has ever written it.
 *
 * The row is updated, never deleted, and this matters more than it looks: the
 * person *was* a member when the allocations they already collected were
 * awarded, and an award whose justification has been deleted is an award that
 * looks fraudulent to the next auditor who reads it.
 *
 * An officer records this, not the group's leader. The attestation link is a
 * forwardable SMS — the same reasoning that keeps a leader from un-confirming
 * a member through it keeps them from removing one.
 */
export async function recordMemberDeparture(params: {
  groupId: string;
  membershipId: string;
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<{ memberName: string; groupName: string; from: string }> {
  return withTransaction(async (client) => {
    const member = await queryOne<{
      status: string;
      group_name: string;
      member_name: string;
    }>(
      client,
      `SELECT m.status, g.name AS group_name,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', tp.first_name, tp.last_name)), ''),
                       tp.business_name, 'This member') AS member_name
         FROM taxpayer_group_members m
         JOIN taxpayer_groups g ON g.id = m.group_id
         JOIN taxpayers tp ON tp.id = m.taxpayer_id
        WHERE m.id = $1 AND m.group_id = $2
        FOR UPDATE OF m`,
      [params.membershipId, params.groupId],
    );
    // Scoped to the group in the query rather than checked afterwards, so a
    // membership id belonging to another group reads as absent rather than as
    // a membership this officer may act on.
    if (!member) throw notFound('That membership');

    if (member.status === 'LEFT') {
      throw conflict(
        'MEMBER_ALREADY_LEFT',
        `${member.member_name} is already recorded as having left ${member.group_name}.`,
      );
    }

    /*
     * A rejected claim is not a departure. The leader answered that this
     * person was never a member of the group, and overwriting that with LEFT
     * would turn a denial into a membership that ended — which is the version
     * the person themselves would prefer, and is not what was attested.
     */
    if (member.status === 'REJECTED') {
      throw conflict(
        'MEMBERSHIP_REJECTED',
        `${member.group_name}'s leader did not confirm ${member.member_name} as a member, so ` +
          'there is no membership to end.',
      );
    }

    await client.query(
      `UPDATE taxpayer_group_members
          SET status = 'LEFT', left_at = now(), left_reason = $2,
              recorded_left_by = $3, updated_at = now()
        WHERE id = $1`,
      [params.membershipId, params.reason, params.actorId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'group.member_left',
      entityType: 'group_member',
      entityId: params.membershipId,
      oldValue: { status: member.status },
      newValue: { status: 'LEFT', reason: params.reason, groupId: params.groupId },
    });

    return {
      memberName: member.member_name,
      groupName: member.group_name,
      from: member.status,
    };
  });
}
