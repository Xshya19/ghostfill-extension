// OTP Extraction & Verification Service
// Consolidates local OTP store and background Smart Detection pipeline.

import { PatternMatch, LastOTP } from '../types';
import { LAST_OTP_MAX_AGE_MS } from '../types/storage.types';
import { contentFingerprint } from '../utils/contentFingerprint';
import { encrypt, decrypt } from '../utils/encryption';
import { createLogger } from '../utils/logger';
import { sanitizeText } from '../utils/sanitization.core';
import { assessEmailDecision } from './emailDecisionEngine';
import { extractAll } from './intelligentExtractor';
import { storageService } from './storageService';
import type { DetectionResult, EncryptedCacheEntry } from './types/extraction.types';

const log = createLogger('OTPService');

const DETECTION_FIELDS = new Set([
  'type',
  'code',
  'link',
  'confidence',
  'otpConfidence',
  'engine',
  'debug',
  'provider',
  'providerConfidence',
  'domain',
  'decision',
]);
const DECISION_FIELDS = new Set([
  'purpose',
  'action',
  'risk',
  'confidence',
  'canAutoAct',
  'reasons',
  'warnings',
]);
const DECISION_PURPOSES = new Set([
  'verification',
  'activation',
  'password-reset',
  'magic-login',
  'two-factor',
  'invitation',
  'transactional',
  'marketing',
  'newsletter',
  'social-notification',
  'unknown',
]);

function isCachedDetection(value: unknown): value is DetectionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const result = value as DetectionResult;
  const probability = (n: unknown): boolean =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (
    !Object.keys(result).every((field) => DETECTION_FIELDS.has(field)) ||
    !['otp', 'link', 'both', 'none'].includes(result.type) ||
    !['intelligent', 'ensemble-consensus'].includes(result.engine) ||
    !probability(result.confidence)
  ) {
    return false;
  }
  for (const field of ['debug', 'provider', 'domain'] as const) {
    if (result[field] !== undefined && typeof result[field] !== 'string') {
      return false;
    }
  }
  for (const field of ['otpConfidence', 'providerConfidence'] as const) {
    if (result[field] !== undefined && !probability(result[field])) {
      return false;
    }
  }
  if (
    result.code !== undefined &&
    (typeof result.code !== 'string' || !/^[a-z0-9]{4,12}$/i.test(result.code))
  ) {
    return false;
  }
  if (result.link !== undefined) {
    if (typeof result.link !== 'string') {
      return false;
    }
    try {
      if (!['http:', 'https:'].includes(new URL(result.link).protocol)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if ((result.type === 'otp' || result.type === 'both') && !result.code) {
    return false;
  }
  if ((result.type === 'link' || result.type === 'both') && !result.link) {
    return false;
  }
  const decision = result.decision;
  return Boolean(
    decision &&
    typeof decision === 'object' &&
    !Array.isArray(decision) &&
    Object.keys(decision).every((field) => DECISION_FIELDS.has(field)) &&
    DECISION_PURPOSES.has(decision.purpose) &&
    ['fill-otp', 'open-link', 'fill-otp-and-open-link', 'show-review', 'ignore'].includes(
      decision.action
    ) &&
    ['low', 'medium', 'high'].includes(decision.risk) &&
    probability(decision.confidence) &&
    typeof decision.canAutoAct === 'boolean' &&
    Array.isArray(decision.reasons) &&
    decision.reasons.every((reason) => typeof reason === 'string') &&
    Array.isArray(decision.warnings) &&
    decision.warnings.every((warning) => typeof warning === 'string')
  );
}

function toSafeString(v: unknown): string {
  if (typeof v === 'string') {
    return v;
  }
  if (!v) {
    return '';
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') {
      return obj.text;
    }
    if (typeof obj.html === 'string') {
      return obj.html;
    }
    if (typeof obj.body === 'string') {
      return obj.body;
    }
    if (typeof obj.content === 'string') {
      return obj.content;
    }
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
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

// ━━━ Smart Detection Service Caching Layer (Inlined from smartDetectionService.ts) ━━━

class SmartDetectionService {
  private readonly CACHE_TTL = 2 * 60 * 1000;
  private readonly CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  private readonly MAX_CACHE_ENTRIES = 100;
  private readonly MAX_SHARED_REQUESTS = 100;
  private readonly CACHE_OPERATION_TIMEOUT_MS = 1_000;
  private cacheAvailable = true;
  private cacheKey: CryptoKey | null = null;
  private readonly cacheReadyPromise: Promise<void>;
  private readonly cacheIndex = new Set<string>();
  private readonly pendingDetections = new Map<string, Promise<DetectionResult>>();
  private cacheMutationQueue: Promise<void> = Promise.resolve();
  private lastCacheCleanupAt = 0;
  private cacheCleanupPromise: Promise<void> | null = null;

  constructor() {
    log.info(`👻 GhostFill Intelligence Engine Initializing...`);
    this.cacheReadyPromise = this.initializeCacheEncryption();
    this.installCleanupHook();
  }

  private async initializeCacheEncryption(): Promise<void> {
    try {
      this.cacheKey = await this.cacheOperation(() =>
        crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      );
      log.debug('Cache encryption key initialized in memory only');
    } catch (error) {
      log.debug('Detection cache encryption unavailable; extracting without the cache', error);
    }
  }

  private installCleanupHook(): void {
    this.lastCacheCleanupAt = Date.now();
    // A new worker key cannot decrypt the previous worker's entries. Remove
    // only this cache's indexed ciphertext instead of scanning all session data.
    this.cacheCleanupPromise = this.runCacheMutation(async () => {
      if (typeof chrome === 'undefined' || !chrome.storage?.session) {
        return;
      }
      try {
        const data = await this.cacheOperation(() => chrome.storage.session.get('det_index'));
        const previous = Array.isArray(data?.det_index)
          ? data.det_index.filter(
              (key: unknown): key is string =>
                typeof key === 'string' && /^det_v2_[a-f0-9]{16}$/.test(key)
            )
          : [];
        if (previous.length) {
          await this.cacheOperation(() =>
            chrome.storage.session.remove([...new Set(previous), 'det_index'])
          );
        }
      } catch (error) {
        log.debug('Previous detection cache cleanup deferred', error);
      }
    }).finally(() => {
      this.cacheCleanupPromise = null;
    });
  }

  private runCacheMutation(operation: () => Promise<void>): Promise<void> {
    const next = this.cacheMutationQueue.then(operation);
    // The queue must remain usable after a failed optional cache operation.
    this.cacheMutationQueue = next.catch(() => {});
    return next;
  }

  private async cacheOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.cacheAvailable) {
      throw new Error('Optional detection cache is unavailable');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Optional detection cache operation timed out')),
            this.CACHE_OPERATION_TIMEOUT_MS
          );
        }),
      ]);
    } catch (error) {
      // Cache failure must not hang verification or permit late writes to race
      // newer index updates. Disable this optional cache for the worker lifetime.
      this.cacheAvailable = false;
      this.cacheIndex.clear();
      throw error;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private maybeCleanupExpiredCache(): void {
    const now = Date.now();
    if (
      !this.cacheAvailable ||
      now - this.lastCacheCleanupAt < this.CACHE_CLEANUP_INTERVAL_MS ||
      this.cacheCleanupPromise
    ) {
      return;
    }

    this.lastCacheCleanupAt = now;
    this.cacheCleanupPromise = this.runCacheMutation(() => this.cleanupExpiredCache()).finally(
      () => {
        this.cacheCleanupPromise = null;
      }
    );
  }

  private async cleanupExpiredCache(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const keys = [...this.cacheIndex];
        if (!keys.length) {
          return;
        }
        if (!this.cacheAvailable) {
          return;
        }
        const allData = await this.cacheOperation(() => chrome.storage.session.get(keys));
        const now = Date.now();
        const expired = keys.filter((key) => {
          const entry = allData[key] as EncryptedCacheEntry | undefined;
          return (
            !entry ||
            !Number.isFinite(entry.timestamp) ||
            entry.timestamp > now ||
            now - entry.timestamp >= this.CACHE_TTL
          );
        });
        if (expired.length) {
          await this.cacheOperation(() => chrome.storage.session.remove(expired));
          for (const key of expired) {
            this.cacheIndex.delete(key);
          }
          await this.cacheOperation(() =>
            chrome.storage.session.set({ det_index: [...this.cacheIndex] })
          );
          log.debug(`Cleaned up ${expired.length} expired detection entries`);
        }
      } catch (e) {
        log.warn('Cache cleanup failed', e);
      }
    }
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
    const cacheKey = this.fastCacheKey(sSender, sSubject, sBody, sHtml, contextKey);
    const pending = this.pendingDetections.get(cacheKey);
    if (pending) {
      return this.copyResult(await pending);
    }
    const work = this.detectUncached(cacheKey, sSubject, sBody, sHtml, sSender, [
      ...(expectedDomains || []),
    ]);
    // Coalesce normal workloads without retaining an unbounded map during a burst.
    const shared = this.pendingDetections.size < this.MAX_SHARED_REQUESTS;
    if (shared) {
      this.pendingDetections.set(cacheKey, work);
    }
    try {
      return this.copyResult(await work);
    } finally {
      if (shared && this.pendingDetections.get(cacheKey) === work) {
        this.pendingDetections.delete(cacheKey);
      }
    }
  }

  private copyResult(result: DetectionResult): DetectionResult {
    if (!result.decision) {
      return { ...result };
    }
    return {
      ...result,
      decision: {
        ...result.decision,
        reasons: [...result.decision.reasons],
        warnings: [...result.decision.warnings],
      },
    };
  }

  private async detectUncached(
    cacheKey: string,
    sSubject: string,
    sBody: string,
    sHtml: string,
    sSender: string,
    expectedDomains: string[]
  ): Promise<DetectionResult> {
    const cachedResult = await this.getCachedResult(cacheKey);
    if (cachedResult) {
      log.debug('[SmartDetection] Returning cached result');
      return cachedResult;
    }

    let intelligentResult = extractAll(sSubject, sBody, sHtml, sSender, expectedDomains);

    if (!intelligentResult.otp && !intelligentResult.link && sHtml) {
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
      `📊 [SmartDetection] OTP: ${intelligentResult.otp ? `${intelligentResult.otp.code} (${Math.round(intelligentResult.otp.confidence * 100)}%)` : 'none'}`
    );
    log.info(
      `📊 [SmartDetection] Link: ${intelligentResult.link ? `${intelligentResult.link.type} (${Math.round(intelligentResult.link.confidence * 100)}%)` : 'none'}`
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
      mergedResult.otpConfidence = intelligentResult.otp.confidence;
      mergedResult.confidence = Math.max(mergedResult.confidence, intelligentResult.otp.confidence);
    }
    if (intelligentResult.link) {
      mergedResult.link = intelligentResult.link.url;
      // FIX D4: intelligentResult.link.confidence is already in 0..1 scale
      mergedResult.confidence = Math.max(
        mergedResult.confidence,
        intelligentResult.link.confidence > 1
          ? intelligentResult.link.confidence / 100
          : intelligentResult.link.confidence
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
    if (!code || !domain) {
      return;
    }
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
    if (!domain) {
      return [];
    }
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
  private fastCacheKey(
    sender: unknown,
    subject: unknown,
    body: unknown,
    htmlBody: unknown,
    contextKey: unknown
  ): string {
    const sSender = toSafeString(sender);
    const sSubject = toSafeString(subject);
    const sBody = toSafeString(body);
    const sContext = toSafeString(contextKey);
    // Hash every text/HTML character: codes can change in the middle of an
    // otherwise identical template, or arrive only in the full HTML part.
    const parts = [sSender, sSubject, sBody, toSafeString(htmlBody), sContext];
    return `det_v2_${contentFingerprint(parts)}`;
  }

  private async getCachedResult(key: string): Promise<DetectionResult | null> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        await this.cacheReadyPromise;
        await this.cacheCleanupPromise;
        // The complete cache index is maintained by this worker. A known miss
        // requires neither session IPC nor an attempted decryption.
        if (!this.cacheAvailable || !this.cacheKey || !this.cacheIndex.has(key)) {
          return null;
        }
        const data = await this.cacheOperation(() => chrome.storage.session.get(key));
        const encryptedEntry = data[key] as EncryptedCacheEntry | undefined;

        if (!encryptedEntry) {
          return null;
        }

        if (
          !Number.isFinite(encryptedEntry.timestamp) ||
          encryptedEntry.timestamp > Date.now() ||
          Date.now() - encryptedEntry.timestamp >= this.CACHE_TTL
        ) {
          await this.removeCacheEntry(key);
          return null;
        }

        if (!this.cacheKey) {
          log.warn('Cache key not initialized, cannot decrypt');
          return null;
        }

        const decryptedResult = await this.cacheOperation(() =>
          decrypt<DetectionResult>(encryptedEntry.encryptedData, this.cacheKey!)
        );

        if (isCachedDetection(decryptedResult)) {
          return decryptedResult;
        } else {
          log.warn('Cached result validation failed, removing entry');
          await this.removeCacheEntry(key);
        }
      } catch (e) {
        log.warn('MV3 Session Cache read/decrypt failed', e);
        try {
          await this.removeCacheEntry(key);
        } catch {
          // ignore cleanup error
        }
      }
    }
    return null;
  }

  private async cacheResult(key: string, result: DetectionResult): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        await this.cacheReadyPromise;
        if (!this.cacheAvailable || !this.cacheKey) {
          return;
        }

        const encryptedData = await this.cacheOperation(() => encrypt(result, this.cacheKey!));

        const encryptedEntry: EncryptedCacheEntry = {
          encryptedData,
          iv: '',
          timestamp: Date.now(),
          ttl: this.CACHE_TTL,
        };

        await this.runCacheMutation(async () => {
          if (!this.cacheAvailable) {
            return;
          }
          const index = [...this.cacheIndex].filter((cachedKey) => cachedKey !== key);
          const evicted = index.splice(0, Math.max(0, index.length + 1 - this.MAX_CACHE_ENTRIES));
          if (evicted.length) {
            await this.cacheOperation(() => chrome.storage.session.remove(evicted));
          }
          index.push(key);
          await this.cacheOperation(() =>
            chrome.storage.session.set({ [key]: encryptedEntry, det_index: index })
          );
          this.cacheIndex.clear();
          for (const cachedKey of index) {
            this.cacheIndex.add(cachedKey);
          }
        });
        log.debug(`Cached detection result (encrypted): ${key}`);
      } catch (e) {
        log.warn('MV3 Session Cache write/encrypt failed', e);
      }
    }
  }

  private async removeCacheEntry(key: string): Promise<void> {
    await this.runCacheMutation(async () => {
      if (!this.cacheAvailable) {
        return;
      }
      await this.cacheOperation(() => chrome.storage.session.remove(key));
      this.cacheIndex.delete(key);
      await this.cacheOperation(() =>
        chrome.storage.session.set({ det_index: [...this.cacheIndex] })
      );
    });
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

  private async acquireStoreLock(): Promise<() => void> {
    const previous = this.rateLimitMutex;
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.rateLimitMutex = previous.then(
      () => next,
      () => next
    );
    await previous;
    return release;
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
    metadata: { emailId?: string | number; emailDate?: number; autoFillEligible?: boolean } = {}
  ): Promise<{ saved: boolean; reason?: string; retryAfterMs?: number }> {
    const releaseMutex = await this.acquireStoreLock();

    try {
      const now = Date.now();

      if (
        source === 'email' &&
        (metadata.emailId !== undefined || metadata.emailDate !== undefined)
      ) {
        const existing = await this.getLastOTP({ includeUsed: true });
        if (existing) {
          const older =
            metadata.emailDate !== undefined &&
            existing.emailDate !== undefined &&
            metadata.emailDate < existing.emailDate;
          const sameMessage =
            metadata.emailId !== undefined &&
            String(metadata.emailId) === String(existing.emailId) &&
            otp === existing.code;
          if (older || (sameMessage && existing.usedAt)) {
            return { saved: false, reason: older ? 'older-email' : 'already-used' };
          }
          // Refreshing the popup must not reset a message's arrival time.
          if (sameMessage) {
            if (
              metadata.autoFillEligible !== undefined &&
              metadata.autoFillEligible !== existing.autoFillEligible
            ) {
              existing.autoFillEligible = metadata.autoFillEligible;
              await storageService.set('lastOTP', existing);
            }
            return { saved: true };
          }
        }
      }

      if (this.isRateLimitedLocked(now)) {
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
      if (metadata.autoFillEligible !== undefined) {
        lastOTP.autoFillEligible = metadata.autoFillEligible;
      }
      if (emailFrom) {
        lastOTP.emailFrom = emailFrom;
      }
      if (emailSubject) {
        lastOTP.emailSubject = emailSubject;
      }

      await storageService.set('lastOTP', lastOTP);
      this.recordSaveLocked(now);
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
        await chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
          title: 'GhostFill: Too Many OTPs',
          message: msgText,
        });
      }
      log.debug('OTP rate limit notification handled', { retryAfterMs });
    } catch (error) {
      log.debug('Could not send OTP rate limit notification', error);
    }
  }

  async getLastOTP({
    includeUsed = false,
  }: { includeUsed?: boolean } = {}): Promise<LastOTP | null> {
    const lastOTP = await storageService.get('lastOTP');

    if (
      lastOTP &&
      Date.now() >=
        Math.min(lastOTP.expiresAt ?? Infinity, lastOTP.extractedAt + LAST_OTP_MAX_AGE_MS)
    ) {
      log.debug('Last OTP expired');
      return null;
    }

    if (lastOTP && lastOTP.usedAt && !includeUsed) {
      log.debug('Last OTP already used');
      return null;
    }

    return lastOTP || null;
  }

  async clearLastOTP(): Promise<void> {
    const release = await this.acquireStoreLock();
    try {
      await storageService.remove('lastOTP');
      log.info('Last OTP cleared from storage');
    } finally {
      release();
    }
  }

  async isOTPFresh(): Promise<boolean> {
    const lastOTP = await storageService.get('lastOTP');
    if (!lastOTP) {
      return false;
    }
    const age = Date.now() - lastOTP.extractedAt;
    return (
      age < OTP_FRESHNESS.FRESH_WINDOW_MS &&
      Date.now() <
        Math.min(lastOTP.expiresAt ?? Infinity, lastOTP.extractedAt + LAST_OTP_MAX_AGE_MS) &&
      !lastOTP.usedAt
    );
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

  async markAsUsed(expectedCode?: string): Promise<void> {
    const release = await this.acquireStoreLock();
    try {
      const lastOTP = await storageService.get('lastOTP');
      if (!lastOTP) {
        return;
      }
      const normalize = (code: string) => code.replace(/[-\s]/g, '').toUpperCase();
      if (expectedCode !== undefined && normalize(expectedCode) !== normalize(lastOTP.code)) {
        return;
      }
      lastOTP.usedAt = Date.now();
      await storageService.set('lastOTP', lastOTP);
      log.debug('OTP marked as used');
    } finally {
      release();
    }
  }

  validateOTP(otp: string): boolean {
    const cleaned = otp.replace(/[-\s]/g, '');
    return /^[A-Z0-9]{4,10}$/i.test(cleaned);
  }
}

export const otpService = new OTPService();
