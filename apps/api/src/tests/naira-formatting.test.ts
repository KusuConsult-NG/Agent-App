/**
 * The amounts an agent reads on their phone.
 *
 * `formatNaira` exists to render money for a person and groups the digits.
 * `koboToNaira` renders it bare, for wire formats. Every user-facing string in
 * the rate engine and the assessment refusals used the second one, so a trader
 * at a stall was shown:
 *
 *     No tax is payable on ₦300000.00
 *     2.00% of ₦1500000.00
 *     Below the statutory minimum of ₦5000.00
 *
 * ₦300000 and ₦3000000 differ by one character in a string nobody counts. On a
 * platform whose entire job is telling somebody what they owe, in the very
 * text that explains how the figure was reached, that is worth a comma.
 *
 * The gateway request in `remita.ts` deliberately keeps the bare form: that is
 * a wire value, and a comma in it would be a malformed payment.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nairaToKobo } from '@psirs/shared';
import { computeAmount, type RateVersion } from '../services/rate-engine';

const rate = (overrides: Partial<RateVersion>): RateVersion => ({
  id: 'rv-format',
  revenue_item_id: 'ri-format',
  version: 1,
  lga_id: null,
  rate_type: 'PERCENTAGE',
  fixed_amount_kobo: null,
  rate_basis_points: 200,
  tiers: null,
  formula: null,
  minimum_amount_kobo: null,
  maximum_amount_kobo: null,
  effective_from: new Date(),
  effective_to: null,
  ...overrides,
});

/** Every amount in a trace, as the agent sees it. */
function amountsIn(steps: { detail: string }[]): string[] {
  return steps.flatMap((step) => step.detail.match(/₦[\d,]+\.\d{2}/g) ?? []);
}

describe('money shown to a person is grouped', () => {
  it('groups the base in a percentage trace', () => {
    const result = computeAmount(rate({}), { baseAmountKobo: nairaToKobo('1500000').toString() });
    const shown = amountsIn(result.trace);
    assert.ok(
      shown.includes('₦1,500,000.00'),
      `the trace shows an ungrouped amount: ${JSON.stringify(shown)}`,
    );
  });

  it('groups the statutory minimum when it is applied', () => {
    const result = computeAmount(
      rate({ minimum_amount_kobo: nairaToKobo('5000').toString() }),
      { baseAmountKobo: nairaToKobo('100').toString() },
    );
    const shown = amountsIn(result.trace);
    assert.ok(shown.includes('₦5,000.00'), JSON.stringify(shown));
  });

  it('groups every band ceiling in a tiered trace', () => {
    // The personal income tax bands run to fifty million. Ungrouped, the
    // difference between one band and the next is a digit nobody counts.
    const result = computeAmount(
      rate({
        rate_type: 'TIERED',
        rate_basis_points: null,
        tiers: {
          tiers: [
            { upToKobo: nairaToKobo('800000').toString(), basisPoints: 0 },
            { upToKobo: nairaToKobo('3000000').toString(), basisPoints: 1500 },
            { upToKobo: null, basisPoints: 2500 },
          ],
        },
      }),
      { baseAmountKobo: nairaToKobo('5000000').toString() },
    );
    // As displayed, not stripped: a grouped amount never shows four digits in
    // a row. Removing the commas first — which the first version of this did —
    // makes the check pass for everything and prove nothing.
    const ungrouped = amountsIn(result.trace).filter((amount) =>
      /\d{4}/.test(amount.split('.')[0]!),
    );
    assert.deepEqual(
      ungrouped,
      [],
      `a band boundary is shown ungrouped: ${JSON.stringify(ungrouped)}`,
    );
  });

  it('leaves the gateway wire format alone', async () => {
    // A comma in a payment request is a malformed payment. This asserts the
    // fix did not reach for a blanket replace.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/integrations/gateways/remita.ts', 'utf8'),
    );
    assert.match(
      source,
      /koboToNaira\(request\.amountKobo\)/,
      'the Remita request should still send a bare amount',
    );
  });
});
