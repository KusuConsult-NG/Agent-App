/**
 * API client.
 *
 * Three responsibilities beyond fetching:
 *   * attach the device identifier and app version to every request, so the
 *     backend can enforce device trust and the minimum build (Addendum §20, §43);
 *   * keep the access token in memory only, with the refresh token in
 *     sessionStorage — Addendum §22 warns against leaving sensitive government
 *     data in persistent browser storage;
 *   * surface the backend's error contract intact, so screens can show the
 *     money-status wording of PRD §60 rather than inventing their own.
 */

import { getDeviceIdentifier } from './device';

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0';

const API_BASE = '/api/v1';

export interface ApiError {
  code: string;
  message: string;
  moneyStatus: 'NOT_DEBITED' | 'UNCONFIRMED' | 'RECEIVED' | 'NOT_APPLICABLE';
  reference?: string;
  nextStep?: string;
  details?: { field?: string; issue: string }[];
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly error: ApiError;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.error = error;
  }
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    role: string;
    permissions: string[];
    agentId?: string;
  };
}

/**
 * The access token lives in memory only: it is short-lived and never written
 * to disk. The refresh token goes to sessionStorage so a reload inside the
 * same tab survives, but closing the app ends the session.
 */
let accessToken: string | null = null;
let currentUser: Session['user'] | null = null;
const REFRESH_KEY = 'psirs.refresh';
const USER_KEY = 'psirs.user';

export function setSession(session: Session | null): void {
  accessToken = session?.accessToken ?? null;
  currentUser = session?.user ?? null;
  if (session) {
    sessionStorage.setItem(REFRESH_KEY, session.refreshToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(session.user));
  } else {
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(USER_KEY);
  }
}

export function getUser(): Session['user'] | null {
  if (currentUser) return currentUser;
  const stored = sessionStorage.getItem(USER_KEY);
  if (stored) {
    try {
      currentUser = JSON.parse(stored) as Session['user'];
    } catch {
      currentUser = null;
    }
  }
  return currentUser;
}

export function hasStoredSession(): boolean {
  return sessionStorage.getItem(REFRESH_KEY) !== null;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  /** Set false for endpoints that must work before sign-in. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-app-version': APP_VERSION,
    'x-device-id': getDeviceIdentifier(),
  };

  if (options.authenticated !== false && accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: ApiError })?.error ?? {
      code: 'UNKNOWN',
      message: `The request failed (${response.status}). Try again, or contact support.`,
      moneyStatus: 'NOT_APPLICABLE' as const,
    };
    throw new ApiRequestError(response.status, error);
  }

  return payload as T;
}

/**
 * Perform a request, transparently refreshing an expired access token once.
 *
 * Only one refresh is attempted: repeated failures mean the session is really
 * gone, and looping would lock a field agent out of the error message telling
 * them to sign in again.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    const isExpired =
      error instanceof ApiRequestError &&
      error.status === 401 &&
      (error.error.code === 'TOKEN_EXPIRED' || error.error.code === 'UNAUTHENTICATED');

    if (!isExpired || options.authenticated === false) throw error;

    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw error;

    try {
      const refreshed = await rawRequest<Session>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        authenticated: false,
      });
      setSession(refreshed);
      return await rawRequest<T>(path, options);
    } catch {
      setSession(null);
      throw error;
    }
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),
};

export async function login(phone: string, password: string): Promise<Session> {
  const session = await rawRequest<Session>('/auth/login', {
    method: 'POST',
    body: { phone, password },
    authenticated: false,
  });
  setSession(session);
  return session;
}

export async function restoreSession(): Promise<Session | null> {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const session = await rawRequest<Session>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      authenticated: false,
    });
    setSession(session);
    return session;
  } catch {
    setSession(null);
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // Signing out locally must succeed even if the network call does not.
  }
  setSession(null);
}

/** A stable idempotency key per user action (PRD §61). */
export function newIdempotencyKey(scope: string): string {
  return `${scope}-${crypto.randomUUID()}`;
}
