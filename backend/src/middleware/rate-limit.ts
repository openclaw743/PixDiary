import type { Request } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { getConfig } from '../config';

interface LimiterOpts {
  /** Requests per window. */
  max: number;
  /** Window in ms. Default 60s. */
  windowMs?: number;
  /** Optional custom key generator. Defaults to per-IP. */
  keyGenerator?: (req: Request) => string;
}

/** Per-user key generator. Falls back to IP when there's no req.user. */
export function userKeyGenerator(req: Request): string {
  return req.user?.id ?? req.ip ?? 'unknown';
}

function makeLimiter(opts: LimiterOpts): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs ?? 60_000,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: opts.keyGenerator,
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

/**
 * Per-user limiter for POST /uploads. Default: 50 photos / 10 min / user.
 * Requires `requireAuth` to be applied first so `req.user` is set.
 */
export function uploadsLimiter(): RateLimitRequestHandler {
  return makeLimiter({
    max: getConfig().RATE_LIMIT_UPLOADS_PER_10MIN,
    windowMs: 10 * 60_000,
    keyGenerator: userKeyGenerator,
  });
}

/**
 * Per-user limiter for POST /entries/draft. Default: 20 / hour / user.
 * Requires `requireAuth` to be applied first so `req.user` is set.
 */
export function draftsLimiter(): RateLimitRequestHandler {
  return makeLimiter({
    max: getConfig().RATE_LIMIT_DRAFTS_PER_HOUR,
    windowMs: 60 * 60_000,
    keyGenerator: userKeyGenerator,
  });
}

/**
 * Per-user limiter for POST /entries/:id/regenerate. Default: 5 / day / user.
 * Requires `requireAuth` to be applied first so `req.user` is set.
 */
export function regenLimiter(): RateLimitRequestHandler {
  return makeLimiter({
    max: getConfig().RATE_LIMIT_REGEN_PER_DAY,
    windowMs: 24 * 60 * 60_000,
    keyGenerator: userKeyGenerator,
  });
}

/**
 * Per-user limiter for GET /entries* read endpoints. 600 / min / user.
 * Requires `requireAuth` to be applied first so `req.user` is set.
 */
export function getEntriesLimiter(): RateLimitRequestHandler {
  return makeLimiter({
    max: 600,
    windowMs: 60_000,
    keyGenerator: userKeyGenerator,
  });
}
