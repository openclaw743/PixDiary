import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { getConfig } from '../config';

interface LimiterOpts {
  /** Requests per window. */
  max: number;
  /** Window in ms. Default 60s. */
  windowMs?: number;
}

function makeLimiter(opts: LimiterOpts): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs ?? 60_000,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: { code: 'rate_limited', message: 'Too many requests' },
    },
  });
}

/** Per-IP limiter for /auth/signup and /auth/login. */
export function authLimiter(): RateLimitRequestHandler {
  return makeLimiter({ max: getConfig().RATE_LIMIT_AUTH_PER_MIN });
}

/** Per-IP general limiter for everything else. */
export function generalLimiter(): RateLimitRequestHandler {
  return makeLimiter({ max: getConfig().RATE_LIMIT_GENERAL_PER_MIN });
}

/** Looser limiter for /auth/refresh (legitimately frequent). */
export function refreshLimiter(): RateLimitRequestHandler {
  return makeLimiter({ max: Math.max(getConfig().RATE_LIMIT_AUTH_PER_MIN * 6, 30) });
}
