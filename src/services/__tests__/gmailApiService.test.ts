import { beforeEach, describe, expect, it, vi } from 'vitest';

function mockStorageGet(get: (key: string) => Promise<unknown>): { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn(async () => undefined);
  vi.doMock('../storageService', () => ({
    storageService: {
      get: vi.fn(get),
      set,
    },
  }));
  return { set };
}

function installIdentityMock(
  overrides: Partial<typeof chrome.identity> = {}
): typeof chrome.identity {
  const identity = {
    getRedirectURL: vi.fn(() => 'https://test-extension-id.chromiumapp.org/'),
    getAuthToken: vi.fn(),
    launchWebAuthFlow: vi.fn(),
    removeCachedAuthToken: vi.fn((_details, callback?: () => void) => callback?.()),
    ...overrides,
  } as unknown as typeof chrome.identity;

  (chrome as unknown as { identity: typeof chrome.identity }).identity = identity;
  return identity;
}

function setRuntimeLastError(message?: string): void {
  const runtime = chrome.runtime as unknown as {
    lastError?: chrome.runtime.LastError;
  };
  if (message) {
    runtime.lastError = { message };
  } else {
    delete runtime.lastError;
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gmailApiService OAuth setup hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    setRuntimeLastError();
  });

  it('waits for the stored custom client ID before starting interactive auth', async () => {
    let resolveClientId!: (value: string) => void;
    const clientIdPromise = new Promise<string>((resolve) => {
      resolveClientId = resolve;
    });

    mockStorageGet(async (key) => (key === 'gmailClientId' ? clientIdPromise : undefined));

    const launchWebAuthFlow = vi.fn(
      (_details: chrome.identity.WebAuthFlowOptions, callback?: (responseUrl?: string) => void) => {
        const redirectUrl =
          'https://test-extension-id.chromiumapp.org/#access_token=test-token&expires_in=3600';
        callback?.(redirectUrl);
        return undefined;
      }
    );

    installIdentityMock({
      launchWebAuthFlow: launchWebAuthFlow as unknown as typeof chrome.identity.launchWebAuthFlow,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) {
        return jsonResponse({ email: 'user@gmail.com', name: 'User' });
      }
      if (url.endsWith('/profile')) {
        return jsonResponse({ emailAddress: 'user@gmail.com', messagesTotal: 1, historyId: '42' });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const gmailApiService = await import('../gmailApiService');
    const signInPromise = gmailApiService.signIn();

    await Promise.resolve();
    await Promise.resolve();
    expect(launchWebAuthFlow).not.toHaveBeenCalled();

    resolveClientId('custom-client.apps.googleusercontent.com');
    const profile = await signInPromise;

    const authUrl = new URL(launchWebAuthFlow.mock.calls[0]?.[0].url ?? '');
    expect(authUrl.searchParams.get('client_id')).toBe('custom-client.apps.googleusercontent.com');
    expect(profile.email).toBe('user@gmail.com');
  });

  it('does not retry the same permanently invalid bundled client ID', async () => {
    mockStorageGet(async () => undefined);

    const getAuthToken = vi.fn(
      (
        _details: chrome.identity.TokenDetails,
        callback?: (token?: string, grantedScopes?: string[]) => void
      ) => {
        setRuntimeLastError('bad client id');
        callback?.();
        setRuntimeLastError();
      }
    );

    const launchWebAuthFlow = vi.fn(
      (_details: chrome.identity.WebAuthFlowOptions, callback?: (responseUrl?: string) => void) => {
        setRuntimeLastError('bad client id');
        callback?.();
        setRuntimeLastError();
        return undefined;
      }
    );

    installIdentityMock({
      getAuthToken: getAuthToken as unknown as typeof chrome.identity.getAuthToken,
      launchWebAuthFlow: launchWebAuthFlow as unknown as typeof chrome.identity.launchWebAuthFlow,
    });

    const gmailApiService = await import('../gmailApiService');

    await expect(gmailApiService.signIn()).rejects.toThrow('Gmail OAuth client ID is invalid');
    expect(getAuthToken).toHaveBeenCalledTimes(1);
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(gmailApiService.getClientIdStatus().blocked).toBe(true);

    await expect(gmailApiService.signIn()).rejects.toThrow('Gmail OAuth client ID is invalid');
    expect(getAuthToken).toHaveBeenCalledTimes(1);
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent Gmail syncs for the same alias/query cache key', async () => {
    const storage = mockStorageGet(async (key) => (key === 'gmailSyncState' ? {} : undefined));

    const getAuthToken = vi.fn(
      (
        _details: chrome.identity.TokenDetails,
        callback?: (token?: string, grantedScopes?: string[]) => void
      ) => {
        callback?.('test-token', []);
      }
    );
    installIdentityMock({
      getAuthToken: getAuthToken as unknown as typeof chrome.identity.getAuthToken,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages?')) {
        return jsonResponse({ messages: [{ id: 'm1', threadId: 't1' }] });
      }
      if (url.includes('/messages/m1')) {
        return jsonResponse({
          id: 'm1',
          threadId: 't1',
          snippet: 'Your code is 123456',
          internalDate: '1700000000000',
          labelIds: ['INBOX', 'UNREAD'],
          payload: {
            headers: [
              { name: 'Subject', value: 'Verification code' },
              { name: 'From', value: 'Security <security@example.com>' },
              { name: 'To', value: 'user+site@gmail.com' },
              { name: 'Date', value: new Date(1700000000000).toUTCString() },
            ],
            body: { data: btoa('Your code is 123456') },
          },
        });
      }
      if (url.endsWith('/profile')) {
        return jsonResponse({ emailAddress: 'user@gmail.com', messagesTotal: 1, historyId: '42' });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const gmailApiService = await import('../gmailApiService');
    const [first, second] = await Promise.all([
      gmailApiService.syncInbox('in:anywhere to:"user+site@gmail.com"', 5, {
        alias: 'user+site@gmail.com',
      }),
      gmailApiService.syncInbox('in:anywhere to:"user+site@gmail.com"', 5, {
        alias: 'user+site@gmail.com',
      }),
    ]);

    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/messages?'))).toHaveLength(
      1
    );
    expect(storage.set).toHaveBeenCalledTimes(1);
  });
});
