import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { config } from '../config.js';
import { getMongoDb } from './mongo.js';

export interface QueryResult<T = Record<string, any>> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  withTransaction<T>(fn: (tx: Pick<DbClient, 'query'>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let dbInstance: DbClient | null = null;

const METADATA_TABLES = ['users', 'projects', 'api_keys', 'alert_rules', 'alert_history'] as const;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 5000,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  service TEXT,
  level TEXT NOT NULL DEFAULT 'error',
  query TEXT,
  threshold_count INTEGER NOT NULL,
  window_minutes INTEGER NOT NULL,
  notify_email TEXT,
  notify_webhook_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_history (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  matched_count INTEGER NOT NULL,
  window_minutes INTEGER NOT NULL,
  sample_message TEXT NOT NULL,
  channels_notified JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS log_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_project_enabled ON alert_rules(project_id, enabled);
CREATE INDEX IF NOT EXISTS idx_alert_history_project_ts ON alert_history(project_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_events_project_ts ON log_events(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_log_events_project_level ON log_events(project_id, level);
CREATE INDEX IF NOT EXISTS idx_log_events_project_service ON log_events(project_id, service);
CREATE INDEX IF NOT EXISTS idx_log_events_project_trace ON log_events(project_id, trace_id);
`;

async function canConnectExternalPostgres(connectionString: string): Promise<boolean> {
  if (process.env.USE_PGLITE === 'true') return false;
  const probePool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 1500
  });
  try {
    const client = await probePool.connect();
    client.release();
    await probePool.end();
    return true;
  } catch {
    await probePool.end().catch(() => {});
    return false;
  }
}

async function syncMetadataTableToMongo(
  rawDb: Pick<DbClient, 'query'>,
  table: (typeof METADATA_TABLES)[number]
): Promise<void> {
  const mongo = await getMongoDb();
  if (!mongo) return;

  const { rows } = await rawDb.query(`SELECT * FROM ${table}`);
  const col = mongo.collection(table);

  if (rows.length === 0) {
    await col.deleteMany({});
    return;
  }

  const ids = rows.map((r) => r.id);
  await col.deleteMany({ id: { $nin: ids } });

  const ops = rows.map((row) => ({
    updateOne: {
      filter: { id: row.id },
      update: { $set: { ...row } },
      upsert: true
    }
  }));
  await col.bulkWrite(ops, { ordered: false });
}

export async function syncAllMetadataToMongo(
  rawDb: Pick<DbClient, 'query'>
): Promise<{ synced: boolean; error?: string }> {
  try {
    const mongo = await getMongoDb();
    if (!mongo) return { synced: false };
    for (const table of METADATA_TABLES) {
      await syncMetadataTableToMongo(rawDb, table);
    }
    return { synced: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LogFlow DB] MongoDB metadata sync warning: ${msg}`);
    return { synced: false, error: msg };
  }
}

export async function hydrateMetadataFromMongo(rawDb: Pick<DbClient, 'query'>): Promise<void> {
  try {
    const mongo = await getMongoDb();
    if (!mongo) return;

    const usersDocs = await mongo.collection('users').find({}).toArray();
    for (const u of usersDocs) {
      await rawDb.query(
        `INSERT INTO users (id, email, password_hash, name, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email,
               password_hash = EXCLUDED.password_hash,
               name = EXCLUDED.name,
               role = EXCLUDED.role`,
        [u.id, u.email, u.password_hash, u.name, u.role, u.created_at ?? new Date().toISOString()]
      );
    }

    const projectDocs = await mongo.collection('projects').find({}).toArray();
    for (const p of projectDocs) {
      await rawDb.query(
        `INSERT INTO projects (id, name, slug, retention_days, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               retention_days = EXCLUDED.retention_days`,
        [
          p.id,
          p.name,
          p.slug,
          Number(p.retention_days ?? 30),
          p.created_at ?? new Date().toISOString()
        ]
      );
    }

    const keyDocs = await mongo.collection('api_keys').find({}).toArray();
    for (const k of keyDocs) {
      await rawDb.query(
        `INSERT INTO api_keys (id, project_id, name, key_prefix, key_hash, rate_limit_per_min, last_used_at, revoked_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE
           SET key_prefix = EXCLUDED.key_prefix,
               key_hash = EXCLUDED.key_hash,
               rate_limit_per_min = EXCLUDED.rate_limit_per_min,
               revoked_at = EXCLUDED.revoked_at`,
        [
          k.id,
          k.project_id,
          k.name,
          k.key_prefix,
          k.key_hash,
          Number(k.rate_limit_per_min ?? 5000),
          k.last_used_at ?? null,
          k.revoked_at ?? null,
          k.created_at ?? new Date().toISOString()
        ]
      );
    }
  } catch (err: any) {
    console.warn('[LogFlow DB] Hydrate from MongoDB warning:', err?.message ?? err);
  }
}

export async function getDb(): Promise<DbClient> {
  if (dbInstance) return dbInstance;

  const hasExternalPg = await canConnectExternalPostgres(config.databaseUrl);
  let baseDb: DbClient;

  if (hasExternalPg) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
    pool.on('error', (err) => {
      console.error('[LogFlow DB] Unexpected PostgreSQL idle client error:', err.message);
    });
    await pool.query(SCHEMA_SQL);

    baseDb = {
      async query<T = Record<string, any>>(
        sql: string,
        params: unknown[] = []
      ): Promise<QueryResult<T>> {
        const res = await pool.query(sql, params);
        return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
      },
      async withTransaction<T>(fn: (tx: Pick<DbClient, 'query'>) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const txClient: Pick<DbClient, 'query'> = {
            async query<R = Record<string, any>>(sql: string, params: unknown[] = []) {
              const res = await client.query(sql, params);
              return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
            }
          };
          const out = await fn(txClient);
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      }
    };
  } else {
    fs.mkdirSync(config.pgDataDir, { recursive: true });
    const pglite = new PGlite(config.pgDataDir);
    await pglite.waitReady;
    await pglite.exec(SCHEMA_SQL);

    baseDb = {
      async query<T = Record<string, any>>(
        sql: string,
        params: unknown[] = []
      ): Promise<QueryResult<T>> {
        const res = await pglite.query<T>(sql, params);
        return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
      },
      async withTransaction<T>(fn: (tx: Pick<DbClient, 'query'>) => Promise<T>): Promise<T> {
        await pglite.query('BEGIN');
        try {
          const out = await fn({
            query: async <R = Record<string, any>>(sql: string, params: unknown[] = []) => {
              const res = await pglite.query<R>(sql, params);
              return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
            }
          });
          await pglite.query('COMMIT');
          return out;
        } catch (err) {
          await pglite.query('ROLLBACK').catch(() => {});
          throw err;
        }
      },
      async close() {
        await pglite.close();
      }
    };
  }

  dbInstance = {
    async query<T = Record<string, any>>(
      sql: string,
      params: unknown[] = []
    ): Promise<QueryResult<T>> {
      const result = await baseDb.query<T>(sql, params);
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
        for (const table of METADATA_TABLES) {
          if (new RegExp(`\\b${table}\\b`, 'i').test(sql)) {
            syncMetadataTableToMongo(baseDb, table).catch((err) => {
              console.warn(`[LogFlow DB] Async MongoDB sync failed for table "${table}":`, err.message);
            });
          }
        }
      }
      return result;
    },
    async withTransaction<T>(fn: (tx: Pick<DbClient, 'query'>) => Promise<T>): Promise<T> {
      const out = await baseDb.withTransaction(fn);
      await syncAllMetadataToMongo(baseDb);
      return out;
    },
    async close() {
      await baseDb.close();
      dbInstance = null;
    }
  };

  await hydrateMetadataFromMongo(baseDb);

  return dbInstance;
}
