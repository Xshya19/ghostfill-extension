import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageService } from '../src/services/storageService';
import { DEFAULT_SETTINGS } from '../src/types/storage.types';
import {
  clearEncryptionKeys,
  encrypt,
  decrypt,
  getMasterKey,
  initializeSecureEncryption,
} from '../src/utils/encryption';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../src/utils/logger', () => ({ createLogger: () => log }));

let disk: Record<string, unknown>;
const settings = { ...DEFAULT_SETTINGS, darkMode: 'dark' as const };

beforeEach(async () => {
  clearEncryptionKeys();
  disk = {};
  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys: unknown) =>
    keys == null
      ? { ...disk }
      : Object.fromEntries(
          (typeof keys === 'string' ? [keys] : (keys as string[]))
            .filter((key) => key in disk)
            .map((key) => [key, disk[key]])
        )
  );
  vi.mocked(chrome.storage.local.set).mockImplementation(async (values) => {
    Object.assign(disk, values);
  });
  vi.mocked(chrome.storage.session.get).mockResolvedValue({});
  await initializeSecureEncryption();
  disk.settings = await encrypt(settings, getMasterKey()!);
  clearEncryptionKeys();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  clearEncryptionKeys();
  vi.restoreAllMocks();
});

describe('storage lifecycle', () => {
  it('serializes clearing with an active write so its retry cannot resurrect cleared data', async () => {
    const service = new StorageService();
    await service.init();
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(() => new Promise<void>(() => {}));
    const write = service.setImmediate('preferredEmailType', 'gmail').catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    let cleared = false;
    const clearing = service.clear().then(() => {
      cleared = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(cleared).toBe(false);
    await vi.advanceTimersByTimeAsync(4_100);
    await Promise.all([write, clearing]);
    const writeCount = vi.mocked(chrome.storage.local.set).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(writeCount);
    expect(service.getCacheStats().pendingWrites).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds retries while retaining the unsaved value when storage stays unresponsive', async () => {
    const service = new StorageService();
    await service.init();
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.set)
      .mockClear()
      .mockImplementation(() => new Promise<void>(() => {}));
    const write = service.setImmediate('preferredEmailType', 'gmail').catch((error) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await write).toBeInstanceOf(Error);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(3);
    expect(await service.get('preferredEmailType')).toBe('gmail');
    expect(service.getCacheStats().pendingWrites).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(log.error).not.toHaveBeenCalled();
    service.onExtensionUnload();
  });

  it('does not let a stalled quota measurement block a write forever', async () => {
    const service = new StorageService();
    await service.init();
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.getBytesInUse).mockImplementationOnce(
      () => new Promise<number>(() => {})
    );
    const write = service.setImmediate('preferredEmailType', 'gmail');
    await vi.advanceTimersByTimeAsync(4_100);
    await write;
    expect(disk.preferredEmailType).toBe('gmail');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels delayed retries when the user clears storage', async () => {
    const service = new StorageService();
    await service.init();
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(() => new Promise<void>(() => {}));
    const write = service.setImmediate('preferredEmailType', 'gmail').catch((error) => error);
    await vi.advanceTimersByTimeAsync(4_100);
    await write;
    await service.clear();
    const writeCount = vi.mocked(chrome.storage.local.set).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(writeCount);
    expect(service.getCacheStats().pendingWrites).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps pruned sensitive values encrypted during quota recovery', async () => {
    const service = new StorageService();
    await service.init();
    const inbox = Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      from: 'sender@example.com',
      subject: 'Verify',
      body: 'Private message',
      date: Date.now(),
      read: false,
      attachments: [],
    }));
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error('QUOTA_BYTES quota exceeded')
    );
    await service.setImmediate('inbox', inbox);
    expect(disk.inbox).toEqual(expect.stringMatching(/^v1:/));
    expect(await decrypt(disk.inbox as string, getMasterKey()!)).toHaveLength(10);
  });

  it('clears storage deadlines when a write succeeds', async () => {
    const service = new StorageService();
    await service.init();
    vi.useFakeTimers();
    await service.setImmediate('preferredEmailType', 'gmail');
    expect(disk.preferredEmailType).toBe('gmail');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers a committed write when Chrome never acknowledges its promise', async () => {
    const service = new StorageService();
    await service.init();
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.set).mockImplementationOnce((values) => {
      Object.assign(disk, values);
      return new Promise<void>(() => {});
    });
    let failure: unknown;
    const write = service.setImmediate('preferredEmailType', 'gmail').catch((error) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(4_100);
    await write;
    expect(failure).toBeUndefined();
    expect(disk.preferredEmailType).toBe('gmail');
    expect(log.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a newer queued value when an older write fails', async () => {
    const service = new StorageService();
    await service.init();
    let rejectFirst!: (reason: Error) => void;
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        })
    );
    const first = service.setImmediate('preferredEmailType', 'disposable').catch(() => {});
    await vi.waitFor(() => expect(rejectFirst).toBeTypeOf('function'));
    const newer = service.setImmediate('preferredEmailType', 'gmail');
    rejectFirst(new Error('Storage temporarily unavailable'));
    await Promise.all([first, newer]);
    expect(disk.preferredEmailType).toBe('gmail');
    expect(await service.get('preferredEmailType')).toBe('gmail');
  });

  it('retains a timed-out write and retries it automatically without error spam', async () => {
    const service = new StorageService();
    await service.init();
    vi.useFakeTimers();
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(() => new Promise<void>(() => {}));
    const write = service.setImmediate('preferredEmailType', 'gmail').catch((error) => error);
    await vi.advanceTimersByTimeAsync(4_100);
    expect(await write).toBeInstanceOf(Error);
    expect(await service.get('preferredEmailType')).toBe('gmail');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(disk.preferredEmailType).toBe('gmail');
    expect(service.getCacheStats().pendingWrites).toBe(0);
    expect(log.error).not.toHaveBeenCalled();
    service.onExtensionUnload();
  });

  it('reads encrypted preferences when trusted session storage is denied to a content script', async () => {
    vi.mocked(chrome.storage.session.get).mockRejectedValue(
      new Error('Access to storage is not allowed from this context.')
    );
    const service = new StorageService();
    expect((await service.getSettings()).darkMode).toBe('dark');
    expect(getMasterKey()).not.toBeNull();
    expect(disk.settings).toMatch(/^v1:/);
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('restores the persistent key before reading after an in-memory key clear', async () => {
    const service = new StorageService();
    await service.init();
    clearEncryptionKeys();
    expect(await service.getFresh('settings')).toEqual(settings);
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });

  it('never replaces the existing persistent seed when its read fails', async () => {
    const persistedSeed = disk.masterKeySeed;
    vi.mocked(chrome.storage.local.get).mockRejectedValue(
      new Error('Storage temporarily unavailable')
    );
    await expect(initializeSecureEncryption()).rejects.toThrow('Storage temporarily unavailable');
    expect(disk.masterKeySeed).toBe(persistedSeed);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not replace saved preferences with defaults after a failed initialization read', async () => {
    const persistedSettings = disk.settings;
    const get = vi.mocked(chrome.storage.local.get).getMockImplementation()!;
    vi.mocked(chrome.storage.local.get).mockImplementation(async (...args) => {
      if (args[0] == null) {
        throw new Error('Storage temporarily unavailable');
      }
      return get(...args);
    });
    const service = new StorageService();
    await expect(service.init()).rejects.toThrow('Storage temporarily unavailable');
    expect(disk.settings).toBe(persistedSettings);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    vi.mocked(chrome.storage.local.get).mockImplementation(get);
    expect(await service.getFresh('settings')).toEqual(settings);
  });

  it('does not call storage for a scheduled write after the extension context ends', async () => {
    const service = new StorageService();
    await service.init();
    vi.mocked(chrome.storage.local.set).mockClear();
    const write = service.set('settings', settings);
    vi.stubGlobal('chrome', { ...chrome, runtime: { ...chrome.runtime, id: '' } });
    try {
      await write;
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles context invalidation during a write as shutdown rather than a storage failure', async () => {
    const service = new StorageService();
    await service.init();
    vi.mocked(chrome.storage.local.set).mockRejectedValue(
      new Error('Extension context invalidated.')
    );
    await service.set('settings', settings);
    expect(log.error).not.toHaveBeenCalled();
    expect(service.getCacheStats().pendingWrites).toBe(0);
  });
});
