import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/storageService', () => ({
  storageService: {
    get: vi.fn(),
    getSettings: vi.fn(async () => ({ autoConfirmLinks: true, autoFillOTP: true })),
  },
}));
vi.mock('../src/services/dedupService', () => ({
  dedupService: { getRecord: vi.fn(async () => null), markProcessed: vi.fn(async () => {}) },
}));
vi.mock('../src/services/otpService', () => ({
  otpService: { saveLastOTP: vi.fn(async () => {}) }, smartDetectionService: {},
}));

import { linkService } from '../src/services/linkService';
import { storageService } from '../src/services/storageService';
import type { Email, EmailAccount } from '../src/types';

const account = { fullEmail: 'fixture@example.net', originUrl: 'https://chat.qwen.ai' } as EmailAccount;
let sequence = 0;
function email(): Email {
  return { id: ++sequence, date: Date.now(), from: 'verify@qwenlm.ai', subject: 'Verify account',
    to: account.fullEmail, body: '', attachments: [], read: false };
}
function link(): string {
  return `https://chat.qwen.ai/verify?token=fixture_activation_${++sequence}_1234567890`;
}

beforeEach(() => {
  linkService.clearData();
  vi.clearAllMocks();
  vi.mocked(storageService.get).mockResolvedValue(account);
});

describe('clearing active link work', () => {
  it('drops a pre-detected link still awaiting its account check', async () => {
    let resolveAccount: ((value: EmailAccount) => void) | undefined;
    vi.mocked(storageService.get).mockImplementationOnce(() => new Promise((resolve) => {
      resolveAccount = resolve;
    }));
    const pending = linkService.handleDetectedLink(email(), link(), account.fullEmail);
    await vi.waitFor(() => expect(resolveAccount).toBeTypeOf('function'));
    linkService.clearData();
    resolveAccount!(account);
    await pending;
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(linkService.getQueueDepth()).toBe(0);
  });

  it('drops queued links and prevents a pending activation from delivering an old code', async () => {
    let resolveTab: ((tab: chrome.tabs.Tab) => void) | undefined;
    vi.mocked(chrome.tabs.create).mockImplementationOnce(() => new Promise((resolve) => {
      resolveTab = resolve;
    }));
    await linkService.handleDetectedLink(email(), link(), account.fullEmail, '482913');
    await vi.waitFor(() => expect(resolveTab).toBeTypeOf('function'));
    await linkService.handleDetectedLink(email(), link(), account.fullEmail);
    expect(linkService.getQueueDepth()).toBe(1);
    linkService.clearData();
    resolveTab!({ id: 89 } as chrome.tabs.Tab);
    await vi.waitFor(() => expect((linkService as unknown as { draining: boolean }).draining).toBe(false));
    expect(linkService.getQueueDepth()).toBe(0);
    expect(linkService.getHistory()).toEqual([]);
    expect(chrome.tabs.create).toHaveBeenCalledOnce();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
