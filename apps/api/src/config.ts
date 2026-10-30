import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'logflow-default-super-secret-jwt-key-32-chars-min!';

export const config = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? 'development';
  },
  get isProduction() {
    return (process.env.NODE_ENV ?? 'development') === 'production';
  },
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  get mongodbUri() {
    return process.env.MONGODB_URI ?? '';
  },
  mongodbDb: process.env.MONGODB_DB ?? 'logflow',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://logflow:logflow@localhost:5432/logflow',
  get pgDataDir() {
    return process.env.PGDATA_DIR ?? path.resolve(__dirname, '../../.data/pgdata');
  },
  get logStoreDriver() {
    return (process.env.LOG_STORE_DRIVER ?? 'mongodb') as 'mongodb' | 'postgres' | 'clickhouse';
  },
  clickhouse: {
    url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    db: process.env.CLICKHOUSE_DB ?? 'logflow',
    user: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? ''
  },
  ingestRateLimitPerMin: Number(process.env.INGEST_RATE_LIMIT_PER_MIN ?? 5000),
  ingestBatchFlushMs: Number(process.env.INGEST_BATCH_FLUSH_MS ?? 100),
  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    from: process.env.SMTP_FROM ?? 'alerts@logflow.local'
  },
  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'alex@logflow.dev',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? '',
    demoApiKey: process.env.SEED_API_KEY ?? ''
  }
};
