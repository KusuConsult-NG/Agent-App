/**
 * Error reporting.
 *
 * An unexpected exception in a revenue platform is not a log line. It is a
 * taxpayer who paid and did not get a receipt, or an officer whose approval did
 * not stick, and somebody has to find out within minutes rather than when a
 * complaint reaches the office.
 *
 * Which service PSIRS uses to receive these is a procurement decision, exactly
 * as it is for SMS and KYC, so this follows the same shape as those adapters:
 * one explicit contract, a `mock` that only records, and an HTTP implementation
 * that posts to whatever endpoint is configured. Sentry, GlitchTip, Rollbar and
 * a plain webhook into an operations channel all accept a JSON POST, so no
 * vendor SDK is needed and none is added — an SDK in this position is a
 * dependency that runs inside the failure path it is supposed to report.
 *
 * Two rules, both learned from the notification queue:
 *
 *   * Reporting is best-effort and must never throw into the caller. An
 *     alerting outage cannot be allowed to turn a handled error into an
 *     unhandled one, or a working request into a failed one.
 *   * Nothing sensitive leaves the building. The payload goes through the same
 *     redactor as the logs, because an exception report is the single most
 *     likely place for a request body carrying an identity number to escape.
 */

import { config } from '../../config';
import { log } from '../../lib/logger';
import { __testing } from '../../lib/logger';

export interface ErrorReport {
  message: string;
  error?: unknown;
  /** The correlation id, so a report can be tied back to logs and audit rows. */
  requestId?: string;
  component?: string;
  /** Anything else that helps diagnosis. Redacted before it is sent. */
  context?: Record<string, unknown>;
  /** `error` pages an operator; `warning` is recorded but not urgent. */
  severity?: 'error' | 'warning';
}

export interface ErrorReporter {
  readonly name: string;
  report(report: ErrorReport): Promise<void>;
}

/** Records reports in memory. Development, tests, and the assertion target. */
export class MockErrorReporter implements ErrorReporter {
  readonly name = 'mock';
  readonly reports: ErrorReport[] = [];

  async report(report: ErrorReport): Promise<void> {
    this.reports.push(report);
  }

  reset(): void {
    this.reports.length = 0;
  }
}

/**
 * Posts one JSON object per report to a configured endpoint.
 *
 * The shape is deliberately flat and generic rather than any one vendor's
 * envelope, so an operations webhook can read it as-is and a vendor-specific
 * relay is a few lines rather than a rewrite.
 */
export class HttpErrorReporter implements ErrorReporter {
  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly environment: string,
  ) {}

  async report(report: ErrorReport): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const error = report.error;
      const body = {
        environment: this.environment,
        service: 'psirs-revenue-platform',
        severity: report.severity ?? 'error',
        message: report.message,
        component: report.component ?? null,
        requestId: report.requestId ?? null,
        timestamp: new Date().toISOString(),
        exception:
          error instanceof Error
            ? {
                type: error.name,
                value: error.message,
                stack: error.stack?.split('\n').slice(0, 30).join('\n') ?? null,
              }
            : error === undefined
              ? null
              : { type: 'unknown', value: String(error), stack: null },
        // The same redactor the logs use. An exception report is the likeliest
        // place for an identity number or a token to leave the building.
        context: __testing.sanitise(report.context ?? {}),
      };

      const response = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        // Logged, not thrown, and deliberately not re-reported — a reporter
        // that reports its own failures to itself is a loop.
        log.warn('error report was refused by the reporting endpoint', {
          component: 'error-reporting',
          status: response.status,
        });
      }
    } catch (failure) {
      log.warn('error report could not be delivered', {
        component: 'error-reporting',
        reason: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function select(): ErrorReporter {
  const provider = config.observability.errorReporting;
  if (provider === 'mock' || !config.observability.errorReportingUrl) {
    return new MockErrorReporter();
  }
  return new HttpErrorReporter(
    provider,
    config.observability.errorReportingUrl,
    config.observability.errorReportingApiKey,
    config.observability.errorReportingTimeoutMs,
    config.env,
  );
}

export const errorReporter: ErrorReporter = select();

/**
 * Report an error without ever failing because of it.
 *
 * Every call site is somewhere that has already gone wrong, so this swallows
 * whatever the reporter does and returns immediately rather than making the
 * caller await a network round trip.
 */
export function reportError(report: ErrorReport): void {
  void Promise.resolve()
    .then(() => errorReporter.report(report))
    .catch(() => undefined);
}
