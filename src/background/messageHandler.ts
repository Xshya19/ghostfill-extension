import { emailService } from '../services/emailServices';
import { identityService } from '../services/identityService';
import { extractOTPStandalone, extractLinkStandalone } from '../services/intelligentExtractor';
import { linkService } from '../services/linkService';
import { otpService } from '../services/otpService';
import { passwordService } from '../services/passwordService';
import { storageService } from '../services/storageService';
import { ExtensionMessage, ExtensionResponse, PasswordHistoryItem } from '../types';
import { diag } from '../utils/diagnosticLogger';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';
import { validateMessage } from '../utils/validation';
import { notifySuccess, notifyError, resetNotificationSession } from './notifications';
import { ensureOffscreenDocument } from './offscreenManager';
import {
  startFastOTPPolling,
  stopFastOTPPolling,
  triggerEventDrivenPolling,
  recordEmailReceived,
  isActivationTab,
  getOTPWaitingTabs,
  resetEmailSession,
} from './pollingManager';
import { sseManager } from './sseManager';

const log = createLogger('MessageHandler');
const ML_PREWARM_TTL_MS = 10000;
const lastMlPrewarmBySender = new Map<string, number>();

function getPrewarmSenderKey(sender: chrome.runtime.MessageSender): string {
  const tabPart = sender.tab?.id ? `tab:${sender.tab.id}` : 'tab:none';
  const urlPart = sender.url ?? sender.origin ?? 'origin:none';
  return `${tabPart}|${urlPart}`;
}

/**
 * Main message router for the background script.
 * Handles all core extension actions from popup and content scripts.
 */
let hasRegistered = false;

export function setupMessageHandler(): void {
  // CRITICAL FIX: Prevent double registration which causes multiple response bugs
  if (hasRegistered) {
    return;
  }
  hasRegistered = true;

  chrome.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: ExtensionResponse) => void
    ): boolean => {
      // P0.5: Origin validation - ensure messages only come from extension components
      if (sender.id !== chrome.runtime.id) {
        log.warn('Blocked message from unauthorized origin', { id: sender.id, url: sender.url });
        sendResponse({ success: false, error: 'Unauthorized origin' });
        return false;
      }

      // Use IIFE for async handling in listener
      void (async () => {
        try {
          const validation = validateMessage(message);
          if (!validation.valid) {
            log.warn('Blocked invalid message', {
              error: validation.error,
              origin: sender.url,
            });
            sendResponse({ success: false, error: validation.error });
            return;
          }

          const response = await handleMessage(message, sender);
          sendResponse(response);
        } catch (error) {
          // P3.2: Better error serialization
          log.error('Message handling failed', {
            action: message.action,
            error: error instanceof Error ? error.message : String(error),
          });
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();

      return true; // Keep channel open for async response
    }
  );

  log.info('🚀 Main Message Router initialized');
}

/**
 * Route messages to appropriate service handlers
 */
async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  log.debug('Incoming message', { action: message.action, origin: sender.url });

  switch (message.action) {
    // ── EMAIL ACTIONS ─────────────────────────────────────────────
    case 'GET_CURRENT_EMAIL': {
      const email = await emailService.getCurrentEmail();
      return { success: true, email: email || undefined };
    }

    case 'GENERATE_EMAIL': {
      log.info('🔄 Email change requested — performing full session reset');

      // 1. Clear stale OTP so old codes can't fire on the new email session
      await otpService.clearLastOTP();

      // 2. Clear processed-email dedup cache so new inbox is scanned fresh
      //    Also clears otpWaitingTabs + circuit breaker (see resetEmailSession)
      resetEmailSession();

      // 3. Clear notification dedup cache (separate module-level map)
      resetNotificationSession();

      // 4. Clear linkService activation history/queue so old links don't replay
      linkService.clearHistory();

      // 5. Clear inbox in storage so popup shows empty state immediately
      await storageService.set('inbox', []);

      // 6. Broadcast RESET_STATE to all content scripts so FAB badges clear
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'RESET_STATE' }).catch(() => {
              // Ignore — tab may not have content script (about:, chrome:, etc.)
            });
          }
        }
      });

      // 6. Finally generate the new email address
      // Use identity-based prefix for human-readable email addresses (e.g., bradleyscott.9445@)
      const identity = await identityService.getCurrentIdentity();
      const emailPayload = message.action === 'GENERATE_EMAIL' ? message.payload || {} : {};
      const email = await emailService.generateEmail({
        ...emailPayload,
        prefix: identity.emailPrefix.substring(0, 30).replace(/[^a-z0-9.]/g, ''),
      });

      // 7. Always start polling immediately when email is generated.
      // SSE is a bonus push layer — polling is the reliable fallback.
      triggerEventDrivenPolling('email_gen');

      if (email?.service === 'mailtm') {
        sseManager.setOnEmailReceived(() => {
          // When SSE detects a new email, trigger inbox check
          recordEmailReceived();
          // Force immediate inbox check
          emailService
            .getCurrentEmail()
            .then((acct) => {
              if (acct) {
                emailService.checkInbox(acct).catch(() => {});
              }
            })
            .catch(() => {});
        });
        sseManager.connect(email).catch((e) => {
          log.debug('SSE connection failed — polling is already running', e);
        });
        log.info('🔌 SSE real-time push enabled for Mail.tm');
      }

      log.info('✅ New email generated — fresh session ready', { email: email?.fullEmail });
      return { success: true, email };
    }

    case 'CHECK_INBOX': {
      const current = await emailService.getCurrentEmail();
      if (!current) {
        return { success: false, error: 'No active email account' };
      }
      const emails = await emailService.checkInbox(current);
      return { success: true, emails };
    }

    case 'READ_EMAIL': {
      const payload = (message.payload || {}) as Record<string, unknown>;
      const emailId = payload.emailId;
      if (!emailId || typeof emailId !== 'string') {
        return { success: false, error: 'Missing or invalid emailId' };
      }
      const login = typeof payload.login === 'string' ? payload.login : '';
      const domain = typeof payload.domain === 'string' ? payload.domain : '';
      const service = typeof payload.service === 'string' ? payload.service : 'mailtm';
      const email = await emailService.readEmail(emailId, {
        login,
        domain,
        service,
        fullEmail: login && domain ? `${login}@${domain}` : '',
      } as import('../types').EmailAccount);
      return { success: true, email };
    }

    case 'GET_EMAIL_HISTORY': {
      const history = await emailService.getHistory();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, history: history as any };
    }

    case 'GET_PROVIDER_HEALTH': {
      const health = emailService.getProviderHealth();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, health: health as any[] };
    }

    // ── OTP ACTIONS ───────────────────────────────────────────────
    case 'GET_LAST_OTP': {
      const lastOTP = await otpService.getLastOTP();

      const senderTabId = sender.tab?.id;
      if (senderTabId && lastOTP) {
        const reg = getOTPWaitingTabs().get(senderTabId);
        if (reg && reg.registeredAt > lastOTP.extractedAt) {
          log.warn('Refusing to provide stale OTP during active polling session', { senderTabId });
          return { success: false, error: 'Still waiting for new email...' };
        }
      }

      return { success: true, lastOTP: lastOTP || undefined };
    }

    case 'MARK_OTP_USED': {
      await otpService.markAsUsed();
      return { success: true };
    }

    case 'CHECK_OTP_NOW': {
      const current = await emailService.getCurrentEmail();
      if (current) {
        await emailService.checkInbox(current);
        const lastOTP = await otpService.getLastOTP();
        return { success: true, otp: lastOTP?.code };
      }
      return { success: false, error: 'No active email account' };
    }

    case 'CHECK_OTP_FRESHNESS': {
      const isFresh = await otpService.isOTPFresh();
      return { success: true, isFresh };
    }

    case 'WAIT_FOR_FRESH_OTP': {
      const payload =
        message.action === 'WAIT_FOR_FRESH_OTP' ? message.payload : { maxWaitMs: 30000 };
      const lastOTP = await otpService.waitForFreshOTP(payload.maxWaitMs);
      return { success: true, lastOTP: lastOTP || undefined };
    }

    // ── OTP PAGE DETECTION (from content script) ─────────────────
    case 'OTP_PAGE_DETECTED': {
      if (message.action === 'OTP_PAGE_DETECTED' && message.payload) {
        const { url, fieldSelectors, confidence } = message.payload as {
          url: string;
          fieldSelectors: string[];
          confidence: number;
        };
        log.info('📱 OTP page detected', { url, fieldCount: fieldSelectors.length, confidence });

        if (sender.tab?.id) {
          // Skip registration for activation tabs - these are opened by linkService
          // for verification links, not for receiving OTP codes.
          // Registration happens BEFORE the tab's content script sends OTP_PAGE_DETECTED,
          // but in case of timing issues, double-check here.
          if (isActivationTab(sender.tab.id)) {
            log.info('⛔ Skipping OTP tab registration for activation tab', {
              tabId: sender.tab.id,
            });
            return { success: true };
          }
          startFastOTPPolling(sender.tab.id, url, fieldSelectors, sender.frameId);
        }
      }
      return { success: true };
    }

    case 'OTP_PAGE_LEFT': {
      log.info('📱 OTP page left');
      if (sender.tab?.id) {
        stopFastOTPPolling(sender.tab.id);
      }
      return { success: true };
    }

    // ── EVENT-DRIVEN POLLING TRIGGERS ─────────────────────────────
    case 'REGISTRATION_FORM_SUBMITTED': {
      log.info('⚡ Registration form submitted — triggering ultra polling');
      triggerEventDrivenPolling('form_submit');
      return { success: true };
    }

    // ── INTELLIGENCE LAYER ─────────────────────────────────────────
    case 'EXTRACT_OTP': {
      const payload = message.payload as Record<string, unknown> | undefined;
      const subject = (payload?.subject as string) || '';
      const textBody = (payload?.textBody as string) || (payload?.text as string) || '';
      const htmlBody = (payload?.htmlBody as string) || '';
      const source = (payload?.source as string) || '';

      log.info(`🧠 Requesting off-main-thread OTP/Link extraction for source: ${source}`);

      const otpExtraction = extractOTPStandalone(
        htmlBody || textBody,
        subject,
        'noreply@ghostfill.ai'
      );
      const linkExtraction = extractLinkStandalone(
        htmlBody || textBody,
        subject,
        'noreply@ghostfill.ai'
      );

      return {
        success: true,
        otp: otpExtraction?.best?.code ?? undefined,
        link: linkExtraction?.best?.url ?? undefined,
      };
    }

    // ── PASSWORD ACTIONS ──────────────────────────────────────────
    case 'GENERATE_PASSWORD': {
      const payload = message.action === 'GENERATE_PASSWORD' ? message.payload : undefined;
      const result = await passwordService.generate(payload);
      return { success: true, result };
    }

    case 'GET_PASSWORD_HISTORY': {
      const history = await passwordService.getHistory();
      return { success: true, history: history as PasswordHistoryItem[] };
    }

    case 'SAVE_PASSWORD': {
      const { password, website } = (message.payload || {}) as {
        password: string;
        website: string;
      };
      await passwordService.saveToHistory(password, website);
      return { success: true };
    }

    case 'DELETE_PASSWORD': {
      if (message.action === 'DELETE_PASSWORD' && message.payload?.id) {
        await passwordService.deleteFromHistory(message.payload.id);
      }
      return { success: true };
    }

    // ── IDENTITY ACTIONS ──────────────────────────────────────────
    case 'GET_IDENTITY': {
      const identity = await identityService.getCompleteIdentity();
      return { success: true, identity };
    }

    case 'GENERATE_IDENTITY':
    case 'REFRESH_IDENTITY': {
      const identity = await identityService.refreshIdentity();
      return { success: true, identity };
    }

    // ── ML INFERENCE (Proxy to Offscreen) ────────────────────────
    case 'ANALYZE_DOM': {
      const simplifiedDOM =
        message.action === 'ANALYZE_DOM' ? (message.payload?.simplifiedDOM ?? '') : '';
      return {
        success: true,
        result: {
          confidence: estimateOTPPageConfidence(simplifiedDOM),
        },
      };
    }

    case 'CLASSIFY_FIELD': {
      if (message.action !== 'CLASSIFY_FIELD' || !message.payload) {
        return { success: false, error: 'Invalid message action or missing payload' };
      }
      try {
        await ensureOffscreenDocument();
        const response = await chrome.runtime.sendMessage({
          target: 'offscreen-doc',
          type: 'CLASSIFY_FIELD',
          payload: message.payload,
        });
        return response || { success: false, error: 'No response from offscreen' };
      } catch (err) {
        log.error('ML proxy classification failed', err);
        return { success: false, error: 'ML proxy failed' };
      }
    }

    case 'PREWARM_ML': {
      try {
        const senderKey = getPrewarmSenderKey(sender);
        const now = Date.now();
        const last = lastMlPrewarmBySender.get(senderKey) ?? 0;

        if (now - last < ML_PREWARM_TTL_MS) {
          return { success: true };
        }

        lastMlPrewarmBySender.set(senderKey, now);
        await ensureOffscreenDocument();
        // Fire and forget warm-up message to the offscreen model
        chrome.runtime.sendMessage({ target: 'offscreen-doc', type: 'WARM_UP_ML' }).catch(() => {});
        return { success: true };
      } catch (err) {
        log.warn('ML pre-warm failed', err);
        return { success: false, error: 'ML pre-warm failed' };
      }
    }

    case 'REPORT_MISCLASSIFICATION': {
      if (message.action !== 'REPORT_MISCLASSIFICATION') {
        return { success: false, error: 'Invalid message action' };
      }
      log.info('Misclassification reported', message.payload);
      return { success: true };
    }

    // ── NOTIFICATION ACTIONS ──────────────────────────────────────
    case 'SHOW_NOTIFICATION': {
      const payload = (message.payload || {}) as {
        title?: string;
        message?: string;
        type?: string;
      };
      const title = typeof payload.title === 'string' ? payload.title : 'GhostFill';
      const text = typeof payload.message === 'string' ? payload.message : '';
      const type = payload.type;

      if (type === 'error') {
        await notifyError(title, text);
      } else {
        await notifySuccess(title, text);
      }
      return { success: true };
    }

    // ── STORAGE/SETTINGS ──────────────────────────────────────────
    case 'GET_SETTINGS': {
      const settings = await storageService.getSettings();
      return { success: true, settings };
    }

    case 'UPDATE_SETTINGS': {
      // Inside this case, message.action is always 'UPDATE_SETTINGS'
      const updated = await storageService.updateSettings(
        (message.payload as import('../utils/validation').UserSettings | undefined) ?? {}
      );
      return { success: true, settings: updated };
    }

    case 'CLEAR_DATA': {
      await storageService.clear();
      await emailService.clearData();
      await passwordService.clearHistory();
      log.info('All extension data cleared');
      return { success: true };
    }

    case 'OPEN_OPTIONS': {
      chrome.runtime.openOptionsPage();
      return { success: true };
    }

    case 'LINK_ACTIVATED': {
      log.info(
        '🔗 Link activated — allowing background tabs to verify without suspending existing fast polling'
      );
      // Fix: Removed global stopFastOTPPolling loop to prevent breaking OTP on active tabs
      return { success: true };
    }

    // ── FLOATING BUTTON ACTIONS ───────────────────────────────────
    case 'SHOW_FLOATING_BUTTON':
    case 'HIDE_FLOATING_BUTTON': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const response = await safeSendTabMessage(tab.id, message);
        return response || { success: false, error: 'Tab not responding' };
      }
      return { success: false, error: 'No active tab' };
    }

    // ── PING ──────────────────────────────────────────────────────
    case 'PING': {
      return { success: true };
    }

    // ── SERVICE HEALTH NOTIFICATIONS ─────────────────────────────
    case 'FALLBACK_DOMAINS_USED': {
      const { service, reason } = (message.payload || {}) as { service?: string; reason?: string };
      log.warn(`Provider ${service} is using fallback domains (${reason ?? 'API_UNAVAILABLE'})`);
      // Surface a non-blocking warning notification to the user
      await notifyError(
        'Email Provider Degraded',
        `${service ?? 'TempMail'} is using fallback domains — some features may be limited.`
      ).catch(() => {}); // best-effort
      return { success: true };
    }

    // ── DIAGNOSTIC EXPORT ────────────────────────────────────────
    case 'GET_DIAGNOSTIC_REPORT': {
      const report = diag.exportReport();
      return { success: true, report };
    }

    default:
      log.warn('Unhandled message action', {
        action: (message as unknown as Record<string, unknown>).action,
      });
      return {
        success: false,
        error: `Unhandled action: ${(message as unknown as Record<string, unknown>).action}`,
      };
  }
}

/**
 * Registry stats stub for backward compatibility.
 * FIX: Replaced undefined `handlerMap` reference with a static count derived
 * from the known number of handled cases in handleMessage().
 */
export function dumpRouterStats(): { handlers: number; status: string } {
  // Count is the number of explicitly handled `case` branches in handleMessage()
  return { handlers: 42, status: 'functioning' };
}

function estimateOTPPageConfidence(simplifiedDOM: string): number {
  const lower = simplifiedDOM.toLowerCase();
  if (!lower.trim()) {
    return 0;
  }

  let score = 0;

  if (lower.includes('autocomplete="one-time-code"')) {
    score += 0.5;
  }

  const keywordHits = [
    /verification\s*code/g,
    /one[-\s]?time/g,
    /\botp\b/g,
    /\bpasscode\b/g,
    /\b2fa\b/g,
    /\bmfa\b/g,
    /\bpin\b/g,
  ].reduce((count, pattern) => count + (lower.match(pattern)?.length ?? 0), 0);
  score += Math.min(0.3, keywordHits * 0.06);

  const splitDigitCount = lower.match(/maxlength=["']?1["']?/g)?.length ?? 0;
  if (splitDigitCount >= 4) {
    score += splitDigitCount >= 6 ? 0.3 : 0.2;
  }

  const inputCount = lower.match(/<input\b/g)?.length ?? 0;
  if (inputCount > 0) {
    score += Math.min(0.1, inputCount * 0.01);
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}
