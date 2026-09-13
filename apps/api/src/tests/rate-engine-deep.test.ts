/**
 * Rate Engine Mathematical Precision Tests (PRD §9, §14, §31).
 *
 * The rate engine is the platform's single source of tax amounts.
 * PRD §31: "No agent-created amounts" — agents supply facts, the engine derives obligations.
 * PRD §67: Calculations must be deterministic and reproducible years later in an audit.
 *
 * This suite exhaustively tests:
 * 1. FIXED: exact kobo amount, no inputs needed
 * 2. PERCENTAGE: basis-point computation, correct rounding (half-up, not banker's)
 * 3. TIERED progressive bands: each tier only charges on its slice of the base
 * 4. FORMULA: safe arithmetic evaluator (no eval), correct operator precedence
 * 5. Minimum amount clamping (computed < min → charge min)
 * 6. Maximum amount capping (computed > max → cap at max)
 * 7. PERCENTAGE formula injection attempt via input key names (prototype attack defense)
 * 8. FORMULA division by zero → clean 400, not a crash
 * 9. FORMULA unbalanced brackets → clean 400
 * 10. FORMULA unsupported characters (e.g. `;`, `require`) → clean 400
 * 11. Determinism: running the same inputs twice always returns the same amount
 * 12. Negative result → clean 400 (guards against negative-tax exploits)
 * 13. Tiered empty bands → clean 400
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAmount, computeTiered, evaluateFormula, type RateVersion } from '../services/rate-engine';
import { nairaToKobo, parseKobo } from '@psirs/shared';

const baseRate = (overrides: Partial<RateVersion>): RateVersion => ({
  id: 'rv-test',
  revenue_item_id: 'ri-test',
  version: 1,
  // Statewide: these fixtures exercise the arithmetic, not rate resolution.
  lga_id: null,
  rate_type: 'FIXED',
  fixed_amount_kobo: '200000',
  rate_basis_points: null,
  tiers: null,
  formula: null,
  minimum_amount_kobo: null,
  maximum_amount_kobo: null,
  effective_from: new Date('2025-01-01'),
  effective_to: null,
  ...overrides,
});

describe('FIXED rate', () => {
  it('returns exactly the configured kobo amount regardless of inputs', () => {
    const result = computeAmount(baseRate({ fixed_amount_kobo: '200000' }), {});
    assert.equal(result.amountKobo, 200000n);
  });

  it('includes a Payable trace step', () => {
    const result = computeAmount(baseRate({ fixed_amount_kobo: '50000' }), {});
    const payable = result.trace.find((s) => s.step === 'Payable');
    assert.ok(payable, 'Must include a Payable trace step');
    assert.equal(payable!.amount, '50000');
  });
});

describe('PERCENTAGE rate', () => {
  it('computes 1.5% of ₦100,000 as exactly ₦1,500 (PRD §25 worked example)', () => {
    const result = computeAmount(
      baseRate({ rate_type: 'PERCENTAGE', rate_basis_points: 150 }),
      { baseAmountKobo: String(nairaToKobo('100000')) },
    );
    assert.equal(result.amountKobo, nairaToKobo('1500'));
  });

  it('rounds half-up for fractional kobo values', () => {
    // 1.5% of ₦333.33 (33333 kobo) = 499.995 kobo → rounds UP to 500
    const result = computeAmount(
      baseRate({ rate_type: 'PERCENTAGE', rate_basis_points: 150 }),
      { baseAmountKobo: '33333' },
    );
    assert.equal(result.amountKobo, 500n);
  });

  it('applies the minimum when percentage result is below minimum', () => {
    const result = computeAmount(
      baseRate({
        rate_type: 'PERCENTAGE',
        rate_basis_points: 10,   // 0.10%
        minimum_amount_kobo: '50000',
      }),
      { baseAmountKobo: '10000' }, // 0.10% of ₦100 = ₦0.10 < ₦500 minimum
    );
    assert.equal(result.amountKobo, 50000n, 'Must apply minimum when computed amount is below it');
    const minStep = result.trace.find((s) => s.step === 'Minimum applied');
    assert.ok(minStep, 'Trace must include Minimum applied step');
  });

  it('applies the cap when percentage result exceeds maximum', () => {
    const result = computeAmount(
      baseRate({
        rate_type: 'PERCENTAGE',
        rate_basis_points: 1000,   // 10%
        maximum_amount_kobo: '100000', // cap at ₦1,000
      }),
      { baseAmountKobo: String(nairaToKobo('100000')) }, // 10% of ₦100k = ₦10k > ₦1k cap
    );
    assert.equal(result.amountKobo, 100000n, 'Must cap at maximum');
    const capStep = result.trace.find((s) => s.step === 'Maximum applied');
    assert.ok(capStep, 'Trace must include Maximum applied step');
  });

  it('throws 400 when baseAmountKobo input is missing', () => {
    assert.throws(
      () => computeAmount(baseRate({ rate_type: 'PERCENTAGE', rate_basis_points: 150 }), {}),
      (err: any) => err?.statusCode === 400,
    );
  });
});

describe('TIERED progressive rate', () => {
  // Three-band system matching typical Nigerian personal income tax:
  // Band 1: first ₦3,000,000 at 7%
  // Band 2: next ₦3,000,000 (up to ₦6,000,000) at 11%
  // Band 3: above ₦6,000,000 at 15%
  const tiers = [
    { upToKobo: String(nairaToKobo('3000000')),  basisPoints: 700 },
    { upToKobo: String(nairaToKobo('6000000')),  basisPoints: 1100 },
    { upToKobo: null,                            basisPoints: 1500 },
  ];

  it('charges each band only on its slice of the base (progressivity)', () => {
    // Base of ₦5,000,000:
    //   Band 1: 7% of ₦3,000,000 = ₦210,000
    //   Band 2: 11% of ₦2,000,000 = ₦220,000
    //   Total:  ₦430,000
    const result = computeAmount(
      baseRate({ rate_type: 'TIERED', tiers }),
      { baseAmountKobo: String(nairaToKobo('5000000')) },
    );
    assert.equal(result.amountKobo, nairaToKobo('430000'));
  });

  it('charges all three bands for a base above the top threshold', () => {
    // Base of ₦8,000,000:
    //   Band 1: 7% of ₦3,000,000 = ₦210,000
    //   Band 2: 11% of ₦3,000,000 = ₦330,000
    //   Band 3: 15% of ₦2,000,000 = ₦300,000
    //   Total:  ₦840,000
    const result = computeAmount(
      baseRate({ rate_type: 'TIERED', tiers }),
      { baseAmountKobo: String(nairaToKobo('8000000')) },
    );
    assert.equal(result.amountKobo, nairaToKobo('840000'));
  });

  it('only uses the first band when base is within it', () => {
    // Base of ₦1,000,000: 7% of ₦1,000,000 = ₦70,000
    const result = computeAmount(
      baseRate({ rate_type: 'TIERED', tiers }),
      { baseAmountKobo: String(nairaToKobo('1000000')) },
    );
    assert.equal(result.amountKobo, nairaToKobo('70000'));
    assert.equal(result.trace.filter((s) => s.step.startsWith('Band')).length, 1, 'Only one band trace step');
  });

  it('throws 400 when no tiers are configured', () => {
    assert.throws(
      () => computeAmount(baseRate({ rate_type: 'TIERED', tiers: [] }), { baseAmountKobo: '1000000' }),
      (err: any) => err?.statusCode === 400,
    );
  });
});

describe('FORMULA rate — safe arithmetic evaluator', () => {
  it('evaluates simple addition and multiplication with correct precedence', () => {
    // Formula: baseAmountKobo + 50000 * 2  =>  100000 + 100000 = 200000
    const result = computeAmount(
      baseRate({ rate_type: 'FORMULA', formula: 'baseAmountKobo + 50000 * 2' }),
      { baseAmountKobo: '100000' },
    );
    assert.equal(result.amountKobo, 200000n);
  });

  it('respects parentheses to override operator precedence', () => {
    // (baseAmountKobo + 50000) * 2 = (100000 + 50000) * 2 = 300000
    const result = computeAmount(
      baseRate({ rate_type: 'FORMULA', formula: '(baseAmountKobo + 50000) * 2' }),
      { baseAmountKobo: '100000' },
    );
    assert.equal(result.amountKobo, 300000n);
  });

  it('rounds integer division half-up', () => {
    // 10001 / 2 = 5000.5 → rounds up to 5001
    assert.equal(evaluateFormula('10001 / 2', {}), 5001n);
    // 10000 / 2 = 5000 exactly, no rounding needed
    assert.equal(evaluateFormula('10000 / 2', {}), 5000n);
  });

  it('throws 400 on division by zero', () => {
    assert.throws(
      () => computeAmount(baseRate({ rate_type: 'FORMULA', formula: 'baseAmountKobo / 0' }), { baseAmountKobo: '100000' }),
      (err: any) => err?.statusCode === 400,
    );
  });

  it('throws 400 on unbalanced opening bracket', () => {
    assert.throws(
      () => computeAmount(baseRate({ rate_type: 'FORMULA', formula: '(baseAmountKobo + 50000' }), { baseAmountKobo: '100000' }),
      (err: any) => err?.statusCode === 400,
    );
  });

  it('throws 400 on unsupported characters (semicolons, require, etc.)', () => {
    assert.throws(
      () => computeAmount(baseRate({ rate_type: 'FORMULA', formula: 'baseAmountKobo; DROP TABLE' }), { baseAmountKobo: '100000' }),
      (err: any) => err?.statusCode === 400,
    );
  });

  it('handles "constructor" as an ordinary named input, not as Object.prototype.constructor', () => {
    // The hasOwnProperty guard means that when an attacker passes { constructor: "100000" }
    // the engine treats it as a plain string input named "constructor" and evaluates it safely —
    // it never resolves to the Function constructor from Object.prototype.
    const result = evaluateFormula('constructor', { constructor: '100000' });
    assert.equal(result, 100000n, 'User-supplied "constructor" key must be treated as an ordinary numeric input');
  });

  it('throws 400 on missing formula input variable', () => {
    assert.throws(
      () => computeAmount(baseRate({ rate_type: 'FORMULA', formula: 'missingVar + 100' }), {}),
      (err: any) => err?.statusCode === 400,
    );
  });
});

describe('Rate engine determinism (PRD §67)', () => {
  it('produces identical results for identical inputs across multiple invocations', () => {
    const rate = baseRate({ rate_type: 'PERCENTAGE', rate_basis_points: 150 });
    const inputs = { baseAmountKobo: '33333' };

    const results = Array.from({ length: 10 }, () => computeAmount(rate, inputs));
    const first = results[0]!.amountKobo;
    for (const r of results) {
      assert.equal(r.amountKobo, first, 'Rate computation must be deterministic');
    }
  });
});

describe('Negative amount guard', () => {
  it('throws 400 when FORMULA produces a negative result', () => {
    // An agent-supplied input tricks the formula into going negative
    assert.throws(
      () => computeAmount(
        baseRate({ rate_type: 'FORMULA', formula: 'baseAmountKobo - discount' }),
        { baseAmountKobo: '100000', discount: '500000' }, // discount > base → negative
      ),
      (err: any) => err?.statusCode === 400,
    );
  });
});
