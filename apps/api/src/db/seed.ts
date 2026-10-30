import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { LogLevel, StoredLogEvent } from '@logflow/shared';
import { getLogAdapter } from '../adapters/index.js';
import { config } from '../config.js';
import { getDb } from './postgres.js';
import { hashApiKey } from '../middleware/auth.js';

export interface SeedResult {
  adminEmail: string;
  adminPassword: string;
  demoProjectId: string;
  demoApiKey: string;
  seededEventsCount: number;
}

const SERVICES = [
  'auth-service',
  'payment-api',
  'api-gateway',
  'order-worker',
  'notification-svc',
  'search-indexer'
] as const;

const SCENARIOS: Array<{
  service: (typeof SERVICES)[number];
  level: LogLevel;
  messages: string[];
  metaGen: (idx: number) => Record<string, unknown>;
}> = [
  {
    service: 'auth-service',
    level: 'info',
    messages: [
      'OAuth2 token refreshed successfully for session',
      'User authenticated via SSO SAML assertion',
      'MFA challenge verified using TOTP factor',
      'Session key rotated for active tenant'
    ],
    metaGen: (idx) => ({
      env: 'prod',
      region: 'us-east-1',
      user_id: `usr_${1000 + (idx % 900)}`,
      latency_ms: 12 + (idx % 45)
    })
  },
  {
    service: 'auth-service',
    level: 'error',
    messages: [
      'JWT verification failed: token expired after 3600s',
      'Redis session store connection timeout after 5000ms',
      'Invalid OAuth state parameter detected from callback IP'
    ],
    metaGen: (idx) => ({
      env: 'prod',
      region: 'us-east-1',
      error_code: 'AUTH_TOKEN_EXPIRED',
      ip: `198.51.100.${10 + (idx % 200)}`
    })
  },
  {
    service: 'payment-api',
    level: 'error',
    messages: [
      'timeout after 30s calling ledger settlement RPC',
      'Stripe webhook signature verification failed for evt_charge',
      'Idempotency lock contention on checkout intent'
    ],
    metaGen: (idx) => ({
      env: 'prod',
      region: 'eu-west-1',
      amount_cents: 1500 + (idx % 45) * 100,
      currency: 'USD',
      retry_attempt: 1 + (idx % 3)
    })
  },
  {
    service: 'payment-api',
    level: 'info',
    messages: [
      'Payment intent authorized and captured',
      'Ledger journal entry committed for invoice',
      'Payout batch reconciled with settlement bank'
    ],
    metaGen: (idx) => ({
      env: 'prod',
      region: 'eu-west-1',
      provider: 'stripe',
      duration_ms: 85 + (idx % 180)
    })
  },
  {
    service: 'api-gateway',
    level: 'warn',
    messages: [
      'Upstream rate limit approaching 85% threshold for tenant',
      'Slow upstream response from order-worker (>1200ms)',
      'TLS client certificate nearing expiration window'
    ],
    metaGen: () => ({
      env: 'prod',
      region: 'us-west-2',
      status_code: 429,
      route: '/v2/checkout/sessions'
    })
  },
  {
    service: 'api-gateway',
    level: 'info',
    messages: [
      'HTTP GET /v1/catalog/items 200 OK',
      'HTTP POST /v1/orders 201 Created',
      'Health check probe succeeded from ingress controller'
    ],
    metaGen: (idx) => ({
      env: 'prod',
      region: 'us-west-2',
      status_code: 200,
      latency_ms: 4 + (idx % 35)
    })
  },
  {
    service: 'order-worker',
    level: 'debug',
    messages: [
      'Dequeued fulfillment message from Kafka partition 3',
      'Inventory reservation lock acquired for SKU batch',
      'Computed shipping carrier rates for warehouse zone'
    ],
    metaGen: () => ({
      env: 'prod',
      partition: 3,
      consumer_group: 'fulfillment-cg'
    })
  },
  {
    service: 'order-worker',
    level: 'fatal',
    messages: [
      'Out of memory: heap allocation failed in worker thread pool',
      'Unrecoverable database deadlock on inventory_reservations table'
    ],
    metaGen: () => ({
      env: 'prod',
      region: 'us-east-1',
      heap_used_mb: 1984,
      exit_code: 137
    })
  },
  {
    service: 'notification-svc',
    level: 'info',
    messages: [
      'Transactional receipt email dispatched via SES',
      'Webhook delivery succeeded with HTTP 200',
      'Push notification queued for APNs device token'
    ],
    metaGen: () => ({
      env: 'prod',
      channel: 'email',
      template: 'order_confirmation_v3'
    })
  },
  {
    service: 'search-indexer',
    level: 'trace',
    messages: [
      'Flushed 250 document embeddings to vector shard',
      'Segment merge completed in 142ms',
      'Heartbeat ACK received from coordinator node'
    ],
    metaGen: () => ({
      env: 'prod',
      shard_id: 'shard-02',
      docs_indexed: 250
    })
  }
];

export async function runSeed(): Promise<SeedResult> {
  const db = await getDb();
  const adapter = await getLogAdapter();

  const adminEmail = config.seed.adminEmail.trim().toLowerCase();
  const adminPassword =
    config.seed.adminPassword || `Lf_${crypto.randomBytes(12).toString('base64url')}!9`;
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  // Derive seed API keys cryptographically using Node.js crypto HMAC over environment secret (never hardcoded in source, idempotent across re-runs)
  const derivedProdRawKey =
    config.seed.demoApiKey ||
    `lf_live_${crypto.createHmac('sha256', config.jwtSecret).update('seed:prj_production_core').digest('hex').slice(0, 48)}`;
  const derivedStgRawKey = `lf_live_${crypto.createHmac('sha256', config.jwtSecret).update('seed:prj_staging_edge').digest('hex').slice(0, 48)}`;

  const prodKeyData = {
    rawKey: derivedProdRawKey,
    prefix: derivedProdRawKey.slice(0, 14),
    hash: hashApiKey(derivedProdRawKey)
  };
  const stagingKeyData = {
    rawKey: derivedStgRawKey,
    prefix: derivedStgRawKey.slice(0, 14),
    hash: hashApiKey(derivedStgRawKey)
  };

  const prodProjectId = 'prj_production_core';
  const stagingProjectId = 'prj_staging_edge';

  // Execute all relational metadata inserts inside a single atomic transaction
  await db.withTransaction(async (tx) => {
    // 1. Seed Users idempotently
    await tx.query(
      `INSERT INTO users (id, email, password_hash, name, role)
       VALUES
         ('usr_admin01', $1, $2, 'Alex Rivera', 'admin'),
         ('usr_member02', 'sam@logflow.dev', $2, 'Sam Chen', 'member'),
         ('usr_viewer03', 'taylor@logflow.dev', $2, 'Taylor Kim', 'viewer')
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             name = EXCLUDED.name,
             role = EXCLUDED.role`,
      [adminEmail, passwordHash]
    );

    // 2. Seed Projects idempotently
    await tx.query(
      `INSERT INTO projects (id, name, slug, retention_days)
       VALUES
         ($1, 'Production Core', 'production-core', 30),
         ($2, 'Staging Edge', 'staging-edge', 14)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             retention_days = EXCLUDED.retention_days`,
      [prodProjectId, stagingProjectId]
    );

    // 3. Seed API key hashes idempotently (only hash and short prefix stored)
    await tx.query(
      `INSERT INTO api_keys (id, project_id, name, key_prefix, key_hash, rate_limit_per_min, last_used_at, revoked_at)
       VALUES
         ('key_prod_main', $1, 'Kubernetes Production FluentBit', $2, $3, 5000, NOW(), NULL),
         ('key_stg_main', $4, 'Staging Collector Key', $5, $6, 2000, NOW(), NULL)
       ON CONFLICT (id) DO UPDATE
         SET key_prefix = EXCLUDED.key_prefix,
             key_hash = EXCLUDED.key_hash,
             rate_limit_per_min = EXCLUDED.rate_limit_per_min,
             revoked_at = NULL`,
      [
        prodProjectId,
        prodKeyData.prefix,
        prodKeyData.hash,
        stagingProjectId,
        stagingKeyData.prefix,
        stagingKeyData.hash
      ]
    );

    // 4. Seed Alert Rules & History idempotently
    await tx.query(
      `INSERT INTO alert_rules (id, project_id, name, service, level, query, threshold_count, window_minutes, notify_email, notify_webhook_url, enabled, last_triggered_at)
       VALUES
         ('alr_auth_errors', $1, 'Auth Token Expiry Spike', 'auth-service', 'error', 'token expired', 5, 15, 'oncall@logflow.dev', 'https://hooks.slack.com/services/T000/B000/DEMO', TRUE, NOW() - INTERVAL '25 minutes'),
         ('alr_payment_timeouts', $1, 'Payment Ledger Timeouts', 'payment-api', 'error', 'timeout', 3, 10, 'payments-alerts@logflow.dev', 'https://pager.logflow.dev/webhook', TRUE, NOW() - INTERVAL '42 minutes'),
         ('alr_worker_fatal', $1, 'Worker Fatal Crash Detector', 'order-worker', 'fatal', NULL, 1, 5, 'sre@logflow.dev', NULL, TRUE, NOW() - INTERVAL '2 hours')
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             threshold_count = EXCLUDED.threshold_count,
             window_minutes = EXCLUDED.window_minutes`,
      [prodProjectId]
    );

    await tx.query(
      `INSERT INTO alert_history (id, rule_id, rule_name, project_id, matched_count, window_minutes, sample_message, channels_notified, triggered_at)
       VALUES
         ('alh_seed_1', 'alr_auth_errors', 'Auth Token Expiry Spike', $1, 8, 15, 'JWT verification failed: token expired after 3600s', '["email:oncall@logflow.dev", "webhook:https://hooks.slack.com/services/T000/B000/DEMO"]'::jsonb, NOW() - INTERVAL '25 minutes'),
         ('alh_seed_2', 'alr_payment_timeouts', 'Payment Ledger Timeouts', $1, 4, 10, 'timeout after 30s calling ledger settlement RPC', '["email:payments-alerts@logflow.dev", "webhook:https://pager.logflow.dev/webhook"]'::jsonb, NOW() - INTERVAL '42 minutes'),
         ('alh_seed_3', 'alr_worker_fatal', 'Worker Fatal Crash Detector', $1, 1, 5, 'Out of memory: heap allocation failed in worker thread pool', '["email:sre@logflow.dev"]'::jsonb, NOW() - INTERVAL '2 hours')
       ON CONFLICT (id) DO NOTHING`,
      [prodProjectId]
    );
  });

  // Verify relational seed records explicitly
  const [verifyUser, verifyProject, verifyKey] = await Promise.all([
    db.query<{ id: string }>(`SELECT id FROM users WHERE id = 'usr_admin01'`),
    db.query<{ id: string }>(`SELECT id FROM projects WHERE id = $1`, [prodProjectId]),
    db.query<{ id: string }>(`SELECT id FROM api_keys WHERE id = 'key_prod_main'`)
  ]);

  if (!verifyUser.rows[0] || !verifyProject.rows[0] || !verifyKey.rows[0]) {
    throw new Error('Seed verification failed: core metadata records were not persisted.');
  }

  // 5. Idempotently seed deterministic log events (evt_seed_0001 .. evt_seed_0320)
  const now = Date.now();
  const events: StoredLogEvent[] = [];
  const weights = [0, 0, 0, 1, 2, 3, 3, 3, 4, 5, 5, 5, 6, 6, 7, 8, 8, 9];

  for (let i = 0; i < 320; i++) {
    const scenarioIdx = weights[i % weights.length];
    const scenario = SCENARIOS[scenarioIdx];
    const msg = scenario.messages[i % scenario.messages.length];

    const isRecent = i < 120;
    const offsetMinutes = isRecent ? (i / 120) * 90 : 90 + ((i - 120) / 200) * (22 * 60);
    const ts = new Date(now - Math.floor(offsetMinutes * 60 * 1000) - (i % 50) * 412).toISOString();

    const traceNum = 10000 + (i % 45);
    events.push({
      id: `evt_seed_${String(i + 1).padStart(4, '0')}`,
      project_id: prodProjectId,
      timestamp: ts,
      level: scenario.level,
      service: scenario.service,
      message: msg,
      metadata: scenario.metaGen(i),
      trace_id: `tr-${traceNum.toString(16)}-9f2b`,
      received_at: ts
    });
  }

  // insertBatch uses ON CONFLICT (id) DO NOTHING / Mongo $setOnInsert upsert, so it is 100% idempotent
  await adapter.insertBatch(events);

  // Verify seeded log events exist in the active adapter
  const verifyLogs = await adapter.queryLogs({
    projectId: prodProjectId,
    limit: 5
  });
  if (verifyLogs.total < 1) {
    throw new Error('Seed verification failed: no log events found in storage adapter after seed.');
  }

  if (config.isProduction) {
    console.log('✅ LogFlow seed completed (production mode - secrets redacted):');
    console.log(`   Admin User: ${adminEmail}`);
    console.log(`   Demo Project ID: ${prodProjectId}`);
    console.log(`   API Key Prefix: ${prodKeyData.prefix}••••••••`);
  } else {
    console.log('✅ LogFlow seed completed (development mode):');
    console.log(`   Admin Login: ${adminEmail} / ${adminPassword}`);
    console.log(`   Demo Project ID: ${prodProjectId}`);
    console.log(`   Generated X-API-Key: ${prodKeyData.rawKey}`);
  }

  return {
    adminEmail,
    adminPassword,
    demoProjectId: prodProjectId,
    demoApiKey: prodKeyData.rawKey,
    seededEventsCount: events.length
  };
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed.ts');
if (isDirectRun) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
