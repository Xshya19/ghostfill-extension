import { emailService } from '../services/emailServices';
import { identityService } from '../services/identityService';
import { otpService } from '../services/otpService';
import { passwordService } from '../services/passwordService';
import { storageService } from '../services/storageService';
import {
  ExtensionMessage,
  ExtensionResponse,
  Email,
  EmailAccount,
  EmailService,
  GeneratedPassword,
  PasswordHistoryItem,
  PasswordOptions,
  DEFAULT_SETTINGS,
} from '../types';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';
import { notifySuccess, notifyError } from './notifications';
import { ensureOffscreenDocument } from './offscreenManager';
import {
  stopEmailPolling,
  startFastOTPPolling,
  stopFastOTPPolling,
  isActivationTab,
  getOTPWaitingTabs,
  resetEmailSession,
} from './pollingManager';
import { linkService } from '../services/linkService';

const log = createLogger('MessageHandler');

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
      (async () => {
        try {
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
      resetEmailSession();

      // 3. Clear linkService activation history/queue so old links don't replay
      linkService.clearHistory();

      // 4. Finally generate the new email address
      const email = await emailService.generateEmail(
        message.action === 'GENERATE_EMAIL' ? message.payload : undefined
      );

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
      if (message.action === 'READ_EMAIL') {
        const { emailId, login, domain, service } = message.payload || ({} as any);
        const email = await emailService.readEmail(emailId, {
          login,
          domain,
          service,
        } as unknown as import('../types').EmailAccount);
        return { success: true, email };
      }
      return { success: false, error: 'Invalid message action' };
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
          startFastOTPPolling(sender.tab.id, url, fieldSelectors);
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
      if (message.action === 'SAVE_PASSWORD') {
        const { password, website } = message.payload || ({} as any);
        await passwordService.saveToHistory(password, website);
        return { success: true };
      }
      return { success: false, error: 'Invalid message action' };
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
    case 'CLASSIFY_FIELD': {
      if (message.action !== 'CLASSIFY_FIELD') {
        return { success: false, error: 'Invalid message action' };
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
      if (message.action === 'SHOW_NOTIFICATION') {
        const { title, message: text, type } = message.payload || ({} as any);
        if (type === 'error') {
          await notifyError(title, text);
        } else {
          await notifySuccess(title, text);
        }
        return { success: true };
      }
      return { success: false, error: 'Invalid message action' };
    }

    // ── STORAGE/SETTINGS ──────────────────────────────────────────
    case 'GET_SETTINGS': {
      const settings = await storageService.getSettings();
      return { success: true, settings };
    }

    case 'UPDATE_SETTINGS': {
      if (message.action === 'UPDATE_SETTINGS') {
        const updated = await storageService.updateSettings(message.payload);
        return { success: true, settings: updated };
      }
      return { success: false, error: 'Invalid message action' };
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
      log.info('🔗 Link activated — allowing background tabs to verify without suspending existing fast polling');
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
 * Registry stats stub for backward compatibility
 */
export function dumpRouterStats(): void {
  log.info('Router Stats: Functioning normally');
}
