/**
 * Enumerating through associations, and assessing what was found.
 *
 * Phase 5, and the part of the programme a citizen actually meets. An agent
 * records what they can see, a market association's leader attests to it, and
 * the platform computes a liability from the schedule Phase 4 published.
 *
 * THE AGENT RECORDS, THE SERVER COMPUTES.
 *
 * `recordObservation` takes premises, equipment count and staff count. It does
 * not take a turnover, a band or an amount, and neither does the route above
 * it. This is the same rule the payment path applies to a caller-supplied
 * `status: VERIFIED` and Phase 3 applies to PAYE, and it matters more here
 * than anywhere: an agent paid commission on what they collect, holding a form
 * with a band on it, is being invited to negotiate somebody's tax at a stall.
 *
 * WHAT THE ASSOCIATION IS, AND WHAT IT IS NOT.
 *
 * The leader's roll is the sampling frame PSIRS cannot build for itself, and
 * their attestation is a genuine check on the agent — an observation and an
 * attestation that disagree is a supervisor's queue item rather than a
 * decision either of them gets to make alone.
 *
 * But the leader attests to facts and nothing else. There is no parameter here
 * and no column in migration 058 through which they could set a band or an
 * amount, and none through which money could be collected from them on a
 * member's behalf. Lagos has run informal collection through market
 * associations for years and the literature calls the arrangement by its
 * proper name: tax farming. It produces capture, it lands hardest on women
 * traders, and under the 2026 Regulations the collection practices it depends
 * on are prohibited outright.
 *
 * AN ESTIMATE IS A GUESS, SO IT MUST BE CONTESTABLE.
 *
 * Every assessment opens an objection window, and while an objection is open
 * the debt is not chased — the arrears worklist excludes it, which is the
 * suspension of enforcement made real rather than promised. The officer who
 * raised the assessment may not decide the objection against it; that is
 * enforced in the database, on the same principle the approvals table applies
 * to money.
 *
 * And `HAS_RECORDS` is a ground of objection because moving up into ordinary
 * assessment must be a right the taxpayer can exercise rather than a favour
 * granted to them. Anyone who produces books leaves the regime.
 */

import type { Db } from '../db/pool';
import { query, queryOne, withTransaction } from '../db/pool';
import { createAssessmentIn } from './revenue';
import { recordAudit } from './audit';
import { scopeParams, type ReportScope } from './report-scope';
import {
  bandFor,
  computePresumptive,
  type Observations,
  type SizeBand,
} from './presumptive';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';

/**
 * How long a taxpayer has to object before the debt is chased.
 *
 * Thirty days, matching the invoice's own validity window, so an assessment
 * cannot lapse while its objection window is still open — which would leave a
 * citizen who objected in time holding a bill the platform would refuse to
 * take by the time the objection was decided.
 */
const OBJECTION_WINDOW_DAYS = 30;

export interface RecordObservationParams {
  taxpayerId: string;
  premises: Observations['premises'];
  equipmentCount: number;
  peopleWorking: number;
  economicSector: string;
  groupId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  actorId: string;
  actorRole: string;
  agentId?: string | null;
  /**
   * The band the capturing handset showed the agent, when one did.
   *
   * Not what decides anything. The band that stands is concluded here, from
   * the facts, by the same function the handset ran — so in the ordinary case
   * this simply matches. It is kept because the cases where it does not are
   * real: an old build in a market with no signal, or a rule changed between
   * capture and sync. Either way a trader was told one size and will read
   * another, and this is what lets somebody answer them.
   */
  bandAtCapture?: SizeBand | null;
}

export interface Observation {
  id: string;
  taxpayerId: string;
  premises: Observations['premises'];
  equipmentCount: number;
  peopleWorking: number;
  economicSector: string;
  lgaId: string;
  observedAt: Date;
  groupId: string | null;
  attestationState: 'NOT_SOUGHT' | 'PENDING' | 'AGREED' | 'DISAGREED';
  attestedByName: string | null;
  attestedPremises: Observations['premises'] | null;
  attestedEquipmentCount: number | null;
  attestedPeopleWorking: number | null;
  /** The band these observations imply — computed, never stored on the row. */
  sizeBand: SizeBand;
}

/**
 * Record what an agent saw.
 *
 * The LGA comes from the taxpayer's own record rather than from the request:
 * the LGA selects the schedule, so accepting it here would let whoever fills
 * the form choose which column of the published table they are assessed
 * against.
 */
export async function recordObservation(
  db: Db,
  params: RecordObservationParams,
): Promise<Observation> {
  if (params.equipmentCount < 0 || params.peopleWorking < 0) {
    throw badRequest('An observation cannot be a negative number.');
  }

  return withTransaction(async (client) => {
    const taxpayer = await queryOne<{ id: string; lga_id: string; status: string }>(
      client,
      'SELECT id, lga_id, status FROM taxpayers WHERE id = $1',
      [params.taxpayerId],
    );
    if (!taxpayer) throw notFound('That taxpayer');
    if (taxpayer.status !== 'ACTIVE') {
      throw conflict(
        'TAXPAYER_NOT_ACTIVE',
        `This taxpayer record is ${taxpayer.status.toLowerCase()} and cannot be enumerated.`,
      );
    }

    /*
     * A group may only be named if it has been given a part to play. A group
     * registered for an allocation programme is not an attesting body, and
     * quietly treating it as one would give a leader standing over members who
     * never agreed to it.
     */
    if (params.groupId) {
      const group = await queryOne<{ id: string; tax_role: string }>(
        client,
        'SELECT id, tax_role FROM taxpayer_groups WHERE id = $1',
        [params.groupId],
      );
      if (!group) throw notFound('That group');
      if (group.tax_role === 'NONE') {
        throw conflict(
          'GROUP_HAS_NO_TAX_ROLE',
          'This group has not been given a part in enumeration or attestation, so an ' +
            'observation cannot be recorded against it.',
          'Set the group’s tax role first, if PSIRS intends it to have one.',
        );
      }
    }

    const inserted = await queryOne<{ id: string; observed_at: Date }>(
      client,
      `INSERT INTO presumptive_observations
         (taxpayer_id, premises, equipment_count, people_working, economic_sector,
          lga_id, observed_by, agent_id, latitude, longitude, group_id, attestation_state,
          band_at_capture)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, observed_at`,
      [
        params.taxpayerId,
        params.premises,
        params.equipmentCount,
        params.peopleWorking,
        params.economicSector,
        taxpayer.lga_id,
        params.actorId,
        params.agentId ?? null,
        params.latitude ?? null,
        params.longitude ?? null,
        params.groupId ?? null,
        params.groupId ? 'PENDING' : 'NOT_SOUGHT',
        params.bandAtCapture ?? null,
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'observation.recorded',
      entityType: 'presumptive_observation',
      entityId: inserted!.id,
      newValue: {
        premises: params.premises,
        equipment: params.equipmentCount,
        people: params.peopleWorking,
      },
      reason: 'Field observation recorded for presumptive assessment',
    });

    const sizeBand = bandFor({
      premises: params.premises,
      equipmentCount: params.equipmentCount,
      peopleWorking: params.peopleWorking,
    });

    /*
     * The handset said something else.
     *
     * Audited rather than refused. The capture is good — the facts are the
     * agent's and they are what the band is read from — but somebody standing
     * at a stall was told a different size, and the first anyone would
     * otherwise hear of it is the taxpayer objecting to a notice that does not
     * match what they were told.
     */
    if (params.bandAtCapture && params.bandAtCapture !== sizeBand) {
      await recordAudit(client, {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: 'observation.band_disagreed_with_handset',
        entityType: 'presumptive_observation',
        entityId: inserted!.id,
        oldValue: { bandAtCapture: params.bandAtCapture },
        newValue: { sizeBand },
        reason:
          'The handset showed a different size from the one the platform reached. The ' +
          'taxpayer may have been told the handset’s.',
      });
    }

    return {
      id: inserted!.id,
      taxpayerId: params.taxpayerId,
      premises: params.premises,
      equipmentCount: params.equipmentCount,
      peopleWorking: params.peopleWorking,
      economicSector: params.economicSector,
      lgaId: taxpayer.lga_id,
      observedAt: inserted!.observed_at,
      groupId: params.groupId ?? null,
      attestationState: params.groupId ? 'PENDING' : 'NOT_SOUGHT',
      attestedByName: null,
      attestedPremises: null,
      attestedEquipmentCount: null,
      attestedPeopleWorking: null,
      sizeBand,
    };
  });
}

/**
 * A leader agrees with what was recorded, or says what they claim instead.
 *
 * There is no band and no amount in this signature, and none in the table. A
 * leader can say "the stall is smaller than that"; they cannot say "she should
 * pay ₦2,000". That distinction is the whole difference between a witness and
 * a collector, and it is worth being unable to express rather than merely
 * disallowed.
 */
export async function attestObservation(
  db: Db,
  params: {
    observationId: string;
    agrees: boolean;
    attestedByName: string;
    /** Required when disagreeing: what the leader says instead. */
    premises?: Observations['premises'] | null;
    equipmentCount?: number | null;
    peopleWorking?: number | null;
    actorId: string;
    actorRole: string;
  },
): Promise<void> {
  if (!params.attestedByName.trim()) {
    throw badRequest('Record who is attesting. An unattributed attestation is worth nothing.');
  }
  /*
   * Also enforced by migration 058, which is what makes it an invariant —
   * removing this check leaves the property standing and the message nearly
   * identical. This exists so the refusal arrives as a 400 an interface can
   * show rather than as a constraint violation.
   */
  if (
    !params.agrees &&
    params.premises == null &&
    params.equipmentCount == null &&
    params.peopleWorking == null
  ) {
    throw badRequest(
      'Say what the leader claims instead. A disagreement with nothing behind it leaves a ' +
        'supervisor with nothing to settle and the member unable to see what is being said.',
    );
  }

  await withTransaction(async (client) => {
    const observation = await queryOne<{ id: string; attestation_state: string }>(
      client,
      'SELECT id, attestation_state FROM presumptive_observations WHERE id = $1 FOR UPDATE',
      [params.observationId],
    );
    if (!observation) throw notFound('That observation');
    if (observation.attestation_state !== 'PENDING') {
      throw conflict(
        'ATTESTATION_NOT_PENDING',
        `This observation is ${observation.attestation_state.toLowerCase().replace(/_/g, ' ')} ` +
          'and is not awaiting attestation.',
      );
    }

    await client.query(
      `UPDATE presumptive_observations
          SET attestation_state = $2, attested_at = now(), attested_by_name = $3,
              attested_premises = $4, attested_equipment_count = $5, attested_people_working = $6
        WHERE id = $1`,
      [
        params.observationId,
        params.agrees ? 'AGREED' : 'DISAGREED',
        params.attestedByName.trim(),
        params.agrees ? null : (params.premises ?? null),
        params.agrees ? null : (params.equipmentCount ?? null),
        params.agrees ? null : (params.peopleWorking ?? null),
      ],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.agrees ? 'observation.attested' : 'observation.disputed',
      entityType: 'presumptive_observation',
      entityId: params.observationId,
      newValue: { attestedBy: params.attestedByName.trim(), agrees: params.agrees },
      reason: params.agrees
        ? 'Group leader confirmed the observation'
        : 'Group leader disagreed with the observation',
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Assessing                                                                  */
/* -------------------------------------------------------------------------- */

export interface PresumptiveAssessmentResult {
  id: string;
  taxTier: 'NANO' | 'PRESUMPTIVE';
  sizeBand: SizeBand;
  lgaClass: string;
  assumedAnnualTurnoverKobo: string;
  annualTaxKobo: string;
  monthlyTaxKobo: string;
  invoiceNumber: string | null;
  objectionWindowEndsAt: Date;
  trace: { step: string; detail: string; amountKobo?: string }[];
}

/**
 * Turn an observation into a liability.
 *
 * Refuses on a disputed observation. An assessment built on facts the
 * association has already said are wrong is one the taxpayer will contest and
 * PSIRS will lose, and issuing it anyway spends the platform's credibility to
 * save a supervisor a visit.
 *
 * Refuses to assess the same observation twice, so a retried request cannot
 * double somebody's bill.
 */
export async function assessFromObservation(
  db: Db,
  params: { observationId: string; actorId: string; actorRole: string; ipAddress?: string | null },
): Promise<PresumptiveAssessmentResult> {
  return withTransaction(async (client) => {
    const observation = await queryOne<{
      id: string;
      taxpayer_id: string;
      premises: Observations['premises'];
      equipment_count: number;
      people_working: number;
      economic_sector: string;
      lga_id: string;
      attestation_state: string;
    }>(
      client,
      `SELECT id, taxpayer_id, premises, equipment_count, people_working,
              economic_sector, lga_id, attestation_state
         FROM presumptive_observations WHERE id = $1 FOR UPDATE`,
      [params.observationId],
    );
    if (!observation) throw notFound('That observation');

    if (observation.attestation_state === 'DISAGREED') {
      throw conflict(
        'OBSERVATION_DISPUTED',
        'The association has disagreed with these observations, so they are not settled ' +
          'facts to assess anybody on. A supervisor has to resolve the disagreement first.',
        'Open the disagreement queue.',
      );
    }

    const existing = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM presumptive_assessments
        WHERE observation_id = $1 AND status <> 'WITHDRAWN'`,
      [params.observationId],
    );
    if (existing) {
      throw conflict(
        'ALREADY_ASSESSED',
        'This observation has already produced an assessment. Assessing it again would ' +
          'double what the taxpayer appears to owe.',
      );
    }

    /*
     * The computation refuses on its own when the nano construction has not
     * been adopted, when the LGA has no published class, or when no schedule
     * covers the sector and band. Each of those is somebody else's decision,
     * and letting them surface from here means the officer is told which one
     * is missing rather than being handed a number that had to be invented.
     */
    const computation = await computePresumptive(client, {
      economicSector: observation.economic_sector,
      lgaId: observation.lga_id,
      observations: {
        premises: observation.premises,
        equipmentCount: observation.equipment_count,
        peopleWorking: observation.people_working,
      },
    });

    const policy = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM nano_exemption_policies
        WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
        ORDER BY effective_from DESC LIMIT 1`,
      [],
    );

    /*
     * A nano operator is recorded as assessed and exempt, with no invoice.
     * Recording nothing at all would leave PSIRS unable to say how many people
     * the exemption covers — which is the number the whole regime should be
     * judged on, and the one a coverage metric would otherwise bury.
     */
    let assessmentId: string | null = null;
    let invoiceNumber: string | null = null;
    if (computation.tier !== 'NANO') {
      const raised = await createAssessmentIn(client, {
        taxpayerId: observation.taxpayer_id,
        revenueItemId: await presumptiveItemFor(client, computation.sizeBand),
        inputs: { baseAmountKobo: computation.assumedAnnualTurnoverKobo },
        periodLabel: String(new Date().getUTCFullYear()),
        assessmentType: 'OFFICER',
        actorId: params.actorId,
        actorRole: params.actorRole,
        channel: 'OFFICER',
        ipAddress: params.ipAddress ?? null,
        /*
         * The assumed turnover goes in as the base and the rate engine applies
         * the statutory one per cent — rather than handing it a precomputed
         * figure as PAYE has to. PAYE needs that path because its total is the
         * sum of thirty band computations the engine cannot express; a
         * presumptive charge is one percentage of one number, which is exactly
         * what the engine is for. The rate version is then recorded on the
         * assessment, so what somebody was charged at is re-checkable.
         */
      });
      /*
       * The charge that was actually raised, against the figure this service
       * is about to record and put in front of the trader.
       *
       * These are two different computations of one number and nothing made
       * them agree. The trace explains one per cent of the schedule figure,
       * computed here; the invoice is whatever the rate engine made of the
       * catalogue row — a rate an officer can publish a new version of, with a
       * statutory minimum and maximum this file knows nothing about, applied
       * at whatever rate is in force on the day rather than the one written
       * above. Measured with a 2% rate version published through the ordinary
       * catalogue route: the assessment recorded 4,800,000 kobo and the trader
       * was billed 9,600,001.
       *
       * Refusing is the only defensible answer. Recording the engine's figure
       * would leave the trace explaining a rate nobody applied, and recording
       * this one leaves the State collecting a sum its own notice contradicts.
       * Either way somebody is being billed a number that is not the number
       * they were shown, which is the accusation this whole regime exists to
       * be able to answer. So nothing is issued, and the officer is told which
       * two figures disagree.
       *
       * The throw is inside the transaction, so the assessment, the invoice
       * and the observation's assessed state all roll back together.
       */
      if (raised.amountKobo !== BigInt(computation.annualTaxKobo)) {
        throw conflict(
          'PRESUMPTIVE_CHARGE_DISAGREES',
          `This assessment would explain ${computation.annualTaxKobo} kobo and bill ` +
            `${raised.amountKobo} kobo. The presumptive regime is one per cent of the ` +
            `published assumed turnover, and the revenue catalogue is charging something ` +
            'else, so no notice can be issued that is true about both.',
          `Bring the PIT-PRESUMPTIVE-${computation.sizeBand} catalogue rate back into line ` +
            'with the presumptive regulation, or amend the regulation.',
        );
      }

      assessmentId = raised.assessmentId;
      invoiceNumber = raised.invoiceNumber;
    }

    const windowEnds = new Date(Date.now() + OBJECTION_WINDOW_DAYS * 86_400_000);
    const inserted = await queryOne<{ id: string }>(
      client,
      `INSERT INTO presumptive_assessments
         (taxpayer_id, observation_id, schedule_id, nano_policy_id, tax_tier, size_band,
          lga_class, assumed_annual_turnover_kobo, annual_tax_kobo, assessment_id,
          objection_window_ends_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        observation.taxpayer_id,
        observation.id,
        computation.scheduleId,
        policy!.id,
        computation.tier,
        computation.sizeBand,
        computation.lgaClass,
        computation.assumedAnnualTurnoverKobo,
        computation.annualTaxKobo,
        assessmentId,
        windowEnds,
        params.actorId,
      ],
    );

    /*
     * The tier is written onto the taxpayer so the rest of the platform can
     * see it without re-deriving. A NANO record that looks like an unassessed
     * one is a record an officer will assess again next quarter.
     */
    await client.query('UPDATE taxpayers SET tax_tier = $2 WHERE id = $1', [
      observation.taxpayer_id,
      computation.tier,
    ]);

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'presumptive.assessed',
      entityType: 'presumptive_assessment',
      entityId: inserted!.id,
      newValue: {
        tier: computation.tier,
        band: computation.sizeBand,
        class: computation.lgaClass,
        annualTaxKobo: computation.annualTaxKobo,
      },
      reason: 'Presumptive assessment computed from a recorded observation',
    });

    return {
      id: inserted!.id,
      taxTier: computation.tier as 'NANO' | 'PRESUMPTIVE',
      sizeBand: computation.sizeBand,
      lgaClass: computation.lgaClass,
      assumedAnnualTurnoverKobo: computation.assumedAnnualTurnoverKobo,
      annualTaxKobo: computation.annualTaxKobo,
      monthlyTaxKobo: computation.monthlyTaxKobo,
      invoiceNumber,
      objectionWindowEndsAt: windowEnds,
      trace: computation.trace,
    };
  });
}

/** The catalogue item matching a band, so the money travels the ordinary path. */
async function presumptiveItemFor(db: Db, band: SizeBand): Promise<string> {
  const code = `PIT-PRESUMPTIVE-${band}`;
  const item = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM revenue_items WHERE code = $1 AND status = 'ACTIVE'`,
    [code],
  );
  if (!item) {
    throw conflict(
      'NO_PRESUMPTIVE_ITEM',
      `The revenue catalogue has no active ${code} item, so there is nothing to invoice ` +
        'this against.',
    );
  }
  return item.id;
}

/* -------------------------------------------------------------------------- */
/* Objecting                                                                  */
/* -------------------------------------------------------------------------- */

export async function raiseObjection(
  db: Db,
  params: {
    presumptiveAssessmentId: string;
    ground: 'FACTS_WRONG' | 'HAS_RECORDS' | 'NOT_TRADING' | 'OTHER';
    statement: string;
    actorId: string;
    actorRole: string;
  },
): Promise<{ id: string }> {
  if (!params.statement.trim()) {
    throw badRequest('Write down what the taxpayer says. An objection with no grounds cannot be decided.');
  }

  return withTransaction(async (client) => {
    const assessment = await queryOne<{ id: string; status: string; tax_tier: string }>(
      client,
      'SELECT id, status, tax_tier FROM presumptive_assessments WHERE id = $1 FOR UPDATE',
      [params.presumptiveAssessmentId],
    );
    if (!assessment) throw notFound('That assessment');
    if (assessment.status === 'WITHDRAWN') {
      throw conflict('ASSESSMENT_WITHDRAWN', 'This assessment has already been withdrawn.');
    }
    /*
     * A nano operator is exempt: the assessment records that they owe nothing
     * and raises no invoice. There is nothing to object to, and an objection
     * that were upheld would withdraw the record of the exemption itself —
     * leaving the observation assessable again and the taxpayer worse off for
     * having complained.
     */
    if (assessment.tax_tier === 'NANO') {
      throw conflict(
        'NOTHING_TO_OBJECT_TO',
        'This operator was found exempt and charged nothing, so there is no estimate to object to.',
      );
    }
    /*
     * One open objection at a time. The unique index refuses the second, but a
     * constraint violation reaches an officer as a failure rather than as the
     * fact that somebody already raised this.
     */
    const open = await queryOne<{ id: string }>(
      client,
      `SELECT id FROM assessment_objections
        WHERE presumptive_assessment_id = $1 AND status = 'OPEN'`,
      [params.presumptiveAssessmentId],
    );
    if (open) {
      throw conflict(
        'OBJECTION_ALREADY_OPEN',
        'An objection to this estimate is already open and waiting for a decision.',
      );
    }

    const inserted = await queryOne<{ id: string }>(
      client,
      `INSERT INTO assessment_objections
         (presumptive_assessment_id, ground, statement, raised_by)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [params.presumptiveAssessmentId, params.ground, params.statement.trim(), params.actorId],
    );

    await client.query(
      `UPDATE presumptive_assessments SET status = 'OBJECTED' WHERE id = $1`,
      [params.presumptiveAssessmentId],
    );

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'objection.raised',
      entityType: 'assessment_objection',
      entityId: inserted!.id,
      newValue: { ground: params.ground },
      reason: params.statement.trim(),
    });

    return { id: inserted!.id };
  });
}

/**
 * Decide an objection.
 *
 * Upholding one withdraws the assessment. It does not adjust it: an amended
 * figure computed from facts the taxpayer has just successfully contested
 * would be a second estimate resting on the first, and the honest route is a
 * fresh observation and a fresh assessment they can contest in turn.
 */
export async function decideObjection(
  db: Db,
  params: {
    objectionId: string;
    uphold: boolean;
    reason: string;
    actorId: string;
    actorRole: string;
  },
): Promise<void> {
  // As above: the database requires this too, and holds it when this does not.
  if (!params.reason.trim()) {
    throw badRequest('Give a reason the taxpayer can read.');
  }

  await withTransaction(async (client) => {
    const objection = await queryOne<{
      id: string;
      status: string;
      presumptive_assessment_id: string;
    }>(
      client,
      `SELECT id, status, presumptive_assessment_id
         FROM assessment_objections WHERE id = $1 FOR UPDATE`,
      [params.objectionId],
    );
    if (!objection) throw notFound('That objection');
    if (objection.status !== 'OPEN') {
      throw conflict('OBJECTION_DECIDED', 'This objection has already been decided.');
    }

    const assessment = await queryOne<{ created_by: string; assessment_id: string | null }>(
      client,
      'SELECT created_by, assessment_id FROM presumptive_assessments WHERE id = $1',
      [objection.presumptive_assessment_id],
    );
    /*
     * Checked here as well as by the trigger. The database is what makes it an
     * invariant; this is what makes the refusal a sentence an officer can read
     * rather than a constraint violation.
     */
    if (assessment!.created_by === params.actorId) {
      throw forbidden(
        'You raised this assessment, so you cannot decide the objection to it. ' +
          'Another officer must.',
      );
    }

    await client.query(
      `UPDATE assessment_objections
          SET status = $2, decided_at = now(), decided_by = $3, decision_reason = $4
        WHERE id = $1`,
      [params.objectionId, params.uphold ? 'UPHELD' : 'REJECTED', params.actorId, params.reason.trim()],
    );

    if (params.uphold) {
      await client.query(
        `UPDATE presumptive_assessments
            SET status = 'WITHDRAWN', withdrawn_reason = $2, withdrawn_at = now(), withdrawn_by = $3
          WHERE id = $1`,
        [objection.presumptive_assessment_id, params.reason.trim(), params.actorId],
      );

      /*
       * And the invoice goes with it. An upheld objection that left the bill
       * standing would be a decision in the taxpayer's favour that cost them
       * exactly nothing — and the arrears worklist would go on chasing them
       * for it.
       */
      if (assessment!.assessment_id) {
        await client.query(
          `UPDATE invoices SET status = 'CANCELLED'
            WHERE assessment_id = $1 AND status IN ('UNPAID', 'PARTIALLY_PAID')`,
          [assessment!.assessment_id],
        );
      }
    } else {
      await client.query(
        `UPDATE presumptive_assessments SET status = 'ASSESSED' WHERE id = $1`,
        [objection.presumptive_assessment_id],
      );
    }

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.uphold ? 'objection.upheld' : 'objection.rejected',
      entityType: 'assessment_objection',
      entityId: params.objectionId,
      oldValue: { status: 'OPEN' },
      newValue: { status: params.uphold ? 'UPHELD' : 'REJECTED' },
      reason: params.reason.trim(),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Queues                                                                     */
/* -------------------------------------------------------------------------- */

export interface Disagreement {
  observationId: string;
  taxpayerId: string;
  taxpayerName: string;
  groupName: string | null;
  attestedByName: string | null;
  observedAt: Date;
  agentSaw: { premises: string; equipmentCount: number; peopleWorking: number };
  leaderSays: {
    premises: string | null;
    equipmentCount: number | null;
    peopleWorking: number | null;
  };
  /** The band each account would produce, so the size of the gap is visible. */
  agentBand: SizeBand;
  leaderBand: SizeBand | null;
}

/**
 * Where an agent and a leader disagree about the same trader.
 *
 * The attestation's real value: two independent accounts of a checkable fact,
 * and a queue when they differ. Ranked by how far apart they are, because a
 * disagreement that changes the band is worth a visit and one that does not is
 * worth a phone call.
 */
export async function disagreements(
  db: Db,
  params: { limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<Disagreement[]> {
  const { statewide, lgaIds } = scopeParams(scope);
  const rows = await query<{
    id: string;
    taxpayer_id: string;
    taxpayer_name: string;
    group_name: string | null;
    attested_by_name: string | null;
    observed_at: Date;
    premises: string;
    equipment_count: number;
    people_working: number;
    attested_premises: string | null;
    attested_equipment_count: number | null;
    attested_people_working: number | null;
  }>(
    db,
    `SELECT o.id, o.taxpayer_id,
            COALESCE(NULLIF(trim(t.business_name), ''),
                     trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) AS taxpayer_name,
            g.name AS group_name,
            o.attested_by_name, o.observed_at,
            o.premises, o.equipment_count, o.people_working,
            o.attested_premises, o.attested_equipment_count, o.attested_people_working
       FROM presumptive_observations o
       JOIN taxpayers t ON t.id = o.taxpayer_id
       LEFT JOIN taxpayer_groups g ON g.id = o.group_id
      WHERE o.attestation_state = 'DISAGREED'
        AND t.status = 'ACTIVE'
        AND ($1 OR t.lga_id = ANY($2::uuid[]))
        /*
         * How a disagreement leaves this queue.
         *
         * Not by being assessed — a disputed observation is refused outright,
         * so that exit does not exist. It leaves when
         * somebody goes back and looks again: observations are immutable, so a
         * second visit is a second row, and the later one is what the State
         * now believes. The earlier disagreement stays on the record, which is
         * the point of not editing it.
         *
         * Without this the queue never empties and a supervisor who did the
         * right thing sees the same item for ever.
         */
        AND NOT EXISTS (
              SELECT 1 FROM presumptive_observations later
               WHERE later.taxpayer_id = o.taxpayer_id
                 AND later.observed_at > o.observed_at
            )
      ORDER BY o.observed_at
      LIMIT $3`,
    [statewide, lgaIds, Math.min(Math.max(params.limit ?? 100, 1), 500)],
  );

  return rows.map((row) => {
    const agentBand = bandFor({
      premises: row.premises as Observations['premises'],
      equipmentCount: row.equipment_count,
      peopleWorking: row.people_working,
    });
    /*
     * The leader's account is filled in from the agent's where they said
     * nothing — they disagreed about one thing, not about everything, and
     * treating the silent fields as zero would invent a disagreement wider
     * than the one that was actually made.
     */
    const leaderBand = bandFor({
      premises: (row.attested_premises ?? row.premises) as Observations['premises'],
      equipmentCount: row.attested_equipment_count ?? row.equipment_count,
      peopleWorking: row.attested_people_working ?? row.people_working,
    });

    return {
      observationId: row.id,
      taxpayerId: row.taxpayer_id,
      taxpayerName: row.taxpayer_name,
      groupName: row.group_name,
      attestedByName: row.attested_by_name,
      observedAt: row.observed_at,
      agentSaw: {
        premises: row.premises,
        equipmentCount: row.equipment_count,
        peopleWorking: row.people_working,
      },
      leaderSays: {
        premises: row.attested_premises,
        equipmentCount: row.attested_equipment_count,
        peopleWorking: row.attested_people_working,
      },
      agentBand,
      leaderBand,
    };
  });
}

export interface PendingObservation {
  observationId: string;
  taxpayerId: string;
  taxpayerName: string;
  economicSector: string;
  premises: string;
  equipmentCount: number;
  peopleWorking: number;
  sizeBand: SizeBand;
  attestationState: string;
  groupName: string | null;
  observedAt: Date;
  /** Set once assessed, so the same list shows what became of each one. */
  presumptiveAssessmentId: string | null;
  taxTier: string | null;
  annualTaxKobo: string | null;
  /** True when an objection is already open against it. */
  underObjection: boolean;
}

/**
 * What has been recorded lately, and what became of it.
 *
 * One list rather than two. An officer needs to see the observations waiting
 * to be assessed and the ones already assessed together, because the second
 * group is where an objection gets recorded when a taxpayer telephones — and
 * splitting them would mean finding the same person twice.
 */
export async function recentObservations(
  db: Db,
  params: { limit?: number } = {},
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<PendingObservation[]> {
  const { statewide, lgaIds } = scopeParams(scope);
  const rows = await query<{
    id: string;
    taxpayer_id: string;
    taxpayer_name: string;
    economic_sector: string;
    premises: string;
    equipment_count: number;
    people_working: number;
    attestation_state: string;
    group_name: string | null;
    observed_at: Date;
    assessment_id: string | null;
    tax_tier: string | null;
    annual_tax_kobo: string | null;
    under_objection: boolean;
  }>(
    db,
    `SELECT o.id, o.taxpayer_id,
            COALESCE(NULLIF(trim(t.business_name), ''),
                     trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) AS taxpayer_name,
            o.economic_sector, o.premises, o.equipment_count, o.people_working,
            o.attestation_state, g.name AS group_name, o.observed_at,
            pa.id AS assessment_id, pa.tax_tier, pa.annual_tax_kobo,
            EXISTS (
              SELECT 1 FROM assessment_objections ao
               WHERE ao.presumptive_assessment_id = pa.id AND ao.status = 'OPEN'
            ) AS under_objection
       FROM presumptive_observations o
       JOIN taxpayers t ON t.id = o.taxpayer_id
       LEFT JOIN taxpayer_groups g ON g.id = o.group_id
       LEFT JOIN presumptive_assessments pa
              ON pa.observation_id = o.id AND pa.status <> 'WITHDRAWN'
      WHERE t.status = 'ACTIVE'
        AND ($1 OR t.lga_id = ANY($2::uuid[]))
      ORDER BY o.observed_at DESC
      LIMIT $3`,
    [statewide, lgaIds, Math.min(Math.max(params.limit ?? 100, 1), 500)],
  );

  return rows.map((row) => ({
    observationId: row.id,
    taxpayerId: row.taxpayer_id,
    taxpayerName: row.taxpayer_name,
    economicSector: row.economic_sector,
    premises: row.premises,
    equipmentCount: row.equipment_count,
    peopleWorking: row.people_working,
    sizeBand: bandFor({
      premises: row.premises as Observations['premises'],
      equipmentCount: row.equipment_count,
      peopleWorking: row.people_working,
    }),
    attestationState: row.attestation_state,
    groupName: row.group_name,
    observedAt: row.observed_at,
    presumptiveAssessmentId: row.assessment_id,
    taxTier: row.tax_tier,
    annualTaxKobo: row.annual_tax_kobo,
    underObjection: row.under_objection,
  }));
}

/** Objections waiting on a decision, and who may not make it. */
export async function openObjections(
  db: Db,
  scope: ReportScope = { kind: 'STATEWIDE' },
): Promise<
  {
    objectionId: string;
    presumptiveAssessmentId: string;
    taxpayerId: string;
    taxpayerName: string;
    ground: string;
    statement: string;
    raisedAt: Date;
    annualTaxKobo: string;
    /** The officer who raised the assessment, and so may not decide this. */
    assessedBy: string;
  }[]
> {
  const { statewide, lgaIds } = scopeParams(scope);
  const rows = await query<{
    id: string;
    presumptive_assessment_id: string;
    taxpayer_id: string;
    taxpayer_name: string;
    ground: string;
    statement: string;
    raised_at: Date;
    annual_tax_kobo: string;
    created_by: string;
  }>(
    db,
    `SELECT o.id, o.presumptive_assessment_id, a.taxpayer_id,
            COALESCE(NULLIF(trim(t.business_name), ''),
                     trim(coalesce(t.first_name,'') || ' ' || coalesce(t.last_name,''))) AS taxpayer_name,
            o.ground, o.statement, o.raised_at, a.annual_tax_kobo, a.created_by
       FROM assessment_objections o
       JOIN presumptive_assessments a ON a.id = o.presumptive_assessment_id
       JOIN taxpayers t ON t.id = a.taxpayer_id
      WHERE o.status = 'OPEN'
        AND ($1 OR t.lga_id = ANY($2::uuid[]))
      ORDER BY o.raised_at`,
    [statewide, lgaIds],
  );

  return rows.map((row) => ({
    objectionId: row.id,
    presumptiveAssessmentId: row.presumptive_assessment_id,
    taxpayerId: row.taxpayer_id,
    taxpayerName: row.taxpayer_name,
    ground: row.ground,
    statement: row.statement,
    raisedAt: row.raised_at,
    annualTaxKobo: row.annual_tax_kobo,
    assessedBy: row.created_by,
  }));
}
