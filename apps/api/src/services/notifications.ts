/**
 * Notifications (PRD §44, §79).
 *
 * Messages are rendered from government-managed templates rather than string
 * literals scattered through the code, so PSIRS can change wording — and the
 * approved phrasing of a payment confirmation in particular — without a code
 * release.
 *
 * Delivery is queued inside the caller's transaction: a notification is never
 * sent for a payment that then rolls back.
 */

import type { PoolClient } from 'pg';
import { formatNaira } from '@psirs/shared';
import type { Db } from '../db/pool';
import { query, queryOne } from '../db/pool';
import { providerFor, type DeliveryResult } from './messaging';

export type NotificationEvent =
  | 'TIN_CREATED'
  | 'ASSESSMENT_GENERATED'
  | 'INVOICE_GENERATED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_SUCCESSFUL'
  | 'PAYMENT_FAILED'
  | 'RECEIPT_GENERATED'
  | 'VEHICLE_RENEWAL_COMPLETED'
  | 'DOCUMENT_READY'
  | 'COMMISSION_EARNED'
  | 'COMMISSION_PAID'
  /*
   * The two ways an agent's payout does not arrive.
   *
   * `COMMISSION_PAID` was seeded and never queued; these two did not exist at
   * all. There was no event for a transfer the bank bounced or a payout an
   * officer declined, so the agent's own money could stop moving and the only
   * record was an audit entry they cannot read. A bounced transfer is usually
   * wrong account details — a thing only the agent can fix, and only if
   * somebody tells them there is something to fix.
   */
  | 'COMMISSION_PAYOUT_FAILED'
  | 'COMMISSION_PAYOUT_REFUSED'
  | 'SECURITY_ALERT'
  | 'AGENT_APPROVED'
  | 'AGENT_REJECTED'
  | 'AGENT_SUSPENDED'
  | 'REFEREE_INVITATION'
  | 'REFEREE_CLEARED'
  | 'KYC_ACTION_REQUIRED'
  | 'DEVICE_REGISTERED'
  | 'AGENT_BANK_CHANGE_REQUESTED'
  | 'AGENT_BANK_CHANGE_APPLIED'
  | 'AGENT_BANK_CHANGE_REFUSED'
  /*
   * The two nobody was ever sent.
   *
   * There is an event for a payment that succeeded, one for a payment that
   * failed, and three for an agent whose bank account somebody asked to
   * change — and there was none for the money the State took, reversed, and
   * either did or did not give back. A citizen's receipt was voided and their
   * transaction marked reversed with nothing sent to them at all; they found
   * out when a verification told them their receipt was no good.
   */
  | 'PAYMENT_REVERSED'
  | 'REFUND_COMPLETED'
  | 'TAXPAYER_RECORD_CORRECTED'
  | 'USER_ROLE_CHANGED'
  | 'SUPPORT_TICKET_UPDATED'
  | 'TAX_REMINDER_6W'
  | 'TAX_REMINDER_4W'
  | 'TAX_REMINDER_2W'
  | 'TAX_OBLIGATION_ASSIGNED';

/**
 * Render `{{placeholders}}` from a template.
 * Money placeholders are formatted as naira for display; the underlying value
 * is still kobo everywhere it matters.
 */
function render(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined) return '';
    if (key === 'amount' && /^\d+$/.test(value)) return formatNaira(BigInt(value));
    return value;
  });
}

export interface QueueNotificationParams {
  event: NotificationEvent;
  userId?: string | null;
  taxpayerId?: string | null;
  agentId?: string | null;
  recipientOverride?: string | null;
  channels?: ('SMS' | 'EMAIL' | 'PUSH')[];
  variables?: Record<string, string>;
  entityType?: string;
  entityId?: string;
}

export async function queueNotification(
  client: PoolClient,
  params: QueueNotificationParams,
): Promise<number> {
  let recipientPhone = params.recipientOverride ?? null;
  let recipientEmail: string | null = null;
  let userId = params.userId ?? null;
  const variables: Record<string, string> = { ...(params.variables ?? {}) };

  if (params.taxpayerId) {
    const taxpayer = await queryOne<{
      phone: string;
      email: string | null;
      first_name: string | null;
      business_name: string | null;
      user_id: string | null;
    }>(
      client,
      'SELECT phone, email, first_name, business_name, user_id FROM taxpayers WHERE id = $1',
      [params.taxpayerId],
    );
    if (taxpayer) {
      recipientPhone ??= taxpayer.phone;
      recipientEmail = taxpayer.email;
      userId ??= taxpayer.user_id;
      variables.name ??= taxpayer.business_name ?? taxpayer.first_name ?? 'Taxpayer';
    }
  }

  if (params.agentId) {
    const agent = await queryOne<{ phone: string; email: string | null; full_name: string; user_id: string }>(
      client,
      `SELECT u.phone, u.email, u.full_name, u.id AS user_id
         FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
      [params.agentId],
    );
    if (agent) {
      recipientPhone ??= agent.phone;
      recipientEmail = agent.email;
      userId ??= agent.user_id;
      variables.name ??= agent.full_name;
    }
  }

  /*
   * A plain user — an officer or an agent addressed as themselves rather than
   * through their agent record. Without this, passing only `userId` resolved
   * no recipient and the loop below queued nothing at all: the call returned
   * 0 and said nothing, so the caller believed someone had been told. Every
   * other branch here resolves a phone, and this one was simply missing.
   */
  if (!recipientPhone && !recipientEmail && userId) {
    const user = await queryOne<{ phone: string; email: string | null; full_name: string }>(
      client,
      'SELECT phone, email, full_name FROM users WHERE id = $1',
      [userId],
    );
    if (user) {
      recipientPhone = user.phone;
      recipientEmail = user.email;
      variables.name ??= user.full_name;
    }
  }

  /*
   * The language this person reads.
   *
   * Resolved from the recipient rather than passed in: a caller queueing a
   * receipt knows the transaction, not what the taxpayer speaks, and making it
   * an argument would mean every one of the eighteen call sites getting it
   * right. Defaults to English, which is also what an unrecorded preference
   * means.
   */
  const language =
    (
      await queryOne<{ preferred_language: string }>(
        client,
        `SELECT COALESCE(
                  (SELECT preferred_language FROM taxpayers WHERE id = $1),
                  (SELECT preferred_language FROM users WHERE id = $2),
                  'en') AS preferred_language`,
        [params.taxpayerId ?? null, userId],
      )
    )?.preferred_language ?? 'en';

  /*
   * One row per channel, in the recipient's language where there is one.
   *
   * DISTINCT ON with the language ordered first picks the translation when it
   * exists and the English when it does not — so a channel is never sent twice,
   * once per language, and an English-only template still reaches somebody who
   * reads Hausa. Silence would be the worse failure: a receipt in the wrong
   * language can still be checked, and a receipt that never arrives cannot.
   */
  const templates = await query<{
    channel: 'SMS' | 'EMAIL' | 'PUSH';
    subject: string | null;
    body: string;
    language: string;
  }>(
    client,
    `SELECT DISTINCT ON (channel) channel, subject, body, language
       FROM notification_templates
      WHERE event = $1 AND status = 'ACTIVE'
        AND ($2::text[] IS NULL OR channel = ANY($2))
        AND language IN ($3, 'en')
      ORDER BY channel, (language = $3) DESC`,
    [params.event, params.channels ?? null, language],
  );

  let queued = 0;

  for (const template of templates) {
    /*
     * A push is delivered to a person's devices, so its recipient is a user id.
     *
     * This read "EMAIL ? email : phone", which addressed a PUSH row to a
     * telephone number. The adapter looks subscriptions up by user id and
     * refuses anything else, so every push would have been permanently
     * rejected — with a message blaming whoever wrote the template. Nobody had
     * noticed because no PUSH template was seeded, which is its own problem
     * and not a defence.
     *
     * `userId` is null for a taxpayer, who holds no account here. Then there is
     * nothing to push to and the row is skipped, which is the right answer:
     * their receipt goes by SMS, and that is the copy that matters.
     */
    const recipient =
      template.channel === 'PUSH'
        ? userId
        : template.channel === 'EMAIL'
          ? recipientEmail
          : recipientPhone ?? recipientEmail; // SMS and WHATSAPP both use phone number
    if (!recipient) continue;

    await client.query(
      `INSERT INTO notifications
         (user_id, recipient, event, channel, subject, message, entity_type, entity_id, language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        userId,
        recipient,
        params.event,
        template.channel,
        template.subject ? render(template.subject, variables) : null,
        render(template.body, variables),
        params.entityType ?? null,
        params.entityId ?? null,
        // The language it was actually rendered in, not the one asked for:
        // the fallback means those differ, and a support officer reading the
        // queue has to see which one the citizen received.
        template.language,
      ],
    );
    queued += 1;
  }

  return queued;
}

/**
 * Deliver queued notifications (PRD §44, §66, §79).
 *
 * This is the last step between a confirmed government payment and the citizen
 * knowing about it. They hold no account here, so the SMS carrying their
 * receipt number and verification code is the only copy they get.
 *
 * What this function used to do is worth stating, because it is the reason it
 * now looks the way it does: it logged the message when the provider was
 * `mock`, and then marked every notification SENT with `provider_reference =
 * mock-<id>` regardless of which provider was configured. Nothing was ever
 * delivered, and the `notifications` table said otherwise. That is the same
 * failure this platform exists to prevent — a record claiming something
 * happened that did not — applied to the one artefact a citizen actually
 * receives.
 *
 * So a notification is only SENT when a provider accepted it, and the three
 * outcomes are kept apart:
 *
 *   SENT         the provider took it; its reference is recorded as given
 *   REJECTED     the provider refused it. FAILED immediately — retrying a
 *                malformed number four more times only delays telling someone
 *   UNAVAILABLE  the provider could not be reached. Stays QUEUED, and does NOT
 *                consume an attempt, because the citizen is still owed this
 *                message and an outage is not their fault
 */
export async function dispatchQueued(db: Db, options: { limit?: number } = {}): Promise<number> {
  const pending = await query<{
    id: string;
    channel: 'SMS' | 'EMAIL' | 'PUSH';
    recipient: string;
    subject: string | null;
    message: string;
    attempts: number;
  }>(
    db,
    `SELECT id, channel, recipient, subject, message, attempts
       FROM notifications
      WHERE status = 'QUEUED' AND attempts < 5
      ORDER BY created_at LIMIT $1`,
    [options.limit ?? 100],
  );

  let sent = 0;

  for (const notification of pending) {
    let result: DeliveryResult;
    try {
      result = await providerFor(notification.channel).send({
        channel: notification.channel,
        recipient: notification.recipient,
        subject: notification.subject,
        message: notification.message,
      });
    } catch (error) {
      // No provider owns this channel, or one threw despite the contract. Fail
      // this row and keep going: one unroutable message must never stall the
      // queue that carries every other citizen's receipt.
      await query(
        db,
        `UPDATE notifications
            SET status = 'FAILED', attempts = attempts + 1, failure_reason = $2
          WHERE id = $1`,
        [notification.id, error instanceof Error ? error.message : 'Unknown delivery error'],
      );
      continue;
    }

    if (result.outcome === 'SENT') {
      await query(
        db,
        `UPDATE notifications
            SET status = 'SENT', sent_at = now(), attempts = attempts + 1,
                provider = $3, provider_reference = $2, failure_reason = NULL
          WHERE id = $1`,
        [notification.id, result.reference || null, result.provider],
      );
      sent += 1;
      continue;
    }

    if (result.outcome === 'REJECTED') {
      await query(
        db,
        `UPDATE notifications
            SET status = 'FAILED', attempts = attempts + 1,
                provider = $3, failure_reason = $2
          WHERE id = $1`,
        [notification.id, result.reason ?? 'The provider refused the message', result.provider],
      );
      continue;
    }

    // UNAVAILABLE. The attempt counter is deliberately not incremented: an
    // outage would otherwise exhaust the budget in five sweeps and permanently
    // fail a message the provider never even saw.
    await query(
      db,
      `UPDATE notifications
          SET failure_reason = $2, provider = $3
        WHERE id = $1`,
      [notification.id, result.reason ?? 'The provider could not be reached', result.provider],
    );
  }

  return sent;
}

/**
 * Notifications that were never delivered (PRD §66).
 *
 * A citizen who did not get their receipt has no other way to learn their
 * verification code, so this is a queue somebody has to work — not a metric.
 */
export async function undeliveredNotifications(db: Db, limit = 100) {
  return query(
    db,
    `SELECT id, event, channel, recipient, status, attempts, failure_reason,
            provider, created_at
       FROM notifications
      WHERE status = 'FAILED'
         OR (status = 'QUEUED' AND created_at < now() - INTERVAL '1 hour')
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );
}
