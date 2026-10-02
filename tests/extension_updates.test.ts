import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AboutTab } from '../src/frontend/options/components/OptionsTabs';
import { checkExtensionUpdate, EXTENSION_RELEASES_URL } from '../src/utils/extensionUpdate';

function release(version = '1.1.2') {
  const name = `ghostfill-extension-v${version}.zip`;
  const url = `${EXTENSION_RELEASES_URL}/download/v${version}/${name}`;
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      { name, browser_download_url: url },
      { name: `${name}.sha256`, browser_download_url: `${url}.sha256` },
    ],
  };
}

function response(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('published extension updates', () => {
  it.each([
    ['1.9.9', '1.10.0', 'available'],
    ['1.1.2', '1.1.2', 'current'],
    ['1.1.2', '1.1.0', 'ahead'],
  ])(
    'compares installed %s with published %s numerically',
    async (installed, published, status) => {
      const fetch = vi.fn().mockResolvedValue(response(release(published)));
      vi.stubGlobal('fetch', fetch);
      const result = await checkExtensionUpdate(installed);
      expect(result.status).toBe(status);
      expect(result.zipUrl).toBe(release(published).assets[0].browser_download_url);
      expect(result.checksumUrl).toBe(`${result.zipUrl}.sha256`);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/Xshya19/ghostfill-extension/releases/latest',
        expect.objectContaining({ credentials: 'omit', cache: 'no-store' })
      );
    }
  );

  it.each([
    null,
    { ...release(), draft: true },
    { ...release(), prerelease: true },
    release('1.2.3-beta'),
    release('65536.1.2'),
    release('01.2.3'),
    { ...release(), assets: [] },
    { ...release(), assets: [release().assets[0]] },
    {
      ...release(),
      assets: [
        { ...release().assets[0], browser_download_url: 'https://evil.example/update.zip' },
        release().assets[1],
      ],
    },
  ])('rejects incomplete or untrusted release metadata %#', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    await expect(checkExtensionUpdate('1.0.0')).rejects.toThrow(/release|ZIP|checksum/i);
  });

  it.each([
    [404, 'No stable release'],
    [429, 'GitHub limited'],
    [503, 'HTTP 503'],
  ])('explains an unsuccessful HTTP %s response', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(checkExtensionUpdate('1.0.0')).rejects.toThrow(String(message));
  });

  it('bounds an unavailable endpoint and respects cancellation', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetch);
    const timedOut = expect(checkExtensionUpdate('1.0.0')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    await timedOut;
    const controller = new AbortController();
    const aborted = expect(checkExtensionUpdate('1.0.0', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await aborted;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('updates inside GhostFill', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(chrome.runtime.reload).mockClear();
    flushSync(() => root.render(React.createElement(AboutTab)));
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('checks only on request, exposes the verified package, and reloads only on a separate click', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    vi.stubGlobal('fetch', fetch);
    expect(fetch).not.toHaveBeenCalled();
    const buttons = Array.from(container.querySelectorAll('button'));
    const check = buttons.find((button) => button.textContent === 'Check for updates')!;
    const reload = buttons.find((button) => button.textContent === 'Reload after updating')!;
    flushSync(() => check.click());
    expect(check.disabled).toBe(true);
    finish(response(release()));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        '1.1.2 is available'
      )
    );
    expect(check.disabled).toBe(false);
    expect(
      container.querySelector(`a[href="${release().assets[0].browser_download_url}"]`)
    ).not.toBeNull();
    expect(
      container.querySelector(`a[href="${release().assets[1].browser_download_url}"]`)
    ).not.toBeNull();
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
    flushSync(() => reload.click());
    expect(chrome.runtime.reload).toHaveBeenCalledOnce();
  });

  it('allows retry after a failed check and aborts pending work when closed', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    let signal: AbortSignal | undefined;
    fetch.mockImplementationOnce(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = options.signal!;
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
    );
    vi.stubGlobal('fetch', fetch);
    const check = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Check for updates'
    )!;
    flushSync(() => check.click());
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'Check your connection'
      )
    );
    expect(check.disabled).toBe(false);
    flushSync(() => check.click());
    flushSync(() => root.unmount());
    expect(signal?.aborted).toBe(true);
    // Keep the shared cleanup usable after this explicit unmount.
    root = createRoot(container);
  });
});
