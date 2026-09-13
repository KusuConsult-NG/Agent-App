/**
 * Support tickets (PRD §77, §78).
 *
 * The tables and three endpoints existed; nothing could reach them. No screen
 * in the agent app or the portal mentioned a ticket, so the only way to raise
 * one was to hand-write an HTTP request, and `ticket_messages` — the table
 * that makes a ticket a conversation rather than a status field — had never
 * been read or written by any code.
 *
 * That gap matters most for the people with the least recourse. An agent
 * standing in a market whose payment has not confirmed has no supervisor to
 * walk to; a taxpayer who believes they were overcharged is reported by the
 * agent who took the money. PRD §78 lists AGENT_MISCONDUCT and
 * UNAUTHORISED_CHARGE as categories, which only means something if there is a
 * channel that carries them.
 *
 * Two rules shape the code below:
 *
 *   * A raiser sees their own ticket and nothing else. Support staff see
 *     every ticket. That is `support:read:own` against `support:read:all`,
 *     and it is enforced on the row rather than by hiding a button.
 *
 *   * An internal note is never shown to the raiser. Staff need somewhere to
 *     write "this agent has three similar complaints" without publishing it
 *     to the agent, and a note that leaks is worse than one that was never
 *     written, so `internal` is filtered in the query, not in the client.
 */

import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { nextTicketNumber } from '../lib/references';
import { recordAudit } from './audit';
import { queueNotification } from './notifications';
import { log } from '../lib/logger';

export type TicketStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export const TICKET_CATEGORIES = [
  'PAYMENT_ISSUE',
  'TIN_ISSUE',
  'VEHICLE_ISSUE',
  'RECEIPT_ISSUE',
  'TECHNICAL_ISSUE',
  'TAXPAYER_COMPLAINT',
  'INCORRECT_ASSESSMENT',
  'AGENT_MISCONDUCT',
  'UNAUTHORISED_CHARGE',
] as const;

/** Who is asking, and what they are allowed to see. */
export interface Viewer {
  userId: string;
  role: string;
  permissions: readonly string[];
}

const canSeeEverything = (viewer: Viewer) => viewer.permissions.includes('support:read:all');
const canManage = (viewer: Viewer) => viewer.permissions.includes('support:manage');

export interface RaiseTicketInput {
  category: (typeof TICKET_CATEGORIES)[number];
  subject: string;
  description: string;
  transactionReference?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

/**
 * Was this person part of that transaction?
 *
 * The agent who took it, the taxpayer it was for, or a member of support staff
 * — who may legitimately file on someone's behalf, and can already read every
 * transaction anyway, so nothing is disclosed to them that was not already.
 */
async function raiserIsPartyTo(
  client: PoolClient,
  transaction: { agent_id: string | null; taxpayer_id: string },
  viewer: Viewer,
): Promise<boolean> {
  if (canSeeEverything(viewer)) return true;

  const match = await queryOne<{ ok: boolean }>(
    client,
    `SELECT EXISTS (
       SELECT 1 FROM agents a WHERE a.id = $1 AND a.user_id = $3
       UNION ALL
       SELECT 1 FROM taxpayers t WHERE t.id = $2 AND t.user_id = $3
     ) AS ok`,
    [transaction.agent_id, transaction.taxpayer_id, viewer.userId],
  );
  return match?.ok === true;
}

export async function raiseTicket(params: {
  input: RaiseTicketInput;
  viewer: Viewer;
}): Promise<{ id: string; ticketNumber: string }> {
  const { input, viewer } = params;

  return withTransaction(async (client) => {
    let transactionId: string | null = null;
    let agentId: string | null = null;
    let taxpayerId: string | null = null;

    if (input.transactionReference) {
      const transaction = await queryOne<{ id: string; agent_id: string | null; taxpayer_id: string }>(
        client,
        'SELECT id, agent_id, taxpayer_id FROM transactions WHERE transaction_reference = $1',
        [input.transactionReference],
      );

      /*
       * Citing a transaction has to mean the raiser was part of it.
       *
       * The lookup refused a reference that does not exist and then attached
       * whichever one did, without asking whose it was. Transaction references
       * run in sequence — TXN-2026-000123 — so that was two things at once.
       * `ticketDetail` hands the cited transaction's reference and total amount
       * back to the raiser, which made any signed-in person able to read the
       * amount of any collection in the state, one ticket at a time. And the
       * ticket is stamped with that transaction's agent, so a complaint filed
       * under AGENT_MISCONDUCT landed against an agent who had never met the
       * complainant, in the record staff read when judging whether an agent has
       * a pattern.
       *
       * The refusal is worded identically to a reference that does not exist,
       * for the reason `ticketDetail` answers 404 rather than 403: telling
       * someone their guess was a real reference is most of what they wanted.
       */
      const connected =
        transaction !== null && (await raiserIsPartyTo(client, transaction, viewer));

      if (!transaction || !connected) {
        throw badRequest(`No transaction found with reference ${input.transactionReference}.`);
      }
      transactionId = transaction.id;
      agentId = transaction.agent_id;
      taxpayerId = transaction.taxpayer_id;
    }

    const ticketNumber = await nextTicketNumber(client);
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO support_tickets
         (ticket_number, raised_by, raiser_role, category, subject, description,
          transaction_id, agent_id, taxpayer_id, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        ticketNumber,
        viewer.userId,
        viewer.role,
        input.category,
        input.subject,
        input.description,
        transactionId,
        agentId,
        taxpayerId,
        input.priority ?? 'NORMAL',
      ],
    );

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'support.ticket_raised',
      entityType: 'support_ticket',
      entityId: row!.id,
      newValue: { ticketNumber, category: input.category, priority: input.priority ?? 'NORMAL' },
    });

    return { id: row!.id, ticketNumber };
  });
}

export async function listTickets(
  db: Db,
  params: { viewer: Viewer; status?: string; category?: string; assignedToMe?: boolean; limit?: number },
) {
  const scopeToSelf = canSeeEverything(params.viewer) ? null : params.viewer.userId;

  return query(
    db,
    `SELECT t.id, t.ticket_number, t.category, t.subject, t.status, t.priority,
            t.created_at, t.updated_at, t.resolved_at,
            u.full_name AS raised_by_name, t.raiser_role,
            assignee.full_name AS assigned_to_name,
            tr.transaction_reference,
            (SELECT count(*) FROM ticket_messages m
              WHERE m.ticket_id = t.id AND ($1::uuid IS NULL OR m.internal = false))::int
              AS message_count,
            (SELECT max(m.created_at) FROM ticket_messages m
              WHERE m.ticket_id = t.id AND ($1::uuid IS NULL OR m.internal = false))
              AS last_message_at
       FROM support_tickets t
       JOIN users u ON u.id = t.raised_by
       LEFT JOIN users assignee ON assignee.id = t.assigned_to
       LEFT JOIN transactions tr ON tr.id = t.transaction_id
      WHERE ($1::uuid IS NULL OR t.raised_by = $1)
        AND ($2::text IS NULL OR t.status = $2)
        AND ($3::text IS NULL OR t.category = $3)
        AND ($4::boolean IS FALSE OR t.assigned_to = $5)
      ORDER BY
        CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
        t.created_at DESC
      LIMIT $6`,
    [
      scopeToSelf,
      params.status ?? null,
      params.category ?? null,
      params.assignedToMe ?? false,
      params.viewer.userId,
      params.limit ?? 50,
    ],
  );
}

/**
 * One ticket and its conversation.
 *
 * Returns null rather than an empty ticket when the viewer may not see it, so
 * the route answers 404 and a ticket's existence is not disclosed by the
 * difference between "forbidden" and "not found".
 */
export async function ticketDetail(db: Db, params: { ticketId: string; viewer: Viewer }) {
  const ticket = await queryOne<{
    id: string;
    ticket_number: string;
    raised_by: string;
    status: string;
  } & Record<string, unknown>>(
    db,
    `SELECT t.id, t.ticket_number, t.category, t.subject, t.description, t.status,
            t.priority, t.resolution, t.resolved_at, t.created_at, t.updated_at,
            t.raised_by, t.raiser_role,
            u.full_name AS raised_by_name, u.phone AS raised_by_phone,
            assignee.full_name AS assigned_to_name,
            tr.transaction_reference, tr.total_amount_kobo
       FROM support_tickets t
       JOIN users u ON u.id = t.raised_by
       LEFT JOIN users assignee ON assignee.id = t.assigned_to
       LEFT JOIN transactions tr ON tr.id = t.transaction_id
      WHERE t.id = $1`,
    [params.ticketId],
  );

  if (!ticket) return null;
  if (!canSeeEverything(params.viewer) && ticket.raised_by !== params.viewer.userId) return null;

  const includeInternal = canSeeEverything(params.viewer);
  const messages = await query(
    db,
    `SELECT m.id, m.body, m.internal, m.created_at,
            u.full_name AS author_name, u.role AS author_role,
            (m.author_id = $2) AS mine
       FROM ticket_messages m
       JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = $1 AND ($3::boolean OR m.internal = false)
      ORDER BY m.created_at`,
    [params.ticketId, params.viewer.userId, includeInternal],
  );

  return { ...ticket, messages };
}

/**
 * Add a message to a ticket.
 *
 * A raiser replying to a ticket that was marked RESOLVED reopens it. Closing a
 * complaint the complainant disagrees with, and leaving them no way to say so
 * except raising a second ticket, is how a queue stays tidy at the expense of
 * the person who needed it.
 */
export async function addMessage(params: {
  ticketId: string;
  viewer: Viewer;
  body: string;
  internal?: boolean;
}): Promise<{ messageId: string; reopened: boolean }> {
  const { viewer } = params;
  const internal = params.internal === true;

  if (internal && !canManage(viewer)) {
    throw forbidden('Only support staff can add an internal note.');
  }

  return withTransaction(async (client) => {
    const ticket = await queryOne<{ id: string; raised_by: string; status: string; ticket_number: string }>(
      client,
      'SELECT id, raised_by, status, ticket_number FROM support_tickets WHERE id = $1 FOR UPDATE',
      [params.ticketId],
    );
    if (!ticket) throw notFound('That ticket');

    const isRaiser = ticket.raised_by === viewer.userId;
    if (!isRaiser && !canSeeEverything(viewer)) throw notFound('That ticket');

    // Reading every ticket and answering one are different jobs. An auditor
    // holds support:read:all and no support:manage, and is read-only
    // everywhere else in the platform; the support desk is not the one place
    // they get to speak to an agent under investigation.
    if (!isRaiser && !canManage(viewer)) {
      throw forbidden('You can read this ticket but not reply to it.');
    }

    if (ticket.status === 'CLOSED') {
      throw badRequest(
        'This ticket is closed. Raise a new one if the problem has come back, so it keeps its own history.',
      );
    }

    const message = await queryOne<{ id: string }>(
      client,
      `INSERT INTO ticket_messages (ticket_id, author_id, body, internal)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [params.ticketId, viewer.userId, params.body, internal],
    );

    // A reply from the person who raised it puts a resolved ticket back in the
    // queue; a reply from staff moves an untouched one into progress.
    let reopened = false;
    if (isRaiser && ticket.status === 'RESOLVED') {
      await client.query(
        `UPDATE support_tickets SET status = 'OPEN', resolved_at = NULL WHERE id = $1`,
        [params.ticketId],
      );
      reopened = true;
    } else if (!isRaiser && !internal && ticket.status === 'OPEN') {
      await client.query(`UPDATE support_tickets SET status = 'IN_PROGRESS' WHERE id = $1`, [
        params.ticketId,
      ]);
    }

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: internal ? 'support.internal_note_added' : 'support.message_added',
      entityType: 'support_ticket',
      entityId: params.ticketId,
      newValue: { reopened },
    });

    // The raiser is told when staff answer. An answer nobody knows about is
    // the same as no answer, and an agent in the field is not watching a queue.
    if (!isRaiser && !internal) {
      await notifyRaiser(client, {
        userId: ticket.raised_by,
        ticketNumber: ticket.ticket_number,
        ticketId: params.ticketId,
      });
    }

    return { messageId: message!.id, reopened };
  });
}

export async function updateTicket(params: {
  ticketId: string;
  viewer: Viewer;
  status: TicketStatus;
  resolution?: string;
  assignedTo?: string;
}): Promise<void> {
  if (params.status === 'RESOLVED' && !params.resolution) {
    throw badRequest('Record how the issue was resolved before marking the ticket resolved.');
  }

  await withTransaction(async (client) => {
    const ticket = await queryOne<{
      id: string;
      status: string;
      raised_by: string;
      ticket_number: string;
      resolution: string | null;
    }>(
      client,
      `SELECT id, status, raised_by, ticket_number, resolution
         FROM support_tickets WHERE id = $1 FOR UPDATE`,
      [params.ticketId],
    );
    if (!ticket) throw notFound('That ticket');

    /*
     * CLOSED is further along the same path as RESOLVED, and had no such check.
     *
     * So the requirement to record how an issue was resolved was avoidable by
     * skipping the step it guarded: OPEN straight to CLOSED, with nothing
     * written down. And because `addMessage` refuses to add to a closed ticket,
     * the person who raised it could not ask why — they were told to raise a
     * new one. For a channel that carries AGENT_MISCONDUCT and
     * UNAUTHORISED_CHARGE, a complaint that can be shut in silence is the
     * failure mode that matters.
     *
     * A resolution already on the record satisfies this: the ordinary path is
     * RESOLVED with a reason, then CLOSED once the raiser has had their chance
     * to disagree.
     */
    if (params.status === 'CLOSED' && !params.resolution && !ticket.resolution) {
      throw badRequest(
        'Record what was done about this ticket before closing it. ' +
          'A complaint closed with nothing written down leaves the person who raised it no answer.',
      );
    }

    await client.query(
      `UPDATE support_tickets
          SET status = $2, resolution = COALESCE($3, resolution),
              assigned_to = COALESCE($4, assigned_to),
              resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE resolved_at END
        WHERE id = $1`,
      [params.ticketId, params.status, params.resolution ?? null, params.assignedTo ?? null],
    );

    // The status change joins the conversation. A thread that shows only what
    // people typed, with the ticket silently changing state around it, reads
    // as though nothing happened between the question and the closure.
    if (ticket.status !== params.status) {
      await client.query(
        `INSERT INTO ticket_messages (ticket_id, author_id, body, internal)
         VALUES ($1,$2,$3,false)`,
        [
          params.ticketId,
          params.viewer.userId,
          params.status === 'RESOLVED'
            ? `Marked resolved. ${params.resolution}`
            : `Status changed to ${params.status.replace(/_/g, ' ').toLowerCase()}.`,
        ],
      );
    }

    await recordAudit(client, {
      actorId: params.viewer.userId,
      actorRole: params.viewer.role,
      action: 'support.ticket_updated',
      entityType: 'support_ticket',
      entityId: params.ticketId,
      oldValue: { status: ticket.status },
      newValue: { status: params.status },
    });

    if (params.status === 'RESOLVED' && ticket.status !== 'RESOLVED') {
      await notifyRaiser(client, {
        userId: ticket.raised_by,
        ticketNumber: ticket.ticket_number,
        ticketId: params.ticketId,
      });
    }
  });
}

/**
 * Tell the person who raised the ticket that there is something to read.
 *
 * Best-effort: a notification that cannot be queued must not roll back the
 * reply it was announcing. The message is already in the thread either way.
 */
async function notifyRaiser(
  client: PoolClient,
  params: { userId: string; ticketNumber: string; ticketId: string },
): Promise<void> {
  try {
    await queueNotification(client, {
      event: 'SUPPORT_TICKET_UPDATED',
      userId: params.userId,
      entityType: 'support_ticket',
      entityId: params.ticketId,
      variables: { ticketNumber: params.ticketNumber },
    });
  } catch (error) {
    log.error('could not queue a reply notification', { component: 'support', error });
  }
}
