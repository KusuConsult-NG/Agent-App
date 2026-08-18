/**
 * Portal API client.
 *
 * As in the agent app, the access token stays in memory and the refresh token
 * in sessionStorage, so closing the browser ends an officer's session rather
 * than leaving a durable credential on a shared government workstation
 * (PRD §62, §54).
 */

const API_BASE = '/api/v1';

export interface ApiError {
  code: string;
  message: string;
  moneyStatus: string;
  reference?: string;
  nextStep?: string;
  details?: { field?: string; issue: string }[];
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly error: ApiError;
  /**
   * The parsed response body, exactly as PSIRS sent it.
   *
   * Not every rejection is a transport failure dressed as an envelope. Receipt
   * verification answers "no such receipt" with a verdict on a 404, and that
   * verdict is the answer the caller wants; synthesising "the request failed"
   * over it turns "this receipt was never issued" into "the check did not
   * work". Null when the body was absent or not JSON.
   */
  readonly body: unknown;

  constructor(status: number, error: ApiError, body: unknown = null) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.error = error;
    this.body = body;
  }
}

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: string;
  permissions: string[];
}

let accessToken: string | null = null;
let currentUser: User | null = null;

const REFRESH_KEY = 'psirs.portal.refresh';
const USER_KEY = 'psirs.portal.user';

export function setSession(session: { accessToken: string; refreshToken: string; user: User } | null) {
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

export function getUser(): User | null {
  if (currentUser) return currentUser;
  const stored = sessionStorage.getItem(USER_KEY);
  if (stored) {
    try {
      currentUser = JSON.parse(stored) as User;
    } catch {
      currentUser = null;
    }
  }
  return currentUser;
}

export function hasStoredSession(): boolean {
  return sessionStorage.getItem(REFRESH_KEY) !== null;
}

/**
 * Fetch a file the API will only release to an authenticated caller.
 *
 * An identity document cannot be an `<img src>`: the endpoint wants a bearer
 * token and the browser will not send one on an image request. So the bytes
 * come through fetch and become an object URL, which means two obligations the
 * caller has to keep — revoke the URL when the viewer closes, and never put it
 * anywhere it outlives the screen. This is somebody's passport photograph.
 *
 * The 401 retry mirrors `request()`: a reviewer who has been reading a long
 * application should not be signed out by the one call that fetches an image.
 */
export async function fetchFile(path: string): Promise<Blob> {
  const send = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });

  let response = await send();

  if (response.status === 401) {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        const session = await raw<{ accessToken: string; refreshToken: string; user: User }>(
          '/auth/refresh',
          { method: 'POST', body: { refreshToken }, authenticated: false },
        );
        setSession(session);
        response = await send();
      } catch {
        setSession(null);
      }
    }
  }

  if (!response.ok) {
    // The file endpoints answer JSON on failure, so the reviewer is told why
    // rather than being handed a broken image.
    let error: ApiError = {
      code: 'UNKNOWN',
      message: `The document could not be loaded (${response.status}).`,
      moneyStatus: 'NOT_APPLICABLE',
    };
    try {
      const payload = (await response.json()) as { error?: ApiError };
      if (payload.error) error = payload.error;
    } catch {
      // Leave the default.
    }
    throw new ApiRequestError(response.status, error);
  }

  return response.blob();
}

export function can(permission: string): boolean {
  return getUser()?.permissions.includes(permission) ?? false;
}

async function raw<T>(
  path: string,
  options: { method?: string; body?: unknown; authenticated?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.authenticated !== false && accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/csv')) {
    return (await response.text()) as unknown as T;
  }

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
      message: `The request failed (${response.status}).`,
      moneyStatus: 'NOT_APPLICABLE',
    };
    throw new ApiRequestError(response.status, error, payload);
  }

  return payload as T;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; authenticated?: boolean } = {},
): Promise<T> {
  try {
    return await raw<T>(path, options);
  } catch (error) {
    const expired =
      error instanceof ApiRequestError &&
      error.status === 401 &&
      ['TOKEN_EXPIRED', 'UNAUTHENTICATED'].includes(error.error.code);

    if (!expired || options.authenticated === false) throw error;

    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw error;

    try {
      const session = await raw<{ accessToken: string; refreshToken: string; user: User }>(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken }, authenticated: false },
      );
      setSession(session);
      return await raw<T>(path, options);
    } catch {
      setSession(null);
      throw error;
    }
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  /** Unauthenticated calls, for the public verification and referee portals. */
  publicGet: <T>(path: string) => raw<T>(path, { authenticated: false }),
  publicPost: <T>(path: string, body?: unknown) =>
    raw<T>(path, { method: 'POST', body, authenticated: false }),
};

export async function login(phone: string, password: string) {
  const session = await raw<{ accessToken: string; refreshToken: string; user: User }>(
    '/auth/login',
    { method: 'POST', body: { phone, password }, authenticated: false },
  );
  setSession(session);
  return session;
}

export async function restoreSession(): Promise<User | null> {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const session = await raw<{ accessToken: string; refreshToken: string; user: User }>(
      '/auth/refresh',
      { method: 'POST', body: { refreshToken }, authenticated: false },
    );
    setSession(session);
    return session.user;
  } catch {
    setSession(null);
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    // Local sign-out proceeds regardless.
  }
  setSession(null);
}

/**
 * Obtain a step-up grant (PRD §35).
 *
 * The development OTP is returned by the API only while a mock SMS provider is
 * configured, which config.ts forbids in production.
 */
export async function stepUp(action: string, phone: string): Promise<void> {
  const otp = await api.post<{ developmentCode?: string }>('/auth/otp/request', {
    destination: phone,
    purpose: 'STEP_UP',
  });

  const code =
    otp.developmentCode ??
    window.prompt('Enter the one-time code sent to your phone to authorise this action:');

  if (!code) throw new Error('A one-time code is required to continue.');
  await api.post('/auth/step-up', { action, destination: phone, code });
}

export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
