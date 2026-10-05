/**
 * Monetary primitives.
 *
 * PRD §51: "Money must never be stored as floating-point values."
 *
 * Every monetary value in this platform is an integer number of KOBO
 * (1 Naira = 100 kobo) carried as a JavaScript `bigint` in the domain layer
 * and as `BIGINT` in PostgreSQL. There is no `number` money anywhere in the
 * financial path — `number` loses integer precision above 2^53 kobo
 * (~90 trillion naira) and, far more importantly, invites accidental
 * float arithmetic such as `0.1 + 0.2`.
 *
 * Wire format is a decimal *string* of kobo (e.g. "10000000" = ₦100,000.00).
 * JSON has no bigint, and `JSON.parse` on a large number silently rounds,
 * so kobo crosses process boundaries as a string and is parsed with
 * `parseKobo` on arrival.
 */

export type Kobo = bigint;

const KOBO_PER_NAIRA = 100n;

/** Thrown when a value that must be money is not valid money. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Parse a wire value into kobo.
 *
 * Accepts a decimal string of kobo ("2500"), a bigint, or a safe integer.
 * Rejects floats, exponent notation, and anything non-integral: a caller
 * that has a naira decimal must go through `nairaToKobo` explicitly so the
 * unit conversion is visible at the call site.
 */
export function parseKobo(value: unknown): Kobo {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(`Amount must be an integer number of kobo, received ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new MoneyError(`Amount must be a whole number of kobo, received "${value}"`);
    }
    return BigInt(trimmed);
  }
  throw new MoneyError(`Amount must be a string or integer number of kobo, received ${typeof value}`);
}

/** Parse a human-entered naira amount ("1,500.75" or "1500.75") into kobo. */
export function nairaToKobo(value: string | number): Kobo {
  const raw = typeof value === 'number' ? value.toFixed(2) : value.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new MoneyError(`"${value}" is not a valid naira amount`);
  }
  const [, sign, whole, fraction = ''] = match;
  const kobo = BigInt(whole!) * KOBO_PER_NAIRA + BigInt(fraction.padEnd(2, '0'));
  return sign === '-' ? -kobo : kobo;
}

/** Render kobo as a plain decimal naira string, e.g. 150000n -> "1500.00". */
export function koboToNaira(kobo: Kobo): string {
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  const whole = abs / KOBO_PER_NAIRA;
  const fraction = abs % KOBO_PER_NAIRA;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Render kobo for display to a Nigerian taxpayer or agent.
 * PRD §55 requires Nigerian Naira formatting throughout the UI.
 */
export function formatNaira(kobo: Kobo | string, options: { symbol?: boolean } = {}): string {
  const value = typeof kobo === 'string' ? parseKobo(kobo) : kobo;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / KOBO_PER_NAIRA).toString();
  const fraction = (abs % KOBO_PER_NAIRA).toString().padStart(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = options.symbol === false ? '' : '₦';
  return `${negative ? '-' : ''}${symbol}${grouped}.${fraction}`;
}

/** Serialise kobo for transport. Always a string — never a JSON number. */
export function serialiseKobo(kobo: Kobo): string {
  return kobo.toString();
}

/**
 * Percentage applied to money, expressed in BASIS POINTS (1 bp = 0.01%).
 *
 * The default agent commission of 1.5% (PRD §25) is 150 bp. Rounding is
 * half-up on the absolute value, which keeps commission deterministic and
 * reproducible during reconciliation: recomputing a commission from the
 * stored rate and transaction amount must always yield the stored figure.
 */
export function applyBasisPoints(amount: Kobo, basisPoints: number): Kobo {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`Basis points must be a non-negative integer, received ${basisPoints}`);
  }
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const numerator = abs * BigInt(basisPoints);
  const quotient = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  const rounded = remainder * 2n >= 10_000n ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Clamp an amount into an optional [min, max] band from the revenue catalogue. */
export function clampAmount(amount: Kobo, min: Kobo | null, max: Kobo | null): Kobo {
  let result = amount;
  if (min !== null && result < min) result = min;
  if (max !== null && result > max) result = max;
  return result;
}

export const ZERO: Kobo = 0n;

/**
 * A two-decimal quantity as a whole number of hundredths.
 *
 * Money on this platform is kobo and never leaves integers, which is why
 * everything above takes `Kobo`. Allocation quantities are the one other
 * decimal the platform stores — `NUMERIC(14,2)` on
 * `incentive_allocation_rounds` and `incentive_awards`, a count of bags or
 * litres handed to a beneficiary — and they are the only place a fraction
 * reaches arithmetic.
 *
 * Read into a JavaScript number and subtracted, two exact decimals stop being
 * exact. `1.00 - 0.90` is `0.09999999999999998`; `Math.floor(0.30 / 0.10)` is
 * `2`. `allocations.ts` measured the second one over every two-decimal
 * combination a round plausibly holds: 12,231 disagreements against the
 * integer answer, every one of them reporting FEWER beneficiaries than the
 * goods can serve. It never over-promises. It turns people away.
 *
 * That function fixed it for one round and kept the helper to itself, so the
 * rounds list did the float subtraction in the browser and printed
 * `3.0000000000000004` into a government screen, and the create form told an
 * officer a round would serve twenty-eight people when it serves twenty-nine.
 * One definition, in the module that already owns exact arithmetic, is what
 * stops that being rediscovered a third time.
 *
 * Hundredths are exact here: `NUMERIC(14,2)` tops out well inside the range
 * where an integer number of hundredths is safely representable.
 *
 * Where the figure can be computed in SQL instead, it should be —
 * `NUMERIC` arithmetic in Postgres is exact without any of this. This is for
 * the cases with no row to ask about yet, such as a form previewing a round
 * nobody has created.
 */
export function quantityHundredths(value: string | number): number {
  return Math.round(Number(value) * 100);
}
