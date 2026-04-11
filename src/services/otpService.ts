// OTP Extraction Service — uses SmartDetectionService (local AI, no API key)

import { PatternMatch, LastOTP } from '../types';
import { createLogger } from '../utils/logger';

import { smartDetectionService } from './smartDetectionService';
import { storageService } from './storageService';

const log = createLogger('OTPService');

// ━━━ Rate Limiting Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const RATE_LIMIT = {
  MAX_SAVES_PER_MINUTE: 10,
  WINDOW_MS: 60 * 1000,
};

// ━━━ OTP Freshness Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OTP_FRESHNESS = {
  FRESH_WINDOW_MS: 30_000, // OTP is "fresh" for 30 seconds after arrival
  MAX_WAIT_MS: 30_000, // Maximum time to wait for fresh OTP
};

class OTPService {
  private rateLimitMutex: Promise<void> = Promise.resolve();
  private rateLimitTimestamps: number[] = [];
  private hasInitializedRateLimits = false;

  private async ensureRateLimitStateLoaded(): Promise<void> {
    if (!this.hasInitializedRateLimits) {
      this.rateLimitTimestamps = (await storageService.get('otpRateLimitTimestamps')) || [];
      this.hasInitializedRateLimits = true;
    }
  }

  private async pruneRateLimitWindow(now: number): Promise<void> {
    await this.ensureRateLimitStateLoaded();

    const filtered = this.rateLimitTimestamps.filter((ts) => now - ts < RATE_LIMIT.WINDOW_MS);
    if (filtered.length !== this.rateLimitTimestamps.length) {
      this.rateLimitTimestamps = filtered;
      await storageService.set('otpRateLimitTimestamps', this.rateLimitTimestamps);
    }
  }

  /**
   * Check if rate limit is exceeded.
   * Caller must already be inside the save mutex.
   */
  private async isRateLimitedLocked(now: number): Promise<boolean> {
    await this.pruneRateLimitWindow(now);
    return this.rateLimitTimestamps.length >= RATE_LIMIT.MAX_SAVES_PER_MINUTE;
  }

  /**
   * Record a save action for rate limiting.
   * Caller must already be inside the save mutex.
   */
  private async recordSaveLocked(now: number): Promise<void> {
    await this.ensureRateLimitStateLoaded();
    this.rateLimitTimestamps.push(now);
    await storageService.set('otpRateLimitTimestamps', this.rateLimitTimestamps);
  }

  /**
   * Extract OTP from email using the 5-layer Intelligent Extraction engine.
   * No API key required. Works on all browsers.
   */
  async extractFromEmail(
    body: string,
    htmlBody?: string,
    subject: string = ''
  ): Promise<PatternMatch | null> {
    log.info('🤖 Extracting OTP via Smart Detection (local AI)');

    try {
      const result = await smartDetectionService.detect(subject, body || '', htmlBody || '');

      if ((result.type === 'otp' || result.type === 'both') && result.code) {
        log.info('✅ OTP extracted', {
          code: result.code,
          engine: result.engine,
          confidence: result.confidence,
        });
        return {
          pattern: `AI_${result.engine.toUpperCase().replace('-', '_')}`,
          confidence: result.confidence,
          extractedValue: result.code,
          startIndex: 0,
          endIndex: result.code.length,
        };
      }

      log.debug('No OTP found', { type: result.type, engine: result.engine });
      return null;
    } catch (error) {
      log.error('OTP extraction failed', error);
      return null;
    }
  }

  /**
   * Save last extracted OTP
   * Rate limited to prevent abuse
   * BUG FIX: Now returns detailed result with reason and notifies user properly
   */
  async saveLastOTP(
    otp: string,
    source: 'email' | 'sms' | 'manual',
    emailFrom?: string,
    emailSubject?: string,
    confidence: number = 0.8
  ): Promise<{ saved: boolean; reason?: string; retryAfterMs?: number }> {
    const previousMutex = this.rateLimitMutex;
    let releaseMutex: () => void = () => {};
    const nextMutex = new Promise<void>((res) => {
      releaseMutex = res;
    });
    this.rateLimitMutex = previousMutex.then(() => nextMutex);
    await previousMutex;

    try {
      const now = Date.now();

      // Rate limit check
      if (await this.isRateLimitedLocked(now)) {
        const msg = `OTP save rate limited - maximum ${RATE_LIMIT.MAX_SAVES_PER_MINUTE} requests per minute allowed`;
        const retryAfterMs = RATE_LIMIT.WINDOW_MS;

        log.warn(msg, { otp, source, retryAfterMs });

        // Notify user about rate limiting
        await this.notifyRateLimitExceeded(retryAfterMs);

        return { saved: false, reason: msg, retryAfterMs };
      }

      const lastOTP: LastOTP = {
        code: otp,
        source,
        extractedAt: now,
        confidence,
      };
      if (emailFrom) {
        lastOTP.emailFrom = emailFrom;
      }
      if (emailSubject) {
        lastOTP.emailSubject = emailSubject;
      }

      await storageService.set('lastOTP', lastOTP);
      await this.recordSaveLocked(now);
      log.info('Last OTP saved', { source });
      return { saved: true };
    } finally {
      releaseMutex();
    }
  }

  /**
   * Notify user when OTP wasn't saved due to rate limiting
   * BUG FIX: Now includes retryAfterMs for better UX
   */
  private async notifyRateLimitExceeded(retryAfterMs: number): Promise<void> {
    try {
      const message = {
        action: 'OTP_RATE_LIMIT_EXCEEDED',
        payload: {
          timestamp: Date.now(),
          message: `OTP extraction temporarily paused. Try again in ${Math.round(retryAfterMs / 1000)}s.`,
          retryAfterMs,
        },
      };

      // Attempt to send message to UI elements.
      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime.lastError) {
          // No UI is listening because popup is closed. Fallback to notification
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'assets/icons/icon128.png',
            title: 'GhostFill: Too Many OTPs',
            message: message.payload.message,
          });
        }
      });
      log.debug('OTP rate limit notification handled', { retryAfterMs });
    } catch (error) {
      // Log but don't throw - notification is best-effort
      log.debug('Could not send OTP rate limit notification', error);
    }
  }

  /**
   * Get last extracted OTP (returns null if >5 minutes old or already used)
   */
  async getLastOTP(): Promise<LastOTP | null> {
    const lastOTP = await storageService.get('lastOTP');

    if (lastOTP && Date.now() - lastOTP.extractedAt > 3 * 60 * 1000) {
      log.debug('Last OTP expired');
      return null;
    }

    if (lastOTP && lastOTP.usedAt) {
      log.debug('Last OTP already used');
      return null;
    }

    return lastOTP || null;
  }

  /**
   * Clear the stored OTP (used on session reset / email change)
   */
  async clearLastOTP(): Promise<void> {
    await storageService.remove('lastOTP');
    log.info('Last OTP cleared from storage');
  }

  /**
   * Check if the current OTP is fresh (arrived recently)
   */
  async isOTPFresh(): Promise<boolean> {
    const lastOTP = await storageService.get('lastOTP');
    if (!lastOTP) {
      return false;
    }
    const age = Date.now() - lastOTP.extractedAt;
    return age < OTP_FRESHNESS.FRESH_WINDOW_MS && !lastOTP.usedAt;
  }

  /**
   * Wait for a fresh OTP to arrive, with timeout
   * Returns the fresh OTP if available within timeout, null otherwise
   */
  async waitForFreshOTP(maxWaitMs: number = OTP_FRESHNESS.MAX_WAIT_MS): Promise<LastOTP | null> {
    const isFresh = await this.isOTPFresh();
    if (isFresh) {
      return this.getLastOTP();
    }

    return new Promise((resolve) => {
      const _startTime = Date.now();

      const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
        if (changes.lastOTP) {
          const newOTP = changes.lastOTP.newValue as LastOTP;
          if (
            newOTP &&
            !newOTP.usedAt &&
            Date.now() - newOTP.extractedAt < OTP_FRESHNESS.FRESH_WINDOW_MS
          ) {
            chrome.storage.onChanged.removeListener(listener);
            clearTimeout(timeoutId);
            resolve(newOTP);
          }
        }
      };

      const timeoutId = setTimeout(() => {
        chrome.storage.onChanged.removeListener(listener);
        log.debug('Timeout waiting for fresh OTP');
        this.getLastOTP().then(resolve);
      }, maxWaitMs);

      chrome.storage.onChanged.addListener(listener);
    });
  }

  /**
   * Mark OTP as used
   */
  async markAsUsed(): Promise<void> {
    const lastOTP = await storageService.get('lastOTP');
    if (lastOTP) {
      lastOTP.usedAt = Date.now();
      await storageService.set('lastOTP', lastOTP);
      log.debug('OTP marked as used');
    }
  }

  /**
   * Validate OTP format
   */
  validateOTP(otp: string): boolean {
    return /^[A-Z0-9]{4,10}$/i.test(otp);
  }
}

export const otpService = new OTPService();
