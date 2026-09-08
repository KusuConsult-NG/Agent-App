/**
 * What size of business an observation describes.
 *
 * This lives in the shared package because two things run it: the officer
 * platform, when a capture is recorded, and the agent's handset, so a trader
 * standing at their own stall can be told what has been written about them
 * before the phone has any signal to ask with.
 *
 * ONE IMPLEMENTATION, NOT TWO THAT AGREE TODAY.
 *
 * The rule is three comparisons, which is exactly what makes a second copy
 * tempting and dangerous. A duplicate on the handset would agree with the
 * server on the day it was written and drift the first time either changed —
 * and the drift would surface as an agent telling somebody "small" and a
 * notice arriving that says medium, which reads to the taxpayer as a bait and
 * switch and to the agent as the office overruling them. So there is one
 * function, and both sides import it.
 *
 * WHAT THE HANDSET IS TRUSTED WITH, AND WHAT IT IS NOT.
 *
 * The phone may work out a band and show it. It is not what decides the band:
 * the platform runs this same function again when the capture arrives, and
 * that result is the one that stands. The phone's answer travels with the
 * capture as a record of what the agent was told — because when the two
 * differ, somebody was misinformed at a stall, and that is worth knowing
 * rather than quietly overwriting.
 *
 * There is no money here, and there must never be. A band is not a price: the
 * price comes from a published schedule of assumed turnover the handset does
 * not carry, times one per cent. An agent paid commission may be told a size;
 * they may not be told a sum.
 */

export type SizeBand = 'MICRO' | 'SMALL' | 'MEDIUM';

/** Where the trade is carried on, smallest first. */
export type Premises =
  | 'NONE'            // itinerant — a hawker, a mobile repairer
  | 'STALL'           // a market stall or table
  | 'KIOSK'           // a fixed kiosk or container
  | 'LOCK_UP_SHOP'    // a shop that locks
  | 'BUILDING';       // a whole building or yard

/**
 * What an agent can see from the doorway.
 *
 * Every field is a fact a second person could check the following morning.
 * There is deliberately no `estimatedTurnover`, no `monthlyTakings` and no
 * `bandSuggestion`: those are conclusions, and a conclusion offered by the
 * person being assessed is a negotiation.
 */
export interface Observations {
  premises: Premises;
  /** Machines, chairs, ovens, looms — the tools of the trade, counted. */
  equipmentCount: number;
  /** People working there besides the operator, apprentices included. */
  peopleWorking: number;
}

/** Thrown rather than returned, so neither caller can carry on regardless. */
export class InvalidObservation extends Error {
  constructor(message = 'An observation cannot be a negative number.') {
    super(message);
    this.name = 'InvalidObservation';
  }
}

const ORDER: SizeBand[] = ['MICRO', 'SMALL', 'MEDIUM'];

/**
 * The band, from premises and scale.
 *
 * Premises set a floor the counts cannot lower: somebody working out of a
 * whole building is a medium enterprise whatever they say about whose
 * machines those are. Scale can lift, never lower — which is what stops the
 * rule being argued down at the stall, since the only way to a smaller band is
 * for the facts themselves to be smaller, and those are checkable.
 */
export function bandFor(observations: Observations): SizeBand {
  if (observations.equipmentCount < 0 || observations.peopleWorking < 0) {
    throw new InvalidObservation();
  }
  if (
    !Number.isInteger(observations.equipmentCount) ||
    !Number.isInteger(observations.peopleWorking)
  ) {
    throw new InvalidObservation('An observation must be a whole number.');
  }

  const floor: SizeBand =
    observations.premises === 'BUILDING'
      ? 'MEDIUM'
      : observations.premises === 'LOCK_UP_SHOP'
        ? 'SMALL'
        : 'MICRO';

  const byScale: SizeBand =
    observations.peopleWorking >= 5 || observations.equipmentCount >= 10
      ? 'MEDIUM'
      : observations.peopleWorking >= 1 || observations.equipmentCount >= 3
        ? 'SMALL'
        : 'MICRO';

  return ORDER[Math.max(ORDER.indexOf(floor), ORDER.indexOf(byScale))]!;
}
