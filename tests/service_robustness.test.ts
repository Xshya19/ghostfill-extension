import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProcessedEmailRecord } from '../src/services/dedupService';

function makeDedupRecord(overrides: Partial<ProcessedEmailRecord> = {}): ProcessedEmailRecord {
  const now = Date.now();
  return {
    id: 'msg-1',
    accountId: 'acct-1',
    processedAt: now,
    hadOTP: false,
    hadLink: false,
    ttlExpiresAt: now + 60_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock('../src/services/storageService');
  vi.doUnmock('../src/services/emailServices/providerHealthManager');
  vi.doUnmock('../src/utils/core');
  vi.unstubAllGlobals();
});

describe('dedupService robustness', () => {
  it('waits for initialization before reading persisted records', async () => {
    let resolveGet: ((value: Record<string, ProcessedEmailRecord>) => void) | undefined;
    const get = vi.fn(
      () =>
        new Promise<Record<string, ProcessedEmailRecord>>((resolve) => {
          resolveGet = resolve;
        })
    );

    vi.doMock('../src/services/storageService', () => ({
      storageService: {
        get,
        remove: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      },
    }));

    const { dedupService } = await import('../src/services/dedupService');
    const pendingRecord = dedupService.getRecord('msg-1', 'acct-1');

    await Promise.resolve();
    expect(get).toHaveBeenCalledWith('processedEmails');

    const record = makeDedupRecord();
    resolveGet?.({ 'acct-1:msg-1': record });

    await expect(pendingRecord).resolves.toEqual(record);
    dedupService.destroy();
  });

  it('cancels delayed persistence when cleared', async () => {
    vi.useFakeTimers();

    const set = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../src/services/storageService', () => ({
      storageService: {
        get: vi.fn().mockResolvedValue({}),
        remove,
        set,
      },
    }));

    const { dedupService } = await import('../src/services/dedupService');
    await dedupService.markProcessed('msg-1', 'acct-1', true, false);
    await dedupService.clear();
    await vi.advanceTimersByTimeAsync(2_500);

    expect(remove).toHaveBeenCalledWith('processedEmails');
    expect(set).not.toHaveBeenCalled();
    dedupService.destroy();
  });
});

describe('MailTmService robustness', () => {
  it('rethrows transient inbox fetch failures instead of returning an empty inbox', async () => {
    vi.useFakeTimers();

    const fetchWithTimeout = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.doMock('../src/utils/core', () => ({ fetchWithTimeout }));

    const { MailTmService } = await import('../src/services/emailServices/mailTmService');
    const service = new MailTmService();
    await service.setToken('token');

    const pendingMessages = service.getMessages();
    const assertion = expect(pendingMessages).rejects.toThrow('Failed to fetch');
    await vi.advanceTimersByTimeAsync(3_000);

    await assertion;
  });
});

describe('CustomDomainService robustness', () => {
  it('rejects account creation when backend registration fails', async () => {
    const recordFailure = vi.fn();
    vi.doMock('../src/services/emailServices/providerHealthManager', () => ({
      providerHealth: { recordFailure },
    }));
    vi.doMock('../src/services/storageService', () => ({
      storageService: {
        getCustomDomainKey: vi.fn().mockResolvedValue('secret-key'),
        getSettings: vi.fn().mockResolvedValue({
          customDomain: 'example.test',
          customDomainUrl: 'https://worker.example.test/register',
        }),
      },
    }));

    const fetchMock = vi.fn().mockResolvedValue(
      new Response('registration unavailable', {
        status: 503,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { CustomDomainService } =
      await import('../src/services/emailServices/customDomainService');

    await expect(new CustomDomainService().createAccount()).rejects.toThrow(
      'Custom domain registration failed (503)'
    );
    expect(recordFailure).toHaveBeenCalledWith('custom', expect.any(Error));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://worker.example.test/register',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
