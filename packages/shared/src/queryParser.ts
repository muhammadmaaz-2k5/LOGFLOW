import { LogLevel, ParsedSearchQuery, StoredLogEvent, LogEventInput } from './types.js';

const VALID_LEVELS = new Set<LogLevel>(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

/**
 * Parses a LogFlow search query string such as:
 *   level:error service:auth "token expired" trace:abc-123 env:prod
 */
export function parseSearchQuery(rawQuery: string = ''): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    levels: [],
    services: [],
    traceIds: [],
    metadataFilters: {},
    terms: [],
    raw: rawQuery.trim()
  };

  if (!result.raw) {
    return result;
  }

  // Match key:"quoted value", key:value, "quoted phrase", or bare word
  const tokenRegex = /([a-zA-Z0-9_.-]+):(?:"([^"]+)"|([^\s"]+))|"([^"]+)"|([^\s"]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(result.raw)) !== null) {
    const key = match[1]?.toLowerCase();
    const keyQuotedVal = match[2];
    const keyBareVal = match[3];
    const quotedTerm = match[4];
    const bareTerm = match[5];

    if (key !== undefined) {
      const rawValue = (keyQuotedVal ?? keyBareVal ?? '').trim();
      if (!rawValue) continue;

      if (key === 'level' || key === 'lvl' || key === 'severity') {
        const parts = rawValue.split(',').map((p) => p.trim().toLowerCase() as LogLevel);
        for (const p of parts) {
          if (VALID_LEVELS.has(p) && !result.levels.includes(p)) {
            result.levels.push(p);
          }
        }
      } else if (key === 'service' || key === 'svc' || key === 'source') {
        const parts = rawValue.split(',').map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          if (!result.services.includes(p)) {
            result.services.push(p);
          }
        }
      } else if (key === 'trace' || key === 'trace_id' || key === 'traceid') {
        const parts = rawValue.split(',').map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          if (!result.traceIds.includes(p)) {
            result.traceIds.push(p);
          }
        }
      } else {
        result.metadataFilters[match[1]] = rawValue;
      }
    } else if (quotedTerm !== undefined) {
      const cleaned = quotedTerm.trim();
      if (cleaned) {
        result.terms.push(cleaned);
      }
    } else if (bareTerm !== undefined) {
      const cleaned = bareTerm.trim();
      if (cleaned) {
        result.terms.push(cleaned);
      }
    }
  }

  return result;
}

/**
 * Evaluates whether a log event matches a ParsedSearchQuery.
 * Used by LiveTail, AlertEvaluator, and unit tests.
 */
export function matchesParsedQuery(
  event: Pick<StoredLogEvent | LogEventInput, 'level' | 'service' | 'message' | 'metadata' | 'trace_id'>,
  parsed: ParsedSearchQuery
): boolean {
  if (parsed.levels.length > 0 && !parsed.levels.includes(event.level)) {
    return false;
  }

  if (parsed.services.length > 0) {
    const svcLower = event.service.toLowerCase();
    const matchedSvc = parsed.services.some((s) => svcLower === s.toLowerCase() || svcLower.includes(s.toLowerCase()));
    if (!matchedSvc) return false;
  }

  if (parsed.traceIds.length > 0) {
    const trace = (event.trace_id ?? '').toLowerCase();
    const matchedTrace = parsed.traceIds.some((t) => trace === t.toLowerCase() || trace.includes(t.toLowerCase()));
    if (!matchedTrace) return false;
  }

  for (const [k, v] of Object.entries(parsed.metadataFilters)) {
    const metaVal = event.metadata?.[k];
    if (metaVal === undefined || metaVal === null) return false;
    if (String(metaVal).toLowerCase() !== v.toLowerCase()) {
      return false;
    }
  }

  if (parsed.terms.length > 0) {
    const haystack = `${event.message} ${event.service} ${event.trace_id ?? ''} ${
      event.metadata ? JSON.stringify(event.metadata) : ''
    }`.toLowerCase();
    for (const term of parsed.terms) {
      if (!haystack.includes(term.toLowerCase())) {
        return false;
      }
    }
  }

  return true;
}

