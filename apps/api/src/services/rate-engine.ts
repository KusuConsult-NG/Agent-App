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
  koboToNaira,
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
  try {
    return parseKobo(typeof raw === 'boolean' ? Number(raw) : raw);
  } catch {
    throw badRequest(`${label} must be a whole number of kobo.`, [
      { field: key, issue: 'Not a valid amount' },
    ]);
  }
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
        detail: `Flat charge for band up to ₦${ceiling === null ? '∞' : koboToNaira(ceiling)}`,
        amount: bandAmount.toString(),
      });
    } else if (tier.basisPoints !== undefined) {
      bandAmount = applyBasisPoints(portion, tier.basisPoints);
      trace.push({
        step: `Band ${index + 1}`,
        detail:
          `${(tier.basisPoints / 100).toFixed(2)}% of ₦${koboToNaira(portion)} ` +
          `(portion between ₦${koboToNaira(previousCeiling)} and ` +
          `₦${ceiling === null ? '∞' : koboToNaira(ceiling)})`,
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
// Arithmetic is integer (kobo) throughout. Division rounds half-up on the final
// value only, so a formula stays reproducible.
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

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

function evaluateFormula(formula: string, inputs: ComputationInputs): Kobo {
  const tokens = tokenise(formula);
  const values: bigint[] = [];
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
        values.push(left + right);
        break;
      case '-':
        values.push(left - right);
        break;
      case '*':
        values.push(left * right);
        break;
      case '/': {
        if (right === 0n) throw badRequest("This revenue item's formula divides by zero.");
        // Round half-up on the absolute value to keep results symmetric.
        const negative = left < 0n !== right < 0n;
        const absLeft = left < 0n ? -left : left;
        const absRight = right < 0n ? -right : right;
        const quotient = absLeft / absRight;
        const remainder = absLeft % absRight;
        const rounded = remainder * 2n >= absRight ? quotient + 1n : quotient;
        values.push(negative ? -rounded : rounded);
        break;
      }
      default:
        throw badRequest("This revenue item's formula is malformed.");
    }
  };

  for (const token of tokens) {
    if (token.type === 'number') {
      values.push(token.value);
    } else if (token.type === 'ident') {
      const raw = readInput(inputs, token.value);
      if (raw === undefined || raw === null || raw === '') {
        throw badRequest(`This revenue item needs a value for "${token.value}".`, [
          { field: token.value, issue: 'Required input is missing' },
        ]);
      }
      values.push(parseKobo(typeof raw === 'boolean' ? Number(raw) : raw));
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
  return result;
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
      const basisPoints = rate.rate_basis_points ?? 0;
      amount = applyBasisPoints(base, basisPoints);
      trace.push({
        step: 'Percentage of assessable amount',
        detail: `${(basisPoints / 100).toFixed(2)}% of ₦${koboToNaira(base)}`,
        amount: amount.toString(),
      });
      break;
    }

    case 'TIERED': {
      const base = requireNumericInput(inputs, 'baseAmountKobo', 'Assessable amount');
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
          ? `Below the statutory minimum of ₦${koboToNaira(minimum!)} — minimum charged`
          : `Above the statutory maximum of ₦${koboToNaira(maximum!)} — capped`,
      amount: clamped.toString(),
    });
  }

  trace.push({ step: 'Payable', detail: 'Amount payable to government', amount: clamped.toString() });

  return { amountKobo: clamped, rateVersionId: rate.id, trace };
}

export { evaluateFormula, computeTiered };
