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
    private saveTimestamps: number[] = [];

    /**
     * Check if rate limit is exceeded
     */
    private isRateLimited(): boolean {
        const now = Date.now();
        this.saveTimestamps = this.saveTimestamps.filter(ts => now - ts < RATE_LIMIT.WINDOW_MS);
        return this.saveTimestamps.length >= RATE_LIMIT.MAX_SAVES_PER_MINUTE;
    }

    /**
     * Record a save action for rate limiting
     */
    private recordSave(): void {
        this.saveTimestamps.push(Date.now());
    }

    /**
     * Extract OTP from email using the 3-layer local AI engine.
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
                log.info('✅ OTP extracted', { code: result.code, engine: result.engine, confidence: result.confidence });
                return {
                    pattern: `AI_${result.engine.toUpperCase().replace('-', '_')}`,
                    confidence: result.confidence,
                    extractedValue: result.code,
                    startIndex: 0,
                    endIndex: result.code.length
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
        // Rate limit check
        if (this.isRateLimited()) {
            const msg = 'OTP save rate limited - too many requests in the last minute';
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
        this.recordSave();
        log.info('Last OTP saved', { otp, source });
        return { saved: true };
    }

    /**
     * Notify user when OTP wasn't saved due to rate limiting
     * BUG FIX: Now includes retryAfterMs for better UX
     */
    private async notifyRateLimitExceeded(retryAfterMs: number): Promise<void> {
        try {
            await chrome.runtime.sendMessage({
                action: 'OTP_RATE_LIMIT_EXCEEDED',
                payload: {
                    timestamp: Date.now(),
                    message: `OTP extraction temporarily paused. Try again in ${Math.round(retryAfterMs / 1000)}s.`,
                    retryAfterMs,
                },
            });
            log.debug('OTP rate limit notification sent', { retryAfterMs });
        } catch (error) {
            // Log but don't throw - notification is best-effort
            log.debug('Could not send OTP rate limit notification', error);
        }
    }

    /**
     * Get last extracted OTP (returns null if >5 minutes old)
     */
    async getLastOTP(): Promise<LastOTP | null> {
        const lastOTP = await storageService.get('lastOTP');

        if (lastOTP && Date.now() - lastOTP.extractedAt > 5 * 60 * 1000) {
            log.debug('Last OTP expired');
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
