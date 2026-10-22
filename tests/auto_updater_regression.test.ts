import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/services/storageService', () => ({
  storageService: {
    getSettings: async () => ({ notifications: true }),
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => store.set(key, structuredClone(value)),
    remove: async (key: string) => store.delete(key),
  },
}));
vi.mock('../src/utils/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, debug() {} }),
}));

import { dismissUpdate, runUpdateCheck } from '../src/background/autoUpdater';

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe('update notification dismissal', () => {
  it('keeps dismissal for the same release and permits notification for a newer release', async () => {
    let version = '1.1.0';
    const notify = vi.fn().mockResolvedValue('notification');
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '1.0.0' }), getURL: (path: string) => path },
      notifications: { create: notify },
    });
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        tag_name: `v${version}`,
        html_url: 'https://github.com/Xshya19/ghostfill-extension/releases',
        draft: false,
        prerelease: false,
        assets: [],
      }),
    }));
    await runUpdateCheck();
    await dismissUpdate();
    await runUpdateCheck();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.get('availableUpdate')).toMatchObject({ version, dismissed: true });
    version = '1.2.0';
    await runUpdateCheck();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(store.get('availableUpdate')).toMatchObject({ version, dismissed: false });
  });
});
