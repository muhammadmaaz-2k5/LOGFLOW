import React, { useCallback, useEffect, useState } from 'react';
import type { AlertHistoryDto, AlertRuleDto, LogLevel } from '@logflow/shared';
import { apiClient } from '../api/client';
import { Icon } from '../components/Icon';
import { LevelBadge } from '../components/LevelBadge';
import { useProjects } from '../context/ProjectContext';

export const AlertsPage: React.FC = () => {
  const { activeProject } = useProjects();
  const [rules, setRules] = useState<AlertRuleDto[]>([]);
  const [history, setHistory] = useState<AlertHistoryDto[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [name, setName] = useState('');
  const [service, setService] = useState('auth-service');
  const [level, setLevel] = useState<LogLevel>('error');
  const [query, setQuery] = useState('');
  const [thresholdCount, setThresholdCount] = useState(5);
  const [windowMinutes, setWindowMinutes] = useState(10);
  const [notifyEmail, setNotifyEmail] = useState('oncall@logflow.dev');
  const [notifyWebhook, setNotifyWebhook] = useState('https://hooks.slack.com/services/T000/B000/WEBHOOK');
  const [formError, setFormError] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    if (!activeProject) return;
    const [rulesRes, histRes] = await Promise.all([
      apiClient.getAlertRules(activeProject.id),
      apiClient.getAlertHistory(activeProject.id)
    ]);
    setRules(rulesRes.rules);
    setHistory(histRes.history);
  }, [activeProject]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject) return;
    setFormError(null);
    try {
      await apiClient.createAlertRule({
        project_id: activeProject.id,
        name: name.trim(),
        service: service.trim() || null,
        level,
        query: query.trim() || null,
        threshold_count: thresholdCount,
        window_minutes: windowMinutes,
        notify_email: notifyEmail.trim() || null,
        notify_webhook_url: notifyWebhook.trim() || null,
        enabled: true
      });
      setName('');
      setQuery('');
      setShowCreateForm(false);
      await loadAlerts();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  const handleToggleRule = async (rule: AlertRuleDto) => {
    await apiClient.updateAlertRule(rule.id, { enabled: !rule.enabled });
    await loadAlerts();
  };

  const handleDeleteRule = async (id: string) => {
    await apiClient.deleteAlertRule(id);
    await loadAlerts();
  };

  const handleTestRule = async (id: string) => {
    await apiClient.testAlertRule(id);
    await loadAlerts();
  };

  return (
    <div>
      <div className="lf-page-header">
        <div>
          <h1 className="lf-page-title">Alerts & Incident History</h1>
          <p className="lf-page-subtitle">
            Trigger email and webhook notifications when log volume crosses a rolling threshold.
          </p>
        </div>

        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={() => setShowCreateForm((prev) => !prev)}
        >
          <Icon name={showCreateForm ? 'x' : 'plus'} size={16} />
          <span>{showCreateForm ? 'Cancel' : 'New Alert Rule'}</span>
        </button>
      </div>

      {showCreateForm ? (
        <div className="lf-card" style={{ marginBottom: 'var(--lf-space-5)' }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert-rule" size={18} />
            <span>Create Threshold Alert Rule</span>
          </h3>

          {formError ? (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                background: 'var(--lf-error-bg)',
                color: 'var(--lf-error)',
                borderRadius: 'var(--lf-radius)',
                fontSize: 'var(--lf-text-xs)',
                marginBottom: 'var(--lf-space-3)'
              }}
            >
              {formError}
            </div>
          ) : null}

          <form onSubmit={handleCreateRule}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 'var(--lf-space-3)'
              }}
            >
              <div className="lf-field">
                <label htmlFor="rule-name" className="lf-label">
                  Rule Name
                </label>
                <input
                  id="rule-name"
                  className="lf-input"
                  placeholder="e.g. Auth Service Error Spike"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="lf-field">
                <label htmlFor="rule-service" className="lf-label">
                  Service (optional, blank = any)
                </label>
                <input
                  id="rule-service"
                  className="lf-input"
                  placeholder="auth-service"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                />
              </div>

              <div className="lf-field">
                <label htmlFor="rule-level" className="lf-label">
                  Severity Level
                </label>
                <select
                  id="rule-level"
                  className="lf-select"
                  style={{ width: '100%' }}
                  value={level}
                  onChange={(e) => setLevel(e.target.value as LogLevel)}
                >
                  <option value="error">ERROR</option>
                  <option value="fatal">FATAL</option>
                  <option value="warn">WARN</option>
                  <option value="info">INFO</option>
                </select>
              </div>

              <div className="lf-field">
                <label htmlFor="rule-query" className="lf-label">
                  Message Substring Filter (optional)
                </label>
                <input
                  id="rule-query"
                  className="lf-input lf-input--query"
                  placeholder="token expired"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="lf-field">
                <label htmlFor="rule-threshold" className="lf-label">
                  Threshold Count (&gt;= N events)
                </label>
                <input
                  id="rule-threshold"
                  type="number"
                  min={1}
                  max={10000}
                  className="lf-input"
                  value={thresholdCount}
                  onChange={(e) => setThresholdCount(Number(e.target.value))}
                  required
                />
              </div>

              <div className="lf-field">
                <label htmlFor="rule-window" className="lf-label">
                  Window (Minutes)
                </label>
                <input
                  id="rule-window"
                  type="number"
                  min={1}
                  max={1440}
                  className="lf-input"
                  value={windowMinutes}
                  onChange={(e) => setWindowMinutes(Number(e.target.value))}
                  required
                />
              </div>

              <div className="lf-field">
                <label htmlFor="rule-email" className="lf-label">
                  Notify Email
                </label>
                <input
                  id="rule-email"
                  type="email"
                  className="lf-input"
                  placeholder="oncall@logflow.dev"
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                />
              </div>

              <div className="lf-field">
                <label htmlFor="rule-webhook" className="lf-label">
                  Notify Webhook URL
                </label>
                <input
                  id="rule-webhook"
                  type="url"
                  className="lf-input"
                  placeholder="https://hooks.slack.com/..."
                  value={notifyWebhook}
                  onChange={(e) => setNotifyWebhook(e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                padding: '10px 14px',
                background: 'var(--lf-surface-2)',
                borderRadius: 'var(--lf-radius)',
                fontSize: 'var(--lf-text-xs)',
                marginBottom: 'var(--lf-space-3)'
              }}
            >
              Condition Preview:{' '}
              <strong>
                More than {thresholdCount} {level.toUpperCase()} events from{' '}
                <code>{service || 'any service'}</code>
                {query ? ` containing "${query}"` : ''} in {windowMinutes} minutes.
              </strong>
            </div>

            <button type="submit" className="lf-btn lf-btn--primary">
              <Icon name="check" size={16} />
              <span>Save Alert Rule</span>
            </button>
          </form>
        </div>
      ) : null}

      {/* Active Alert Rules */}
      <div className="lf-card" style={{ marginBottom: 'var(--lf-space-5)' }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="alert-rule" size={18} />
          <span>Configured Rules ({rules.length})</span>
        </h3>

        {rules.length === 0 ? (
          <div className="lf-empty">
            <img src="/assets/illustrations/empty-alerts.svg" alt="No alert rules" />
            <p style={{ color: 'var(--lf-text-muted)', margin: 0 }}>
              No alert rules configured for this project yet.
            </p>
          </div>
        ) : (
          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Rule Name</th>
                  <th>Condition</th>
                  <th>Destinations</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td style={{ fontWeight: 600 }}>{rule.name}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>&ge; {rule.threshold_count}</span>
                        <LevelBadge level={rule.level} />
                        <span>from</span>
                        <code>{rule.service || 'any-service'}</code>
                        {rule.query ? (
                          <span>
                            matching <code>"{rule.query}"</code>
                          </span>
                        ) : null}
                        <span>in {rule.window_minutes}m</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {rule.notify_email ? (
                          <span className="lf-tag" title={rule.notify_email}>
                            <Icon name="mail" size={12} /> {rule.notify_email}
                          </span>
                        ) : null}
                        {rule.notify_webhook_url ? (
                          <span className="lf-tag" title={rule.notify_webhook_url}>
                            <Icon name="webhook" size={12} /> Webhook
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`lf-btn ${
                          rule.enabled ? 'lf-btn--secondary' : 'lf-btn--ghost'
                        }`}
                        style={{ height: 28, padding: '0 10px', fontSize: 12 }}
                        onClick={() => handleToggleRule(rule)}
                      >
                        {rule.enabled ? 'Enabled' : 'Paused'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          className="lf-btn lf-btn--secondary"
                          style={{ height: 28, padding: '0 8px', fontSize: 12 }}
                          onClick={() => handleTestRule(rule.id)}
                          title="Send test notification for this rule"
                        >
                          <Icon name="bolt" size={14} />
                          <span>Test</span>
                        </button>
                        <button
                          type="button"
                          className="lf-btn lf-btn--ghost lf-btn--icon"
                          style={{ color: 'var(--lf-error)', height: 28, width: 28 }}
                          onClick={() => handleDeleteRule(rule.id)}
                          aria-label={`Delete alert rule ${rule.name}`}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alert Trigger History */}
      <div className="lf-card">
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="clock" size={18} />
          <span>Alert Trigger History</span>
        </h3>

        {history.length === 0 ? (
          <div className="lf-empty">
            <img src="/assets/illustrations/empty-alerts.svg" alt="No triggered alerts" />
            <p style={{ color: 'var(--lf-text-muted)', margin: 0 }}>
              No alert incidents have fired yet.
            </p>
          </div>
        ) : (
          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Triggered At</th>
                  <th>Rule</th>
                  <th>Window Count</th>
                  <th>Sample Event Message</th>
                  <th>Channels Notified</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--lf-font-mono)', fontSize: 12 }}>
                      {new Date(item.triggered_at).toLocaleString()}
                    </td>
                    <td style={{ fontWeight: 600 }}>{item.rule_name}</td>
                    <td>
                      <span className="lf-level lf-level--error">
                        {item.matched_count} in {item.window_minutes}m
                      </span>
                    </td>
                    <td>
                      <code>{item.sample_message}</code>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {item.channels_notified.map((ch, idx) => (
                          <span key={idx} className="lf-tag">
                            {ch.startsWith('email:') ? (
                              <Icon name="mail" size={12} />
                            ) : (
                              <Icon name="webhook" size={12} />
                            )}
                            {ch.replace(/^(email|webhook):/, '').slice(0, 28)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

