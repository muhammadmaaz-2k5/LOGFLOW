import {
  LogSearchFilter,
  LogSearchResult,
  OverviewStats,
  StoredLogEvent,
  LogLevel
} from '@logflow/shared';

export interface ProjectActivityStats {
  eventsPerMinute: number;
  lastEventAt: string | null;
}

export interface LogStorageAdapter {
  init(): Promise<void>;
  insertBatch(events: StoredLogEvent[]): Promise<void>;
  queryLogs(filter: LogSearchFilter): Promise<LogSearchResult>;
  getOverviewStats(projectId: string, rangeHours?: number): Promise<OverviewStats>;
  getProjectActivity(projectId: string): Promise<ProjectActivityStats>;
  countMatchingInWindow(params: {
    projectId: string;
    level?: LogLevel | null;
    service?: string | null;
    query?: string | null;
    windowMinutes: number;
  }): Promise<{ count: number; sampleMessage: string }>;
  deleteExpiredLogs(projectId: string, retentionDays: number): Promise<number>;
}

