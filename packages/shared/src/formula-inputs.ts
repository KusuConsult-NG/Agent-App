/**
 * The measurements a formula rate may read, and the words for each.
 *
 * A formula rate names its own inputs, and the field app asks the agent for
 * each one. It labelled them by the name the officer had typed into the
 * formula — `floorAreaSqm` shown as "Floor area sqm" — which reads like code
 * and was the same in Hausa as in English. A name typed into a rate cannot be
 * translated; a name chosen from a list can.
 *
 * So this is the list. Each entry is a measurement the catalogue actually
 * charges by (shops by floor area, land use by plot area, signage by its
 * area, hotels by rooms, abattoirs by animals, motor parks by vehicles, and so
 * on) and carries a dictionary key, so its label is in both languages and goes
 * to the Hausa review with everything else. The API refuses a FORMULA rate
 * naming anything not here, so every box the field app shows has a label a
 * reader of either language can read. `baseAmountKobo` is the one input
 * outside it: the declared amount PERCENTAGE and TIERED rates read, which the
 * field app already asks for in naira under its own label.
 *
 * Adding a measurement is adding a line here and its two strings.
 */

import type { TranslationDictionary } from './i18n';

export const FORMULA_INPUTS = {
  floorAreaSqm: 'colFiFloorAreaSqm',
  landAreaSqm: 'colFiLandAreaSqm',
  signAreaSqm: 'colFiSignAreaSqm',
  frontageMetres: 'colFiFrontageMetres',
  rooms: 'colFiRooms',
  seats: 'colFiSeats',
  employees: 'colFiEmployees',
  vehicles: 'colFiVehicles',
  animals: 'colFiAnimals',
  stalls: 'colFiStalls',
  machines: 'colFiMachines',
  months: 'colFiMonths',
  days: 'colFiDays',
  tonnes: 'colFiTonnes',
  /*
   * Read by the seeded vehicle renewal rates, and supplied by the renewal
   * flow from the 6, 12 or 24 months chosen there. On the list so those rates
   * can be revised, and labelled like the rest in case a screen shows it.
   */
  renewalPeriodMonths: 'colFiRenewalPeriodMonths',
} as const satisfies Record<string, keyof TranslationDictionary>;

export type FormulaInputName = keyof typeof FORMULA_INPUTS;

export const FORMULA_INPUT_NAMES = Object.keys(FORMULA_INPUTS) as FormulaInputName[];

/** The declared amount a formula may also read, asked for in naira. */
export const BASE_AMOUNT_INPUT = 'baseAmountKobo';

/** The dictionary key for an input's label, or null for a name not on the list. */
export function formulaInputLabelKey(name: string): keyof TranslationDictionary | null {
  return Object.prototype.hasOwnProperty.call(FORMULA_INPUTS, name)
    ? FORMULA_INPUTS[name as FormulaInputName]
    : null;
}
