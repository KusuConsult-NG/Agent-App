/**
 * Test configuration for the government portal.
 *
 * The navigation table is the thing here most worth testing. It decides which
 * screens each of six roles can reach, and it has already shipped two bugs of
 * the same shape — a link offered to a role whose screen then answered 403, and
 * a screen hidden from the role it was written for. Neither was catchable
 * without signing in as that role and looking.
 *
 * These are pure-function tests over the permission table, so they need no DOM.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
