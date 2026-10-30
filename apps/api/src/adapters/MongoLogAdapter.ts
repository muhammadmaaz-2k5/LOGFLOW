import { Filter } from 'mongodb';
import {
  LogLevel,
  LogSearchFilter,
  LogSearchResult,
  OverviewStats,
  StoredLogEvent,
  parseSearchQuery
} from '@logflow/shared';
import { getMongoDb } from '../db/mongo.js';
import { LogStorageAdapter, ProjectActivityStats } from './LogStorageAdapter.js';

const ALL_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDoc(doc: any): StoredLogEvent {
  return {
    id: String(doc.id),
    project_id: String(doc.project_id),
    timestamp: new Date(doc.timestamp).toISOString(),
    level: doc.level as LogLevel,
    service: String(doc.service),
    message: String(doc.message),
    metadata: typeof doc.metadata === 'object' && doc.metadata !== null ? doc.metadata : {},
    trace_id: doc.trace_id ? String(doc.trace_id) : null,
    received_at: new Date(doc.received_at ?? doc.timestamp).toISOString()
  };
}

export class MongoLogAdapter implements LogStorageAdapter {
  async init(): Promise<void> {
    const db = await getMongoDb();
    if (!db) {
      throw new Error('MongoDB URI not configured or unreachable');
    }
  }

  async insertBatch(events: StoredLogEvent[]): Promise<void> {
    if (events.length === 0) return;
    const db = await getMongoDb();
    if (!db) return;

    const ops = events.map((ev) => ({
      updateOne: {
        filter: { id: ev.id },
        update: {
          $setOnInsert: {
            id: ev.id,
            project_id: ev.project_id,
            timestamp: new Date(ev.timestamp).toISOString(),
            level: ev.level,
            service: ev.service,
            message: ev.message,
            metadata: ev.metadata ?? {},
            trace_id: ev.trace_id ?? null,
            received_at: new Date(ev.received_at).toISOString()
          }
        },
        upsert: true
      }
    }));

    await db.collection('log_events').bulkWrite(ops, { ordered: false });
  }

  async queryLogs(filter: LogSearchFilter): Promise<LogSearchResult> {
    const db = await getMongoDb();
    if (!db) {
      throw new Error('MongoDB not connected');
    }

    const col = db.collection('log_events');
    const parsed = parseSearchQuery(filter.q ?? '');
    const andConditions: Filter<any>[] = [{ project_id: filter.projectId }];

    const effectiveLevels = Array.from(new Set([...(filter.levels ?? []), ...parsed.levels]));
    if (effectiveLevels.length > 0) {
      andConditions.push({ level: { $in: effectiveLevels } });
    }

    const effectiveServices = Array.from(
      new Set([...(filter.services ?? []), ...parsed.services])
    );
    if (effectiveServices.length > 0) {
      andConditions.push({
        $or: effectiveServices.map((s) => ({
          service: { $regex: escapeRegex(s), $options: 'i' }
        }))
      });
    }

    const effectiveTraces = [
      ...(filter.traceId ? [filter.traceId] : []),
      ...parsed.traceIds
    ];
    if (effectiveTraces.length > 0) {
      andConditions.push({
        $or: effectiveTraces.map((t) => ({
          trace_id: { $regex: escapeRegex(t), $options: 'i' }
        }))
      });
    }

    for (const [metaKey, metaVal] of Object.entries(parsed.metadataFilters)) {
      andConditions.push({
        [`metadata.${metaKey}`]: { $regex: `^${escapeRegex(metaVal)}$`, $options: 'i' }
      });
    }

    for (const term of parsed.terms) {
      const rx = { $regex: escapeRegex(term), $options: 'i' };
      andConditions.push({
        $or: [{ message: rx }, { service: rx }, { trace_id: rx }]
      });
    }

    if (filter.from) {
      andConditions.push({ timestamp: { $gte: new Date(filter.from).toISOString() } });
    }
    if (filter.to) {
      andConditions.push({ timestamp: { $lte: new Date(filter.to).toISOString() } });
    }

    const mongoFilter: Filter<any> =
      andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);

    const [total, docs, services, levelAgg] = await Promise.all([
      col.countDocuments(mongoFilter),
      col
        .find(mongoFilter)
        .sort({ timestamp: -1, id: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      col.distinct('service', { project_id: filter.projectId }),
      col
        .aggregate<{ _id: LogLevel; cnt: number }>([
          { $match: mongoFilter },
          { $group: { _id: '$level', cnt: { $sum: 1 } } }
        ])
        .toArray()
    ]);

    const levelCounts: Record<LogLevel, number> = {
      trace: 0,
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0
    };
    for (const row of levelAgg) {
      if (ALL_LEVELS.includes(row._id)) {
        levelCounts[row._id] = Number(row.cnt);
      }
    }

    return {
      items: docs.map(normalizeDoc),
      total,
      limit,
      offset,
      facets: {
        services: services.map(String).sort(),
        levelCounts
      }
    };
  }

  async getOverviewStats(projectId: string, rangeHours = 24): Promise<OverviewStats> {
    const db = await getMongoDb();
    if (!db) throw new Error('MongoDB not connected');
    const col = db.collection('log_events');

    const now = new Date();
    const startOfToday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const rangeStart = new Date(now.getTime() - rangeHours * 60 * 60 * 1000).toISOString();

    const [
      eventsToday,
      errorsLastHour,
      distinctServicesToday,
      recentCount15m,
      topServicesAgg,
      recentErrorsDocs,
      seriesDocs
    ] = await Promise.all([
      col.countDocuments({ project_id: projectId, timestamp: { $gte: startOfToday } }),
      col.countDocuments({
        project_id: projectId,
        timestamp: { $gte: oneHourAgo },
        level: { $in: ['error', 'fatal'] }
      }),
      col.distinct('service', { project_id: projectId, timestamp: { $gte: startOfToday } }),
      col.countDocuments({ project_id: projectId, timestamp: { $gte: fifteenMinAgo } }),
      col
        .aggregate<{ _id: string; total: number; errors: number; lastSeen: string }>([
          { $match: { project_id: projectId, timestamp: { $gte: rangeStart } } },
          {
            $group: {
              _id: '$service',
              total: { $sum: 1 },
              errors: {
                $sum: {
                  $cond: [{ $in: ['$level', ['error', 'fatal']] }, 1, 0]
                }
              },
              lastSeen: { $max: '$timestamp' }
            }
          },
          { $sort: { total: -1 } },
          { $limit: 6 }
        ])
        .toArray(),
      col
        .find({ project_id: projectId, level: { $in: ['error', 'fatal'] } })
        .sort({ timestamp: -1 })
        .limit(8)
        .toArray(),
      col
        .find(
          { project_id: projectId, timestamp: { $gte: rangeStart } },
          { projection: { timestamp: 1, level: 1 } }
        )
        .toArray()
    ]);

    const bucketCount = 12;
    const spanMs = rangeHours * 60 * 60 * 1000;
    const stepMs = Math.floor(spanMs / bucketCount);
    const startMs = now.getTime() - spanMs;

    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      bucket: new Date(startMs + i * stepMs).toISOString(),
      trace: 0,
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0
    }));

    for (const row of seriesDocs) {
      const ts = new Date(row.timestamp).getTime();
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((ts - startMs) / stepMs)));
      const lvl = row.level as LogLevel;
      if (buckets[idx] && ALL_LEVELS.includes(lvl)) {
        buckets[idx][lvl] += 1;
      }
    }

    return {
      eventsToday,
      errorsLastHour,
      activeSources: distinctServicesToday.length,
      eventsPerMinute: Math.round((recentCount15m / 15) * 10) / 10,
      series: buckets,
      topServices: topServicesAgg.map((r) => ({
        service: r._id,
        total: r.total,
        errors: r.errors,
        lastSeen: new Date(r.lastSeen).toISOString()
      })),
      recentErrors: recentErrorsDocs.map(normalizeDoc)
    };
  }

  async getProjectActivity(projectId: string): Promise<ProjectActivityStats> {
    const db = await getMongoDb();
    if (!db) return { eventsPerMinute: 0, lastEventAt: null };
    const col = db.collection('log_events');

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [cnt, latest] = await Promise.all([
      col.countDocuments({ project_id: projectId, timestamp: { $gte: fifteenMinAgo } }),
      col
        .find({ project_id: projectId }, { projection: { timestamp: 1 } })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray()
    ]);

    return {
      eventsPerMinute: Math.round((cnt / 15) * 10) / 10,
      lastEventAt: latest[0]?.timestamp ? new Date(latest[0].timestamp).toISOString() : null
    };
  }

  async countMatchingInWindow(params: {
    projectId: string;
    level?: LogLevel | null;
    service?: string | null;
    query?: string | null;
    windowMinutes: number;
  }): Promise<{ count: number; sampleMessage: string }> {
    const db = await getMongoDb();
    if (!db) return { count: 0, sampleMessage: '' };
    const col = db.collection('log_events');

    const windowStart = new Date(Date.now() - params.windowMinutes * 60 * 1000).toISOString();
    const filter: Filter<any> = {
      project_id: params.projectId,
      timestamp: { $gte: windowStart }
    };
    if (params.level) filter.level = params.level;
    if (params.service) filter.service = { $regex: `^${escapeRegex(params.service)}$`, $options: 'i' };
    if (params.query) filter.message = { $regex: escapeRegex(params.query), $options: 'i' };

    const [count, sample] = await Promise.all([
      col.countDocuments(filter),
      col.find(filter).sort({ timestamp: -1 }).limit(1).toArray()
    ]);

    return {
      count,
      sampleMessage: sample[0]?.message ?? 'Threshold exceeded'
    };
  }

  async deleteExpiredLogs(projectId: string, retentionDays: number): Promise<number> {
    const db = await getMongoDb();
    if (!db) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const res = await db
      .collection('log_events')
      .deleteMany({ project_id: projectId, timestamp: { $lt: cutoff } });
    return res.deletedCount ?? 0;
  }
}

