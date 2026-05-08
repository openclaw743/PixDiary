import { buildApp } from './app';
import { getConfig } from './config';
import { closePool } from './db/pool';
import { getLogger } from './log';

async function main(): Promise<void> {
  const cfg = getConfig();
  const log = getLogger();
  const app = buildApp();

  const server = app.listen(cfg.PORT, () => {
    log.info({ port: cfg.PORT, env: cfg.NODE_ENV }, 'pixdiary_backend_listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutdown_started');
    server.close((err) => {
      if (err) log.error({ err }, 'http_server_close_error');
    });
    try {
      await closePool();
    } catch (err) {
      log.error({ err }, 'pool_close_error');
    }
    // Give the http server a chance to drain.
    setTimeout(() => process.exit(0), 250).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'unhandled_rejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaught_exception');
  });
}

/* c8 ignore next 6 */
void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error:', err);
  process.exit(1);
});
