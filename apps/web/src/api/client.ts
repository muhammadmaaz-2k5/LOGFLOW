import type {
  AlertHistoryDto,
  AlertRuleDto,
  ApiKeyDto,
  LogEventInput,
  LogLevel,
  LogSearchResult,
  OverviewStats,
  ProjectDto,
  TeamRole,
  UserDto
} from '@logflow/shared';

const API_BASE = import.meta.env.VITE_API_URL || '';

function getToken(): string | null {
  return localStorage.getItem('logflow_token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) ?? {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const errJson = await res.json();
      errMsg = errJson?.error?.message || errMsg;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

export const apiClient = {
  // Auth
  login(email: string, password: string) {
    return request<{ token: string; user: UserDto }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },
  register(name: string, email: string, password: string) {
    return request<{ token: string; user: UserDto }>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
  },
  me() {
    return request<{ user: UserDto }>('/v1/auth/me');
  },

  // Projects & Keys
  getProjects() {
    return request<{ projects: ProjectDto[] }>('/v1/projects');
  },
  createProject(name: string, retention_days = 30) {
    return request<{ project: ProjectDto; initial_api_key: string }>('/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name, retention_days })
    });
  },
  updateProject(id: string, data: { name?: string; retention_days?: number }) {
    return request<{ project: ProjectDto }>(`/v1/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },
  getApiKeys(projectId: string) {
    return request<{ keys: ApiKeyDto[] }>(`/v1/projects/${projectId}/keys`);
  },
  createApiKey(projectId: string, name: string, rate_limit_per_min = 5000) {
    return request<{ key: ApiKeyDto }>(`/v1/projects/${projectId}/keys`, {
      method: 'POST',
      body: JSON.stringify({ name, rate_limit_per_min })
    });
  },
  revokeApiKey(projectId: string, keyId: string) {
    return request<{ revoked: boolean; id: string }>(`/v1/projects/${projectId}/keys/${keyId}`, {
      method: 'DELETE'
    });
  },

  // Logs & Stats
  queryLogs(params: {
    projectId: string;
    q?: string;
    level?: string;
    service?: string;
    traceId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    qs.set('projectId', params.projectId);
    if (params.q) qs.set('q', params.q);
    if (params.level) qs.set('level', params.level);
    if (params.service) qs.set('service', params.service);
    if (params.traceId) qs.set('traceId', params.traceId);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));

    return request<LogSearchResult>(`/v1/logs?${qs.toString()}`);
  },

  getOverviewStats(projectId: string, rangeHours = 24) {
    const qs = new URLSearchParams({ projectId, rangeHours: String(rangeHours) });
    return request<OverviewStats>(`/v1/logs/stats?${qs.toString()}`);
  },

  // Ingest helper (authenticated JWT endpoint for UI verification & Live Tail burst)
  sendProjectTestEvents(projectId: string, events: LogEventInput[]) {
    return request<{ accepted: number; project_id: string; ids: string[] }>(
      `/v1/projects/${encodeURIComponent(projectId)}/ingest-test`,
      {
        method: 'POST',
        body: JSON.stringify(events)
      }
    );
  },

  // Alerts
  getAlertRules(projectId: string) {
    return request<{ rules: AlertRuleDto[] }>(
      `/v1/alerts/rules?projectId=${encodeURIComponent(projectId)}`
    );
  },
  createAlertRule(data: {
    project_id: string;
    name: string;
    service?: string | null;
    level: LogLevel;
    query?: string | null;
    threshold_count: number;
    window_minutes: number;
    notify_email?: string | null;
    notify_webhook_url?: string | null;
    enabled?: boolean;
  }) {
    return request<{ rule: AlertRuleDto }>('/v1/alerts/rules', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  updateAlertRule(id: string, data: Partial<AlertRuleDto>) {
    return request<{ rule: AlertRuleDto }>(`/v1/alerts/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },
  deleteAlertRule(id: string) {
    return request<{ deleted: boolean }>(`/v1/alerts/rules/${id}`, {
      method: 'DELETE'
    });
  },
  testAlertRule(id: string) {
    return request<{ triggered: boolean; history_id: string; channels_notified: string[] }>(
      `/v1/alerts/rules/${id}/test`,
      {
        method: 'POST'
      }
    );
  },
  getAlertHistory(projectId: string) {
    return request<{ history: AlertHistoryDto[] }>(
      `/v1/alerts/history?projectId=${encodeURIComponent(projectId)}`
    );
  },

  // Team
  getTeamMembers() {
    return request<{ members: UserDto[] }>('/v1/team');
  },
  inviteTeamMember(data: { name: string; email: string; role: TeamRole; password?: string }) {
    return request<{ member: UserDto }>('/v1/team', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  updateMemberRole(userId: string, role: TeamRole) {
    return request<{ updated: boolean }>(`/v1/team/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });
  },
  removeMember(userId: string) {
    return request<{ removed: boolean }>(`/v1/team/${userId}`, {
      method: 'DELETE'
    });
  },

  getTailStreamUrl(params: {
    projectId: string;
    q?: string;
    level?: string;
    service?: string;
  }): string {
    const token = getToken() ?? '';
    const qs = new URLSearchParams({
      projectId: params.projectId,
      token
    });
    if (params.q) qs.set('q', params.q);
    if (params.level) qs.set('level', params.level);
    if (params.service) qs.set('service', params.service);
    return `${API_BASE}/v1/logs/tail?${qs.toString()}`;
  }
};

