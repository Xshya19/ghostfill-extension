import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt } from '../src/utils/encryption';
import type { ExtractionResult, EncryptedCacheEntry } from '../src/services/types/extraction.types';

vi.mock('../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/services/storageService', () => ({
  storageService: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('../src/services/intelligentExtractor', () => ({ extractAll: vi.fn() }));
vi.mock('../src/services/emailDecisionEngine', () => ({
  assessEmailDecision: () => ({
    purpose: 'verification',
    action: 'fill-otp',
    risk: 'low',
    confidence: 0.95,
    canAutoAct: true,
    reasons: ['visible-code'],
    warnings: [],
  }),
}));

function extraction(code = '582914'): ExtractionResult {
  return {
    intent: 'verification',
    otp: { code, confidence: 0.95 } as ExtractionResult['otp'],
    link: null,
    debugInfo: { provider: null, providerConfidence: 0 } as ExtractionResult['debugInfo'],
  };
}

describe('detection cache concurrency and bounds', () => {
  let session: Map<string, unknown>;
  let service: (typeof import('../src/services/otpService'))['smartDetectionService'];
  let extractAll: (typeof import('../src/services/intelligentExtractor'))['extractAll'];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    session = new Map();
    vi.mocked(chrome.storage.session.get).mockImplementation(async (keys) => {
      const selected =
        keys === null ? [...session.keys()] : Array.isArray(keys) ? keys : [keys as string];
      return Object.fromEntries(
        selected
          .filter((key) => session.has(key))
          .map((key) => [key, structuredClone(session.get(key))])
      );
    });
    vi.mocked(chrome.storage.session.set).mockImplementation(async (data) => {
      for (const [key, value] of Object.entries(data)) {
        session.set(key, structuredClone(value));
      }
    });
    vi.mocked(chrome.storage.session.remove).mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        session.delete(key);
      }
    });
    extractAll = (await import('../src/services/intelligentExtractor')).extractAll;
    vi.mocked(extractAll).mockImplementation((_subject, body) =>
      extraction(body?.match(/\b\d{6}\b/)?.[0])
    );
    service = (await import('../src/services/otpService')).smartDetectionService;
    // Drain the local boot cleanup and Web Crypto key generation before counting requests.
    const startup = service as unknown as {
      cacheReadyPromise: Promise<void>;
      cacheCleanupPromise: Promise<void> | null;
    };
    await startup.cacheReadyPromise;
    await startup.cacheCleanupPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares one extraction, encrypted write and cache lookup for concurrent identical messages', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.detect('Your code', 'Your verification code is 582914.', '', 'accounts@example.com')
      )
    );
    expect(results.every((result) => result.code === '582914')).toBe(true);
    expect(extractAll).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(chrome.storage.session.get)
        .mock.calls.filter(([key]) => typeof key === 'string' && key.startsWith('det_v2_')).length
    ).toBeLessThanOrEqual(1);
    expect(
      vi
        .mocked(chrome.storage.session.set)
        .mock.calls.filter(([data]) => Object.keys(data).some((key) => key.startsWith('det_v2_')))
    ).toHaveLength(1);
  });

  it('keeps independent decision objects for callers sharing the same extraction', async () => {
    const [first, second] = await Promise.all([
      service.detect('Your code', 'Your code is 582914.'),
      service.detect('Your code', 'Your code is 582914.'),
    ]);
    first!.decision!.reasons.push('caller-specific');
    first!.decision!.canAutoAct = false;
    expect(second!.decision!.reasons).toEqual(['visible-code']);
    expect(second!.decision!.canAutoAct).toBe(true);
    const cached = await service.detect('Your code', 'Your code is 582914.');
    expect(cached.decision!.reasons).toEqual(['visible-code']);
    expect(cached.decision!.canAutoAct).toBe(true);
  });

  it('does not lose the bounded index when different messages finish concurrently', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        service.detect('Your code', `Your code is ${582914 + i}.`)
      )
    );
    const index = session.get('det_index') as string[];
    const stored = [...session.keys()].filter((key) => key.startsWith('det_v2_'));
    expect(new Set(index)).toEqual(new Set(stored));
    expect(index).toHaveLength(12);
  });

  it('reads only detection cache keys during cleanup, never the whole session', async () => {
    session.set('unrelated_private_data', { value: 'not needed for extraction' });
    await service.detect('Your code', 'Your code is 582914.');
    expect(chrome.storage.session.get).not.toHaveBeenCalledWith(null);
  });

  it('keeps ciphertext in storage and bounds parallel cache writes to 100 entries', async () => {
    await Promise.all(
      Array.from({ length: 105 }, (_, i) =>
        service.detect('Your code', `Your code is ${582914 + i}.`)
      )
    );
    const index = session.get('det_index') as string[];
    const stored = [...session.keys()].filter((key) => key.startsWith('det_v2_'));
    expect(index.length).toBeLessThanOrEqual(100);
    expect(stored.length).toBeLessThanOrEqual(100);
    expect(new Set(index)).toEqual(new Set(stored));
    for (const key of stored) {
      const entry = session.get(key) as EncryptedCacheEntry;
      expect(entry.encryptedData.startsWith('v1:')).toBe(true);
      expect(entry).not.toHaveProperty('code');
      const cryptoKey = (service as unknown as { cacheKey: CryptoKey }).cacheKey;
      expect((await decrypt<{ type: string }>(entry.encryptedData, cryptoKey)).type).toBe('otp');
    }
  });

  it('does not merge distinct HTML or site contexts, but does share reordered equivalent contexts', async () => {
    const inputs = ['Your code', 'Your code is 582914.', '', 'accounts@example.com'] as const;
    await Promise.all([
      service.detect(...inputs, ['example.com', 'other.com']),
      service.detect(...inputs, ['other.com', 'example.com']),
      service.detect(...inputs, ['different.com']),
      service.detect(inputs[0], inputs[1], '<p>Your code is 391827.</p>', inputs[3], [
        'example.com',
        'other.com',
      ]),
    ]);
    expect(extractAll).toHaveBeenCalledTimes(3);
  });

  it('removes failed shared work so a subsequent request can retry', async () => {
    vi.mocked(extractAll).mockImplementationOnce(() => {
      throw new Error('fixture extraction failure');
    });
    const failures = await Promise.allSettled(
      Array.from({ length: 3 }, () => service.detect('Your code', 'Your code is 582914.'))
    );
    expect(failures.every((result) => result.status === 'rejected')).toBe(true);
    expect((await service.detect('Your code', 'Your code is 582914.')).code).toBe('582914');
    expect(extractAll).toHaveBeenCalledTimes(2);
  });

  it('does not let an unacknowledged optional cache read block code extraction', async () => {
    await service.detect('Your code', 'Your code is 582914.');
    vi.mocked(chrome.storage.session.get).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    let completed: { code?: string } | undefined;
    void service.detect('Your code', 'Your code is 582914.').then((result) => {
      completed = result;
    });
    await vi.advanceTimersByTimeAsync(1001);
    expect(completed?.code).toBe('582914');
    // Further requests still extract correctly after the cache has been disabled.
    expect((await service.detect('Your code', 'Your code is 391827.')).code).toBe('391827');
  });

  it('does not let an unacknowledged cache write retain or block shared work', async () => {
    let writeStarted!: () => void;
    const waitingForWrite = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    vi.mocked(chrome.storage.session.set).mockImplementationOnce(() => {
      writeStarted();
      return new Promise(() => {});
    });
    vi.useFakeTimers();
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      void service.detect('Your code', 'Your code is 582914.').then((result) => {
        results.push(result.code!);
      });
    }
    // Web Crypto runs outside the fake clock. Advance only once the targeted
    // storage operation has started, so this exercises the write deadline.
    await waitingForWrite;
    await vi.advanceTimersByTimeAsync(1001);
    expect(results).toEqual(['582914', '582914', '582914', '582914']);
    expect((await service.detect('Your code', 'Your code is 391827.')).code).toBe('391827');
    expect(chrome.storage.session.set).toHaveBeenCalledTimes(1);
  });

  it('recomputes expired entries without resetting or extending their original lifetime', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await service.detect('Your code', 'Your code is 582914.');
    now += 120_000;
    expect((await service.detect('Your code', 'Your code is 582914.')).code).toBe('582914');
    expect(extractAll).toHaveBeenCalledTimes(2);
    expect(session.get('det_index')).toHaveLength(1);
  });

  it('rejects malformed decrypted values instead of returning or sharing unexpected structures', async () => {
    const valid = await service.detect('Your code', 'Your code is 582914.');
    const key = (session.get('det_index') as string[])[0]!;
    const cryptoKey = (service as unknown as { cacheKey: CryptoKey }).cacheKey;
    const malformed = [
      { ...valid, privatePayload: { secret: 'unrelated private data' } },
      { ...valid, decision: { ...valid.decision, reasons: { unexpected: true } } },
      { ...valid, confidence: Number.NaN },
    ];
    for (const value of malformed) {
      session.set(key, {
        ...(session.get(key) as EncryptedCacheEntry),
        encryptedData: await encrypt(value, cryptoKey),
      });
      const result = await service.detect('Your code', 'Your code is 582914.');
      expect(result.code).toBe('582914');
      expect(result.decision?.reasons).toEqual(['visible-code']);
      expect(result).not.toHaveProperty('privatePayload');
    }
    expect(extractAll).toHaveBeenCalledTimes(4);
  });

  it('discards the previous worker cache safely and ignores unrelated malformed index values', async () => {
    await service.detect('Your code', 'Your code is 582914.');
    const oldKey = (session.get('det_index') as string[])[0]!;
    session.set('det_private_data', { unrelated: true });
    session.set('det_index', [oldKey, 'det_private_data', null, 123, { malformed: true }]);
    vi.resetModules();
    service = (await import('../src/services/otpService')).smartDetectionService;
    expect((await service.detect('Your code', 'Your code is 582914.')).code).toBe('582914');
    expect(session.get('det_private_data')).toEqual({ unrelated: true });
    expect(chrome.storage.session.get).not.toHaveBeenCalledWith(null);
    expect(session.get('det_index')).toEqual([oldKey]);
  });
});
