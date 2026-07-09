// OTP Extraction & Verification Service
// Consolidates local OTP store and background Smart Detection pipeline.

import { PatternMatch, LastOTP } from '../types';
import { createLogger } from '../utils/logger';
import { storageService } from './storageService';
import { encrypt, decrypt } from '../utils/encryption';
import { sanitizeText } from '../utils/sanitization.core';
import { assessEmailDecision } from './emailDecisionEngine';
import { extractAll } from './intelligentExtractor';
import type { DetectionResult, EncryptedCacheEntry } from './types/extraction.types';

const log = createLogger('OTPService');

// ━━━ Rate Limiting Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const RATE_LIMIT = {
  MAX_SAVES_PER_MINUTE: 10,
  WINDOW_MS: 60 * 1000,
};

// ━━━ OTP Freshness Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OTP_FRESHNESS = {
  FRESH_WINDOW_MS: 60_000, // OTP is "fresh" for 60 seconds after arrival
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

  private async isRateLimitedLocked(now: number): Promise<boolean> {
    await this.pruneRateLimitWindow(now);
    return this.rateLimitTimestamps.length >= RATE_LIMIT.MAX_SAVES_PER_MINUTE;
  }

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
    log.info('🤖 Extracting OTP via Smart Detection (local heuristics)');

    try {
      const result = await smartDetectionService.detect(subject, body || '', htmlBody || '');

      if ((result.type === 'otp' || result.type === 'both') && result.code) {
        log.info('✅ OTP extracted', {
          code: result.code,
          engine: result.engine,
          confidence: result.confidence,
        });
        return {
          pattern: `SMART_${result.engine.toUpperCase().replace('-', '_')}`,
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
   */
  async saveLastOTP(
    otp: string,
    source: 'email' | 'sms' | 'manual',
    emailFrom?: string,
    emailSubject?: string,
    confidence: number = 0.8,
    metadata: { emailId?: string | number; emailDate?: number } = {}
  ): Promise<{ saved: boolean; reason?: string; retryAfterMs?: number }> {
    const previousMutex = this.rateLimitMutex;
    let releaseMutex: () => void = () => {};
    const nextMutex = new Promise<void>((res) => {
      releaseMutex = res;
    });
    this.rateLimitMutex = previousMutex.then(
      () => nextMutex,
      () => nextMutex
    );
    await previousMutex;

    try {
      const now = Date.now();

      if (await this.isRateLimitedLocked(now)) {
        const msg = `OTP save rate limited - maximum ${RATE_LIMIT.MAX_SAVES_PER_MINUTE} requests per minute allowed`;
        const retryAfterMs = RATE_LIMIT.WINDOW_MS;

        log.warn(msg, { otpLength: otp.length, source, retryAfterMs });
        await this.notifyRateLimitExceeded(retryAfterMs);

        return { saved: false, reason: msg, retryAfterMs };
      }

      const lastOTP: LastOTP = {
        code: otp,
        source,
        extractedAt: now,
        confidence,
      };
      if (metadata.emailId !== undefined) {
        lastOTP.emailId = metadata.emailId;
      }
      if (metadata.emailDate !== undefined) {
        lastOTP.emailDate = metadata.emailDate;
      }
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

      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime.lastError) {
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
      log.debug('Could not send OTP rate limit notification', error);
    }
  }

  async getLastOTP(): Promise<LastOTP | null> {
    const lastOTP = await storageService.get('lastOTP');

    if (lastOTP && Date.now() - lastOTP.extractedAt > 10 * 60 * 1000) {
      log.debug('Last OTP expired');
      return null;
    }

    if (lastOTP && lastOTP.usedAt) {
      log.debug('Last OTP already used');
      return null;
    }

    return lastOTP || null;
  }

  async clearLastOTP(): Promise<void> {
    await storageService.remove('lastOTP');
    log.info('Last OTP cleared from storage');
  }

  async isOTPFresh(): Promise<boolean> {
    const lastOTP = await storageService.get('lastOTP');
    if (!lastOTP) {
      return false;
    }
    const age = Date.now() - lastOTP.extractedAt;
    return age < OTP_FRESHNESS.FRESH_WINDOW_MS && !lastOTP.usedAt;
  }

  async waitForFreshOTP(maxWaitMs: number = OTP_FRESHNESS.MAX_WAIT_MS): Promise<LastOTP | null> {
    const isFresh = await this.isOTPFresh();
    if (isFresh) {
      return this.getLastOTP();
    }

    return new Promise((resolve) => {
      const unsubscribe = storageService.onChanged(async (changes) => {
        if (!changes.lastOTP) {
          return;
        }
        try {
          const newOTP = await storageService.get('lastOTP');
          if (
            newOTP &&
            !newOTP.usedAt &&
            Date.now() - newOTP.extractedAt < OTP_FRESHNESS.FRESH_WINDOW_MS
          ) {
            unsubscribe();
            clearTimeout(timeoutId);
            resolve(newOTP);
          }
        } catch {
          // Ignore read errors
        }
      });

      const timeoutId = setTimeout(() => {
        unsubscribe();
        log.debug('Timeout waiting for fresh OTP');
        this.getLastOTP().then(resolve);
      }, maxWaitMs);
    });
  }

  async markAsUsed(): Promise<void> {
    const lastOTP = await storageService.get('lastOTP');
    if (lastOTP) {
      lastOTP.usedAt = Date.now();
      await storageService.set('lastOTP', lastOTP);
      log.debug('OTP marked as used');
    }
  }

  validateOTP(otp: string): boolean {
    const cleaned = otp.replace(/[-\s]/g, '');
    return /^[A-Z0-9]{4,10}$/i.test(cleaned);
  }
}

export const otpService = new OTPService();

// ━━━ Smart Detection Service Caching Layer (Inlined from smartDetectionService.ts) ━━━

class SmartDetectionService {
  private readonly CACHE_TTL = 2 * 60 * 1000;
  private readonly CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  private cacheKey: CryptoKey | null = null;
  private lastCacheCleanupAt = 0;
  private cacheCleanupPromise: Promise<void> | null = null;

  constructor() {
    log.info(`👻 GhostFill Intelligence Engine Initializing...`);
    void this.initializeCacheEncryption();
    this.installCleanupHook();
  }

  private async initializeCacheEncryption(): Promise<void> {
    try {
      this.cacheKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ]);
      log.debug('Cache encryption key initialized in memory only');
    } catch (error) {
      log.error('Failed to initialize cache encryption', error);
    }
  }

  private installCleanupHook(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        this.destroyCache();
      });
    }
  }

  private maybeCleanupExpiredCache(): void {
    const now = Date.now();
    if (
      now - this.lastCacheCleanupAt < this.CACHE_CLEANUP_INTERVAL_MS ||
      this.cacheCleanupPromise
    ) {
      return;
    }

    this.lastCacheCleanupAt = now;
    this.cacheCleanupPromise = this.cleanupExpiredCache().finally(() => {
      this.cacheCleanupPromise = null;
    });
  }

  private async cleanupExpiredCache(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const allData = (await chrome.storage.session.get(null)) as unknown as
          | Record<string, unknown>
          | undefined;
        if (!allData) {
          return;
        }

        const now = Date.now();

        for (const [key, value] of Object.entries(allData)) {
          if (key.startsWith('det_')) {
            const entry = value as EncryptedCacheEntry | undefined;
            if (entry && now - entry.timestamp > entry.ttl) {
              await chrome.storage.session.remove(key);
              log.debug(`Cleaned up expired cache entry: ${key}`);
            }
          }
        }
      } catch (e) {
        log.warn('Cache cleanup failed', e);
      }
    }
  }

  private destroyCache(): void {
    this.cacheCleanupPromise = null;
    this.cacheKey = null;
    log.debug('Cache destroyed');
  }

  async detect(
    subject: string,
    body: string,
    htmlBody: string = '',
    sender: string = '',
    expectedDomains: string[] = []
  ): Promise<DetectionResult> {
    this.maybeCleanupExpiredCache();

    const contextKey = expectedDomains
      .map((domain) => domain.toLowerCase())
      .sort()
      .join(',');
    const hashStr = await this.hash(`${sender}|${subject}|${body}|ctx:${contextKey}`);
    const cacheKey = `det_${hashStr}`;
    const cachedResult = await this.getCachedResult(cacheKey);
    if (cachedResult) {
      log.debug('[SmartDetection] Returning cached result');
      return cachedResult;
    }

    let intelligentResult = extractAll(subject, body, htmlBody, sender, expectedDomains);
    
    if ((!intelligentResult.otp && !intelligentResult.link) && htmlBody) {
      log.info('[SmartDetection] Primary extraction returned nothing. Trying HTML fallback...');
      const fallbackPlain = this.cleanHTML(htmlBody);
      if (fallbackPlain && fallbackPlain !== body) {
        intelligentResult = extractAll(subject, fallbackPlain, htmlBody, sender, expectedDomains);
      }
    }

    const decision = assessEmailDecision({
      extraction: intelligentResult,
      sender,
      expectedDomains,
    });

    log.info(`📊 [SmartDetection] Intent: ${intelligentResult.intent}`);
    log.info(
      `📊 [SmartDetection] OTP: ${intelligentResult.otp ? `${intelligentResult.otp.code} (${intelligentResult.otp.confidence}%)` : 'none'}`
    );
    log.info(
      `📊 [SmartDetection] Link: ${intelligentResult.link ? `${intelligentResult.link.type} (${intelligentResult.link.confidence}%)` : 'none'}`
    );

    const mergedResult: DetectionResult = {
      type: 'none',
      confidence: 0,
      engine: 'intelligent',
      providerConfidence: intelligentResult.debugInfo.providerConfidence || 0,
      decision,
    };
    if (intelligentResult.debugInfo.provider) {
      mergedResult.provider = intelligentResult.debugInfo.provider;
    }

    if (intelligentResult.otp && intelligentResult.link) {
      mergedResult.type = 'both';
    } else if (intelligentResult.otp) {
      mergedResult.type = 'otp';
    } else if (intelligentResult.link) {
      mergedResult.type = 'link';
    }

    if (intelligentResult.otp) {
      mergedResult.code = intelligentResult.otp.code;
      mergedResult.confidence = Math.max(mergedResult.confidence, intelligentResult.otp.confidence);
    }
    if (intelligentResult.link) {
      mergedResult.link = intelligentResult.link.url;
      mergedResult.confidence = Math.max(
        mergedResult.confidence,
        intelligentResult.link.confidence / 100
      );
    }

    log.info(
      `✅ [SmartDetection] Final: ${mergedResult.type} (${(mergedResult.confidence * 100).toFixed(0)}%) via ${mergedResult.engine}`
    );
    log.info(
      `[SmartDetection] Decision: ${decision.action} risk=${decision.risk} purpose=${decision.purpose} auto=${decision.canAutoAct}`
    );

    await this.cacheResult(cacheKey, mergedResult);
    return mergedResult;
  }

  private cleanHTML(html: string): string {
    if (!html) {
      return '';
    }

    const sanitized = sanitizeText(html);

    const processedHtml = sanitized
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return processedHtml.substring(0, 2000);
  }

  private async hash(str: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  private async getCachedResult(key: string): Promise<DetectionResult | null> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const data = await chrome.storage.session.get(key);
        const encryptedEntry = data[key] as EncryptedCacheEntry | undefined;

        if (!encryptedEntry) {
          return null;
        }

        if (Date.now() - encryptedEntry.timestamp > encryptedEntry.ttl) {
          await chrome.storage.session.remove(key);
          return null;
        }

        if (!this.cacheKey) {
          log.warn('Cache key not initialized, cannot decrypt');
          return null;
        }

        const decryptedResult = await decrypt<DetectionResult>(
          encryptedEntry.encryptedData,
          this.cacheKey
        );

        if (decryptedResult && typeof decryptedResult === 'object' && 'type' in decryptedResult && 'decision' in decryptedResult) {
          return decryptedResult;
        } else {
          log.warn('Cached result validation failed, removing entry');
          await chrome.storage.session.remove(key);
        }
      } catch (e) {
        log.warn('MV3 Session Cache read/decrypt failed', e);
        try {
          await chrome.storage.session.remove(key);
        } catch {}
      }
    }
    return null;
  }

  private async cacheResult(key: string, result: DetectionResult): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        if (!this.cacheKey) {
          log.warn('Cache key not initialized, skipping cache write');
          return;
        }

        const allKeys = await chrome.storage.session.get(null);
        const cacheKeys = Object.keys(allKeys).filter(k => k.startsWith('det_'));
        if (cacheKeys.length >= 100) {
          const entries = cacheKeys.map(k => ({ key: k, ts: (allKeys[k] as any).timestamp }));
          entries.sort((a, b) => a.ts - b.ts);
          const toRemove = entries.slice(0, 10).map(e => e.key);
          await chrome.storage.session.remove(toRemove);
          log.debug(`Evicted 10 oldest cache entries due to size limit.`);
        }

        const encryptedData = await encrypt(result, this.cacheKey);

        const encryptedEntry: EncryptedCacheEntry = {
          encryptedData,
          iv: '',
          timestamp: Date.now(),
          ttl: this.CACHE_TTL,
        };

        await chrome.storage.session.set({ [key]: encryptedEntry });
        log.debug(`Cached detection result (encrypted): ${key}`);
      } catch (e) {
        log.warn('MV3 Session Cache write/encrypt failed', e);
      }
    }
  }

  extractCode(text: string): string | null {
    const result = extractAll('', '', text);
    return result.otp?.code || null;
  }

  extractLink(html: string): string | null {
    const result = extractAll('', '', html);
    return result.link?.url || null;
  }

  async analyzeForm(simplifiedDOM: string): Promise<{
    success: boolean;
    email?: string;
    password?: string;
    otp?: string;
    submit?: string;
  }> {
    if (!simplifiedDOM) {
      return { success: false };
    }
    const cleaned = this.cleanHTML(simplifiedDOM);
    return { success: cleaned.length > 10 };
  }
}

export const smartDetectionService = new SmartDetectionService();
