// ─────────────────────────────────────────────────────────────────────
// Waiter Store — Session Storage Persistence for Active OTP Waiters
// ─────────────────────────────────────────────────────────────────────
// MV3 Service Worker suspends after 30s idle time. In-memory Map/Set
// waiter state is lost on SW suspend unless backed by chrome.storage.session.
// ─────────────────────────────────────────────────────────────────────

import { createLogger } from '../utils/logger';

const log = createLogger('WaiterStore');

export interface PersistedTabRegistration {
  readonly tabId: number;
  readonly url: string;
  readonly hostname: string;
  readonly fieldSelectors: readonly string[];
  readonly frameId?: number;
  readonly pageConfidence?: number;
  readonly verdict?: string;
  readonly registeredAt: number;
  readonly priority: number;
  deliveryAttempts: number;
}

const STORAGE_KEYS = {
  OTP_WAITERS: 'pm_waiters_v1',
  ACTIVATION_TABS: 'pm_activationTabs_v1',
} as const;

/**
 * Persist OTP waiting tabs to chrome.storage.session
 */
export async function persistWaiters<T extends Omit<PersistedTabRegistration, 'tabId'>>(
  map: Map<number, T>
): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {return;}
  try {
    const list: PersistedTabRegistration[] = Array.from(map.entries()).map(([tabId, reg]) => ({
      tabId,
      ...reg,
    }));
    await chrome.storage.session.set({ [STORAGE_KEYS.OTP_WAITERS]: list });
    log.debug(`Persisted ${list.length} waiting tabs to session storage`);
  } catch (error) {
    log.warn('Failed to persist waiter map', error);
  }
}

/**
 * Rehydrate OTP waiting tabs from chrome.storage.session, stripping stale or closed tabs.
 * Returns true if at least one valid waiter was rehydrated.
 */
export async function rehydrateWaiters<T extends Omit<PersistedTabRegistration, 'tabId'>>(
  map: Map<number, T>,
  staleTabMs: number
): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {return false;}
  try {
    const data = await chrome.storage.session.get(STORAGE_KEYS.OTP_WAITERS);
    const list = data[STORAGE_KEYS.OTP_WAITERS] as PersistedTabRegistration[] | undefined;
    if (!Array.isArray(list) || list.length === 0) {return false;}

    const now = Date.now();
    let rehydratedCount = 0;

    for (const item of list) {
      if (now - item.registeredAt > staleTabMs) {
        log.debug(`Skipping stale persisted waiter for tab ${item.tabId}`);
        continue;
      }

      // Verify tab still exists if chrome.tabs API is available
      if (chrome.tabs) {
        try {
          const tab = await chrome.tabs.get(item.tabId);
          if (!tab) {continue;}
        } catch {
          log.debug(`Tab ${item.tabId} no longer exists, discarding waiter`);
          continue;
        }
      }

      const { tabId, ...reg } = item;
      map.set(tabId, reg as unknown as T);
      rehydratedCount++;
    }

    log.info(`Rehydrated ${rehydratedCount}/${list.length} active OTP waiting tabs`);
    return rehydratedCount > 0;
  } catch (error) {
    log.warn('Failed to rehydrate waiter map', error);
    return false;
  }
}

/**
 * Persist activation link tabs to session storage
 */
export async function persistActivationTabs(tabs: Set<number>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {return;}
  try {
    await chrome.storage.session.set({ [STORAGE_KEYS.ACTIVATION_TABS]: Array.from(tabs) });
  } catch (error) {
    log.warn('Failed to persist activation tabs', error);
  }
}

/**
 * Rehydrate activation link tabs from session storage
 */
export async function rehydrateActivationTabs(tabs: Set<number>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {return;}
  try {
    const data = await chrome.storage.session.get(STORAGE_KEYS.ACTIVATION_TABS);
    const list = data[STORAGE_KEYS.ACTIVATION_TABS] as number[] | undefined;
    if (Array.isArray(list)) {
      for (const tabId of list) {
        tabs.add(tabId);
      }
    }
  } catch (error) {
    log.warn('Failed to rehydrate activation tabs', error);
  }
}
