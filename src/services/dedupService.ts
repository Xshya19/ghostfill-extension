import { createLogger } from '../utils/logger';
import { storageService } from './storageService';

const log = createLogger('DedupService');

const CONFIG = {
  DEDUP_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
  STORAGE_KEY: 'processedEmails',
  PERSIST_DELAY_MS: 2000,
} as const;

export interface ProcessedEmailRecord {
  readonly id: string;
  readonly accountId: string;
  readonly processedAt: number;
  readonly hadOTP: boolean;
  readonly hadLink: boolean;
  readonly ttlExpiresAt: number;
}

class DedupService {
  private readonly records = new Map<string, ProcessedEmailRecord>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  // FIX #4: Replaced setInterval with lazy on-access pruning.
  // setInterval is unreliable in MV3 service workers (killed on suspension).
  private lastPruneAt = 0;
  private readonly PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private initialized = false;

  constructor() {}

  /**
   * Trigger pruning lazily on access — safe for service workers.
   */
  private maybePrune(): void {
    const now = Date.now();
    if (now - this.lastPruneAt > this.PRUNE_INTERVAL_MS) {
      this.lastPruneAt = now;
      void this.prune();
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const saved = await storageService.get(CONFIG.STORAGE_KEY);
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        this.restoreState(saved as Record<string, ProcessedEmailRecord>);
      }
      this.initialized = true;
      log.info('DedupService initialized');
    } catch (e) {
      log.warn('Failed to initialize DedupService', e);
    }
  }

  private restoreState(saved: Record<string, ProcessedEmailRecord>): void {
    const now = Date.now();
    for (const [key, record] of Object.entries(saved)) {
      if (record.ttlExpiresAt > now) {
        this.records.set(key, record);
      }
    }
  }

  async isProcessed(emailId: string | number, accountId: string): Promise<boolean> {
    return (await this.getRecord(emailId, accountId)) !== null;
  }

  async getRecord(
    emailId: string | number,
    accountId: string
  ): Promise<ProcessedEmailRecord | null> {
    this.maybePrune();
    const key = this.makeKey(emailId, accountId);
    const record = this.records.get(key);

    if (!record) {
      return null;
    }

    if (Date.now() >= record.ttlExpiresAt) {
      this.records.delete(key);
      this.persist();
      return null;
    }

    return record;
  }

  async markProcessed(
    emailId: string | number,
    accountId: string,
    hadOTP: boolean,
    hadLink: boolean
  ): Promise<void> {
    this.maybePrune();
    const key = this.makeKey(emailId, accountId);

    const existing = this.records.get(key);
    const record: ProcessedEmailRecord = {
      id: String(emailId),
      accountId,
      processedAt: Date.now(),
      hadOTP: Boolean(existing?.hadOTP || hadOTP),
      hadLink: Boolean(existing?.hadLink || hadLink),
      ttlExpiresAt: Date.now() + CONFIG.DEDUP_TTL_MS,
    };

    this.records.set(key, record);
    this.persist();
  }

  async updateRecord(
    emailId: string | number,
    accountId: string,
    updates: Partial<Pick<ProcessedEmailRecord, 'hadOTP' | 'hadLink'>>
  ): Promise<void> {
    const key = this.makeKey(emailId, accountId);
    const existing = this.records.get(key);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.records.set(key, updated);
      this.persist();
    }
  }

  async prune(): Promise<number> {
    const now = Date.now();
    let pruned = 0;

    for (const [key, record] of this.records) {
      if (now >= record.ttlExpiresAt) {
        this.records.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.persist();
      log.debug('Pruned dedup cache', { pruned, remaining: this.records.size });
    }

    return pruned;
  }

  clear(): void {
    this.records.clear();
    void storageService.remove(CONFIG.STORAGE_KEY);
    log.info('Dedup cache cleared');
  }

  get size(): number {
    return this.records.size;
  }

  private makeKey(emailId: string | number, accountId: string): string {
    return `${accountId}:${emailId}`;
  }

  private persist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      const serializable = Object.fromEntries(this.records);
      storageService
        .set(CONFIG.STORAGE_KEY, serializable)
        .catch((e) => log.warn('Failed to persist dedup cache', e));
    }, CONFIG.PERSIST_DELAY_MS);
  }

  /**
   * Stop the cleanup interval (important for testing/cleanup)
   */
  destroy(): void {
    // FIX #15: Clear persistTimer to prevent stale writes after destroy
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }
}

export const dedupService = new DedupService();
