/**
 * The organisation the officers work in.
 *
 * The platform models the revenue service's work in detail and its structure
 * not at all: no department, no office, and no reporting line. Six items on the
 * officer readiness assessment read Missing or Partial because of that, and one
 * of them is load-bearing — a case could not be routed to Finance as a body,
 * only to whoever happened to hold the finance role.
 *
 * THREE OBJECTS, AND WHY THEY ARE THREE
 *
 * A **department** is who somebody works with and who answers for them.
 * A **revenue office** is where they physically sit, which is not the same as
 * the territory they cover — the Jos North office administers three LGAs, and a
 * taxpayer asking "where do I go" needs the office while a report asking "whose
 * revenue is this" needs the territory.
 * A **transfer** is a dated fact about a posting. It was previously only an
 * audit entry, which answers "what changed" and not "who has worked this LGA
 * this year" — a question that comes up in every revenue dispute, and one you
 * cannot answer by replaying a log and hoping none of it is missing.
 *
 * ESCALATION IS WHY THE REPORTING LINE EXISTS
 *
 * "Send this up" needs somewhere up to send it to. `escalationTarget` walks
 * `supervisor_id` and falls back to the department head, then to the parent
 * department's head — so an escalation lands on a person even when the officer
 * directly above is on leave or unset. The walk terminates because the database
 * refuses a cycle; see migration 057.
 */

import type { PoolClient } from 'pg';
import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound } from '../lib/errors';
import { recordAudit } from './audit';

export const DEPARTMENT_FUNCTIONS = [
  'ASSESSMENT',
  'COLLECTION',
  'FINANCE',
  'AUDIT',
  'ENFORCEMENT',
  'TAXPAYER_SERVICES',
  'ADMINISTRATION',
  'TECHNOLOGY',
] as const;
export type DepartmentFunction = (typeof DEPARTMENT_FUNCTIONS)[number];

export const TRANSFER_KINDS = [
  'POSTING',
  'DEPARTMENT',
  'OFFICE',
  'SUPERVISOR',
  'TERRITORY',
  'ROLE',
] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export interface Actor {
  userId: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function listDepartments(db: Db) {
  return query(
    db,
    `SELECT d.id, d.code, d.name, d.name_ha, d.description, d.function, d.status,
            d.parent_id, parent.name AS parent_name,
            head.full_name AS head_name, head.id AS head_user_id,
            (SELECT count(*)::text FROM users u
              WHERE u.department_id = d.id AND u.status = 'ACTIVE') AS officers,
            (SELECT count(*)::text FROM cases c
              WHERE c.department_id = d.id
                AND c.status NOT IN ('RESOLVED','CLOSED')) AS open_cases
       FROM departments d
       LEFT JOIN departments parent ON parent.id = d.parent_id
       LEFT JOIN users head ON head.id = d.head_user_id
      ORDER BY d.status, d.name`,
  );
}

export async function createDepartment(
  actor: Actor,
  input: {
    code: string;
    name: string;
    nameHa?: string | null;
    description?: string | null;
    function: DepartmentFunction;
    headUserId?: string | null;
    parentId?: string | null;
  },
): Promise<{ id: string }> {
  if (input.headUserId) await assertPortalOfficer(input.headUserId);

  return withTransaction(async (client) => {
    const existing = await queryOne<{ id: string }>(
      client,
      'SELECT id FROM departments WHERE code = $1',
      [input.code.trim().toUpperCase()],
    );
    if (existing) {
      throw conflict('DEPARTMENT_EXISTS', `A department with code ${input.code} already exists.`);
    }

    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO departments (code, name, name_ha, description, function, head_user_id, parent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.code.trim().toUpperCase(),
        input.name.trim(),
        input.nameHa?.trim() || null,
        input.description?.trim() || null,
        input.function,
        input.headUserId ?? null,
        input.parentId ?? null,
      ],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'department.create',
      entityType: 'department',
      entityId: row!.id,
      newValue: { code: input.code, name: input.name, function: input.function },
    });
    return { id: row!.id };
  });
}

export async function updateDepartment(
  actor: Actor,
  departmentId: string,
  input: {
    name?: string;
    nameHa?: string | null;
    description?: string | null;
    headUserId?: string | null;
    parentId?: string | null;
    status?: 'ACTIVE' | 'CLOSED';
  },
): Promise<void> {
  if (input.headUserId) await assertPortalOfficer(input.headUserId);

  await withTransaction(async (client) => {
    const before = await queryOne(
      client,
      `SELECT name, name_ha, description, head_user_id, parent_id, status
         FROM departments WHERE id = $1 FOR UPDATE`,
      [departmentId],
    );
    if (!before) throw notFound('That department');

    if (input.parentId === departmentId) {
      throw badRequest('A department cannot be its own parent.');
    }
    /*
     * A closed department with officers still in it is a queue nobody reads.
     *
     * Closing is how a department ends; leaving people posted to it means their
     * cases route to a body that no longer exists.
     */
    if (input.status === 'CLOSED') {
      const posted = await queryOne<{ count: string }>(
        client,
        `SELECT count(*)::text FROM users
          WHERE department_id = $1 AND status = 'ACTIVE'`,
        [departmentId],
      );
      if (Number(posted!.count) > 0) {
        throw conflict(
          'DEPARTMENT_STAFFED',
          `${posted!.count} officer(s) are still posted to that department.`,
          'Transfer them first, then close it.',
        );
      }
    }

    await client.query(
      `UPDATE departments
          SET name         = COALESCE($2, name),
              name_ha      = CASE WHEN $6::boolean THEN $3 ELSE name_ha END,
              description  = CASE WHEN $7::boolean THEN $4 ELSE description END,
              head_user_id = CASE WHEN $8::boolean THEN $5::uuid ELSE head_user_id END,
              parent_id    = CASE WHEN $9::boolean THEN $10::uuid ELSE parent_id END,
              status       = COALESCE($11, status),
              updated_at   = now()
        WHERE id = $1`,
      [
        departmentId,
        input.name?.trim() ?? null,
        input.nameHa?.trim() ?? null,
        input.description?.trim() ?? null,
        input.headUserId ?? null,
        input.nameHa !== undefined,
        input.description !== undefined,
        input.headUserId !== undefined,
        input.parentId !== undefined,
        input.parentId ?? null,
        input.status ?? null,
      ],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'department.update',
      entityType: 'department',
      entityId: departmentId,
      oldValue: before,
      newValue: input,
    });
  });
}

// ---------------------------------------------------------------------------
// Revenue offices
// ---------------------------------------------------------------------------

export async function listOffices(db: Db) {
  return query(
    db,
    `SELECT o.id, o.code, o.name, o.name_ha, o.address, o.phone, o.status,
            l.name AS lga_name, o.lga_id, o.covers_lga_ids,
            head.full_name AS head_name,
            (SELECT count(*)::text FROM users u
              WHERE u.revenue_office_id = o.id AND u.status = 'ACTIVE') AS officers,
            (SELECT COALESCE(array_agg(cl.name ORDER BY cl.name), '{}')
               FROM lgas cl WHERE cl.id = ANY(o.covers_lga_ids)) AS covers
       FROM revenue_offices o
       JOIN lgas l ON l.id = o.lga_id
       LEFT JOIN users head ON head.id = o.head_user_id
      ORDER BY o.status, l.name, o.name`,
  );
}

export async function createOffice(
  actor: Actor,
  input: {
    code: string;
    name: string;
    nameHa?: string | null;
    lgaId: string;
    address?: string | null;
    phone?: string | null;
    coversLgaIds?: string[];
    headUserId?: string | null;
  },
): Promise<{ id: string }> {
  if (input.headUserId) await assertPortalOfficer(input.headUserId);

  return withTransaction(async (client) => {
    /*
     * An office always administers its own LGA.
     *
     * Left to the caller this is forgotten roughly half the time, and the
     * failure is silent: the office exists, covers three LGAs, and not the one
     * it stands in.
     */
    const covers = [...new Set([input.lgaId, ...(input.coversLgaIds ?? [])])];

    const row = await queryOne<{ id: string }>(
      client,
      `INSERT INTO revenue_offices
         (code, name, name_ha, lga_id, address, phone, covers_lga_ids, head_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        input.code.trim().toUpperCase(),
        input.name.trim(),
        input.nameHa?.trim() || null,
        input.lgaId,
        input.address?.trim() || null,
        input.phone?.trim() || null,
        covers,
        input.headUserId ?? null,
      ],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'revenue_office.create',
      entityType: 'revenue_office',
      entityId: row!.id,
      newValue: { code: input.code, name: input.name, covers },
    });
    return { id: row!.id };
  });
}

// ---------------------------------------------------------------------------
// Posting an officer, and the record it leaves
// ---------------------------------------------------------------------------

export interface PostingInput {
  departmentId?: string | null;
  revenueOfficeId?: string | null;
  supervisorId?: string | null;
  jobTitle?: string | null;
  staffNumber?: string | null;
  reason: string;
  effectiveFrom?: Date;
}

/**
 * Change an officer's posting, and record each change as a transfer.
 *
 * One transfer row per thing that actually moved, rather than one row saying
 * "posting changed": "when did she move to Finance" and "when did he stop
 * reporting to Bala" are separate questions with separate answers, and a
 * combined row makes both of them a JSON dig.
 */
export async function repost(
  actor: Actor,
  userId: string,
  input: PostingInput,
): Promise<{ transfers: number }> {
  if (input.supervisorId) {
    if (input.supervisorId === userId) {
      throw badRequest('An officer cannot supervise themselves.');
    }
    await assertPortalOfficer(input.supervisorId);
  }

  return withTransaction(async (client) => {
    const before = await queryOne<{
      full_name: string;
      department_id: string | null;
      revenue_office_id: string | null;
      supervisor_id: string | null;
      job_title: string | null;
      staff_number: string | null;
    }>(
      client,
      `SELECT full_name, department_id, revenue_office_id, supervisor_id, job_title, staff_number
         FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (!before) throw notFound('That officer');

    await client.query(
      `UPDATE users
          SET department_id     = CASE WHEN $2::boolean THEN $3::uuid ELSE department_id END,
              revenue_office_id = CASE WHEN $4::boolean THEN $5::uuid ELSE revenue_office_id END,
              supervisor_id     = CASE WHEN $6::boolean THEN $7::uuid ELSE supervisor_id END,
              job_title         = CASE WHEN $8::boolean THEN $9 ELSE job_title END,
              staff_number      = CASE WHEN $10::boolean THEN $11 ELSE staff_number END,
              updated_at        = now()
        WHERE id = $1`,
      [
        userId,
        input.departmentId !== undefined,
        input.departmentId ?? null,
        input.revenueOfficeId !== undefined,
        input.revenueOfficeId ?? null,
        input.supervisorId !== undefined,
        input.supervisorId ?? null,
        input.jobTitle !== undefined,
        input.jobTitle?.trim() ?? null,
        input.staffNumber !== undefined,
        input.staffNumber?.trim() ?? null,
      ],
    );

    const moves: { kind: TransferKind; from: unknown; to: unknown }[] = [];
    if (input.departmentId !== undefined && input.departmentId !== before.department_id) {
      moves.push({ kind: 'DEPARTMENT', from: before.department_id, to: input.departmentId });
    }
    if (
      input.revenueOfficeId !== undefined &&
      input.revenueOfficeId !== before.revenue_office_id
    ) {
      moves.push({ kind: 'OFFICE', from: before.revenue_office_id, to: input.revenueOfficeId });
    }
    if (input.supervisorId !== undefined && input.supervisorId !== before.supervisor_id) {
      moves.push({ kind: 'SUPERVISOR', from: before.supervisor_id, to: input.supervisorId });
    }
    if (input.jobTitle !== undefined && (input.jobTitle?.trim() ?? null) !== before.job_title) {
      moves.push({ kind: 'POSTING', from: before.job_title, to: input.jobTitle?.trim() ?? null });
    }

    for (const move of moves) {
      await recordTransfer(client, actor, {
        userId,
        kind: move.kind,
        fromValue: move.from,
        toValue: move.to,
        reason: input.reason,
        effectiveFrom: input.effectiveFrom,
      });
    }

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'officer.repost',
      entityType: 'user',
      entityId: userId,
      oldValue: before,
      newValue: input,
      reason: input.reason,
    });

    return { transfers: moves.length };
  });
}

export async function recordTransfer(
  client: PoolClient,
  actor: Actor,
  input: {
    userId: string;
    kind: TransferKind;
    fromValue: unknown;
    toValue: unknown;
    reason: string;
    effectiveFrom?: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO officer_transfers
       (user_id, kind, from_value, to_value, reason, effective_from, recorded_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7)`,
    [
      input.userId,
      input.kind,
      input.fromValue === undefined ? null : JSON.stringify(input.fromValue),
      input.toValue === undefined ? null : JSON.stringify(input.toValue),
      input.reason,
      input.effectiveFrom ?? null,
      actor.userId,
    ],
  );
}

/** One officer's posting history, newest first. */
export async function transfersFor(db: Db, userId: string) {
  return query(
    db,
    `SELECT ot.id, ot.kind, ot.from_value, ot.to_value, ot.reason,
            ot.effective_from, ot.created_at,
            recorder.full_name AS recorded_by_name
       FROM officer_transfers ot
       JOIN users recorder ON recorder.id = ot.recorded_by
      WHERE ot.user_id = $1
      ORDER BY ot.effective_from DESC, ot.created_at DESC`,
    [userId],
  );
}

/**
 * Everyone who has been posted to a place, and when.
 *
 * The question a revenue dispute actually asks — "who was responsible for Jos
 * North in March" — and the reason this is a table rather than a log.
 */
export async function postingHistory(
  db: Db,
  params: { from?: Date; to?: Date; kind?: TransferKind } = {},
) {
  return query(
    db,
    `SELECT ot.id, ot.kind, ot.from_value, ot.to_value, ot.reason,
            ot.effective_from, u.full_name, u.role, u.staff_number,
            recorder.full_name AS recorded_by_name
       FROM officer_transfers ot
       JOIN users u ON u.id = ot.user_id
       JOIN users recorder ON recorder.id = ot.recorded_by
      WHERE ($1::date IS NULL OR ot.effective_from >= $1)
        AND ($2::date IS NULL OR ot.effective_from <= $2)
        AND ($3::text IS NULL OR ot.kind = $3)
      ORDER BY ot.effective_from DESC, ot.created_at DESC
      LIMIT 500`,
    [params.from ?? null, params.to ?? null, params.kind ?? null],
  );
}

/**
 * Who a case escalates to, walking up until somebody real is found.
 *
 * Direct supervisor, then the head of the officer's department, then the head
 * of the department above that. Each fallback exists because the level before
 * it is routinely unset in a real organisation — a supervisor on leave, a
 * department between heads — and an escalation that resolves to nobody is an
 * escalation that goes nowhere and looks like it went somewhere.
 *
 * Returns null when the walk genuinely runs out, so the caller can say "there
 * is nobody above you" rather than silently doing nothing.
 */
export async function escalationTarget(
  db: Db,
  userId: string,
): Promise<{ id: string; full_name: string; role: string; via: string } | null> {
  const direct = await queryOne<{ id: string; full_name: string; role: string }>(
    db,
    `SELECT s.id, s.full_name, s.role
       FROM users u JOIN users s ON s.id = u.supervisor_id
      WHERE u.id = $1 AND s.status = 'ACTIVE'`,
    [userId],
  );
  if (direct) return { ...direct, via: 'SUPERVISOR' };

  const departmentHead = await queryOne<{ id: string; full_name: string; role: string }>(
    db,
    `SELECT h.id, h.full_name, h.role
       FROM users u
       JOIN departments d ON d.id = u.department_id
       JOIN users h ON h.id = d.head_user_id
      WHERE u.id = $1 AND h.status = 'ACTIVE' AND h.id <> u.id`,
    [userId],
  );
  if (departmentHead) return { ...departmentHead, via: 'DEPARTMENT_HEAD' };

  const parentHead = await queryOne<{ id: string; full_name: string; role: string }>(
    db,
    `SELECT h.id, h.full_name, h.role
       FROM users u
       JOIN departments d ON d.id = u.department_id
       JOIN departments p ON p.id = d.parent_id
       JOIN users h ON h.id = p.head_user_id
      WHERE u.id = $1 AND h.status = 'ACTIVE' AND h.id <> u.id`,
    [userId],
  );
  if (parentHead) return { ...parentHead, via: 'PARENT_DEPARTMENT_HEAD' };

  return null;
}

/**
 * Only somebody who works in the portal can head a department or supervise.
 *
 * A field agent set as a department head produces a queue nobody can open, and
 * a closed account produces one nobody reads — both of which look exactly like
 * a department being run.
 */
async function assertPortalOfficer(userId: string): Promise<void> {
  const { pool } = await import('../db/pool.js');
  const row = await queryOne<{ role: string; status: string; full_name: string }>(
    pool,
    'SELECT role, status, full_name FROM users WHERE id = $1',
    [userId],
  );
  if (!row) throw notFound('That officer');
  if (row.status !== 'ACTIVE') {
    throw badRequest(`${row.full_name}'s account is ${row.status.toLowerCase()}.`);
  }
  if (row.role === 'agent') {
    throw badRequest(`${row.full_name} is a field agent and cannot hold an office post.`);
  }
}
