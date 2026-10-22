import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/storageService', () => ({ storageService: { get: vi.fn(), set: vi.fn() } }));

import { connectMicrosoft, disconnectMicrosoft } from '../src/services/microsoftMailService';
import { connectZoho, disconnectZoho } from '../src/services/zohoMailService';
import { storageService } from '../src/services/storageService';

const providers = [
  { name: 'Microsoft', connect: connectMicrosoft, disconnect: disconnectMicrosoft, tokenKey: 'msAccessToken' },
  { name: 'Zoho', connect: connectZoho, disconnect: disconnectZoho, tokenKey: 'zohoAccessToken' },
] as const;

beforeEach(async () => {
  vi.mocked(storageService.set).mockResolvedValue(undefined);
  await Promise.all([disconnectMicrosoft(), disconnectZoho()]);
  vi.clearAllMocks();
  vi.mocked(storageService.get).mockImplementation(async (key) =>
    key === 'zohoRegion' ? 'com' : key.endsWith('ClientId') ? 'fixture-client' : null
  );
  (chrome as unknown as { identity: unknown }).identity = {
    getRedirectURL: vi.fn(() => 'https://fixture.chromiumapp.org/'),
    launchWebAuthFlow: vi.fn((_options, callback) => callback(
      'https://fixture.chromiumapp.org/#access_token=fixture-account-token&expires_in=3600'
    )),
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    id: 'fixture-id', mail: 'fixture@example.com', displayName: 'Fixture',
    data: [{ accountId: 'fixture-id', emailAddress: [{ mailId: 'fixture@example.com', isDefault: true }] }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

describe.each(providers)('$name credential reset', ({ connect, disconnect, tokenKey }) => {
  it('finishes an already-started token write before removing persisted credentials', async () => {
    const session = new Map<string, unknown>();
    let finishWrite: (() => void) | undefined;
    vi.mocked(chrome.storage.session.set).mockImplementationOnce((data) => new Promise((resolve) => {
      finishWrite = () => {
        for (const [key, value] of Object.entries(data)) { session.set(key, value); }
        resolve();
      };
    }));
    vi.mocked(chrome.storage.session.remove).mockImplementation(async (keys) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) {session.delete(key);}
    });
    const pending = connect();
    const rejected = expect(pending).rejects.toThrow('connection was cleared');
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    let disconnected = false;
    const clearing = disconnect().then(() => {disconnected = true;});
    await Promise.resolve();
    expect(disconnected).toBe(false);
    finishWrite!();
    await Promise.all([clearing, rejected]);
    expect(session.has(tokenKey)).toBe(false);
  });

  it('finishes an already-started profile write before clearing the saved connection', async () => {
    const stored = new Map<string, unknown>();
    let finishWrite: (() => void) | undefined;
    vi.mocked(storageService.set).mockImplementation(async (key, value) => {
      if (key.endsWith('Profile') && value) {
        await new Promise<void>((resolve) => {
          finishWrite = () => {stored.set(key, value); resolve();};
        });
      } else {
        stored.set(key, value);
      }
    });
    const pending = connect();
    const rejected = expect(pending).rejects.toThrow('connection was cleared');
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    const clearing = disconnect();
    finishWrite!();
    await Promise.all([clearing, rejected]);
    const prefix = tokenKey === 'msAccessToken' ? 'microsoft' : 'zoho';
    expect(stored.get(`${prefix}Profile`)).toBeNull();
    expect(stored.get(`${prefix}Connected`)).toBe(false);
  });

  it('requires another interactive connection after disconnecting a cached account', async () => {
    await connect();
    await disconnect();
    await connect();
    const launches = vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls;
    expect(launches).toHaveLength(2);
    expect(launches[1]![0].interactive).toBe(true);
  });

  it('rejects a late OAuth response without restoring the removed token', async () => {
    let reply: ((url: string) => void) | undefined;
    vi.mocked(chrome.identity.launchWebAuthFlow).mockImplementation((_options, callback) => {
      reply = callback;
    });
    const pending = connect();
    const rejected = expect(pending).rejects.toThrow('connection was cleared');
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    await disconnect();
    vi.mocked(chrome.storage.session.set).mockClear();
    vi.mocked(storageService.set).mockClear();
    reply!('https://fixture.chromiumapp.org/#access_token=late-account-token&expires_in=3600');
    await rejected;
    expect(vi.mocked(chrome.storage.session.set).mock.calls.some(([data]) => tokenKey in data)).toBe(false);
    expect(storageService.set).not.toHaveBeenCalled();
  });

  it('rejects a profile response that arrives after the account was disconnected', async () => {
    let reply: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    const pending = connect();
    const rejected = expect(pending).rejects.toThrow('connection was cleared');
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    await disconnect();
    vi.mocked(storageService.set).mockClear();
    reply!(new Response(JSON.stringify({
      id: 'late-id', mail: 'late@example.com',
      data: [{ accountId: 'late-id', emailAddress: [{ mailId: 'late@example.com', isDefault: true }] }],
    }), { status: 200 }));
    await rejected;
    expect(storageService.set).not.toHaveBeenCalled();
  });
});
