import { storageService } from '../services/storageService';

export interface TelemetryEvent {
  timestamp: number;
  hostname: string;
  action: 'classify' | 'detect' | 'fill' | 'verify';
  strategy?: string;
  outcome: 'success' | 'failure' | 'abstain' | 'block';
  latencyMs: number;
}

export class TelemetryCollector {
  private readonly STORAGE_KEY = 'ghostfill_telemetry_events';
  private events: TelemetryEvent[] = [];

  async record(event: Omit<TelemetryEvent, 'timestamp' | 'hostname'>): Promise<void> {
    const timestamp = Date.now();
    const hostname = window.location.hostname;
    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp,
      hostname,
    };

    this.events.push(fullEvent);

    // Limit in-memory cache to last 100 events
    if (this.events.length > 100) {
      this.events.shift();
    }

    try {
      const stored = await storageService.get(this.STORAGE_KEY as any) as TelemetryEvent[] || [];
      stored.push(fullEvent);

      // Keep only last 1000 events in persistent storage to save space
      if (stored.length > 1000) {
        stored.shift();
      }

      await storageService.set(this.STORAGE_KEY as any, stored);
    } catch {
      // safe fallback
    }
  }

  async getEvents(): Promise<TelemetryEvent[]> {
    try {
      return await storageService.get(this.STORAGE_KEY as any) as TelemetryEvent[] || [];
    } catch {
      return this.events;
    }
  }

  async clearEvents(): Promise<void> {
    this.events = [];
    try {
      await storageService.set(this.STORAGE_KEY as any, []);
    } catch {
      // safe fallback
    }
  }
}
