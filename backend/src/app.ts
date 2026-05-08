import express, { type Express } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { getConfig } from './config';
import { getLogger } from './log';
import { errorHandler, notFoundHandler } from './middleware/error';
import { generalLimiter } from './middleware/rate-limit';
import { buildAuthRouter } from './routes/auth';
import { buildHealthRouter } from './routes/health';

export function buildApp(): Express {
  const cfg = getConfig();
  const log = getLogger();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger: log,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Pino-http honors logger.redact, configured in log.ts.
    }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // server-to-server / curl
        if (cfg.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));

  // Health endpoints are not rate-limited — probes hit them often.
  app.use(buildHealthRouter());

  app.use(generalLimiter());

  app.use(buildAuthRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
