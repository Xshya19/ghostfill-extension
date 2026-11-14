import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageService } from '../src/services/storageService';
import { DEFAULT_SETTINGS } from '../src/types/storage.types';
import {
  clearEncryptionKeys,
  encrypt,
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
  clearEncryptionKeys();
  vi.restoreAllMocks();
});

describe('storage lifecycle', () => {
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
