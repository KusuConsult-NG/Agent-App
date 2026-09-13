/**
 * How much of the state a given officer's reports may cover.
 *
 * `report:read:territory` had been in the RBAC table from the beginning, held
 * only by supervisors, and it narrowed nothing. It appeared twice, both times
 * as an alternative to `report:read:all` in a permission guard — so wherever
 * it was accepted at all, the caller received the whole state. The word
 * "territory" in its name was the only scoping the platform did.
 *
 * It could not have been otherwise: `users` carried no territory, so no fact
 * in the database said which territory a supervisor supervises. Migration 023
 * adds `user_territories`; this module turns it into a filter.
 *
 * THE FAIL-CLOSED RULE. A supervisor with no assignment has an empty scope,
 * and an empty scope matches nothing. The tempting reading — "no filter, so
 * show everything" — is what the platform did, and it means an account nobody
 * has finished configuring is the most privileged account in the system
 * rather than the least. `territory-scoped-reporting.test.ts` holds this
 * directly, because it is the property most likely to be undone by someone
 * fixing an "empty dashboard" bug report.
 */

import type { Permission } from '@psirs/shared';
import type { Db } from '../db/pool';
import { query } from '../db/pool';

export type ReportScope =
  /** Everything. Held by report:read:all. */
  | { kind: 'STATEWIDE' }
  /**
   * Only these territories, and only the LGAs they sit in. `territories` may
   * be empty, and an empty list is a real answer meaning "nothing", not a
   * missing one meaning "unfiltered".
   */
  | {
      kind: 'TERRITORIES';
      territories: { id: string; name: string; nameHa: string | null; code: string; lgaId: string }[];
    };

export interface ScopeHolder {
  userId: string;
  permissions: readonly Permission[];
}

export async function resolveReportScope(db: Db, auth: ScopeHolder): Promise<ReportScope> {
  if (auth.permissions.includes('report:read:all')) return { kind: 'STATEWIDE' };

  const rows = await query<{ id: string; name: string; name_ha: string | null; code: string; lga_id: string }>(
    db,
    `SELECT t.id, t.name, t.name_ha, t.code, t.lga_id
       FROM user_territories ut
       JOIN territories t ON t.id = ut.territory_id
      WHERE ut.user_id = $1 AND t.status = 'ACTIVE'
      ORDER BY t.name`,
    [auth.userId],
  );

  return {
    kind: 'TERRITORIES',
    territories: rows.map((row) => ({
      id: row.id,
      name: row.name,
      nameHa: row.name_ha,
      code: row.code,
      lgaId: row.lga_id,
    })),
  };
}

/**
 * The scope as two SQL parameters.
 *
 * Every scoped query takes the same pair — a boolean saying "everything" and
 * an array of ids — so the predicate reads identically wherever it appears and
 * an author cannot accidentally write a filter that is right in one report and
 * absent in the next. Arrays are bound as parameters rather than interpolated.
 */
export interface ScopeParams {
  statewide: boolean;
  territoryIds: string[];
  lgaIds: string[];
}

export function scopeParams(scope: ReportScope): ScopeParams {
  if (scope.kind === 'STATEWIDE') {
    return { statewide: true, territoryIds: [], lgaIds: [] };
  }
  return {
    statewide: false,
    territoryIds: scope.territories.map((t) => t.id),
    lgaIds: [...new Set(scope.territories.map((t) => t.lgaId))],
  };
}

/**
 * The predicate for a transactions alias, as text.
 *
 * Both parameter positions are named explicitly rather than assumed adjacent.
 * They were adjacent in every query but one — the state-level geography
 * query, which needs the flag, the territory ids and the LGA ids, so the LGA
 * array cannot sit next to the flag. An "assume $n+1" helper silently bound
 * the territory ids where the LGA ids belonged there, and postgres only caught
 * it because the argument counts happened to disagree. Passing both indices
 * makes the mistake unwritable.
 *
 * A transaction with a NULL territory is outside every territory scope —
 * deliberately: an unattributed collection is not evidence for any
 * supervisor's figures, and counting it in all of them would be worse than
 * counting it in none.
 */
export function transactionScopeSql(alias: string, flagIndex: number, idsIndex: number): string {
  return `($${flagIndex} OR ${alias}.territory_id = ANY($${idsIndex}::uuid[]))`;
}

/** The same, for a query grouped by LGA rather than by transaction. */
export function lgaScopeSql(alias: string, flagIndex: number, idsIndex: number): string {
  return `($${flagIndex} OR ${alias}.id = ANY($${idsIndex}::uuid[]))`;
}

/**
 * Which territories an officer is assigned, for an administrator's screen.
 *
 * Separate from `resolveReportScope` on purpose: that one answers "what may
 * this caller see", which for a statewide role is everything and involves no
 * assignments at all. This answers "what is assigned to this officer", which
 * is a different question with a different answer for the same person.
 */
export async function territoriesForOfficer(db: Db, userId: string) {
  return query<{ id: string; name: string; name_ha: string | null; code: string; lga_name: string }>(
    db,
    `SELECT t.id, t.name, t.name_ha, t.code, l.name AS lga_name
       FROM user_territories ut
       JOIN territories t ON t.id = ut.territory_id
       JOIN lgas l ON l.id = t.lga_id
      WHERE ut.user_id = $1
      ORDER BY t.name`,
    [userId],
  );
}

/**
 * How much of the *register* a caller may see, which is not the same question.
 *
 * `resolveReportScope` above answers "whose money may this officer count".
 * This answers "whose personal record may they reach", and the two are
 * deliberately separate: `report:read:all` is a reporting grant and must never
 * widen access to citizens' names, TINs and telephone numbers by inheritance.
 * So this reads the taxpayer permission and the assignments directly rather
 * than delegating.
 *
 * `source` matters as much as the scope. A supervisor and a field agent can
 * both end up scoped to one Local Government Area, and they are not owed the
 * same thing inside it: listing everybody assessed under a levy is a
 * supervisor's job and is the material an unofficial collection is made from
 * if an agent holds it. The caller decides using `source`; this only reports
 * where the boundary came from.
 */
export type TaxpayerReach = {
  scope: ReportScope;
  /**
   * ALL — `taxpayer:read:all`, the whole register.
   * OFFICER — an officer's assigned territories. May be empty, which is a real
   *   answer meaning the account has not been finished.
   * AGENT — the one territory a collecting agent works. The schema refuses to
   *   activate an agent without one.
   */
  source: 'ALL' | 'OFFICER' | 'AGENT';
};

export async function resolveTaxpayerReach(db: Db, auth: ScopeHolder & { userId: string }): Promise<TaxpayerReach> {
  if (auth.permissions.includes('taxpayer:read:all')) {
    return { scope: { kind: 'STATEWIDE' }, source: 'ALL' };
  }

  /*
   * Whether this is an agent is asked first, and asked of the agent record
   * rather than of the territory. An agent whose territory has been withdrawn
   * is still an agent, and answering OFFICER for them would offer them the
   * register of any territory somebody later assigned to their user account.
   */
  const agent = await query<{ id: string; name: string; name_ha: string | null; code: string; lga_id: string }>(
    db,
    `SELECT t.id, t.name, t.name_ha, t.code, t.lga_id
       FROM agents a
       LEFT JOIN territories t ON t.id = a.territory_id AND t.status = 'ACTIVE'
      WHERE a.user_id = $1`,
    [auth.userId],
  );
  if (agent.length > 0) {
    // LEFT JOIN, so an agent with no live territory yields a row of nulls,
    // which is an empty scope and reaches nobody. That is the right answer:
    // they cannot collect in that state either.
    return { scope: territoriesScope(agent.filter((row) => row.id !== null)), source: 'AGENT' };
  }

  /*
   * Otherwise an officer, and their reach is what has been assigned to them —
   * which may be nothing. Reaching nobody is the fail-closed answer, and the
   * caller is expected to say which failure it is rather than return an empty
   * list: "no record matches" and "your account has no territory" are
   * different facts, and only one of them is about the person searched for.
   */
  const officer = await query<{ id: string; name: string; name_ha: string | null; code: string; lga_id: string }>(
    db,
    `SELECT t.id, t.name, t.name_ha, t.code, t.lga_id
       FROM user_territories ut
       JOIN territories t ON t.id = ut.territory_id
      WHERE ut.user_id = $1 AND t.status = 'ACTIVE'
      ORDER BY t.name`,
    [auth.userId],
  );
  return { scope: territoriesScope(officer), source: 'OFFICER' };
}

function territoriesScope(
  rows: { id: string; name: string; name_ha: string | null; code: string; lga_id: string }[],
): ReportScope {
  return {
    kind: 'TERRITORIES',
    territories: rows.map((row) => ({
      id: row.id,
      name: row.name,
      nameHa: row.name_ha,
      code: row.code,
      lgaId: row.lga_id,
    })),
  };
}
