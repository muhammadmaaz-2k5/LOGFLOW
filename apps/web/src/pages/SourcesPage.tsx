import React, { useEffect, useState } from 'react';
import type { ApiKeyDto } from '@logflow/shared';
import { apiClient } from '../api/client';
import { Icon } from '../components/Icon';
import { useProjects } from '../context/ProjectContext';

type SnippetTab = 'curl' | 'node' | 'python' | 'docker';

export const SourcesPage: React.FC = () => {
  const { projects, activeProject, setActiveProjectId, refreshProjects } = useProjects();
  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRate, setNewKeyRate] = useState(5000);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);

  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRetention, setNewProjectRetention] = useState(30);
  const [snippetTab, setSnippetTab] = useState<SnippetTab>('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [testIngestStatus, setTestIngestStatus] = useState<string | null>(null);

  const loadKeys = async (projectId: string) => {
    const res = await apiClient.getApiKeys(projectId);
    setKeys(res.keys);
  };

  useEffect(() => {
    if (activeProject) {
      loadKeys(activeProject.id);
    }
  }, [activeProject]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    const res = await apiClient.createProject(newProjectName.trim(), newProjectRetention);
    setNewProjectName('');
    setCreatedRawKey(res.initial_api_key);
    await refreshProjects();
    setActiveProjectId(res.project.id);
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !newKeyName.trim()) return;
    const res = await apiClient.createApiKey(activeProject.id, newKeyName.trim(), newKeyRate);
    setNewKeyName('');
    if (res.key.raw_key) {
      setCreatedRawKey(res.key.raw_key);
    }
    await loadKeys(activeProject.id);
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!activeProject) return;
    await apiClient.revokeApiKey(activeProject.id, keyId);
    await loadKeys(activeProject.id);
  };

  const displayApiKey =
    createdRawKey ||
    `${keys.find((k) => !k.revoked_at)?.key_prefix ?? 'lf_live_'}<YOUR_PROJECT_API_KEY>`;

  const endpointUrl = `${window.location.protocol}//${window.location.hostname}:4000/v1/ingest`;

  const snippets: Record<SnippetTab, string> = {
    curl: `curl -X POST "${endpointUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${displayApiKey}" \\
  -d '[
    {
      "timestamp": "${new Date().toISOString()}",
      "level": "error",
      "service": "checkout-service",
      "message": "Payment gateway timeout after 15000ms",
      "trace_id": "tr-98a12f",
      "metadata": { "region": "us-east-1", "attempt": 3 }
    }
  ]'`,
    node: `// Node.js / TypeScript (fetch)
await fetch("${endpointUrl}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.LOGFLOW_API_KEY ?? "${displayApiKey}"
  },
  body: JSON.stringify([
    {
      timestamp: new Date().toISOString(),
      level: "info",
      service: "api-gateway",
      message: "Request completed in 24ms",
      trace_id: "tr-7741bc",
      metadata: { status: 200, path: "/v1/orders" }
    }
  ])
});`,
    python: `import requests
from datetime import datetime, timezone

requests.post(
    "${endpointUrl}",
    headers={"X-API-Key": "${displayApiKey}"},
    json=[
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": "warn",
            "service": "ml-worker",
            "message": "GPU batch queue depth above 80%",
            "trace_id": "tr-py-4012",
            "metadata": {"queue_depth": 84, "node": "gpu-04"}
        }
    ],
    timeout=5,
)`,
    docker: `# docker-compose.yml (Fluent Bit HTTP output to LogFlow)
services:
  app:
    image: my-org/payment-api:latest
    logging:
      driver: fluentd
  fluent-bit:
    image: cr.fluentbit.io/fluent/fluent-bit:3.0
    command: >
      /fluent-bit/bin/fluent-bit
      -i forward
      -o http://host.docker.internal:4000/v1/ingest
      -p Format=json
      -p Header="X-API-Key ${displayApiKey}"`
  };

  const handleSendTestEvent = async () => {
    if (!activeProject) return;
    setTestIngestStatus('Sending…');
    try {
      const res = await apiClient.sendProjectTestEvents(activeProject.id, [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          service: 'sdk-verifier',
          message: 'LogFlow connectivity verification ping succeeded',
          trace_id: `tr-verify-${Math.floor(1000 + Math.random() * 9000)}`,
          metadata: { source: 'sources-page', browser: navigator.userAgent.slice(0, 48) }
        }
      ]);
      setTestIngestStatus(`Accepted ${res.accepted} event (${res.ids[0]})`);
      await refreshProjects();
    } catch (err: any) {
      setTestIngestStatus(`Error: ${err.message}`);
    }
  };

  return (
    <div>
      <div className="lf-page-header">
        <div>
          <h1 className="lf-page-title">Sources & API Keys</h1>
          <p className="lf-page-subtitle">
            Manage projects, generate per-project ingestion API keys, and copy SDK setup snippets.
          </p>
        </div>
        <button type="button" className="lf-btn lf-btn--primary" onClick={handleSendTestEvent}>
          <Icon name="bolt" size={16} />
          <span>Send Verification Event</span>
        </button>
      </div>

      {testIngestStatus ? (
        <div
          className="lf-card"
          style={{
            marginBottom: 'var(--lf-space-4)',
            padding: '12px 16px',
            borderColor: 'var(--lf-teal)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="success" size={18} />
            <strong>Ingestion Pipeline Check:</strong> {testIngestStatus}
          </span>
          <button
            type="button"
            className="lf-btn lf-btn--ghost lf-btn--icon"
            onClick={() => setTestIngestStatus(null)}
            aria-label="Dismiss notification"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : null}

      {createdRawKey ? (
        <div
          className="lf-card"
          style={{
            marginBottom: 'var(--lf-space-5)',
            borderColor: 'var(--lf-teal)',
            background: 'var(--lf-surface-2)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ color: 'var(--lf-teal)' }}>
                <Icon name="api-key" size={16} /> Copy your new API key now (shown only once):
              </strong>
              <div style={{ marginTop: 6 }}>
                <code
                  style={{
                    padding: '6px 10px',
                    background: 'var(--lf-surface)',
                    border: '1px solid var(--lf-border)',
                    borderRadius: 'var(--lf-radius)'
                  }}
                >
                  {createdRawKey}
                </code>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="lf-btn lf-btn--secondary"
                onClick={() => navigator.clipboard.writeText(createdRawKey)}
              >
                <Icon name="copy" size={16} />
                <span>Copy Key</span>
              </button>
              <button
                type="button"
                className="lf-btn lf-btn--ghost"
                onClick={() => setCreatedRawKey(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 'var(--lf-space-5)',
          marginBottom: 'var(--lf-space-5)'
        }}
      >
        <div className="lf-card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="database" size={18} />
            <span>Projects & Connection Status</span>
          </h3>
          <div className="lf-table-wrap" style={{ marginBottom: 'var(--lf-space-4)' }}>
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Rate</th>
                  <th>Retention</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((proj) => (
                  <tr
                    key={proj.id}
                    onClick={() => setActiveProjectId(proj.id)}
                    style={{
                      cursor: 'pointer',
                      fontWeight: proj.id === activeProject?.id ? 600 : 400
                    }}
                  >
                    <td>
                      {proj.name}
                      <div style={{ fontSize: 11, color: 'var(--lf-text-faint)' }}>
                        <code>{proj.id}</code>
                      </div>
                    </td>
                    <td>
                      {proj.connected ? (
                        <span className="lf-live">Connected</span>
                      ) : (
                        <span className="lf-tag">Idle</span>
                      )}
                    </td>
                    <td>
                      <code>{proj.events_per_minute ?? 0}/min</code>
                    </td>
                    <td>{proj.retention_days} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={handleCreateProject}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="new-proj-name" className="lf-label">
                New Project Name
              </label>
              <input
                id="new-proj-name"
                className="lf-input"
                placeholder="e.g. EU Checkout Cluster"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                required
              />
            </div>
            <div style={{ width: 120 }}>
              <label htmlFor="new-proj-ret" className="lf-label">
                Retention (days)
              </label>
              <input
                id="new-proj-ret"
                type="number"
                className="lf-input"
                min={1}
                max={365}
                value={newProjectRetention}
                onChange={(e) => setNewProjectRetention(Number(e.target.value))}
              />
            </div>
            <button type="submit" className="lf-btn lf-btn--primary">
              <Icon name="plus" size={16} />
              <span>Create</span>
            </button>
          </form>
        </div>

        <div className="lf-card">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="api-key" size={18} />
            <span>API Keys — {activeProject?.name}</span>
          </h3>

          <div className="lf-table-wrap" style={{ marginBottom: 'var(--lf-space-4)' }}>
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key Prefix</th>
                  <th>Rate Limit</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>
                      <code>{k.key_prefix}••••</code>
                    </td>
                    <td>
                      <code>{k.rate_limit_per_min}/min</code>
                    </td>
                    <td>
                      {k.revoked_at ? (
                        <span className="lf-level lf-level--error">REVOKED</span>
                      ) : (
                        <span className="lf-level lf-level--info">ACTIVE</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!k.revoked_at ? (
                        <button
                          type="button"
                          className="lf-btn lf-btn--ghost"
                          style={{ color: 'var(--lf-error)', height: 28, padding: '0 8px' }}
                          onClick={() => handleRevokeKey(k.id)}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={handleCreateKey}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="new-key-name" className="lf-label">
                Key Label
              </label>
              <input
                id="new-key-name"
                className="lf-input"
                placeholder="e.g. Kubernetes Vector DaemonSet"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                required
              />
            </div>
            <div style={{ width: 130 }}>
              <label htmlFor="new-key-rate" className="lf-label">
                Limit (evt/min)
              </label>
              <input
                id="new-key-rate"
                type="number"
                className="lf-input"
                min={50}
                max={100000}
                value={newKeyRate}
                onChange={(e) => setNewKeyRate(Number(e.target.value))}
              />
            </div>
            <button type="submit" className="lf-btn lf-btn--primary">
              <Icon name="plus" size={16} />
              <span>Generate Key</span>
            </button>
          </form>
        </div>
      </div>

      <div className="lf-card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 'var(--lf-space-3)'
          }}
        >
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="terminal" size={18} />
            <span>Quickstart Ingestion Snippets</span>
          </h3>

          <div style={{ display: 'flex', gap: 6 }}>
            {(['curl', 'node', 'python', 'docker'] as SnippetTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`lf-btn ${
                  snippetTab === tab ? 'lf-btn--primary' : 'lf-btn--secondary'
                }`}
                onClick={() => setSnippetTab(tab)}
              >
                {tab === 'curl'
                  ? 'cURL'
                  : tab === 'node'
                    ? 'Node.js'
                    : tab === 'python'
                      ? 'Python'
                      : 'Docker'}
              </button>
            ))}
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              onClick={() => {
                navigator.clipboard.writeText(snippets[snippetTab]);
                setCopiedSnippet(true);
                setTimeout(() => setCopiedSnippet(false), 1500);
              }}
            >
              <Icon name={copiedSnippet ? 'check' : 'copy'} size={16} />
              <span>{copiedSnippet ? 'Copied!' : 'Copy Snippet'}</span>
            </button>
          </div>
        </div>

        <pre className="lf-json-pre" style={{ fontSize: 'var(--lf-text-sm)', padding: 16 }}>
          {snippets[snippetTab]}
        </pre>
      </div>
    </div>
  );
};

