import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { LogLevel, LogQueryParamsSchema } from '@logflow/shared';
import { getLogAdapter } from '../adapters/index.js';
import { config } from '../config.js';
import { getDb } from '../db/postgres.js';
import { requireJwt } from '../middleware/auth.js';
import { liveTailHub } from '../services/liveTailHub.js';

const VALID_LEVELS = new Set<LogLevel>(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

function parseLevelsParam(levelParam?: string): LogLevel[] | undefined {
  if (!levelParam) return undefined;
  const levels = levelParam
    .split(',')
    .map((l) => l.trim().toLowerCase() as LogLevel)
    .filter((l) => VALID_LEVELS.has(l));
  return levels.length > 0 ? levels : undefined;
}

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/logs', { preHandler: [requireJwt] }, async (request, reply) => {
    const parsed = LogQueryParamsSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters.',
          details: parsed.error.flatten()
        }
      });
    }

    const { projectId, q, level, service, traceId, from, to, limit, offset } = parsed.data;
    const db = await getDb();
    const projCheck = await db.query(`SELECT id FROM projects WHERE id = $1`, [projectId]);
    if (projCheck.rows.length === 0) {
      return reply.code(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' }
      });
    }

    const adapter = await getLogAdapter();
    const levels = parseLevelsParam(level);
    const services = service
      ? service
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const result = await adapter.queryLogs({
      projectId,
      q,
      levels,
      services,
      traceId,
      from,
      to,
      limit,
      offset
    });

    return reply.send(result);
  });

  app.get('/v1/logs/stats', { preHandler: [requireJwt] }, async (request, reply) => {
    const query = request.query as { projectId?: string; rangeHours?: string };
    if (!query.projectId) {
      return reply.code(400).send({
        error: { code: 'MISSING_PROJECT_ID', message: 'projectId query parameter is required.' }
      });
    }

    const db = await getDb();
    const projCheck = await db.query(`SELECT id FROM projects WHERE id = $1`, [query.projectId]);
    if (projCheck.rows.length === 0) {
      return reply.code(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' }
      });
    }

    const parsedHours = Number(query.rangeHours ?? 24);
    const rangeHours = Number.isFinite(parsedHours) ? Math.min(Math.max(parsedHours, 1), 168) : 24;
    const adapter = await getLogAdapter();
    const stats = await adapter.getOverviewStats(query.projectId, rangeHours);
    return reply.send(stats);
  });

  // Server-Sent Events (SSE) Live Tail stream
  app.get('/v1/logs/tail', { preHandler: [requireJwt] }, async (request, reply) => {
    const query = request.query as {
      projectId?: string;
      q?: string;
      level?: string;
      service?: string;
    };

    if (!query.projectId) {
      return reply.code(400).send({
        error: { code: 'MISSING_PROJECT_ID', message: 'projectId query parameter is required.' }
      });
    }

    const allowedOrigin =
      config.corsOrigin === '*' ? request.headers.origin || '*' : config.corsOrigin.split(',')[0];

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': allowedOrigin
    });

    const subId = `sse_${crypto.randomUUID()}`;
    const levels = parseLevelsParam(query.level);
    const services = query.service
      ? query.service.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ subscriberId: subId })}\n\n`);

    const unsubscribe = liveTailHub.subscribe({
      id: subId,
      projectId: query.projectId,
      q: query.q,
      levels,
      services,
      send: (event) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping ${Date.now()}\n\n`);
    }, 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // WebSocket Live Tail stream
  app.get('/v1/logs/ws', { websocket: true, preHandler: [requireJwt] }, (socket, request) => {
    const query = request.query as {
      projectId?: string;
      q?: string;
      level?: string;
      service?: string;
    };

    const projectId = query.projectId ?? 'prj_production_core';
    const subId = `ws_${crypto.randomUUID()}`;
    const levels = parseLevelsParam(query.level);
    const services = query.service
      ? query.service.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const unsubscribe = liveTailHub.subscribe({
      id: subId,
      projectId,
      q: query.q,
      levels,
      services,
      send: (event) => {
        socket.send(JSON.stringify({ type: 'log', event }));
      }
    });

    socket.on('close', () => {
      unsubscribe();
    });
  });
}
