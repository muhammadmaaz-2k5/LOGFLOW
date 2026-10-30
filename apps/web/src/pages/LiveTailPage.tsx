import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseSearchQuery, type LogLevel, type StoredLogEvent } from '@logflow/shared';
import { apiClient } from '../api/client';
import { Icon } from '../components/Icon';
import { LogLine } from '../components/LogLine';
import { useProjects } from '../context/ProjectContext';

const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export const LiveTailPage: React.FC = () => {
  const { activeProject } = useProjects();
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);

  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [availableServices, setAvailableServices] = useState<string[]>([]);

  const [events, setEvents] = useState<StoredLogEvent[]>([]);
  const [connected, setConnected] = useState(false);

  const containerEndRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Load initial recent tail events & service list
  useEffect(() => {
    if (!activeProject) return;
    apiClient
      .queryLogs({
        projectId: activeProject.id,
        q: query || undefined,
        level: levelFilter || undefined,
        service: serviceFilter || undefined,
        limit: 25
      })
      .then((res) => {
        setEvents([...res.items].reverse());
        setAvailableServices(res.facets.services);
      })
      .catch(() => {});
  }, [activeProject, query, levelFilter, serviceFilter]);

  // Connect to SSE Live Tail stream
  useEffect(() => {
    if (!activeProject) return;

    const url = apiClient.getTailStreamUrl({
      projectId: activeProject.id,
      q: query || undefined,
      level: levelFilter || undefined,
      service: serviceFilter || undefined
    });

    const es = new EventSource(url);

    es.addEventListener('connected', () => {
      setConnected(true);
    });

    es.onmessage = (msg) => {
      if (pausedRef.current) return;
      try {
        const ev = JSON.parse(msg.data) as StoredLogEvent;
        setEvents((prev) => {
          const next = [...prev, ev];
          return next.length > 300 ? next.slice(next.length - 300) : next;
        });
      } catch {
        // ignore malformed frame
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [activeProject, query, levelFilter, serviceFilter]);

  useEffect(() => {
    if (autoScroll && !paused) {
      containerEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events, autoScroll, paused]);

  const emitBurst = async () => {
    if (!activeProject) return;
    const sampleBatch = [
      {
        timestamp: new Date().toISOString(),
        level: 'info' as const,
        service: 'api-gateway',
        message: 'HTTP POST /v1/checkout/confirm 200 OK (19ms)',
        trace_id: `tr-live-${Math.floor(1000 + Math.random() * 9000)}`,
        metadata: { status: 200, region: 'us-east-1', latency_ms: 19 }
      },
      {
        timestamp: new Date().toISOString(),
        level: 'warn' as const,
        service: 'order-worker',
        message: 'Retry queue depth reached 72 messages on partition 2',
        trace_id: `tr-live-${Math.floor(1000 + Math.random() * 9000)}`,
        metadata: { partition: 2, depth: 72, env: 'prod' }
      },
      {
        timestamp: new Date().toISOString(),
        level: 'error' as const,
        service: 'auth-service',
        message: 'JWT verification failed: token expired for client session',
        trace_id: `tr-live-${Math.floor(1000 + Math.random() * 9000)}`,
        metadata: { error_code: 'TOKEN_EXPIRED', env: 'prod' }
      }
    ];
    await apiClient.sendProjectTestEvents(activeProject.id, sampleBatch).catch(() => {});
  };

  const highlightTerms = useMemo(() => parseSearchQuery(query).terms, [query]);

  return (
    <div>
      <div className="lf-page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 className="lf-page-title">Live Tail</h1>
            {!paused && connected ? (
              <span className="lf-live">Streaming Live</span>
            ) : (
              <span className="lf-tag">Paused</span>
            )}
          </div>
          <p className="lf-page-subtitle">
            Real-time event stream over SSE with instant query filtering and auto-scroll.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="lf-btn lf-btn--secondary"
            onClick={emitBurst}
            title="Send 3 live events to POST /v1/ingest"
          >
            <Icon name="bolt" size={16} />
            <span>Emit Live Burst</span>
          </button>

          <button
            type="button"
            className={`lf-btn ${paused ? 'lf-btn--primary' : 'lf-btn--secondary'}`}
            onClick={() => setPaused((p) => !p)}
          >
            <Icon name={paused ? 'play' : 'pause'} size={16} />
            <span>{paused ? 'Resume Stream' : 'Pause Stream'}</span>
          </button>

          <button
            type="button"
            className={`lf-btn ${autoScroll ? 'lf-btn--primary' : 'lf-btn--secondary'}`}
            onClick={() => setAutoScroll((a) => !a)}
            aria-pressed={autoScroll}
          >
            <Icon name="arrow-up-right" size={16} />
            <span>Auto-scroll: {autoScroll ? 'On' : 'Off'}</span>
          </button>

          <button
            type="button"
            className={`lf-btn ${wrapLines ? 'lf-btn--primary' : 'lf-btn--secondary'}`}
            onClick={() => setWrapLines((w) => !w)}
          >
            <Icon name="columns" size={16} />
            <span>Wrap</span>
          </button>

          <button
            type="button"
            className="lf-btn lf-btn--ghost"
            onClick={() => setEvents([])}
          >
            <Icon name="trash" size={16} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      <div className="lf-toolbar">
        <div style={{ flex: '1 1 280px' }}>
          <input
            type="search"
            className="lf-input lf-input--query"
            placeholder='Live filter… e.g. level:error service:auth "token expired"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Live tail query filter"
          />
        </div>

        <select
          className="lf-select"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          aria-label="Filter live tail by level"
        >
          <option value="">All Levels</option>
          {LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl.toUpperCase()}
            </option>
          ))}
        </select>

        <select
          className="lf-select"
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          aria-label="Filter live tail by service"
        >
          <option value="">All Services</option>
          {availableServices.map((svc) => (
            <option key={svc} value={svc}>
              {svc}
            </option>
          ))}
        </select>
      </div>

      <div
        className="lf-console"
        style={{ maxHeight: '68vh', overflowY: 'auto' }}
        role="log"
        aria-live={paused ? 'off' : 'polite'}
      >
        <div className="lf-console__header">
          <span>Timestamp</span>
          <span>Level</span>
          <span>Service</span>
          <span>Message & Trace</span>
          <span style={{ textAlign: 'right' }}>Copy</span>
        </div>

        {events.length === 0 ? (
          <div className="lf-empty">
            <img src="/assets/illustrations/empty-logs.svg" alt="Waiting for live logs" />
            <h3 style={{ margin: 0 }}>Listening for incoming events…</h3>
            <p style={{ color: 'var(--lf-text-muted)', margin: 0 }}>
              Send events to <code>POST /v1/ingest</code> or click <strong>Emit Live Burst</strong>{' '}
              above to see logs stream in real time.
            </p>
          </div>
        ) : (
          events.map((ev) => (
            <LogLine
              key={ev.id}
              event={ev}
              highlightTerms={highlightTerms}
              wrapLines={wrapLines}
              onFilterService={(svc) => setServiceFilter(svc)}
              onFilterTrace={(tr) => setQuery(`trace:${tr}`)}
            />
          ))
        )}
        <div ref={containerEndRef} />
      </div>
    </div>
  );
};

