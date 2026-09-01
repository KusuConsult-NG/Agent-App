/**
 * Handing out something there is a finite amount of.
 *
 * An incentive programme decides who *qualifies*. That is enough for health
 * cover or a bursary, where qualifying and receiving are the same event. It is
 * not enough for fertiliser, seed or tractor days: a hundred bags is a hundred
 * bags, and the interesting questions are how many are left, who has already
 * taken theirs, and whether what left the store matches what reached people.
 *
 * So a round holds a quantity and each award is a claim against it. Two rules
 * live in the database rather than here, deliberately:
 *
 *   - UNIQUE (round_id, taxpayer_id). Collecting twice is the obvious fraud,
 *     and the constraint refuses it whichever code path is running.
 *   - A trigger refusing awards beyond the round's total. Two officers issuing
 *     at the same moment cannot between them promise fertiliser that is not
 *     there.
 *
 * Application checks would be enough right up until the day they were not.
 */

import type { Db } from '../db/pool';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound } from '../lib/errors';
import { generateVerificationCode, normaliseVerificationCode } from '../lib/crypto';
import { recordAudit } from './audit';
import { evaluateEligibility } from './incentives';

export interface RoundInput {
  programmeId: string;
  name: string;
  unit: string;
  totalQuantity: number;
  quantityPerBeneficiary: number;
  collectionPoint?: string | null;
  opensAt: string;
  closesAt?: string | null;
}

export async function createRound(params: {
  input: RoundInput;
  actorId: string;
  actorRole: string;
}): Promise<{ roundId: string }> {
  return withTransaction(async (client) => {
    const programme = await queryOne<{ id: string; status: string; benefit_type: string }>(
      client,
      'SELECT id, status, benefit_type FROM incentive_programmes WHERE id = $1',
      [params.input.programmeId],
    );
    if (!programme) throw notFound('That programme');

    /*
     * The status was already being selected here, and read by nothing.
     *
     * Eligibility refuses every award whose programme is not ACTIVE, so a round
     * built on a draft or closed programme is not merely untidy: it can be
     * created, opened, stocked and staffed, and then every farmer who reaches
     * the front of the queue is turned away. The check belongs at the point
     * where the mistake is cheap to correct.
     */
    if (programme.status !== 'ACTIVE') {
      throw conflict(
        'PROGRAMME_NOT_ACTIVE',
        `That programme is ${programme.status.toLowerCase()}, so no award from this round could be made.`,
        'Activate the programme first, then create the round.',
      );
    }

    const round = await queryOne<{ id: string }>(
      client,
      `INSERT INTO incentive_allocation_rounds
         (programme_id, name, unit, total_quantity, quantity_per_beneficiary,
          collection_point, opens_at, closes_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        params.input.programmeId,
        params.input.name,
        params.input.unit,
        params.input.totalQuantity,
        params.input.quantityPerBeneficiary,
        params.input.collectionPoint ?? null,
        params.input.opensAt,
        params.input.closesAt ?? null,
        params.actorId,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'allocation.round_created',
      entityType: 'allocation_round',
      entityId: round!.id,
      newValue: {
        programmeId: params.input.programmeId,
        unit: params.input.unit,
        totalQuantity: params.input.totalQuantity,
      },
    });

    return { roundId: round!.id };
  });
}

export async function setRoundStatus(params: {
  roundId: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  actorId: string;
  actorRole: string;
}): Promise<{ status: string }> {
  return withTransaction(async (client) => {
    const round = await queryOne<{ id: string; status: string }>(
      client,
      'SELECT id, status FROM incentive_allocation_rounds WHERE id = $1 FOR UPDATE',
      [params.roundId],
    );
    if (!round) throw notFound('That allocation round');

    // A closed round stays closed. Reopening one after awards were made would
    // let a distribution be topped up without a new decision on the record.
    if (round.status === 'CLOSED' && params.status !== 'CLOSED') {
      throw conflict(
        'ROUND_CLOSED',
        'A closed allocation round cannot be reopened. Create a new round instead.',
      );
    }

    await client.query('UPDATE incentive_allocation_rounds SET status = $2 WHERE id = $1', [
      params.roundId,
      params.status,
    ]);

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'allocation.round_status_changed',
      entityType: 'allocation_round',
      entityId: params.roundId,
      oldValue: { status: round.status },
      newValue: { status: params.status },
    });

    return { status: params.status };
  });
}

/**
 * Award one beneficiary their share.
 *
 * Eligibility is re-evaluated here rather than trusted from a list prepared
 * earlier: between drawing up a list and handing out the fertiliser, a farmer
 * may have fallen into arrears, and the programme's own rules are the only
 * honest answer to whether they still qualify.
 */
export async function awardTo(params: {
  roundId: string;
  taxpayerId: string;
  actorId: string;
  actorRole: string;
}): Promise<{ awardId: string; collectionCode: string; quantity: string; unit: string }> {
  const round = await queryOne<{
    id: string;
    programme_id: string;
    status: string;
    unit: string;
    quantity_per_beneficiary: string;
  }>(
    pool,
    `SELECT id, programme_id, status, unit, quantity_per_beneficiary
       FROM incentive_allocation_rounds WHERE id = $1`,
    [params.roundId],
  );
  if (!round) throw notFound('That allocation round');

  // Outside the transaction: evaluation reads widely and takes its own
  // connection, and holding the round lock across it would serialise a
  // distribution queue behind one slow compliance calculation.
  const evaluation = await evaluateEligibility({
    programmeId: round.programme_id,
    taxpayerId: params.taxpayerId,
  });
  if (!evaluation.eligible) {
    throw conflict(
      'NOT_ELIGIBLE',
      `This taxpayer does not qualify: ${evaluation.reasons.join('; ')}`,
      'Check the programme rules, or record why an exception was made.',
    );
  }

  return withTransaction(async (client) => {
    const group = await queryOne<{ group_id: string }>(
      client,
      `SELECT g.id AS group_id
         FROM taxpayer_group_members m
         JOIN taxpayer_groups g ON g.id = m.group_id
        WHERE m.taxpayer_id = $1 AND m.status = 'ATTESTED' AND g.status = 'ACTIVE'
        LIMIT 1`,
      [params.taxpayerId],
    );

    const collectionCode = generateVerificationCode();
    let award: { id: string } | null;
    try {
      award = await queryOne<{ id: string }>(
        client,
        `INSERT INTO incentive_awards
           (round_id, taxpayer_id, group_id, quantity, collection_code,
            compliance_score, awarded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [
          params.roundId,
          params.taxpayerId,
          group?.group_id ?? null,
          round.quantity_per_beneficiary,
          collectionCode,
          evaluation.score,
          params.actorId,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // The two database rules, translated into something an officer standing
      // at a distribution point can act on.
      if (/incentive_awards_round_id_taxpayer_id_key/.test(message)) {
        throw conflict(
          'ALREADY_AWARDED',
          'This taxpayer has already been awarded in this round.',
          'Check the award list — they may have collected already.',
        );
      }
      if (/remaining|can only be made while/.test(message)) {
        throw conflict('ROUND_EXHAUSTED', message);
      }
      throw error;
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'allocation.awarded',
      entityType: 'allocation_award',
      entityId: award!.id,
      newValue: {
        roundId: params.roundId,
        taxpayerId: params.taxpayerId,
        quantity: round.quantity_per_beneficiary,
        unit: round.unit,
        complianceScore: evaluation.score,
      },
    });

    return {
      awardId: award!.id,
      collectionCode,
      quantity: round.quantity_per_beneficiary,
      unit: round.unit,
    };
  });
}

/** Mark an award collected, against the code the beneficiary presents. */
export async function recordCollection(params: {
  collectionCode: string;
  actorId: string;
  actorRole: string;
}): Promise<{ awardId: string; taxpayerName: string; quantity: string; unit: string }> {
  return withTransaction(async (client) => {
    const award = await queryOne<{
      id: string;
      status: string;
      quantity: string;
      unit: string;
      taxpayer_name: string;
    }>(
      client,
      `SELECT a.id, a.status, a.quantity, r.unit,
              COALESCE(t.business_name, t.first_name || ' ' || COALESCE(t.last_name,'')) AS taxpayer_name
         FROM incentive_awards a
         JOIN incentive_allocation_rounds r ON r.id = a.round_id
         JOIN taxpayers t ON t.id = a.taxpayer_id
        WHERE replace(upper(a.collection_code), '-', '') = $1
        FOR UPDATE OF a`,
      // Upper-casing alone left the separator significant, so a farmer who
      // wrote their code down without the dash was told there was no such
      // code. Every other code in the platform is matched this way.
      [normaliseVerificationCode(params.collectionCode)],
    );
    if (!award) throw notFound('That collection code');

    if (award.status === 'COLLECTED') {
      throw conflict(
        'ALREADY_COLLECTED',
        'This allocation has already been collected.',
        'The code can only be used once.',
      );
    }
    if (award.status === 'FORFEITED') {
      throw conflict('AWARD_FORFEITED', 'This allocation was forfeited and cannot be collected.');
    }

    await client.query(
      `UPDATE incentive_awards
          SET status = 'COLLECTED', collected_at = now(), collected_by = $2
        WHERE id = $1`,
      [award.id, params.actorId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'allocation.collected',
      entityType: 'allocation_award',
      entityId: award.id,
      oldValue: { status: award.status },
      newValue: { status: 'COLLECTED' },
    });

    return {
      awardId: award.id,
      taxpayerName: award.taxpayer_name,
      quantity: award.quantity,
      unit: award.unit,
    };
  });
}

/**
 * Release a share that was awarded and never collected.
 *
 * FORFEITED was a status `recordCollection` refuses to hand goods against, the
 * round-quantity trigger excludes from its running total, both summary queries
 * filter on, and the awards route offers as a filter. Five places accounted for
 * it and nothing produced it — so a farmer who never came for their two bags
 * held them out of the round for good, the store showed fewer bags than it
 * contained, and the next farmer in the queue could not be given them.
 *
 * A reason is required because this is public property being reassigned, and
 * the round's own arithmetic changes as a result. Only an award that has not
 * been collected can be released; once the bags have left the store there is
 * nothing to return to the pool.
 */
export async function forfeitAward(params: {
  awardId: string;
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<{ awardId: string; quantity: string; unit: string; returnedToRound: boolean }> {
  return withTransaction(async (client) => {
    const award = await queryOne<{
      id: string;
      status: string;
      quantity: string;
      unit: string;
      round_id: string;
    }>(
      client,
      `SELECT a.id, a.status, a.quantity, r.unit, a.round_id
         FROM incentive_awards a
         JOIN incentive_allocation_rounds r ON r.id = a.round_id
        WHERE a.id = $1
        FOR UPDATE OF a`,
      [params.awardId],
    );
    if (!award) throw notFound('That award');

    if (award.status === 'COLLECTED') {
      throw conflict(
        'ALREADY_COLLECTED',
        'This allocation has already been collected and cannot be forfeited.',
        'The goods have left the store; there is nothing to return to the round.',
      );
    }
    if (award.status === 'FORFEITED') {
      throw conflict('ALREADY_FORFEITED', 'This allocation has already been forfeited.');
    }

    await client.query(
      `UPDATE incentive_awards
          SET status = 'FORFEITED', forfeited_reason = $2
        WHERE id = $1`,
      [award.id, params.reason],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'allocation.forfeited',
      entityType: 'allocation_award',
      entityId: award.id,
      oldValue: { status: award.status },
      newValue: { status: 'FORFEITED', reason: params.reason, quantity: award.quantity },
    });

    return {
      awardId: award.id,
      quantity: award.quantity,
      unit: award.unit,
      returnedToRound: true,
    };
  });
}

/**
 * What is left, and what has actually reached people.
 *
 * `awarded` against `collected` is the reconciliation that matters for a
 * physical benefit: a large gap means fertiliser was promised and never picked
 * up, which is either a distribution problem or a list of people who do not
 * exist.
 */
export async function roundSummary(db: Db, roundId: string) {
  const round = await queryOne<{
    id: string;
    name: string;
    unit: string;
    total_quantity: string;
    quantity_per_beneficiary: string;
    status: string;
    collection_point: string | null;
  }>(
    db,
    `SELECT id, name, unit, total_quantity, quantity_per_beneficiary, status, collection_point
       FROM incentive_allocation_rounds WHERE id = $1`,
    [roundId],
  );
  if (!round) throw notFound('That allocation round');

  const totals = await queryOne<{
    awarded_count: string;
    awarded_quantity: string;
    collected_count: string;
    collected_quantity: string;
  }>(
    db,
    `SELECT
       count(*) FILTER (WHERE status <> 'FORFEITED')::text            AS awarded_count,
       COALESCE(SUM(quantity) FILTER (WHERE status <> 'FORFEITED'),0)::text AS awarded_quantity,
       count(*) FILTER (WHERE status = 'COLLECTED')::text             AS collected_count,
       COALESCE(SUM(quantity) FILTER (WHERE status = 'COLLECTED'),0)::text  AS collected_quantity
     FROM incentive_awards WHERE round_id = $1`,
    [roundId],
  );

  const remaining = Number(round.total_quantity) - Number(totals!.awarded_quantity);

  return {
    ...round,
    awardedCount: Number(totals!.awarded_count),
    awardedQuantity: totals!.awarded_quantity,
    collectedCount: Number(totals!.collected_count),
    collectedQuantity: totals!.collected_quantity,
    remainingQuantity: remaining.toFixed(2),
    beneficiariesRemaining: Math.floor(remaining / Number(round.quantity_per_beneficiary)),
  };
}

/**
 * The rounds under a programme, with what is left in each.
 *
 * Exists because a round had no way in. It could be created and awarded
 * against through the API, and the screen that shows it could only be reached
 * by typing its id into the address bar — which is the same "built but
 * unreachable" fault this codebase keeps turning up, committed fresh.
 */
export async function listRounds(db: Db, options: { programmeId?: string; limit?: number } = {}) {
  return query(
    db,
    `SELECT r.id, r.name, r.unit, r.total_quantity, r.quantity_per_beneficiary,
            r.status, r.collection_point, r.opens_at, r.closes_at,
            p.name AS programme_name, p.name_ha AS programme_name_ha,
            COALESCE(SUM(a.quantity) FILTER (WHERE a.status <> 'FORFEITED'), 0)::text AS awarded_quantity,
            count(a.id) FILTER (WHERE a.status = 'COLLECTED')::text AS collected_count,
            count(a.id) FILTER (WHERE a.status <> 'FORFEITED')::text AS awarded_count
       FROM incentive_allocation_rounds r
       JOIN incentive_programmes p ON p.id = r.programme_id
       LEFT JOIN incentive_awards a ON a.round_id = r.id
      WHERE ($1::uuid IS NULL OR r.programme_id = $1)
      GROUP BY r.id, p.name, p.name_ha
      ORDER BY r.created_at DESC
      LIMIT $2`,
    [options.programmeId ?? null, options.limit ?? 100],
  );
}

export async function listAwards(
  db: Db,
  roundId: string,
  options: { status?: string; limit?: number } = {},
) {
  return query(
    db,
    `SELECT a.id, a.status, a.quantity, a.collection_code, a.compliance_score,
            a.awarded_at, a.collected_at,
            COALESCE(t.business_name, t.first_name || ' ' || COALESCE(t.last_name,'')) AS taxpayer_name,
            t.tin, g.name AS group_name
       FROM incentive_awards a
       JOIN taxpayers t ON t.id = a.taxpayer_id
       LEFT JOIN taxpayer_groups g ON g.id = a.group_id
      WHERE a.round_id = $1
        AND ($2::text IS NULL OR a.status = $2)
      ORDER BY a.awarded_at DESC
      LIMIT $3`,
    [roundId, options.status ?? null, options.limit ?? 200],
  );
}
