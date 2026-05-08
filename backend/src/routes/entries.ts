import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Errors } from '../errors';
import { requireAuth } from '../middleware/auth';
import { draftsLimiter, regenLimiter } from '../middleware/rate-limit';
import {
  createOrReplaceDraft,
  getEntry,
  listEntries,
  markEntryForRegenerate,
  saveEntry,
  softDeleteEntry,
} from '../services/entries';
import { startEntryPipeline } from '../services/aiOrchestrator';

const DraftSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  photoIds: z.array(z.string().uuid()).min(1).max(25),
});

const SaveSchema = z.object({
  text: z.string().min(1).max(5000),
});

const RegenSchema = z
  .object({
    quality: z.enum(['standard', 'better']).optional(),
  })
  .optional();

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .optional(),
});

const UuidParam = z.string().uuid();

export function buildEntriesRouter(): Router {
  const r = Router();

  r.post(
    '/entries/draft',
    requireAuth,
    draftsLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const body = DraftSchema.parse(req.body);
        const { entryId, status } = await createOrReplaceDraft(
          req.user.id,
          body.entryDate,
          body.photoIds,
        );
        // Fire-and-forget AI pipeline
        void startEntryPipeline(entryId);
        res.status(202).json({ entryId, status });
      } catch (err) {
        next(err);
      }
    },
  );

  r.get('/entries', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw Errors.unauthorized();
      const q = ListQuerySchema.parse(req.query);
      const out = await listEntries(req.user.id, {
        limit: q.limit ?? 30,
        cursor: q.cursor ?? null,
        from: q.from ?? null,
        to: q.to ?? null,
      });
      res.status(200).json(out);
    } catch (err) {
      next(err);
    }
  });

  r.get('/entries/:entryId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw Errors.unauthorized();
      const id = UuidParam.parse(req.params.entryId);
      const entry = await getEntry(req.user.id, id);
      res.status(200).json(entry);
    } catch (err) {
      next(err);
    }
  });

  r.put('/entries/:entryId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw Errors.unauthorized();
      const id = UuidParam.parse(req.params.entryId);
      const body = SaveSchema.parse(req.body);
      const entry = await saveEntry(req.user.id, id, body.text);
      res.status(200).json(entry);
    } catch (err) {
      next(err);
    }
  });

  r.delete(
    '/entries/:entryId',
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const id = UuidParam.parse(req.params.entryId);
        await softDeleteEntry(req.user.id, id);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  r.post(
    '/entries/:entryId/regenerate',
    requireAuth,
    regenLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw Errors.unauthorized();
        const id = UuidParam.parse(req.params.entryId);
        const body = RegenSchema.parse(req.body) ?? {};
        const tier = body.quality === 'better' ? 'better' : 'default';
        await markEntryForRegenerate(req.user.id, id);
        void startEntryPipeline(id, { tier });
        res.status(202).json({ status: 'processing' });
      } catch (err) {
        next(err);
      }
    },
  );

  return r;
}
