/**
 * Rate evaluation (PRD §9, §14).
 *
 * This module answers one question: given a revenue item, an effective date and
 * the taxpayer's declared inputs, how much is owed?
 *
 * Two properties matter more than flexibility:
 *   1. Determinism — re-running an old assessment against its stored rate
 *      version and inputs must reproduce the stored amount exactly, years
 *      later, so an auditor can check the arithmetic (PRD §67).
 *   2. No agent influence — an agent supplies facts (turnover, vehicle class),
 *      never amounts. The amount is derived here (PRD §31 "No agent-created
 *      amounts").
 *
 * Every computation returns a trace explaining how it reached its figure, which
 * is stored on the assessment and shown to the taxpayer before payment.
 */

import {
  applyBasisPoints,
  clampAmount,
  parseKobo,
  formatNaira,
  type Kobo,
} from '@psirs/shared';
import { badRequest } from '../lib/errors';

export interface RateVersion {
  id: string;
  revenue_item_id: string;
  version: number;
  rate_type: 'FIXED' | 'PERCENTAGE' | 'TIERED' | 'FORMULA';
  fixed_amount_kobo: string | null;
  rate_basis_points: number | null;
  tiers: unknown;
  formula: string | null;
  minimum_amount_kobo: string | null;
  maximum_amount_kobo: string | null;
  effective_from: Date;
  effective_to: Date | null;
  /** The LGA this rate belongs to, or null for the statewide default. */
  lga_id: string | null;
}

export interface ComputationTraceStep {
  step: string;
  detail: string;
  amount?: string;
}

export interface RateComputation {
  amountKobo: Kobo;
  rateVersionId: string;
  trace: ComputationTraceStep[];
  /**
   * The assessable amount the operator declared, where the item has one.
   *
   * It is carried out of the computation so a caller can tell apart the two
   * quite different things a result of zero can mean: a schedule that taxes
   * the declared amount at nothing, and a form nobody filled in. Under the
   * Fourth Schedule the first is the ordinary case for a grassroots trader
   * and the second is a mistake, and they must not be reported alike.
   *
   * Null for FIXED and FORMULA items, which have no single declared base — a
   * zero there is a rate configured at nothing or a formula that cancels, and
   * neither is a statement about the taxpayer.
   */
  declaredBaseKobo: Kobo | null;
}

interface Tier {
  upToKobo: string | null;
  basisPoints?: number;
  fixedAmountKobo?: string;
}

/** Inputs an agent or taxpayer may declare. Values are facts, never amounts owed. */
export type ComputationInputs = Record<string, string | number | boolean | null>;

/**
 * Read a declared input.
 *
 * Only own properties count. A plain object inherits `constructor`,
 * `toString`, `valueOf` and friends from Object.prototype, so a plain
 * `inputs[name]` lookup would resolve a formula variable named `constructor`
 * to a function rather than rejecting it as missing — letting a crafted
 * formula reach values the caller never supplied.
 */
function readInput(inputs: ComputationInputs, key: string): string | number | boolean | null | undefined {
  return Object.prototype.hasOwnProperty.call(inputs, key) ? inputs[key] : undefined;
}

function requireNumericInput(inputs: ComputationInputs, key: string, label: string): Kobo {
  const raw = readInput(inputs, key);
  if (raw === undefined || raw === null || raw === '') {
    throw badRequest(`${label} is required to calculate this revenue item.`, [
      { field: key, issue: `${label} is missing` },
    ]);
  }
  let amount: Kobo;
  try {
    amount = parseKobo(typeof raw === 'boolean' ? Number(raw) : raw);
  } catch {
    throw badRequest(`${label} must be a whole number of kobo.`, [
      { field: key, issue: 'Not a valid amount' },
    ]);
  }

  /*
   * Nothing a revenue item is computed from can be negative.
   *
   * There is no negative turnover, no negative property value, no negative
   * assessable income for this purpose. A negative here is a mistake or a
   * crafted input, and it used to pass: the percentage of a negative base
   * rounds to zero, the statutory minimum is then applied because zero is
   * below it, and an assessment is raised for the floor. The taxpayer is
   * charged, the trace reads "2.00% of ₦-0.01", and nothing refused it.
   *
   * It only ever failed to slip through on items with no minimum, where the
   * zero result was caught further down — so whether a nonsensical input was
   * rejected depended on whether the item happened to have a floor.
   */
  if (amount < 0n) {
    throw badRequest(`${label} cannot be negative.`, [
      { field: key, issue: `${label} must be zero or more` },
    ]);
  }

  return amount;
}

/**
 * Progressive tiering, as used for personal income tax bands.
 *
 * Each tier applies only to the portion of the base falling inside it, which is
 * what makes the result progressive rather than a cliff at each threshold.
 */
function computeTiered(base: Kobo, tiers: Tier[]): { amount: Kobo; trace: ComputationTraceStep[] } {
  const trace: ComputationTraceStep[] = [];
  let remaining = base;
  let previousCeiling = 0n;
  let total = 0n;

  for (const [index, tier] of tiers.entries()) {
    if (remaining <= 0n) break;

    const ceiling = tier.upToKobo === null ? null : parseKobo(tier.upToKobo);
    const bandWidth = ceiling === null ? remaining : ceiling - previousCeiling;
    if (bandWidth <= 0n) continue;

    const portion = remaining < bandWidth ? remaining : bandWidth;

    let bandAmount: Kobo;
    if (tier.fixedAmountKobo !== undefined) {
      bandAmount = parseKobo(tier.fixedAmountKobo);
      trace.push({
        step: `Band ${index + 1}`,
        detail: `Flat charge for band up to ${ceiling === null ? '∞' : formatNaira(ceiling)}`,
        amount: bandAmount.toString(),
      });
    } else if (tier.basisPoints !== undefined) {
      bandAmount = applyBasisPoints(portion, tier.basisPoints);
      trace.push({
        step: `Band ${index + 1}`,
        detail:
          `${(tier.basisPoints / 100).toFixed(2)}% of ${formatNaira(portion)} ` +
          `(portion between ${formatNaira(previousCeiling)} and ` +
          `${ceiling === null ? '∞' : formatNaira(ceiling)})`,
        amount: bandAmount.toString(),
      });
    } else {
      throw badRequest('This revenue item has an incomplete tier configuration.');
    }

    total += bandAmount;
    remaining -= portion;
    if (ceiling !== null) previousCeiling = ceiling;
  }

  return { amount: total, trace };
}

// ---------------------------------------------------------------------------
// Restricted formula evaluator
//
// Supports numbers, named inputs, + - * / and parentheses. There is no `eval`,
// no property access, no function calls and no identifier that is not an input
// the caller supplied: a revenue formula is configuration written by a
// government officer, and configuration must not be able to execute code.
//
// Arithmetic is exact throughout, and the result is rounded half-up to the kobo
// once, at the end, so a formula stays reproducible.
//
// That was the promise and not the practice: each division rounded on the
// spot, and whatever came after multiplied the rounding. Measured: "₦500 per
// ten square metres" written `area / 10 * 50000` charged a 15 m² shop
// ₦1,000, and the same rate written `area * 50000 / 10` charged it ₦750 — a
// third more for where the officer happened to put the division. And
// `(rooms / 3) * 3` came to 3 for four rooms. Values are now carried as exact
// fractions, so two ways of writing one rate give one bill.
// ---------------------------------------------------------------------------

type Token = { type: 'number'; value: bigint } | { type: 'ident'; value: string } | { type: 'op'; value: string };

function tokenise(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < formula.length) {
    const char = formula[i]!;

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (/[0-9]/.test(char)) {
      let literal = '';
      while (i < formula.length && /[0-9]/.test(formula[i]!)) {
        literal += formula[i];
        i += 1;
      }
      tokens.push({ type: 'number', value: BigInt(literal) });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let name = '';
      while (i < formula.length && /[A-Za-z0-9_]/.test(formula[i]!)) {
        name += formula[i];
        i += 1;
      }
      tokens.push({ type: 'ident', value: name });
      continue;
    }

    if ('+-*/()'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      i += 1;
      continue;
    }

    throw badRequest(
      `This revenue item's formula contains an unsupported character "${char}".`,
    );
  }

  return tokens;
}

/**
 * The values a rate has to be given before it can be computed, by name.
 *
 * The field app asked for one thing — a base amount, for PERCENTAGE and TIERED
 * items — and nothing for a FORMULA item, whatever the formula named. So a
 * formula rate an officer could create and the catalogue would list could not
 * be collected in the field at all: every quote came back "needs a value for
 * area". The app now asks for exactly these, so what it collects and what the
 * engine reads come from one place.
 *
 * Names appear once, in the order the formula first uses them, which is the
 * order an officer wrote them in and the order a form should ask for them.
 */
export function inputsFor(rate: Pick<RateVersion, 'rate_type' | 'formula'>): string[] {
  switch (rate.rate_type) {
    case 'PERCENTAGE':
    case 'TIERED':
      return ['baseAmountKobo'];
    case 'FORMULA': {
      const names: string[] = [];
      for (const token of tokenise(rate.formula ?? '')) {
        if (token.type === 'ident' && !names.includes(token.value)) names.push(token.value);
      }
      return names;
    }
    default:
      return [];
  }
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/**
 * One value a formula reads, checked the way every other rate type checks its
 * own, and read exactly.
 *
 * The other rate types read their base through `requireNumericInput`, which
 * names the field and refuses a negative. A formula read its inputs with the
 * bare money parser instead. Measured: "15.5" or "abc" came back 422 —
 * "Amount must be a whole number of kobo" — naming no field and calling an
 * area money; and "-3" was accepted, so `area * 5` came to -15, and a
 * negative input under a minimum, or beside a flat charge, quietly lowered
 * the bill instead of being refused.
 *
 * A formula's inputs are counts and measurements — square metres, rooms,
 * months — and a measurement is often not whole: a shop is 15.5 m². Now that
 * the arithmetic is exact and rounds once, at the end, a decimal is read as
 * the exact fraction it writes (15.5 is 31/2) rather than refused or rounded
 * on the way in. What is refused is what is not a number, and a negative.
 */
function readFormulaInput(inputs: ComputationInputs, name: string): Fraction {
  const raw = readInput(inputs, name);
  if (raw === undefined || raw === null || raw === '') {
    throw badRequest(`This revenue item needs a value for "${name}".`, [
      { field: name, issue: 'Required input is missing' },
    ]);
  }
  if (typeof raw === 'boolean') return { n: raw ? 1n : 0n, d: 1n };

  const text = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : '') : String(raw).trim();
  const written = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!written) {
    throw badRequest(`"${name}" must be a number.`, [{ field: name, issue: 'Not a number' }]);
  }
  const decimals = written[3] ?? '';
  const value = fraction(BigInt(written[2]! + decimals), 10n ** BigInt(decimals.length));
  if (written[1] === '-' && value.n !== 0n) {
    throw badRequest(`"${name}" cannot be negative.`, [
      { field: name, issue: 'Must be zero or more' },
    ]);
  }
  return value;
}

/** An exact value: numerator over a positive denominator, kept in lowest terms. */
interface Fraction {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function fraction(n: bigint, d: bigint): Fraction {
  if (d < 0n) [n, d] = [-n, -d];
  const divisor = gcd(n, d) || 1n;
  return { n: n / divisor, d: d / divisor };
}

/** Half-up on the absolute value, so a result is symmetric about zero. */
function roundHalfUp(value: Fraction): bigint {
  const negative = value.n < 0n;
  const absolute = negative ? -value.n : value.n;
  const quotient = absolute / value.d;
  const rounded = (absolute % value.d) * 2n >= value.d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function evaluateFormula(formula: string, inputs: ComputationInputs): Kobo {
  const tokens = tokenise(formula);
  const values: Fraction[] = [];
  const operators: string[] = [];

  const applyOperator = () => {
    const operator = operators.pop();
    const right = values.pop();
    const left = values.pop();
    if (operator === undefined || right === undefined || left === undefined) {
      throw badRequest("This revenue item's formula is malformed.");
    }
    switch (operator) {
      case '+':
        values.push(fraction(left.n * right.d + right.n * left.d, left.d * right.d));
        break;
      case '-':
        values.push(fraction(left.n * right.d - right.n * left.d, left.d * right.d));
        break;
      case '*':
        values.push(fraction(left.n * right.n, left.d * right.d));
        break;
      case '/': {
        if (right.n === 0n) throw badRequest("This revenue item's formula divides by zero.");
        values.push(fraction(left.n * right.d, left.d * right.n));
        break;
      }
      default:
        throw badRequest("This revenue item's formula is malformed.");
    }
  };

  for (const token of tokens) {
    if (token.type === 'number') {
      values.push({ n: token.value, d: 1n });
    } else if (token.type === 'ident') {
      values.push(readFormulaInput(inputs, token.value));
    } else if (token.value === '(') {
      operators.push(token.value);
    } else if (token.value === ')') {
      while (operators.length > 0 && operators[operators.length - 1] !== '(') applyOperator();
      if (operators.pop() !== '(') throw badRequest("This revenue item's formula has unbalanced brackets.");
    } else {
      while (
        operators.length > 0 &&
        operators[operators.length - 1] !== '(' &&
        (PRECEDENCE[operators[operators.length - 1]!] ?? 0) >= (PRECEDENCE[token.value] ?? 0)
      ) {
        applyOperator();
      }
      operators.push(token.value);
    }
  }

  while (operators.length > 0) {
    if (operators[operators.length - 1] === '(') {
      throw badRequest("This revenue item's formula has unbalanced brackets.");
    }
    applyOperator();
  }

  const result = values.pop();
  if (result === undefined || values.length > 0) {
    throw badRequest("This revenue item's formula is malformed.");
  }
  return roundHalfUp(result);
}

/**
 * Compute the payable amount for one rate version.
 *
 * The returned trace is stored verbatim on the assessment so the calculation
 * can be explained to the taxpayer at the counter and re-checked in an audit.
 */
export function computeAmount(rate: RateVersion, inputs: ComputationInputs): RateComputation {
  const trace: ComputationTraceStep[] = [];
  let amount: Kobo;
  let declaredBase: Kobo | null = null;

  switch (rate.rate_type) {
    case 'FIXED': {
      amount = parseKobo(rate.fixed_amount_kobo ?? '0');
      trace.push({
        step: 'Fixed charge',
        detail: `Statutory fixed amount for this revenue item (rate version ${rate.version})`,
        amount: amount.toString(),
      });
      break;
    }

    case 'PERCENTAGE': {
      const base = requireNumericInput(inputs, 'baseAmountKobo', 'Assessable amount');
      declaredBase = base;
      const basisPoints = rate.rate_basis_points ?? 0;
      amount = applyBasisPoints(base, basisPoints);
      trace.push({
        step: 'Percentage of assessable amount',
        detail: `${(basisPoints / 100).toFixed(2)}% of ${formatNaira(base)}`,
        amount: amount.toString(),
      });
      break;
    }

    case 'TIERED': {
      const base = requireNumericInput(inputs, 'baseAmountKobo', 'Assessable amount');
      declaredBase = base;
      const tiers = (rate.tiers as { tiers?: Tier[] } | Tier[] | null);
      const list = Array.isArray(tiers) ? tiers : (tiers?.tiers ?? []);
      if (list.length === 0) {
        throw badRequest('This revenue item has no rate bands configured.');
      }
      const result = computeTiered(base, list);
      amount = result.amount;
      trace.push(...result.trace);
      break;
    }

    case 'FORMULA': {
      if (!rate.formula) throw badRequest('This revenue item has no formula configured.');
      amount = evaluateFormula(rate.formula, inputs);
      trace.push({
        step: 'Formula',
        detail: `Evaluated "${rate.formula}" against the declared values`,
        amount: amount.toString(),
      });
      break;
    }

    default:
      throw badRequest(`Unsupported rate type "${rate.rate_type}".`);
  }

  if (amount < 0n) {
    throw badRequest('The calculated amount is negative. Check the values entered.');
  }

  const minimum = rate.minimum_amount_kobo === null ? null : parseKobo(rate.minimum_amount_kobo);
  const maximum = rate.maximum_amount_kobo === null ? null : parseKobo(rate.maximum_amount_kobo);
  const clamped = clampAmount(amount, minimum, maximum);

  if (clamped !== amount) {
    trace.push({
      step: clamped > amount ? 'Minimum applied' : 'Maximum applied',
      detail:
        clamped > amount
          ? `Below the statutory minimum of ${formatNaira(minimum!)} — minimum charged`
          : `Above the statutory maximum of ${formatNaira(maximum!)} — capped`,
      amount: clamped.toString(),
    });
  }

  trace.push({ step: 'Payable', detail: 'Amount payable to government', amount: clamped.toString() });

  return { amountKobo: clamped, rateVersionId: rate.id, trace, declaredBaseKobo: declaredBase };
}

export { evaluateFormula, computeTiered };
