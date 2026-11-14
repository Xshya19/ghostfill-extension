/**
 * Connectivity detection — offline awareness (2026-11-12).
 *
 * Regression suite for the "internet not working" experience: provider
 * calls used to fail with generic transport errors indistinguishable
 * from a provider outage, the polling ladder kept burning retries, and
 * no surface could tell the user that the machine was offline.
 *
 * Covered:
 * - network-error classification (transport vs application failure),
 * - offline / degraded-network / online classification,
 * - navigator.onLine signal,
 * - window-level online/offline watching,
 * - the no-cors reachability probe (no new host permissions).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  classifyConnectivity,
  connectivitySummary,
  isNavigatorOffline,
  isNetworkError,
  probeConnectivity,
  watchConnectivity,
} from '../src/utils/connectivity';

const setOnline = (value: boolean): void => {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  });
};

describe('connectivity — network error classification', () => {
  afterEach(() => {
    setOnline(true);
    vi.unstubAllGlobals();
  });

  it('treats fetch TypeError as a network-stack failure', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats browser transport error codes as network failures', () => {
    expect(isNetworkError(new Error('ERR_INTERNET_DISCONNECTED'))).toBe(true);
    expect(isNetworkError(new Error('ERR_NAME_NOT_RESOLVED'))).toBe(true);
    expect(isNetworkError('Network request failed')).toBe(true);
    expect(isNetworkError(new Error('Load failed'))).toBe(true);
  });

  it('does NOT classify application/HTTP failures as network failures', () => {
    expect(isNetworkError(new Error('HTTP error 429'))).toBe(false);
    expect(isNetworkError(new Error('Request failed with status 401'))).toBe(false);
    expect(isNetworkError(new Error('Invalid JSON payload'))).toBe(false);
  });

  it('handles empty/unknown input safely', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError({})).toBe(false);
  });
});

describe('connectivity — state classification', () => {
  afterEach(() => {
    setOnline(true);
  });

  it('reports offline when the browser says so and the error is transport-level', () => {
    setOnline(false);
    expect(classifyConnectivity(new TypeError('Failed to fetch'))).toBe('offline');
  });

  it('reports degraded-network when fetch fails but the browser still claims online', () => {
    setOnline(true);
    expect(classifyConnectivity(new TypeError('Failed to fetch'))).toBe('degraded-network');
  });

  it('reports online for application-level failures (the network worked)', () => {
    setOnline(false);
    expect(classifyConnectivity(new Error('HTTP error 429'))).toBe('online');
    setOnline(true);
    expect(classifyConnectivity(new Error('HTTP error 500'))).toBe('online');
  });

  it('exposes a user-facing summary for each state', () => {
    expect(connectivitySummary('offline')).toBe('No internet connection');
    expect(connectivitySummary('degraded-network')).toBe('Network connection is unstable');
    expect(connectivitySummary('online')).toBe('Connected');
  });
});

describe('connectivity — navigator signal', () => {
  afterEach(() => {
    setOnline(true);
  });

  it('reflects navigator.onLine', () => {
    expect(isNavigatorOffline()).toBe(false);
    setOnline(false);
    expect(isNavigatorOffline()).toBe(true);
  });
});

describe('connectivity — window watcher', () => {
  it('reports online/offline transitions and stops after unsubscribe', () => {
    const seen: boolean[] = [];
    const unsubscribe = watchConnectivity((online) => seen.push(online));

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    unsubscribe();
    window.dispatchEvent(new Event('offline'));

    expect(seen).toEqual([false, true]);
  });
});

describe('connectivity — reachability probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports reachable when the permitted origin answers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeConnectivity(100)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(target).toContain('https://');
    expect(init.method).toBe('HEAD');
    // no-cors keeps the probe inside the existing host-permission trust
    // boundary: an opaque response still proves the stack is reachable.
    expect(init.mode).toBe('no-cors');
  });

  it('reports unreachable after every permitted target fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeConnectivity(100)).resolves.toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('never throws when the network stack misbehaves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(probeConnectivity(100)).resolves.toBe(false);
  });
});
