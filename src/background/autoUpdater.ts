// ─────────────────────────────────────────────────────────────────────
// Auto-Updater — Background Update Checker for GhostFill
// ─────────────────────────────────────────────────────────────────────
//
// Periodically checks GitHub Releases for a newer published version.
// When one is found, persists the update info to storage and fires a
// Chrome notification so the user can download and apply the update
// using the existing `Update GhostFill.cmd` / `update-extension.ps1`
// flow without leaving the browser.
//
// SECURITY: Only fetches metadata from the public GitHub API. Never
// downloads or executes code — the user must consciously confirm the
// update via the existing PowerShell updater.
// ─────────────────────────────────────────────────────────────────────

import { storageService } from '../services/storageService';
import { createLogger } from '../utils/logger';

const log = createLogger('AutoUpdater');

// ━━━ Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const UPDATE_ALARM_NAME = 'ghostfill-update-check';
export const UPDATE_CHECK_INTERVAL_MIN = 6 * 60; // 6 hours

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/Xshya19/ghostfill-extension/releases/latest';

const NOTIFICATION_ID = 'ghostfill-update-available';

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UpdateInfo {
  /** Semantic version of the available release (e.g. "1.2.0") */
  version: string;
  /** Direct URL to the release page on GitHub */
  releaseUrl: string;
  /** ISO-8601 timestamp when the check was performed */
  checkedAt: string;
  /** Whether the user has dismissed this update notification */
  dismissed: boolean;
  /** Download URL for the ZIP asset (if found) */
  downloadUrl: string | null;
}

// ━━━ Core ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Compare two semver strings.
 * Returns positive if `a > b`, negative if `a < b`, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Check the GitHub Releases API for a newer version.
 * Returns null if no update is available or an error occurs.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    // Respect user preference
    const settings = await storageService.getSettings();
    if (settings.autoUpdateCheck === false) {
      log.debug('Auto-update check disabled by user setting');
      return null;
    }

    const currentVersion = chrome.runtime.getManifest().version;
    log.info(`Checking for updates (current: v${currentVersion})…`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(GITHUB_RELEASES_URL, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': `GhostFill/${currentVersion}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      log.warn(`GitHub API returned ${response.status}`);
      return null;
    }

    const release = (await response.json()) as {
      tag_name: string;
      html_url: string;
      draft: boolean;
      prerelease: boolean;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };

    // Only consider stable, non-draft releases
    if (release.draft || release.prerelease) {
      log.debug('Latest release is draft/prerelease — skipping');
      return null;
    }

    // Parse tag (expects "v1.2.3" format)
    const tagMatch = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
    if (!tagMatch || !tagMatch[1]) {
      log.warn(`Unexpected tag format: ${release.tag_name}`);
      return null;
    }

    const latestVersion = tagMatch[1];

    if (compareSemver(latestVersion, currentVersion) <= 0) {
      log.info(`Already up to date (installed: v${currentVersion}, latest: v${latestVersion})`);
      // Clear any previously stored update info since we're current
      await storageService.remove('availableUpdate');
      return null;
    }

    // Find the ZIP asset download URL
    const zipAssetName = `ghostfill-extension-v${latestVersion}.zip`;
    const zipAsset = release.assets?.find((a) => a.name === zipAssetName);
    const existing = (await storageService.get('availableUpdate')) as UpdateInfo | null;

    const updateInfo: UpdateInfo = {
      version: latestVersion,
      releaseUrl: release.html_url,
      checkedAt: new Date().toISOString(),
      dismissed: existing?.version === latestVersion && existing.dismissed === true,
      downloadUrl: zipAsset?.browser_download_url ?? null,
    };

    log.info(`🆕 Update available: v${currentVersion} → v${latestVersion}`);

    // Persist so the popup/options page can show an update banner
    await storageService.set('availableUpdate', updateInfo);

    return updateInfo;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // AbortError is expected on timeout — don't pollute logs
    if (msg.includes('abort') || msg.includes('Abort')) {
      log.debug('Update check timed out');
    } else {
      log.warn('Update check failed', { error: msg });
    }
    return null;
  }
}

/**
 * Show a Chrome notification for an available update.
 */
export async function notifyUpdateAvailable(info: UpdateInfo): Promise<void> {
  try {
    const settings = await storageService.getSettings();
    if (!settings.notifications) {
      log.debug('Notifications disabled — skipping update notification');
      return;
    }

    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: 'GhostFill Update Available',
      message: `Version ${info.version} is available. Click to view the release.`,
      priority: 1,
      requireInteraction: false,
    });

    log.info('Update notification shown');
  } catch (error) {
    log.warn('Failed to show update notification', error);
  }
}

/**
 * Handle notification click — open the release page.
 */
export function handleUpdateNotificationClick(notificationId: string): boolean {
  if (notificationId !== NOTIFICATION_ID) {
    return false;
  }

  storageService
    .get('availableUpdate')
    .then((update: unknown) => {
      const info = update as UpdateInfo | null;
      const url = info?.releaseUrl || 'https://github.com/Xshya19/ghostfill-extension/releases';
      chrome.tabs.create({ url });
    })
    .catch((e: unknown) => log.warn('Failed to open release page', e));

  return true;
}

/**
 * Full update check cycle: fetch → persist → notify.
 * Called by the alarm handler.
 */
export async function runUpdateCheck(): Promise<void> {
  const update = await checkForUpdate();
  if (update && !update.dismissed) {
    await notifyUpdateAvailable(update);
  }
}

/**
 * Set up the recurring update-check alarm.
 * Idempotent — safe to call multiple times.
 */
export async function setupUpdateAlarm(): Promise<void> {
  try {
    const settings = await storageService.getSettings();
    if (settings.autoUpdateCheck === false) {
      // User opted out — clear any existing alarm
      await chrome.alarms.clear(UPDATE_ALARM_NAME).catch(() => undefined);
      log.debug('Auto-update alarm cleared (disabled by user)');
      return;
    }

    await chrome.alarms.clear(UPDATE_ALARM_NAME).catch(() => undefined);
    await chrome.alarms.create(UPDATE_ALARM_NAME, {
      // First check 2 minutes after boot (gives extension time to settle)
      delayInMinutes: 2,
      periodInMinutes: UPDATE_CHECK_INTERVAL_MIN,
    });

    log.info(`Update alarm scheduled (every ${UPDATE_CHECK_INTERVAL_MIN / 60}h)`);
  } catch (error) {
    log.warn('Failed to set up update alarm', error);
  }
}

/**
 * Handle the update-check alarm firing.
 */
export function onUpdateAlarm(alarm: chrome.alarms.Alarm): boolean {
  if (alarm.name !== UPDATE_ALARM_NAME) {
    return false;
  }

  runUpdateCheck().catch((e) => log.warn('Scheduled update check failed', e));
  return true;
}

/**
 * Dismiss the current update notification (user chose to skip).
 */
export async function dismissUpdate(): Promise<void> {
  const existing = (await storageService.get('availableUpdate')) as UpdateInfo | null;
  if (existing) {
    existing.dismissed = true;
    await storageService.set('availableUpdate', existing);
    log.info(`Update v${existing.version} dismissed by user`);
  }
}

/**
 * Get the current update info (if any).
 */
export async function getAvailableUpdate(): Promise<UpdateInfo | null> {
  return ((await storageService.get('availableUpdate')) as UpdateInfo | null) ?? null;
}
