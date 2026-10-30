import { config } from '../config.js';
import { ClickHouseLogAdapter } from './ClickHouseAdapter.js';
import { LogStorageAdapter } from './LogStorageAdapter.js';
import { MongoLogAdapter } from './MongoLogAdapter.js';
import { PostgresLogAdapter } from './PostgresLogAdapter.js';

let adapterInstance: LogStorageAdapter | null = null;

export async function getLogAdapter(): Promise<LogStorageAdapter> {
  if (adapterInstance) return adapterInstance;

  if (
    (config.logStoreDriver === 'mongodb' || config.mongodbUri) &&
    process.env.USE_PGLITE !== 'true'
  ) {
    const mongoAdapter = new MongoLogAdapter();
    try {
      await mongoAdapter.init();
      adapterInstance = mongoAdapter;
      return adapterInstance;
    } catch (err) {
      console.warn('MongoLogAdapter init failed, falling back to PostgresLogAdapter:', err);
    }
  }

  if (config.logStoreDriver === 'clickhouse') {
    const ch = new ClickHouseLogAdapter();
    try {
      await ch.init();
      adapterInstance = ch;
      return adapterInstance;
    } catch {
      // Fallback to PostgresLogAdapter if ClickHouse is unreachable
    }
  }

  const pgAdapter = new PostgresLogAdapter();
  await pgAdapter.init();
  adapterInstance = pgAdapter;
  return adapterInstance;
}
