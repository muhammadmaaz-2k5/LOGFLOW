import {
  LogLevel,
  LogSearchFilter,
  LogSearchResult,
  OverviewStats,
  StoredLogEvent,
  parseSearchQuery
} from '@logflow/shared';
import { config } from '../config.js';
import { LogStorageAdapter, ProjectActivityStats } from './LogStorageAdapter.js';

function escapeChString(val: string): string {
  return `'${val.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export class ClickHouseLogAdapter implements LogStorageAdapter {
  private baseUrl: string;
  private db: string;

  constructor() {
    this.baseUrl = config.clickhouse.url.replace(/\/$/, '');
    this.db = config.clickhouse.db;
  }

  private async execCh(sql: string, body?: string): Promise<string> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('query', sql);
    if (config.clickhouse.user) url.searchParams.set('user', config.clickhouse.user);
    if (config.clickhouse.password) url.searchParams.set('password', config.clickhouse.password);

    const res = await fetch(url.toString(), {
      method: 'POST',
      body
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ClickHouse error (${res.status}): ${errText}`);
    }
    return res.text();
  }

  async init(): Promise<void> {
    await this.execCh(`CREATE DATABASE IF NOT EXISTS ${this.db}`);
    await this.execCh(`
      CREATE TABLE IF NOT EXISTS ${this.db}.log_events (
        id String,
        project_id LowCardinality(String),
        timestamp DateTime64(3, 'UTC'),
        level LowCardinality(String),
        service LowCardinality(String),
        message String,
        metadata String,
        trace_id Nullable(String),
        received_at DateTime64(3, 'UTC')
      )
      ENGINE = MergeTree()
      ORDER BY (project_id, timestamp, id)
    `);
  }

  async insertBatch(events: StoredLogEvent[]): Promise<void> {
    if (events.length === 0) return;
    const ndjson = events
      .map((ev) =>
        JSON.stringify({
          id: ev.id,
          project_id: ev.project_id,
          timestamp: new Date(ev.timestamp).toISOString().replace('T', ' ').replace('Z', ''),
          level: ev.level,
          service: ev.service,
          message: ev.message,
          metadata: JSON.stringify(ev.metadata ?? {}),
          trace_id: ev.trace_id ?? null,
          received_at: new Date(ev.received_at).toISOString().replace('T', ' ').replace('Z', '')
        })
      )
      .join('\n');

    await this.execCh(`INSERT INTO ${this.db}.log_events FORMAT JSONEachRow`, ndjson);
  }

  async queryLogs(filter: LogSearchFilter): Promise<LogSearchResult> {
    const parsed = parseSearchQuery(filter.q ?? '');
    const where: string[] = [`project_id = ${escapeChString(filter.projectId)}`];

    const levels = Array.from(new Set([...(filter.levels ?? []), ...parsed.levels]));
    if (levels.length > 0) {
      where.push(`level IN (${levels.map(escapeChString).join(', ')})`);
    }

    const services = Array.from(new Set([...(filter.services ?? []), ...parsed.services]));
    if (services.length > 0) {
      where.push(
        `(${services.map((s) => `positionCaseInsensitive(service, ${escapeChString(s)}) > 0`).join(' OR ')})`
      );
    }

    for (const term of parsed.terms) {
      where.push(
        `(positionCaseInsensitive(message, ${escapeChString(term)}) > 0 OR positionCaseInsensitive(metadata, ${escapeChString(term)}) > 0)`
      );
    }

    const whereSql = where.join(' AND ');
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);

    const rowsJson = await this.execCh(
      `SELECT id, project_id, timestamp, level, service, message, metadata, trace_id, received_at
       FROM ${this.db}.log_events
       WHERE ${whereSql}
       ORDER BY timestamp DESC
       LIMIT ${limit} OFFSET ${offset}
       FORMAT JSON`
    );
    const parsedJson = JSON.parse(rowsJson);

    const countJson = await this.execCh(
      `SELECT count() AS cnt FROM ${this.db}.log_events WHERE ${whereSql} FORMAT JSON`
    );
    const total = Number(JSON.parse(countJson).data?.[0]?.cnt ?? 0);

    return {
      items: (parsedJson.data ?? []).map((r: any) => ({
        id: r.id,
        project_id: r.project_id,
        timestamp: new Date(`${r.timestamp}Z`).toISOString(),
        level: r.level as LogLevel,
        service: r.service,
        message: r.message,
        metadata: JSON.parse(r.metadata || '{}'),
        trace_id: r.trace_id,
        received_at: new Date(`${r.received_at}Z`).toISOString()
      })),
      total,
      limit,
      offset,
      facets: {
        services: [],
        levelCounts: { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 }
      }
    };
  }

  async getOverviewStats(projectId: string): Promise<OverviewStats> {
    const res = await this.queryLogs({ projectId, limit: 20 });
    return {
      eventsToday: res.total,
      errorsLastHour: res.items.filter((i) => i.level === 'error' || i.level === 'fatal').length,
      activeSources: new Set(res.items.map((i) => i.service)).size,
      eventsPerMinute: Math.round((res.items.length / 15) * 10) / 10,
      series: [],
      topServices: [],
      recentErrors: res.items.filter((i) => i.level === 'error' || i.level === 'fatal').slice(0, 8)
    };
  }

  async getProjectActivity(projectId: string): Promise<ProjectActivityStats> {
    const res = await this.queryLogs({ projectId, limit: 1 });
    return {
      eventsPerMinute: 0,
      lastEventAt: res.items[0]?.timestamp ?? null
    };
  }

  async countMatchingInWindow(params: {
    projectId: string;
    level?: LogLevel | null;
    service?: string | null;
    query?: string | null;
    windowMinutes: number;
  }): Promise<{ count: number; sampleMessage: string }> {
    const res = await this.queryLogs({
      projectId: params.projectId,
      levels: params.level ? [params.level] : undefined,
      services: params.service ? [params.service] : undefined,
      q: params.query ?? undefined,
      limit: 5
    });
    return {
      count: res.total,
      sampleMessage: res.items[0]?.message ?? 'Threshold exceeded'
    };
  }

  async deleteExpiredLogs(projectId: string, retentionDays: number): Promise<number> {
    await this.execCh(
      `ALTER TABLE ${this.db}.log_events DELETE WHERE project_id = ${escapeChString(projectId)} AND timestamp < now() - INTERVAL ${Number(retentionDays)} DAY`
    );
    return 0;
  }
}

