import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const tmpPgDir = path.join(os.tmpdir(), `logflow-test-${Date.now()}`);
process.env.USE_PGLITE = 'true';
process.env.PGDATA_DIR = tmpPgDir;
process.env.LOG_STORE_DRIVER = 'postgres';

import type { SeedResult } from '../db/seed.js';

describe('LogFlow API - Security, Ingestion, Search, Alerts & Idempotent Seed', () => {
  let app: any;
  let runSeedFn: () => Promise<SeedResult>;
  let seedInfo: SeedResult;
  let adminJwt = '';

  beforeAll(async () => {
    const indexMod = await import('../index.js');
    const seedMod = await import('../db/seed.js');
    runSeedFn = seedMod.runSeed;

    app = await indexMod.buildApp();
    seedInfo = await runSeedFn();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: seedInfo.adminEmail, password: seedInfo.adminPassword }
    });
    expect(loginRes.statusCode).toBe(200);
    adminJwt = loginRes.json().token;
  });

  afterAll(async () => {
    if (app) await app.close();
    fs.rmSync(tmpPgDir, { recursive: true, force: true });
  });

  it('runs database seed multiple times idempotently without duplicating records or invalidating keys', async () => {
    const secondSeed = await runSeedFn();
    expect(secondSeed.demoProjectId).toBe('prj_production_core');

    const projRes = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${adminJwt}` }
    });
    expect(projRes.statusCode).toBe(200);
    const prodProjects = projRes
      .json()
      .projects.filter((p: any) => p.id === 'prj_production_core');
    expect(prodProjects.length).toBe(1);
  });

  it('prevents privilege escalation on self-registration (assigns member role when users exist)', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'New Developer',
        email: 'dev-audit@logflow.dev',
        password: 'SecurePassword#2026'
      }
    });
    expect(regRes.statusCode).toBe(201);
    expect(regRes.json().user.role).toBe('member');
  });

  it('rejects POST /v1/ingest without valid X-API-Key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest',
      payload: [{ level: 'info', service: 'auth-service', message: 'hello' }]
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('MISSING_API_KEY');
  });

  it('ingests valid log batch with generated X-API-Key, deduplicates IDs, and returns rate-limit headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: { 'x-api-key': seedInfo.demoApiKey },
      payload: [
        {
          id: 'evt_dedup_test_01',
          timestamp: new Date().toISOString(),
          level: 'error',
          service: 'auth-service',
          message: 'OAuth token expired for user_id=9001',
          metadata: { user_id: '9001', env: 'prod' },
          trace_id: 'tr-audit-unique-9001'
        },
        {
          id: 'evt_dedup_test_01',
          timestamp: new Date().toISOString(),
          level: 'error',
          service: 'auth-service',
          message: 'Duplicate event in same batch'
        }
      ]
    });
    expect(res.statusCode).toBe(202);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.json().accepted).toBe(1);
  });

  it('queries logs using level, service, trace_id, metadata, time range, and pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/logs',
      headers: { authorization: `Bearer ${adminJwt}` },
      query: {
        projectId: 'prj_production_core',
        q: 'level:error service:auth "token expired" env:prod',
        limit: '10',
        offset: '0'
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.every((item: any) => item.level === 'error')).toBe(true);
    expect(
      body.items.every((item: any) => item.message.toLowerCase().includes('token expired'))
    ).toBe(true);

    // Verify traceId filter
    const traceRes = await app.inject({
      method: 'GET',
      url: '/v1/logs',
      headers: { authorization: `Bearer ${adminJwt}` },
      query: {
        projectId: 'prj_production_core',
        traceId: 'tr-audit-unique-9001'
      }
    });
    expect(traceRes.statusCode).toBe(200);
    expect(traceRes.json().total).toBe(1);
  });

  it('creates and revokes API keys and blocks revoked keys from ingesting', async () => {
    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/v1/projects/prj_production_core/keys',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: { name: 'Temporary Audit Key', rate_limit_per_min: 100 }
    });
    expect(createKeyRes.statusCode).toBe(201);
    const { id: keyId, raw_key: rawKey } = createKeyRes.json().key;
    expect(rawKey).toMatch(/^lf_live_/);

    // Revoke key
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/prj_production_core/keys/${keyId}`,
      headers: { authorization: `Bearer ${adminJwt}` }
    });
    expect(revokeRes.statusCode).toBe(200);

    // Attempt ingest with revoked key
    const ingestRevoked = await app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: { 'x-api-key': rawKey },
      payload: [{ level: 'info', service: 'auth-service', message: 'should be blocked' }]
    });
    expect(ingestRevoked.statusCode).toBe(403);
    expect(ingestRevoked.json().error.code).toBe('REVOKED_API_KEY');
  });

  it('validates alert rules (blocks SSRF webhooks) and records alert test notifications in history', async () => {
    const ssrfRuleRes = await app.inject({
      method: 'POST',
      url: '/v1/alerts/rules',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        project_id: 'prj_production_core',
        name: 'Bad Localhost Webhook',
        level: 'error',
        threshold_count: 5,
        window_minutes: 10,
        notify_webhook_url: 'http://127.0.0.1:4000/internal'
      }
    });
    expect(ssrfRuleRes.statusCode).toBe(400);

    const validRuleRes = await app.inject({
      method: 'POST',
      url: '/v1/alerts/rules',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        project_id: 'prj_production_core',
        name: 'Audit Payment Error Rule',
        service: 'payment-api',
        level: 'error',
        threshold_count: 2,
        window_minutes: 15,
        notify_email: 'oncall@logflow.dev',
        notify_webhook_url: 'https://hooks.slack.com/services/T000/B000/AUDIT'
      }
    });
    expect(validRuleRes.statusCode).toBe(201);
    const createdRuleId = validRuleRes.json().rule.id;

    // Trigger manual test notification
    const testTriggerRes = await app.inject({
      method: 'POST',
      url: `/v1/alerts/rules/${createdRuleId}/test`,
      headers: { authorization: `Bearer ${adminJwt}` }
    });
    expect(testTriggerRes.statusCode).toBe(200);
    expect(testTriggerRes.json().triggered).toBe(true);

    const historyRes = await app.inject({
      method: 'GET',
      url: '/v1/alerts/history',
      headers: { authorization: `Bearer ${adminJwt}` },
      query: { projectId: 'prj_production_core' }
    });
    expect(historyRes.statusCode).toBe(200);
    expect(
      historyRes.json().history.some((h: any) => h.rule_id === createdRuleId)
    ).toBe(true);
  });

  it('returns overview dashboard stats and time-series buckets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/logs/stats',
      headers: { authorization: `Bearer ${adminJwt}` },
      query: { projectId: 'prj_production_core' }
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.eventsToday).toBeGreaterThan(0);
    expect(stats.series.length).toBe(12);
    expect(stats.topServices.length).toBeGreaterThan(0);
  });
});
