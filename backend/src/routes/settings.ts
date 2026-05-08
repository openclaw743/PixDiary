import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Errors } from '../errors';
import { requireAuth } from '../middleware/auth';
import { getEntriesLimiter } from '../middleware/rate-limit';
import { getSettings, updateSettings } from '../services/account';

const PutSchema = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    dailyCapEur: z.number().min(0.1).max(5.0).optional(),
  })
  .refine((v) => v.timezone !== undefined || v.dailyCapEur !== undefined, {
    message: 'at least one of {timezone, dailyCapEur} required',
  });

export function buildSettingsRouter(): Router {
  const r = Router();

  r.get(
    '/settings',
    requireAuth,
    getEntriesLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const out = await getSettings(req.user.id);
        res.status(200).json(out);
      } catch (err) {
        next(err);
      }
    },
  );

  r.put(
    '/settings',
    requireAuth,
    getEntriesLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const body = PutSchema.parse(req.body);
        const out = await updateSettings(req.user.id, body);
        res.status(200).json(out);
      } catch (err) {
        next(err);
      }
    },
  );

  return r;
}
