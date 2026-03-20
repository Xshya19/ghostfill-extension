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

class OTPService {
  private rateLimitMutex: Promise<void> = Promise.resolve();
  private rateLimitTimestamps: number[] = [];
  private hasInitializedRateLimits = false;

  /**
   * Check if rate limit is exceeded
   */
  private async isRateLimited(): Promise<boolean> {
    const now = Date.now();
    
    if (!this.hasInitializedRateLimits) {
      this.rateLimitTimestamps = (await storageService.get('otpRateLimitTimestamps')) || [];
      this.hasInitializedRateLimits = true;
    }
    
    const filtered = this.rateLimitTimestamps.filter((ts) => now - ts < RATE_LIMIT.WINDOW_MS);
    
    // Only pay the write cost if the array actually changed (items dropped)
    if (filtered.length !== this.rateLimitTimestamps.length) {
      this.rateLimitTimestamps = filtered;
      await storageService.set('otpRateLimitTimestamps', this.rateLimitTimestamps);
    }
    
    return this.rateLimitTimestamps.length >= RATE_LIMIT.MAX_SAVES_PER_MINUTE;
  }

  /**
   * Record a save action for rate limiting
   */
  private async recordSave(): Promise<void> {
    if (!this.hasInitializedRateLimits) {
      this.rateLimitTimestamps = (await storageService.get('otpRateLimitTimestamps')) || [];
      this.hasInitializedRateLimits = true;
    }
    this.rateLimitTimestamps.push(Date.now());
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
    // Acquire local mutex to prevent concurrent reads/writes of rate limit arrays
    let releaseMutex!: () => void;
    const nextMutex = new Promise<void>((res) => {
      releaseMutex = res;
    });
    const previousMutex = this.rateLimitMutex;
    this.rateLimitMutex = previousMutex.then(() => nextMutex);
    await previousMutex;

    try {
      // Rate limit check
      if (await this.isRateLimited()) {
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
        emailFrom,
        emailSubject,
        extractedAt: Date.now(),
        confidence,
      };

      await storageService.set('lastOTP', lastOTP);
      await this.recordSave();
      log.info('Last OTP saved', { otp, source });
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
            iconUrl: 'assets/icon128.png',
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

    if (lastOTP && Date.now() - lastOTP.extractedAt > 5 * 60 * 1000) {
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
   * Clear last OTP
   */
  async clearLastOTP(): Promise<void> {
    await storageService.remove('lastOTP');
    log.debug('Last OTP cleared');
  }

  /**
   * Validate OTP format
   */
  validateOTP(otp: string): boolean {
    return /^[A-Z0-9]{4,10}$/i.test(otp);
  }
}

export const otpService = new OTPService();
