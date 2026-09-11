import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/tests-setup.ts'],
    /*
     * One file at a time. Seventeen seconds for a suite that does not lie.
     *
     * Screens here render and fetch on mount, and React's scheduler queues its
     * work as a macrotask. With files running in parallel, that work could
     * outlive the environment it belonged to and wake in the check phase to a
     * `window` that had gone — `ReferenceError: window is not defined`,
     * reported against whichever file happened to be running rather than the
     * one that caused it, failing no assertion and exiting 1.
     *
     * Measured: 4 runs in 25 carried it. Never once when a file ran alone.
     * The fetch shim in `tests-setup.ts` cut it to about 1 in 20; serialising
     * removed it across every run tried.
     *
     * The cost is 12s to 29s. That is worth paying: a suite that is red one
     * run in twenty teaches people to re-run it, and a re-run is exactly how
     * a real failure gets waved through.
     */
    fileParallelism: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
