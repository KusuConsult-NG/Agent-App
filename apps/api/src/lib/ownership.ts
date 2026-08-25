/**
 * Row-level scope for the `:own` permissions (PRD §36).
 *
 * `requirePermission` answers one question — does this *role* hold the
 * permission — and nothing else. It cannot look at a row, so a route guarded
 * by `requirePermission('receipt:read:own', 'receipt:read:all')` admits an
 * agent and an officer alike and then has to do the narrowing itself.
 *
 * Six routes did not. A permission named `:own` scoped nothing on any of them,
 * so any active agent could read any transaction, assessment, receipt or
 * document by id — another agent's taxpayer, their name, TIN, amounts and
 * computation trace — and, on `GET /documents/:id`, receive a working download
 * URL for the PDF. Proven with two agents before it was fixed.
 *
 * That contradicts the platform's own posture elsewhere: it logs every read of
 * a citizen's identity papers so a data-protection enquiry can be answered,
 * while these routes handed out the same citizen's tax affairs to anybody
 * holding an agent account.
 *
 * The narrowing lives here rather than being written out at each call site,
 * because six hand-rolled versions is how five of them end up subtly different
 * and one ends up missing.
 */

import type { Permission } from '@psirs/shared';
import type { RouteRequest } from '../middleware/validate';
import { notFound } from './errors';

/**
 * The agent this request is acting as, if any.
 *
 * Taken from the device-bound agent context when there is one, and otherwise
 * from the session. An officer has neither and is handled by the wider
 * permission instead.
 */
export function callerAgentId(req: RouteRequest): string | null {
  return req.agent?.agentId ?? req.auth?.agentId ?? null;
}

/** Does this caller hold the unrestricted form of the permission? */
export function seesEverything(req: RouteRequest, all: Permission): boolean {
  return req.auth?.permissions.includes(all) ?? false;
}

/**
 * Refuse a row that is not this caller's.
 *
 * `ownerAgentId` is whichever agent the record belongs to — the one who
 * collected it, raised it or was issued it. A caller holding `all` passes
 * untouched.
 *
 * The refusal is `notFound`, never `forbidden`. Whether a given transaction,
 * receipt or document exists is itself something the taxpayer it belongs to is
 * entitled to keep, and a 403 confirms existence to anyone who guesses an id.
 */
export function assertOwnRecord(
  req: RouteRequest,
  all: Permission,
  ownerAgentId: string | null,
  what: string,
): void {
  if (seesEverything(req, all)) return;

  const agentId = callerAgentId(req);
  if (!agentId || ownerAgentId !== agentId) throw notFound(what);
}

/**
 * The user this request is acting as.
 *
 * Distinct from `callerAgentId` because not every ownership column names an
 * agent. `taxpayer_groups.registered_by` names the *user* who recorded the
 * group, which is right — an officer can register one too, and there is no
 * agent row to point at when they do.
 */
export function callerUserId(req: RouteRequest): string | null {
  return req.auth?.userId ?? null;
}

/**
 * Refuse a row recorded by somebody else.
 *
 * The same narrowing as `assertOwnRecord`, against a column that holds a user
 * id rather than an agent id. `notFound` for the same reason: a 403 confirms
 * to anyone who guesses an id that the record is there.
 */
export function assertOwnUserRecord(
  req: RouteRequest,
  all: Permission,
  ownerUserId: string | null,
  what: string,
): void {
  if (seesEverything(req, all)) return;

  const userId = callerUserId(req);
  if (!userId || ownerUserId !== userId) throw notFound(what);
}
