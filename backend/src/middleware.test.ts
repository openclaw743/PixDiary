import { describe, it, expect, beforeAll } from 'vitest';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { errorHandler, notFoundHandler } from './middleware/error';
import { Errors } from './errors';
import { resetConfigCache } from './config';
import { resetLoggerCache } from './log';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  process.env.LOG_LEVEL = 'silent';
  resetConfigCache();
  resetLoggerCache();
});

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    statusCode: 200,
    _status: undefined as number | undefined,
    _json: undefined as unknown,
    status(c: number) {
      this._status = c;
      this.statusCode = c;
      return this;
    },
    json(body: unknown) {
      this._json = body;
      return this;
    },
    send() {
      return this;
    },
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

describe('error middleware', () => {
  it('not-found returns 404 envelope', () => {
    const res = mockRes();
    notFoundHandler({} as Request, res, () => undefined);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: { code: 'not_found', message: 'Route not found' } });
  });

  it('handles HttpError', () => {
    const res = mockRes();
    errorHandler(
      Errors.unauthorized('nope'),
      { path: '/x', method: 'GET' } as Request,
      res,
      () => undefined,
    );
    expect(res._status).toBe(401);
    expect((res._json as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('handles ZodError', () => {
    const res = mockRes();
    const ze = new ZodError([
      {
        code: 'custom',
        path: ['email'],
        message: 'Invalid',
      },
    ]);
    errorHandler(ze, { path: '/x', method: 'POST' } as Request, res, () => undefined);
    expect(res._status).toBe(400);
    expect((res._json as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('handles generic Error as 500', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), { path: '/x', method: 'GET' } as Request, res, () => undefined);
    expect(res._status).toBe(500);
    expect((res._json as { error: { code: string } }).error.code).toBe('internal_error');
  });
});
