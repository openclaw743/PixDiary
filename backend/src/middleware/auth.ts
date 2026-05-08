import type { Request, RequestHandler } from 'express';
import { Errors } from '../errors';
import { verifyAccessToken } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string };
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) throw Errors.unauthorized('Missing bearer token');
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    next(err);
  }
};

function extractBearerToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m && m[1] ? m[1].trim() : undefined;
}
