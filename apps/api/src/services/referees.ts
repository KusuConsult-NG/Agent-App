/**
 * Referee registration, invitation and clearance (Addendum §8-§13, §29, §30).
 *
 * A referee is an independent human check on an applicant. Three properties
 * follow from that and are enforced here:
 *   * the referee must be a different person from the applicant (§9);
 *   * they respond through a tokenised link and never need an account (§10);
 *   * a replaced referee is superseded, never overwritten (§29).
 *
 * Invitation tokens are stored only as hashes (§37): the plaintext exists once,
 * in the message sent to the referee.
 */

import type { PoolClient } from 'pg';
import type { RefereeCategory } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { generateToken, hashIdentityNumber, maskIdentityNumber, sha256 } from '../lib/crypto';
import { badRequest, conflict, notFound, AppError } from '../lib/errors';
import { nextRefereeCode } from '../lib/references';
import { config } from '../config';
import { refereeInvitationUrl } from '../lib/public-urls';
import { kycProvider } from '../integrations';
import { recordAudit } from './audit';
import { evaluateRefereeRisk } from './fraud';
import { queueNotification } from './notifications';

const INVITATION_TTL_DAYS = 14;

export interface RefereeInput {
  fullName: string;
  phone: string;
  email?: string;
  address?: string;
  occupation?: string;
  category: RefereeCategory;
  relationship: string;
}

export interface NominationResult {
  refereeId: string;
  referenceCode: string;
  /** Returned once so the API can deliver it; never stored in plaintext. */
  invitationToken: string;
  invitationUrl: string;
  expiresAt: Date;
}

export async function nominateReferee(params: {
  agentId: string;
  input: RefereeInput;
  actorId: string;
  replacesRefereeId?: string | null;
  ipAddress?: string | null;
}): Promise<NominationResult> {
  const { input } = params;

  return withTransaction(async (client) => {
    const applicant = await queryOne<{ phone: string; email: string | null; full_name: string }>(
      client,
      `SELECT u.phone, u.email, u.full_name FROM agents a JOIN users u ON u.id = a.user_id
        WHERE a.id = $1`,
      [params.agentId],
    );
    if (!applicant) throw notFound('That agent');

    // §9: "The system should not allow an agent to use themselves as their own
    // referee."
    if (
      input.phone === applicant.phone ||
      (input.email && applicant.email && input.email.toLowerCase() === applicant.email.toLowerCase())
    ) {
      throw badRequest(
        'You cannot nominate yourself as your own referee. The referee must be another person who ' +
          'knows you and can independently confirm your identity.',
        [{ field: 'phone', issue: 'Referee contact details match the applicant' }],
      );
    }

    const activeReferee = await queryOne<{ id: string; status: string }>(
      client,
      `SELECT id, status FROM referees
        WHERE agent_id = $1 AND status IN ('INVITED','ACCEPTED','SUBMITTED','UNDER_REVIEW','CLEARED')`,
      [params.agentId],
    );

    if (activeReferee && !params.replacesRefereeId) {
      throw conflict(
        'REFEREE_ALREADY_NOMINATED',
        activeReferee.status === 'CLEARED'
          ? 'A cleared referee is already on file for this application.'
          : 'A referee request is already outstanding. Wait for a response, or request a replacement.',
      );
    }

    if (params.replacesRefereeId) {
      const previous = await queryOne<{ id: string; status: string }>(
        client,
        'SELECT id, status FROM referees WHERE id = $1 AND agent_id = $2',
        [params.replacesRefereeId, params.agentId],
      );
      if (!previous) throw notFound('The referee being replaced');
      if (previous.status === 'CLEARED') {
        throw conflict(
          'REFEREE_ALREADY_CLEARED',
          'A cleared referee cannot be replaced.',
        );
      }
      // §29: the original record stays; it is marked REPLACED and linked.
      await client.query(`UPDATE referees SET status = 'REPLACED' WHERE id = $1`, [
        params.replacesRefereeId,
      ]);
    }

    const referenceCode = await nextRefereeCode(client);

    const referee = await queryOne<{ id: string }>(
      client,
      `INSERT INTO referees
         (agent_id, reference_code, full_name, phone, email, address, occupation,
          category, relationship, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'INVITED') RETURNING id`,
      [
        params.agentId,
        referenceCode,
        input.fullName,
        input.phone,
        input.email ?? null,
        input.address ?? null,
        input.occupation ?? null,
        input.category,
        input.relationship,
      ],
    );

    if (params.replacesRefereeId) {
      await client.query('UPDATE referees SET replaced_by_referee_id = $2 WHERE id = $1', [
        params.replacesRefereeId,
        referee!.id,
      ]);
    }

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);

    await client.query(
      `INSERT INTO referee_invitations
         (referee_id, invitation_token_hash, channel, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [referee!.id, sha256(token), input.email ? 'BOTH' : 'SMS', expiresAt],
    );

    await evaluateRefereeRisk(client, { refereeId: referee!.id });

    const invitationUrl = refereeInvitationUrl(token);

    await queueNotification(client, {
      event: 'REFEREE_INVITATION',
      recipientOverride: input.phone,
      variables: {
        name: input.fullName,
        applicant: applicant.full_name,
        reference: referenceCode,
        link: invitationUrl,
        expiry: expiresAt.toISOString().slice(0, 10),
      },
      entityType: 'referee',
      entityId: referee!.id,
    });

    await client.query(
      /*
       * A replacement is a different event from a first nomination. §29 keeps
       * the superseded referee rather than overwriting them, precisely so the
       * substitution is visible; journalling both as REFEREE_INVITED with only
       * the reason text to tell them apart threw that away, and an applicant
       * cycling through referees until one cleared looked like an applicant
       * who nominated once.
       */
      `INSERT INTO agent_clearance_events (agent_id, event_type, reason, actor_id, metadata)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        params.agentId,
        params.replacesRefereeId ? 'REFEREE_REPLACED' : 'REFEREE_INVITED',
        params.replacesRefereeId ? 'Replacement referee nominated' : 'Referee nominated',
        params.actorId,
        JSON.stringify({
          referenceCode,
          category: input.category,
          replaces: params.replacesRefereeId ?? null,
        }),
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: 'agent',
      action: 'referee.nominated',
      entityType: 'referee',
      entityId: referee!.id,
      newValue: {
        referenceCode,
        category: input.category,
        relationship: input.relationship,
        replaces: params.replacesRefereeId ?? null,
      },
      ipAddress: params.ipAddress ?? null,
    });

    return {
      refereeId: referee!.id,
      referenceCode,
      invitationToken: token,
      invitationUrl,
      expiresAt,
    };
  });
}

export interface RefereeInvitationView {
  refereeId: string;
  referenceCode: string;
  refereeName: string;
  applicantName: string;
  applicantLga: string | null;
  relationship: string;
  category: string;
  status: string;
  expiresAt: Date;
}

/**
 * Resolve an invitation token to the request the referee should see (§11).
 *
 * Only the minimum needed to make an informed decision is exposed: the
 * applicant's name and area, not their identity documents or bank details.
 */
export async function openInvitation(db: Db, token: string): Promise<RefereeInvitationView> {
  const invitation = await queryOne<{
    id: string;
    referee_id: string;
    expires_at: Date;
    status: string;
    referee_name: string;
    reference_code: string;
    relationship: string;
    category: string;
    referee_status: string;
    applicant_name: string;
    applicant_lga: string | null;
  }>(
    db,
    `SELECT i.id, i.referee_id, i.expires_at, i.status,
            r.full_name AS referee_name, r.reference_code, r.relationship, r.category,
            r.status AS referee_status,
            u.full_name AS applicant_name, l.name AS applicant_lga
       FROM referee_invitations i
       JOIN referees r ON r.id = i.referee_id
       JOIN agents a ON a.id = r.agent_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN lgas l ON l.id = a.lga_id
      WHERE i.invitation_token_hash = $1`,
    [sha256(token)],
  );

  if (!invitation) {
    throw new AppError({
      statusCode: 404,
      code: 'INVITATION_NOT_FOUND',
      message: 'This verification link is not valid. Ask the applicant to send a new request.',
    });
  }

  if (invitation.expires_at.getTime() < Date.now()) {
    await query(
      db,
      `UPDATE referee_invitations SET status = 'EXPIRED' WHERE id = $1 AND status <> 'RESPONDED'`,
      [invitation.id],
    );
    await query(db, `UPDATE referees SET status = 'EXPIRED' WHERE id = $1 AND status = 'INVITED'`, [
      invitation.referee_id,
    ]);
    throw new AppError({
      statusCode: 410,
      code: 'INVITATION_EXPIRED',
      message:
        'This verification request has expired. Ask the applicant to send you a new request.',
    });
  }

  if (invitation.status === 'RESPONDED') {
    throw conflict(
      'INVITATION_ALREADY_USED',
      'You have already responded to this verification request. Thank you.',
    );
  }

  await query(
    db,
    `UPDATE referee_invitations
        SET status = 'OPENED', opened_at = COALESCE(opened_at, now())
      WHERE id = $1 AND status = 'SENT'`,
    [invitation.id],
  );
  await query(db, `UPDATE referees SET status = 'ACCEPTED' WHERE id = $1 AND status = 'INVITED'`, [
    invitation.referee_id,
  ]);

  return {
    refereeId: invitation.referee_id,
    referenceCode: invitation.reference_code,
    refereeName: invitation.referee_name,
    applicantName: invitation.applicant_name,
    applicantLga: invitation.applicant_lga,
    relationship: invitation.relationship,
    category: invitation.category,
    status: invitation.referee_status,
    expiresAt: invitation.expires_at,
  };
}

export interface RefereeResponseInput {
  confirmsKnowsApplicant: boolean;
  confirmsInformationAccurate: boolean;
  willingToActAsReferee: boolean;
  understandsConsequences: boolean;
  identityType?: string;
  identityNumber?: string;
  occupation?: string;
  address?: string;
  comments?: string;
}

/**
 * Submit a referee response (§11, §12).
 *
 * All four declarations must be affirmative: a referee who will not confirm
 * they know the applicant has not vouched for anyone. The referee then goes
 * through their own KYC, at the level government has configured.
 */
/**
 * Reject a token that has already been used or has run out.
 *
 * Both halves of a referee's answer — confirming and declining — are
 * unauthenticated and addressed only by a token that lives in an SMS or an
 * email for as long as the referee keeps the message. Only one of them
 * checked. Declining wrote REJECTED over whatever the invitation had already
 * said, including a confirmation an officer had since reviewed and cleared,
 * which let a forwarded link pull a working agent's clearance back down.
 *
 * Shared so the two answers cannot drift apart again.
 */
function assertInvitationOpen(invitation: { status: string; expires_at: Date }): void {
  if (invitation.status === 'RESPONDED') {
    throw conflict('INVITATION_ALREADY_USED', 'You have already responded to this request.');
  }
  if (invitation.expires_at.getTime() < Date.now()) {
    throw new AppError({
      statusCode: 410,
      code: 'INVITATION_EXPIRED',
      message: 'This verification request has expired.',
    });
  }
}

/**
 * Check a referee's identity, outside any transaction.
 *
 * Resolves the referee from the invitation token with a plain read, because
 * the provider needs a name and a phone number and nothing else. The caller's
 * transaction re-reads the invitation under a lock and decides what to do; a
 * token that resolves to nothing here simply means no check was run, and the
 * response lands as UNDER_REVIEW exactly as an unreachable provider would.
 */
async function verifyRefereeIdentity(
  token: string,
  identityType: string,
  identityNumber: string,
) {
  const referee = await queryOne<{ referee_name: string; referee_phone: string }>(
    pool,
    `SELECT r.full_name AS referee_name, r.phone AS referee_phone
       FROM referee_invitations i JOIN referees r ON r.id = i.referee_id
      WHERE i.invitation_token_hash = $1`,
    [sha256(token)],
  );
  if (!referee) return null;

  const nameParts = referee.referee_name.trim().split(/\s+/);
  return kycProvider.verify({
    identityType,
    identityNumber,
    firstName: nameParts[0] ?? referee.referee_name,
    lastName: nameParts[nameParts.length - 1] ?? referee.referee_name,
    phone: referee.referee_phone,
  });
}

export async function submitRefereeResponse(params: {
  token: string;
  input: RefereeResponseInput;
  ipAddress?: string | null;
}): Promise<{ status: string; message: string }> {
  const { input } = params;

  if (
    !input.confirmsKnowsApplicant ||
    !input.confirmsInformationAccurate ||
    !input.willingToActAsReferee ||
    !input.understandsConsequences
  ) {
    throw badRequest(
      'All four declarations must be confirmed before your response can be accepted. ' +
        'If you cannot confirm them, decline the request instead.',
    );
  }

  /*
   * Ask the identity provider before the transaction opens.
   *
   * The call used to sit between marking the invitation spent and recording
   * what the provider said, so a referee filling in a form held a pooled
   * connection and a lock on their invitation row for as long as the provider
   * took to answer.
   *
   * It needs only the referee's name and phone, which the token already
   * identifies, so it is resolved here against a read that takes no lock. The
   * transaction below still selects `FOR UPDATE` and re-checks everything —
   * this read decides nothing. Its one cost is a wasted provider call when an
   * invitation turns out to be spent or expired in between, which is rare and
   * harmless; the alternative was holding the row while a third party thought
   * about it.
   */
  const identity =
    input.identityNumber && input.identityType
      ? await verifyRefereeIdentity(params.token, input.identityType!, input.identityNumber!)
      : null;

  return withTransaction(async (client) => {
    const invitation = await queryOne<{
      id: string;
      referee_id: string;
      expires_at: Date;
      status: string;
      agent_id: string;
      referee_name: string;
      referee_phone: string;
    }>(
      client,
      `SELECT i.id, i.referee_id, i.expires_at, i.status, r.agent_id,
              r.full_name AS referee_name, r.phone AS referee_phone
         FROM referee_invitations i JOIN referees r ON r.id = i.referee_id
        WHERE i.invitation_token_hash = $1
        FOR UPDATE OF i`,
      [sha256(params.token)],
    );

    if (!invitation) throw notFound('That verification request');
    assertInvitationOpen(invitation);

    await client.query(
      `UPDATE referees
          SET status = 'SUBMITTED', responded_at = now(), consent_given = true,
              declaration_accepted = true,
              occupation = COALESCE($2, occupation), address = COALESCE($3, address)
        WHERE id = $1`,
      [invitation.referee_id, input.occupation ?? null, input.address ?? null],
    );

    await client.query(
      `UPDATE referee_invitations SET status = 'RESPONDED', responded_at = now() WHERE id = $1`,
      [invitation.id],
    );

    let verificationStatus: 'CLEARED' | 'FAILED' | 'UNDER_REVIEW' = 'UNDER_REVIEW';
    let failureReason: string | null = null;
    let reference: string | null = null;

    // The same condition as before; `identity` simply carries the answer the
    // provider already gave, outside the transaction.
    if (identity && input.identityNumber && input.identityType) {
      const result = identity;

      // An UNAVAILABLE provider goes to UNDER_REVIEW, not FAILED. Unlike an
      // agent's own KYC, this is not rolled back: the referee has filled the
      // form and their invitation is now spent, so throwing would lose a
      // response they cannot easily give again. A government officer clears it
      // instead, and the reason below tells them the check never actually ran —
      // so it reads nothing like a referee whose identity did not match.
      switch (result.status) {
        case 'CLEARED':
          verificationStatus = 'CLEARED';
          break;
        case 'FAILED':
          verificationStatus = 'FAILED';
          break;
        default:
          verificationStatus = 'UNDER_REVIEW';
      }

      failureReason =
        result.status === 'UNAVAILABLE'
          ? `Identity check could not be carried out: ${result.failureReason ?? 'the verification service could not be reached'}. Manual verification required.`
          : (result.failureReason ?? null);
      reference = result.reference || null;

      await client.query(
        `INSERT INTO referee_kyc
           (referee_id, identity_type, identity_number_hash, identity_number_masked,
            verification_provider, verification_reference, phone_verified,
            verification_status, verified_at, failure_reason)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9)`,
        [
          invitation.referee_id,
          input.identityType,
          hashIdentityNumber(input.identityNumber),
          maskIdentityNumber(input.identityNumber),
          // Only name a provider that actually answered; an outage attributes
          // nothing to anyone.
          result.status === 'UNAVAILABLE' ? null : result.provider,
          reference,
          verificationStatus,
          verificationStatus === 'CLEARED' ? new Date() : null,
          failureReason,
        ],
      );
    } else {
      // Phone-only verification: the response stands but a government officer
      // must clear it (§12 — the level is configurable by policy).
      await client.query(
        `INSERT INTO referee_kyc (referee_id, phone_verified, verification_status)
         VALUES ($1, true, 'UNDER_REVIEW')`,
        [invitation.referee_id],
      );
    }

    let refereeStatus =
      verificationStatus === 'CLEARED'
        ? 'CLEARED'
        : verificationStatus === 'FAILED'
          ? 'FAILED'
          : 'UNDER_REVIEW';

    /*
     * A flag an officer has upheld holds the response back from clearing on
     * its own.
     *
     * The referee's identity matching is not an answer to the pattern the flag
     * is about, and this is the path that would otherwise walk round the check
     * on the officer's decision entirely: a confirmed flag, and then a
     * matching NIN clears the referee that afternoon with nobody deciding
     * anything. So it lands with the officers instead, carrying the reason,
     * and the referee is neither cleared nor accused.
     */
    if (refereeStatus === 'CLEARED') {
      const upheld = await upheldRiskFlag(client, invitation.referee_id);
      if (upheld) {
        refereeStatus = 'UNDER_REVIEW';
        failureReason =
          `Identity confirmed, but a risk flag against this referee has been upheld ` +
          `(${ruleInWords(upheld)}). A government officer must decide.`;
      }
    }

    await client.query(
      `UPDATE referees
          SET status = $2,
              cleared_at = CASE WHEN $2 = 'CLEARED' THEN now() ELSE cleared_at END,
              rejection_reason = $3
        WHERE id = $1`,
      [invitation.referee_id, refereeStatus, failureReason],
    );

    await evaluateRefereeRisk(client, { refereeId: invitation.referee_id });
    await syncAgentRefereeStatus(client, invitation.agent_id);

    await client.query(
      `INSERT INTO agent_clearance_events (agent_id, event_type, reason, metadata)
       VALUES ($1,$2,$3,$4)`,
      [
        invitation.agent_id,
        refereeStatus === 'CLEARED' ? 'REFEREE_CLEARED' : refereeStatus === 'FAILED' ? 'REFEREE_FAILED' : 'REFEREE_INVITED',
        failureReason,
        JSON.stringify({ refereeId: invitation.referee_id, verificationReference: reference }),
      ],
    );

    await recordAudit(client, {
      actorId: null,
      actorRole: 'referee',
      action: 'referee.responded',
      entityType: 'referee',
      entityId: invitation.referee_id,
      newValue: { status: refereeStatus, verificationReference: reference },
      ipAddress: params.ipAddress ?? null,
    });

    return {
      status: refereeStatus,
      message:
        refereeStatus === 'CLEARED'
          ? 'Thank you. Your verification has been completed and recorded.'
          : refereeStatus === 'FAILED'
            ? 'Your identity could not be verified. PSIRS may contact you for more information.'
            : 'Thank you. Your response has been recorded and is now being reviewed by PSIRS.',
    };
  });
}

/** Decline a referee request (§13 REJECTED, §29 replacement path). */
export async function declineInvitation(params: {
  token: string;
  reason?: string;
}): Promise<{ message: string }> {
  return withTransaction(async (client) => {
    const invitation = await queryOne<{
      id: string;
      referee_id: string;
      agent_id: string;
      status: string;
      expires_at: Date;
    }>(
      client,
      `SELECT i.id, i.referee_id, r.agent_id, i.status, i.expires_at
         FROM referee_invitations i
         JOIN referees r ON r.id = i.referee_id
        WHERE i.invitation_token_hash = $1
        FOR UPDATE OF i`,
      [sha256(params.token)],
    );
    if (!invitation) throw notFound('That verification request');
    assertInvitationOpen(invitation);

    await client.query(
      `UPDATE referees SET status = 'REJECTED', responded_at = now(), rejected_at = now(),
              rejection_reason = $2 WHERE id = $1`,
      [invitation.referee_id, params.reason ?? 'Referee declined the request'],
    );
    await client.query(
      `UPDATE referee_invitations SET status = 'RESPONDED', responded_at = now() WHERE id = $1`,
      [invitation.id],
    );

    await syncAgentRefereeStatus(client, invitation.agent_id);

    await recordAudit(client, {
      actorId: null,
      actorRole: 'referee',
      action: 'referee.declined',
      entityType: 'referee',
      entityId: invitation.referee_id,
      reason: params.reason ?? null,
    });

    return {
      message:
        'Your decision has been recorded. The applicant will be told they need a different referee.',
    };
  });
}

/**
 * The rule of an upheld flag against this referee, if there is one.
 *
 * Both places a referee can become CLEARED consult it, and they have to: a
 * check that lived only on the officer's decision would be walked round by the
 * ordinary path, where a matching identity number clears the referee by
 * itself. An identity that matches is not an answer to "four of the six people
 * he vouched for have never met him".
 */
async function upheldRiskFlag(client: PoolClient, refereeId: string): Promise<string | null> {
  const flag = await queryOne<{ rule: string }>(
    client,
    `SELECT rule FROM referee_risk_flags
      WHERE referee_id = $1 AND status = 'CONFIRMED' LIMIT 1`,
    [refereeId],
  );
  return flag?.rule ?? null;
}

/** The rule name as it reads in a sentence to an officer or a referee. */
const ruleInWords = (rule: string) => rule.replace(/_/g, ' ').toLowerCase();

/**
 * An officer's triage of a referee risk flag (Addendum §30, §46).
 *
 * The flags were raised and nothing could ever move them. Every one of the
 * four rules writes OPEN, the referee dashboard lists OPEN and UNDER_REVIEW,
 * and there was no path to any other status — so the queue only ever grew,
 * which is how a queue stops being read. An officer who looked into a pattern
 * and found it innocent had no way to say so, and the flag they had cleared
 * sat above the next one for ever.
 *
 * CONFIRMED is not merely a note. A referee with an upheld flag against them
 * cannot be cleared until the flag is dealt with — see `reviewReferee` — so
 * upholding one is a decision with a consequence rather than a tidy-up.
 */
export async function reviewRefereeRiskFlag(params: {
  flagId: string;
  decision: 'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED';
  note: string;
  actorId: string;
  actorRole: string;
}): Promise<{ refereeId: string; refereeStatus: string }> {
  return withTransaction(async (client) => {
    const flag = await queryOne<{ id: string; status: string; referee_id: string }>(
      client,
      'SELECT id, status, referee_id FROM referee_risk_flags WHERE id = $1 FOR UPDATE',
      [params.flagId],
    );
    if (!flag) throw notFound('That referee risk flag');

    await client.query(
      `UPDATE referee_risk_flags
          SET status = $2, resolution_note = $3, reviewed_by = $4, reviewed_at = now()
        WHERE id = $1`,
      [params.flagId, params.decision, params.note, params.actorId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'referee.risk_flag_reviewed',
      entityType: 'referee_risk_flag',
      entityId: params.flagId,
      oldValue: { status: flag.status },
      newValue: { status: params.decision },
      reason: params.note,
    });

    const referee = await queryOne<{ status: string }>(
      client,
      'SELECT status FROM referees WHERE id = $1',
      [flag.referee_id],
    );

    return { refereeId: flag.referee_id, refereeStatus: referee?.status ?? 'UNKNOWN' };
  });
}

/** Officer decision on a referee under review (§13, §15). */
export async function reviewReferee(params: {
  refereeId: string;
  decision: 'CLEAR' | 'REJECT';
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  if (!params.reason?.trim()) {
    throw badRequest('A reason is required for every referee decision.');
  }

  await withTransaction(async (client) => {
    const referee = await queryOne<{ id: string; agent_id: string; status: string }>(
      client,
      'SELECT id, agent_id, status FROM referees WHERE id = $1',
      [params.refereeId],
    );
    if (!referee) throw notFound('That referee');

    /*
     * An upheld risk flag has to be dealt with before the referee it is about
     * can be cleared.
     *
     * Otherwise confirming a flag is a note in a file: one officer upholds
     * "this person has vouched for nine applicants" and another clears the
     * referee that afternoon without ever seeing it. Dismissing the flag is
     * still open — that is the officer saying, on the record and with a
     * reason, that the pattern does not disqualify this referee — and only
     * then does the clearance go through.
     */
    if (params.decision === 'CLEAR') {
      const upheld = await upheldRiskFlag(client, params.refereeId);
      if (upheld) {
        throw conflict(
          'REFEREE_RISK_FLAG_UPHELD',
          `A risk flag against this referee has been upheld (${ruleInWords(upheld)}), ` +
            'so they cannot be cleared while it stands.',
          'Dismiss the flag with your findings if it does not disqualify them, then clear the referee.',
        );
      }
    }

    await client.query(
      `UPDATE referees
          SET status = $2,
              cleared_at = CASE WHEN $2 = 'CLEARED' THEN now() ELSE cleared_at END,
              rejected_at = CASE WHEN $2 = 'REJECTED' THEN now() ELSE rejected_at END,
              rejection_reason = $3, reviewed_by = $4
        WHERE id = $1`,
      [
        params.refereeId,
        params.decision === 'CLEAR' ? 'CLEARED' : 'REJECTED',
        params.reason,
        params.actorId,
      ],
    );

    await client.query(
      `UPDATE referee_kyc SET verification_status = $2, verified_at = now(), reviewed_by = $3
        WHERE referee_id = $1`,
      [params.refereeId, params.decision === 'CLEAR' ? 'CLEARED' : 'FAILED', params.actorId],
    );

    await syncAgentRefereeStatus(client, referee.agent_id);

    await client.query(
      `INSERT INTO agent_clearance_events (agent_id, event_type, reason, actor_id, metadata)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        referee.agent_id,
        params.decision === 'CLEAR' ? 'REFEREE_CLEARED' : 'REFEREE_FAILED',
        params.reason,
        params.actorId,
        JSON.stringify({ refereeId: params.refereeId }),
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: `referee.${params.decision.toLowerCase()}`,
      entityType: 'referee',
      entityId: params.refereeId,
      oldValue: { status: referee.status },
      newValue: { status: params.decision === 'CLEAR' ? 'CLEARED' : 'REJECTED' },
      reason: params.reason,
    });
  });
}

/**
 * Recompute an agent's referee roll-up from its referee records.
 *
 * Kept in one function so the derived status can never disagree with the
 * underlying referees, whichever path changed them.
 */
export async function syncAgentRefereeStatus(client: PoolClient, agentId: string): Promise<void> {
  const summary = await queryOne<{ cleared: string; outstanding: string; total: string }>(
    client,
    `SELECT
       count(*) FILTER (WHERE status = 'CLEARED')::text AS cleared,
       count(*) FILTER (WHERE status IN ('INVITED','ACCEPTED','SUBMITTED','UNDER_REVIEW'))::text AS outstanding,
       count(*) FILTER (WHERE status <> 'REPLACED')::text AS total
     FROM referees WHERE agent_id = $1`,
    [agentId],
  );

  const cleared = Number.parseInt(summary?.cleared ?? '0', 10) > 0;
  const outstanding = Number.parseInt(summary?.outstanding ?? '0', 10) > 0;
  const total = Number.parseInt(summary?.total ?? '0', 10);

  const status = cleared ? 'CLEARED' : outstanding || total === 0 ? 'PENDING' : 'FAILED';

  await client.query('UPDATE agents SET referee_status = $2 WHERE id = $1', [agentId, status]);

  await client.query(
    `INSERT INTO agent_clearance (agent_id, referee_cleared)
     VALUES ($1, $2)
     ON CONFLICT (agent_id) DO UPDATE SET
       referee_cleared = EXCLUDED.referee_cleared,
       clearance_status = CASE
         WHEN agent_clearance.clearance_status IN ('APPROVED','REJECTED')
           THEN agent_clearance.clearance_status
         WHEN agent_clearance.kyc_cleared AND EXCLUDED.referee_cleared THEN 'READY_FOR_REVIEW'
         ELSE 'PENDING' END`,
    [agentId, cleared],
  );

  await client.query(
    `UPDATE agents a SET clearance_status = c.clearance_status
       FROM agent_clearance c WHERE c.agent_id = a.id AND a.id = $1`,
    [agentId],
  );
}

/** Government referee dashboard (Addendum §46). */
export async function refereeDashboard(db: Db) {
  const [counts, suspicious, multiAgent] = await Promise.all([
    queryOne(
      db,
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE status IN ('INVITED','ACCEPTED','SUBMITTED','UNDER_REVIEW'))::text AS pending,
         count(*) FILTER (WHERE status = 'CLEARED')::text AS cleared,
         count(*) FILTER (WHERE status IN ('FAILED','REJECTED'))::text AS failed,
         count(*) FILTER (WHERE status = 'EXPIRED')::text AS expired,
         count(*) FILTER (WHERE status = 'REPLACED')::text AS replaced
       FROM referees`,
    ),
    query(
      db,
      `SELECT f.id, f.rule, f.severity, f.detail, f.created_at,
              r.full_name, r.reference_code, r.status
         FROM referee_risk_flags f JOIN referees r ON r.id = f.referee_id
        WHERE f.status IN ('OPEN','UNDER_REVIEW')
        ORDER BY f.created_at DESC LIMIT 50`,
    ),
    query(
      db,
      `SELECT phone, min(full_name) AS full_name, count(DISTINCT agent_id)::text AS agent_count
         FROM referees WHERE status <> 'REPLACED'
        GROUP BY phone HAVING count(DISTINCT agent_id) > 1
        ORDER BY count(DISTINCT agent_id) DESC LIMIT 50`,
    ),
  ]);

  return { counts, suspiciousReferees: suspicious, refereesSupportingMultipleAgents: multiAgent };
}
