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

function toSafeString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!v) return '';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.html === 'string') return obj.html;
    if (typeof obj.body === 'string') return obj.body;
    if (typeof obj.content === 'string') return obj.content;
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

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

  // PERF: Rate-limit timestamps are ephemeral bookkeeping — no disk persistence needed.
  // Removed storageService.get/set calls that triggered encryption + disk I/O per OTP save.
  // Timestamps naturally reset on service worker restart (correct for rate limiting).

  private pruneRateLimitWindow(now: number): void {
    const filtered = this.rateLimitTimestamps.filter((ts) => now - ts < RATE_LIMIT.WINDOW_MS);
    if (filtered.length !== this.rateLimitTimestamps.length) {
      this.rateLimitTimestamps = filtered;
    }
  }

  private isRateLimitedLocked(now: number): boolean {
    this.pruneRateLimitWindow(now);
    return this.rateLimitTimestamps.length >= RATE_LIMIT.MAX_SAVES_PER_MINUTE;
  }

  private recordSaveLocked(now: number): void {
    this.rateLimitTimestamps.push(now);
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
      const msgText = `OTP extraction temporarily paused. Try again in ${Math.round(retryAfterMs / 1000)}s.`;
      if (typeof chrome !== 'undefined' && chrome.notifications?.create) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icons/icon128.png',
          title: 'GhostFill: Too Many OTPs',
          message: msgText,
        });
      }
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

    // MV3-resilient yielding loop: checks storage at steady intervals
    // without risking hanging promise listeners across SW suspension.
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 500));
      const otp = await this.getLastOTP();
      if (otp && !otp.usedAt && Date.now() - otp.extractedAt < OTP_FRESHNESS.FRESH_WINDOW_MS) {
        return otp;
      }
    }
    log.debug('Timeout waiting for fresh OTP');
    return this.getLastOTP();
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
    // Run an initial cache cleanup pass on SW boot
    void this.cleanupExpiredCache();
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
    subject: unknown = '',
    body: unknown = '',
    htmlBody: unknown = '',
    sender: unknown = '',
    expectedDomains: string[] = []
  ): Promise<DetectionResult> {
    const sSubject = toSafeString(subject);
    const sBody = toSafeString(body);
    const sHtml = toSafeString(htmlBody);
    const sSender = toSafeString(sender);

    this.maybeCleanupExpiredCache();

    const contextKey = (expectedDomains || [])
      .map((domain) => toSafeString(domain).toLowerCase())
      .sort()
      .join(',');
    const cacheKey = this.fastCacheKey(sSender, sSubject, sBody, contextKey);
    const cachedResult = await this.getCachedResult(cacheKey);
    if (cachedResult) {
      log.debug('[SmartDetection] Returning cached result');
      return cachedResult;
    }

    let intelligentResult = extractAll(sSubject, sBody, sHtml, sSender, expectedDomains);
    
    if ((!intelligentResult.otp && !intelligentResult.link) && sHtml) {
      log.info('[SmartDetection] Primary extraction returned nothing. Trying HTML fallback...');
      const fallbackPlain = this.cleanHTML(sHtml);
      if (fallbackPlain && fallbackPlain !== sBody) {
        intelligentResult = extractAll(sSubject, fallbackPlain, sHtml, sSender, expectedDomains);
      }
    }

    const decision = assessEmailDecision({
      extraction: intelligentResult,
      sender: sSender,
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
      // FIX D4: intelligentResult.link.confidence is already in 0..1 scale
      mergedResult.confidence = Math.max(
        mergedResult.confidence,
        intelligentResult.link.confidence > 1 ? intelligentResult.link.confidence / 100 : intelligentResult.link.confidence
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

  async burnCode(code: string, domain: string): Promise<void> {
    if (!code || !domain) return;
    const allBurned = (await storageService.get('burnedCodes')) ?? {};
    const normalized = code.toUpperCase();
    const domainList = allBurned[domain] ?? [];
    if (!domainList.includes(normalized)) {
      const updatedList = [...domainList, normalized].slice(-10);
      await storageService.set('burnedCodes', { ...allBurned, [domain]: updatedList });
      log.info(`🔥 Burned rejected code for ${domain}`, { code: normalized });
    }
  }

  async getBurnedCodes(domain: string): Promise<string[]> {
    if (!domain) return [];
    const allBurned = (await storageService.get('burnedCodes')) ?? {};
    return allBurned[domain] ?? [];
  }

  private cleanHTML(html: unknown): string {
    const sHtml = toSafeString(html);
    if (!sHtml) {
      return '';
    }

    const sanitized = sanitizeText(sHtml);

    const processedHtml = sanitized
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return processedHtml.substring(0, 2000);
  }

  // GRANDMASTER FIX: Synchronous 32-bit hash. Zero memory allocation.
  private fastCacheKey(sender: unknown, subject: unknown, body: unknown, contextKey: unknown): string {
    const sSender = toSafeString(sender);
    const sSubject = toSafeString(subject);
    const sBody = toSafeString(body);
    const sContext = toSafeString(contextKey);
    // Sample the first 1000 chars + length to prevent 5MB HTML hashing
    const sample = `${sSender}|${sSubject}|${sBody.substring(0, 1000)}|len:${sBody.length}|ctx:${sContext}`;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < sample.length; i++) {
      const ch = sample.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `det_${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
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

        // Maintain a lightweight index array in session storage (O(1) memory footprint)
        const sessionData = await chrome.storage.session.get('det_index');
        let index = (sessionData?.det_index as string[]) || [];

        if (index.length >= 100) {
          const toRemove = index.splice(0, 10);
          await chrome.storage.session.remove(toRemove);
          log.debug(`Evicted 10 oldest cache entries via index.`);
        }

        if (!index.includes(key)) {
          index.push(key);
        }

        const encryptedData = await encrypt(result, this.cacheKey);

        const encryptedEntry: EncryptedCacheEntry = {
          encryptedData,
          iv: '',
          timestamp: Date.now(),
          ttl: this.CACHE_TTL,
        };

        await chrome.storage.session.set({
          [key]: encryptedEntry,
          det_index: index,
        });
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
