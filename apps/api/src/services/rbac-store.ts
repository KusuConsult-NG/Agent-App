/**
 * Who may do what, read from the database instead of from a source file.
 *
 * `packages/shared/src/rbac.ts` held the map, and it is a good table — the
 * permissions are granular and every route names one. The problem was where it
 * lived: changing who may approve a refund was a code change and a deployment,
 * so PSIRS could not answer a change in their own delegation of authority
 * without an engineer and a release.
 *
 * WHAT MOVED AND WHAT DID NOT
 *
 * The *catalogue* of permissions stays in code and must. A permission is a name
 * that route handlers reference; inventing one in the database creates a string
 * nothing checks, which is worse than not having it because it looks like a
 * control. `PERMISSIONS` in `rbac.ts` remains the list of what exists, and a
 * grant naming anything outside it is refused here.
 *
 * The *map* is data. So is the role list.
 *
 * THE CACHE, AND WHAT IT COSTS
 *
 * Every authenticated request needs the caller's permissions, so this cannot be
 * a query per request. It is an in-process map with a thirty-second life.
 *
 * That means a *grant* takes up to thirty seconds to reach every instance,
 * which is harmless. A *revocation* taking thirty seconds would not be, so
 * revoking does not rely on the cache expiring: `revokePermission` ends the
 * sessions of everybody holding the role, and the next sign-in reads fresh
 * grants. The officer is signed out, which is a visible and correct
 * consequence of having their authority reduced.
 *
 * FAILING CLOSED IS NOT AN OPTION HERE, AND FAILING OPEN IS WORSE
 *
 * If the table cannot be read, this falls back to the compiled map in
 * `rbac.ts` — the same one the migration seeded from — and logs it. The
 * alternative is a database blip locking every officer out of a revenue
 * platform, or granting everything to everybody. The compiled map is neither:
 * it is the known-good baseline, and drifting to it is the safest wrong answer
 * available.
 */

import { PERMISSIONS, permissionsForRole as compiledPermissionsFor, type Permission } from '@psirs/shared';
import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound } from '../lib/errors';
import { forgetLimits } from './export';
import { log } from '../lib/logger';
import { recordAudit } from './audit';

/**
 * Thirty seconds.
 *
 * Long enough that a busy instance is not re-reading the table constantly,
 * short enough that a grant is live before an administrator has finished
 * telling somebody about it. Revocation does not wait for it; see the header.
 */
const CACHE_MS = 30_000;

interface Snapshot {
  byRole: Map<string, readonly Permission[]>;
  portalRoles: Set<string>;
  /** Grants naming something the code no longer checks; see `narrow`. */
  stale: string[];
  loadedAt: number;
}

const CATALOGUE = new Set<string>(PERMISSIONS);

/**
 * Keep only grants the code actually checks.
 *
 * `grant` refuses a permission outside the catalogue, so a row like this can
 * only arrive one way: a deployment removed a permission and left the row
 * behind. Serving it would put a name in `req.auth.permissions` that no route
 * consults — harmless in itself, and exactly the kind of thing that makes an
 * administrator believe an officer can do something they cannot.
 *
 * Dropped and logged, rather than dropped quietly: a stale grant is a signal
 * that a release removed an authority somebody had deliberately given.
 */
function narrow(role: string, granted: string[], stale: string[]): readonly Permission[] {
  const kept: Permission[] = [];
  for (const permission of granted) {
    if (CATALOGUE.has(permission)) kept.push(permission as Permission);
    else stale.push(`${role}:${permission}`);
  }
  return Object.freeze(kept);
}

let snapshot: Snapshot | null = null;
let inFlight: Promise<Snapshot> | null = null;

function isFresh(current: Snapshot | null): current is Snapshot {
  return current !== null && Date.now() - current.loadedAt < CACHE_MS;
}

async function readSnapshot(): Promise<Snapshot> {
  const rows = await query<{ role: string; permission: string }>(
    pool,
    `SELECT rp.role, rp.permission
       FROM role_permissions rp
       JOIN roles r ON r.name = rp.role
      WHERE r.status = 'ACTIVE'`,
  );
  const roles = await query<{ name: string; is_portal: boolean }>(
    pool,
    `SELECT name, is_portal FROM roles WHERE status = 'ACTIVE'`,
  );

  const byRole = new Map<string, string[]>();
  for (const role of roles) byRole.set(role.name, []);
  for (const row of rows) {
    const held = byRole.get(row.role);
    if (held) held.push(row.permission);
  }

  const stale: string[] = [];
  const narrowed = new Map(
    [...byRole].map(([role, held]) => [role, narrow(role, held, stale)] as const),
  );
  if (stale.length > 0) {
    log.warn('role grants name permissions this build does not check', {
      component: 'rbac',
      stale,
    });
  }

  return {
    byRole: narrowed,
    portalRoles: new Set(roles.filter((role) => role.is_portal).map((role) => role.name)),
    stale,
    loadedAt: Date.now(),
  };
}

/**
 * Load the map, coalescing concurrent callers onto one query.
 *
 * Without the coalescing, an instance restarting under load issues one query
 * per in-flight request in the same millisecond — a thundering herd against the
 * one table every request needs.
 */
async function current(): Promise<Snapshot> {
  if (isFresh(snapshot)) return snapshot;
  if (inFlight) return inFlight;

  inFlight = readSnapshot()
    .then((loaded) => {
      snapshot = loaded;
      return loaded;
    })
    .catch((error) => {
      log.error('role permissions could not be read; falling back to the compiled map', {
        component: 'rbac',
        error: error instanceof Error ? error.message : String(error),
      });
      /*
       * The compiled map, which the migration seeded from.
       *
       * Not an empty map: locking every officer out of a revenue platform
       * because one query failed is a worse outcome than serving the baseline
       * the deployment shipped with. Not a permissive map either, for the
       * obvious reason.
       *
       * `loadedAt` is set far enough in the past that the next request retries
       * rather than serving the fallback for thirty seconds.
       */
      const fallback: Snapshot = {
        byRole: new Map(
          (['agent', 'supervisor', 'revenue_officer', 'finance_officer', 'auditor', 'admin'] as const)
            .map((role) => [role as string, compiledPermissionsFor(role)]),
        ),
        portalRoles: new Set(['supervisor', 'revenue_officer', 'finance_officer', 'auditor', 'admin']),
        stale: [],
        loadedAt: 0,
      };
      return fallback;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drop the cache, so the next read is fresh. Called after every write. */
export function forget(): void {
  snapshot = null;
}

/**
 * Warm the cache at start-up.
 *
 * So the first request of the day is not the one that pays for the query, and
 * so a misconfigured database is discovered on boot rather than on somebody's
 * first sign-in.
 */
export async function warm(): Promise<void> {
  await current();
}

export async function permissionsFor(role: string): Promise<readonly Permission[]> {
  const loaded = await current();
  return loaded.byRole.get(role) ?? [];
}

export async function roleHasPermission(role: string, permission: string): Promise<boolean> {
  // Widened for the comparison: the caller may reasonably ask about a string
  // that is not a permission, and the honest answer to that is `false` rather
  // than a type error at the call site.
  return (await permissionsFor(role) as readonly string[]).includes(permission);
}

export async function portalRoles(): Promise<readonly string[]> {
  return [...(await current()).portalRoles];
}

// ---------------------------------------------------------------------------
// Reading the map, for an administrator
// ---------------------------------------------------------------------------

export async function listRoles(db: Db) {
  return query(
    db,
    `SELECT r.name, r.label, r.label_ha, r.description, r.is_system, r.is_portal, r.status,
            r.export_row_limit,
            (SELECT count(*)::text FROM users u WHERE u.role = r.name AND u.status = 'ACTIVE')
              AS officers,
            COALESCE(
              (SELECT array_agg(rp.permission ORDER BY rp.permission)
                 FROM role_permissions rp WHERE rp.role = r.name),
              '{}'
            ) AS permissions
       FROM roles r
      ORDER BY r.is_system DESC, r.name`,
  );
}

/**
 * How many rows this role may take out of the platform.
 *
 * Its own function rather than a general "update the role", because it is the
 * only field on a role that is a control: the label and the description are
 * how a role reads, and this is how much of the register can leave in one
 * file. A single-purpose endpoint is what makes the audit entry say what
 * actually changed rather than "the role was edited".
 */
export async function setExportLimit(
  actor: Actor,
  roleName: string,
  limit: number,
  reason: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const role = await loadRole(client, roleName);

    const previous = await queryOne<{ export_row_limit: number }>(
      client,
      'SELECT export_row_limit FROM roles WHERE name = $1',
      [roleName],
    );
    if (previous!.export_row_limit === limit) {
      throw conflict(
        'LIMIT_UNCHANGED',
        `${role.label} may already export ${limit.toLocaleString()} rows at a time.`,
      );
    }

    /*
     * The bounds are the database's, checked here so the administrator gets a
     * sentence rather than a constraint violation. The ceiling is not a policy
     * -- it is what the XLSX writer can actually produce, and a limit above it
     * would be a promise the code cannot keep.
     */
    await client.query('UPDATE roles SET export_row_limit = $2, updated_at = now() WHERE name = $1', [
      roleName,
      limit,
    ]);

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'rbac.role.export_limit',
      entityType: 'role',
      entityId: roleName,
      oldValue: { exportRowLimit: previous!.export_row_limit },
      newValue: { exportRowLimit: limit },
      reason,
    });
  });

  // Both caches: the map's, and the export limit's next door.
  forget();
  forgetLimits();
}

/**
 * Every permission that exists, so an administrator can see what is grantable.
 *
 * Read from the compiled catalogue rather than from `role_permissions`, because
 * a permission nobody currently holds is still a permission — and listing only
 * what is granted would make the ungranted ones ungrantable.
 */
export function grantablePermissions(): readonly string[] {
  return PERMISSIONS;
}

// ---------------------------------------------------------------------------
// Changing it
// ---------------------------------------------------------------------------

export interface Actor {
  userId: string;
  role: string;
}

export async function grant(
  actor: Actor,
  input: { role: string; permission: string; reason: string },
): Promise<void> {
  assertRealPermission(input.permission);

  await withTransaction(async (client) => {
    const role = await loadRole(client, input.role);
    if (role.status !== 'ACTIVE') {
      throw conflict('ROLE_RETIRED', `The ${role.name} role is retired.`);
    }
    const already = await queryOne(
      client,
      'SELECT 1 FROM role_permissions WHERE role = $1 AND permission = $2',
      [input.role, input.permission],
    );
    if (already) {
      throw conflict('ALREADY_GRANTED', `${role.label} already holds ${input.permission}.`);
    }

    await client.query(
      `INSERT INTO role_permissions (role, permission, granted_by, reason)
       VALUES ($1,$2,$3,$4)`,
      [input.role, input.permission, actor.userId, input.reason.trim()],
    );
    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'rbac.grant',
      entityType: 'role',
      entityId: input.role,
      newValue: { permission: input.permission },
      reason: input.reason.trim(),
    });
  });

  forget();
}

/**
 * Take a permission away, and end the sessions that were relying on it.
 *
 * The sessions are the point. A cached map means a revocation would otherwise
 * take up to thirty seconds to reach every instance, and thirty seconds is a
 * long time for an officer whose authority has just been withdrawn to keep
 * exercising it. Ending their sessions makes it immediate: they are signed out,
 * which is a visible and correct consequence of having their authority reduced,
 * and their next sign-in reads the map fresh.
 */
export async function revoke(
  actor: Actor,
  input: { role: string; permission: string; reason: string },
): Promise<{ sessionsEnded: number }> {
  const ended = await withTransaction(async (client) => {
    const role = await loadRole(client, input.role);
    const removed = await queryOne<{ permission: string }>(
      client,
      'DELETE FROM role_permissions WHERE role = $1 AND permission = $2 RETURNING permission',
      [input.role, input.permission],
    );
    if (!removed) {
      throw notFound(`${role.label}'s ${input.permission} grant`);
    }

    /*
     * Counted from what this statement revoked, not from a clock.
     *
     * `RETURNING 1` through `queryOne` reads the first row and discards the
     * rest, so the count had to come from somewhere; it came from a second
     * query asking how many sessions for this role were revoked in the last
     * five seconds. That is wrong in both directions. It counts sign-outs
     * this revocation had nothing to do with — an officer closing their
     * browser, a second administrator withdrawing a different permission —
     * and, because `now()` is transaction *start* time, the window is
     * measured from before this transaction did any work: a slow commit puts
     * its own sessions outside the window and the count reads zero.
     *
     * Zero is the damaging one. The screen announces the sign-out only when
     * the number is non-zero, so an administrator who has just signed out
     * forty officers would be told "Saved" and nothing else. A number that
     * can silently read zero is worse than no number.
     */
    const sessions = await query<{ id: string }>(
      client,
      `UPDATE sessions s
          SET revoked_at = now(), revoked_reason = $2
         FROM users u
        WHERE u.id = s.user_id AND u.role = $1 AND s.revoked_at IS NULL
        RETURNING s.id`,
      [input.role, `${input.permission} withdrawn from ${input.role}`],
    );

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'rbac.revoke',
      entityType: 'role',
      entityId: input.role,
      oldValue: { permission: input.permission },
      reason: input.reason.trim(),
    });

    return sessions.length;
  });

  forget();

  return { sessionsEnded: ended };
}

export async function createRole(
  actor: Actor,
  input: {
    name: string;
    label: string;
    labelHa?: string | null;
    description?: string | null;
    isPortal: boolean;
    copyFrom?: string | null;
  },
): Promise<{ name: string; permissions: number }> {
  const name = input.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (name.length < 3) {
    throw badRequest('A role name needs at least three characters.');
  }

  return withTransaction(async (client) => {
    const clash = await queryOne(client, 'SELECT 1 FROM roles WHERE name = $1', [name]);
    if (clash) throw conflict('ROLE_EXISTS', `A role called ${name} already exists.`);

    await client.query(
      `INSERT INTO roles (name, label, label_ha, description, is_portal, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        name,
        input.label.trim(),
        input.labelHa?.trim() || null,
        input.description?.trim() || null,
        input.isPortal,
        actor.userId,
      ],
    );

    /*
     * Copying an existing role's grants is offered because starting from
     * nothing is how a new role gets created and then quietly given everything
     * a week later, one emergency at a time. Starting from the nearest existing
     * role and taking things away is the safer habit, and this makes it the
     * easy one.
     */
    let copied = 0;
    if (input.copyFrom) {
      const source = await loadRole(client, input.copyFrom);
      const result = await client.query(
        `INSERT INTO role_permissions (role, permission, granted_by, reason)
         SELECT $1, permission, $2, $3 FROM role_permissions WHERE role = $4`,
        [name, actor.userId, `Copied from ${source.name} at creation`, input.copyFrom],
      );
      copied = result.rowCount ?? 0;
    }

    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'rbac.role.create',
      entityType: 'role',
      entityId: name,
      newValue: { label: input.label, isPortal: input.isPortal, copiedFrom: input.copyFrom ?? null },
    });

    forget();
    return { name, permissions: copied };
  });
}

/*
 * And back again.
 *
 * Retirement is now enforced on the row — migration 060 refuses to assign a
 * retired role — which turns a mis-click into a role nobody can be put into
 * and no endpoint can undo. That is a worse failure than the one retirement
 * guards against, so the way back exists and is audited like the way out.
 */
export async function restoreRole(actor: Actor, roleName: string, reason: string): Promise<void> {
  await withTransaction(async (client) => {
    const role = await loadRole(client, roleName);
    if (role.status !== 'RETIRED') {
      throw conflict('ROLE_NOT_RETIRED', `The ${role.label} role is already in use.`);
    }

    await client.query(
      `UPDATE roles SET status = 'ACTIVE', updated_at = now() WHERE name = $1`,
      [roleName],
    );
    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'rbac.role.restore',
      entityType: 'role',
      entityId: roleName,
      oldValue: { status: 'RETIRED' },
      newValue: { status: 'ACTIVE' },
      reason,
    });
  });
  forget();
}

export async function retireRole(actor: Actor, roleName: string, reason: string): Promise<void> {
  await withTransaction(async (client) => {
    const role = await loadRole(client, roleName);
    if (role.is_system) {
      throw badRequest(`The ${role.name} role ships with the platform and cannot be retired.`);
    }
    const holders = await queryOne<{ count: string }>(
      client,
      `SELECT count(*)::text FROM users WHERE role = $1 AND status = 'ACTIVE'`,
      [roleName],
    );
    if (Number(holders!.count) > 0) {
      throw conflict(
        'ROLE_IN_USE',
        `${holders!.count} officer(s) still hold the ${role.label} role.`,
        'Move them to another role first.',
      );
    }

    await client.query(
      `UPDATE roles SET status = 'RETIRED', updated_at = now() WHERE name = $1`,
      [roleName],
    );
    await recordAudit(client, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'rbac.role.retire',
      entityType: 'role',
      entityId: roleName,
      oldValue: { status: 'ACTIVE' },
      newValue: { status: 'RETIRED' },
      reason,
    });
  });
  forget();
}

/**
 * A grant naming a permission nothing checks is worse than no grant at all.
 *
 * It appears in the administrator's list, it reads like an authority, and no
 * route consults it — so somebody believes an officer can do something they
 * cannot, or cannot do something they can. The catalogue in `rbac.ts` is what
 * exists.
 */
function assertRealPermission(permission: string): void {
  if (!(PERMISSIONS as readonly string[]).includes(permission)) {
    throw badRequest(
      `${permission} is not a permission this platform checks anywhere.`,
    );
  }
}

async function loadRole(
  db: Db,
  name: string,
): Promise<{ name: string; label: string; is_system: boolean; status: string }> {
  const row = await queryOne<{
    name: string;
    label: string;
    is_system: boolean;
    status: string;
  }>(db, 'SELECT name, label, is_system, status FROM roles WHERE name = $1 FOR UPDATE', [name]);
  if (!row) throw notFound('That role');
  return row;
}

export type { Permission };
