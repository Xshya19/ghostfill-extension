import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/background/initGuard', () => ({ ensureInitialized: vi.fn(async () => {}) }));
vi.mock('../src/background/serviceWorker', () => ({ getBootState: () => 'ready' }));
vi.mock('../src/background/pollingManager', () => ({
  stopEmailPolling: vi.fn(),
  resetEmailSession: vi.fn(async () => {}),
  suppressNextEmailTypeTransition: vi.fn(),
}));
vi.mock('../src/background/notifications', () => ({ resetNotificationSession: vi.fn() }));
vi.mock('../src/services/gmailApiService', () => ({
  signOut: vi.fn(async () => {}),
  signIn: vi.fn(),
  isConfigured: () => true,
  getClientIdStatus: () => ({ configured: true, source: 'bundled' }),
}));
vi.mock('../src/services/microsoftMailService', () => ({
  disconnectMicrosoft: vi.fn(async () => {}),
}));
vi.mock('../src/services/zohoMailService', () => ({ disconnectZoho: vi.fn(async () => {}) }));
vi.mock('../src/services/identityService', () => ({
  identityService: { clearIdentity: vi.fn(async () => {}) },
}));
vi.mock('../src/services/emailServices', () => ({
  emailService: { clearData: vi.fn(async () => {}) },
}));
vi.mock('../src/services/passwordService', () => ({
  passwordService: { clearHistory: vi.fn(async () => {}) },
}));
vi.mock('../src/services/linkService', () => ({ linkService: { clearData: vi.fn() } }));
vi.mock('../src/services/dedupService', () => ({ dedupService: { clear: vi.fn(async () => {}) } }));
vi.mock('../src/services/storageService', () => ({
  storageService: {
    clear: vi.fn(async () => {}),
    set: vi.fn(async () => {}),
    get: vi.fn(async () => null),
  },
}));

import { setupMessageHandler } from '../src/background/messageHandler';
import { resetEmailSession, stopEmailPolling } from '../src/background/pollingManager';
import { signIn, signOut } from '../src/services/gmailApiService';
import { disconnectMicrosoft } from '../src/services/microsoftMailService';
import { disconnectZoho } from '../src/services/zohoMailService';
import { identityService } from '../src/services/identityService';
import { emailService } from '../src/services/emailServices';
import { passwordService } from '../src/services/passwordService';
import { dedupService } from '../src/services/dedupService';
import { linkService } from '../src/services/linkService';
import { storageService } from '../src/services/storageService';

let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
beforeAll(() => {
  setupMessageHandler();
  listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)![0];
});
beforeEach(() => {
  vi.clearAllMocks();
});

function send(action: string): Promise<any> {
  return new Promise((resolve) =>
    listener(
      { action } as any,
      { id: chrome.runtime.id, url: `chrome-extension://${chrome.runtime.id}/options.html` },
      resolve
    )
  );
}

describe('clear all extension data', () => {
  it('stops mailbox work and disconnects live credentials before clearing storage', async () => {
    const response = await new Promise((resolve) =>
      listener(
        { action: 'CLEAR_DATA' },
        { id: chrome.runtime.id, url: `chrome-extension://${chrome.runtime.id}/options.html` },
        resolve
      )
    );
    expect(response).toEqual({ success: true });
    const cleanup = [
      stopEmailPolling,
      resetEmailSession,
      signOut,
      disconnectMicrosoft,
      disconnectZoho,
      identityService.clearIdentity,
      emailService.clearData,
      passwordService.clearHistory,
      dedupService.clear,
      linkService.clearData,
    ];
    for (const action of cleanup) {
      expect(action).toHaveBeenCalled();
      expect(vi.mocked(action).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(storageService.clear).mock.invocationCallOrder[0]!
      );
    }
    expect(storageService.clear).toHaveBeenCalledOnce();
  });

  it('does not persist a sign-in result returned after clearing finished', async () => {
    let completeSignIn!: (profile: any) => void;
    vi.mocked(signIn).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeSignIn = resolve;
        })
    );
    const signInResult = send('GMAIL_SIGN_IN');
    await vi.waitFor(() => expect(completeSignIn).toBeTypeOf('function'));
    await expect(send('CLEAR_DATA')).resolves.toMatchObject({ success: true });
    completeSignIn({ email: 'fixture@example.com' });
    await expect(signInResult).resolves.toMatchObject({ success: false });
    expect(storageService.set).not.toHaveBeenCalled();
  });

  it('drains an already-started Gmail profile write before the final wipe', async () => {
    let completeWrite!: () => void;
    vi.mocked(signIn).mockResolvedValueOnce({ email: 'fixture@example.com' } as any);
    vi.mocked(storageService.set).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeWrite = resolve;
        })
    );
    const signInResult = send('GMAIL_SIGN_IN');
    await vi.waitFor(() => expect(completeWrite).toBeTypeOf('function'));
    const cleared = send('CLEAR_DATA');
    await vi.waitFor(() => expect(emailService.clearData).toHaveBeenCalled());
    expect(storageService.clear).not.toHaveBeenCalled();
    await expect(send('CLEAR_DATA')).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('in progress'),
    });
    await expect(send('GMAIL_SIGN_IN')).resolves.toMatchObject({ success: false });
    completeWrite();
    await expect(signInResult).resolves.toMatchObject({ success: false });
    await expect(cleared).resolves.toMatchObject({ success: true });
    expect(storageService.set).toHaveBeenCalledOnce();
    expect(storageService.clear).toHaveBeenCalledOnce();
  });
});
