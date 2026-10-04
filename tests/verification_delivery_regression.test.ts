import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/storageService', () => ({
  storageService: {
    getSettings: vi.fn(async () => ({ autoFillOTP: true })),
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../src/services/emailServices', () => ({
  emailService: {
    getCurrentEmail: vi.fn(async () => ({
      fullEmail: 'inbox@example.com',
      originUrl: 'https://chat.qwen.ai',
      service: 'driftz',
    })),
    invalidateInboxSession: vi.fn(),
    prewarmConnections: vi.fn(async () => {}),
    checkInbox: vi.fn(async () => []),
    readEmail: vi.fn(),
  },
}));
vi.mock('../src/background/sseManager', () => ({
  sseManager: { reset: vi.fn(), isConnected: vi.fn(() => false) },
}));
vi.mock('../src/services/otpService', () => ({
  otpService: {
    saveLastOTP: vi.fn(async () => ({ saved: true })),
    markAsUsed: vi.fn(async () => {}),
  },
  smartDetectionService: { detect: vi.fn() },
}));
vi.mock('../src/background/contextMenu', () => ({ updateOTPMenuItem: vi.fn(async () => {}) }));
vi.mock('../src/background/notifications', () => ({ notifyNewEmail: vi.fn(async () => {}) }));
vi.mock('../src/utils/messaging', () => ({
  safeSendTabMessage: vi.fn(async () => ({ success: true })),
}));
vi.mock('../src/services/linkService', () => ({
  linkService: { handleDetectedLink: vi.fn(async () => {}), clearHistory: vi.fn() },
}));

import {
  deliverOTP,
  getOTPWaitingTabs,
  resetEmailSession,
  startFastOTPPolling,
  recordEmailReceived,
} from '../src/background/pollingManager';
import { notifyNewEmail } from '../src/background/notifications';
import { selectVerificationAction } from '../src/services/emailDecisionEngine';
import { emailService } from '../src/services/emailServices';
import { senderMatchesSite } from '../src/services/emailServices/privacy';
import { otpService, smartDetectionService } from '../src/services/otpService';
import { linkService } from '../src/services/linkService';
import { dedupService } from '../src/services/dedupService';
import { safeSendTabMessage } from '../src/utils/messaging';
import { diag } from '../src/utils/logger';
import { storageService } from '../src/services/storageService';
import type { EmailDecision } from '../src/services/types/extraction.types';

const tabs = getOTPWaitingTabs() as Map<
  number,
  {
    url: string;
    hostname: string;
    fieldSelectors: string[];
    registeredAt: number;
    priority: number;
    deliveryAttempts: number;
  }
>;
function waitOn(tabId: number, hostname: string) {
  tabs.set(tabId, {
    hostname,
    url: `https://${hostname}/signup`,
    fieldSelectors: ['#otp'],
    registeredAt: Date.now(),
    priority: tabId,
    deliveryAttempts: 0,
  });
}
const pairedDecision: EmailDecision = {
  purpose: 'verification',
  action: 'fill-otp-and-open-link',
  canAutoAct: true,
  confidence: 0.96,
  risk: 'low',
  reasons: [],
  warnings: [],
};

beforeEach(async () => {
  vi.mocked(chrome.alarms.clear).mockResolvedValue(true);
  await resetEmailSession();
  vi.clearAllMocks();
});
afterEach(() => {
  tabs.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('verification action routing', () => {
  it.each([
    'Request timed out after 15000ms',
    'Failed to fetch',
    'HTTP error 503',
    'HTTP error 429',
  ])('records a recoverable inbox failure as a warning and then recovers: %s', async (message) => {
    diag.clear();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(emailService.checkInbox).mockRejectedValueOnce(new Error(message));
    recordEmailReceived();
    await vi.waitFor(() => {
      const end = diag
        .getEntries({ category: 'polling' })
        .find((entry) => entry.action === '◀ END inbox-check');
      expect(end?.level).toBe('warn');
      expect(end?.detail).toContain(message);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    // Move past the existing request spacing and first rate-limit cooldown.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    diag.clear();
    recordEmailReceived();
    await vi.waitFor(() => {
      const end = diag
        .getEntries({ category: 'polling' })
        .find((entry) => entry.action === '◀ END inbox-check');
      expect(end?.level).toBe('info');
      expect(end?.detail).toContain('Success');
      expect(emailService.checkInbox).toHaveBeenCalledTimes(2);
    });
  });

  it.each([
    'Cannot read properties of undefined',
    "Cannot read properties of undefined (reading 'network')",
  ])(
    'keeps unexpected programming failures at error level with the reason visible: %s',
    async (message) => {
      diag.clear();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(emailService.checkInbox).mockRejectedValueOnce(new TypeError(message));
      recordEmailReceived();
      await vi.waitFor(() => {
        const end = diag
          .getEntries({ category: 'polling' })
          .find((entry) => entry.action === '◀ END inbox-check');
        expect(end?.level).toBe('error');
        expect(end?.detail).toContain(message);
      });
      expect(errorSpy).toHaveBeenCalled();
    }
  );

  it('saves the code without typing when the auto-fill preference cannot be read', async () => {
    waitOn(9, 'chat.qwen.ai');
    vi.mocked(storageService.getSettings).mockRejectedValueOnce(
      new Error('Storage temporarily unavailable')
    );
    expect(
      await deliverOTP('953371', 0.98, {
        from: 'Qwen <noreply@qwenlm.ai>',
        subject: 'Your sign-in code',
      })
    ).toBe(false);
    expect(otpService.saveLastOTP).toHaveBeenCalled();
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });

  it('chooses the code while a matching code field is waiting', () => {
    expect(
      selectVerificationAction(pairedDecision, { otpDelivered: false, hasMatchingOTPPage: true })
    ).toBe('fill-otp');
  });
  it('does not also open an alternative link after a successful code fill', () => {
    expect(
      selectVerificationAction(pairedDecision, { otpDelivered: true, hasMatchingOTPPage: false })
    ).toBe('fill-otp');
  });
  it('uses the approved link when there is no matching code page', () => {
    expect(
      selectVerificationAction(pairedDecision, { otpDelivered: false, hasMatchingOTPPage: false })
    ).toBe('open-link');
  });
  it('falls back to the approved link once code delivery has finished without success', () => {
    expect(
      selectVerificationAction(pairedDecision, {
        otpDelivered: false,
        hasMatchingOTPPage: true,
        otpDeliveryComplete: true,
      })
    ).toBe('open-link');
  });
  it('preserves decisions that require review', () => {
    expect(
      selectVerificationAction(
        { ...pairedDecision, action: 'show-review', canAutoAct: false },
        { otpDelivered: false, hasMatchingOTPPage: false }
      )
    ).toBe('show-review');
  });
});

describe('OTP destination matching', () => {
  it('recognizes Claude first-party mail without trusting lookalike domains', async () => {
    waitOn(11, 'claude.ai');
    expect(
      await deliverOTP('641923', 0.98, {
        from: 'Claude <support@mail.anthropic.com>',
        subject: 'Your sign-in code',
      })
    ).toBe(true);
    expect(safeSendTabMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ action: 'AUTO_FILL_OTP' }),
      expect.anything()
    );
    for (const sender of [
      'support@not-anthropic.com',
      'support@anthropic.com.attacker.com',
      'support@notion.com',
    ]) {
      expect(senderMatchesSite(sender, 'https://claude.ai/login')).toBe(false);
    }
  });

  it('keeps processed message history when the inbox session resets', async () => {
    await dedupService.markProcessed('old-message', 'returning-inbox@example.com', true, true);
    await dedupService.markPending('unfinished-message', 'returning-inbox@example.com');
    await resetEmailSession();
    expect(await dedupService.isProcessed('old-message', 'returning-inbox@example.com')).toBe(true);
    expect(await dedupService.isPending('unfinished-message', 'returning-inbox@example.com')).toBe(
      false
    );
    expect(await dedupService.isProcessed('old-message', 'different-inbox@example.com')).toBe(
      false
    );
  });
  it('does not notify, fill, or open a stale full message when its inbox summary looks recent', async () => {
    const email = {
      id: 'old-full-message',
      from: 'notify@notion.com',
      subject: 'Your verification code',
      body: 'Your code is 582914',
      date: Date.now() - 11 * 60_000,
    };
    vi.mocked(emailService.checkInbox).mockResolvedValueOnce([
      { ...email, date: Date.now() },
    ] as never);
    vi.mocked(emailService.readEmail).mockResolvedValueOnce(email as never);
    vi.mocked(smartDetectionService.detect).mockResolvedValueOnce({
      type: 'both',
      code: '582914',
      link: 'https://app.notion.com/verify?token=fixture',
      confidence: 0.99,
      engine: 'intelligent',
      decision: pairedDecision,
    });
    waitOn(9, 'app.notion.com');
    recordEmailReceived();
    await vi.waitFor(async () =>
      expect(await dedupService.getRecord(email.id, 'inbox@example.com')).not.toBeNull()
    );
    expect(notifyNewEmail).not.toHaveBeenCalled();
    expect(otpService.saveLastOTP).not.toHaveBeenCalled();
    expect(linkService.handleDetectedLink).not.toHaveBeenCalled();
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });
  it('does not replay a processed inbox notification after returning to the same account', async () => {
    const email = {
      id: 'already-notified',
      from: 'notify@notion.com',
      subject: 'Your verification code',
      body: 'Your code is 582914',
      date: Date.now(),
    };
    await dedupService.markProcessed(email.id, 'inbox@example.com', true, false);
    await resetEmailSession();
    vi.clearAllMocks();
    vi.mocked(emailService.checkInbox).mockResolvedValueOnce([email] as never);
    recordEmailReceived();
    await vi.waitFor(() => expect(emailService.checkInbox).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(
        diag
          .getEntries({ category: 'polling' })
          .some((entry) => entry.action === '◀ END inbox-check')
      ).toBe(true)
    );
    expect(emailService.readEmail).not.toHaveBeenCalled();
    expect(notifyNewEmail).not.toHaveBeenCalled();
  });

  it('keeps undated verification available for review without automatic notifications or actions', async () => {
    const email = {
      id: 'unknown-message-date',
      from: 'notify@notion.com',
      subject: 'Your verification code',
      body: 'Your code is 582914',
      date: 0,
    };
    vi.mocked(emailService.checkInbox).mockResolvedValueOnce([email] as never);
    vi.mocked(emailService.readEmail).mockResolvedValueOnce(email as never);
    vi.mocked(smartDetectionService.detect).mockResolvedValueOnce({
      type: 'both',
      code: '582914',
      link: 'https://app.notion.com/verify?token=fixture',
      confidence: 0.99,
      engine: 'intelligent',
      decision: pairedDecision,
    });
    waitOn(9, 'app.notion.com');
    recordEmailReceived();
    await vi.waitFor(async () =>
      expect(await dedupService.getRecord(email.id, 'inbox@example.com')).not.toBeNull()
    );
    expect(notifyNewEmail).not.toHaveBeenCalled();
    expect(otpService.saveLastOTP).not.toHaveBeenCalled();
    expect(linkService.handleDetectedLink).not.toHaveBeenCalled();
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });
  it('uses the companion link when inbox polling cannot fill a matching page', async () => {
    const email = {
      id: 'paired-qwen-fallback',
      from: 'Qwen <noreply@qwenlm.ai>',
      subject: 'Your verification code',
      body: 'Your code is 953371 or use the verification link.',
      date: Date.now(),
    };
    const link = 'https://chat.qwen.ai/verify?token=fixture_activation_1234567890';
    vi.mocked(emailService.checkInbox).mockResolvedValueOnce([email] as never);
    vi.mocked(emailService.readEmail).mockResolvedValueOnce(email as never);
    vi.mocked(smartDetectionService.detect).mockResolvedValueOnce({
      type: 'both',
      code: '953371',
      link,
      confidence: 0.99,
      engine: 'intelligent',
      decision: pairedDecision,
    });
    vi.mocked(safeSendTabMessage).mockRejectedValueOnce(new Error('Receiving end does not exist'));
    waitOn(9, 'chat.qwen.ai');
    recordEmailReceived();
    await vi.waitFor(() => expect(notifyNewEmail).toHaveBeenCalled());
    expect(linkService.handleDetectedLink).toHaveBeenCalledWith(
      email,
      link,
      'inbox@example.com',
      '953371'
    );
    expect(otpService.markAsUsed).not.toHaveBeenCalled();
  });
  it('saves a code requiring review without automatically filling a matching page', async () => {
    const email = {
      id: 'review-code',
      from: 'notify@notion.com',
      subject: 'Your Notion signup code',
      body: 'Your code is 582914',
      date: Date.now(),
    };
    vi.mocked(emailService.checkInbox).mockResolvedValueOnce([email] as never);
    vi.mocked(emailService.readEmail).mockResolvedValueOnce(email as never);
    vi.mocked(smartDetectionService.detect).mockResolvedValueOnce({
      type: 'otp',
      code: '582914',
      confidence: 0.3,
      engine: 'intelligent',
      decision: { ...pairedDecision, action: 'show-review', canAutoAct: false },
    });
    waitOn(9, 'app.notion.com');
    recordEmailReceived();
    await vi.waitFor(() => expect(otpService.saveLastOTP).toHaveBeenCalled());
    expect(otpService.saveLastOTP).toHaveBeenCalledWith(
      '582914',
      'email',
      email.from,
      email.subject,
      0.3,
      expect.objectContaining({ emailId: email.id })
    );
    expect(safeSendTabMessage).not.toHaveBeenCalled();
    expect(otpService.markAsUsed).not.toHaveBeenCalled();
    expect(notifyNewEmail).not.toHaveBeenCalled();
  });
  it('does not use a trusted link confidence to fill its uncertain companion code', async () => {
    const email = {
      id: 'weak-companion',
      from: 'notify@notion.com',
      subject: 'Verify email',
      body: '',
      date: Date.now(),
    };
    const link = 'https://app.notion.com/verify?token=fixture_trusted_link_123456789';
    vi.mocked(emailService.checkInbox).mockResolvedValueOnce([email] as never);
    vi.mocked(emailService.readEmail).mockResolvedValueOnce(email as never);
    vi.mocked(smartDetectionService.detect).mockResolvedValueOnce({
      type: 'both',
      code: '582914',
      otpConfidence: 0.3,
      link,
      confidence: 0.99,
      engine: 'intelligent',
      decision: { ...pairedDecision, action: 'open-link', canAutoAct: true },
    });
    waitOn(9, 'app.notion.com');
    recordEmailReceived();
    await vi.waitFor(() => expect(notifyNewEmail).toHaveBeenCalled());
    expect(safeSendTabMessage).not.toHaveBeenCalled();
    expect(otpService.saveLastOTP).toHaveBeenCalledWith(
      '582914',
      'email',
      email.from,
      email.subject,
      0.3,
      expect.objectContaining({ autoFillEligible: false })
    );
    expect(linkService.handleDetectedLink).toHaveBeenCalledWith(
      email,
      link,
      'inbox@example.com',
      null
    );
  });
  it('matches the waiting Notion tab despite a stale Qwen generation origin', async () => {
    waitOn(9, 'app.notion.com');
    expect(
      await deliverOTP('451612', 0.99, {
        from: 'Notion <notify@mail.notion.com>',
        subject: 'Your Notion signup code',
      })
    ).toBe(true);
    expect(safeSendTabMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ action: 'AUTO_FILL_OTP' }),
      expect.anything()
    );
  });
  it('recognizes the official Notion mail domain on its current app domain', () => {
    expect(
      senderMatchesSite('Notion <notify@mail.notion.so>', 'https://app.notion.com/signup')
    ).toBe(true);
    expect(
      senderMatchesSite('notify@mail.notion.so.attacker.com', 'https://app.notion.com/signup')
    ).toBe(false);
    expect(senderMatchesSite('Notion <verify@attacker.com>', 'https://app.notion.com/signup')).toBe(
      false
    );
  });
  it('does not fill the sole waiting tab with mail from a different site', async () => {
    waitOn(10, 'app.notion.com');
    expect(
      await deliverOTP('391827', 0.99, {
        from: 'verify@qwen.ai',
        subject: 'Your Qwen verification code',
      })
    ).toBe(false);
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });
  it('does not fill an unrelated active tab when several sites are waiting', async () => {
    waitOn(1, 'app.notion.com');
    waitOn(2, 'chat.qwen.ai');
    expect(
      await deliverOTP('821639', 0.99, {
        from: 'verify@unrelated.example.net',
        subject: 'Your verification code',
      })
    ).toBe(false);
    expect(safeSendTabMessage).not.toHaveBeenCalled();
  });
  it('delivers an identical numeric code in a new session instead of debouncing it away', async () => {
    waitOn(9, 'app.notion.com');
    await deliverOTP('538216', 0.99, { from: 'notify@notion.com', subject: 'Notion code' });
    await resetEmailSession();
    vi.clearAllMocks();
    waitOn(11, 'app.notion.com');
    expect(
      await deliverOTP('538216', 0.99, { from: 'notify@notion.com', subject: 'Notion code' })
    ).toBe(true);
    expect(safeSendTabMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ action: 'AUTO_FILL_OTP' }),
      expect.anything()
    );
  });
  it('does not move the waiting start time forward when detection refreshes the same field', () => {
    vi.useFakeTimers();
    waitOn(12, 'app.notion.com');
    const startedAt = tabs.get(12)!.registeredAt;
    vi.advanceTimersByTime(1000);
    startFastOTPPolling(12, 'https://app.notion.com/signup', ['#otp']);
    expect(tabs.get(12)!.registeredAt).toBe(startedAt);
  });
});
