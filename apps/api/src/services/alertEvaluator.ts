import crypto from 'node:crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { isSafeWebhookUrl, LogLevel, StoredLogEvent } from '@logflow/shared';
import { getLogAdapter } from '../adapters/index.js';
import { config } from '../config.js';
import { getDb } from '../db/postgres.js';

let mailTransporter: Transporter | null = null;
const activeRuleLocks = new Set<string>();

function getMailTransporter(): Transporter {
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      connectionTimeout: 4000,
      greetingTimeout: 4000
    });
  }
  return mailTransporter;
}

export async function deliverWebhookWithRetry(
  url: string,
  payload: Record<string, unknown>,
  maxAttempts = 3
): Promise<boolean> {
  if (!isSafeWebhookUrl(url)) {
    console.warn(`[LogFlow Alerts] Blocked unsafe webhook URL: ${url}`);
    return false;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'LogFlow-AlertEngine/1.0' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) return true;
    } catch {
      // Retry with backoff
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempt * 250));
    }
  }
  return false;
}

export async function deliverEmailWithRetry(
  to: string,
  subject: string,
  text: string,
  maxAttempts = 2
): Promise<boolean> {
  const transporter = getMailTransporter();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await transporter.sendMail({
        from: config.smtp.from,
        to,
        subject,
        text
      });
      return true;
    } catch {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
  return false;
}

export async function evaluateAlertsForProject(
  projectId: string,
  batch: StoredLogEvent[]
): Promise<void> {
  if (batch.length === 0) return;
  const db = await getDb();
  const adapter = await getLogAdapter();

  const rulesRes = await db.query<{
    id: string;
    project_id: string;
    name: string;
    service: string | null;
    level: LogLevel;
    query: string | null;
    threshold_count: number;
    window_minutes: number;
    notify_email: string | null;
    notify_webhook_url: string | null;
    enabled: boolean;
    last_triggered_at: string | null;
  }>(`SELECT * FROM alert_rules WHERE project_id = $1 AND enabled = TRUE`, [projectId]);

  for (const rule of rulesRes.rows) {
    if (activeRuleLocks.has(rule.id)) continue;

    // Cooldown check: avoid duplicate triggers within half of window or 1 minute minimum
    if (rule.last_triggered_at) {
      const elapsedMs = Date.now() - new Date(rule.last_triggered_at).getTime();
      const cooldownMs = Math.max(60_000, (Number(rule.window_minutes) * 60_000) / 2);
      if (elapsedMs < cooldownMs) continue;
    }

    const hasRelevantEvent = batch.some((ev) => {
      if (rule.level && ev.level !== rule.level) return false;
      if (rule.service && ev.service.toLowerCase() !== rule.service.toLowerCase()) return false;
      if (rule.query && !ev.message.toLowerCase().includes(rule.query.toLowerCase())) return false;
      return true;
    });
    if (!hasRelevantEvent) continue;

    activeRuleLocks.add(rule.id);
    try {
      const { count, sampleMessage } = await adapter.countMatchingInWindow({
        projectId,
        level: rule.level,
        service: rule.service,
        query: rule.query,
        windowMinutes: Number(rule.window_minutes)
      });

      if (count >= Number(rule.threshold_count)) {
        const nowIso = new Date().toISOString();
        // Record cooldown timestamp first to prevent concurrent duplicate triggers
        await db.query(`UPDATE alert_rules SET last_triggered_at = $1 WHERE id = $2`, [
          nowIso,
          rule.id
        ]);

        const channels: string[] = [];

        if (rule.notify_webhook_url) {
          channels.push(`webhook:${rule.notify_webhook_url}`);
          deliverWebhookWithRetry(rule.notify_webhook_url, {
            alert: rule.name,
            rule_id: rule.id,
            project_id: projectId,
            matched_count: count,
            threshold: Number(rule.threshold_count),
            window_minutes: Number(rule.window_minutes),
            service: rule.service,
            level: rule.level,
            sample_message: sampleMessage,
            triggered_at: nowIso
          }).catch(() => {});
        }

        if (rule.notify_email) {
          channels.push(`email:${rule.notify_email}`);
          deliverEmailWithRetry(
            rule.notify_email,
            `[LogFlow Alert] ${rule.name} (${count} ${rule.level} events)`,
            `Rule "${rule.name}" triggered.\nMatched ${count} events in ${rule.window_minutes} minutes.\nSample: ${sampleMessage}`
          ).catch(() => {});
        }

        await db.query(
          `INSERT INTO alert_history (id, rule_id, rule_name, project_id, matched_count, window_minutes, sample_message, channels_notified, triggered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
          [
            `alh_${crypto.randomUUID().slice(0, 12)}`,
            rule.id,
            rule.name,
            projectId,
            count,
            Number(rule.window_minutes),
            sampleMessage,
            JSON.stringify(channels),
            nowIso
          ]
        );
      }
    } finally {
      activeRuleLocks.delete(rule.id);
    }
  }
}
