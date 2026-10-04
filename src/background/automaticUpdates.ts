import { IS_GMAIL_ENABLED } from '../config/buildProfile';
import { storageService } from '../services/storageService';
import { compareExtensionVersions, readAutomaticUpdateState } from '../utils/automaticUpdateState';
import { fetchWithTimeout, isObject, withTimeout } from '../utils/core';
import { createLogger } from '../utils/logger';
import { getActivationTabsSet } from './activationRegistry';
import { ensureInitialized, isBackgroundInitialized } from './initGuard';
import { isVerificationWorkActive } from './pollingManager';

export const AUTOMATIC_UPDATE_ALARM = 'ghostfill-installed-update';
const IDLE_MS = 2 * 60_000;
const INTERACTIVE_CONTEXTS = ['POPUP', 'TAB', 'SIDE_PANEL'] as chrome.runtime.ContextType[];
const log = createLogger('AutomaticUpdates');
let lastActivityAt = 0;
let checking: Promise<void> | null = null;
let installed = false;
let suspended = false;
let linkWorkActive = () => false;

export function recordAutomaticUpdateActivity(): void {
  lastActivityAt = Date.now();
}

function busy(): boolean {
  return (
    suspended ||
    Date.now() - lastActivityAt < IDLE_MS ||
    isVerificationWorkActive() ||
    getActivationTabsSet().size > 0 ||
    linkWorkActive() ||
    storageService.hasPendingWrites()
  );
}

async function checkInstalledUpdate(): Promise<void> {
  if (!IS_GMAIL_ENABLED || busy()) {
    return;
  }
  const state = await readAutomaticUpdateState();
  const loaded = chrome.runtime.getManifest();
  if (
    !state.autoUpdateEnabled ||
    !state.updateId ||
    !state.updatedAt ||
    compareExtensionVersions(state.installedVersion, loaded.version) <= 0 ||
    Date.now() - Date.parse(state.updatedAt) < IDLE_MS ||
    busy()
  ) {
    return;
  }
  await ensureInitialized();
  if (!isBackgroundInitialized()) {
    return;
  }
  const { linkService } = await import('../services/linkService');
  linkWorkActive = () => linkService.hasPendingActivation();
  // Avoid losing an open popup or unsaved Options changes. Chrome 109–113
  // still receive the files, but need a manual reload or browser restart.
  if (typeof chrome.runtime.getContexts !== 'function' || busy()) {
    return;
  }
  const contexts = await withTimeout(
    chrome.runtime.getContexts({
      contextTypes: INTERACTIVE_CONTEXTS,
    }),
    3000
  );
  if (contexts.length > 0 || busy()) {
    return;
  }
  const session = await withTimeout(
    chrome.storage.session.get(['pm_waiters_v1', 'pm_activationTabs_v1']),
    3000
  );
  // Initialization restores waiters asynchronously. Durable registrations are
  // an additional guard against a cold worker clearing active verification.
  if (
    ['pm_waiters_v1', 'pm_activationTabs_v1'].some(
      (key) =>
        session[key] !== undefined && (!Array.isArray(session[key]) || session[key].length > 0)
    ) ||
    busy()
  ) {
    return;
  }
  const response = await fetchWithTimeout(chrome.runtime.getURL('manifest.json'), {
    cache: 'no-store',
    credentials: 'omit',
    timeout: 3000,
  });
  if (!response.ok) {
    return;
  }
  const incoming: unknown = await withTimeout(response.json(), 3000);
  if (
    !isObject(incoming) ||
    incoming.version !== state.installedVersion ||
    incoming.manifest_version !== 3 ||
    incoming.name !== '__MSG_extensionName__' ||
    !isObject(incoming.background) ||
    incoming.background.service_worker !== 'background.js' ||
    !isObject(incoming.action) ||
    incoming.action.default_popup !== 'popup.html' ||
    incoming.key !== loaded.key ||
    !isObject(incoming.oauth2) ||
    !loaded.oauth2 ||
    incoming.oauth2.client_id !== loaded.oauth2.client_id ||
    busy()
  ) {
    return;
  }
  // Recheck the marker after the async gates: setup may have been disabled or
  // another update may have started while these reads were pending.
  const latest = await readAutomaticUpdateState();
  if (
    !latest.autoUpdateEnabled ||
    latest.updateId !== state.updateId ||
    latest.installedVersion !== state.installedVersion ||
    busy()
  ) {
    return;
  }
  const finalContexts = await withTimeout(
    chrome.runtime.getContexts({
      contextTypes: INTERACTIVE_CONTEXTS,
    }),
    3000
  );
  if (finalContexts.length > 0 || busy()) {
    return;
  }
  log.info('Loading verified installed update', { version: state.installedVersion });
  chrome.runtime.reload();
}

export function checkAutomaticUpdate(): Promise<void> {
  if (checking) {
    return checking;
  }
  checking = checkInstalledUpdate()
    .catch((error) => {
      log.debug('Installed update check deferred', {
        reason: error instanceof Error ? error.message : 'Unavailable',
      });
    })
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** Register listeners synchronously so a persisted alarm can wake a cold worker. */
export function setupAutomaticUpdates(): void {
  if (installed || !IS_GMAIL_ENABLED) {
    return;
  }
  installed = true;
  chrome.runtime.onMessage.addListener(() => {
    lastActivityAt = Date.now();
  });
  chrome.runtime.onSuspend.addListener(() => {
    suspended = true;
  });
  chrome.runtime.onSuspendCanceled?.addListener(() => {
    suspended = false;
    lastActivityAt = Date.now();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTOMATIC_UPDATE_ALARM) {
      void checkAutomaticUpdate();
    }
  });
  void (async () => {
    if (!(await chrome.alarms.get(AUTOMATIC_UPDATE_ALARM))) {
      await chrome.alarms.create(AUTOMATIC_UPDATE_ALARM, { delayInMinutes: 5, periodInMinutes: 5 });
    }
  })().catch(() => log.debug('Installed update alarm will retry on the next worker start'));
}
