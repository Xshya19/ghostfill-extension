import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/storageService', () => ({
  storageService: {
    getSettings: vi.fn(async () => ({ autoCheckInbox: true, checkIntervalSeconds: 5 })),
  },
}));
vi.mock('../src/services/emailServices', () => ({
  emailService: {
    getCurrentEmail: vi.fn(async () => null),
    invalidateInboxSession: vi.fn(),
    prewarmConnections: vi.fn(async () => {}),
  },
}));
vi.mock('../src/services/dedupService', () => ({
  dedupService: { resetPending: vi.fn(), size: 0 },
}));
vi.mock('../src/background/sseManager', () => ({
  sseManager: { reset: vi.fn(), isConnected: vi.fn(() => false) },
}));
vi.mock('../src/services/otpService', () => ({ otpService: {}, smartDetectionService: {} }));
vi.mock('../src/background/contextMenu', () => ({ updateOTPMenuItem: vi.fn() }));
vi.mock('../src/background/notifications', () => ({ notifyNewEmail: vi.fn() }));
vi.mock('../src/services/linkService', () => ({ linkService: {} }));
vi.mock('../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  diag: { startFlow: vi.fn(() => 'test-flow'), step: vi.fn(), endFlow: vi.fn() },
}));
vi.mock('../src/background/waiterStore', () => ({
  persistWaiters: vi.fn(async () => {}),
  rehydrateWaiters: vi.fn(async () => false),
}));

import {
  destroyPollingManager,
  startEmailPolling,
  stopEmailPolling,
} from '../src/background/pollingManager';
import { storageService } from '../src/services/storageService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function settle() {
  for (let turn = 0; turn < 12; turn++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(chrome.alarms.clear).mockResolvedValue(true);
  vi.mocked(chrome.alarms.get).mockResolvedValue({ name: 'email-sync' } as chrome.alarms.Alarm);
  vi.mocked(storageService.getSettings).mockResolvedValue({
    autoCheckInbox: true,
    checkIntervalSeconds: 5,
  } as never);
});
afterEach(async () => {
  destroyPollingManager();
  await settle();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('background polling timer lifecycle', () => {
  it('does not install a timer after polling stops during an alarm lookup', async () => {
    const lookup = deferred<chrome.alarms.Alarm | undefined>();
    vi.mocked(chrome.alarms.get).mockReturnValueOnce(lookup.promise);
    startEmailPolling();
    await settle();
    stopEmailPolling();
    lookup.resolve({ name: 'email-sync' } as chrome.alarms.Alarm);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one timer when an earlier start finishes after a stop and restart', async () => {
    const earlier = deferred<chrome.alarms.Alarm | undefined>();
    const current = deferred<chrome.alarms.Alarm | undefined>();
    vi.mocked(chrome.alarms.get)
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(current.promise);
    startEmailPolling();
    await settle();
    stopEmailPolling();
    startEmailPolling();
    await settle();
    current.resolve({ name: 'email-sync' } as chrome.alarms.Alarm);
    await settle();
    earlier.resolve({ name: 'email-sync' } as chrome.alarms.Alarm);
    await settle();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not install a timer after polling stops during the settings read', async () => {
    const settings = deferred<Awaited<ReturnType<typeof storageService.getSettings>>>();
    vi.mocked(storageService.getSettings).mockReturnValueOnce(settings.promise);
    startEmailPolling();
    await settle();
    expect(storageService.getSettings).toHaveBeenCalledTimes(1);
    stopEmailPolling();
    settings.resolve({ autoCheckInbox: true, checkIntervalSeconds: 5 } as never);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores stale settings that disable a newer polling cycle', async () => {
    const earlier = deferred<Awaited<ReturnType<typeof storageService.getSettings>>>();
    vi.mocked(storageService.getSettings).mockReturnValueOnce(earlier.promise);
    startEmailPolling();
    await settle();
    stopEmailPolling();
    startEmailPolling();
    await settle();
    earlier.resolve({ autoCheckInbox: false, checkIntervalSeconds: 5 } as never);
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(vi.getTimerCount()).toBe(1);
  });
});
