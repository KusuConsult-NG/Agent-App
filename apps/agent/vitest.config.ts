/**
 * Test configuration for the agent PWA.
 *
 * The offline capture path is the code here most worth testing: it runs on a
 * field agent's phone, in a place with no signal, where a silent failure means
 * a citizen's registration is simply lost and nobody finds out. `fake-indexeddb`
 * gives the draft queue a real IndexedDB to write to, so the queue is exercised
 * rather than mocked away.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto', './src/tests-setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
