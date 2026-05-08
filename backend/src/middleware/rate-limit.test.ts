/**
 * Unit tests for the rate-limit middleware factories.
 *
 * We assert two things:
 *   1. The per-user limiters extract a key from `req.user.id` when present.
 *   2. They fall back to `req.ip` (and finally `'unknown'`) when there's no user.
 *
 * The actual express-rate-limit store behavior is exercised by integration
 * tests; here we only need to verify the key generator and that the factory
 * returns a usable middleware.
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { resetConfigCache } from '../config';
import {
  authLimiter,
  draftsLimiter,
  generalLimiter,
  getEntriesLimiter,
  refreshLimiter,
  regenLimiter,
  uploadsLimiter,
  userKeyGenerator,
} from './rate-limit';

function setEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost:5432/pixdiary';
  process.env.JWT_SECRET = 'rate-limit-test-secret-rate-limit-test-secret';
  resetConfigCache();
}

describe('userKeyGenerator', () => {
  it('returns req.user.id when present', () => {
    const req = { user: { id: 'user-123' }, ip: '1.2.3.4' } as unknown as Request;
    expect(userKeyGenerator(req)).toBe('user-123');
  });

  it('falls back to req.ip when there is no user', () => {
    const req = { ip: '5.6.7.8' } as unknown as Request;
    expect(userKeyGenerator(req)).toBe('5.6.7.8');
  });

  it('returns "unknown" when neither user nor ip is set', () => {
    const req = {} as unknown as Request;
    expect(userKeyGenerator(req)).toBe('unknown');
  });
});

describe('rate limiter factories', () => {
  it('all factories return a middleware function', () => {
    setEnv();
    for (const make of [
      authLimiter,
      generalLimiter,
      refreshLimiter,
      uploadsLimiter,
      draftsLimiter,
      regenLimiter,
      getEntriesLimiter,
    ]) {
      const mw = make();
      expect(typeof mw).toBe('function');
      // express-rate-limit handlers accept (req, res, next).
      expect(mw.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('uploads/drafts/regen/getEntries limiters can be invoked without crashing', async () => {
    setEnv();
    const mws = {
      uploads: uploadsLimiter(),
      drafts: draftsLimiter(),
      regen: regenLimiter(),
      getEntries: getEntriesLimiter(),
    };
    for (const [name, mw] of Object.entries(mws)) {
      const req = {
        user: { id: 'u-1' },
        ip: '127.0.0.1',
        method: 'GET',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
        app: { get: () => undefined },
      } as unknown as Request;
      const res = {
        setHeader: () => undefined,
        getHeader: () => undefined,
        statusCode: 200,
      } as unknown as import('express').Response;
      // Just ensure invocation doesn't throw synchronously and the factory
      // returns a callable — the per-user key extraction is unit-tested above.
      await new Promise<void>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mw as any)(req, res, () => resolve());
        // Resolve after a short tick if next isn't called synchronously; the
        // limiter does an async store check on first invocation.
        setTimeout(() => resolve(), 50);
      });
      expect(typeof mw, `${name} factory returned wrong type`).toBe('function');
    }
  });
});
