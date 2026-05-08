/**
 * Typed fetch wrapper for the PixDiary backend.
 *
 * Responsibilities:
 *  - Resolve the base URL from `VITE_API_BASE_URL` (defaults to `/api` so the
 *    Vite dev proxy / SWA proxy take over).
 *  - Inject the access token from sessionStorage on every request (when set).
 *  - On 401, attempt EXACTLY ONE refresh round-trip against `/auth/refresh`:
 *      - if refresh succeeds → store new token pair, retry the original request.
 *      - if refresh fails    → clear tokens, surface the original 401 as an
 *        `ApiError` with code `unauthorized`. Caller decides what to do
 *        (typically: redirect to /login).
 *  - Concurrent 401s share a single in-flight refresh promise so we never fire
 *    multiple `/auth/refresh` calls from one expired access token.
 *  - Map non-OK responses into a typed `ApiError` with the server's error
 *    envelope `{ error: { code, message, details } }` when present.
 *
 * Endpoints used in this PR: `/auth/signup`, `/auth/login`, `/auth/refresh`,
 * `/auth/logout`, `/me`. No other backend routes are called from the frontend
 * skeleton (per issue #8 constraints).
 */

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '@/auth/tokenStorage';

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = envelope.code;
    this.details = envelope.details;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: Record<string, string>;
  /** When true (only used internally by the refresh path) skip the refresh-on-401 retry. */
  skipAuthRefresh?: boolean;
}

const DEFAULT_BASE = '/api';

function getBaseUrl(): string {
  // Vite injects this at build time; in tests we may not have it set.
  const envBase =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_API_BASE_URL as string | undefined)
      : undefined;
  const base = envBase && envBase.length > 0 ? envBase : DEFAULT_BASE;
  return base.replace(/\/+$/, '');
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${getBaseUrl()}${normalized}`;
}

let inflightRefresh: Promise<boolean> | null = null;

async function refreshOnce(fetchImpl: typeof fetch): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;

  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  inflightRefresh = (async (): Promise<boolean> => {
    try {
      const response = await fetchImpl(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearTokens();
        return false;
      }
      const data = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      if (!data.accessToken || !data.refreshToken) {
        clearTokens();
        return false;
      }
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

async function parseError(response: Response): Promise<ApiError> {
  let envelope: ApiErrorEnvelope = {
    code: 'unknown_error',
    message: response.statusText || `HTTP ${response.status}`,
  };
  try {
    const text = await response.text();
    if (text) {
      const json = JSON.parse(text) as { error?: ApiErrorEnvelope };
      if (json && json.error && typeof json.error === 'object') {
        envelope = {
          code: json.error.code ?? envelope.code,
          message: json.error.message ?? envelope.message,
          details: json.error.details,
        };
      }
    }
  } catch {
    // body not JSON → fall through to generic envelope
  }
  return new ApiError(response.status, envelope);
}

async function buildRequestInit(opts: RequestOptions): Promise<RequestInit> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (opts.body instanceof FormData || typeof opts.body === 'string') {
      body = opts.body as BodyInit;
    } else {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      body = JSON.stringify(opts.body);
    }
  }
  const accessToken = getAccessToken();
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  // Strip our extension before forwarding to fetch.
  const { body: _body, headers: _headers, skipAuthRefresh: _skip, ...rest } = opts;
  void _body;
  void _headers;
  void _skip;
  const init: RequestInit = { ...rest, headers };
  if (body !== undefined) init.body = body;
  return init;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const url = buildUrl(path);
  const init = await buildRequestInit(opts);
  let response = await fetchImpl(url, init);

  if (response.status === 401 && !opts.skipAuthRefresh) {
    const refreshed = await refreshOnce(fetchImpl);
    if (refreshed) {
      // Rebuild init so the retry picks up the rotated access token.
      const retryInit = await buildRequestInit(opts);
      response = await fetchImpl(url, retryInit);
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  return readJson<T>(response);
}

export const api = {
  get: <T>(path: string, opts: RequestOptions = {}) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts: RequestOptions = {}) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};

// Test-only: lets unit tests reset the in-flight refresh latch between cases.
export function __resetApiClientForTests(): void {
  inflightRefresh = null;
}
