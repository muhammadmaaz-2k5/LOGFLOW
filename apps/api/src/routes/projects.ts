import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  CreateApiKeySchema,
  CreateProjectSchema,
  IngestBatchSchema,
  InviteMemberSchema,
  UpdateMemberRoleSchema,
  UpdateProjectSchema
} from '@logflow/shared';
import { getLogAdapter } from '../adapters/index.js';
import { getDb } from '../db/postgres.js';
import { generateApiKey, requireJwt } from '../middleware/auth.js';
import { ingestService } from '../services/ingestBuffer.js';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/projects', { preHandler: [requireJwt] }, async (_request, reply) => {
    const db = await getDb();
    const adapter = await getLogAdapter();
    const res = await db.query<{
      id: string;
      name: string;
      slug: string;
      retention_days: number;
      created_at: string;
    }>(`SELECT * FROM projects ORDER BY created_at ASC`);

    const projects = await Promise.all(
      res.rows.map(async (row) => {
        const activity = await adapter.getProjectActivity(row.id);
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          retention_days: Number(row.retention_days),
          created_at: new Date(row.created_at).toISOString(),
          events_per_minute: activity.eventsPerMinute,
          last_event_at: activity.lastEventAt,
          connected: activity.lastEventAt !== null
        };
      })
    );

    return reply.send({ projects });
  });

  app.post('/v1/projects', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot create projects.' }
      });
    }

    const parsed = CreateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid project payload.',
          details: parsed.error.flatten()
        }
      });
    }

    const db = await getDb();
    const id = `prj_${crypto.randomUUID().slice(0, 10)}`;
    const baseSlug = slugify(parsed.data.name) || 'project';
    const slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;

    const { rawKey, prefix, hash } = generateApiKey();
    const keyId = `key_${crypto.randomUUID().slice(0, 10)}`;

    await db.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO projects (id, name, slug, retention_days) VALUES ($1, $2, $3, $4)`,
        [id, parsed.data.name, slug, parsed.data.retention_days]
      );
      await tx.query(
        `INSERT INTO api_keys (id, project_id, name, key_prefix, key_hash, rate_limit_per_min)
         VALUES ($1, $2, $3, $4, $5, 5000)`,
        [keyId, id, 'Default Ingestion Key', prefix, hash]
      );
    });

    return reply.code(201).send({
      project: {
        id,
        name: parsed.data.name,
        slug,
        retention_days: parsed.data.retention_days,
        created_at: new Date().toISOString(),
        events_per_minute: 0,
        last_event_at: null,
        connected: false
      },
      initial_api_key: rawKey
    });
  });

  app.patch('/v1/projects/:id', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot modify project settings.' }
      });
    }

    const { id } = request.params as { id: string };
    const parsed = UpdateProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid project settings.',
          details: parsed.error.flatten()
        }
      });
    }

    const db = await getDb();
    const existing = await db.query(`SELECT * FROM projects WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Project not found.' }
      });
    }

    const nextName = parsed.data.name ?? existing.rows[0].name;
    const nextRetention = parsed.data.retention_days ?? existing.rows[0].retention_days;

    await db.query(
      `UPDATE projects SET name = $1, retention_days = $2 WHERE id = $3`,
      [nextName, nextRetention, id]
    );

    const adapter = await getLogAdapter();
    await adapter.deleteExpiredLogs(id, nextRetention);

    return reply.send({
      project: {
        ...existing.rows[0],
        name: nextName,
        retention_days: Number(nextRetention)
      }
    });
  });

  app.get('/v1/projects/:id/keys', { preHandler: [requireJwt] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = await getDb();
    const projRes = await db.query(`SELECT id FROM projects WHERE id = $1`, [id]);
    if (projRes.rows.length === 0) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Project not found.' }
      });
    }

    const res = await db.query(
      `SELECT id, project_id, name, key_prefix, rate_limit_per_min, last_used_at, revoked_at, created_at
       FROM api_keys
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    return reply.send({
      keys: res.rows.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        name: r.name,
        key_prefix: r.key_prefix,
        rate_limit_per_min: Number(r.rate_limit_per_min),
        last_used_at: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
        revoked_at: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
        created_at: new Date(r.created_at).toISOString()
      }))
    });
  });

  app.post('/v1/projects/:id/keys', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot create API keys.' }
      });
    }

    const { id } = request.params as { id: string };
    const parsed = CreateApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid API key request.',
          details: parsed.error.flatten()
        }
      });
    }

    const db = await getDb();
    const projRes = await db.query(`SELECT id FROM projects WHERE id = $1`, [id]);
    if (projRes.rows.length === 0) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Project not found.' }
      });
    }

    const { rawKey, prefix, hash } = generateApiKey();
    const keyId = `key_${crypto.randomUUID().slice(0, 10)}`;
    const nowIso = new Date().toISOString();

    await db.query(
      `INSERT INTO api_keys (id, project_id, name, key_prefix, key_hash, rate_limit_per_min, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [keyId, id, parsed.data.name, prefix, hash, parsed.data.rate_limit_per_min, nowIso]
    );

    return reply.code(201).send({
      key: {
        id: keyId,
        project_id: id,
        name: parsed.data.name,
        key_prefix: prefix,
        rate_limit_per_min: parsed.data.rate_limit_per_min,
        last_used_at: null,
        revoked_at: null,
        created_at: nowIso,
        raw_key: rawKey
      }
    });
  });

  app.delete('/v1/projects/:id/keys/:keyId', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot revoke API keys.' }
      });
    }

    const { id, keyId } = request.params as { id: string; keyId: string };
    const db = await getDb();
    await db.query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND project_id = $2`,
      [keyId, id]
    );

    return reply.send({ revoked: true, id: keyId });
  });

  // Authenticated test ingestion endpoint for UI verification / Live Tail burst (no raw API key needed in browser)
  app.post('/v1/projects/:id/ingest-test', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot ingest events.' }
      });
    }

    const { id } = request.params as { id: string };
    const db = await getDb();
    const projRes = await db.query(`SELECT id FROM projects WHERE id = $1`, [id]);
    if (projRes.rows.length === 0) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Project not found.' }
      });
    }

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

    const stored = await ingestService.ingestBatch(id, parsed.data);
    return reply.code(202).send({
      accepted: stored.length,
      project_id: id,
      ids: stored.map((e) => e.id)
    });
  });

  // Team members management (Settings page)
  app.get('/v1/team', { preHandler: [requireJwt] }, async (_request, reply) => {
    const db = await getDb();
    const res = await db.query(
      `SELECT id, email, name, role, created_at FROM users ORDER BY created_at ASC`
    );
    return reply.send({
      members: res.rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        created_at: new Date(r.created_at).toISOString()
      }))
    });
  });

  app.post('/v1/team', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only admins can invite team members.' }
      });
    }

    const parsed = InviteMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid member details.',
          details: parsed.error.flatten()
        }
      });
    }

    const db = await getDb();
    const exists = await db.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [
      parsed.data.email
    ]);
    if (exists.rows.length > 0) {
      return reply.code(409).send({
        error: { code: 'EMAIL_EXISTS', message: 'A team member with this email already exists.' }
      });
    }

    const id = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const initialPassword =
      parsed.data.password ?? `Lf_${crypto.randomBytes(12).toString('base64url')}!9`;
    const passHash = await bcrypt.hash(initialPassword, 12);
    const nowIso = new Date().toISOString();

    await db.query(
      `INSERT INTO users (id, email, password_hash, name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, parsed.data.email.toLowerCase(), passHash, parsed.data.name, parsed.data.role, nowIso]
    );

    return reply.code(201).send({
      member: {
        id,
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        role: parsed.data.role,
        created_at: nowIso
      }
    });
  });

  app.patch('/v1/team/:userId', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only admins can update roles.' }
      });
    }

    const { userId } = request.params as { userId: string };
    const parsed = UpdateMemberRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid role.' }
      });
    }

    const db = await getDb();
    await db.query(`UPDATE users SET role = $1 WHERE id = $2`, [parsed.data.role, userId]);
    return reply.send({ updated: true, id: userId, role: parsed.data.role });
  });

  app.delete('/v1/team/:userId', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Only admins can remove team members.' }
      });
    }

    const { userId } = request.params as { userId: string };
    if (userId === request.user.id) {
      return reply.code(400).send({
        error: { code: 'CANNOT_DELETE_SELF', message: 'You cannot remove your own account.' }
      });
    }

    const db = await getDb();
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return reply.send({ removed: true, id: userId });
  });
}
