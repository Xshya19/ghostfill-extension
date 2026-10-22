import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/storageService', () => ({
  storageService: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
}));

import { getCachedProfile, isConnected, signIn, signOut } from '../src/services/gmailApiService';

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    email: 'fixture@gmail.com', emailAddress: 'fixture@gmail.com', messagesTotal: 0,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  (chrome as unknown as { identity: unknown }).identity = {
    getAuthToken: vi.fn((_options, callback) => callback('fixture-gmail-token')),
    getRedirectURL: vi.fn(() => 'https://fixture.chromiumapp.org/'),
    removeCachedAuthToken: vi.fn((_options, callback) => callback()),
    launchWebAuthFlow: vi.fn(),
  };
  await signOut();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('Gmail credential reset', () => {
  it('finishes an already-started token write before removing persisted credentials', async () => {
    const session = new Map<string, unknown>();
    let finishWrite: (() => void) | undefined;
    vi.mocked(chrome.storage.session.set).mockImplementationOnce((data) => new Promise((resolve) => {
      finishWrite = () => {
        for (const [key, value] of Object.entries(data)) {session.set(key, value);}
        resolve();
      };
    }));
    vi.mocked(chrome.storage.session.remove).mockImplementation(async (keys) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) {session.delete(key);}
    });
    const pending = signIn();
    const rejected = expect(pending).rejects.toThrow('connection was cleared');
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    let signedOut = false;
    const clearing = signOut().then(() => {signedOut = true;});
    await Promise.resolve();
    expect(signedOut).toBe(false);
    finishWrite!();
    await Promise.all([clearing, rejected]);
    expect(session.has('gmailAccessToken')).toBe(false);
    expect(isConnected()).toBe(false);
  });

  it('clears the cached account and starts fresh authentication on reconnect', async () => {
    await signIn();
    await signOut();
    expect(isConnected()).toBe(false);
    expect(getCachedProfile()).toBeNull();
    await signIn();
    expect(chrome.identity.getAuthToken).toHaveBeenCalledTimes(2);
  });

  it('rejects late Chrome Identity tokens after sign out without trying fallback OAuth', async () => {
    let reply: ((token: string) => void) | undefined;
    vi.mocked(chrome.identity.getAuthToken).mockImplementation((_options, callback) => {
      reply = callback;
    });
    const pending = signIn();
    const rejected = expect(pending).rejects.toThrow('connection was cleared');
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    await signOut();
    vi.mocked(chrome.storage.session.set).mockClear();
    reply!('late-gmail-token');
    await rejected;
    expect(isConnected()).toBe(false);
    expect(getCachedProfile()).toBeNull();
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(vi.mocked(chrome.storage.session.set).mock.calls.some(([data]) => 'gmailAccessToken' in data)).toBe(false);
  });
});
