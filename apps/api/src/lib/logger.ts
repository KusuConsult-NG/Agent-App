/**
 * Structured logging.
 *
 * Every line the platform emits in production is one JSON object on one line,
 * because that is the only form a log aggregator can filter, and "grep the
 * container output" is not an answer when a citizen is asking what happened to
 * their money. In development the same records are printed as readable text,
 * since nobody is shipping a developer's terminal anywhere.
 *
 * Two rules govern what may go in a record.
 *
 * The first is that a log is not an audit trail. `audit_logs` is the record of
 * who did what to which row, it is append-only and enforced by trigger, and it
 * is what answers a dispute. Logs are for operators diagnosing behaviour, they
 * are lossy, and nothing may depend on them for evidence.
 *
 * The second is redaction. PRD §62 minimises what identity data the platform
 * holds at all, and a log line is the easiest place to undo that by accident —
 * an error object carrying a request body, a debug line printing a token. The
 * redactor below runs over every field of every record rather than trusting
 * each call site to remember, because the call site that forgets is the one
 * that ships.
 */

import { config } from '../config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return config.isProduction ? 'info' : 'debug';
}

const threshold = LEVEL_ORDER[configuredLevel()];

/**
 * Field names whose values never appear in a log, at any level.
 *
 * Matched case-insensitively against the whole key, and against keys that
 * merely contain one of these words, so `password`, `newPassword` and
 * `password_hash` are all caught by one entry.
 */
const SECRET_KEYS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'otp',
  'code',
  'signature',
  'identitynumber',
  'identity_number',
  'identityhash',
  'identity_hash',
  'bvn',
  'nin',
  'accountnumber',
  'account_number',
  'pin',
];

const REDACTED = '[redacted]';

function isSecretKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z_]/g, '');
  return SECRET_KEYS.some((secret) => normalised.includes(secret.replace(/[^a-z_]/g, '')));
}

/**
 * A value safe to serialise.
 *
 * Depth-limited and cycle-safe: a log call must never be the thing that throws,
 * and an Express request or a pg client passed in by accident is deep enough to
 * hang a naive walk.
 */
function sanitise(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[depth]';

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return (value as bigint).toString();
  if (type === 'function' || type === 'symbol') return undefined;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // Stacks go to operators, not to callers; the error handler decides
      // separately what a caller is told.
      stack: config.isProduction ? value.stack?.split('\n').slice(0, 12).join('\n') : value.stack,
    };
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((entry) => sanitise(entry, depth + 1, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        output[key] = REDACTED;
        continue;
      }
      const cleaned = sanitise(entry, depth + 1, seen);
      if (cleaned !== undefined) output[key] = cleaned;
    }
    return output;
  }

  return String(value);
}

export interface LogFields {
  /** Correlates a line with the request that produced it, and with an audit row. */
  requestId?: string;
  /** The subsystem: `payments`, `worker.reconciliation`, `http`. */
  component?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < threshold) return;

  const record = {
    level,
    time: new Date().toISOString(),
    message,
    ...(sanitise(fields) as Record<string, unknown>),
  };

  // console is the transport on purpose: a container's stdout is what every
  // aggregator already collects, and adding a shipping client here would put a
  // network dependency in the path of every log line.
  const line = config.isProduction ? JSON.stringify(record) : format(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Human-readable rendering for a developer's terminal. */
function format(record: Record<string, unknown>): string {
  const { level, time, message, ...rest } = record;
  const head = `[${String(time).slice(11, 19)}] ${String(level).toUpperCase().padEnd(5)} ${message}`;
  const tail = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return head + tail;
}

export const log = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),

  /** A logger that stamps `component` on everything, for a subsystem to hold. */
  child(component: string) {
    return {
      debug: (message: string, fields?: LogFields) => emit('debug', message, { ...fields, component }),
      info: (message: string, fields?: LogFields) => emit('info', message, { ...fields, component }),
      warn: (message: string, fields?: LogFields) => emit('warn', message, { ...fields, component }),
      error: (message: string, fields?: LogFields) => emit('error', message, { ...fields, component }),
    };
  },
};

/** Exported for the test that pins redaction. */
export const __testing = { sanitise, isSecretKey };
