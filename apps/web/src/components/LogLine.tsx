import React, { useState } from 'react';
import type { StoredLogEvent } from '@logflow/shared';
import { Icon } from './Icon';
import { LevelBadge } from './LevelBadge';

interface LogLineProps {
  event: StoredLogEvent;
  highlightTerms?: string[];
  wrapLines?: boolean;
  onFilterService?: (service: string) => void;
  onFilterTrace?: (traceId: string) => void;
}

function renderHighlightedText(text: string, terms: string[]): React.ReactNode {
  const validTerms = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (validTerms.length === 0) return text;

  const escaped = validTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    const isMatch = validTerms.some((t) => t.toLowerCase() === part.toLowerCase());
    return isMatch ? <mark key={idx}>{part}</mark> : <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}.${ms}`;
  } catch {
    return iso;
  }
}

export const LogLine: React.FC<LogLineProps> = ({
  event,
  highlightTerms = [],
  wrapLines = false,
  onFilterService,
  onFilterTrace
}) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const severityMod =
    event.level === 'error'
      ? 'lf-logline--error'
      : event.level === 'warn'
        ? 'lf-logline--warn'
        : event.level === 'fatal'
          ? 'lf-logline--fatal'
          : '';

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const lineStr = JSON.stringify(
      {
        timestamp: event.timestamp,
        level: event.level,
        service: event.service,
        message: event.message,
        trace_id: event.trace_id,
        metadata: event.metadata
      },
      null,
      2
    );
    navigator.clipboard.writeText(lineStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`lf-logline ${severityMod}`.trim()}>
      <div
        className="lf-logline__summary"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        <time className="lf-logline__time" dateTime={event.timestamp}>
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={14}
            className="lf-mr-1"
          />{' '}
          {formatTimestamp(event.timestamp)}
        </time>

        <div>
          <LevelBadge level={event.level} />
        </div>

        <span
          className="lf-logline__service svc"
          title={`Service: ${event.service}`}
          onClick={(e) => {
            if (onFilterService) {
              e.stopPropagation();
              onFilterService(event.service);
            }
          }}
        >
          {event.service}
        </span>

        <div
          className={`lf-logline__msg ${
            wrapLines ? 'lf-logline__msg--wrap' : 'lf-logline__msg--nowrap'
          }`}
        >
          {renderHighlightedText(event.message, highlightTerms)}
          {event.trace_id ? (
            <span
              className="lf-tag"
              style={{ marginLeft: 8, cursor: onFilterTrace ? 'pointer' : 'default' }}
              title="Filter by trace_id"
              onClick={(e) => {
                if (onFilterTrace && event.trace_id) {
                  e.stopPropagation();
                  onFilterTrace(event.trace_id);
                }
              }}
            >
              <Icon name="trace-id" size={12} />
              {event.trace_id}
            </span>
          ) : null}
        </div>

        <div className="lf-logline__actions">
          <button
            type="button"
            className="lf-btn lf-btn--ghost lf-btn--icon"
            style={{ height: 26, width: 26 }}
            onClick={handleCopy}
            aria-label="Copy log event JSON"
            title={copied ? 'Copied!' : 'Copy log line'}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="lf-logline__details">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              marginBottom: '8px',
              color: 'var(--lf-text-muted)'
            }}
          >
            <span>
              <strong>Event ID:</strong> <code>{event.id}</code>
            </span>
            <span>
              <strong>Service:</strong> <code>{event.service}</code>
            </span>
            {event.trace_id ? (
              <span>
                <strong>Trace ID:</strong> <code>{event.trace_id}</code>
              </span>
            ) : null}
            <span>
              <strong>Received:</strong> <code>{event.received_at}</code>
            </span>
          </div>
          <div style={{ fontWeight: 600, color: 'var(--lf-text-muted)' }}>
            <Icon name="json" size={14} /> Metadata Payload
          </div>
          <pre className="lf-json-pre">
            {JSON.stringify(event.metadata ?? {}, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
};

