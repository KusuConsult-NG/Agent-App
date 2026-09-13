/**
 * The presumptive schedule: what an operator is assumed to turn over, and what
 * that makes them owe.
 *
 * Phase 4 of the informal-sector programme. Its acceptance criterion is not a
 * passing test — it is whether PSIRS can stand in a room full of traders and
 * defend the table. Everything here is shaped by that: published figures
 * rather than a scoring model, an arithmetic anybody can repeat, and a reason
 * a tailor in Wase pays less than the same tailor in Jos North that does not
 * require anyone to believe in an official's goodwill.
 *
 * THE INVARIANT THAT DECIDES WHETHER THIS IS A TAX OR A NEGOTIATION.
 *
 * The agent records observations. The server computes the band. An agent
 * enters premises type, machine count, staff count — facts a person can see
 * standing in the doorway and a supervisor can re-check tomorrow. The agent
 * never enters a turnover figure and never selects a band. This is the same
 * rule the payment path applies to a caller-supplied `status: VERIFIED`, and
 * the same one Phase 3 applies to PAYE: the moment the number is typeable, it
 * is negotiable, and a negotiable presumptive tax is a licence for whoever
 * holds the handset.
 *
 * WHY LGA RELIEF IS AN ASSUMED TURNOVER AND NOT A DISCOUNT.
 *
 * A discount on a statutory rate needs a power to grant it, invites every
 * other LGA to ask for one, and is the first thing an auditor asks about.
 * Nothing here discounts anything: the rate is 1% everywhere, and what differs
 * is the assumed turnover, because turnover in Wase genuinely is lower than in
 * Jos North. The schedule says so, the arithmetic follows, and no officer
 * exercised any discretion at any point. That is what makes it lawful, and it
 * is why the classification has to be exogenous and fixed for three years —
 * both enforced in migration 057 rather than here.
 *
 * WHAT THIS FILE WILL NOT DO.
 *
 * It will not compute a tier without a nano policy in force. The Act's
 * exemption has two defensible readings and the difference between them is
 * whether a shop-based tailor turning over ₦3m pays anything at all; on some
 * estimates that is an order of magnitude of the covered population. That is a
 * question for counsel, and until it is answered and recorded this returns a
 * refusal rather than a guess. A default here would decide who in Plateau
 * State is taxed, quietly, in a file nobody reads.
 */

import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import type { Observations, SizeBand } from '@psirs/shared';
import { applyBasisPoints, bandFor } from '@psirs/shared';
import { recordAudit } from './audit';
import { badRequest, conflict, notFound } from '../lib/errors';

/**
 * One per cent of assumed turnover, per the presumptive regime.
 *
 * This is the rate the trace explains at a stall. The charge the taxpayer is
 * actually billed is computed by the rate engine from the catalogue, and
 * `assessFromObservation` refuses to issue an assessment where the two
 * disagree — because a notice that explains one figure and bills another is
 * the one thing this regime cannot survive being caught doing.
 */
const PRESUMPTIVE_BASIS_POINTS = 100;

export type LgaClass = 'A' | 'B' | 'C' | 'D';
export type TaxTier = 'NANO' | 'PRESUMPTIVE' | 'BOOKS';
export type NanoConstruction = 'CONJUNCTIVE' | 'TURNOVER_GOVERNED';

/*
 * The band rule and the facts it reads live in @psirs/shared, and are
 * re-exported here so this module still reads as the one place the
 * presumptive regime is described.
 *
 * They moved because the agent's handset runs them too: a trader standing at
 * their own stall asks what has been written about them, and an agent with no
 * signal could not answer. Two copies of a three-comparison rule would agree
 * on the day they were written and drift afterwards, and the drift would
 * reach a taxpayer as an agent saying "small" and a notice saying medium.
 */
export type { Observations, Premises, SizeBand } from '@psirs/shared';
export { bandFor, InvalidObservation } from '@psirs/shared';

export interface NanoPolicy {
  construction: NanoConstruction;
  turnoverCeilingKobo: string;
  legalBasis: string;
  effectiveFrom: Date;
}

/* -------------------------------------------------------------------------- */
/* The band                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which size band a set of observations falls in.
 *
 * Deliberately a small, readable rule rather than a scoring model. A trader
 * who is told "you are SMALL because you have a lock-up shop and two people
 * working" can disagree with a fact; one told "you scored 4.7" cannot disagree
 * with anything, and neither can the officer defending it.
 *
 * The premises floor comes first because premises is the observation hardest
 * to misrecord and hardest to move: a building is a building next week too.
 * Equipment and people can then lift a band but never lower it — somebody
 * operating out of a building with no equipment is not micro, they are between
 * stock.
 */
/* -------------------------------------------------------------------------- */
/* The nano test                                                              */
/* -------------------------------------------------------------------------- */

/** The policy in force on a date, or null when nobody has adopted one. */
export async function nanoPolicyInForce(db: Db, at: Date = new Date()): Promise<NanoPolicy | null> {
  const row = await queryOne<{
    construction: NanoConstruction;
    turnover_ceiling_kobo: string;
    legal_basis: string;
    effective_from: Date;
  }>(
    db,
    `SELECT construction, turnover_ceiling_kobo, legal_basis, effective_from
       FROM nano_exemption_policies
      WHERE effective_from <= $1
        AND (effective_to IS NULL OR effective_to > $1)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [at],
  );
  if (!row) return null;
  return {
    construction: row.construction,
    turnoverCeilingKobo: row.turnover_ceiling_kobo,
    legalBasis: row.legal_basis,
    effectiveFrom: row.effective_from,
  };
}

export interface TierDecision {
  tier: TaxTier;
  /** The construction that was applied, so the answer can be re-derived. */
  construction: NanoConstruction;
  legalBasis: string;
  /** Every limb, and whether it was met — the reasoning, not just the verdict. */
  reasons: { limb: string; met: boolean; detail: string }[];
}

/**
 * Whether this operator is exempt, under the construction PSIRS has adopted.
 *
 * Both readings are implemented because both are defensible and the choice is
 * not an engineering one. The reasons are returned alongside the verdict
 * because a person told they are not exempt is entitled to know which limb
 * caught them — and because under the conjunctive reading the limb that
 * catches almost everybody is "you have a shop", which is a thing PSIRS should
 * see it is doing rather than discover later.
 */
export function tierFor(
  policy: NanoPolicy,
  observations: Observations,
  assumedTurnoverKobo: bigint,
): TierDecision {
  const ceiling = BigInt(policy.turnoverCeilingKobo);
  const noPremises = observations.premises === 'NONE';
  const noEmployees = observations.peopleWorking === 0;
  const underCeiling = assumedTurnoverKobo <= ceiling;

  const reasons = [
    {
      limb: 'No fixed premises',
      met: noPremises,
      detail: `Premises recorded as ${observations.premises}`,
    },
    {
      limb: 'No employees',
      met: noEmployees,
      detail: `${observations.peopleWorking} person(s) working besides the operator`,
    },
    {
      limb: 'Turnover at or below the ceiling',
      met: underCeiling,
      detail: `Assumed turnover ${assumedTurnoverKobo} kobo against a ceiling of ${ceiling}`,
    },
  ];

  const exempt =
    policy.construction === 'CONJUNCTIVE'
      ? noPremises && noEmployees && underCeiling
      : underCeiling;

  return {
    tier: exempt ? 'NANO' : 'PRESUMPTIVE',
    construction: policy.construction,
    legalBasis: policy.legalBasis,
    reasons,
  };
}

/* -------------------------------------------------------------------------- */
/* The schedule                                                               */
/* -------------------------------------------------------------------------- */

export interface ScheduleEntry {
  id: string;
  economicSector: string;
  sizeBand: SizeBand;
  lgaClass: LgaClass;
  assumedAnnualTurnoverKobo: string;
  instrumentReference: string;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export async function lgaClassInForce(
  db: Db,
  lgaId: string,
  at: Date = new Date(),
): Promise<{ classCode: LgaClass; indexSource: string; effectiveFrom: Date } | null> {
  const row = await queryOne<{ class_code: LgaClass; index_source: string; effective_from: Date }>(
    db,
    `SELECT class_code, index_source, effective_from
       FROM lga_classes
      WHERE lga_id = $1
        AND effective_from <= $2
        AND (effective_to IS NULL OR effective_to > $2)
      LIMIT 1`,
    [lgaId, at],
  );
  return row
    ? { classCode: row.class_code, indexSource: row.index_source, effectiveFrom: row.effective_from }
    : null;
}

export async function scheduleEntry(
  db: Db,
  params: { economicSector: string; sizeBand: SizeBand; lgaClass: LgaClass; at?: Date },
): Promise<ScheduleEntry | null> {
  const at = params.at ?? new Date();
  const row = await queryOne<{
    id: string;
    economic_sector: string;
    size_band: SizeBand;
    lga_class: LgaClass;
    assumed_annual_turnover_kobo: string;
    instrument_reference: string;
    version: number;
    effective_from: Date;
    effective_to: Date | null;
  }>(
    db,
    `SELECT id, economic_sector, size_band, lga_class, assumed_annual_turnover_kobo,
            instrument_reference, version, effective_from, effective_to
       FROM presumptive_schedules
      WHERE economic_sector = $1 AND size_band = $2 AND lga_class = $3
        AND effective_from <= $4
        AND (effective_to IS NULL OR effective_to > $4)
      LIMIT 1`,
    [params.economicSector, params.sizeBand, params.lgaClass, at],
  );
  if (!row) return null;
  return {
    id: row.id,
    economicSector: row.economic_sector,
    sizeBand: row.size_band,
    lgaClass: row.lga_class,
    assumedAnnualTurnoverKobo: row.assumed_annual_turnover_kobo,
    instrumentReference: row.instrument_reference,
    version: row.version,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

/* -------------------------------------------------------------------------- */
/* The whole computation                                                      */
/* -------------------------------------------------------------------------- */

export interface PresumptiveComputation {
  tier: TaxTier;
  sizeBand: SizeBand;
  lgaClass: LgaClass;
  assumedAnnualTurnoverKobo: string;
  annualTaxKobo: string;
  monthlyTaxKobo: string;
  scheduleId: string;
  scheduleVersion: number;
  instrumentReference: string;
  nanoConstruction: NanoConstruction;
  /**
   * The arithmetic, step by step, in the order a person would explain it at a
   * stall. Carried on the result rather than reconstructed for a screen: a
   * figure whose derivation is rebuilt separately is a figure that will
   * eventually disagree with itself.
   */
  trace: { step: string; detail: string; amountKobo?: string }[];
}

/**
 * What this operator owes, and why — or a refusal that says what is missing.
 *
 * Refuses rather than guesses in three cases, each of which is somebody else's
 * decision and not a gap this file may paper over: no nano policy adopted, no
 * class published for the LGA, and no schedule row for the sector and band.
 * A platform that filled any of them in with a default would be setting tax
 * policy by omission.
 */
export async function computePresumptive(
  db: Db,
  params: {
    economicSector: string;
    lgaId: string;
    observations: Observations;
    at?: Date;
  },
): Promise<PresumptiveComputation> {
  const at = params.at ?? new Date();

  const policy = await nanoPolicyInForce(db, at);
  if (!policy) {
    throw conflict(
      'NANO_POLICY_NOT_ADOPTED',
      'No reading of the nano exemption has been adopted, so nobody can be assessed ' +
        'presumptively yet. Which construction applies decides who is exempt, and it is ' +
        'a question for counsel rather than a default this platform may pick.',
      'Record the adopted construction and its legal basis before assessing.',
    );
  }

  const lgaClass = await lgaClassInForce(db, params.lgaId, at);
  if (!lgaClass) {
    throw conflict(
      'LGA_NOT_CLASSIFIED',
      'This local government has no published class in force, so there is no schedule ' +
        'to read. Publish the classification first.',
    );
  }

  const band = bandFor(params.observations);
  const entry = await scheduleEntry(db, {
    economicSector: params.economicSector,
    sizeBand: band,
    lgaClass: lgaClass.classCode,
    at,
  });
  if (!entry) {
    throw conflict(
      'NO_PUBLISHED_SCHEDULE',
      `No published schedule covers ${params.economicSector} at band ${band} in a ` +
        `class ${lgaClass.classCode} area. Nothing can be assessed until one is adopted.`,
    );
  }

  const assumed = BigInt(entry.assumedAnnualTurnoverKobo);
  const decision = tierFor(policy, params.observations, assumed);

  /*
   * A nano operator owes nothing, and the computation says so explicitly
   * rather than returning a small number. Migration 057's tier column and the
   * plan's own invariant both turn on the difference between "exempt" and
   * "assessed at zero", and an officer looking at ₦0 cannot tell which they
   * are looking at.
   *
   * Anybody else's charge goes through the same primitive the rate engine
   * bills with, rather than a second expression that happens to mean the same
   * thing. It did not mean the same thing: `(assumed * 100n) / 10_000n`
   * truncates where `applyBasisPoints` rounds half up, so a schedule figure
   * that is not a whole naira — which the column permits, being a BIGINT of
   * kobo — put the recorded figure a kobo below the invoice. Measured at an
   * assumed turnover of 480,000,050 kobo: the trader was shown 4,800,000 and
   * billed 4,800,001.
   */
  const annualTax =
    decision.tier === 'NANO' ? 0n : applyBasisPoints(assumed, PRESUMPTIVE_BASIS_POINTS);
  const monthlyTax = annualTax / 12n;

  const trace: PresumptiveComputation['trace'] = [
    {
      step: 'What was observed',
      detail:
        `${params.observations.premises}, ${params.observations.equipmentCount} item(s) of ` +
        `equipment, ${params.observations.peopleWorking} person(s) working`,
    },
    {
      step: 'Size band',
      detail: `Those observations put this trade in band ${band}`,
    },
    {
      step: 'Where it is',
      detail:
        `${lgaClass.classCode} — published class for this local government, ` +
        `from ${lgaClass.effectiveFrom.toISOString().slice(0, 10)}, source: ${lgaClass.indexSource}`,
    },
    {
      step: 'Assumed annual turnover',
      detail: `From the published schedule (${entry.instrumentReference}, version ${entry.version})`,
      amountKobo: assumed.toString(),
    },
  ];

  if (decision.tier === 'NANO') {
    trace.push({
      step: 'Exempt',
      detail:
        `Nano business under the ${policy.construction === 'CONJUNCTIVE' ? 'conjunctive' : 'turnover'} ` +
        `reading of the exemption (${policy.legalBasis}). Nothing is payable.`,
      amountKobo: '0',
    });
  } else {
    trace.push(
      {
        step: 'Presumptive tax at 1%',
        detail: 'One per cent of the assumed annual turnover',
        amountKobo: annualTax.toString(),
      },
      {
        step: 'Payable monthly',
        detail: 'The annual figure divided over twelve months',
        amountKobo: monthlyTax.toString(),
      },
    );
  }

  return {
    tier: decision.tier,
    sizeBand: band,
    lgaClass: lgaClass.classCode,
    assumedAnnualTurnoverKobo: assumed.toString(),
    annualTaxKobo: annualTax.toString(),
    monthlyTaxKobo: monthlyTax.toString(),
    scheduleId: entry.id,
    scheduleVersion: entry.version,
    instrumentReference: entry.instrumentReference,
    nanoConstruction: policy.construction,
    trace,
  };
}

/* -------------------------------------------------------------------------- */
/* Publishing                                                                 */
/* -------------------------------------------------------------------------- */

export async function classifyLga(
  db: Db,
  params: {
    lgaId: string;
    classCode: LgaClass;
    indexInputs: Record<string, unknown>;
    indexSource: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    actorId: string;
    actorRole: string;
  },
): Promise<{ id: string }> {
  if (!params.indexSource.trim()) {
    throw badRequest(
      'Name whose data this class came from. A classification nobody can trace is one ' +
        'an LGA cannot argue with.',
    );
  }
  if (Object.keys(params.indexInputs).length === 0) {
    throw badRequest(
      'Record the indicators behind this class. A bare letter is a letter somebody chose.',
    );
  }

  return withTransaction(async (client) => {
    const inserted = await queryOne<{ id: string }>(
      client,
      `INSERT INTO lga_classes
         (lga_id, class_code, index_inputs, index_source, effective_from, effective_to, published_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        params.lgaId,
        params.classCode,
        JSON.stringify(params.indexInputs),
        params.indexSource.trim(),
        params.effectiveFrom,
        params.effectiveTo ?? null,
        params.actorId,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'lga_class.published',
      entityType: 'lga_class',
      entityId: inserted!.id,
      newValue: { classCode: params.classCode, source: params.indexSource },
      reason: `Local government classified ${params.classCode} from ${params.indexSource}`,
    });

    return { id: inserted!.id };
  });
}

export async function publishScheduleEntry(
  db: Db,
  params: {
    economicSector: string;
    sizeBand: SizeBand;
    lgaClass: LgaClass;
    assumedAnnualTurnoverKobo: string;
    instrumentReference: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    actorId: string;
    actorRole: string;
  },
): Promise<{ id: string; version: number }> {
  if (!params.instrumentReference.trim()) {
    throw badRequest(
      'Name the instrument that adopted this figure. A schedule nobody adopted is ' +
        'unenforceable and will not survive its first challenge.',
    );
  }

  return withTransaction(async (client) => {
    /*
     * The version continues the sequence for this cell rather than restarting.
     * An assessment carries the version it was computed against, so a reader
     * years later has to be able to tell version 3 of the Jos North tailor
     * figure from version 3 of the Wase one — which they can only do if the
     * numbers do not collide across cells by accident.
     */
    const previous = await queryOne<{ version: number }>(
      client,
      `SELECT max(version) AS version FROM presumptive_schedules
        WHERE economic_sector = $1 AND size_band = $2 AND lga_class = $3`,
      [params.economicSector, params.sizeBand, params.lgaClass],
    );
    const version = (previous?.version ?? 0) + 1;

    const inserted = await queryOne<{ id: string }>(
      client,
      `INSERT INTO presumptive_schedules
         (economic_sector, size_band, lga_class, assumed_annual_turnover_kobo,
          instrument_reference, version, effective_from, effective_to, published_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        params.economicSector,
        params.sizeBand,
        params.lgaClass,
        params.assumedAnnualTurnoverKobo,
        params.instrumentReference.trim(),
        version,
        params.effectiveFrom,
        params.effectiveTo ?? null,
        params.actorId,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'presumptive_schedule.published',
      entityType: 'presumptive_schedule',
      entityId: inserted!.id,
      newValue: {
        sector: params.economicSector,
        band: params.sizeBand,
        class: params.lgaClass,
        assumedTurnoverKobo: params.assumedAnnualTurnoverKobo,
        instrument: params.instrumentReference,
      },
      reason: `Schedule published under ${params.instrumentReference}`,
    });

    return { id: inserted!.id, version };
  });
}

export async function adoptNanoPolicy(
  db: Db,
  params: {
    construction: NanoConstruction;
    turnoverCeilingKobo: string;
    legalBasis: string;
    effectiveFrom: string;
    actorId: string;
    actorRole: string;
  },
): Promise<{ id: string }> {
  if (!params.legalBasis.trim()) {
    throw badRequest(
      'Cite the opinion or instrument this construction rests on. "We decided" is not ' +
        'an answer to a taxpayer who disagrees.',
    );
  }

  return withTransaction(async (client) => {
    const inserted = await queryOne<{ id: string }>(
      client,
      `INSERT INTO nano_exemption_policies
         (construction, turnover_ceiling_kobo, legal_basis, effective_from, adopted_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [
        params.construction,
        params.turnoverCeilingKobo,
        params.legalBasis.trim(),
        params.effectiveFrom,
        params.actorId,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'nano_policy.adopted',
      entityType: 'nano_exemption_policy',
      entityId: inserted!.id,
      newValue: { construction: params.construction, basis: params.legalBasis },
      reason: `Nano exemption read as ${params.construction}`,
    });

    return { id: inserted!.id };
  });
}

/* -------------------------------------------------------------------------- */
/* The published table                                                        */
/* -------------------------------------------------------------------------- */

export interface PublishedSchedule {
  /** Whether the platform can assess at all yet, and what is missing if not. */
  readiness: {
    nanoPolicyAdopted: boolean;
    nanoConstruction: NanoConstruction | null;
    lgasClassified: number;
    lgasTotal: number;
    scheduleCells: number;
  };
  classes: {
    lgaId: string;
    lgaName: string;
    classCode: LgaClass;
    indexSource: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }[];
  entries: ScheduleEntry[];
}

/**
 * The table PSIRS publishes and has to defend.
 *
 * Returned whole rather than paginated: this is a document, not a query
 * result, and a trader looking up their own trade needs the row above and
 * below theirs to see that the numbers rise in an order that makes sense.
 *
 * The readiness block is the honest part. A schedule half-published is a
 * schedule that will assess some people and refuse others for reasons neither
 * of them can see, so the state of the thing is reported before the contents.
 */
export async function publishedSchedule(db: Db, at: Date = new Date()): Promise<PublishedSchedule> {
  const policy = await nanoPolicyInForce(db, at);

  const classes = await query<{
    lga_id: string;
    lga_name: string;
    class_code: LgaClass;
    index_source: string;
    effective_from: Date;
    effective_to: Date | null;
  }>(
    db,
    `SELECT c.lga_id, l.name AS lga_name, c.class_code, c.index_source,
            c.effective_from, c.effective_to
       FROM lga_classes c
       JOIN lgas l ON l.id = c.lga_id
      WHERE c.effective_from <= $1 AND (c.effective_to IS NULL OR c.effective_to > $1)
      ORDER BY c.class_code, l.name`,
    [at],
  );

  const entries = await query<{
    id: string;
    economic_sector: string;
    size_band: SizeBand;
    lga_class: LgaClass;
    assumed_annual_turnover_kobo: string;
    instrument_reference: string;
    version: number;
    effective_from: Date;
    effective_to: Date | null;
  }>(
    db,
    `SELECT id, economic_sector, size_band, lga_class, assumed_annual_turnover_kobo,
            instrument_reference, version, effective_from, effective_to
       FROM presumptive_schedules
      WHERE effective_from <= $1 AND (effective_to IS NULL OR effective_to > $1)
      ORDER BY economic_sector,
               CASE size_band WHEN 'MICRO' THEN 1 WHEN 'SMALL' THEN 2 ELSE 3 END,
               lga_class`,
    [at],
  );

  const total = await queryOne<{ count: string }>(db, 'SELECT count(*)::text AS count FROM lgas', []);

  return {
    readiness: {
      nanoPolicyAdopted: policy !== null,
      nanoConstruction: policy?.construction ?? null,
      lgasClassified: classes.length,
      lgasTotal: Number.parseInt(total?.count ?? '0', 10),
      scheduleCells: entries.length,
    },
    classes: classes.map((row) => ({
      lgaId: row.lga_id,
      lgaName: row.lga_name,
      classCode: row.class_code,
      indexSource: row.index_source,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    })),
    entries: entries.map((row) => ({
      id: row.id,
      economicSector: row.economic_sector,
      sizeBand: row.size_band,
      lgaClass: row.lga_class,
      assumedAnnualTurnoverKobo: row.assumed_annual_turnover_kobo,
      instrumentReference: row.instrument_reference,
      version: row.version,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    })),
  };
}
