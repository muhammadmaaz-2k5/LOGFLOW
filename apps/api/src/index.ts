import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { getLogAdapter } from './adapters/index.js';
import { config } from './config.js';
import { closeMongo } from './db/mongo.js';
import { getDb } from './db/postgres.js';
import { registerAlertRoutes } from './routes/alerts.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerProjectRoutes } from './routes/projects.js';
import { ingestService } from './services/ingestBuffer.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.isProduction,
    bodyLimit: 2 * 1024 * 1024
  });

  const allowedOrigins = config.corsOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : allowedOrigins,
    credentials: true
  });

  await app.register(websocket);

  await getDb();
  await getLogAdapter();

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const safeMessage =
      statusCode >= 500 && config.isProduction
        ? 'An unexpected server error occurred.'
        : error.message || 'An unexpected server error occurred.';

    reply.code(statusCode).send({
      error: {
        code: error.code ?? 'INTERNAL_SERVER_ERROR',
        message: safeMessage
      }
    });
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'logflow-api',
    driver: config.logStoreDriver,
    timestamp: new Date().toISOString()
  }));

  await registerAuthRoutes(app);
  await registerIngestRoutes(app);
  await registerLogRoutes(app);
  await registerProjectRoutes(app);
  await registerAlertRoutes(app);

  return app;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('src/index.ts');
if (isMain) {
  buildApp()
    .then(async (app) => {
      await app.listen({ port: config.port, host: config.host });
      console.log(`🚀 LogFlow API listening on http://localhost:${config.port}`);

      const shutdown = async (signal: string) => {
        console.log(`\n[LogFlow API] Received ${signal}, shutting down gracefully...`);
        try {
          await ingestService.flush();
          await app.close();
          const db = await getDb();
          await db.close();
          await closeMongo();
          process.exit(0);
        } catch (err) {
          console.error('[LogFlow API] Error during shutdown:', err);
          process.exit(1);
        }
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((err) => {
      console.error('Failed to start LogFlow API:', err);
      process.exit(1);
    });
}
