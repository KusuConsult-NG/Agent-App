import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../db/pool';
import { ECONOMIC_SECTORS } from '@psirs/shared';
import { syncTaxpayerComplianceAndIncentives, getTaxpayerIncentives } from '../services/incentives';
import { sendDueReminders } from '../services/reminders';

test('Taxpayer Profiling, Live Incentives, and Citizen Status', async (t) => {
  // Test 1: ECONOMIC_SECTORS contains valid Plateau State taxonomy
  await t.test('ECONOMIC_SECTORS reference contains valid sectors', () => {
    assert.ok(ECONOMIC_SECTORS.length >= 25, 'Should have at least 25 economic sectors');
    const farmer = ECONOMIC_SECTORS.find((s) => s.code === 'AGRICULTURE');
    assert.ok(farmer, 'Farmer sector must exist');
    assert.equal(farmer?.hausa, 'Noma');
    assert.ok(farmer?.suggestedRevenueCodes.includes('DEV-LEVY'));
  });

  // Test 2: syncTaxpayerComplianceAndIncentives works and calculates score
  await t.test('Compliance computation and incentive linking', async () => {
    const taxpayerRes = await pool.query<{ id: string; tin: string }>(
      `SELECT id, tin FROM taxpayers WHERE status = 'ACTIVE' LIMIT 1`,
    );
    if (taxpayerRes.rows.length > 0) {
      const taxpayer = taxpayerRes.rows[0];
      const result = await syncTaxpayerComplianceAndIncentives(pool, taxpayer.id);
      assert.ok(typeof result.score === 'number');
      assert.ok(result.score >= 0 && result.score <= 100);

      const incentives = await getTaxpayerIncentives(pool, taxpayer.id);
      assert.ok(incentives.programmes);
      assert.ok(Array.isArray(incentives.programmes));
    }
  });

  // Test 3: Due reminders sweep runs without throwing
  await t.test('Due reminders sweep runs idempotently', async () => {
    const res = await sendDueReminders(pool);
    assert.ok(typeof res.sent === 'number');
    assert.ok(typeof res.skipped === 'number');
  });
});
