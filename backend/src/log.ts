import pino from 'pino';
import { getConfig } from './config';

const REDACT_PATHS = [
  'req.body.password',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  '*.tokenHash',
  '*.token_hash',
  '*.gpsLat',
  '*.gpsLng',
  '*.gps_lat',
  '*.gps_lng',
];

let cachedLogger: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (!cachedLogger) {
    const cfg = getConfig();
    cachedLogger = pino({
      level: cfg.LOG_LEVEL,
      base: { service: 'pixdiary-backend' },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    });
  }
  return cachedLogger;
}

/** Test helper: reset cached logger after env mutation. */
export function resetLoggerCache(): void {
  cachedLogger = undefined;
}
