import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Errors } from '../errors';
import { requireAuth } from '../middleware/auth';
import { getEntriesLimiter } from '../middleware/rate-limit';
import { exportData, hardDeleteAccount } from '../services/account';

const DeleteSchema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal('DELETE MY ACCOUNT'),
});

export function buildAccountRouter(): Router {
  const r = Router();

  /**
   * Full data export. Streamed as JSON; for v1 the in-memory dump is small
   * enough that we just JSON.stringify and pipe.
   */
  r.get(
    '/export',
    requireAuth,
    getEntriesLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const payload = await exportData(req.user.id);
        const body = JSON.stringify(payload);
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader(
          'content-disposition',
          `attachment; filename="pixdiary-export-${new Date().toISOString().slice(0, 10)}.json"`,
        );
        res.setHeader('content-length', String(Buffer.byteLength(body)));
        res.status(200).end(body);
      } catch (err) {
        next(err);
      }
    },
  );

  r.delete(
    '/account',
    requireAuth,
    getEntriesLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const body = DeleteSchema.parse(req.body);
        await hardDeleteAccount(req.user.id, body.password, body.confirm);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  return r;
}
