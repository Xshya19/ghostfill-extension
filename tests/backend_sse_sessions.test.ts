import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailAccount } from '../src/types';

vi.mock('../src/services/emailServices', () => ({
  mailTmService: {
    ensureAuthenticated: vi.fn(async () => {}),
    authenticate: vi.fn(async () => {}),
    getToken: vi.fn(() => 'fixture-token'),
  },
  emailService: { getCurrentEmail: vi.fn(async () => null) },
}));

import { emailService } from '../src/services/emailServices';
vi.mock('../src/background/offscreenManager', () => ({
  ensureOffscreenDocument: vi.fn(async () => {}),
}));
vi.mock('../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  diag: {
    startFlow: vi.fn(() => 'test-flow'),
    step: vi.fn(),
    endFlow: vi.fn(),
    log: vi.fn(),
    state: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let turn = 0; turn < 15; turn++) {
    await Promise.resolve();
  }
}
function account(id: string): EmailAccount {
  return {
    id,
    service: 'mailtm',
    fullEmail: `${id}@example.com`,
    token: 'fixture-token',
  } as EmailAccount;
}
function streamResponse() {
  const nextRead = deferred<ReadableStreamReadResult<Uint8Array>>();
  const reader = { read: vi.fn(() => nextRead.promise), releaseLock: vi.fn() };
  return {
    nextRead,
    response: { ok: true, body: { getReader: () => reader } } as unknown as Response,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  delete (chrome as unknown as { offscreen?: unknown }).offscreen;
  vi.mocked(chrome.alarms.clear).mockResolvedValue(true);
  vi.mocked(chrome.runtime.sendMessage).mockReset().mockResolvedValue({});
  vi.mocked(emailService.getCurrentEmail).mockResolvedValue(null);
});
afterEach(async () => {
  const { sseManager } = await import('../src/background/sseManager');
  sseManager.reset();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SSE session isolation', () => {
  it.each(['disconnect', 'reset'] as const)(
    'explicit %s still closes the active offscreen stream',
    async (method) => {
      Object.assign(chrome, { offscreen: {} });
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: true });
      const { sseManager } = await import('../src/background/sseManager');
      expect(await sseManager.connect(account('current'))).toBe(true);
      vi.mocked(chrome.runtime.sendMessage).mockClear();
      sseManager[method]();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        target: 'offscreen-doc',
        type: 'SSE_DISCONNECT',
      });
      expect(sseManager.getMetrics()).toMatchObject({
        connected: false,
        accountId: null,
        transport: 'none',
      });
    }
  );
  it.each(['AbortError', 'TypeError'])(
    'does not clear the new connection when an old fetch rejects with %s',
    async (name) => {
      const oldFetch = deferred<Response>();
      const current = streamResponse();
      vi.mocked(fetch)
        .mockReturnValueOnce(oldFetch.promise)
        .mockResolvedValueOnce(current.response);
      const { sseManager } = await import('../src/background/sseManager');
      const oldConnection = sseManager.connect(account('earlier'));
      await settle();
      const currentConnection = sseManager.connect(account('current'));
      await settle();
      expect(sseManager.getMetrics()).toMatchObject({
        connected: true,
        accountId: 'current',
        transport: 'sw',
      });
      const failure = new Error('Superseded connection failure');
      failure.name = name;
      oldFetch.reject(failure);
      await oldConnection;
      expect(sseManager.getMetrics()).toMatchObject({
        connected: true,
        accountId: 'current',
        transport: 'sw',
      });
      sseManager.disconnect();
      current.nextRead.resolve({ done: true, value: undefined });
      await currentConnection;
    }
  );

  it('does not revive an old offscreen connection after its session is reset', async () => {
    Object.assign(chrome, { offscreen: {} });
    const reply = deferred<{ success: boolean }>();
    vi.mocked(chrome.runtime.sendMessage).mockReturnValueOnce(reply.promise);
    const { sseManager } = await import('../src/background/sseManager');
    const connection = sseManager.connect(account('earlier'));
    await settle();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SSE_CONNECT' })
    );
    sseManager.reset();
    reply.resolve({ success: true });
    expect(await connection).toBe(false);
    expect(sseManager.getMetrics()).toMatchObject({
      connected: false,
      accountId: null,
      transport: 'none',
    });
  });

  it('ignores a stale offscreen status reply after session reset', async () => {
    Object.assign(chrome, { offscreen: {} });
    const reply = deferred<{ success: boolean; connected: boolean; accountId: string }>();
    vi.mocked(chrome.runtime.sendMessage).mockReturnValueOnce(reply.promise);
    const { sseManager } = await import('../src/background/sseManager');
    const status = sseManager.syncWithOffscreen();
    sseManager.reset();
    reply.resolve({ success: true, connected: true, accountId: 'earlier' });
    expect(await status).toBe(false);
    expect(sseManager.getMetrics()).toMatchObject({
      connected: false,
      accountId: null,
      transport: 'none',
    });
  });

  it.each(['SSE_RELAY_OPEN', 'SSE_RELAY_CLOSED', 'SSE_RELAY_FAILED'])(
    'ignores %s from a previous account',
    async (type) => {
      const current = streamResponse();
      vi.mocked(fetch).mockResolvedValueOnce(current.response);
      const { sseManager } = await import('../src/background/sseManager');
      const connection = sseManager.connect(account('current'));
      await settle();
      const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      listener({ type, accountId: 'earlier' }, { id: chrome.runtime.id }, vi.fn());
      expect(sseManager.getMetrics()).toMatchObject({
        connected: true,
        accountId: 'current',
        transport: 'sw',
      });
      sseManager.disconnect();
      current.nextRead.resolve({ done: true, value: undefined });
      await connection;
    }
  );

  it('increases the reconnect backoff instead of resetting its attempt count on each failure', async () => {
    vi.mocked(emailService.getCurrentEmail).mockResolvedValue(account('current'));
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    const { sseManager } = await import('../src/background/sseManager');
    await sseManager.connect(account('current'));
    expect(sseManager.getMetrics()).toMatchObject({ reconnectAttempts: 1 });
    await vi.advanceTimersByTimeAsync(800);
    expect(sseManager.getMetrics()).toMatchObject({ reconnectAttempts: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(560);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops transport retries after the retry budget is exhausted', async () => {
    vi.mocked(emailService.getCurrentEmail).mockResolvedValue(account('current'));
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    const { sseManager } = await import('../src/background/sseManager');
    await sseManager.connect(account('current'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(9);
    expect(sseManager.getMetrics()).toMatchObject({ connected: false, reconnectAttempts: 8 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
