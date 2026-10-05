/*
 * Lives in lib rather than in the reconciliation service so that anything can
 * import it. The service imports the fraud module (to raise a flag), and the
 * fraud module counts duplicate payments through this fragment; a constant in
 * the service would make the two import each other, which works only for as
 * long as nothing reads the binding while the modules are still loading.
 */

/**
 * One row per reconciled item: the newest thing any run concluded about it.
 *
 * `reconciliation_records` holds a row per transaction PER RUN, and that is
 * right — an auditor asking what Tuesday's sweep concluded needs Tuesday's
 * answer, not today's written over it. The sweep runs four times a day over a
 * trailing forty-eight hours, so one collection is recorded by about eight
 * runs, and a persistent exception is recorded afresh by each.
 *
 * `exceptionQueue` met this first — the same transaction listed up to eight
 * times, each with its own Resolve button — and fixed it by taking the newest
 * finding per item. Its comment said the count "is wrong everywhere it is
 * shown". It was, and the fix stayed in the queue:
 *
 *   - the month-close figure counted every run's row, and `resolveException`
 *     marks only the one row the queue shows. Measured: one mismatch seen by
 *     two sweeps reads 2; the officer resolves it, the queue empties, and the
 *     close still reports 1 unresolved exception and refuses the month — over
 *     work already done, naming an item nobody can see to act on;
 *   - the finance officer's "my work" list and home work items listed raw
 *     rows, the latter oldest first, so they showed precisely the stale rows a
 *     resolution leaves behind;
 *   - two dashboard counts were up to eight times the work;
 *   - the reconciliation rate divided MATCHED by every row ever written, so
 *     ten collections that each reconciled perfectly read 37.5 per cent —
 *     each spends its first five sweeps waiting on the bank.
 *
 * So every reader of "what is outstanding now" goes through this, the queue
 * included, and none of them can come to define the current finding
 * differently. Readers of history — the run detail, an auditor's view of one
 * sweep — keep reading the table, which is what the table is for.
 *
 * `r.*` rather than a column list, so every caller's own predicate finds the
 * columns it needs. The key falls back to the gateway reference for statement
 * lines with no platform transaction, and to the row's own id for a record
 * carrying neither, which is then simply its own item.
 */
export const CURRENT_FINDINGS_SQL = `
  SELECT DISTINCT ON (COALESCE(r.transaction_id::text, r.gateway_reference, r.id::text)) r.*
    FROM reconciliation_records r
   ORDER BY COALESCE(r.transaction_id::text, r.gateway_reference, r.id::text),
            r.created_at DESC, r.id DESC`;

