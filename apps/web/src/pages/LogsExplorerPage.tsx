import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseSearchQuery, type LogLevel, type StoredLogEvent } from '@logflow/shared';
import { apiClient } from '../api/client';
import { Icon } from '../components/Icon';
import { LogLine } from '../components/LogLine';
import { useProjects } from '../context/ProjectContext';

const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

type TimeWindow = '15m' | '1h' | '6h' | '24h' | '7d' | 'all';

function computeFromIso(windowKey: TimeWindow): string | undefined {
  const now = Date.now();
  switch (windowKey) {
    case '15m':
      return new Date(now - 15 * 60 * 1000).toISOString();
    case '1h':
      return new Date(now - 60 * 60 * 1000).toISOString();
    case '6h':
      return new Date(now - 6 * 60 * 60 * 1000).toISOString();
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return undefined;
  }
}

export const LogsExplorerPage: React.FC = () => {
  const { activeProject } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();

  const [queryInput, setQueryInput] = useState(() => searchParams.get('q') ?? '');
  const [appliedQuery, setAppliedQuery] = useState(() => searchParams.get('q') ?? '');
  const [selectedLevel, setSelectedLevel] = useState<string>(() => searchParams.get('level') ?? '');
  const [selectedService, setSelectedService] = useState<string>(
    () => searchParams.get('service') ?? ''
  );
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h');
  const [wrapLines, setWrapLines] = useState(false);

  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [items, setItems] = useState<StoredLogEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [levelCounts, setLevelCounts] = useState<Record<LogLevel, number>>({
    trace: 0,
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    fatal: 0
  });
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const res = await apiClient.queryLogs({
        projectId: activeProject.id,
        q: appliedQuery || undefined,
        level: selectedLevel || undefined,
        service: selectedService || undefined,
        from: computeFromIso(timeWindow),
        limit,
        offset
      });
      setItems(res.items);
      setTotal(res.total);
      setAvailableServices(res.facets.services);
      setLevelCounts(res.facets.levelCounts);
    } finally {
      setLoading(false);
    }
  }, [activeProject, appliedQuery, selectedLevel, selectedService, timeWindow, limit, offset]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setAppliedQuery(queryInput);
    const nextParams = new URLSearchParams();
    if (queryInput.trim()) nextParams.set('q', queryInput.trim());
    if (selectedLevel) nextParams.set('level', selectedLevel);
    if (selectedService) nextParams.set('service', selectedService);
    setSearchParams(nextParams);
  };

  const applyPresetQuery = (preset: string) => {
    setQueryInput(preset);
    setAppliedQuery(preset);
    setOffset(0);
  };

  const parsedHighlightTerms = useMemo(() => {
    return parseSearchQuery(appliedQuery).terms;
  }, [appliedQuery]);

  return (
    <div>
      <div className="lf-page-header">
        <div>
          <h1 className="lf-page-title">Logs Explorer</h1>
          <p className="lf-page-subtitle">
            Search structured events using query syntax like{' '}
            <code>level:error service:auth "token expired"</code>
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className={`lf-btn ${wrapLines ? 'lf-btn--primary' : 'lf-btn--secondary'}`}
            onClick={() => setWrapLines((prev) => !prev)}
            aria-pressed={wrapLines}
          >
            <Icon name="columns" size={16} />
            <span>{wrapLines ? 'Wrap: On' : 'Wrap: Off'}</span>
          </button>

          <button type="button" className="lf-btn lf-btn--secondary" onClick={fetchLogs}>
            <Icon name="refresh" size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <form className="lf-toolbar" onSubmit={handleSearchSubmit} role="search">
        <div style={{ position: 'relative', flex: '1 1 320px', display: 'flex', gap: 8 }}>
          <input
            type="search"
            className="lf-input lf-input--query"
            placeholder='Search logs… e.g. level:error service:auth "token expired"'
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            aria-label="Log search query"
          />
          <button type="submit" className="lf-btn lf-btn--primary">
            <Icon name="search" size={16} />
            <span>Run Query</span>
          </button>
        </div>

        <select
          className="lf-select"
          value={selectedLevel}
          onChange={(e) => {
            setSelectedLevel(e.target.value);
            setOffset(0);
          }}
          aria-label="Filter by severity level"
        >
          <option value="">All Levels</option>
          {LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl.toUpperCase()} ({levelCounts[lvl] ?? 0})
            </option>
          ))}
        </select>

        <select
          className="lf-select"
          value={selectedService}
          onChange={(e) => {
            setSelectedService(e.target.value);
            setOffset(0);
          }}
          aria-label="Filter by service"
        >
          <option value="">All Services</option>
          {availableServices.map((svc) => (
            <option key={svc} value={svc}>
              {svc}
            </option>
          ))}
        </select>

        <select
          className="lf-select"
          value={timeWindow}
          onChange={(e) => {
            setTimeWindow(e.target.value as TimeWindow);
            setOffset(0);
          }}
          aria-label="Time range"
        >
          <option value="15m">Last 15 minutes</option>
          <option value="1h">Last 1 hour</option>
          <option value="6h">Last 6 hours</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="all">All time</option>
        </select>

        {(appliedQuery || selectedLevel || selectedService) && (
          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            onClick={() => {
              setQueryInput('');
              setAppliedQuery('');
              setSelectedLevel('');
              setSelectedService('');
              setOffset(0);
              setSearchParams({});
            }}
          >
            <Icon name="x" size={15} />
            <span>Clear</span>
          </button>
        )}
      </form>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 'var(--lf-space-3)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--lf-text-muted)' }}>Quick queries:</span>
          {[
            'level:error service:auth "token expired"',
            'level:error,fatal',
            'service:payment-api timeout',
            'env:prod'
          ].map((q) => (
            <button
              key={q}
              type="button"
              className="lf-tag"
              style={{ border: '1px solid var(--lf-border)', cursor: 'pointer' }}
              onClick={() => applyPresetQuery(q)}
            >
              {q}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-text-muted)' }}>
          Showing <strong>{items.length > 0 ? offset + 1 : 0}</strong>–
          <strong>{offset + items.length}</strong> of <strong>{total.toLocaleString()}</strong>{' '}
          matching events
        </div>
      </div>

      <div className="lf-console" aria-busy={loading}>
        <div className="lf-console__header">
          <span>Timestamp</span>
          <span>Level</span>
          <span>Service</span>
          <span>Message & Trace</span>
          <span style={{ textAlign: 'right' }}>Copy</span>
        </div>

        {loading && items.length === 0 ? (
          <div style={{ padding: 24 }}>
            <div className="lf-skeleton" style={{ height: 24, marginBottom: 8 }} />
            <div className="lf-skeleton" style={{ height: 24, marginBottom: 8 }} />
            <div className="lf-skeleton" style={{ height: 24 }} />
          </div>
        ) : items.length === 0 ? (
          <div className="lf-empty">
            <img src="/assets/illustrations/empty-search.svg" alt="No matching logs" />
            <h3 style={{ margin: 0 }}>No logs matched your filter</h3>
            <p style={{ color: 'var(--lf-text-muted)', margin: 0, maxWidth: 380 }}>
              Try broadening your time range or clearing query filters like{' '}
              <code>{appliedQuery || 'level/service'}</code>.
            </p>
          </div>
        ) : (
          items.map((ev) => (
            <LogLine
              key={ev.id}
              event={ev}
              highlightTerms={parsedHighlightTerms}
              wrapLines={wrapLines}
              onFilterService={(svc) => {
                setSelectedService(svc);
                setOffset(0);
              }}
              onFilterTrace={(traceId) => {
                const nextQ = `trace:${traceId}`;
                setQueryInput(nextQ);
                setAppliedQuery(nextQ);
                setOffset(0);
              }}
            />
          ))
        )}
      </div>

      {total > limit ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'var(--lf-space-4)'
          }}
        >
          <button
            type="button"
            className="lf-btn lf-btn--secondary"
            disabled={offset === 0}
            onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
          >
            <Icon name="chevron-left" size={16} />
            <span>Previous Page</span>
          </button>

          <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-text-muted)' }}>
            Page {Math.floor(offset / limit) + 1} of {Math.ceil(total / limit)}
          </span>

          <button
            type="button"
            className="lf-btn lf-btn--secondary"
            disabled={offset + limit >= total}
            onClick={() => setOffset((prev) => prev + limit)}
          >
            <span>Next Page</span>
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
};

