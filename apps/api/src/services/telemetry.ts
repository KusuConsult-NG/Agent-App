/**
 * Telemetry, APM & Prometheus Metrics Exporter.
 *
 * Tracks platform health, PostgreSQL connection pool metrics, background worker
 * performance, transaction velocity, and security anomalies for Prometheus,
 * Grafana, Datadog, or CloudWatch scraping.
 */

import { pool } from '../db/pool';

interface WorkerMetric {
  lastRunAt: Date | null;
  lastDurationMs: number;
  runCount: number;
  errorCount: number;
}

class TelemetryService {
  private requestCounts: Map<string, number> = new Map();
  private failedLogins: number = 0;
  private fraudFlags: number = 0;
  private workers: Map<string, WorkerMetric> = new Map();

  constructor() {
    const workerNames = [
      'commissionPromotion',
      'notificationDispatch',
      'fraudSweep',
      'tinCatchUp',
      'authorityCatchUp',
    ];
    for (const name of workerNames) {
      this.workers.set(name, {
        lastRunAt: null,
        lastDurationMs: 0,
        runCount: 0,
        errorCount: 0,
      });
    }
  }

  public recordRequest(method: string, path: string, status: number): void {
    // Normalise path to avoid high cardinality
    const cleanPath = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/[0-9A-HJ-NP-Z]{5}-[0-9A-HJ-NP-Z]{5}/gi, '/:code')
      .split('?')[0];

    const key = `${method.toUpperCase()}_${cleanPath}_${status}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);
  }

  public recordFailedLogin(): void {
    this.failedLogins++;
  }

  public recordFraudFlag(): void {
    this.fraudFlags++;
  }

  public recordWorkerRun(worker: string, durationMs: number, success: boolean): void {
    const current = this.workers.get(worker) || {
      lastRunAt: null,
      lastDurationMs: 0,
      runCount: 0,
      errorCount: 0,
    };
    current.lastRunAt = new Date();
    current.lastDurationMs = durationMs;
    current.runCount++;
    if (!success) current.errorCount++;
    this.workers.set(worker, current);
  }

  public async getHealthSummary(): Promise<Record<string, unknown>> {
    let dbStatus = 'connected';
    let dbLatencyMs = 0;

    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      dbLatencyMs = Date.now() - start;
    } catch {
      dbStatus = 'unavailable';
    }

    const mem = process.memoryUsage();

    return {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      service: 'psirs-revenue-platform',
      version: process.env.npm_package_version || '1.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingClients: pool.waitingCount,
      },
      process: {
        memoryRssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      security: {
        failedLoginsTotal: this.failedLogins,
        fraudFlagsTotal: this.fraudFlags,
      },
      workers: Object.fromEntries(
        Array.from(this.workers.entries()).map(([k, v]) => [
          k,
          {
            lastRun: v.lastRunAt?.toISOString() || null,
            durationMs: v.lastDurationMs,
            runs: v.runCount,
            errors: v.errorCount,
          },
        ]),
      ),
    };
  }

  /**
   * Formats metrics in standard Prometheus text format.
   */
  public async getPrometheusMetrics(): Promise<string> {
    const lines: string[] = [];

    // System & Uptime
    lines.push('# HELP psirs_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE psirs_uptime_seconds counter');
    lines.push(`psirs_uptime_seconds ${Math.floor(process.uptime())}`);

    const mem = process.memoryUsage();
    lines.push('# HELP psirs_memory_bytes Process memory usage in bytes.');
    lines.push('# TYPE psirs_memory_bytes gauge');
    lines.push(`psirs_memory_bytes{type="rss"} ${mem.rss}`);
    lines.push(`psirs_memory_bytes{type="heap_used"} ${mem.heapUsed}`);
    lines.push(`psirs_memory_bytes{type="heap_total"} ${mem.heapTotal}`);

    // Database Pool Metrics
    lines.push('# HELP psirs_db_pool_connections PostgreSQL pool connections.');
    lines.push('# TYPE psirs_db_pool_connections gauge');
    lines.push(`psirs_db_pool_connections{state="total"} ${pool.totalCount}`);
    lines.push(`psirs_db_pool_connections{state="idle"} ${pool.idleCount}`);
    lines.push(`psirs_db_pool_connections{state="waiting"} ${pool.waitingCount}`);

    // Security Metrics
    lines.push('# HELP psirs_security_events_total Security anomaly counters.');
    lines.push('# TYPE psirs_security_events_total counter');
    lines.push(`psirs_security_events_total{event="failed_login"} ${this.failedLogins}`);
    lines.push(`psirs_security_events_total{event="fraud_flag"} ${this.fraudFlags}`);

    // Worker Metrics
    lines.push('# HELP psirs_worker_runs_total Total worker execution count.');
    lines.push('# TYPE psirs_worker_runs_total counter');
    for (const [name, metric] of this.workers.entries()) {
      lines.push(`psirs_worker_runs_total{worker="${name}"} ${metric.runCount}`);
      lines.push(`psirs_worker_errors_total{worker="${name}"} ${metric.errorCount}`);
      lines.push(`psirs_worker_last_duration_ms{worker="${name}"} ${metric.lastDurationMs}`);
    }

    // Request Counters
    lines.push('# HELP psirs_http_requests_total Total HTTP requests handled.');
    lines.push('# TYPE psirs_http_requests_total counter');
    for (const [key, count] of this.requestCounts.entries()) {
      const parts = key.split('_');
      const method = parts[0];
      const status = parts[parts.length - 1];
      const path = parts.slice(1, parts.length - 1).join('_');
      lines.push(`psirs_http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
    }

    return lines.join('\n') + '\n';
  }
}

export const telemetry = new TelemetryService();
