/**
 * Portal API client.
 *
 * As in the agent app, the access token stays in memory and the refresh token
 * in sessionStorage, so closing the browser ends an officer's session rather
 * than leaving a durable credential on a shared government workstation
 * (PRD §62, §54).
 */

import { getTranslation } from '@psirs/shared';
import { getPortalLanguage } from './i18n';

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
      code: 'DOCUMENT_FAILED',
      // Never rendered: `DOCUMENT_FAILED` is in `TRANSLATED_ERRORS`, so
      // `ErrorAlert` shows the dictionary and ignores this. Lower case, this
      // codebase's mark for a line nobody reads.
      message: `document could not be loaded, status ${response.status}`,
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
      // Never rendered: see `DOCUMENT_FAILED` above.
      message: `request failed with status ${response.status}`,
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
  /**
   * The API uses PUT for one thing: replacing a taxpayer's set of obligations
   * with the set that should remain. The endpoint existed before this did, and
   * so had no caller.
   */
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
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

  /*
   * Asked, and refused, in the officer's own language.
   *
   * Step-up guards every consequential money decision in this portal — signing
   * an audit report, approving a payout, reversing a payment — and both of
   * these sentences were English literals in a module the English-literal
   * check did not read. The officer portal has offered Hausa since it was
   * translated; this was the one prompt that never was.
   *
   * Resolved through `getTranslation` rather than a hook because this is not a
   * component: it is called from inside the handler, after the officer has
   * already pressed the button.
   */
  const t = getTranslation(getPortalLanguage());
  const code = otp.developmentCode ?? window.prompt(t.stepUpEnterCode);

  /*
   * Thrown as an `ApiRequestError`, deliberately, though no request failed.
   *
   * Thirty-three handlers across this portal write
   * `caught instanceof ApiRequestError ? caught.error : null` — so anything
   * else lands as `null` and the officer is shown nothing at all. Pressing
   * "sign the report", dismissing the code prompt, and watching the button
   * stop spinning with no explanation was the whole of the feedback.
   *
   * Giving it the shape those handlers already read is the change that reaches
   * every one of them. That the shape is named for requests is a fair
   * complaint about the name; it is not a reason to leave an officer guessing.
   */
  if (!code) {
    throw new ApiRequestError(0, {
      code: 'STEP_UP_ABANDONED',
      message: t.stepUpCodeRequired,
      moneyStatus: 'NOT_APPLICABLE',
    });
  }
  await api.post('/auth/step-up', { action, destination: phone, code });
}

/**
 * Send one file as the request body.
 *
 * The API takes the file itself rather than a multipart envelope -- one
 * document at a time, its type declared in the header and checked against the
 * bytes on the far side -- so this sets the Content-Type from the file and
 * sends the bytes. Everything else about a request (the bearer token, the
 * refresh-and-retry on a stale session, reading the API's own sentence out of
 * a refusal) has to hold here too, and is why this sits beside the other
 * clients rather than inside a screen.
 */
export async function uploadFile(path: string, file: File): Promise<unknown> {
  const send = async (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': file.type,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: file,
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

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      (payload as { error?: ApiError } | null)?.error ?? {
        code: 'UPLOAD_FAILED',
        // Never rendered: see `DOCUMENT_FAILED` above.
        message: `upload failed with status ${response.status}`,
        moneyStatus: 'NOT_APPLICABLE',
      },
      payload,
    );
  }
  return payload;
}

/**
 * Ask the API for a report in one of the formats it can write, and save it.
 *
 * `downloadCsv` below takes rows the screen already has and turns them into a
 * file in the browser, which is right for a table the officer is looking at.
 * It cannot produce a workbook or a PDF, and it would be the wrong place to
 * try: those are written by the server, counted against the role's export
 * limit, and recorded in the audit log. A second, client-side writer would
 * produce files that never appear in that record.
 *
 * Built on `fetchFile` rather than beside it, so an export inherits the same
 * bearer token, the same refresh-and-retry on a stale session, and the same
 * habit of reading the API's own sentence out of a refusal -- which for an
 * export is usually the row limit for the officer's role, and is exactly what
 * they need to be told.
 */
export async function downloadExport(
  path: string,
  format: 'csv' | 'xlsx' | 'pdf',
  filename: string,
): Promise<void> {
  const separator = path.includes('?') ? '&' : '?';
  const blob = await fetchFile(`${path}${separator}format=${format}`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
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
