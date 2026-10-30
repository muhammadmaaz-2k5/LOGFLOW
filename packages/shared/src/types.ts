export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type TeamRole = 'admin' | 'member' | 'viewer';

export interface LogEventInput {
  id?: string;
  timestamp?: string;
  level: LogLevel;
  service: string;
  message: string;
  metadata?: Record<string, unknown>;
  trace_id?: string;
}

export interface StoredLogEvent {
  id: string;
  project_id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  received_at: string;
}

export interface ParsedSearchQuery {
  levels: LogLevel[];
  services: string[];
  traceIds: string[];
  metadataFilters: Record<string, string>;
  terms: string[];
  raw: string;
}

export interface LogSearchFilter {
  projectId: string;
  q?: string;
  levels?: LogLevel[];
  services?: string[];
  traceId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface LogSearchResult {
  items: StoredLogEvent[];
  total: number;
  limit: number;
  offset: number;
  facets: {
    services: string[];
    levelCounts: Record<LogLevel, number>;
  };
}

export interface OverviewStats {
  eventsToday: number;
  errorsLastHour: number;
  activeSources: number;
  eventsPerMinute: number;
  series: Array<{
    bucket: string;
    trace: number;
    debug: number;
    info: number;
    warn: number;
    error: number;
    fatal: number;
  }>;
  topServices: Array<{
    service: string;
    total: number;
    errors: number;
    lastSeen: string;
  }>;
  recentErrors: StoredLogEvent[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: TeamRole;
  created_at: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  retention_days: number;
  created_at: string;
  events_per_minute?: number;
  connected?: boolean;
  last_event_at?: string | null;
}

export interface ApiKeyDto {
  id: string;
  project_id: string;
  name: string;
  key_prefix: string;
  rate_limit_per_min: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  raw_key?: string;
}

export interface AlertRuleDto {
  id: string;
  project_id: string;
  name: string;
  service: string | null;
  level: LogLevel;
  query: string | null;
  threshold_count: number;
  window_minutes: number;
  notify_email: string | null;
  notify_webhook_url: string | null;
  enabled: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

export interface AlertHistoryDto {
  id: string;
  rule_id: string;
  rule_name: string;
  project_id: string;
  matched_count: number;
  window_minutes: number;
  sample_message: string;
  channels_notified: string[];
  triggered_at: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

