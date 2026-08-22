# Load and soak measurement

`npm run load-test` (`apps/api/src/db/load-test.ts`), 10,000 taxpayers, single
machine, PostgreSQL 16 local. Run 22 August 2026.

Closes the certification's **"Performance under load — Not tested"** row, with
the limits stated below.

## What this is worth, and what it is not

One machine, no network, warm cache, one PostgreSQL instance. The absolute
milliseconds are a floor rather than a forecast.

**Read the movement, not the numbers.** How a figure changes between 1 and 32
concurrent callers is a property of the design and holds across environments.
How many milliseconds it took on this machine is not.

## The finding that matters

The audit chain is a **global serialisation point on every write**, and it caps
the platform at roughly **600 audit appends per second no matter how much
hardware is added.**

```
audit chain append, c=1     p50  1.57ms   p99  3.59ms   ≈ 637 appends/sec
audit chain append, c=4     p50  6.67ms   p99 12.93ms   ≈ 600 appends/sec
audit chain append, c=16    p50 28.95ms   p99 39.17ms   ≈ 553 appends/sec
```

Latency rises almost exactly in step with concurrency — 1.57 → 6.67 → 28.95ms
for 1 → 4 → 16 — while total throughput stays flat and drifts slightly down.
That is the signature of a resource behind one lock, and here it is deliberate:

```ts
// Serialise chain appends: two concurrent writers reading the same tail hash
// would produce a fork that no verifier could replay.
await advisoryLock(client, LOCK_NAMESPACE.AUDIT_CHAIN, 'audit');
```

`audit_logs` is tamper-evident — each entry hashes its predecessor — and that
property is worth more than throughput. **The design is right.** What was
missing is that nobody had measured what it costs.

### What the ceiling means in revenue terms

Every money movement writes audit entries. One complete collection — register,
assess, invoice, initiate, confirm, receipt, commission — produces on the order
of 14 audit actions, so the platform ceiling is roughly **40 complete
collections per second**, or about 150,000 per hour.

For Plateau State that is comfortable. It is still worth knowing three things
about it:

1. **Horizontal scaling will not move it.** The lock is global. A second API
   instance adds capacity everywhere except here.
2. **It degrades as latency, not as errors.** At high contention, collections do
   not fail — they queue. The symptom would be agents reporting the app is slow
   on market day, not an alert.
3. **It is the first thing to look at** if collection ever feels slow under
   load, because nothing else on the write path is serialised this way.

No change is recommended now. If the ceiling is ever approached, the options are
batching appends within a transaction, or sharding the chain per entity type —
both of which weaken the single-chain guarantee, so neither should be done
speculatively.

## Read paths

```
taxpayer search by name, c=1      p50  3.39ms   p99  5.17ms
taxpayer search by name, c=8      p50  5.50ms   p99 20.50ms
taxpayer search by name, c=32     p50 16.52ms   p99 46.07ms

TIN exact lookup, c=1             p50  0.14ms   p99  0.68ms
TIN exact lookup, c=8             p50  0.76ms   p99  2.71ms
TIN exact lookup, c=32            p50  2.42ms   p99  4.77ms
```

Zero errors throughout. TIN lookup — the hot path an agent hits for every
taxpayer — stays under 5ms at p99 with 32 concurrent callers, on an index.

Name search degrades faster because `ILIKE 'x%'` over 10,000 rows is doing real
work, but 46ms at p99 under 32 concurrent searches is acceptable for a
type-ahead. Worth revisiting at 100,000 taxpayers; a trigram index is the answer
if it becomes one.

## Query plans

Every hot path uses an index. Checked by asking the planner with `EXPLAIN
ANALYZE` rather than reading `pg_indexes`, because an index existing and the
planner choosing it are different facts.

| Path | Time | Plan |
|---|---|---|
| taxpayer by TIN | 0.026 ms | index |
| taxpayer by phone | 0.027 ms | index |
| taxpayer by sector (incentive targeting) | 0.349 ms | index |
| outstanding TIN queue | 0.046 ms | index |
| audit log tail | 0.040 ms | index |
| unsettled payments (reconciliation input) | 0.014 ms | index |

**No sequential scans on any path that matters.** The sector index added by
migration 016 is being used, which matters because incentive targeting scans it
for every programme evaluation.

## Still not measured

Stated so the gap is not mistaken for a clean bill:

- **A full collection under load.** This measures the audit chain, which is the
  bottleneck, but not the end-to-end lifecycle at concurrency.
- **The reconciliation sweep at volume.** It runs four times daily over a
  trailing window that grows with the platform.
- **Sustained soak.** These runs are minutes. Connection-pool exhaustion, memory
  growth and index bloat appear over days.
- **A production topology.** No network latency, no replica lag, no connection
  pooler.

## Reproducing

```bash
npm run load-test              # 10,000 taxpayers
LOAD_TAXPAYERS=50000 npm run load-test
```

Additive against an existing database — it tops up to the target rather than
resetting, so it can be pointed at a staging deployment that already has data.
