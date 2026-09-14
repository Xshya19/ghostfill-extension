/**
 * GhostFill 3.0 — FAB Intelligence Layer · per-host learning policy
 *
 * The FAB gets quieter where the user keeps dismissing it and bolder where the
 * user actually accepts fills. This is what turns "heuristics" into "feels
 * intelligent": the same page never annoys the user twice.
 *
 * Storage is injected so this module stays testable and `chrome`-free.
 */

import type { HostPolicySnapshot } from './fabTypes';

export interface StorageAdapter {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

interface HostRecord {
  dismissals: number;
  accepts: number;
  mutedUntil: number;
  updatedAt: number;
}

type PolicyMap = Record<string, HostRecord>;

const STORAGE_KEY = 'gf_fab_host_policy_v1';
const PERSIST_DEBOUNCE_MS = 400;
const DAY_MS = 86_400_000;
const RECORD_TTL_MS = 120 * DAY_MS;
const MAX_HOSTS = 500;

/** Dismissals needed before the FAB downgrades itself to the quiet dot. */
export const QUIET_AFTER_DISMISSALS = 2;
/** Dismissals needed before the FAB mutes itself on this host. */
export const MUTE_AFTER_DISMISSALS = 4;
export const AUTO_MUTE_DAYS = 30;

function emptyRecord(): HostRecord {
  return { dismissals: 0, accepts: 0, mutedUntil: 0, updatedAt: Date.now() };
}

export class HostPolicyStore {
  private map: PolicyMap = {};
  private loaded = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storage: StorageAdapter | null = null) {}

  async load(): Promise<void> {
    if (this.loaded || !this.storage) {
      this.loaded = true;
      return;
    }
    try {
      const raw = await this.storage.get(STORAGE_KEY);
      if (raw && typeof raw === 'object') {
        this.map = this.prune(raw as PolicyMap);
      }
    } catch {
      /* storage unavailable — run in-memory */
    }
    this.loaded = true;
  }

  snapshot(host: string): HostPolicySnapshot {
    const record = this.map[host];
    if (!record) {
      return { host, muted: false, dismissals: 0, accepts: 0 };
    }
    return {
      host,
      muted: record.mutedUntil > Date.now(),
      dismissals: record.dismissals,
      accepts: record.accepts,
    };
  }

  /** True when the host has earned the quiet dot but not a full mute. */
  shouldStayQuiet(host: string): boolean {
    const snap = this.snapshot(host);
    return !snap.muted && snap.accepts === 0 && snap.dismissals >= QUIET_AFTER_DISMISSALS;
  }

  recordDismiss(host: string): HostPolicySnapshot {
    const record = this.map[host] ?? emptyRecord();
    record.dismissals += 1;
    record.updatedAt = Date.now();
    if (record.accepts === 0 && record.dismissals >= MUTE_AFTER_DISMISSALS) {
      record.mutedUntil = Date.now() + AUTO_MUTE_DAYS * DAY_MS;
    }
    this.map[host] = record;
    this.persist();
    return this.snapshot(host);
  }

  /** A successful fill is the strongest possible "yes, I want you here" signal. */
  recordAccept(host: string): HostPolicySnapshot {
    const record = this.map[host] ?? emptyRecord();
    record.accepts += 1;
    record.dismissals = 0;
    record.mutedUntil = 0;
    record.updatedAt = Date.now();
    this.map[host] = record;
    this.persist();
    return this.snapshot(host);
  }

  mute(host: string, days = 365): HostPolicySnapshot {
    const record = this.map[host] ?? emptyRecord();
    record.mutedUntil = Date.now() + days * DAY_MS;
    record.updatedAt = Date.now();
    this.map[host] = record;
    this.persist();
    return this.snapshot(host);
  }

  unmute(host: string): HostPolicySnapshot {
    const record = this.map[host] ?? emptyRecord();
    record.mutedUntil = 0;
    record.dismissals = 0;
    record.updatedAt = Date.now();
    this.map[host] = record;
    this.persist();
    return this.snapshot(host);
  }

  reset(): void {
    this.map = {};
    this.persist();
  }

  private prune(map: PolicyMap): PolicyMap {
    const now = Date.now();
    const entries = Object.entries(map)
      .filter(([, record]) => Boolean(record) && now - (record.updatedAt ?? 0) < RECORD_TTL_MS)
      .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
      .slice(0, MAX_HOSTS);
    return Object.fromEntries(entries);
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.map = this.prune(this.map);
      void this.storage?.set(STORAGE_KEY, this.map).catch(() => {
        /* ignore quota / context-invalidated errors */
      });
    }, PERSIST_DEBOUNCE_MS);
  }
}

/**
 * `chrome.storage.local` adapter. Kept loosely typed so this module never has
 * to import extension typings.
 */
export function createChromeStorageAdapter(): StorageAdapter | null {
  const runtime = (globalThis as { chrome?: unknown }).chrome as
    | {
        storage?: {
          local?: {
            get: (keys: string[]) => Promise<Record<string, unknown>>;
            set: (items: Record<string, unknown>) => Promise<void>;
          };
        };
      }
    | undefined;

  const local = runtime?.storage?.local;
  if (!local) {
    return null;
  }

  return {
    async get(key: string): Promise<unknown> {
      const result = await local.get([key]);
      return result?.[key];
    },
    async set(key: string, value: unknown): Promise<void> {
      await local.set({ [key]: value });
    },
  };
}
