import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OverviewStats } from '@logflow/shared';
import { apiClient } from '../api/client';
import { Icon } from '../components/Icon';
import { LogLine } from '../components/LogLine';
import { useProjects } from '../context/ProjectContext';

export const OverviewPage: React.FC = () => {
  const { activeProject } = useProjects();
  const navigate = useNavigate();

  const [rangeHours, setRangeHours] = useState(24);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const res = await apiClient.getOverviewStats(activeProject.id, rangeHours);
      setStats(res);
    } finally {
      setLoading(false);
    }
  }, [activeProject, rangeHours]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const maxBucketTotal = Math.max(
    1,
    ...(stats?.series.map(
      (b) => b.trace + b.debug + b.info + b.warn + b.error + b.fatal
    ) ?? [1])
  );

  return (
    <div>
      <div className="lf-page-header">
        <div>
          <h1 className="lf-page-title">Overview Dashboard</h1>
          <p className="lf-page-subtitle">
            Real-time health, event volume by severity, and noisy service breakdown for{' '}
            <strong>{activeProject?.name ?? 'workspace'}</strong>.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="lf-select"
            value={rangeHours}
            onChange={(e) => setRangeHours(Number(e.target.value))}
            aria-label="Chart time window"
          >
            <option value={6}>Last 6 Hours</option>
            <option value={24}>Last 24 Hours</option>
            <option value={72}>Last 3 Days</option>
          </select>

          <button type="button" className="lf-btn lf-btn--secondary" onClick={loadStats}>
            <Icon name="refresh" size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="lf-grid-stats">
        <div className="lf-card lf-stat-card">
          <div className="lf-stat-card__label">
            <span>Events Today (24h)</span>
            <Icon name="logs" size={18} />
          </div>
          <div className="lf-stat-card__value">
            {stats ? stats.eventsToday.toLocaleString() : '—'}
          </div>
          <div className="lf-stat-card__meta">
            Across all active pipelines in {activeProject?.name}
          </div>
        </div>

        <div className="lf-card lf-stat-card">
          <div className="lf-stat-card__label">
            <span>Errors (Last Hour)</span>
            <Icon name="error" size={18} />
          </div>
          <div
            className="lf-stat-card__value"
            style={{ color: (stats?.errorsLastHour ?? 0) > 0 ? 'var(--lf-error)' : undefined }}
          >
            {stats ? stats.errorsLastHour.toLocaleString() : '—'}
          </div>
          <div className="lf-stat-card__meta">
            Includes <code>ERROR</code> and <code>FATAL</code> severities
          </div>
        </div>

        <div className="lf-card lf-stat-card">
          <div className="lf-stat-card__label">
            <span>Active Sources</span>
            <Icon name="service" size={18} />
          </div>
          <div className="lf-stat-card__value">
            {stats ? stats.activeSources : '—'}
          </div>
          <div className="lf-stat-card__meta">
            Distinct services emitting logs today
          </div>
        </div>

        <div className="lf-card lf-stat-card">
          <div className="lf-stat-card__label">
            <span>Ingestion Rate</span>
            <Icon name="bolt" size={18} />
          </div>
          <div className="lf-stat-card__value" style={{ color: 'var(--lf-teal)' }}>
            {stats ? `${stats.eventsPerMinute}/m` : '—'}
          </div>
          <div className="lf-stat-card__meta">
            Rolling 15-minute average throughput
          </div>
        </div>
      </div>

      {/* Time-Series Chart + Top Noisy Services */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 'var(--lf-space-5)',
          marginBottom: 'var(--lf-space-5)'
        }}
      >
        <div className="lf-card" style={{ gridColumn: 'span 1' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--lf-space-4)'
            }}
          >
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="chart-bar" size={18} />
              <span>Events by Severity ({rangeHours}h)</span>
            </h3>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, flexWrap: 'wrap' }}>
              <span className="lf-level lf-level--info">INFO</span>
              <span className="lf-level lf-level--warn">WARN</span>
              <span className="lf-level lf-level--error">ERROR</span>
              <span className="lf-level lf-level--fatal">FATAL</span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${stats?.series.length || 12}, 1fr)`,
              gap: 8,
              height: 190,
              alignItems: 'end',
              paddingTop: 16,
              borderBottom: '1px solid var(--lf-border)'
            }}
            role="img"
            aria-label="Time-series bar chart of log events by severity level"
          >
            {(stats?.series ?? []).map((bucket, idx) => {
              const total =
                bucket.trace +
                bucket.debug +
                bucket.info +
                bucket.warn +
                bucket.error +
                bucket.fatal;
              const heightPct = Math.max(4, Math.round((total / maxBucketTotal) * 100));
              const errShare = total > 0 ? ((bucket.error + bucket.fatal) / total) * 100 : 0;
              const warnShare = total > 0 ? (bucket.warn / total) * 100 : 0;
              const infoShare = Math.max(0, 100 - errShare - warnShare);
              const timeLabel = new Date(bucket.bucket).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              });

              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    height: '100%',
                    justifyContent: 'flex-end'
                  }}
                  title={`${timeLabel} — Total: ${total} (Error/Fatal: ${
                    bucket.error + bucket.fatal
                  }, Warn: ${bucket.warn}, Info/Debug: ${
                    bucket.info + bucket.debug + bucket.trace
                  })`}
                >
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 28,
                      height: `${heightPct}%`,
                      borderRadius: '4px 4px 0 0',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    {errShare > 0 ? (
                      <div
                        style={{
                          height: `${errShare}%`,
                          background: 'var(--lf-error)',
                          minHeight: 3
                        }}
                      />
                    ) : null}
                    {warnShare > 0 ? (
                      <div
                        style={{
                          height: `${warnShare}%`,
                          background: 'var(--lf-warn)',
                          minHeight: 3
                        }}
                      />
                    ) : null}
                    <div
                      style={{
                        height: `${infoShare}%`,
                        background: 'var(--lf-blue)',
                        flex: 1
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 8,
              fontSize: 11,
              color: 'var(--lf-text-faint)',
              fontFamily: 'var(--lf-font-mono)'
            }}
          >
            <span>
              {stats?.series[0]
                ? new Date(stats.series[0].bucket).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : ''}
            </span>
            <span>Now</span>
          </div>
        </div>

        <div className="lf-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--lf-space-3)'
            }}
          >
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="service" size={18} />
              <span>Top Noisy Services</span>
            </h3>
            <button
              type="button"
              className="lf-btn lf-btn--ghost"
              onClick={() => navigate('/logs')}
            >
              <span>Explore All</span>
              <Icon name="arrow-up-right" size={14} />
            </button>
          </div>

          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Volume</th>
                  <th>Errors</th>
                  <th>Error Rate</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.topServices ?? []).map((svc) => {
                  const errRate = svc.total > 0 ? Math.round((svc.errors / svc.total) * 100) : 0;
                  return (
                    <tr
                      key={svc.service}
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        navigate(`/logs?q=${encodeURIComponent(`service:${svc.service}`)}`)
                      }
                    >
                      <td>
                        <code style={{ fontWeight: 600 }}>{svc.service}</code>
                      </td>
                      <td>{svc.total.toLocaleString()}</td>
                      <td style={{ color: svc.errors > 0 ? 'var(--lf-error)' : undefined }}>
                        {svc.errors}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 64,
                              height: 6,
                              background: 'var(--lf-surface-2)',
                              borderRadius: 99,
                              overflow: 'hidden'
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, errRate)}%`,
                                height: '100%',
                                background:
                                  errRate > 15 ? 'var(--lf-error)' : 'var(--lf-teal)'
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--lf-text-muted)' }}>
                            {errRate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Errors */}
      <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--lf-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="warning" size={18} />
            <span>Recent Error & Fatal Events</span>
          </h3>
          <button
            type="button"
            className="lf-btn lf-btn--secondary"
            onClick={() => navigate('/logs?q=level:error,fatal')}
          >
            <span>Open in Logs Explorer</span>
            <Icon name="arrow-up-right" size={15} />
          </button>
        </div>

        <div className="lf-console" style={{ border: 'none', borderRadius: 0 }}>
          <div className="lf-console__header">
            <span>Timestamp</span>
            <span>Level</span>
            <span>Service</span>
            <span>Message & Trace</span>
            <span style={{ textAlign: 'right' }}>Copy</span>
          </div>

          {!loading && (stats?.recentErrors.length ?? 0) === 0 ? (
            <div className="lf-empty">
              <img src="/assets/illustrations/empty-logs.svg" alt="No recent errors" />
              <p style={{ color: 'var(--lf-text-muted)', margin: 0 }}>
                Zero error or fatal events recorded in this project.
              </p>
            </div>
          ) : (
            (stats?.recentErrors ?? []).map((ev) => (
              <LogLine
                key={ev.id}
                event={ev}
                onFilterService={(svc) =>
                  navigate(`/logs?q=${encodeURIComponent(`service:${svc}`)}`)
                }
                onFilterTrace={(tr) =>
                  navigate(`/logs?q=${encodeURIComponent(`trace:${tr}`)}`)
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

