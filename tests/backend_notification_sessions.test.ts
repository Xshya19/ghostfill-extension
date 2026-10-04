import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/storageService', () => ({
  storageService: { getSettings: vi.fn(async () => ({ notifications: true })) },
}));
vi.mock('../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { storageService } from '../src/services/storageService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
async function settle() {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(storageService.getSettings)
    .mockReset()
    .mockResolvedValue({ notifications: true } as never);
  Object.assign(chrome.notifications, {
    getPermissionLevel: vi.fn((callback: (level: string) => void) => callback('granted')),
  });
  vi.mocked(chrome.notifications.create).mockImplementation(
    (id: string, _options: unknown, callback?: (id: string) => void) => {
      callback?.(id);
      return Promise.resolve(id);
    }
  );
  vi.mocked(chrome.notifications.clear).mockImplementation(
    (_id: string, callback?: (cleared: boolean) => void) => {
      callback?.(true);
      return Promise.resolve(true);
    }
  );
  chrome.runtime.lastError = undefined;
});
afterEach(async () => {
  const { destroyNotifications } = await import('../src/background/notifications');
  destroyNotifications();
  await settle();
  vi.clearAllTimers();
  vi.useRealTimers();
  chrome.runtime.lastError = undefined;
});

describe('notification session boundaries', () => {
  it.each([1, 2])(
    'drops an old notification when its settings gate %s resolves after session reset',
    async (gate) => {
      const settings = deferred<Awaited<ReturnType<typeof storageService.getSettings>>>();
      if (gate === 2) {
        vi.mocked(storageService.getSettings).mockResolvedValueOnce({
          notifications: true,
        } as never);
      }
      vi.mocked(storageService.getSettings).mockReturnValueOnce(settings.promise);
      const notifications = await import('../src/background/notifications');
      notifications.initNotifications();
      const oldNotification = notifications.notifyNewEmail(
        'sender@example.com',
        'Your verification code',
        '582914'
      );
      await settle();
      expect(chrome.notifications.create).not.toHaveBeenCalled();
      notifications.resetNotificationSession();
      settings.resolve({ notifications: true } as never);
      expect(await oldNotification).toBe('');
      expect(chrome.notifications.create).not.toHaveBeenCalled();
      const currentId = await notifications.notifyNewEmail(
        'sender@example.com',
        'Your verification code',
        '582914'
      );
      expect(currentId).toMatch(/^gf-otp-/);
    }
  );

  it('drops an old notification when its permission lookup resolves after session reset', async () => {
    let grantPermission!: () => void;
    vi.mocked(chrome.notifications.getPermissionLevel).mockImplementation((callback) => {
      grantPermission = () => callback('granted');
    });
    const notifications = await import('../src/background/notifications');
    notifications.initNotifications();
    const oldNotification = notifications.notifyNewEmail(
      'sender@example.com',
      'Your verification code',
      '582914'
    );
    await settle();
    notifications.resetNotificationSession();
    grantPermission();
    expect(await oldNotification).toBe('');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('does not retry an old notification after the inbox session changes', async () => {
    vi.mocked(chrome.notifications.create).mockImplementationOnce(
      (_id: string, _options: unknown, callback?: (id: string) => void) => {
        chrome.runtime.lastError = { message: 'Temporary notification failure' };
        callback?.('');
        chrome.runtime.lastError = undefined;
        return Promise.resolve('');
      }
    );
    const notifications = await import('../src/background/notifications');
    notifications.initNotifications();
    const oldNotification = notifications.notifyNewEmail(
      'sender@example.com',
      'Your verification code',
      '582914'
    );
    await settle();
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    notifications.resetNotificationSession();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await oldNotification).toBe('');
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });
});
