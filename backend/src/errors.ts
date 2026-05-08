/**
 * Domain error class for the API. The error middleware maps these to JSON.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

export const Errors = {
  validationFailed: (details?: Record<string, unknown>) =>
    new HttpError(400, 'validation_failed', 'Request validation failed', details),
  unauthorized: (message = 'Unauthorized') => new HttpError(401, 'unauthorized', message),
  forbidden: (message = 'Forbidden') => new HttpError(403, 'forbidden', message),
  notFound: (message = 'Not found') => new HttpError(404, 'not_found', message),
  conflict: (message: string, details?: Record<string, unknown>) =>
    new HttpError(409, 'conflict', message, details),
  rateLimited: (message = 'Too many requests') => new HttpError(429, 'rate_limited', message),
  internal: (message = 'Internal server error') => new HttpError(500, 'internal_error', message),
};
