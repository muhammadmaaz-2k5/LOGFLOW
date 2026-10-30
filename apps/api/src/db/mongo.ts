import { Db, MongoClient } from 'mongodb';
import { config } from '../config.js';

let clientInstance: MongoClient | null = null;
let dbInstance: Db | null = null;
let connectingPromise: Promise<Db | null> | null = null;

export async function getMongoDb(): Promise<Db | null> {
  if (!config.mongodbUri || process.env.USE_PGLITE === 'true') {
    return null;
  }
  if (dbInstance) return dbInstance;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    try {
      const client = new MongoClient(config.mongodbUri, {
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000
      });
      await client.connect();
      const db = client.db(config.mongodbDb);

      await Promise.all([
        db.collection('users').createIndex({ email: 1 }, { unique: true }),
        db.collection('projects').createIndex({ id: 1 }, { unique: true }),
        db.collection('api_keys').createIndex({ key_hash: 1 }, { unique: true }),
        db.collection('api_keys').createIndex({ project_id: 1 }),
        db.collection('alert_rules').createIndex({ project_id: 1, enabled: 1 }),
        db.collection('alert_history').createIndex({ project_id: 1, triggered_at: -1 }),
        db.collection('log_events').createIndex({ id: 1 }, { unique: true }),
        db.collection('log_events').createIndex({ project_id: 1, timestamp: -1 }),
        db.collection('log_events').createIndex({ project_id: 1, level: 1 }),
        db.collection('log_events').createIndex({ project_id: 1, service: 1 }),
        db.collection('log_events').createIndex({ project_id: 1, trace_id: 1 })
      ]);

      clientInstance = client;
      dbInstance = db;
      return dbInstance;
    } catch (err) {
      connectingPromise = null;
      throw err;
    }
  })();

  return connectingPromise;
}

export async function closeMongo(): Promise<void> {
  connectingPromise = null;
  if (clientInstance) {
    await clientInstance.close().catch(() => {});
    clientInstance = null;
    dbInstance = null;
  }
}
