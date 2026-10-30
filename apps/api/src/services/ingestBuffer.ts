import crypto from 'node:crypto';
import { LogEventInput, StoredLogEvent } from '@logflow/shared';
import { getLogAdapter } from '../adapters/index.js';
import { evaluateAlertsForProject } from './alertEvaluator.js';
import { liveTailHub } from './liveTailHub.js';

interface RateBucket {
  windowStartMs: number;
  count: number;
}

const MAX_QUEUE_CAPACITY = 10_000;

class IngestService {
  private rateBuckets = new Map<string, RateBucket>();
  private queue: StoredLogEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  private pruneExpiredBuckets(now: number): void {
    if (this.rateBuckets.size < 500) return;
    for (const [key, bucket] of this.rateBuckets.entries()) {
      if (now - bucket.windowStartMs >= 60_000) {
        this.rateBuckets.delete(key);
      }
    }
  }

  checkRateLimit(
    keyId: string,
    eventCount: number,
    limitPerMin: number
  ): {
    allowed: boolean;
    remaining: number;
    resetMs: number;
  } {
    const now = Date.now();
    this.pruneExpiredBuckets(now);

    const bucket = this.rateBuckets.get(keyId);

    if (!bucket || now - bucket.windowStartMs >= 60_000) {
      if (eventCount > limitPerMin) {
        return { allowed: false, remaining: 0, resetMs: 60_000 };
      }
      this.rateBuckets.set(keyId, { windowStartMs: now, count: eventCount });
      return {
        allowed: true,
        remaining: Math.max(0, limitPerMin - eventCount),
        resetMs: 60_000
      };
    }

    if (bucket.count + eventCount > limitPerMin) {
      return {
        allowed: false,
        remaining: Math.max(0, limitPerMin - bucket.count),
        resetMs: Math.max(0, 60_000 - (now - bucket.windowStartMs))
      };
    }

    bucket.count += eventCount;
    return {
      allowed: true,
      remaining: Math.max(0, limitPerMin - bucket.count),
      resetMs: Math.max(0, 60_000 - (now - bucket.windowStartMs))
    };
  }

  async ingestBatch(projectId: string, rawEvents: LogEventInput[]): Promise<StoredLogEvent[]> {
    const nowIso = new Date().toISOString();
    const seenIds = new Set<string>();
    const storedEvents: StoredLogEvent[] = [];

    for (const ev of rawEvents) {
      const eventId = ev.id ?? `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      if (seenIds.has(eventId)) continue;
      seenIds.add(eventId);

      let normalizedTs = nowIso;
      if (ev.timestamp) {
        const parsedMs = Date.parse(ev.timestamp);
        if (!Number.isNaN(parsedMs)) {
          normalizedTs = new Date(parsedMs).toISOString();
        }
      }

      storedEvents.push({
        id: eventId,
        project_id: projectId,
        timestamp: normalizedTs,
        level: ev.level,
        service: ev.service.trim(),
        message: ev.message,
        metadata: ev.metadata && typeof ev.metadata === 'object' ? ev.metadata : {},
        trace_id: ev.trace_id ? ev.trace_id.trim() : null,
        received_at: nowIso
      });
    }

    if (storedEvents.length === 0) return [];

    if (this.queue.length + storedEvents.length <= MAX_QUEUE_CAPACITY) {
      this.queue.push(...storedEvents);
    } else {
      const available = Math.max(0, MAX_QUEUE_CAPACITY - this.queue.length);
      this.queue.push(...storedEvents.slice(0, available));
    }

    await this.flush();

    // Broadcast to live tail subscribers immediately
    try {
      liveTailHub.broadcast(storedEvents);
    } catch (err) {
      console.warn('[LogFlow Ingest] LiveTail broadcast error:', err);
    }

    // Evaluate alert rules asynchronously so ingestion stays fast
    evaluateAlertsForProject(projectId, storedEvents).catch((err) => {
      console.warn('[LogFlow Ingest] Alert evaluation error:', err);
    });

    return storedEvents;
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.isFlushing || this.queue.length === 0) return;

    this.isFlushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      const adapter = await getLogAdapter();
      await adapter.insertBatch(batch);
    } catch (err) {
      console.error('[LogFlow Ingest] Failed to flush batch to storage adapter:', err);
      // Re-queue failed events at front of buffer if capacity permits
      if (this.queue.length + batch.length <= MAX_QUEUE_CAPACITY) {
        this.queue.unshift(...batch);
      }
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }
}

export const ingestService = new IngestService();
