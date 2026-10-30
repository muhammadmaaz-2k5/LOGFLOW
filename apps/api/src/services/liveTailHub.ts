import { LogLevel, StoredLogEvent, matchesParsedQuery, parseSearchQuery } from '@logflow/shared';

export interface TailSubscriber {
  id: string;
  projectId: string;
  q?: string;
  levels?: LogLevel[];
  services?: string[];
  send: (event: StoredLogEvent) => void;
}

class LiveTailHub {
  private subscribers = new Map<string, TailSubscriber>();

  subscribe(sub: TailSubscriber): () => void {
    this.subscribers.set(sub.id, sub);
    return () => {
      this.subscribers.delete(sub.id);
    };
  }

  broadcast(events: StoredLogEvent[]): void {
    if (this.subscribers.size === 0 || events.length === 0) return;

    for (const sub of this.subscribers.values()) {
      const parsed = parseSearchQuery(sub.q ?? '');
      for (const ev of events) {
        if (ev.project_id !== sub.projectId) continue;
        if (sub.levels && sub.levels.length > 0 && !sub.levels.includes(ev.level)) continue;
        if (
          sub.services &&
          sub.services.length > 0 &&
          !sub.services.some((s) => ev.service.toLowerCase().includes(s.toLowerCase()))
        ) {
          continue;
        }
        if (!matchesParsedQuery(ev, parsed)) continue;

        try {
          sub.send(ev);
        } catch {
          this.subscribers.delete(sub.id);
        }
      }
    }
  }
}

export const liveTailHub = new LiveTailHub();

