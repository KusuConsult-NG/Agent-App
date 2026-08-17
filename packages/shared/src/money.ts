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
