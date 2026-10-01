import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/background/initGuard', () => ({ ensureInitialized: vi.fn(async () => {}) }));
vi.mock('../src/background/serviceWorker', () => ({ getBootState: () => 'ready' }));
vi.mock('../src/background/contextMenu', () => ({ updateOTPMenuItem: vi.fn(async () => {}) }));
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
      getSettings: vi.fn(async () => ({ autoFillOTP: true, autoConfirmLinks: true })),
    },
  };
});
vi.mock('../src/services/emailServices', () => ({
  emailService: {
    getCurrentEmail: vi.fn(async () => ({ fullEmail: 'inbox@example.com', service: 'driftz' })),
    invalidateInboxSession: vi.fn(),
    prewarmConnections: vi.fn(async () => {}),
    checkInbox: vi.fn(async () => []),
    readEmail: vi.fn(),
  },
}));
vi.mock('../src/services/linkService', () => ({
  linkService: { handleDetectedLink: vi.fn(async () => {}), clearHistory: vi.fn() },
}));
vi.mock('../src/utils/messaging', () => ({
  safeSendTabMessage: vi.fn(async () => ({ success: true })),
}));
vi.mock('../src/background/sseManager', () => ({
  sseManager: { reset: vi.fn(), isConnected: vi.fn(() => false) },
}));

import { setupMessageHandler } from '../src/background/messageHandler';
import { destroyPollingManager, getOTPWaitingTabs, resetEmailSession } from '../src/background/pollingManager';
import { emailService } from '../src/services/emailServices';
import { linkService } from '../src/services/linkService';
import { otpService } from '../src/services/otpService';
import { safeSendTabMessage } from '../src/utils/messaging';
import { AutoFiller } from '../src/content/autoFiller';
import type { ExtensionMessage, ExtensionResponse } from '../src/types';

let listener: (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  respond: (response: ExtensionResponse) => void
) => boolean | void;
let sequence = 0;
const link =
  'https://app.notion.com/loginwithemail?state=v02%3Atemp_password%3Afixture_state_123456789&password=451612&isSignup=true';
const text = `Sign up for Notion. Enter the code on the sign up page or click the magic link.\n\n451612\n\n${link}`;
const html = `<h1>Sign up for Notion</h1><p>Enter the code on the sign up page or click the magic link.</p><p>451612</p><a href="${link}">Sign in with Magic Link</a>`;
const popupSender = {
  id: chrome.runtime.id,
  url: 'chrome-extension://test-extension-id/popup.html',
};

function send(message: ExtensionMessage, sender: chrome.runtime.MessageSender = popupSender) {
  return new Promise<ExtensionResponse>((resolve) => listener(message, sender, resolve));
}
function message(overrides: Record<string, unknown> = {}): ExtensionMessage {
  return {
    action: 'EXTRACT_OTP',
    payload: {
      emailId: `notion-${++sequence}`,
      subject: 'Your Notion signup code',
      source: 'popup-viewer',
      emailFrom: 'Notion <notify@mail.notion.so>',
      emailDate: Date.now(),
      textBody: text,
      htmlBody: html,
      ...overrides,
    },
  } as ExtensionMessage;
}
function waitOnNotion() {
  const tabs = getOTPWaitingTabs() as Map<number, unknown>;
  tabs.set(9, {
    url: 'https://app.notion.com/signup',
    hostname: 'app.notion.com',
    fieldSelectors: ['#otp'],
    registeredAt: Date.now(),
    priority: 1,
    deliveryAttempts: 0,
  });
}

beforeAll(() => {
  setupMessageHandler();
  listener = vi
    .mocked(chrome.runtime.onMessage.addListener)
    .mock.calls.at(-1)![0] as typeof listener;
});
beforeEach(async () => {
  vi.mocked(chrome.alarms.clear).mockResolvedValue(true);
  await resetEmailSession();
  await otpService.clearLastOTP();
  // Each case owns its save budget; production rate limiting is checked separately.
  (otpService as unknown as { rateLimitTimestamps: number[] }).rateLimitTimestamps = [];
  vi.clearAllMocks();
});
afterEach(() => {
  destroyPollingManager();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('message-to-page verification flow', () => {
  it('preserves the extracted button text when the popup hands off a magic link', async () => {
    const url = 'https://claude.ai/magic-link#fixture_auth_token_123456789';
    const response = await send(message({
      subject: 'Sign in to Claude.ai',
      emailFrom: 'Claude <support@mail.anthropic.com>',
      textBody: `Click the button below to finish signing in. Sign in [${url}]`,
      htmlBody: `<h1>Sign in to Claude.ai</h1><a href="${url}">Sign in</a>`,
    }));
    expect(response).toMatchObject({ success: true, link: url });
    expect(linkService.handleDetectedLink).toHaveBeenCalledWith(expect.anything(), url, expect.anything(), null, 'Sign in');
  });

  it('delivers a fresh saved code when its input mounts after the email arrived', async () => {
    await otpService.saveLastOTP('641923', 'email', 'support@mail.anthropic.com', 'Your sign-in code', 0.98, { emailId: 'late-claude-field', emailDate: Date.now(), autoFillEligible: true });
    const pageSender = { id: chrome.runtime.id, url: 'https://claude.ai/login', tab: { id: 11, url: 'https://claude.ai/login' }, frameId: 0 };
    const response = await send({ action: 'OTP_PAGE_DETECTED', payload: { url: pageSender.url, fieldCount: 1, fieldSelectors: ['#otp'], confidence: 0.95, verdict: 'otp-page' } } as ExtensionMessage, pageSender);
    expect(response.success).toBe(true);
    expect(safeSendTabMessage).toHaveBeenCalledWith(11, expect.objectContaining({ action: 'AUTO_FILL_OTP', payload: expect.objectContaining({ otp: '641923' }) }), expect.anything());
  });

  it.each([
    ['review', 0.98, false, 0, false],
    ['weak', 0.4, true, 0, false],
    ['old', 0.98, true, 60_001, false],
    ['used', 0.98, true, 0, true],
  ] as const)('does not automatically resume a %s code', async (_kind, confidence, eligible, age, used) => {
    await otpService.saveLastOTP('628419', 'email', 'support@mail.anthropic.com', 'Your sign-in code', confidence, { autoFillEligible: eligible });
    if (used) { await otpService.markAsUsed(); }
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + age);
    const pageSender = { id: chrome.runtime.id, url: 'https://claude.ai/login', tab: { id: 11, url: 'https://claude.ai/login' }, frameId: 0 };
    const response = await send({ action: 'OTP_PAGE_DETECTED', payload: { url: pageSender.url, fieldCount: 1, fieldSelectors: ['#otp'], confidence: 0.95, verdict: 'otp-page' } } as ExtensionMessage, pageSender);
    expect(response.success).toBe(true);
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });

  it('offers a fresh saved code on a page that registered a moment later', async () => {
    await otpService.saveLastOTP('391827', 'email', 'accounts@notion.com', 'Your sign-in code', 0.98);
    waitOnNotion();
    const response = await send({ action: 'GET_LAST_OTP' } as ExtensionMessage, { id: chrome.runtime.id, url: 'https://app.notion.com/signup', tab: { id: 9, url: 'https://app.notion.com/signup' } });
    expect(response).toMatchObject({ success: true, lastOTP: { code: '391827' } });
  });
  it('does not navigate again when a message whose code was already filled is reopened', async () => {
    const input = message();
    waitOnNotion();
    await send(input);
    vi.clearAllMocks();
    await send({
      ...input,
      payload: { ...input.payload, saveToLastOTP: true },
    } as ExtensionMessage);
    expect(linkService.handleDetectedLink).not.toHaveBeenCalled();
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });
  it('does not let completion of an older page fill consume a newer inbox code', async () => {
    await otpService.saveLastOTP('391827', 'email', 'verify@notion.com');
    const response = await send({
      action: 'MARK_OTP_USED',
      payload: { code: '451612' },
    } as ExtensionMessage);
    expect(response.success).toBe(true);
    expect((await otpService.getLastOTP())?.code).toBe('391827');
  });
  it('fills the matching page and returns the companion link without automatically opening it', async () => {
    waitOnNotion();
    const response = await send(message());
    expect(response).toMatchObject({ success: true, otp: '451612', link });
    expect(safeSendTabMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ action: 'AUTO_FILL_OTP' }),
      expect.anything()
    );
    expect(linkService.handleDetectedLink).not.toHaveBeenCalled();
  });
  it('can use the approved companion link when there is no waiting code page', async () => {
    const response = await send(message());
    expect(response).toMatchObject({ success: true, otp: '451612', link });
    expect(linkService.handleDetectedLink).toHaveBeenCalledTimes(1);
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });
  it('uses the approved companion link after a matching page refuses the code', async () => {
    waitOnNotion();
    vi.mocked(safeSendTabMessage).mockRejectedValueOnce(new Error('Receiving end does not exist'));
    const response = await send(message());
    expect(response).toMatchObject({ success: true, otp: '451612', link });
    expect(safeSendTabMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ action: 'AUTO_FILL_OTP' }),
      expect.anything()
    );
    expect(linkService.handleDetectedLink).toHaveBeenCalledTimes(1);
    expect((await otpService.getLastOTP())?.code).toBe('451612');
  });
  it('delivers and offers Qwen codes sent from its older first-party domain', async () => {
    const pageUrl = 'https://chat.qwen.ai/auth?mode=register';
    document.body.innerHTML =
      '<h1>Check your inbox</h1><form><div>' +
      Array.from(
        { length: 6 },
        (_, index) =>
          `<input id="digit-${index}" type="text" inputmode="numeric" maxlength="1" aria-label="Verification code digit ${index + 1}">`
      ).join('') +
      '</div><button type="button" disabled>Continue</button></form>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 40)
    );
    const fields = [...document.querySelectorAll<HTMLInputElement>('input')];
    const events: string[] = [];
    fields.forEach((field) =>
      field.addEventListener('input', () => {
        events.push(field.value);
        document.querySelector('button')!.disabled = !fields.every(
          (input) => input.value.length === 1
        );
      })
    );
    const filler = new AutoFiller();
    vi.mocked(safeSendTabMessage).mockImplementationOnce(async (_tabId, input) => {
      const request = input as { payload: { otp: string; fieldSelectors: string[] } };
      return { success: await filler.fillOTP(request.payload.otp, request.payload.fieldSelectors) };
    });
    (getOTPWaitingTabs() as Map<number, unknown>).set(9, {
      url: pageUrl,
      hostname: 'chat.qwen.ai',
      fieldSelectors: Array.from({ length: 6 }, (_, index) => `#digit-${index}`),
      registeredAt: Date.now(),
      priority: 1,
      deliveryAttempts: 0,
    });
    try {
      const response = await send(
        message({
          subject: 'Your Qwen sign-in code',
          emailFrom: 'Qwen <noreply@qwenlm.ai>',
          textBody:
            'Your sign-in code\nUse the verification code below to sign in to your account.\n\n953371\nThis code is valid for 5 minutes.',
          htmlBody:
            '<p>Use the verification code below to sign in to your account.</p><p>953371</p>',
        })
      );
      expect(response).toMatchObject({ success: true, otp: '953371' });
      await vi.waitFor(() =>
        expect(safeSendTabMessage).toHaveBeenCalledWith(
          9,
          expect.objectContaining({
            action: 'AUTO_FILL_OTP',
            payload: expect.objectContaining({ otp: '953371' }),
          }),
          expect.anything()
        )
      );
      const saved = await send(
        { action: 'GET_LAST_OTP' },
        {
          id: chrome.runtime.id,
          url: pageUrl,
          tab: { id: 9, url: pageUrl } as chrome.tabs.Tab,
        }
      );
      expect(saved).toMatchObject({ success: true, lastOTP: { code: '953371' } });
      await vi.waitFor(() => expect(fields.map((field) => field.value).join('')).toBe('953371'));
      expect(events).toEqual(['9', '5', '3', '3', '7', '1']);
      expect(document.querySelector('button')!.disabled).toBe(false);
      expect(linkService.handleDetectedLink).not.toHaveBeenCalled();
    } finally {
      filler.destroy();
    }
  });
  it('uses the fetched sender when a popup snippet did not provide one', async () => {
    waitOnNotion();
    vi.mocked(emailService.readEmail).mockResolvedValue({
      id: 'fetched-message',
      subject: 'Your Notion signup code',
      from: 'Notion <notify@mail.notion.so>',
      body: text,
      htmlBody: html,
      date: Date.now(),
    } as never);
    const response = await send(message({ emailFrom: '', textBody: 'Preview', htmlBody: '' }));
    expect(response).toMatchObject({ success: true, otp: '451612' });
    expect(safeSendTabMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ action: 'AUTO_FILL_OTP' }),
      expect.anything()
    );
    expect(linkService.handleDetectedLink).not.toHaveBeenCalled();
  });
  it("does not offer another site's saved code to a page button", async () => {
    await otpService.saveLastOTP('391827', 'email', 'verify@qwen.ai');
    const response = await send(
      { action: 'GET_LAST_OTP' },
      {
        id: chrome.runtime.id,
        url: 'https://app.notion.com/signup',
        tab: { id: 9, url: 'https://app.notion.com/signup' } as chrome.tabs.Tab,
      }
    );
    expect(response.success).toBe(false);
    expect(response).not.toHaveProperty('lastOTP');
  });
});
