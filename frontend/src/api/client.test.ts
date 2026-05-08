import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetApiClientForTests,
  ApiError,
  apiRequest,
} from '@/api/client';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/auth/tokenStorage';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function makeFetch(responses: Array<() => Promise<Response> | Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch call to ${String(input)}`);
    }
    return Promise.resolve(next());
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('apiRequest', () => {
  beforeEach(() => {
    clearTokens();
    __resetApiClientForTests();
  });
  afterEach(() => {
    clearTokens();
    __resetApiClientForTests();
  });

  it('sends the access token as a Bearer header when present', async () => {
    setTokens('access-1', 'refresh-1');
    const { fetchImpl, calls } = makeFetch([() => jsonResponse(200, { ok: true })]);
    const result = await apiRequest<{ ok: boolean }>('/me', {}, fetchImpl);
    expect(result).toEqual({ ok: true });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer access-1');
  });

  it('JSON-encodes object bodies and sets Content-Type', async () => {
    const { fetchImpl, calls } = makeFetch([() => jsonResponse(200, { ok: true })]);
    await apiRequest('/x', { method: 'POST', body: { foo: 'bar' } }, fetchImpl);
    expect(calls[0]!.init.body).toBe(JSON.stringify({ foo: 'bar' }));
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws ApiError with the server envelope on non-2xx', async () => {
    const { fetchImpl } = makeFetch([
      () =>
        jsonResponse(400, {
          error: { code: 'validation_failed', message: 'Bad email' },
        }),
    ]);
    await expect(apiRequest('/auth/signup', { method: 'POST' }, fetchImpl)).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'validation_failed',
      message: 'Bad email',
    });
  });

  it('throws ApiError with a generic envelope when the body is not JSON', async () => {
    const { fetchImpl } = makeFetch([
      () => new Response('not json', { status: 500 }),
    ]);
    const err = await apiRequest('/x', {}, fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).code).toBe('unknown_error');
  });

  it('returns undefined on 204 No Content', async () => {
    const { fetchImpl } = makeFetch([() => emptyResponse(204)]);
    const result = await apiRequest('/auth/logout', { method: 'POST' }, fetchImpl);
    expect(result).toBeUndefined();
  });

  describe('refresh-on-401', () => {
    it('refreshes the token pair once and retries the original request', async () => {
      setTokens('expired-access', 'good-refresh');
      const { fetchImpl, calls } = makeFetch([
        // 1) original request → 401
        () => jsonResponse(401, { error: { code: 'token_expired', message: 'expired' } }),
        // 2) refresh → 200 with new tokens
        () =>
          jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }),
        // 3) retry of original → 200
        () => jsonResponse(200, { id: 'u-1', email: 'a@b.c' }),
      ]);

      const result = await apiRequest<{ id: string }>('/me', {}, fetchImpl);
      expect(result).toEqual({ id: 'u-1', email: 'a@b.c' });

      // Three calls total: original, refresh, retry.
      expect(calls).toHaveLength(3);
      expect(calls[0]!.url).toMatch(/\/me$/);
      expect(calls[1]!.url).toMatch(/\/auth\/refresh$/);
      expect(calls[1]!.init.body).toBe(JSON.stringify({ refreshToken: 'good-refresh' }));
      expect(calls[2]!.url).toMatch(/\/me$/);

      // Retry uses the rotated access token.
      const retryHeaders = calls[2]!.init.headers as Record<string, string>;
      expect(retryHeaders['Authorization']).toBe('Bearer new-access');

      // Storage now holds the new pair.
      expect(getAccessToken()).toBe('new-access');
      expect(getRefreshToken()).toBe('new-refresh');
    });

    it('does not retry a second time when the refresh itself returns 401', async () => {
      setTokens('expired-access', 'stale-refresh');
      const { fetchImpl, calls } = makeFetch([
        () => jsonResponse(401, { error: { code: 'token_expired', message: 'expired' } }),
        () => jsonResponse(401, { error: { code: 'invalid_refresh', message: 'no' } }),
      ]);

      const err = await apiRequest('/me', {}, fetchImpl).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      // Only two calls: original + refresh. No retry.
      expect(calls).toHaveLength(2);
      // Tokens cleared after a failed refresh.
      expect(getAccessToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
    });

    it('does not attempt refresh when no refresh token is present', async () => {
      // No tokens at all.
      const { fetchImpl, calls } = makeFetch([
        () => jsonResponse(401, { error: { code: 'unauthorized', message: 'nope' } }),
      ]);
      const err = await apiRequest('/me', {}, fetchImpl).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      // Only the original call — no /auth/refresh.
      expect(calls).toHaveLength(1);
    });

    it('retries only ONCE: a second 401 from the same call is not refreshed again', async () => {
      // Validates the "single refresh-on-401 retry" requirement — even if the
      // retried request is itself 401, we surface it instead of looping.
      setTokens('expired-access', 'good-refresh');
      const { fetchImpl, calls } = makeFetch([
        () => jsonResponse(401, { error: { code: 'token_expired', message: 'expired' } }),
        () =>
          jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }),
        // retry that itself returns 401 — we must NOT refresh again.
        () => jsonResponse(401, { error: { code: 'still_no', message: 'still no' } }),
      ]);
      // We don't expose a public flag for "skip refresh on retry" — instead the
      // implementation is responsible. Asserting the call count is the proxy.
      const err = await apiRequest('/me', {}, fetchImpl).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      // 1 original + 1 refresh + 1 retry. No second refresh.
      expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    });

    it('shares a single in-flight refresh across concurrent 401s', async () => {
      setTokens('expired-access', 'good-refresh');
      let refreshCalls = 0;
      const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) {
          refreshCalls += 1;
          return Promise.resolve(
            jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }),
          );
        }
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (headers['Authorization'] === 'Bearer new-access') {
          return Promise.resolve(jsonResponse(200, { url }));
        }
        return Promise.resolve(
          jsonResponse(401, { error: { code: 'token_expired', message: 'expired' } }),
        );
      }) as unknown as typeof fetch;

      const [a, b] = await Promise.all([
        apiRequest<{ url: string }>('/me', {}, fetchImpl),
        apiRequest<{ url: string }>('/settings', {}, fetchImpl),
      ]);
      expect(a.url).toMatch(/\/me$/);
      expect(b.url).toMatch(/\/settings$/);
      expect(refreshCalls).toBe(1); // not 2 — concurrent 401s share one refresh
    });
  });
});
