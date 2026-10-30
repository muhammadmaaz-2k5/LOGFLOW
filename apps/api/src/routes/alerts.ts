import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { CreateAlertRuleSchema, UpdateAlertRuleSchema } from '@logflow/shared';
import { getDb } from '../db/postgres.js';
import { requireJwt } from '../middleware/auth.js';
import { deliverEmailWithRetry, deliverWebhookWithRetry } from '../services/alertEvaluator.js';

export async function registerAlertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/alerts/rules', { preHandler: [requireJwt] }, async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };
    const db = await getDb();

    const res = projectId
      ? await db.query(`SELECT * FROM alert_rules WHERE project_id = $1 ORDER BY created_at DESC`, [
          projectId
        ])
      : await db.query(`SELECT * FROM alert_rules ORDER BY created_at DESC`);

    return reply.send({
      rules: res.rows.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        name: r.name,
        service: r.service ?? null,
        level: r.level,
        query: r.query ?? null,
        threshold_count: Number(r.threshold_count),
        window_minutes: Number(r.window_minutes),
        notify_email: r.notify_email ?? null,
        notify_webhook_url: r.notify_webhook_url ?? null,
        enabled: Boolean(r.enabled),
        last_triggered_at: r.last_triggered_at ? new Date(r.last_triggered_at).toISOString() : null,
        created_at: new Date(r.created_at).toISOString()
      }))
    });
  });

  app.post('/v1/alerts/rules', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot create alert rules.' }
      });
    }

    const body = request.body as Record<string, unknown>;
    const projectId = String(body?.project_id ?? '').trim();
    if (!projectId) {
      return reply.code(400).send({
        error: { code: 'MISSING_PROJECT_ID', message: 'project_id is required.' }
      });
    }

    const db = await getDb();
    const projRes = await db.query(`SELECT id FROM projects WHERE id = $1`, [projectId]);
    if (projRes.rows.length === 0) {
      return reply.code(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' }
      });
    }

    const parsed = CreateAlertRuleSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid alert rule.',
          details: parsed.error.flatten()
        }
      });
    }

    const data = parsed.data;
    const id = `alr_${crypto.randomUUID().slice(0, 10)}`;
    const nowIso = new Date().toISOString();

    await db.query(
      `INSERT INTO alert_rules
       (id, project_id, name, service, level, query, threshold_count, window_minutes, notify_email, notify_webhook_url, enabled, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        projectId,
        data.name,
        data.service || null,
        data.level,
        data.query || null,
        data.threshold_count,
        data.window_minutes,
        data.notify_email || null,
        data.notify_webhook_url || null,
        data.enabled,
        nowIso
      ]
    );

    return reply.code(201).send({
      rule: {
        id,
        project_id: projectId,
        name: data.name,
        service: data.service || null,
        level: data.level,
        query: data.query || null,
        threshold_count: data.threshold_count,
        window_minutes: data.window_minutes,
        notify_email: data.notify_email || null,
        notify_webhook_url: data.notify_webhook_url || null,
        enabled: data.enabled,
        last_triggered_at: null,
        created_at: nowIso
      }
    });
  });

  app.patch('/v1/alerts/rules/:id', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot update alert rules.' }
      });
    }

    const { id } = request.params as { id: string };
    const parsed = UpdateAlertRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid alert update payload.',
          details: parsed.error.flatten()
        }
      });
    }

    const db = await getDb();
    const existingRes = await db.query(`SELECT * FROM alert_rules WHERE id = $1`, [id]);
    const existing = existingRes.rows[0];
    if (!existing) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Alert rule not found.' }
      });
    }

    const updated = {
      name: parsed.data.name ?? existing.name,
      service: parsed.data.service !== undefined ? parsed.data.service : existing.service,
      level: parsed.data.level ?? existing.level,
      query: parsed.data.query !== undefined ? parsed.data.query : existing.query,
      threshold_count: parsed.data.threshold_count ?? existing.threshold_count,
      window_minutes: parsed.data.window_minutes ?? existing.window_minutes,
      notify_email:
        parsed.data.notify_email !== undefined ? parsed.data.notify_email : existing.notify_email,
      notify_webhook_url:
        parsed.data.notify_webhook_url !== undefined
          ? parsed.data.notify_webhook_url
          : existing.notify_webhook_url,
      enabled: parsed.data.enabled !== undefined ? parsed.data.enabled : existing.enabled
    };

    await db.query(
      `UPDATE alert_rules
       SET name = $1, service = $2, level = $3, query = $4, threshold_count = $5, window_minutes = $6,
           notify_email = $7, notify_webhook_url = $8, enabled = $9
       WHERE id = $10`,
      [
        updated.name,
        updated.service,
        updated.level,
        updated.query,
        updated.threshold_count,
        updated.window_minutes,
        updated.notify_email,
        updated.notify_webhook_url,
        updated.enabled,
        id
      ]
    );

    return reply.send({
      rule: {
        ...existing,
        ...updated,
        threshold_count: Number(updated.threshold_count),
        window_minutes: Number(updated.window_minutes),
        enabled: Boolean(updated.enabled)
      }
    });
  });

  app.delete('/v1/alerts/rules/:id', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot delete alert rules.' }
      });
    }

    const { id } = request.params as { id: string };
    const db = await getDb();
    await db.query(`DELETE FROM alert_rules WHERE id = $1`, [id]);
    return reply.send({ deleted: true, id });
  });

  app.post('/v1/alerts/rules/:id/test', { preHandler: [requireJwt] }, async (request, reply) => {
    if (request.user?.role === 'viewer') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Viewers cannot trigger test alerts.' }
      });
    }

    const { id } = request.params as { id: string };
    const db = await getDb();
    const res = await db.query(`SELECT * FROM alert_rules WHERE id = $1`, [id]);
    const rule = res.rows[0];
    if (!rule) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Alert rule not found.' }
      });
    }

    const nowIso = new Date().toISOString();
    const channels: string[] = [];

    if (rule.notify_webhook_url) {
      channels.push(`webhook:${rule.notify_webhook_url}`);
      deliverWebhookWithRetry(rule.notify_webhook_url, {
        alert: `[TEST] ${rule.name}`,
        rule_id: rule.id,
        project_id: rule.project_id,
        matched_count: Number(rule.threshold_count),
        window_minutes: Number(rule.window_minutes),
        sample_message: 'Synthetic alert rule verification test event',
        triggered_at: nowIso
      }).catch(() => {});
    }

    if (rule.notify_email) {
      channels.push(`email:${rule.notify_email}`);
      deliverEmailWithRetry(
        rule.notify_email,
        `[LogFlow Test Alert] ${rule.name}`,
        `Test notification for alert rule "${rule.name}".`
      ).catch(() => {});
    }

    const historyId = `alh_${crypto.randomUUID().slice(0, 12)}`;
    await db.query(
      `INSERT INTO alert_history (id, rule_id, rule_name, project_id, matched_count, window_minutes, sample_message, channels_notified, triggered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        historyId,
        rule.id,
        rule.name,
        rule.project_id,
        Number(rule.threshold_count),
        Number(rule.window_minutes),
        'Manual test trigger from Alert Rules console',
        JSON.stringify(channels),
        nowIso
      ]
    );

    return reply.send({
      triggered: true,
      history_id: historyId,
      channels_notified: channels
    });
  });

  app.get('/v1/alerts/history', { preHandler: [requireJwt] }, async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };
    const db = await getDb();

    const res = projectId
      ? await db.query(
          `SELECT * FROM alert_history WHERE project_id = $1 ORDER BY triggered_at DESC LIMIT 100`,
          [projectId]
        )
      : await db.query(`SELECT * FROM alert_history ORDER BY triggered_at DESC LIMIT 100`);

    return reply.send({
      history: res.rows.map((r) => ({
        id: r.id,
        rule_id: r.rule_id,
        rule_name: r.rule_name,
        project_id: r.project_id,
        matched_count: Number(r.matched_count),
        window_minutes: Number(r.window_minutes),
        sample_message: r.sample_message,
        channels_notified: Array.isArray(r.channels_notified)
          ? r.channels_notified
          : JSON.parse(String(r.channels_notified || '[]')),
        triggered_at: new Date(r.triggered_at).toISOString()
      }))
    });
  });
}
