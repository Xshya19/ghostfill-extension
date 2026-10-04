import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/performanceService', () => ({
  errorTracker: { init: vi.fn() },
  performanceMonitor: { init: vi.fn() },
}));
vi.mock('../src/utils/logger', () => ({
  initRemoteLogger: vi.fn(),
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/background/contextMenu', () => ({ dumpMenuStats: vi.fn() }));
vi.mock('../src/background/messageHandler', () => ({
  dumpRouterStats: vi.fn(),
  setupMessageHandler: vi.fn(),
}));
vi.mock('../src/background/notifications', () => ({
  initNotifications: vi.fn(),
  dumpNotificationStats: vi.fn(),
}));
vi.mock('../src/background/pollingManager', () => ({
  getPollingMetrics: vi.fn(),
  onPollingAlarm: vi.fn(),
  stopEmailPolling: vi.fn(),
}));
vi.mock('../src/background/offscreenManager', () => ({ closeOffscreenDocument: vi.fn() }));
vi.mock('../src/background/serviceWorker', () => ({
  initServiceWorker: vi.fn(async () => {}),
  getBootState: vi.fn(() => 'ready'),
  dumpBootReport: vi.fn(),
  onServiceWorkerAlarm: vi.fn(),
  clearDeferredTimers: vi.fn(),
}));
vi.mock('../src/utils/messaging', () => ({
  safeSendTabMessage: vi.fn(async () => ({ success: true })),
}));
vi.mock('../src/services/storageService', () => ({
  storageService: { getSettings: vi.fn(async () => ({ keyboardShortcuts: true })) },
}));

import { initServiceWorker, clearDeferredTimers } from '../src/background/serviceWorker';
import { closeOffscreenDocument } from '../src/background/offscreenManager';
import { stopEmailPolling } from '../src/background/pollingManager';
import { safeSendTabMessage } from '../src/utils/messaging';
import { storageService } from '../src/services/storageService';

async function settle() {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
}

async function loadBackground() {
  await import('../src/background/index');
  const listener = vi.mocked(chrome.commands.onCommand.addListener).mock.calls[0][0];
  return listener;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(chrome.runtime, {
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onSuspend: { addListener: vi.fn() },
  });
  Object.assign(chrome.commands, { onCommand: { addListener: vi.fn() } });
  vi.mocked(chrome.alarms.clear).mockResolvedValue(true);
  vi.mocked(initServiceWorker).mockReset().mockResolvedValue(undefined);
  vi.mocked(storageService.getSettings).mockResolvedValue({ keyboardShortcuts: true } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('service worker keyboard command lifecycle', () => {
  it('executes a registered shortcut after initialization without adding another listener', async () => {
    const listener = await loadBackground();
    const { ensureInitialized } = await import('../src/background/initGuard');
    await ensureInitialized();
    listener('auto-fill', undefined);
    await settle();
    expect(safeSendTabMessage).toHaveBeenCalledWith(1, { action: 'SMART_AUTOFILL' });
    expect(chrome.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
  });

  it('initializes a cold worker before executing its first shortcut', async () => {
    let completeBoot!: () => void;
    const boot = new Promise<void>((resolve) => {
      completeBoot = resolve;
    });
    vi.mocked(initServiceWorker).mockReturnValueOnce(boot);
    const listener = await loadBackground();
    listener('auto-fill', undefined);
    await settle();
    expect(initServiceWorker).toHaveBeenCalledTimes(1);
    expect(safeSendTabMessage).not.toHaveBeenCalled();
    completeBoot();
    await vi.waitFor(() =>
      expect(safeSendTabMessage).toHaveBeenCalledWith(1, { action: 'SMART_AUTOFILL' })
    );
  });

  it('continues to honor the disabled keyboard shortcuts preference', async () => {
    vi.mocked(storageService.getSettings).mockResolvedValue({ keyboardShortcuts: false } as never);
    const listener = await loadBackground();
    listener('auto-fill', undefined);
    await settle();
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });

  it('keeps the offscreen relay alive during normal worker suspension while clearing worker timers', async () => {
    await loadBackground();
    const listener = vi.mocked(chrome.runtime.onSuspend.addListener).mock.calls[0][0];
    listener();
    await vi.waitFor(() => {
      expect(clearDeferredTimers).toHaveBeenCalledTimes(1);
      expect(stopEmailPolling).toHaveBeenCalledTimes(1);
    });
    expect(closeOffscreenDocument).not.toHaveBeenCalled();
  });
});
