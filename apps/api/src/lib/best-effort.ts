/**
 * Work whose failure must not fail the request — and must not vanish either.
 *
 * Some writes are evidence rather than control. Recording that somebody looked
 * a taxpayer up, that a permission was refused, that a receipt was downloaded:
 * none of them is a reason to refuse the thing the citizen or officer came
 * for, and `routes/citizen.ts` states the trade plainly —
 *
 *     A failure to write the log must never fail the citizen's lookup: this
 *     is evidence, not a control, and refusing to tell somebody what they owe
 *     because an audit insert failed would be the wrong trade.
 *
 * That reasoning is right and this does not change it. What it changes is the
 * second half, which was missing: eleven sites swallowed the failure with
 * `.catch(() => undefined)` and logged nothing, so the platform's record of
 * who looked up whom, who was refused, and who read the receipt book could
 * stop being written with no signal in any log, table or metric. The audit
 * trail is load-bearing across this system's design, and a hole in it that
 * nothing reports is worse than a hole somebody can see.
 *
 * NOT A LOG LINE PER REQUEST. If PostgreSQL is unreachable then
 * `sessions.last_used_at` fails on every authenticated request, and a warning
 * emitted that often is not a warning — it buries the one line somebody
 * needed and costs real money in an aggregator. So each operation reports its
 * first failure at once and then at most one line a minute, carrying the count
 * it suppressed. A reader learns both that it is failing and how hard.
 */

import { log } from './logger';

const logger = log.child('best-effort');

/** How long an operation stays quiet after reporting, and what it owes. */
const QUIET_MS = 60_000;

interface Throttle {
  /** When this operation last produced a line. */
  reportedAt: number;
  /** Failures since then that produced none. */
  suppressed: number;
}

const throttles = new Map<string, Throttle>();

/** Test seam: the throttle is per-process and a test needs a clean one. */
export function __resetBestEffort(): void {
  throttles.clear();
}

/**
 * Whether this failure gets a line, and how many it speaks for.
 *
 * `null` means stay quiet. Reading and writing the same entry here keeps the
 * decision and the bookkeeping in one place, so a caller cannot report without
 * resetting the count.
 */
function claim(operation: string, now: number): number | null {
  const existing = throttles.get(operation);
  if (existing && now - existing.reportedAt < QUIET_MS) {
    existing.suppressed += 1;
    return null;
  }
  const spokenFor = (existing?.suppressed ?? 0) + 1;
  throttles.set(operation, { reportedAt: now, suppressed: 0 });
  return spokenFor;
}

export interface BestEffortOptions {
  /**
   * `warn` for a record that was lost. `error` where the failure compounds —
   * an advisory lock that stays held blocks every later run of the same job,
   * and a background pass that dies has no caller left to tell.
   */
  level?: 'warn' | 'error';
  /** Anything that makes the line actionable: ids, the request, the subject. */
  detail?: Record<string, unknown>;
}

/**
 * Run `work`, swallow its failure, and say so.
 *
 * Always resolves, so `await` cannot throw and `void` cannot produce an
 * unhandled rejection. `operation` is the throttle key as well as the label,
 * so keep it stable and specific: `audit.access_denied`, not `insert failed`.
 */
export function bestEffort(
  operation: string,
  work: Promise<unknown>,
  options: BestEffortOptions = {},
): Promise<void> {
  return Promise.resolve(work).then(
    () => undefined,
    (error: unknown) => {
      // A failure to log a failure has nowhere left to go, and must not become
      // the unhandled rejection that takes the process down.
      try {
        const spokenFor = claim(operation, Date.now());
        if (spokenFor === null) return;
        const emit = options.level === 'error' ? logger.error : logger.warn;
        emit(`${operation} did not complete, and was not allowed to fail the request`, {
          operation,
          reason: error instanceof Error ? error.message : String(error),
          /*
           * `errorCode`, not `code`. Postgres puts the useful part here —
           * 22P02 for a bad cast, 23505 for a duplicate, 57P01 for a server
           * shutting down underneath us — but `code` is a credential word in
           * `lib/logger`'s redaction list, because that is how a one-time
           * code is logged. A field called `code` arrives as `[redacted]`,
           * which is the whole point of the `errorcode` exception already in
           * `NOT_SECRET_KEYS`. Widening the redaction rule to let this
           * through would risk an OTP.
           */
          errorCode:
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code: unknown }).code)
              : undefined,
          ...(spokenFor > 1 ? { alsoSpeaksFor: spokenFor - 1 } : {}),
          ...options.detail,
        });
      } catch {
        // Deliberately the one empty catch in this file.
      }
    },
  );
}
