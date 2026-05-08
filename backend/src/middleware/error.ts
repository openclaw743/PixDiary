import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors';
import { getLogger } from '../log';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ErrorBody = { error: { code: 'not_found', message: 'Route not found' } };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const log = getLogger();

  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        details: { issues: err.issues },
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof HttpError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.status).json(body);
    return;
  }

  log.error({ err, path: req.path, method: req.method }, 'unhandled_error');
  const body: ErrorBody = {
    error: { code: 'internal_error', message: 'Internal server error' },
  };
  res.status(500).json(body);
};
