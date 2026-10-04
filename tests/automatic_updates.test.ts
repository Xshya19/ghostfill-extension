import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gates = vi.hoisted(() => ({
  poll: false,
  link: false,
  storage: false,
  bootReady: true,
  activation: new Set<number>(),
}));
vi.mock('../src/background/pollingManager', () => ({ isVerificationWorkActive: () => gates.poll }));
vi.mock('../src/background/activationRegistry', () => ({
  getActivationTabsSet: () => gates.activation,
}));
vi.mock('../src/background/initGuard', () => ({
  ensureInitialized: vi.fn(async () => {}),
  isBackgroundInitialized: () => gates.bootReady,
}));
vi.mock('../src/services/storageService', () => ({
  storageService: { hasPendingWrites: () => gates.storage },
}));
vi.mock('../src/services/linkService', () => ({
  linkService: { hasPendingActivation: () => gates.link },
}));
vi.mock('../src/utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), debug: vi.fn() }) }));

import {
  parseAutomaticUpdateState,
  compareExtensionVersions,
} from '../src/utils/automaticUpdateState';

const incoming = {
  name: '__MSG_extensionName__',
  manifest_version: 3,
  version: '1.2.0',
  key: 'fixed-identity',
  background: { service_worker: 'background.js' },
  action: { default_popup: 'popup.html' },
  oauth2: { client_id: 'client.apps.googleusercontent.com' },
};
const marker = () => ({
  schemaVersion: 1,
  autoUpdateEnabled: true,
  taskName: 'GhostFill-AutoUpdate-1234567812345678',
  installedVersion: '1.2.0',
  updatedAt: '2026-10-03T02:00:00.000Z',
  lastCheckedAt: '2026-10-03T02:00:00.000Z',
  updateId: '12345678123456781234567812345678',
  source: 'windows-helper',
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-03T03:00:00.000Z');
  gates.poll = gates.link = gates.storage = false;
  gates.bootReady = true;
  gates.activation.clear();
  vi.mocked(chrome.storage.session.get).mockResolvedValue({});
  Object.assign(chrome.runtime, {
    getManifest: vi.fn(() => ({ ...incoming, name: 'GhostFill', version: '1.1.5' })),
    getURL: vi.fn((path) => `chrome-extension://ghostfill/${path}`),
    getContexts: vi.fn(async () => []),
    onSuspend: { addListener: vi.fn() },
    onSuspendCanceled: { addListener: vi.fn() },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url) =>
        new Response(JSON.stringify(String(url).endsWith('manifest.json') ? incoming : marker()), {
          headers: { 'content-type': 'application/json' },
        })
    )
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('installed automatic updates', () => {
  it('waits for persisted cold-start verification registrations to clear', async () => {
    vi.mocked(chrome.storage.session.get).mockResolvedValue({
      pm_waiters_v1: [{ tabId: 2 }],
      pm_activationTabs_v1: [],
    });
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('keeps a worker with incomplete initialization running', async () => {
    gates.bootReady = false;
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });
  it('loads a verified newer package even when the worker wakes cold and the name is localized', async () => {
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('ghostfill-update-state.json'),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it.each(['poll', 'link', 'storage', 'activation'] as const)(
    'defers loading during %s work',
    async (gate) => {
      if (gate === 'activation') {
        gates.activation.add(12);
      } else {
        gates[gate] = true;
      }
      const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
      await checkAutomaticUpdate();
      expect(chrome.runtime.reload).not.toHaveBeenCalled();
      if (gate !== 'link') {
        expect(fetch).not.toHaveBeenCalled();
      }
    }
  );

  it('keeps an open Options page alive', async () => {
    vi.mocked(chrome.runtime.getContexts).mockResolvedValue([
      { contextType: 'TAB' },
    ] as chrome.runtime.ExtensionContext[]);
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('catches a popup that opens while the final marker is read', async () => {
    vi.mocked(chrome.runtime.getContexts)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ contextType: 'POPUP' }] as chrome.runtime.ExtensionContext[]);
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it.each([
    { autoUpdateEnabled: false, taskName: null },
    { installedVersion: '1.1.5' },
    { installedVersion: '1.1.3' },
    { updateId: null },
    { updatedAt: null },
    { updatedAt: '2026-10-03T02:59:30.000Z' },
    { schemaVersion: 4 },
    { installedVersion: '01.2.0' },
  ])('rejects disabled, incomplete, invalid or non-newer state %j', async (change) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...marker(), ...change })));
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('verifies the package profile and extension identity against the loaded manifest', async () => {
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('manifest.json')
              ? { ...incoming, key: 'other-identity' }
              : marker()
          )
        )
    );
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('rechecks helper state immediately before loading', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(marker())))
      .mockResolvedValueOnce(new Response(JSON.stringify(incoming)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...marker(), autoUpdateEnabled: false }))
      );
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('does not reload when verification starts during an async context check', async () => {
    vi.mocked(chrome.runtime.getContexts).mockImplementation(async () => {
      gates.poll = true;
      return [];
    });
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('preserves the old-browser manual reload fallback', async () => {
    (chrome.runtime as any).getContexts = undefined;
    const { checkAutomaticUpdate } = await import('../src/background/automaticUpdates');
    await checkAutomaticUpdate();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('coalesces checks and defers after activity or suspension', async () => {
    const { setupAutomaticUpdates, checkAutomaticUpdate } =
      await import('../src/background/automaticUpdates');
    setupAutomaticUpdates();
    const message = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)![0];
    message({}, {}, vi.fn());
    await checkAutomaticUpdate();
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_001);
    const a = checkAutomaticUpdate();
    expect(checkAutomaticUpdate()).toBe(a);
    const suspend = vi.mocked(chrome.runtime.onSuspend.addListener).mock.calls.at(-1)![0];
    suspend();
    await a;
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('registers one persisted alarm and keeps an existing schedule', async () => {
    vi.mocked(chrome.alarms.get).mockResolvedValue({
      name: 'ghostfill-installed-update',
      scheduledTime: Date.now() + 1000,
    });
    const { setupAutomaticUpdates } = await import('../src/background/automaticUpdates');
    setupAutomaticUpdates();
    setupAutomaticUpdates();
    await Promise.resolve();
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledOnce();
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});

describe('local helper status validation', () => {
  it('compares version numbers numerically and rejects ambiguous versions', () => {
    expect(compareExtensionVersions('1.10.0', '1.9.20')).toBeGreaterThan(0);
    expect(() => compareExtensionVersions('1.2.3.4', '1.2.0')).toThrow();
    expect(() => parseAutomaticUpdateState({ ...marker(), taskName: '../other' })).toThrow();
    expect(() => parseAutomaticUpdateState({ ...marker(), lastCheckedAt: 'yesterday' })).toThrow();
  });
});
