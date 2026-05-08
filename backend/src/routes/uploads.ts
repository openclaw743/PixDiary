import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Errors } from '../errors';
import { requireAuth } from '../middleware/auth';
import { uploadsLimiter } from '../middleware/rate-limit';
import { issueUploads, MAX_UPLOAD_BYTES } from '../services/uploads';
import { SUPPORTED_MIME_TYPES } from '../services/blob';

const ItemSchema = z.object({
  filename: z.string().min(1).max(512),
  mimeType: z.enum(SUPPORTED_MIME_TYPES as [string, ...string[]]),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

const Schema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  items: z.array(ItemSchema).min(1).max(25),
});

export function buildUploadsRouter(): Router {
  const r = Router();
  r.post(
    '/uploads',
    requireAuth,
    uploadsLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const body = Schema.parse(req.body);
        const items = await issueUploads(req.user.id, body.entryDate, body.items);
        res.status(200).json({ items });
      } catch (err) {
        next(err);
      }
    },
  );
  return r;
}
