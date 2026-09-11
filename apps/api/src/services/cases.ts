/**
 * Cases: the work that crosses a department.
 *
 * A revenue officer who notices an agent's collections behaving strangely has,
 * today, two things they can do with that observation. If it matches a rule the
 * fraud sweep already knows, a flag exists. If it does not — and the
 * observations worth having usually do not — there is nowhere to put it. They
 * cannot hand it to an auditor, the auditor cannot hand the settlement question
 * to finance, finance cannot hand the conclusion back, and afterwards the
 * platform holds no record that any of it happened. The work moves on WhatsApp
 * and the evidence moves with it.
 *
 * A case is the object that work travels on:
 *
 *     Revenue flags → Auditor investigates → Finance reconciles
 *       → Admin reviews → resolution recorded
 *
 * with every step on the same row, in order, attributed, and unerasable.
 *
 * THREE RULES
 *
 * 1. The history is append-only, and the database enforces it (migration 055).
 *    Nothing here issues an UPDATE against `case_events`, and nothing ever
 *    should: a comment that can be rewritten is not evidence of anything except
 *    who edited it last.
 *
 * 2. The columns on `cases` are a cache. Status, assignee, priority and due
 *    date are all derivable by replaying the events; they live on the row
 *    because a queue has to be filterable without replaying anything. Every
 *    write below updates the row *and* appends the event, in one transaction,
 *    so the cache can never claim something the history does not.
 *
 * 3. "Mine" is a fact about the row, not about the role. An officer who opened
 *    a case, or has one assigned to them, can work it without holding
 *    `case:manage` — otherwise a finance officer could raise a settlement
 *    discrepancy and then be unable to resolve it, which is not a queue, it is
 *    a suggestion box. `case:manage` is authority over *other people's* cases.
 *
 * WHAT A CASE IS NOT
 *
 * It is not an approval: an approval is one decision by one person against a
 * fixed request, and it closes. It is not a support ticket: a ticket belongs to
 * the agent or citizen who raised it and is answered outward. It is not a fraud
 * flag: a flag is raised by a rule and carries no assignment, no discussion and
 * no due date. A case can be opened *from* any of the three, and `source_type`
 * says which, so the thing that started it stays reachable.
 */

import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nextCaseNumber } from '../lib/references';
import { recordAudit } from './audit';
import * as inbox from './officer-inbox';
import { ACCEPTED as ACCEPTED_FILES } from './kyc-documents';
import { storage, storageKey } from './storage';

export const CASE_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'AWAITING_INFORMATION',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_CATEGORIES = [
  'GENERAL',
  'REVENUE_ANOMALY',
  'RECONCILIATION_EXCEPTION',
  'FRAUD_INVESTIGATION',
  'AGENT_CONDUCT',
  'TAXPAYER_DISPUTE',
  'COMMISSION_QUERY',
  'DATA_CORRECTION',
  'SYSTEM_ISSUE',
] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const CASE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const CASE_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/**
 * The departments a case can be addressed to.
 *
 * Role names, because the platform has no departments — see migration 055's
 * header. When departments arrive, this is the list that becomes a table.
 */
export const CASE_DEPARTMENTS = [
  'supervisor',
  'revenue_officer',
  'finance_officer',
  'auditor',
  'admin',
] as const;

/**
 * The two states that mean the case is off the queue.
 *
 * RESOLVED is a finding; CLOSED is a case finished with, including one that
 * turned out to be nothing. Everything that counts open work counts neither.
 */
const TERMINAL: readonly string[] = ['RESOLVED', 'CLOSED'];

export interface Viewer {
  userId: string;
  role: string;
  permissions: readonly string[];
}

const holds = (viewer: Viewer, permission: string) => viewer.permissions.includes(permission);

interface CaseRow {
  id: string;
  case_number: string;
  status: string;
  assignee_id: string | null;
  opened_by: string;
  department: string | null;
  department_id: string | null;
  subject: string;
  priority: string;
  due_at: Date | null;
}

/**
 * May this officer change this case?
 *
 * Three ways in, and the last two are why this is a function rather than a
 * `requirePermission` on the route: the row decides, not the role.
 */
function mayWork(viewer: Viewer, row: CaseRow): boolean {
  return (
    holds(viewer, 'case:manage') ||
    row.opened_by === viewer.userId ||
    row.assignee_id === viewer.userId
  );
}

function assertMayWork(viewer: Viewer, row: CaseRow): void {
  if (mayWork(viewer, row)) return;
  throw forbidden(
    `Case ${row.case_number} is not assigned to you and you did not open it.`,
    'Ask the assignee to act, or ask an administrator or auditor to reassign it.',
  );
}

/**
 * A case that has been resolved or closed is finished.
 *
 * Reopening is deliberately not offered. A conclusion that can be reopened and
 * re-concluded is a conclusion with no date on it; the way to revisit a closed
 * finding is a new case that links to it, which leaves both records standing.
 */
function assertOpen(row: CaseRow): void {
  if (!TERMINAL.includes(row.status)) return;
  throw conflict(
    'CASE_CLOSED',
    `Case ${row.case_number} is ${row.status.toLowerCase()} and cannot be changed.`,
    'Open a new case that links to this one.',
  );
}

async function load(db: Db, id: string): Promise<CaseRow> {
  const row = await queryOne<CaseRow>(
    db,
    `SELECT id, case_number, status, assignee_id, opened_by, department, department_id,
            subject, priority, due_at
       FROM cases WHERE id = $1`,
    [id],
  );
  if (!row) throw notFound('That case');
  return row;
}

/**
 * How large a piece of evidence may be.
 *
 * Larger than the identity-document cap, because that one is sized for a phone
 * photograph of an ID and this is sized for a scanned bank statement -- a
 * multi-page PDF an officer cannot control the size of, and one they must not
 * be told to crop.
 */
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

/** The file types a case will keep, named so the body parser can refuse the rest. */
export const EVIDENCE_CONTENT_TYPES = ACCEPTED_FILES.map((entry) => entry.contentType);

interface EventInput {
  kind: string;
  body?: string;
  mentions?: readonly string[];
  oldValue?: unknown;
  newValue?: unknown;
  documentId?: string | null;
  evidenceFileId?: string | null;
}

async function append(
  client: PoolClient,
  caseId: string,
  viewer: Viewer,
  event: EventInput,
): Promise<void> {
  await client.query(
    `INSERT INTO case_events (
       case_id, kind, body, mentions, old_value, new_value, document_id, evidence_file_id,
       actor_id, actor_role
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      caseId,
      event.kind,
      event.body ?? '',
      event.mentions ?? [],
      event.oldValue === undefined ? null : JSON.stringify(event.oldValue),
      event.newValue === undefined ? null : JSON.stringify(event.newValue),
      event.documentId ?? null,
      event.evidenceFileId ?? null,
      viewer.userId,
      viewer.role,
    ],
  );
}

/**
 * Officers named in a comment.
 *
 * Resolved against `users` rather than trusted from the client, so a mention
 * cannot name somebody who does not exist, and cannot be used to discover
 * whether an identifier belongs to a real officer: an unknown id is dropped
 * silently rather than reported.
 *
 * Only portal roles can be mentioned. Mentioning a field agent on an internal
 * case would put their name in a queue they cannot open.
 */
async function resolveMentions(
  db: Db,
  ids: readonly string[] | undefined,
): Promise<string[]> {
  if (!ids?.length) return [];
  const rows = await query<{ id: string }>(
    db,
    `SELECT id FROM users
      WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'
        AND role IN ('supervisor','revenue_officer','finance_officer','auditor','admin')`,
    [[...new Set(ids)]],
  );
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export interface OpenCaseInput {
  subject: string;
  description?: string;
  category?: CaseCategory;
  riskLevel?: string;
  priority?: string;
  department?: string | null;
  /**
   * The department this case is addressed to, now that departments exist.
   *
   * Preferred over `department` where both are given. The role-name column
   * stays because cases already in flight are addressed to one, and dropping
   * it would strand them in a queue nobody opens.
   */
  departmentId?: string | null;
  assigneeId?: string | null;
  transactionId?: string | null;
  agentId?: string | null;
  taxpayerId?: string | null;
  subjectUserId?: string | null;
  lgaId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  dueAt?: Date | null;
}

export async function openCase(
  db: Db,
  viewer: Viewer,
  input: OpenCaseInput,
): Promise<{ id: string; caseNumber: string }> {
  if (input.assigneeId) await assertAssignable(db, input.assigneeId);

  return withTransaction(async (client) => {
    const caseNumber = await nextCaseNumber(client);
    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO cases (
         case_number, subject, description, category, risk_level, priority,
         department, department_id, assignee_id, transaction_id, agent_id, taxpayer_id,
         subject_user_id, lga_id, source_type, source_id, due_at, opened_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        caseNumber,
        input.subject.trim(),
        input.description?.trim() ?? '',
        input.category ?? 'GENERAL',
        input.riskLevel ?? 'MEDIUM',
        input.priority ?? 'NORMAL',
        input.department ?? null,
        input.departmentId ?? null,
        input.assigneeId ?? null,
        input.transactionId ?? null,
        input.agentId ?? null,
        input.taxpayerId ?? null,
        input.subjectUserId ?? null,
        input.lgaId ?? null,
        input.sourceType ?? 'MANUAL',
        input.sourceId ?? null,
        input.dueAt ?? null,
        viewer.userId,
      ],
    );
    const id = row!.id;

    await append(client, id, viewer, {
      kind: 'OPENED',
      body: input.description?.trim() ?? '',
      newValue: {
        subject: input.subject.trim(),
        category: input.category ?? 'GENERAL',
        department: input.department ?? null,
        departmentId: input.departmentId ?? null,
        assigneeId: input.assigneeId ?? null,
      },
    });

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'case.open',
      entityType: 'case',
      entityId: id,
      newValue: { caseNumber, subject: input.subject.trim(), category: input.category ?? 'GENERAL' },
      reason: input.description?.trim() || null,
    });

    return { id, caseNumber };
  });
}

/**
 * A case can only be assigned to an officer who could open it.
 *
 * Assigning to a field agent, or to a closed account, produces a case sitting
 * in a queue nobody reads — which looks exactly like a case being worked.
 */
async function assertAssignable(db: Db, userId: string): Promise<void> {
  const row = await queryOne<{ role: string; status: string; full_name: string }>(
    db,
    'SELECT role, status, full_name FROM users WHERE id = $1',
    [userId],
  );
  if (!row) throw notFound('That officer');
  if (row.status !== 'ACTIVE') {
    throw badRequest(`${row.full_name}'s account is ${row.status.toLowerCase()}.`);
  }
  if (!(CASE_DEPARTMENTS as readonly string[]).includes(row.role)) {
    throw badRequest(
      `${row.full_name} is a ${row.role.replace(/_/g, ' ')} and does not work cases.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Working it
// ---------------------------------------------------------------------------

export async function comment(
  db: Db,
  viewer: Viewer,
  caseId: string,
  input: { body: string; internal?: boolean; mentions?: readonly string[] },
): Promise<void> {
  const row = await load(db, caseId);
  assertOpen(row);
  const mentions = await resolveMentions(db, input.mentions);

  await withTransaction(async (client) => {
    await append(client, caseId, viewer, {
      kind: input.internal ? 'NOTE' : 'COMMENT',
      body: input.body.trim(),
      mentions,
    });
    await client.query('UPDATE cases SET updated_at = now() WHERE id = $1', [caseId]);

    /*
     * Writing somebody's name is asking them something.
     *
     * `/my-work` already surfaces the most recent mention per case, which
     * answers "what is waiting for me". This is the other half: a record that
     * they were asked, which they can mark read once they have answered --
     * otherwise the item sits in the work queue until the case moves, and an
     * officer who has already replied is told about it every morning.
     *
     * The officer writing the comment is skipped: naming yourself in your own
     * note is a way of tagging it, not a way of asking a question.
     */
    for (const mentioned of mentions) {
      if (mentioned === viewer.userId) continue;
      await inbox.raise(client, {
        userId: mentioned,
        kind: 'CASE_MENTION',
        subject: `${row.case_number}: you were named in a ${input.internal ? 'note' : 'comment'}`,
        body: input.body.trim().slice(0, 500),
        entityType: 'case',
        entityId: caseId,
        // Per comment, not per case: two different questions are two items.
        dedupeKey: `case-mention:${caseId}:${mentioned}:${Date.now()}`,
      });
    }
  });
}

export async function attachEvidence(
  db: Db,
  viewer: Viewer,
  caseId: string,
  input: { documentId: string; body?: string },
): Promise<void> {
  const row = await load(db, caseId);
  assertOpen(row);

  const document = await queryOne<{ id: string }>(
    db,
    'SELECT id FROM documents WHERE id = $1',
    [input.documentId],
  );
  if (!document) throw notFound('That document');

  await withTransaction(async (client) => {
    await append(client, caseId, viewer, {
      kind: 'EVIDENCE',
      body: input.body?.trim() ?? '',
      documentId: input.documentId,
    });
    await client.query('UPDATE cases SET updated_at = now() WHERE id = $1', [caseId]);
    /*
     * Evidence gets its own audit entry, separate from the case event.
     *
     * The case event is the investigator's record; the audit entry is the
     * platform's. An auditor asking "what did this officer attach to which
     * case, and when" should not have to be able to read the case to find out.
     */
    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'case.evidence.attach',
      entityType: 'case',
      entityId: caseId,
      newValue: { documentId: input.documentId },
      reason: input.body?.trim() || null,
    });
  });
}

/**
 * A file that did not come from this platform, put on the case.
 *
 * Most of what an investigation collects is not a document PSIRS issued: a
 * bank advice a taxpayer hands over, a letter, a photograph of a stall. None
 * of it could go on a case, so it went into somebody's email instead -- which
 * is to say it left the audit trail at exactly the point an investigation
 * needs one.
 *
 * WHY IT IS NOT A `documents` ROW
 *
 * Every row in that table is something the State issued, carrying a
 * verification code a citizen can check against the register. A scan of a
 * third party's letter is not, and filing it there would make the public
 * verification endpoint able to affirm a document PSIRS never wrote.
 *
 * WHAT THE OFFICER HAS TO SAY
 *
 * A description and a provenance, both required by the table rather than by
 * this function. An unlabelled scan on a case file is something the next
 * reader has to open to find out about; a file with no statement of where it
 * came from is the question an auditor asks first about any document the
 * platform did not issue, and answering it a year later from memory is not an
 * answer.
 *
 * The bytes are stored before the row exists, and the row records the checksum
 * the storage driver reported for what it actually wrote -- not one computed
 * here over bytes that may never have landed.
 */
export async function uploadEvidence(
  db: Db,
  viewer: Viewer,
  caseId: string,
  input: {
    bytes: Buffer;
    declaredContentType: string;
    filename: string;
    description: string;
    provenance: string;
  },
): Promise<{ evidenceFileId: string; checksum: string; byteSize: number }> {
  const row = await load(db, caseId);
  assertOpen(row);
  assertMayWork(viewer, row);

  /*
   * The declared type is checked before the size, because an unsupported type
   * never reaches the body parser and the bytes arrive empty -- reporting that
   * as "the file is empty" sends an officer back to rescan a document that was
   * never the problem.
   */
  const declared = ACCEPTED_FILES.find((entry) => entry.contentType === input.declaredContentType);
  if (!declared) {
    throw badRequest(
      `${input.declaredContentType || 'That file type'} is not a file type PSIRS keeps. ` +
        `Send one of: ${ACCEPTED_FILES.map((entry) => entry.contentType).join(', ')}.`,
      [{ field: 'Content-Type', issue: 'Unsupported file type' }],
    );
  }
  if (input.bytes.length === 0) throw badRequest('That file is empty.');
  if (input.bytes.length > MAX_EVIDENCE_BYTES) {
    throw badRequest(
      `That file is ${(input.bytes.length / 1024 / 1024).toFixed(1)} MB and the largest ` +
        `accepted is ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`,
    );
  }
  /*
   * The header is the uploader's claim about the file; the bytes are the fact.
   * A mismatch is either a broken client or a payload parked behind an image
   * viewer, and neither is something to keep on a case file.
   */
  if (!declared.matches(input.bytes)) {
    throw badRequest(
      `This file is not a ${input.declaredContentType}.`,
      [{ field: 'body', issue: 'Content does not match the declared type' }],
    );
  }

  const stored = await storage.put(
    storageKey('evidence', 'cases', caseId, `${Date.now()}.${declared.extension}`),
    input.bytes,
    declared.contentType,
  );

  return withTransaction(async (client) => {
    const file = await queryOne<{ id: string }>(
      client,
      `INSERT INTO case_evidence_files (
         case_id, original_filename, content_type, byte_size, storage_reference,
         checksum, description, provenance, uploaded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        caseId,
        input.filename.trim().slice(0, 200) || `evidence.${declared.extension}`,
        declared.contentType,
        stored.byteSize,
        stored.storageReference,
        stored.checksum,
        input.description.trim(),
        input.provenance.trim(),
        viewer.userId,
      ],
    );

    await append(client, caseId, viewer, {
      kind: 'EVIDENCE',
      body: input.description.trim(),
      evidenceFileId: file!.id,
    });
    await client.query('UPDATE cases SET updated_at = now() WHERE id = $1', [caseId]);

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'case.evidence.upload',
      entityType: 'case',
      entityId: caseId,
      newValue: {
        evidenceFileId: file!.id,
        filename: input.filename,
        checksum: stored.checksum,
        byteSize: stored.byteSize,
        provenance: input.provenance.trim(),
      },
      reason: input.description.trim(),
    });

    return { evidenceFileId: file!.id, checksum: stored.checksum, byteSize: stored.byteSize };
  });
}

/**
 * Read one back, and record that it was read.
 *
 * Evidence is read by whoever may work the case, which is the same test that
 * governs writing to it: an investigation nobody but its opener can read is
 * not a shared record. The read is audited because who looked at a piece of
 * evidence, and when, is itself part of the file.
 */
export async function readEvidence(
  db: Db,
  viewer: Viewer,
  evidenceFileId: string,
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const file = await queryOne<{
    id: string;
    case_id: string;
    storage_reference: string;
    content_type: string;
    original_filename: string;
  }>(
    db,
    `SELECT id, case_id, storage_reference, content_type, original_filename
       FROM case_evidence_files WHERE id = $1`,
    [evidenceFileId],
  );
  if (!file) throw notFound('That evidence');

  const row = await load(db, file.case_id);
  assertMayWork(viewer, row);

  const bytes = await storage.get(file.storage_reference);

  await withTransaction((client) =>
    recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'case.evidence.read',
      entityType: 'case',
      entityId: file.case_id,
      newValue: { evidenceFileId },
    }),
  );

  return { bytes, contentType: file.content_type, filename: file.original_filename };
}

export async function assign(
  db: Db,
  viewer: Viewer,
  caseId: string,
  input: {
    assigneeId: string | null;
    department?: string | null;
    departmentId?: string | null;
    reason?: string;
  },
): Promise<void> {
  const row = await load(db, caseId);
  assertOpen(row);
  assertMayWork(viewer, row);
  if (input.assigneeId) await assertAssignable(db, input.assigneeId);

  const department = input.department === undefined ? row.department : input.department;
  const departmentId =
    input.departmentId === undefined ? row.department_id : input.departmentId;

  if (departmentId && departmentId !== row.department_id) {
    const target = await queryOne<{ status: string; name: string }>(
      db,
      'SELECT status, name FROM departments WHERE id = $1',
      [departmentId],
    );
    if (!target) throw notFound('That department');
    /*
     * A closed department is a queue nobody reads.
     *
     * Routing into one looks exactly like routing into a working department,
     * which is the failure worth refusing rather than logging.
     */
    if (target.status !== 'ACTIVE') {
      throw badRequest(`${target.name} is closed and cannot be sent work.`);
    }
  }

  const routed =
    (input.department !== undefined && input.department !== row.department) ||
    (input.departmentId !== undefined && input.departmentId !== row.department_id);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE cases
          SET assignee_id = $2, department = $3, department_id = $4, updated_at = now()
        WHERE id = $1`,
      [caseId, input.assigneeId, department, departmentId],
    );
    await append(client, caseId, viewer, {
      kind: routed ? 'ROUTED' : 'ASSIGNMENT',
      body: input.reason?.trim() ?? '',
      oldValue: {
        assigneeId: row.assignee_id,
        department: row.department,
        departmentId: row.department_id,
      },
      newValue: { assigneeId: input.assigneeId, department, departmentId },
    });
    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'case.assign',
      entityType: 'case',
      entityId: caseId,
      oldValue: {
        assigneeId: row.assignee_id,
        department: row.department,
        departmentId: row.department_id,
      },
      newValue: { assigneeId: input.assigneeId, department, departmentId },
      reason: input.reason?.trim() || null,
    });

    /*
     * And tell them, rather than leaving it for them to notice.
     *
     * Not for an officer assigning a case to themselves, which is most of what
     * an investigator does all day and would be a notification saying "you did
     * the thing you just did". Deduplicated per case and per assignee, so a
     * case reassigned back and forth while nobody reads either message leaves
     * one unread item.
     */
    if (input.assigneeId && input.assigneeId !== viewer.userId) {
      await inbox.raise(client, {
        userId: input.assigneeId,
        kind: 'CASE_ASSIGNED',
        severity: row.priority === 'URGENT' ? 'WARNING' : 'INFO',
        subject: `${row.case_number} was assigned to you: ${row.subject}`,
        body: input.reason?.trim() ?? '',
        entityType: 'case',
        entityId: caseId,
        dedupeKey: `case-assigned:${caseId}:${input.assigneeId}`,
      });
    }
  });
}

/**
 * Escalate: move the case up the reporting line, to a person.
 *
 * ESCALATED was a status and nothing more — the case changed colour and stayed
 * exactly where it was, which is an escalation in the sense that a shrug is an
 * answer. With a reporting line there is somewhere up to send it, so this
 * resolves the target, assigns the case to them, and records who it went to and
 * how the platform decided that.
 *
 * When the walk runs out — nobody above, no department head — it says so rather
 * than marking the case escalated and leaving it on the same desk.
 */
export async function escalate(
  db: Db,
  viewer: Viewer,
  caseId: string,
  input: { reason: string },
): Promise<{ toUserId: string; toName: string; via: string }> {
  const row = await load(db, caseId);
  assertOpen(row);
  assertMayWork(viewer, row);

  const { escalationTarget } = await import('./organisation.js');
  const target = await escalationTarget(db, row.assignee_id ?? viewer.userId);
  if (!target) {
    throw conflict(
      'NOBODY_ABOVE',
      'There is nobody above this case to escalate it to.',
      'Set a supervisor or a department head for the officer holding it, then try again.',
    );
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE cases
          SET status = 'ESCALATED', assignee_id = $2, updated_at = now()
        WHERE id = $1`,
      [caseId, target.id],
    );
    await append(client, caseId, viewer, {
      kind: 'ESCALATION',
      body: input.reason.trim(),
      oldValue: { status: row.status, assigneeId: row.assignee_id },
      newValue: { status: 'ESCALATED', assigneeId: target.id, via: target.via },
    });
    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: 'case.escalate',
      entityType: 'case',
      entityId: caseId,
      oldValue: { status: row.status, assigneeId: row.assignee_id },
      newValue: { assigneeId: target.id, via: target.via },
      reason: input.reason.trim(),
    });

    /*
     * An escalation that the person above finds out about by looking is an
     * escalation in the sense that a shrug is an answer.
     */
    await inbox.raise(client, {
      userId: target.id,
      kind: 'CASE_ESCALATED',
      severity: 'WARNING',
      subject: `${row.case_number} was escalated to you: ${row.subject}`,
      body: input.reason.trim(),
      entityType: 'case',
      entityId: caseId,
      dedupeKey: `case-escalated:${caseId}:${target.id}`,
    });
  });

  return { toUserId: target.id, toName: target.full_name, via: target.via };
}

/**
 * Move the case along.
 *
 * RESOLVED demands a resolution — the database insists too, so a finding cannot
 * be lost by a future caller that forgets. ESCALATED is a status rather than a
 * separate mechanism because the escalation *is* the case: it goes to somebody
 * else with its whole history attached, which is the thing an escalation by
 * email cannot do.
 */
export async function setStatus(
  db: Db,
  viewer: Viewer,
  caseId: string,
  input: { status: CaseStatus; resolution?: string; reason?: string },
): Promise<void> {
  const row = await load(db, caseId);
  assertOpen(row);
  assertMayWork(viewer, row);

  if (input.status === 'RESOLVED' && !input.resolution?.trim()) {
    throw badRequest('Say what the case concluded before resolving it.');
  }
  if (input.status === row.status) {
    throw badRequest(`Case ${row.case_number} is already ${row.status.toLowerCase()}.`);
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE cases
          SET status      = $2,
              resolution  = CASE WHEN $2 = 'RESOLVED' THEN $3 ELSE resolution END,
              resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE resolved_at END,
              resolved_by = CASE WHEN $2 = 'RESOLVED' THEN $4::uuid ELSE resolved_by END,
              closed_at   = CASE WHEN $2 = 'CLOSED' THEN now() ELSE closed_at END,
              updated_at  = now()
        WHERE id = $1`,
      [caseId, input.status, input.resolution?.trim() ?? null, viewer.userId],
    );

    if (input.status === 'RESOLVED') {
      await append(client, caseId, viewer, {
        kind: 'RESOLUTION',
        body: input.resolution!.trim(),
        oldValue: { status: row.status },
        newValue: { status: input.status },
      });
    } else {
      await append(client, caseId, viewer, {
        kind: input.status === 'ESCALATED' ? 'ESCALATION' : 'STATUS_CHANGE',
        body: input.reason?.trim() ?? '',
        oldValue: { status: row.status },
        newValue: { status: input.status },
      });
    }

    await recordAudit(client, {
      actorId: viewer.userId,
      actorRole: viewer.role,
      action: `case.${input.status.toLowerCase()}`,
      entityType: 'case',
      entityId: caseId,
      oldValue: { status: row.status },
      newValue: { status: input.status },
      reason: input.resolution?.trim() || input.reason?.trim() || null,
    });
  });
}

export async function setPriority(
  db: Db,
  viewer: Viewer,
  caseId: string,
  input: { priority?: string; dueAt?: Date | null; reason?: string },
): Promise<void> {
  const row = await load(db, caseId);
  assertOpen(row);
  assertMayWork(viewer, row);

  const priority = input.priority ?? row.priority;
  const dueAt = input.dueAt === undefined ? row.due_at : input.dueAt;

  await withTransaction(async (client) => {
    await client.query(
      'UPDATE cases SET priority = $2, due_at = $3, updated_at = now() WHERE id = $1',
      [caseId, priority, dueAt],
    );
    if (priority !== row.priority) {
      await append(client, caseId, viewer, {
        kind: 'PRIORITY_CHANGE',
        body: input.reason?.trim() ?? '',
        oldValue: { priority: row.priority },
        newValue: { priority },
      });
    }
    if (input.dueAt !== undefined && String(dueAt) !== String(row.due_at)) {
      await append(client, caseId, viewer, {
        kind: 'DUE_DATE_CHANGE',
        body: input.reason?.trim() ?? '',
        oldValue: { dueAt: row.due_at },
        newValue: { dueAt },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface CaseFilter {
  status?: string;
  open?: boolean;
  department?: string;
  assigneeId?: string;
  category?: string;
  priority?: string;
  riskLevel?: string;
  transactionId?: string;
  agentId?: string;
  taxpayerId?: string;
  overdue?: boolean;
  limit?: number;
}

export async function listCases(db: Db, filter: CaseFilter) {
  return query(
    db,
    `SELECT c.id, c.case_number, c.subject, c.category, c.status, c.priority,
            c.risk_level, c.department, c.due_at, c.created_at, c.updated_at,
            c.transaction_id, c.agent_id, c.taxpayer_id,
            t.transaction_reference,
            a.agent_code,
            COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,'')) AS taxpayer_name,
            assignee.full_name AS assignee_name,
            opener.full_name  AS opened_by_name,
            (c.due_at IS NOT NULL AND c.due_at < now()
             AND c.status NOT IN ('RESOLVED','CLOSED')) AS overdue,
            (SELECT count(*)::text FROM case_events e
              WHERE e.case_id = c.id AND e.kind IN ('COMMENT','NOTE')) AS comment_count,
            (SELECT count(*)::text FROM case_events e
              WHERE e.case_id = c.id AND e.kind = 'EVIDENCE') AS evidence_count
       FROM cases c
       LEFT JOIN users assignee   ON assignee.id = c.assignee_id
       LEFT JOIN users opener     ON opener.id = c.opened_by
       LEFT JOIN transactions t   ON t.id = c.transaction_id
       LEFT JOIN agents a         ON a.id = c.agent_id
       LEFT JOIN taxpayers tp     ON tp.id = c.taxpayer_id
      WHERE ($1::text IS NULL OR c.status = $1)
        AND ($2::boolean IS NOT TRUE OR c.status NOT IN ('RESOLVED','CLOSED'))
        AND ($3::text IS NULL OR c.department = $3)
        AND ($4::uuid IS NULL OR c.assignee_id = $4)
        AND ($5::text IS NULL OR c.category = $5)
        AND ($6::text IS NULL OR c.priority = $6)
        AND ($7::text IS NULL OR c.risk_level = $7)
        AND ($8::uuid IS NULL OR c.transaction_id = $8)
        AND ($9::uuid IS NULL OR c.agent_id = $9)
        AND ($10::uuid IS NULL OR c.taxpayer_id = $10)
        AND ($11::boolean IS NOT TRUE
             OR (c.due_at IS NOT NULL AND c.due_at < now()
                 AND c.status NOT IN ('RESOLVED','CLOSED')))
      ORDER BY
        CASE c.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
        c.due_at NULLS LAST,
        c.created_at DESC
      LIMIT $12`,
    [
      filter.status ?? null,
      filter.open ?? null,
      filter.department ?? null,
      filter.assigneeId ?? null,
      filter.category ?? null,
      filter.priority ?? null,
      filter.riskLevel ?? null,
      filter.transactionId ?? null,
      filter.agentId ?? null,
      filter.taxpayerId ?? null,
      filter.overdue ?? null,
      filter.limit ?? 100,
    ],
  );
}

/** One case and its whole history, oldest first — the order it happened in. */
export async function getCase(db: Db, viewer: Viewer, caseId: string) {
  const detail = await queryOne(
    db,
    `SELECT c.*, 
            t.transaction_reference, t.amount_kobo AS transaction_amount_kobo, t.status AS transaction_status,
            a.agent_code, agent_user.full_name AS agent_name,
            COALESCE(tp.business_name, tp.first_name || ' ' || COALESCE(tp.last_name,'')) AS taxpayer_name, tp.tin,
            subject_user.full_name AS subject_user_name, subject_user.role AS subject_user_role,
            l.name AS lga_name,
            assignee.full_name AS assignee_name, assignee.role AS assignee_role,
            opener.full_name AS opened_by_name, opener.role AS opened_by_role,
            resolver.full_name AS resolved_by_name,
            (c.due_at IS NOT NULL AND c.due_at < now()
             AND c.status NOT IN ('RESOLVED','CLOSED')) AS overdue
       FROM cases c
       LEFT JOIN users assignee     ON assignee.id = c.assignee_id
       LEFT JOIN users opener       ON opener.id = c.opened_by
       LEFT JOIN users resolver     ON resolver.id = c.resolved_by
       LEFT JOIN users subject_user ON subject_user.id = c.subject_user_id
       LEFT JOIN transactions t     ON t.id = c.transaction_id
       LEFT JOIN agents a           ON a.id = c.agent_id
       LEFT JOIN users agent_user   ON agent_user.id = a.user_id
       LEFT JOIN taxpayers tp       ON tp.id = c.taxpayer_id
       LEFT JOIN lgas l             ON l.id = c.lga_id
      WHERE c.id = $1`,
    [caseId],
  );
  if (!detail) throw notFound('That case');

  const events = await query(
    db,
    `SELECT e.id, e.sequence_no, e.kind, e.body, e.old_value, e.new_value,
            e.document_id, e.evidence_file_id, e.created_at, e.actor_role,
            d.document_number, d.document_type, d.status AS document_status,
            f.original_filename, f.content_type, f.byte_size, f.checksum,
            f.description AS evidence_description, f.provenance AS evidence_provenance,
            u.full_name AS actor_name,
            COALESCE(
              (SELECT array_agg(m.full_name ORDER BY m.full_name)
                 FROM users m WHERE m.id = ANY(e.mentions)),
              '{}'
            ) AS mention_names
       FROM case_events e
       JOIN users u ON u.id = e.actor_id
       LEFT JOIN documents d ON d.id = e.document_id
       LEFT JOIN case_evidence_files f ON f.id = e.evidence_file_id
      WHERE e.case_id = $1
      ORDER BY e.sequence_no`,
    [caseId],
  );

  /*
   * What this case could have attached to it, and has not.
   *
   * Evidence comes from two places, and this is the first: a document the
   * platform itself issued — a receipt, an invoice, a vehicle's papers — which
   * is attached by pointing at it. The list of candidates is what the case is
   * already about.
   *
   * The second is `uploadEvidence` below: a file that did not originate here,
   * which most of what an investigation collects does not.
   *
   * Derived here rather than through a document-browsing endpoint, because a
   * screen that let an officer search every document the State holds is a
   * different and much larger permission than working a case.
   */
  const attachable = holds(viewer, 'document:read:all')
    ? await query(
        db,
        `SELECT d.id, d.document_number, d.document_type, d.issued_at, d.status
           FROM documents d
          WHERE (
                  ($2::uuid IS NOT NULL AND d.owner_type = 'TAXPAYER' AND d.owner_id = $2)
               OR ($3::uuid IS NOT NULL AND d.entity_id = $3)
                )
            AND d.status <> 'REVOKED'
            AND NOT EXISTS (
                  SELECT 1 FROM case_events e
                   WHERE e.case_id = $1 AND e.document_id = d.id
                )
          ORDER BY d.issued_at DESC LIMIT 50`,
        [caseId, detail.taxpayer_id ?? null, detail.transaction_id ?? null],
      )
    : [];

  return {
    ...detail,
    events,
    attachable,
    /*
     * Whether *this* officer may act, answered by the server.
     *
     * The screen needs it to decide which controls to render, and it is not
     * derivable from the role alone — "I opened this one" is a fact about the
     * row. Sending it saves the client reimplementing `mayWork` and getting a
     * different answer from the API.
     */
    may_work: mayWork(viewer, detail as unknown as CaseRow),
  };
}

/**
 * Everything waiting for one officer, in one answer.
 *
 * The brief calls this "My Work", and the point of it is that an officer should
 * not have to visit six screens to discover whether any of them wants
 * something. Each block below is a queue that already existed somewhere and had
 * to be gone and looked for.
 *
 * Scoped to the officer by identity, not by role, except the last three — the
 * approval, exception and flag queues are shared work, and a finance officer's
 * question about them is "what is outstanding", not "what is outstanding and
 * has my name on it". Each is gated on the permission its own screen requires,
 * so an auditor gets the flags and not the approvals.
 */
export async function myWork(db: Db, viewer: Viewer) {
  const canApprove = holds(viewer, 'approval:review') || holds(viewer, 'approval:authorise');
  const canReconcile = holds(viewer, 'report:financial') || holds(viewer, 'payment:reconcile');
  const canSeeFraud = holds(viewer, 'fraud:read');

  const [assigned, opened, mentions, unassigned, counts, approvals, exceptions, flags] =
    await Promise.all([
      listCases(db, { assigneeId: viewer.userId, open: true, limit: 50 }),
      query(
        db,
        `SELECT c.id, c.case_number, c.subject, c.status, c.priority, c.due_at,
                assignee.full_name AS assignee_name,
                (c.due_at IS NOT NULL AND c.due_at < now()) AS overdue
           FROM cases c
           LEFT JOIN users assignee ON assignee.id = c.assignee_id
          WHERE c.opened_by = $1 AND c.status NOT IN ('RESOLVED','CLOSED')
            AND (c.assignee_id IS DISTINCT FROM $1)
          ORDER BY c.updated_at DESC LIMIT 25`,
        [viewer.userId],
      ),
      /*
       * "Somebody wrote my name."
       *
       * Only the most recent mention per case: an officer named four times in
       * one discussion has one thing to read, not four.
       */
      query(
        db,
        `SELECT DISTINCT ON (e.case_id)
                e.case_id, e.body, e.created_at, e.kind,
                c.case_number, c.subject, c.status,
                u.full_name AS actor_name
           FROM case_events e
           JOIN cases c ON c.id = e.case_id
           JOIN users u ON u.id = e.actor_id
          WHERE $1 = ANY(e.mentions) AND e.actor_id <> $1
          ORDER BY e.case_id, e.sequence_no DESC
          LIMIT 25`,
        [viewer.userId],
      ),
      /*
       * Addressed to this officer's department and picked up by nobody.
       *
       * The queue a case falls into when it is routed to Finance rather than to
       * a named person. Without it, routing to a department is routing to
       * nowhere.
       *
       * Two ways in, because there are two kinds of address. A case sent to the
       * officer's actual department is theirs; one sent to their *role* is too,
       * which is how every case raised before departments existed is addressed
       * and how a raiser who does not know the organisation chart still reaches
       * somebody. Reading only the first would strand every case already in
       * flight.
       */
      query(
        db,
        `SELECT c.id, c.case_number, c.subject, c.status, c.priority, c.risk_level,
                c.due_at, c.created_at, opener.full_name AS opened_by_name,
                d.name AS department_name
           FROM cases c
           LEFT JOIN users opener ON opener.id = c.opened_by
           LEFT JOIN departments d ON d.id = c.department_id
          WHERE c.assignee_id IS NULL
            AND c.status NOT IN ('RESOLVED','CLOSED')
            AND (
                  c.department = $2
               OR (c.department_id IS NOT NULL
                   AND c.department_id = (SELECT department_id FROM users WHERE id = $1))
                )
          ORDER BY c.created_at LIMIT 25`,
        [viewer.userId, viewer.role],
      ),
      queryOne(
        db,
        `SELECT
           (SELECT count(*)::text FROM cases
             WHERE assignee_id = $1 AND status NOT IN ('RESOLVED','CLOSED')) AS assigned_open,
           (SELECT count(*)::text FROM cases
             WHERE assignee_id = $1 AND status NOT IN ('RESOLVED','CLOSED')
               AND due_at IS NOT NULL AND due_at < now()) AS assigned_overdue,
           (SELECT count(*)::text FROM cases
             WHERE opened_by = $1 AND status NOT IN ('RESOLVED','CLOSED')) AS opened_open,
           (SELECT count(*)::text FROM cases c
             WHERE c.assignee_id IS NULL
               AND c.status NOT IN ('RESOLVED','CLOSED')
               AND (c.department = $2
                    OR (c.department_id IS NOT NULL
                        AND c.department_id = (SELECT department_id FROM users WHERE id = $1))))
             AS department_unassigned,
           (SELECT count(DISTINCT e.case_id)::text FROM case_events e
             WHERE $1 = ANY(e.mentions) AND e.actor_id <> $1) AS mentions`,
        [viewer.userId, viewer.role],
      ),
      canApprove
        ? query(
            db,
            `SELECT a.id, a.approval_type, a.entity_type, a.status, a.requested_at,
                    a.requested_reason, u.full_name AS requested_by_name
               FROM approvals a
               LEFT JOIN users u ON u.id = a.requested_by
              WHERE a.status IN ('REQUESTED','REVIEWED')
              ORDER BY a.requested_at LIMIT 25`,
          )
        : Promise.resolve([]),
      canReconcile
        ? query(
            db,
            `SELECT rr.id, rr.status, rr.variance_kobo::text, rr.gateway_reference,
                    rr.created_at, t.transaction_reference
               FROM reconciliation_records rr
               LEFT JOIN transactions t ON t.id = rr.transaction_id
              WHERE rr.reconciled_at IS NULL
                AND rr.status IN ('MISSING_PAYMENT','MISSING_PLATFORM_TRANSACTION',
                                  'AMOUNT_MISMATCH','DUPLICATE_PAYMENT')
              ORDER BY abs(rr.variance_kobo) DESC LIMIT 25`,
          )
        : Promise.resolve([]),
      canSeeFraud
        ? query(
            db,
            `SELECT f.id, f.rule, f.severity, f.status, f.created_at, f.entity_type,
                    a.agent_code, u.full_name AS agent_name,
                    (SELECT count(*)::text FROM cases c
                      WHERE c.source_type = 'FRAUD_FLAG' AND c.source_id = f.id) AS case_count
               FROM fraud_flags f
               LEFT JOIN agents a ON a.id = f.agent_id
               LEFT JOIN users u ON u.id = a.user_id
              WHERE f.status IN ('OPEN','UNDER_REVIEW')
              ORDER BY
                CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                                WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                f.created_at DESC
              LIMIT 25`,
          )
        : Promise.resolve([]),
    ]);

  return {
    officer: { id: viewer.userId, role: viewer.role },
    counts,
    assigned,
    opened,
    mentions,
    unassigned,
    approvals,
    exceptions,
    flags,
  };
}
