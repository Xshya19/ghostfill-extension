import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/storageService', () => {
  const store = new Map<string, unknown>();
  return {
    storageService: {
      get: vi.fn(async (key: string) => store.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      remove: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      getSettings: vi.fn(async () => ({ autoConfirmLinks: true, autoFillOTP: true })),
    },
  };
});
vi.mock('../src/utils/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/core')>()),
  sleep: vi.fn(async () => {}),
}));

import { dedupService } from '../src/services/dedupService';
import { linkService } from '../src/services/linkService';
import { otpService, smartDetectionService } from '../src/services/otpService';
import { storageService } from '../src/services/storageService';
import type { Email } from '../src/types';

let sequence = 0;
const pageUrl = 'https://chat.qwen.ai/auth?mode=register';
const accountId = 'fixture@example.net';

function email(from = 'Qwen <noreply@qwenlm.ai>'): Email {
  return {
    id: `link-${++sequence}`,
    from,
    to: accountId,
    subject: 'Verify your account',
    body: 'Confirm your email using the verification link.',
    htmlBody: '',
    date: Date.now(),
    attachments: [],
    read: false,
  };
}
function link(): string {
  return `https://chat.qwen.ai/verify?token=fixture_activation_${++sequence}_1234567890`;
}

beforeEach(async () => {
  await dedupService.clear();
  await otpService.clearLastOTP();
  linkService.clearHistory();
  vi.clearAllMocks();
  vi.mocked(storageService.getSettings).mockResolvedValue({
    autoConfirmLinks: true,
    autoFillOTP: true,
  } as never);
  await storageService.set('currentEmail', {
    id: 'fixture',
    service: 'driftz',
    fullEmail: accountId,
    domain: 'example.net',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    originUrl: pageUrl,
  });
});
afterEach(() => vi.restoreAllMocks());

describe('verification link navigation', () => {
  it('does not promote a weak companion code in the email-detection entry point', async () => {
    const input = email();
    const url = link();
    vi.spyOn(smartDetectionService, 'detect').mockResolvedValueOnce({
      type: 'both', code: '90375', link: url, confidence: 0.99, otpConfidence: 0.3,
      decision: { purpose: 'verification', action: 'open-link', canAutoAct: true, confidence: 0.99, risk: 'low', reasons: [], warnings: [] },
    } as never);
    await linkService.handleNewEmail(input, accountId);
    await vi.waitFor(() => expect(linkService.getHistory().at(-1)?.status).toBe('activated'));
    expect(await otpService.getLastOTP()).toBeNull();
  });

  it.each([['detect', true], ['pre-detected', true], ['detect', false], ['pre-detected', false]] as const)('opens a Claude magic link through %s (HTML=%s) without inventing an OTP', async (path, formatted) => {
    const account = await storageService.get('currentEmail');
    await storageService.set('currentEmail', { ...account, originUrl: 'https://claude.ai/login' } as never);
    const url = `https://claude.ai/magic-link#fixture_auth_${path}_${++sequence}_582914_123456789`;
    const input = {
      ...email('Claude <support@mail.anthropic.com>'),
      subject: 'Sign in to Claude.ai',
      body: `Click the button below to finish signing in. This link expires in 10 minutes.\nSign in [${url}]\nAnthropic, PBC, 548 Market St, PMB 90375, San Francisco CA 94104`,
      htmlBody: formatted ? `<h1>Sign in to Claude.ai</h1><p>Click the button below to finish signing in. This link expires in 10 minutes.</p><a href="${url}">Sign in</a><footer>548 Market St, PMB 90375, San Francisco CA 94104</footer>` : '',
    };
    if (path === 'detect') {
      await linkService.handleNewEmail(input, accountId);
    } else {
      await linkService.handleDetectedLink(input, url, accountId);
    }
    await vi.waitFor(() => expect(linkService.getHistory().at(-1)?.status).toBe('activated'));
    expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url, active: true });
    expect(await otpService.getLastOTP()).toBeNull();
  });

  it.each([true, false])('keeps a tokenless action route for review when its anchor is only Help (HTML=%s)', async (formatted) => {
    const url = 'https://chat.qwen.ai/magic-link#fixture_auth_token_123456789';
    await linkService.handleDetectedLink({ ...email(), body: `Help [${url}]`, htmlBody: formatted ? `<a href="${url}">Help</a>` : '' }, url, accountId);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('allows the same message to be retried after all tab-creation attempts fail', async () => {
    const input = email();
    const url = link();
    vi.mocked(chrome.tabs.create)
      .mockRejectedValueOnce(new Error('Temporary tab creation failure'))
      .mockRejectedValueOnce(new Error('Temporary tab creation failure'))
      .mockRejectedValueOnce(new Error('Temporary tab creation failure'));
    await linkService.handleDetectedLink(input, url, accountId);
    await vi.waitFor(() => expect(linkService.getHistory().at(-1)?.status).toBe('failed'));
    await linkService.handleDetectedLink(input, url, accountId);
    await vi.waitFor(() => expect(linkService.getHistory().at(-1)?.status).toBe('activated'));
    expect(chrome.tabs.create).toHaveBeenCalledTimes(4);
  });

  it('opens an approved link in one visible new tab and deduplicates repeats', async () => {
    const input = email();
    const url = link();
    await linkService.handleDetectedLink(input, url, accountId);
    await vi.waitFor(() => expect(linkService.getHistory().at(-1)?.status).toBe('activated'));
    expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url, active: true });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    await linkService.handleDetectedLink(input, url, accountId);
    await linkService.handleDetectedLink(email(), url, accountId);
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('honors the auto-confirm setting before creating a new tab', async () => {
    vi.mocked(storageService.getSettings).mockResolvedValueOnce({
      autoConfirmLinks: false,
      autoFillOTP: true,
    } as never);
    await linkService.handleDetectedLink(email(), link(), accountId);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('does not treat a Qwen display name on a shared sender domain as authorization', async () => {
    await linkService.handleDetectedLink(email('Qwen <qwen@aliyun.com>'), link(), accountId);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('preserves the sender and message when an activation link saves a companion code', async () => {
    vi.mocked(storageService.getSettings).mockResolvedValue({
      autoConfirmLinks: true,
      autoFillOTP: false,
    } as never);
    const input = email();
    await linkService.handleDetectedLink(input, link(), accountId, '953371');
    await vi.waitFor(() => expect(linkService.getHistory().at(-1)?.status).toBe('activated'));
    expect(await otpService.getLastOTP()).toMatchObject({
      code: '953371',
      emailFrom: input.from,
      emailSubject: input.subject,
      emailId: input.id,
      emailDate: input.date,
    });
  });

  it('keeps a newer saved code when an older companion link is opened', async () => {
    vi.mocked(storageService.getSettings).mockResolvedValue({
      autoConfirmLinks: true,
      autoFillOTP: false,
    } as never);
    const input = { ...email(), date: Date.now() - 10_000 };
    await otpService.saveLastOTP('582914', 'email', 'verify@notion.com', 'Newer code', 1, {
      emailId: 'newer-message',
      emailDate: Date.now(),
    });
    await linkService.handleDetectedLink(input, link(), accountId, '953371');
    await vi.waitFor(() => expect(linkService.getHistory().at(-1)?.status).toBe('activated'));
    expect(await otpService.getLastOTP()).toMatchObject({
      code: '582914',
      emailFrom: 'verify@notion.com',
      emailId: 'newer-message',
    });
  });
});
