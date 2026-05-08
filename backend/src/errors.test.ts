import { describe, it, expect, beforeAll } from 'vitest';
import { Errors, HttpError } from './errors';
import { resetConfigCache, loadConfig } from './config';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  resetConfigCache();
});

describe('errors', () => {
  it('builds typed HttpErrors', () => {
    const e = Errors.notFound('nope');
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(404);
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('nope');
  });

  it('attaches details when provided', () => {
    const e = Errors.conflict('dup', { field: 'email' });
    expect(e.details).toEqual({ field: 'email' });
  });
});

describe('config', () => {
  it('loads with valid env', () => {
    const cfg = loadConfig({
      ...process.env,
      DATABASE_URL: 'postgres://x:y@host:5432/db',
      JWT_SECRET: 'a'.repeat(40),
      CORS_ORIGINS: 'http://a,http://b',
    });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.corsOrigins).toEqual(['http://a', 'http://b']);
  });

  it('rejects a too-short JWT secret', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://x:y@host:5432/db',
        JWT_SECRET: 'short',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() =>
      loadConfig({
        JWT_SECRET: 'a'.repeat(40),
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
