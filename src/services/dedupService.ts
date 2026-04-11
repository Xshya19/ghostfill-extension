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
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor() {
    this.cleanupInterval = setInterval(() => this.prune(), 60 * 60 * 1000);
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
    const key = this.makeKey(emailId, accountId);
    const record = this.records.get(key);

    if (!record) {
      return false;
    }

    if (Date.now() >= record.ttlExpiresAt) {
      this.records.delete(key);
      this.persist();
      return false;
    }

    return true;
  }

  async markProcessed(
    emailId: string | number,
    accountId: string,
    hadOTP: boolean,
    hadLink: boolean
  ): Promise<void> {
    const key = this.makeKey(emailId, accountId);

    const record: ProcessedEmailRecord = {
      id: String(emailId),
      accountId,
      processedAt: Date.now(),
      hadOTP,
      hadLink,
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

  private evict(key: string): void {
    this.records.delete(key);
    this.persist();
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
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export const dedupService = new DedupService();
