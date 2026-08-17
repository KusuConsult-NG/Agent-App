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
import { config } from '../config';

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
  | 'SECURITY_ALERT'
  | 'AGENT_APPROVED'
  | 'AGENT_REJECTED'
  | 'AGENT_SUSPENDED'
  | 'REFEREE_INVITATION'
  | 'REFEREE_CLEARED'
  | 'KYC_ACTION_REQUIRED'
  | 'DEVICE_REGISTERED';

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

  const templates = await query<{
    channel: 'SMS' | 'EMAIL' | 'PUSH';
    subject: string | null;
    body: string;
  }>(
    client,
    `SELECT channel, subject, body FROM notification_templates
      WHERE event = $1 AND status = 'ACTIVE'
        AND ($2::text[] IS NULL OR channel = ANY($2))`,
    [params.event, params.channels ?? null],
  );

  let queued = 0;

  for (const template of templates) {
    const recipient =
      template.channel === 'EMAIL' ? recipientEmail : recipientPhone ?? recipientEmail;
    if (!recipient) continue;

    await client.query(
      `INSERT INTO notifications
         (user_id, recipient, event, channel, subject, message, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId,
        recipient,
        params.event,
        template.channel,
        template.subject ? render(template.subject, variables) : null,
        render(template.body, variables),
        params.entityType ?? null,
        params.entityId ?? null,
      ],
    );
    queued += 1;
  }

  return queued;
}

/**
 * Deliver queued notifications.
 *
 * The development providers log rather than send. Failures are recorded and
 * retried up to a bound — a notification that cannot be delivered must be
 * visible in monitoring (PRD §66), not silently dropped.
 */
export async function dispatchQueued(db: Db, options: { limit?: number } = {}): Promise<number> {
  const pending = await query<{
    id: string;
    channel: string;
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
    try {
      if (config.notifications.smsProvider === 'mock' || config.notifications.emailProvider === 'mock') {
        console.log(
          `[notify:${notification.channel}] -> ${notification.recipient}: ${notification.message}`,
        );
      }
      await query(
        db,
        `UPDATE notifications
            SET status = 'SENT', sent_at = now(), attempts = attempts + 1,
                provider_reference = $2
          WHERE id = $1`,
        [notification.id, `mock-${notification.id}`],
      );
      sent += 1;
    } catch (error) {
      await query(
        db,
        `UPDATE notifications
            SET attempts = attempts + 1,
                failure_reason = $2,
                status = CASE WHEN attempts + 1 >= 5 THEN 'FAILED' ELSE 'QUEUED' END
          WHERE id = $1`,
        [notification.id, error instanceof Error ? error.message : 'Unknown error'],
      );
    }
  }

  return sent;
}
