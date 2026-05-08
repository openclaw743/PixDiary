import { Router, type Request, type Response } from 'express';
import { getPool } from '../db/pool';
import { getLogger } from '../log';

export function buildHealthRouter(): Router {
  const r = Router();

  r.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  r.get('/readyz', async (_req: Request, res: Response) => {
    const log = getLogger();
    const pool = getPool();
    try {
      const result = await Promise.race([
        pool.query('SELECT 1'),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('db_timeout')), 1000),
        ),
      ]);
      void result;
      res.status(200).json({ status: 'ok', db: 'ok' });
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'readyz_db_check_failed');
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  return r;
}
