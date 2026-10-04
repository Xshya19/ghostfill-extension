import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageService } from '../src/services/storageService';
import { DEFAULT_SETTINGS } from '../src/types/storage.types';
import {
  clearEncryptionKeys,
  encrypt,
  getMasterKey,
  initializeSecureEncryption,
} from '../src/utils/encryption';
import * as encryption from '../src/utils/encryption';

vi.mock('../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

let disk: Record<string, unknown>;
let service: StorageService;

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
  vi.mocked(chrome.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete disk[key];
  });
  vi.mocked(chrome.storage.local.clear).mockImplementation(async () => {
    disk = {};
  });
  vi.mocked(chrome.storage.session.get).mockResolvedValue({});
  await initializeSecureEncryption();
  disk.settings = await encrypt(DEFAULT_SETTINGS, getMasterKey()!);
  clearEncryptionKeys();
  service = new StorageService();
  await service.init();
  vi.mocked(chrome.storage.local.get).mockClear();
});

afterEach(() => {
  service.onExtensionUnload();
  vi.useRealTimers();
  clearEncryptionKeys();
  vi.restoreAllMocks();
});

describe('storage read consistency and request sharing', () => {
  it('returns the newer write when an older disk read finishes late', async () => {
    const older = deferred<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockReturnValueOnce(older.promise);
    const reading = service.get('preferredEmailType');
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    await service.setImmediate('preferredEmailType', 'gmail');
    older.resolve({ preferredEmailType: 'disposable' });
    expect(await reading).toBe('gmail');
    expect(await service.get('preferredEmailType')).toBe('gmail');
  });

  it('does not resurrect a removed value through an outstanding read', async () => {
    const older = deferred<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockReturnValueOnce(older.promise);
    const reading = service.get('preferredEmailType');
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    await service.remove('preferredEmailType');
    older.resolve({ preferredEmailType: 'gmail' });
    expect(await reading).toBeUndefined();
    expect(await service.get('preferredEmailType')).toBeUndefined();
  });

  it('keeps a newer fresh request registered when the older read completes', async () => {
    const older = deferred<Record<string, unknown>>();
    const fresh = deferred<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(fresh.promise);
    const reading = service.get('preferredEmailType');
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    const rereading = service.getFresh('preferredEmailType');
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(2));
    older.resolve({ preferredEmailType: 'disposable' });
    await Promise.resolve();
    const third = service.get('preferredEmailType');
    fresh.resolve({ preferredEmailType: 'gmail' });
    expect(await Promise.all([reading, rereading, third])).toEqual(['gmail', 'gmail', 'gmail']);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);
  });

  it('shares one batched storage request across overlapping multi-get and single-get calls', async () => {
    const batch = deferred<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockReturnValueOnce(batch.promise);
    const first = service.getMany(['preferredEmailType', 'gmailConnected', 'preferredEmailType']);
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    const second = service.getMany(['gmailConnected', 'preferredEmailType']);
    const single = service.get('gmailConnected');
    batch.resolve({ preferredEmailType: 'gmail', gmailConnected: true });
    expect(await first).toEqual({ preferredEmailType: 'gmail', gmailConnected: true });
    expect(await second).toEqual({ preferredEmailType: 'gmail', gmailConnected: true });
    expect(await single).toBe(true);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.get).toHaveBeenCalledWith(['preferredEmailType', 'gmailConnected']);
  });

  it('uses the pending write instead of a stale result from a batch read', async () => {
    const batch = deferred<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockReturnValueOnce(batch.promise);
    const reading = service.getMany(['preferredEmailType', 'gmailConnected']);
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    await service.setImmediate('preferredEmailType', 'gmail');
    batch.resolve({ preferredEmailType: 'disposable', gmailConnected: true });
    expect(await reading).toEqual({ preferredEmailType: 'gmail', gmailConnected: true });
  });

  it('does not keep personal data in cache after unload while a read was outstanding', async () => {
    const older = deferred<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockReturnValueOnce(older.promise);
    const reading = service.get('preferredEmailType');
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    service.onExtensionUnload();
    older.resolve({ preferredEmailType: 'gmail' });
    expect(await reading).toBeUndefined();
    expect(service.getCacheStats().size).toBe(0);
  });

  it('keeps the newest storage change when an older encrypted event decrypts late', async () => {
    const older = deferred<unknown>();
    const newer = { ...DEFAULT_SETTINGS, debugMode: true };
    const decrypting = vi
      .spyOn(encryption, 'decrypt')
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(newer);
    const observer = vi.fn();
    service.onChanged(observer);
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
    listener({ settings: { newValue: 'v1:old-event' } }, 'local');
    await vi.waitFor(() => expect(decrypting).toHaveBeenCalledTimes(1));
    listener({ settings: { newValue: 'v1:new-event' } }, 'local');
    await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(1));
    older.resolve(DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(2));
    expect(await service.getSettings()).toEqual(newer);
  });

  it('shares a single cache-change listener across observers and releases it on unsubscribe', () => {
    vi.mocked(chrome.storage.onChanged.addListener).mockClear();
    vi.mocked(chrome.storage.onChanged.removeListener).mockClear();
    const unsubscribeFirst = service.onChanged(vi.fn());
    const unsubscribeSecond = service.onChanged(vi.fn());
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    expect(chrome.storage.onChanged.removeListener).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
  });

  it('keeps repeated registrations independent when they use the same callback', async () => {
    vi.mocked(chrome.storage.onChanged.removeListener).mockClear();
    const observer = vi.fn();
    const unsubscribeFirst = service.onChanged(observer);
    const unsubscribeSecond = service.onChanged(observer);
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
    unsubscribeFirst();
    expect(chrome.storage.onChanged.removeListener).not.toHaveBeenCalled();
    listener({ gmailConnected: { newValue: true } }, 'local');
    await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(1));
    unsubscribeSecond();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
  });

  it('persists only the latest optimistic edit when its predecessor had a longer delay', async () => {
    vi.useFakeTimers();
    await service.setOptimistic('preferredEmailType', 'disposable', 100);
    await service.setOptimistic('preferredEmailType', 'gmail', 10);
    await vi.advanceTimersByTimeAsync(150);
    expect(disk.preferredEmailType).toBe('gmail');
    expect(await service.get('preferredEmailType')).toBe('gmail');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a delayed optimistic edit replace a newer immediate write', async () => {
    vi.useFakeTimers();
    await service.setOptimistic('preferredEmailType', 'disposable', 100);
    await service.setImmediate('preferredEmailType', 'gmail');
    await vi.advanceTimersByTimeAsync(150);
    expect(disk.preferredEmailType).toBe('gmail');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels optimistic writes when clearing data so the value cannot reappear', async () => {
    vi.useFakeTimers();
    await service.setOptimistic('preferredEmailType', 'gmail', 100);
    await service.clear();
    await vi.advanceTimersByTimeAsync(150);
    expect(disk.preferredEmailType).toBeUndefined();
    expect(await service.get('preferredEmailType')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares simultaneous fresh reads and releases a failed request for retry', async () => {
    const pending = deferred<Record<string, unknown>>();
    vi.mocked(chrome.storage.local.get).mockReturnValueOnce(pending.promise);
    const readers = Array.from({ length: 8 }, () => service.getFresh('preferredEmailType'));
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalledTimes(1));
    pending.resolve({ preferredEmailType: 'gmail' });
    expect(await Promise.all(readers)).toEqual(Array(8).fill('gmail'));
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage unavailable'));
    expect(await service.getFresh('preferredEmailType')).toBeUndefined();
    disk.preferredEmailType = 'disposable';
    expect(await service.getFresh('preferredEmailType')).toBe('disposable');
  });

  it('handles synchronous Chrome context failures and can retry a later read', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => {
      throw new Error('Extension context invalidated');
    });
    expect(await service.get('preferredEmailType')).toBeUndefined();
    disk.preferredEmailType = 'gmail';
    expect(await service.get('preferredEmailType')).toBe('gmail');
  });
});
