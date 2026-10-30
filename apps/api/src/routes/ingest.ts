import { FastifyInstance } from 'fastify';
import { IngestBatchSchema } from '@logflow/shared';
import { requireApiKey } from '../middleware/auth.js';
import { ingestService } from '../services/ingestBuffer.js';

export async function registerIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/ingest', { preHandler: [requireApiKey] }, async (request, reply) => {
    const apiKey = request.apiKey!;

    const rawBody = Array.isArray(request.body)
      ? request.body
      : (request.body as Record<string, unknown>)?.events ??
        (request.body && typeof request.body === 'object' ? [request.body] : []);

    const parsed = IngestBatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid log event payload.',
          details: parsed.error.flatten()
        }
      });
    }

    const events = parsed.data;
    const rateCheck = ingestService.checkRateLimit(
      apiKey.id,
      events.length,
      apiKey.rate_limit_per_min
    );

    reply.header('X-RateLimit-Limit', String(apiKey.rate_limit_per_min));
    reply.header('X-RateLimit-Remaining', String(rateCheck.remaining));
    reply.header('X-RateLimit-Reset', String(Math.ceil(rateCheck.resetMs / 1000)));

    if (!rateCheck.allowed) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `API key rate limit exceeded (${apiKey.rate_limit_per_min} events/minute).`
        }
      });
    }

    const stored = await ingestService.ingestBatch(apiKey.project_id, events);

    return reply.code(202).send({
      accepted: stored.length,
      project_id: apiKey.project_id,
      ids: stored.map((e) => e.id)
    });
  });
}

