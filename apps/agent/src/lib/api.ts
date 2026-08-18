/**
 * API client.
 *
 * Three responsibilities beyond fetching:
 *   * attach the device identifier and app version to every request, so the
 *     backend can enforce device trust and the minimum build (Addendum §20, §43);
 *   * keep the access token in memory only, with the refresh token persisted so
 *     an agent stays signed in offline — see the note on storage below, which
 *     explains what that costs and what pays for it;
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

/**
 * Did this fail because we could not reach PSIRS, or because PSIRS said no?
 *
 * The distinction runs through the whole offline design. A rejection is an
 * answer and the agent must act on it; a connectivity failure is not an answer
 * at all, and the right response is to keep the work on the phone and try
 * again later. Treating the second as the first is how a field agent loses a
 * capture they have already taken from a citizen — or gets signed out standing
 * in a village with no signal.
 *
 * Both shapes appear here: `fetch` throws a TypeError when the request never
 * left the device, and the service worker answers 503 OFFLINE when it is
 * controlling the page.
 */
export function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.status === 503 && error.error.code === 'OFFLINE';
  }
  // A request that never reached the network at all.
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError');
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
 * Session storage, and why it is where it is.
 *
 * The access token lives in memory only. It is short-lived, it is the thing
 * that actually authorises a request, and it is never written anywhere.
 *
 * The refresh token is persisted to `localStorage`, so an agent stays signed in
 * when the app is closed and reopened. Addendum §22 asks that sensitive
 * government data not linger in browser storage, and this is a deliberate,
 * bounded exception to it: a field agent whose phone restarts in a village with
 * no signal must be able to keep collecting, and signing in again needs the
 * connection that is missing. A session that dies with the app makes offline
 * capture work only for agents who never close it.
 *
 * The exception is paid for on the server, where it can actually be enforced:
 *
 *   * a refresh token only works on the device it was issued to, and presenting
 *     it from another device revokes the session outright;
 *   * a session chain has an absolute expiry that refreshing does not move, so
 *     possession of a token is never a permanent credential;
 *   * every session remains revocable centrally — sign-out, device revocation
 *     and agent suspension all end it immediately.
 *
 * `expiresAt` below is the client's own copy of that absolute bound. It lets a
 * phone found months later refuse to restore a session without needing to reach
 * PSIRS first. It is a convenience, not the control: the server is the control.
 *
 * No taxpayer data is persisted here. Captured records live in the IndexedDB
 * draft queue and are deleted from the device the moment the server confirms
 * them.
 */
let accessToken: string | null = null;
let currentUser: Session['user'] | null = null;
const REFRESH_KEY = 'psirs.refresh';
const USER_KEY = 'psirs.user';
const EXPIRY_KEY = 'psirs.session.expires';

/** Mirrors SESSION_ABSOLUTE_TTL_SECONDS; the server holds the real bound. */
const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function setSession(session: Session | null): void {
  accessToken = session?.accessToken ?? null;
  currentUser = session?.user ?? null;

  if (session) {
    localStorage.setItem(REFRESH_KEY, session.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    // Preserved across rotation: refreshing must not extend the bound, exactly
    // as on the server.
    if (!localStorage.getItem(EXPIRY_KEY)) {
      localStorage.setItem(EXPIRY_KEY, String(Date.now() + ABSOLUTE_TTL_MS));
    }
  } else {
    clearStoredSession();
  }
}

/**
 * Remove every trace of the session from this device.
 *
 * Works with no connectivity, because signing out on a phone that is about to
 * change hands must not depend on a network the agent may not have.
 */
export function clearStoredSession(): void {
  accessToken = null;
  currentUser = null;
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  // Anything left by an earlier build that used sessionStorage.
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(USER_KEY);
}

/** Has the stored session outlived the bound the server will also enforce? */
export function storedSessionExpired(): boolean {
  const expiry = Number(localStorage.getItem(EXPIRY_KEY));
  return Number.isFinite(expiry) && expiry > 0 && expiry < Date.now();
}

export function getUser(): Session['user'] | null {
  if (currentUser) return currentUser;
  const stored = localStorage.getItem(USER_KEY);
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
  if (storedSessionExpired()) {
    clearStoredSession();
    return false;
  }
  return localStorage.getItem(REFRESH_KEY) !== null;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  /** Set false for endpoints that must work before sign-in. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

/**
 * A request whose body is the file itself.
 *
 * It shares the session and the refresh path with everything else, but not
 * `rawRequest`: that one sets a JSON content type and serialises its body, and
 * both are wrong here. The document's own type has to reach the server intact,
 * because the server checks the bytes against it.
 */
async function uploadRequest<T>(path: string, file: Blob, filename?: string): Promise<T> {
  const query = filename ? `${path.includes('?') ? '&' : '?'}filename=${encodeURIComponent(filename)}` : '';
  const send = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}${query}`, {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-app-version': APP_VERSION,
        'x-device-id': getDeviceIdentifier(),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: file,
    });

  let response = await send();
  if (response.status === 401 && localStorage.getItem(REFRESH_KEY)) {
    // One refresh, then one retry — the same contract `request` offers.
    await restoreSession();
    response = await send();
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new ApiRequestError(response.status, (payload as { error: ApiError })?.error ?? {
      code: 'UPLOAD_FAILED',
      message: 'The document could not be sent. Try again.',
      moneyStatus: 'NOT_APPLICABLE',
    });
  }
  return payload as T;
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

/** Thrown when there is nothing to refresh with, so the original 401 stands. */
const NO_REFRESH_TOKEN = Symbol('no refresh token');

/**
 * The refresh in progress, shared by everything waiting on one.
 *
 * A refresh token is exchanged for a new one, so it may be spent exactly once.
 * Without this, every request that met a 401 at the same moment read the same
 * token from storage and sent its own refresh: opening the app fires several
 * calls at once, so an ordinary cold start raced itself. One exchange won, the
 * rest presented a token that had just been spent, and the agent was signed
 * out — mid-form, with the taxpayer in front of them.
 *
 * The server no longer lets those extra exchanges mint sessions. This stops
 * them being sent at all, which is what keeps the agent signed in.
 */
let refreshInFlight: Promise<void> | null = null;

function refreshOnce(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw NO_REFRESH_TOKEN;

    const refreshed = await rawRequest<Session>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      authenticated: false,
    });
    setSession(refreshed);
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
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

    try {
      await refreshOnce();
      return await rawRequest<T>(path, options);
    } catch (refreshError) {
      if (refreshError === NO_REFRESH_TOKEN) throw error;
      // Only a refusal ends the session. If the refresh could not reach PSIRS
      // we know nothing about whether the session is still good, and throwing
      // the agent out on a guess would strand them: signing back in needs the
      // very connection that is missing.
      if (!isConnectivityFailure(refreshError)) setSession(null);
      throw error;
    }
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),
  /**
   * Send a captured file as the request body.
   *
   * Not JSON, and deliberately not queued when offline. A draft is a record
   * the agent can finish later; a photograph of somebody's identity document
   * sitting unencrypted in browser storage on a shared handset is a different
   * proposition, and `drafts.ts` refuses financial payloads for the same kind
   * of reason. If there is no connection the agent is told to capture it when
   * there is one.
   */
  upload: async <T>(path: string, file: Blob, filename?: string): Promise<T> => {
    if (!navigator.onLine) {
      throw new Error(
        'You are offline. An identity document is sent to PSIRS as it is captured and is not ' +
          'stored on this device — take the photograph again when you have a connection.',
      );
    }
    return uploadRequest<T>(path, file, filename);
  },
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

/**
 * Restore a session on start-up.
 *
 * Opening the app without a connection must not sign the agent out. The stored
 * identity is kept and the app opens in offline capture mode: drafts can be
 * taken and are pushed once the connection returns, at which point the refresh
 * either succeeds or genuinely fails and the agent is asked to sign in.
 */
export async function restoreSession(): Promise<Session | null> {
  if (storedSessionExpired()) {
    // Past the absolute bound. Refuse locally rather than carrying a session
    // the server is going to reject anyway — a phone found long afterwards has
    // nothing usable on it even before it reaches a network.
    clearStoredSession();
    return null;
  }

  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    // Through the same single-flight gate as every other refresh. Restoring the
    // session is what happens on app start, at the same moment the first
    // screens fire their requests — the one place the exchanges were most
    // certain to collide.
    await refreshOnce();
    const user = getUser();
    if (!user) return null;
    // Rotation replaced both tokens; read back what refreshOnce stored rather
    // than returning the spent one.
    return {
      accessToken: accessToken ?? '',
      refreshToken: localStorage.getItem(REFRESH_KEY) ?? '',
      user,
    };
  } catch (error) {
    if (error === NO_REFRESH_TOKEN) return null;
    if (isConnectivityFailure(error)) {
      // Unreachable, not rejected. Keep whoever was signed in on this device.
      const user = getUser();
      return user ? ({ accessToken: '', refreshToken, user } as Session) : null;
    }
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
