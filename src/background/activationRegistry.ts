// ─────────────────────────────────────────────────────────────────────
// Activation Registry — Neutral Core for Link Activation Tracking
// ─────────────────────────────────────────────────────────────────────
// Break circular dependency between linkService.ts and pollingManager.ts
// by keeping activation tab state in this neutral, static module.
// ─────────────────────────────────────────────────────────────────────

import { createLogger } from '../utils/logger';
import { persistActivationTabs, rehydrateActivationTabs } from './waiterStore';

const log = createLogger('ActivationRegistry');

const activationTabs = new Set<number>();
const activationCodesByTab = new Map<number, string>();
const readyWaiters = new Map<number, () => void>();

export function registerActivationTab(tabId: number, code?: string): void {
  activationTabs.add(tabId);
  if (code) {
    activationCodesByTab.set(tabId, code);
  }
  log.debug(`Registered activation tab ${tabId}`, { hasCode: !!code });
  void persistActivationTabs(activationTabs);
}

export function unregisterActivationTab(tabId: number): void {
  activationTabs.delete(tabId);
  activationCodesByTab.delete(tabId);
  readyWaiters.delete(tabId);
  log.debug(`Unregistered activation tab ${tabId}`);
  void persistActivationTabs(activationTabs);
}

export function isActivationTab(tabId: number): boolean {
  return activationTabs.has(tabId);
}

export function getActivationCodeForTab(tabId: number): string | undefined {
  return activationCodesByTab.get(tabId);
}

export function getActivationTabsSet(): Set<number> {
  return activationTabs;
}

export function onContentScriptReady(tabId: number): void {
  const resolve = readyWaiters.get(tabId);
  if (resolve) {
    readyWaiters.delete(tabId);
    resolve();
  }
}

export function waitForContentScript(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!activationTabs.has(tabId)) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      readyWaiters.delete(tabId);
      resolve(false);
    }, timeoutMs);

    readyWaiters.set(tabId, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export async function rehydrateActivationRegistry(): Promise<void> {
  await rehydrateActivationTabs(activationTabs);
}
