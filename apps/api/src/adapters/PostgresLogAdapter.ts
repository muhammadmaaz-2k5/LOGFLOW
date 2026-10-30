import {
  LogLevel,
  LogSearchFilter,
  LogSearchResult,
  OverviewStats,
  StoredLogEvent,
  parseSearchQuery
} from '@logflow/shared';
import { getDb } from '../db/postgres.js';
import { LogStorageAdapter, ProjectActivityStats } from './LogStorageAdapter.js';

const ALL_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function escapeSqlLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function normalizeRow(row: any): StoredLogEvent {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    timestamp: new Date(row.timestamp).toISOString(),
    level: row.level as LogLevel,
    service: String(row.service),
    message: String(row.message),
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {}),
    trace_id: row.trace_id ? String(row.trace_id) : null,
    received_at: new Date(row.received_at).toISOString()
  };
}

export class PostgresLogAdapter implements LogStorageAdapter {
  async init(): Promise<void> {
    await getDb();
  }

  async insertBatch(events: StoredLogEvent[]): Promise<void> {
    if (events.length === 0) return;
    const db = await getDb();

    const valuesSql: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const ev of events) {
      valuesSql.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++}, $${idx++})`
      );
      params.push(
        ev.id,
        ev.project_id,
        ev.timestamp,
        ev.level,
        ev.service,
        ev.message,
        JSON.stringify(ev.metadata ?? {}),
        ev.trace_id ?? null,
        ev.received_at
      );
    }

    await db.query(
      `INSERT INTO log_events (id, project_id, timestamp, level, service, message, metadata, trace_id, received_at)
       VALUES ${valuesSql.join(', ')}
       ON CONFLICT (id) DO NOTHING`,
      params
    );
  }

  async queryLogs(filter: LogSearchFilter): Promise<LogSearchResult> {
    const db = await getDb();
    const parsed = parseSearchQuery(filter.q ?? '');

    const whereClauses: string[] = ['project_id = $1'];
    const params: unknown[] = [filter.projectId];
    let idx = 2;

    const effectiveLevels = Array.from(
      new Set([...(filter.levels ?? []), ...parsed.levels])
    );
    if (effectiveLevels.length > 0) {
      const placeholders = effectiveLevels.map(() => `$${idx++}`).join(', ');
      whereClauses.push(`level IN (${placeholders})`);
      params.push(...effectiveLevels);
    }

    const effectiveServices = Array.from(
      new Set([...(filter.services ?? []), ...parsed.services])
    );
    if (effectiveServices.length > 0) {
      const orService = effectiveServices
        .map(() => `LOWER(service) LIKE LOWER($${idx++}) ESCAPE '\\'`)
        .join(' OR ');
      whereClauses.push(`(${orService})`);
      params.push(...effectiveServices.map((s) => `%${escapeSqlLike(s)}%`));
    }

    const effectiveTraces = [
      ...(filter.traceId ? [filter.traceId] : []),
      ...parsed.traceIds
    ];
    if (effectiveTraces.length > 0) {
      const orTrace = effectiveTraces
        .map(() => `LOWER(COALESCE(trace_id, '')) LIKE LOWER($${idx++}) ESCAPE '\\'`)
        .join(' OR ');
      whereClauses.push(`(${orTrace})`);
      params.push(...effectiveTraces.map((t) => `%${escapeSqlLike(t)}%`));
    }

    for (const [metaKey, metaVal] of Object.entries(parsed.metadataFilters)) {
      whereClauses.push(`LOWER(COALESCE(metadata->>$${idx++}, '')) = LOWER($${idx++})`);
      params.push(metaKey, metaVal);
    }

    for (const term of parsed.terms) {
      whereClauses.push(
        `(LOWER(message) LIKE LOWER($${idx}) ESCAPE '\\' OR LOWER(service) LIKE LOWER($${idx}) ESCAPE '\\' OR LOWER(COALESCE(trace_id, '')) LIKE LOWER($${idx}) ESCAPE '\\' OR LOWER(CAST(metadata AS TEXT)) LIKE LOWER($${idx}) ESCAPE '\\')`
      );
      params.push(`%${escapeSqlLike(term)}%`);
      idx++;
    }

    if (filter.from) {
      whereClauses.push(`timestamp >= $${idx++}`);
      params.push(filter.from);
    }
    if (filter.to) {
      whereClauses.push(`timestamp <= $${idx++}`);
      params.push(filter.to);
    }

    const whereSql = whereClauses.join(' AND ');
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);

    const countRes = await db.query<{ cnt: string | number }>(
      `SELECT COUNT(*) AS cnt FROM log_events WHERE ${whereSql}`,
      params
    );
    const total = Number(countRes.rows[0]?.cnt ?? 0);

    const itemsRes = await db.query(
      `SELECT id, project_id, timestamp, level, service, message, metadata, trace_id, received_at
       FROM log_events
       WHERE ${whereSql}
       ORDER BY timestamp DESC, id DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const servicesRes = await db.query<{ service: string }>(
      `SELECT DISTINCT service FROM log_events WHERE project_id = $1 ORDER BY service ASC`,
      [filter.projectId]
    );

    const levelCountsRes = await db.query<{ level: LogLevel; cnt: string | number }>(
      `SELECT level, COUNT(*) AS cnt FROM log_events WHERE ${whereSql} GROUP BY level`,
      params
    );

    const levelCounts: Record<LogLevel, number> = {
      trace: 0,
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0
    };
    for (const row of levelCountsRes.rows) {
      if (ALL_LEVELS.includes(row.level)) {
        levelCounts[row.level] = Number(row.cnt);
      }
    }

    return {
      items: itemsRes.rows.map(normalizeRow),
      total,
      limit,
      offset,
      facets: {
        services: servicesRes.rows.map((r) => r.service),
        levelCounts
      }
    };
  }

  async getOverviewStats(projectId: string, rangeHours = 24): Promise<OverviewStats> {
    const db = await getDb();
    const now = new Date();
    const startOfToday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const rangeStart = new Date(now.getTime() - rangeHours * 60 * 60 * 1000).toISOString();

    const [todayRes, errHourRes, sourcesRes, recentRateRes, topServicesRes, recentErrorsRes, seriesRowsRes] =
      await Promise.all([
        db.query<{ cnt: string | number }>(
          `SELECT COUNT(*) AS cnt FROM log_events WHERE project_id = $1 AND timestamp >= $2`,
          [projectId, startOfToday]
        ),
        db.query<{ cnt: string | number }>(
          `SELECT COUNT(*) AS cnt FROM log_events WHERE project_id = $1 AND timestamp >= $2 AND level IN ('error', 'fatal')`,
          [projectId, oneHourAgo]
        ),
        db.query<{ cnt: string | number }>(
          `SELECT COUNT(DISTINCT service) AS cnt FROM log_events WHERE project_id = $1 AND timestamp >= $2`,
          [projectId, startOfToday]
        ),
        db.query<{ cnt: string | number }>(
          `SELECT COUNT(*) AS cnt FROM log_events WHERE project_id = $1 AND timestamp >= $2`,
          [projectId, fifteenMinAgo]
        ),
        db.query<{ service: string; total: string | number; errors: string | number; last_seen: string }>(
          `SELECT
             service,
             COUNT(*) AS total,
             SUM(CASE WHEN level IN ('error', 'fatal') THEN 1 ELSE 0 END) AS errors,
             MAX(timestamp) AS last_seen
           FROM log_events
           WHERE project_id = $1 AND timestamp >= $2
           GROUP BY service
           ORDER BY total DESC
           LIMIT 6`,
          [projectId, rangeStart]
        ),
        db.query(
          `SELECT id, project_id, timestamp, level, service, message, metadata, trace_id, received_at
           FROM log_events
           WHERE project_id = $1 AND level IN ('error', 'fatal')
           ORDER BY timestamp DESC
           LIMIT 8`,
          [projectId]
        ),
        db.query<{ timestamp: string; level: LogLevel }>(
          `SELECT timestamp, level FROM log_events WHERE project_id = $1 AND timestamp >= $2 ORDER BY timestamp ASC`,
          [projectId, rangeStart]
        )
      ]);

    const bucketCount = 12;
    const spanMs = rangeHours * 60 * 60 * 1000;
    const stepMs = Math.floor(spanMs / bucketCount);
    const startMs = now.getTime() - spanMs;

    const buckets = Array.from({ length: bucketCount }, (_, i) => {
      const bucketTime = new Date(startMs + i * stepMs);
      return {
        bucket: bucketTime.toISOString(),
        trace: 0,
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
        fatal: 0
      };
    });

    for (const row of seriesRowsRes.rows) {
      const ts = new Date(row.timestamp).getTime();
      const idx = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((ts - startMs) / stepMs))
      );
      const lvl = row.level;
      if (buckets[idx] && ALL_LEVELS.includes(lvl)) {
        buckets[idx][lvl] += 1;
      }
    }

    const recentCount15m = Number(recentRateRes.rows[0]?.cnt ?? 0);

    return {
      eventsToday: Number(todayRes.rows[0]?.cnt ?? 0),
      errorsLastHour: Number(errHourRes.rows[0]?.cnt ?? 0),
      activeSources: Number(sourcesRes.rows[0]?.cnt ?? 0),
      eventsPerMinute: Math.round((recentCount15m / 15) * 10) / 10,
      series: buckets,
      topServices: topServicesRes.rows.map((r) => ({
        service: r.service,
        total: Number(r.total),
        errors: Number(r.errors ?? 0),
        lastSeen: new Date(r.last_seen).toISOString()
      })),
      recentErrors: recentErrorsRes.rows.map(normalizeRow)
    };
  }

  async getProjectActivity(projectId: string): Promise<ProjectActivityStats> {
    const db = await getDb();
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [rateRes, lastRes] = await Promise.all([
      db.query<{ cnt: string | number }>(
        `SELECT COUNT(*) AS cnt FROM log_events WHERE project_id = $1 AND timestamp >= $2`,
        [projectId, fifteenMinAgo]
      ),
      db.query<{ max_ts: string | null }>(
        `SELECT MAX(timestamp) AS max_ts FROM log_events WHERE project_id = $1`,
        [projectId]
      )
    ]);

    const cnt = Number(rateRes.rows[0]?.cnt ?? 0);
    const maxTs = lastRes.rows[0]?.max_ts;

    return {
      eventsPerMinute: Math.round((cnt / 15) * 10) / 10,
      lastEventAt: maxTs ? new Date(maxTs).toISOString() : null
    };
  }

  async countMatchingInWindow(params: {
    projectId: string;
    level?: LogLevel | null;
    service?: string | null;
    query?: string | null;
    windowMinutes: number;
  }): Promise<{ count: number; sampleMessage: string }> {
    const db = await getDb();
    const windowStart = new Date(Date.now() - params.windowMinutes * 60 * 1000).toISOString();
    const clauses: string[] = ['project_id = $1', 'timestamp >= $2'];
    const args: unknown[] = [params.projectId, windowStart];
    let idx = 3;

    if (params.level) {
      clauses.push(`level = $${idx++}`);
      args.push(params.level);
    }
    if (params.service) {
      clauses.push(`LOWER(service) = LOWER($${idx++})`);
      args.push(params.service);
    }
    if (params.query) {
      clauses.push(`LOWER(message) LIKE LOWER($${idx++}) ESCAPE '\\'`);
      args.push(`%${escapeSqlLike(params.query)}%`);
    }

    const where = clauses.join(' AND ');
    const res = await db.query<{ cnt: string | number; sample: string | null }>(
      `SELECT COUNT(*) AS cnt, MAX(message) AS sample FROM log_events WHERE ${where}`,
      args
    );

    return {
      count: Number(res.rows[0]?.cnt ?? 0),
      sampleMessage: res.rows[0]?.sample ?? 'Threshold exceeded'
    };
  }

  async deleteExpiredLogs(projectId: string, retentionDays: number): Promise<number> {
    const db = await getDb();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const res = await db.query(
      `DELETE FROM log_events WHERE project_id = $1 AND timestamp < $2`,
      [projectId, cutoff]
    );
    return res.rowCount;
  }
}

