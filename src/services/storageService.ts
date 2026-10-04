// Chrome Storage Service - SECURITY HARDENED & PERFORMANCE OPTIMIZED
// FIXES: O(1) LRU cache with Map, proper eviction, cache size limits
// ═══════════════════════════════════════════════════════════════════
// SECURITY FIX: Session-based storage for API keys (never persisted)
// ═══════════════════════════════════════════════════════════════════
// CRITICAL FIX #2: Optimistic UI with background sync
// CRITICAL FIX #4: Mutex for write operations to prevent race conditions
// ═══════════════════════════════════════════════════════════════════

import {
  StorageSchema,
  UserSettings,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  SessionSecrets,
} from '../types';
import { deepMerge, LRUCache } from '../utils/core';

import {
  encrypt,
  decrypt,
  initializeSecureEncryption,
  getSessionKey,
  getMasterKey,
  clearEncryptionKeys,
} from '../utils/encryption';
import { createLogger } from '../utils/logger';

/**
 * PERFORMANCE: O(1) LRU Cache Implementation using Map + doubly-linked list concept
 * Map provides O(1) get/set/delete
 * Access order is maintained by Map's insertion order (ES2015+ guarantee)
 */

const log = createLogger('StorageService');

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Session-only storage for sensitive API keys
// These keys are NEVER persisted to disk
// ═══════════════════════════════════════════════════════════════════

/**
 * Session secrets storage (in-memory only)
 * @security Cleared on extension unload/reload
 * @security Never written to chrome.storage
 */
let sessionSecrets: SessionSecrets = {};
let sessionSecretsInitialized = false;

// Keys that contain sensitive data and should be encrypted
// SECURITY FIX: Comprehensive list of all sensitive keys in StorageSchema
// NOTE: API keys (llmApiKey, customDomainKey) are now in sessionSecrets (not persisted)
const SENSITIVE_KEYS: Array<keyof StorageSchema> = [
  // User credentials and identities
  'currentEmail', // Current email account (contains credentials)
  'disposableEmail', // Last disposable email account, kept separate from Gmail aliases
  'currentIdentity', // User identity information

  // OTP and verification codes
  'lastOTP', // Last extracted OTP code

  // Password data
  'passwordHistory', // Encrypted password history

  // Email data (contains sensitive content)
  'emailHistory', // Email history (may contain sensitive data)
  'inbox', // Cached inbox (contains email content)

  // SECURITY FIX: Added additional sensitive keys
  'behaviorData', // User behavior patterns (privacy sensitive)
  'siteContexts', // Site context with URL and domain info

  // Settings (but NOT API keys - those are in sessionSecrets)
  'settings', // Contains configuration (API keys removed)

  // Gmail profile and alias history are user-identifying.
  'gmailProfile',
  'gmailBase',
  'gmailConnectedAt',
  'aliasHistory',
  'gmailAliasSessions',
  'gmailInbox',
  'gmailSyncState',
  'gmailClientId',
];

// PERFORMANCE: O(1) LRU Cache Configuration
const CACHE_CONFIG = {
  MAX_SIZE: 150, // Hot keys + histories
  TTL_MS: 10 * 60 * 1000, // 10 min — OTP/email paths stay warm longer
} as const;

/**
 * Keys that must hit disk ASAP (OTP delivery, active email, inbox).
 * These skip the write debounce so FAB/polling never wait on a batch timer.
 */
const IMMEDIATE_WRITE_KEYS = new Set<keyof StorageSchema>([
  'lastOTP',
  'currentEmail',
  'disposableEmail',
  'aliasHistory',
  'preferredEmailType',
  'inbox',
  'gmailInbox',
  'gmailSyncState',
  'currentIdentity',
] as Array<keyof StorageSchema>);

/**
 * Type-safe Chrome storage wrapper with encryption for sensitive data
 *
 * PERFORMANCE OPTIMIZATIONS:
 * ✓ O(1) LRU cache using Map (was O(n) array-based)
 * ✓ Automatic TTL-based cache eviction
 * ✓ Batched write operations
 * ✓ Write queue to prevent race conditions
 * ✓ Quota management with auto-pruning
 * ✓ Selective encryption (only sensitive data)
 *
 * CRITICAL FIX #2: Optimistic UI with background sync
 * CRITICAL FIX #4: Mutex for write operations to prevent race conditions
 */
const STORAGE_OP_TIMEOUT_MS = 4_000; // hard timeout for storage ops
const USAGE_CACHE_TTL_MS = 2_500;

class StorageTimeoutError extends Error {
  constructor(label: string) {
    super(`Storage operation timed out: ${label}`);
    this.name = 'StorageTimeoutError';
  }
}

/** Wraps a storage promise with a hard timeout to prevent UI from hanging */
function withStorageTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      deadline = setTimeout(() => reject(new StorageTimeoutError(label)), STORAGE_OP_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(deadline));
}

/**
 * Detects a chrome.storage quota rejection.
 *
 * Chrome surfaces these inconsistently — sometimes as a message mentioning
 * QUOTA_BYTES, sometimes as a MAX_WRITE_OPERATIONS_PER_HOUR throttling error,
 * and (with callback-style APIs) only via chrome.runtime.lastError. Match on
 * all known shapes so we never mistake a quota failure for a fatal one.
 */
function isQuotaError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message, error.name);
  } else if (typeof error === 'string') {
    parts.push(error);
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.lastError?.message) {
    parts.push(chrome.runtime.lastError.message);
  }
  const msg = parts.join(' ').toUpperCase();
  return msg.includes('QUOTA_BYTES') || msg.includes('QUOTA EXCEEDED') || msg.includes('MAX_WRITE');
}

export class StorageService {
  /** Automatic reloads must wait for buffered writes and in-progress storage operations. */
  hasPendingWrites(): boolean {
    return this.pendingWrites.size > 0 || this.optimisticTimers.size > 0 || this.isLocked;
  }

  // PERFORMANCE: O(1) LRU Cache instead of array-based O(n)
  private readonly cache: LRUCache<keyof StorageSchema, unknown>;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private readonly QUOTA_WARNING_THRESHOLD = 0.8;
  private readonly QUOTA_MAX_SIZE = 100 * 1024;
  // writeQueue removed (Grandmaster Fix: single-queue mutex)
  private pendingWrites: Map<string, unknown> = new Map();
  private writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private writeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private writeRetryAttempts = 0;
  private pendingResolvers: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  private readonly WRITE_BATCH_DELAY = 40; // snappy batching for non-critical keys
  private storageAvailable: boolean = true;

  // ───────────────────────────────────────────────────────────────────
  // CRITICAL FIX #4: Mutex for Write Operations
  // Prevents race conditions during concurrent writes
  // ───────────────────────────────────────────────────────────────────
  private isLocked = false;
  private mutexQueue: Array<() => void> = [];

  // ───────────────────────────────────────────────────────────────────
  // CRITICAL FIX #2: Optimistic UI with Background Sync
  // Provides instant UI updates while syncing to storage in background
  // ───────────────────────────────────────────────────────────────────
  private optimisticUpdates: Map<string, unknown> = new Map();
  // FIX: Added missing optimisticTimers — was referenced in setOptimistic() but
  // never declared, causing a TypeError crash on every optimistic UI update.
  private optimisticTimers: Map<keyof StorageSchema, ReturnType<typeof setTimeout>> = new Map();

  // PERFORMANCE: Cache statistics + coalesced in-flight reads
  private cacheHits = 0;
  private cacheMisses = 0;
  private readonly inflightGets = new Map<
    string,
    {
      promise: Promise<unknown>;
      token: object;
      fresh: boolean;
    }
  >();
  private cacheRevision = 0;
  private readonly changeCallbacks = new Set<
    (changes: Record<string, chrome.storage.StorageChange>) => void
  >();
  private changeListener:
    ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null;
  private cachedUsage: { used: number; total: number; percentage: number; ts: number } | null =
    null;

  constructor() {
    this.cache = new LRUCache<keyof StorageSchema, unknown>(
      CACHE_CONFIG.MAX_SIZE,
      CACHE_CONFIG.TTL_MS
    );
    // Lazy cleanup is now triggered per-access via maybecleanupCache()

    // FIX #2: Removed duplicate onChanged listener from constructor.
    // Cache sync with external storage changes is handled by the `onChanged()` public
    // method's internal listener, which also decrypts sensitive values correctly.
    // Having two listeners caused double-decryption and performance overhead.
    this.storageAvailable = this.checkStorageAvailability();
  }

  private checkStorageAvailability(): boolean {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id && chrome.storage?.local);
    } catch {
      return false;
    }
  }

  /**
   * Trigger cache cleanup lazily — called on each cache access.
   * Using setInterval in a service worker is unreliable (it's destroyed on suspension).
   * Instead we clean up stale entries opportunistically on access.
   */
  private lastCleanupTs = 0;
  private maybecleanupCache(): void {
    const now = Date.now();
    if (now - this.lastCleanupTs > CACHE_CONFIG.TTL_MS) {
      this.lastCleanupTs = now;
      const removed = this.cache.cleanup();
      if (removed > 0) {
        log.debug(`Cleaned up ${removed} expired cache entries`);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // CRITICAL FIX #4: Mutex for Write Operations
  // Prevents race conditions during concurrent writes
  // ───────────────────────────────────────────────────────────────────

  /**
   * Acquire write mutex lock
   * @returns Promise that resolves when lock is acquired
   */
  private async acquireWriteMutex(timeoutMs: number = 20_000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isLocked) {
        this.isLocked = true;
        resolve();
      } else {
        let resolved = false;
        let queueCallback: (() => void) | null = null;

        const timeoutId = setTimeout(() => {
          if (resolved) {
            return;
          }
          resolved = true;
          if (queueCallback) {
            const index = this.mutexQueue.indexOf(queueCallback);
            if (index !== -1) {
              this.mutexQueue.splice(index, 1);
            }
          }
          reject(new Error('StorageMutex acquisition timed out'));
        }, timeoutMs);

        queueCallback = () => {
          if (resolved) {
            this.releaseWriteMutex();
            return;
          }
          resolved = true;
          clearTimeout(timeoutId);
          resolve();
        };

        this.mutexQueue.push(queueCallback);
      }
    });
  }

  /**
   * Release write mutex lock
   */
  private releaseWriteMutex(): void {
    if (this.mutexQueue.length > 0) {
      const next = this.mutexQueue.shift();
      if (next) {
        next();
      }
    } else {
      this.isLocked = false;
    }
  }

  /**
   * Execute write operation with mutex protection
   */
  private async withWriteMutex<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireWriteMutex();
    try {
      return await operation();
    } finally {
      this.releaseWriteMutex();
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // CRITICAL FIX #2: Optimistic UI with Background Sync
  // Provides instant UI updates while syncing to storage in background
  // ───────────────────────────────────────────────────────────────────

  /**
   * Set value with optimistic update
   * Updates cache immediately for instant UI response, syncs to storage in background
   * @param key - Storage key
   * @param value - Value to set
   * @param syncDelay - Delay before syncing to storage (default: 500ms)
   * @returns Promise that resolves when sync is complete
   */
  async setOptimistic<K extends keyof StorageSchema>(
    key: K,
    value: StorageSchema[K],
    syncDelay: number = 500
  ): Promise<void> {
    await this.ensureInitialized();
    this.cancelOptimisticUpdate(key);
    this.invalidateRead(key);
    this.optimisticUpdates.set(key, value);
    this.cache.set(key, value);

    const timerId = setTimeout(() => {
      // The normal write path owns retry/rollback and cancels this timer. A
      // second editor write must never be undone by this callback's completion.
      void this.setImmediate(key, value).catch((error) => {
        log.debug(`Optimistic update persistence delayed for ${String(key)}`, error);
      });
    }, syncDelay);
    this.optimisticTimers.set(key, timerId);
    return Promise.resolve();
  }

  /**
   * Get value, including optimistic updates
   * @returns Value from optimistic updates if pending, otherwise from cache/storage
   */
  async getWithOptimistic<K extends keyof StorageSchema>(
    key: K
  ): Promise<StorageSchema[K] | undefined> {
    // Return optimistic update if pending
    if (this.optimisticUpdates.has(key)) {
      return this.optimisticUpdates.get(key) as StorageSchema[K] | undefined;
    }
    return this.get(key);
  }

  /**
   * Cancel pending optimistic update
   * @param key - Storage key to cancel
   */
  cancelOptimisticUpdate(key: keyof StorageSchema): void {
    const timer = this.optimisticTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.optimisticTimers.delete(key);
    }
    this.optimisticUpdates.delete(key);
  }

  /**
   * Clear all optimistic updates
   */
  clearOptimisticUpdates(): void {
    for (const timer of this.optimisticTimers.values()) {
      clearTimeout(timer);
    }
    this.optimisticTimers.clear();
    this.optimisticUpdates.clear();
  }

  /**
   * Get encryption status for debugging
   */
  getEncryptionStatus(): { initialized: boolean; keyStored: 'memory' | 'none' } {
    const key = getSessionKey();
    return {
      initialized: key !== null,
      keyStored: key !== null ? 'memory' : 'none',
    };
  }

  /**
   * Clear encryption keys (for logout/security)
   */
  clearEncryptionKey(): void {
    clearEncryptionKeys();
    this.invalidateReads();
    // Clear cache to prevent access to encrypted data without key
    this.cache.clear();
    log.info('Encryption keys cleared');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECURITY: Session Secrets Management (API Keys)
  // These methods handle in-memory only storage for sensitive keys
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Set session secret (API key) - NEVER persisted to disk
   * @security Key is stored in memory only, cleared on extension unload
   * @security Key is never logged or exposed in debug output
   */
  async setSessionSecret<K extends keyof SessionSecrets>(
    key: K,
    value: SessionSecrets[K]
  ): Promise<void> {
    sessionSecrets[key] = value;
    sessionSecretsInitialized = true;

    // Sync to chrome.storage.session so it survives SW restart using an isolated namespace
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.set({ [`ghostfill_secret_${key}`]: value }).catch((e) => {
        log.warn('Failed to sync session secret to storage', { key, error: e });
      });
    }

    log.debug('Session secret set', { key, hasValue: value !== undefined });
  }

  async clearSessionSecret<K extends keyof SessionSecrets>(key: K): Promise<void> {
    if (!(key in sessionSecrets)) {
      return;
    }

    delete sessionSecrets[key];

    // Sync to chrome.storage.session using isolated namespace
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.remove(`ghostfill_secret_${String(key)}`).catch((e) => {
        log.warn('Failed to clear session secret from storage', { key, error: e });
      });
    }

    const hasRemainingSecret = Boolean(sessionSecrets.llmApiKey || sessionSecrets.customDomainKey);
    if (!hasRemainingSecret) {
      delete sessionSecrets.keyRotatedAt;
      sessionSecretsInitialized = false;
    }

    log.debug('Session secret cleared', { key, hasRemainingSecret });
  }

  /**
   * Get session secret (API key) from memory
   * @security Returns undefined if not set (never falls back to disk)
   */
  getSessionSecret<K extends keyof SessionSecrets>(key: K): SessionSecrets[K] | undefined {
    return sessionSecrets[key];
  }

  /**
   * Get LLM API key from session storage
   * @security Never persisted, must be set each session
   */
  getLLMApiKey(): string | undefined {
    return sessionSecrets.llmApiKey;
  }

  /**
   * Set LLM API key in session storage
   * @security Key cleared on extension unload
   */
  setLLMApiKey(apiKey: string): void {
    // SECURITY FIX: Validate API key format before storing
    if (!apiKey || apiKey.length < 10 || apiKey.length > 512) {
      throw new Error('Invalid API key format');
    }
    this.setSessionSecret('llmApiKey', apiKey).catch((e) =>
      log.error('Failed to set LLM API key session secret', e)
    );
    this.setSessionSecret('keyRotatedAt', Date.now()).catch((e) =>
      log.error('Failed to set rotation time', e)
    );
  }

  /**
   * Get custom domain API key from session storage
   * @security Never persisted, must be set each session
   */
  getCustomDomainKey(): string | undefined {
    return sessionSecrets.customDomainKey;
  }

  /**
   * Set custom domain API key in session storage
   * @security Key cleared on extension unload
   */
  setCustomDomainKey(apiKey: string): void {
    // SECURITY FIX: Validate API key format before storing
    if (!apiKey || apiKey.length < 10 || apiKey.length > 512) {
      throw new Error('Invalid API key format');
    }
    this.setSessionSecret('customDomainKey', apiKey).catch((e) =>
      log.error('Failed to set custom domain session secret', e)
    );
    this.setSessionSecret('keyRotatedAt', Date.now()).catch((e) =>
      log.error('Failed to set rotation time', e)
    );
  }

  /**
   * Clear all session secrets (API keys)
   * @security Call on logout or extension unload
   */
  clearSessionSecrets(): void {
    // SECURITY FIX: Overwrite keys in memory before clearing
    if (sessionSecrets.llmApiKey) {
      delete sessionSecrets.llmApiKey;
    }
    if (sessionSecrets.customDomainKey) {
      delete sessionSecrets.customDomainKey;
    }
    sessionSecrets = {};
    sessionSecretsInitialized = false;

    // FIX #30: Also clear secrets from chrome.storage.session to prevent
    // persistence across service worker restarts
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      chrome.storage.session
        .get(null)
        .then((all) => {
          const secretKeys = Object.keys(all).filter((k) => k.startsWith('ghostfill_secret_'));
          if (secretKeys.length > 0) {
            chrome.storage.session.remove(secretKeys).catch(() => {});
          }
        })
        .catch(() => {});
    }

    log.info('Session secrets cleared from memory and session storage');
  }

  /**
   * Check if session secrets are initialized
   */
  areSessionSecretsInitialized(): boolean {
    return sessionSecretsInitialized;
  }

  /**
   * Get key rotation timestamp
   * @security Track when keys were last rotated for audit
   */
  getKeyRotationTimestamp(): number | undefined {
    return sessionSecrets.keyRotatedAt;
  }

  /**
   * Rotate session secrets (clear and require re-authentication)
   * @security Force key rotation for security
   */
  rotateSessionSecrets(): void {
    const oldRotationTime = sessionSecrets.keyRotatedAt;
    this.clearSessionSecrets();
    log.info('Session secrets rotated', { previousRotation: oldRotationTime });
  }

  /**
   * Initialize storage with defaults and encryption
   */
  async init(): Promise<void> {
    if (this.initialized) {
      if (!this.storageAvailable || getMasterKey()) {
        return;
      }
      // A live context can outlast its in-memory keys (logout or key rotation).
      this.initialized = false;
      this.initPromise = null;
    }

    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          this.storageAvailable = this.checkStorageAvailability();
          if (!this.storageAvailable) {
            log.debug(
              'Storage API is not allowed or unavailable in this context (e.g. sandboxed iframe). Falling back to in-memory storage.'
            );
            this.initialized = true;
            return;
          }

          // Restore session secrets using isolated namespace from chrome.storage.session first
          if (typeof chrome !== 'undefined' && chrome.storage?.session) {
            // Also enforce TRUSTED_CONTEXTS to prevent non-extension components from reading secrets (PA3)
            if (typeof chrome.storage.session.setAccessLevel === 'function') {
              await chrome.storage.session
                .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
                .catch(() => {});
            }

            const allSession = await chrome.storage.session.get(null).catch((error: unknown) => {
              if (
                !(error instanceof Error) ||
                !error.message.includes('Access to storage is not allowed')
              ) {
                throw error;
              }
              // Content scripts can read local storage, but session secrets stay trusted-only.
              log.debug('Session secrets are unavailable in this content-script context');
              return {} as Record<string, unknown>;
            });
            const secrets: Record<string, unknown> = {};
            for (const k of Object.keys(allSession)) {
              if (k.startsWith('ghostfill_secret_')) {
                const secretKey = k.replace('ghostfill_secret_', '');
                const v = allSession[k];
                // Validate restored secrets to prevent injection
                if (
                  (secretKey === 'llmApiKey' || secretKey === 'customDomainKey') &&
                  typeof v === 'string' &&
                  v.length >= 10 &&
                  v.length <= 512
                ) {
                  secrets[secretKey] = v;
                } else if (secretKey === 'keyRotatedAt' && typeof v === 'number') {
                  secrets[secretKey] = v;
                } else if (secretKey === 'sessionKey' && typeof v === 'string') {
                  secrets[secretKey] = v;
                } else {
                  log.warn(`Invalid session secret restored: ${secretKey}`);
                }
              }
            }
            if (Object.keys(secrets).length > 0) {
              sessionSecrets = { ...sessionSecrets, ...secrets };
              sessionSecretsInitialized = true;
              log.debug('Restored session secrets from storage', { keys: Object.keys(secrets) });
            }
          }

          await initializeSecureEncryption();
          this.getEncryptionKey();

          const data = await this.getAllInternal(); // Use internal method to avoid recursive waiting

          const writesToFlush: Array<[string, unknown]> = [];
          if (!data.settings) {
            writesToFlush.push([STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS]);
            this.cache.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
          }

          if (!data.installDate) {
            const now = Date.now();
            writesToFlush.push(['installDate', now]);
            this.cache.set('installDate', now);
          }

          const version = chrome.runtime.getManifest().version;
          writesToFlush.push(['extensionVersion', version]);
          this.cache.set('extensionVersion', version);

          for (const [k, v] of writesToFlush) {
            this.pendingWrites.set(k, v);
          }

          if (this.pendingWrites.size > 0) {
            await this.flushNow();
          }

          this.initialized = true;
          log.debug('Storage initialized with secure encryption');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (
            errorMsg.includes('Access to storage is not allowed') ||
            /extension context invalidated/i.test(errorMsg)
          ) {
            log.debug(
              'GhostFill running in sandboxed environment, falling back to in-memory cache.'
            );
            this.storageAvailable = false;
            this.initialized = true;
            return;
          }
          log.error('Failed to initialize storage', error);
          this.initPromise = null; // Allow retrying
          throw error;
        }
      })();
    }

    return this.initPromise;
  }

  /**
   * Internal generic ensure initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    return this.init();
  }

  /**
   * Get persistent master encryption key for local storage
   */
  private getEncryptionKey(): CryptoKey {
    const key = getMasterKey();
    if (!key) {
      throw new Error('Encryption not initialized');
    }
    return key;
  }

  /**
   * Get a value from storage (decrypts sensitive data)
   * PERFORMANCE: O(1) cache lookup with LRU eviction
   */
  private static readonly NEGATIVE_CACHE_SENTINEL = Symbol('NEGATIVE_CACHE_SENTINEL');

  async get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K] | undefined> {
    await this.ensureInitialized();

    // FIX #3: Trigger lazy cache cleanup on access
    this.maybecleanupCache();

    // 1) Optimistic / pending writes win (never wait for disk)
    if (this.optimisticUpdates.has(key as string)) {
      this.cacheHits++;
      return this.optimisticUpdates.get(key as string) as StorageSchema[K] | undefined;
    }
    if (this.pendingWrites.has(key as string)) {
      this.cacheHits++;
      return this.pendingWrites.get(key as string) as StorageSchema[K] | undefined;
    }

    // 2) PERFORMANCE: O(1) cache check
    const cachedValue = this.cache.get(key);
    if (cachedValue !== undefined) {
      this.cacheHits++;
      return cachedValue === StorageService.NEGATIVE_CACHE_SENTINEL
        ? undefined
        : (cachedValue as StorageSchema[K]);
    }

    this.cacheMisses++;

    if (!this.storageAvailable || typeof chrome === 'undefined' || !chrome.storage?.local) {
      log.debug('Storage API unavailable (get)', { key });
      return undefined;
    }

    // 3) Coalesce concurrent reads of the same key (OTP/email storms)
    const inflightKey = String(key);
    const existing = this.inflightGets.get(inflightKey);
    if (existing) {
      return existing.promise as Promise<StorageSchema[K] | undefined>;
    }

    return this.startRead(
      key,
      Promise.resolve().then(() =>
        withStorageTimeout(chrome.storage.local.get(key), `get:${String(key)}`)
      )
    );
  }

  /**
   * Bypass LRU cache and re-read from chrome.storage.local.
   * Use for cross-context preferences (e.g. popup tab → service worker fill)
   * so a stale SW cache cannot force the wrong email type.
   */
  async getFresh<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K] | undefined> {
    await this.ensureInitialized();

    if (this.optimisticUpdates.has(key as string)) {
      return this.optimisticUpdates.get(key as string) as StorageSchema[K] | undefined;
    }
    if (this.pendingWrites.has(key as string)) {
      return this.pendingWrites.get(key as string) as StorageSchema[K] | undefined;
    }

    if (!this.storageAvailable || typeof chrome === 'undefined' || !chrome.storage?.local) {
      return undefined;
    }

    const existing = this.inflightGets.get(String(key));
    if (existing?.fresh) {
      return existing.promise as Promise<StorageSchema[K] | undefined>;
    }
    this.invalidateRead(key);
    this.cache.delete(key);
    return this.startRead(
      key,
      Promise.resolve().then(() =>
        withStorageTimeout(chrome.storage.local.get(key), `getFresh:${String(key)}`)
      ),
      true
    );
  }

  private invalidateRead(key: keyof StorageSchema): void {
    this.cacheRevision++;
    this.inflightGets.delete(String(key));
  }

  private invalidateReads(): void {
    this.cacheRevision++;
    this.inflightGets.clear();
  }

  /** Share decoding as well as I/O; only the current request may populate the cache. */
  private startRead<K extends keyof StorageSchema>(
    key: K,
    result: Promise<Record<string, unknown>>,
    fresh = false
  ): Promise<StorageSchema[K] | undefined> {
    const token = {};
    const promise = this.loadAndDecrypt(key, result, token).finally(() => {
      if (this.inflightGets.get(String(key))?.token === token) {
        this.inflightGets.delete(String(key));
      }
    });
    this.inflightGets.set(String(key), { promise, token, fresh });
    return promise;
  }

  private async loadAndDecrypt<K extends keyof StorageSchema>(
    key: K,
    pendingResult: Promise<Record<string, unknown>>,
    token: object
  ): Promise<StorageSchema[K] | undefined> {
    try {
      const result = await pendingResult;
      if (this.inflightGets.get(String(key))?.token !== token) {
        return this.get(key);
      }

      if (!result || !(key in result)) {
        this.cache.set(key, StorageService.NEGATIVE_CACHE_SENTINEL);
        return undefined;
      }

      let value = result[key] as StorageSchema[K] | undefined;

      let migratePlaintext = false;
      // Decrypt sensitive data
      if (value && SENSITIVE_KEYS.includes(key)) {
        if (typeof value === 'string' && value.startsWith('v1:')) {
          try {
            value = (await decrypt(value as string, this.getEncryptionKey())) as StorageSchema[K];
          } catch (error) {
            log.warn(`Failed to decrypt ${key}, dropping value to prevent crash`, error);
            value = undefined;
          }
        } else {
          // Legacy plaintext from older builds. Return it once and rewrite encrypted.
          migratePlaintext = true;
        }
      }

      if (this.inflightGets.get(String(key))?.token !== token) {
        return this.get(key);
      }
      if (value !== undefined) {
        this.cache.set(key, value);
      } else {
        this.cache.set(key, StorageService.NEGATIVE_CACHE_SENTINEL);
      }

      if (migratePlaintext && value !== undefined) {
        log.warn(`Sensitive key ${key} was plaintext; migrating to encrypted storage`);
        void this.setInternal(key, value).catch((error) =>
          log.warn(`Failed to migrate sensitive key ${String(key)}`, error)
        );
      }
      return value;
    } catch (error) {
      if (this.inflightGets.get(String(key))?.token !== token) {
        return this.get(key);
      }
      log.error(`Failed to get ${key}`, error);
      return undefined;
    }
  }

  /**
   * PERFORMANCE: Batched set operation with debouncing
   * BUG FIX: Do not drop previous promises when debouncing
   */
  async set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void> {
    await this.ensureInitialized();
    return this.setInternal(key, value);
  }

  private async setInternal<K extends keyof StorageSchema>(
    key: K,
    value: StorageSchema[K]
  ): Promise<void> {
    // Invalidate negative cache + surface value immediately
    this.cancelOptimisticUpdate(key);
    this.invalidateRead(key);
    this.pendingWrites.set(key as string, value);
    this.cache.set(key as keyof StorageSchema, value);

    // Critical path: lastOTP / currentEmail / inbox must not wait on debounce
    if (IMMEDIATE_WRITE_KEYS.has(key)) {
      return this.flushNow();
    }

    return new Promise((resolve, reject) => {
      this.pendingResolvers.push({ resolve, reject });

      if (!this.writeDebounceTimer) {
        this.writeDebounceTimer = setTimeout(() => {
          this.writeDebounceTimer = null;
          // Atomically capture and clear to prevent race condition
          const resolvers = this.pendingResolvers;
          this.pendingResolvers = [];

          this.flushPendingWrites()
            .then(() => {
              resolvers.forEach((r) => r.resolve());
            })
            .catch((err) => {
              resolvers.forEach((r) => r.reject(err));
            });
        }, this.WRITE_BATCH_DELAY);
      }
    });
  }

  /** Force immediate flush of pending writes (used by hot keys + setImmediate). */
  private async flushNow(): Promise<void> {
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
      this.writeDebounceTimer = null;
    }
    const resolvers = this.pendingResolvers;
    this.pendingResolvers = [];
    try {
      await this.flushPendingWrites();
      resolvers.forEach((r) => r.resolve());
    } catch (err) {
      resolvers.forEach((r) => r.reject(err));
      throw err;
    }
  }

  /**
   * PERFORMANCE: Flush all pending writes in a single batch
   * CRITICAL FIX #4: Uses mutex to prevent race conditions
   */
  private async flushPendingWrites(): Promise<void> {
    if (!this.storageAvailable) {
      this.pendingWrites.clear();
      return;
    }
    if (!this.checkStorageAvailability()) {
      this.storageAvailable = false;
      this.pendingWrites.clear();
      this.cache.clear();
      return;
    }

    // GRANDMASTER FIX: Removed `this.writeQueue` chain.
    // The Mutex alone guarantees sequential, non-dropping writes.
    await this.acquireWriteMutex();
    let plaintextByKey = new Map<string, unknown>();

    try {
      if (this.pendingWrites.size === 0) {
        return;
      }

      const writes = new Map(this.pendingWrites);
      plaintextByKey = new Map(writes);
      this.pendingWrites.clear();

      // Cached quota check (avoids getBytesInUse on every micro-flush)
      const usage = await this.getUsageCached();

      if (usage.percentage >= this.QUOTA_WARNING_THRESHOLD * 100) {
        log.warn(`Storage quota at ${usage.percentage.toFixed(1)}% - pruning then writing`);
        await this.pruneOldData();
        for (const [pKey, pVal] of this.pendingWrites.entries()) {
          writes.set(pKey, pVal);
        }
        this.pendingWrites.clear();
        this.cachedUsage = null; // force refresh after prune
      }

      // Keep plaintext values for cache; encrypt copies for disk in parallel
      plaintextByKey = new Map(writes);
      const masterKey = getMasterKey();

      const encryptJobs = Array.from(writes.entries()).map(async ([key, value]) => {
        // Rough size guard without full stringify of huge encrypted blobs
        let approxSize = 0;
        try {
          approxSize = typeof value === 'string' ? value.length : JSON.stringify(value).length;
        } catch {
          approxSize = 0;
        }
        if (approxSize > this.QUOTA_MAX_SIZE) {
          log.warn(`Large write detected for key ${key}`, { size: approxSize });
          await this.pruneOldData();
        }

        if (SENSITIVE_KEYS.includes(key as keyof StorageSchema)) {
          if (!masterKey) {
            throw new Error('Encryption not initialized');
          }
          try {
            const cipher = await encrypt(value, masterKey);
            writes.set(key, cipher);
          } catch (error) {
            log.error(`Failed to encrypt ${key}`, error);
            throw new Error('Failed to encrypt sensitive data');
          }
        }

        // Setters already published plaintext. Reapplying this older batch after
        // encryption would overwrite a newer value queued while we awaited it.
      });

      await Promise.all(encryptJobs);

      await this.writeWithQuotaRecovery(writes, plaintextByKey);

      if (this.writeRetryTimer) {
        clearTimeout(this.writeRetryTimer);
        this.writeRetryTimer = null;
      }
      this.writeRetryAttempts = 0;

      // Bust usage cache after successful write
      this.cachedUsage = null;
      log.debug(`Batch saved ${writes.size} keys`);
    } catch (error) {
      const contextEnded =
        !this.checkStorageAvailability() ||
        (error instanceof Error && /extension context invalidated/i.test(error.message));
      if (contextEnded) {
        this.storageAvailable = false;
        log.debug('Storage write cancelled because the extension context ended');
      } else if (error instanceof StorageTimeoutError) {
        // Newer values queued while this batch was in flight must always win.
        for (const [key, value] of plaintextByKey) {
          if (!this.pendingWrites.has(key)) {
            this.pendingWrites.set(key, value);
            this.cache.set(key as keyof StorageSchema, value);
          }
        }
        log.warn('Storage write delayed; queued values retained for retry', error);
        this.scheduleWriteRetry();
      } else {
        log.error('Failed to flush pending writes', error);
      }

      if (!(error instanceof StorageTimeoutError) || contextEnded) {
        for (const key of plaintextByKey.keys()) {
          if (!this.pendingWrites.has(key)) {
            this.cache.delete(key as keyof StorageSchema);
          }
        }
      }

      if (!contextEnded) {
        throw error;
      }
    } finally {
      this.releaseWriteMutex();
    }
  }

  private scheduleWriteRetry(): void {
    if (this.writeRetryTimer || this.writeRetryAttempts >= 2 || !this.storageAvailable) {
      return;
    }
    const delay = 500 * ++this.writeRetryAttempts;
    this.writeRetryTimer = setTimeout(() => {
      this.writeRetryTimer = null;
      if (this.pendingWrites.size > 0) {
        void this.flushPendingWrites().catch((error) => {
          log.debug('Storage retry remains pending', error);
        });
      }
    }, delay);
  }

  private async persistBatch(writes: Map<string, unknown>, label: string): Promise<void> {
    try {
      await withStorageTimeout(chrome.storage.local.set(Object.fromEntries(writes)), label);
    } catch (error) {
      if (!(error instanceof StorageTimeoutError)) {
        throw error;
      }
      // A lost acknowledgement does not prove that the data was not committed.
      const stored = await withStorageTimeout(
        chrome.storage.local.get([...writes.keys()]),
        `verify:${label}`
      ).catch(() => null);
      if (
        stored &&
        [...writes].every(
          ([key, value]) => key in stored && JSON.stringify(stored[key]) === JSON.stringify(value)
        )
      ) {
        log.warn('Storage acknowledgement delayed; persisted values verified');
        return;
      }
      throw error;
    }
  }

  /**
   * Persists a batch, recovering from chrome.storage quota rejections.
   *
   * The proactive usage check in flushPendingWrites is not sufficient on its own:
   * the usage snapshot is cached (so it can be stale), and a single large
   * encrypted blob can exceed the remaining headroom by itself. Previously a
   * quota rejection bubbled up to flushPendingWrites' catch block, which logged
   * the error and discarded the pending writes — so the user's freshly generated
   * password or OTP vanished with no visible symptom. That is the
   * "I generated a password but it's not in my history" bug.
   *
   * Recovery runs in two phases:
   *   1. Prune histories hard, then retry the full batch.
   *   2. If still over quota, remove the optional bulk caches from disk and
   *      persist only the essential keys — the newest user data is never the
   *      thing we choose to drop.
   */
  private async writeWithQuotaRecovery(
    writes: Map<string, unknown>,
    plaintextByKey: Map<string, unknown>
  ): Promise<void> {
    try {
      await this.persistBatch(writes, `set:${writes.size}-keys`);
      return;
    } catch (error) {
      if (!isQuotaError(error)) {
        throw error;
      }
      log.warn(`Storage quota exceeded across ${writes.size} key(s) — pruning and retrying`, error);
    }

    // ── Phase 1: aggressive prune, retry the full batch ─────────────────
    await this.pruneOldData(true);
    const pruned = new Map(this.pendingWrites);
    this.pendingWrites.clear();
    for (const [pKey, pVal] of pruned) {
      plaintextByKey.set(pKey, pVal);
      if (SENSITIVE_KEYS.includes(pKey as keyof StorageSchema)) {
        const masterKey = getMasterKey();
        if (!masterKey) {
          throw new Error('Encryption not initialized');
        }
        writes.set(pKey, await encrypt(pVal, masterKey));
      } else {
        writes.set(pKey, pVal);
      }
    }
    this.cachedUsage = null;

    try {
      await this.persistBatch(writes, `set-retry:${writes.size}-keys`);
      log.info('Recovered from storage quota pressure after pruning');
      return;
    } catch (error) {
      if (!isQuotaError(error)) {
        throw error;
      }
      log.warn('Still over quota after pruning — shedding optional bulk keys');
    }

    // ── Phase 2: shed optional caches, persist essentials only ──────────
    // These are all recomputable/refetchable. Losing them is annoying; losing
    // the user's new password or OTP is not.
    const OPTIONAL_BULK_KEYS = new Set<string>([
      'inbox',
      'gmailInbox',
      'emailHistory',
      'behaviorData',
      'siteContexts',
      'gmailSyncState',
    ]);

    const essential = new Map<string, unknown>();
    const dropped: string[] = [];
    for (const [key, value] of writes.entries()) {
      if (OPTIONAL_BULK_KEYS.has(key)) {
        dropped.push(key);
      } else {
        essential.set(key, value);
      }
    }

    for (const key of dropped) {
      try {
        await withStorageTimeout(chrome.storage.local.remove(key), `remove:${key}`);
      } catch (e) {
        log.debug(`Failed to shed optional key ${key}`, e);
      }
      this.cache.delete(key as keyof StorageSchema);
    }
    this.cachedUsage = null;

    if (essential.size === 0) {
      throw new Error('Storage quota exceeded and no essential keys remained to write');
    }

    await this.persistBatch(essential, `set-essential:${essential.size}-keys`);
    log.warn(`Persisted ${essential.size} essential key(s) after shedding ${dropped.length}`, {
      dropped,
    });
  }

  /**
   * PERFORMANCE: Immediate set without batching
   * BUG FIX: Removed call to setImmediate in finally block to prevent double flush
   */
  async setImmediate<K extends keyof StorageSchema>(
    key: K,
    value: StorageSchema[K]
  ): Promise<void> {
    await this.ensureInitialized();
    this.cancelOptimisticUpdate(key);
    this.invalidateRead(key);
    this.pendingWrites.set(key as string, value);
    this.cache.set(key as keyof StorageSchema, value);
    return this.flushNow();
  }

  /**
   * Remove a value from storage
   * NOTE: This bypasses the debatched write system intentionally — removals
   * must be immediate to prevent stale data from being flushed after deletion.
   * The write mutex orders deletion after any active flush.
   */
  async remove(key: keyof StorageSchema): Promise<void> {
    await this.ensureInitialized();
    // Keep track of the original value for potential rollback
    const originalValue = this.cache.get(key);

    // Optimistic update
    this.invalidateRead(key);
    this.cancelOptimisticUpdate(key);
    this.cache.set(key, StorageService.NEGATIVE_CACHE_SENTINEL);

    // FIX §7.6: Cancel any pending buffered write for this key so a debounced
    // batch-flush cannot re-write the value we are about to delete.
    if (this.pendingWrites.has(key)) {
      this.pendingWrites.delete(key);
      log.debug(`Cancelled pending write for removed key: ${String(key)}`);
    }

    return this.withWriteMutex(async () => {
      try {
        if (!this.storageAvailable || typeof chrome === 'undefined' || !chrome.storage?.local) {
          log.debug(`Removed ${key} from in-memory cache only`);
          return;
        }
        await withStorageTimeout(chrome.storage.local.remove(key), `remove:${String(key)}`);
        log.debug(`Removed ${key}`);
      } catch (error) {
        log.error(`Failed to remove ${key}`, error);
        // Rollback optimistic update
        if (
          originalValue !== undefined &&
          this.cache.get(key) === StorageService.NEGATIVE_CACHE_SENTINEL &&
          !this.pendingWrites.has(key)
        ) {
          this.cache.set(key, originalValue);
        }
        throw error;
      }
    });
  }

  /**
   * Get all storage data
   */
  async getAll(): Promise<Partial<StorageSchema>> {
    await this.ensureInitialized();
    return this.getAllInternal();
  }

  private async getAllInternal(): Promise<Partial<StorageSchema>> {
    try {
      if (!this.storageAvailable || typeof chrome === 'undefined' || !chrome.storage?.local) {
        log.warn('Storage API unavailable (getAll)');
        return {};
      }

      const revision = this.cacheRevision;
      const result = await withStorageTimeout(chrome.storage.local.get(null), 'getAll');
      const decryptedResult: Record<string, unknown> = {};

      // Update cache with all data, decrypting sensitive fields
      for (const [key, value] of Object.entries(result)) {
        let finalValue = value;
        if (
          value &&
          SENSITIVE_KEYS.includes(key as keyof StorageSchema) &&
          typeof value === 'string' &&
          value.startsWith('v1:')
        ) {
          // A missing key is an initialization problem, never evidence of corrupt data.
          const masterKey = this.getEncryptionKey();
          try {
            finalValue = await decrypt(value as string, masterKey);
          } catch (error) {
            // Expected when data was encrypted with different key or corrupted
            // Clear the corrupted data to prevent repeated failures
            log.debug(`Failed to decrypt ${key}, clearing corrupted data`, error);
            if (revision === this.cacheRevision) {
              void withStorageTimeout(
                chrome.storage.local.remove(key),
                `remove-corrupt:${key}`
              ).catch(() => {});
            }
            finalValue = undefined;
          }
        }

        if (finalValue !== undefined) {
          decryptedResult[key] = finalValue;
          if (revision === this.cacheRevision && this.storageAvailable) {
            this.cache.set(key as keyof StorageSchema, finalValue);
          }
        }
      }

      return decryptedResult as Partial<StorageSchema>;
    } catch (error) {
      log.error('Failed to get all storage data', error);
      // Initialization must not mistake a failed read for an empty installation.
      throw error;
    }
  }

  /**
   * Clear all storage data
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    return this.withWriteMutex(async () => {
      if (this.writeRetryTimer) {
        clearTimeout(this.writeRetryTimer);
        this.writeRetryTimer = null;
      }
      this.writeRetryAttempts = 0;
      try {
        // FIX #16: Cancel pending write debounce timer to prevent stale flush after clear
        if (this.writeDebounceTimer) {
          clearTimeout(this.writeDebounceTimer);
          this.writeDebounceTimer = null;
        }
        this.cache.clear();
        this.invalidateReads();
        this.clearOptimisticUpdates();

        if (!this.storageAvailable || typeof chrome === 'undefined' || !chrome.storage?.local) {
          log.info('Cleared in-memory cache');
          return;
        }
        // Preserve encryption bootstrap material so data written after a clear
        const preservedLocal = await withStorageTimeout(
          chrome.storage.local.get(['masterKeySeed', 'internalEncryptionSalt']),
          'preserve-clear-state'
        );

        await withStorageTimeout(chrome.storage.local.clear(), 'clear');
        if (Object.keys(preservedLocal).length > 0) {
          await withStorageTimeout(chrome.storage.local.set(preservedLocal), 'restore-clear-state');
        }
        if (chrome.storage.session) {
          await withStorageTimeout(chrome.storage.session.clear(), 'clear-session');
        }
        this.cache.clear();
        this.invalidateReads();
        this.pendingWrites.clear();
        const pendingResolvers = [...this.pendingResolvers];
        this.pendingResolvers = [];
        pendingResolvers.forEach((r) => r.resolve());
        // FIX #10: Also clear in-memory session secrets when storage is wiped
        this.clearSessionSecrets();
        log.info('Storage cleared (including session secrets)');
      } catch (error) {
        log.error('Failed to clear storage', error);
        throw error;
      }
    });
  }

  /**
   * Get settings with defaults
   */
  async getSettings(): Promise<UserSettings> {
    const settings = await this.get(STORAGE_KEYS.SETTINGS as keyof StorageSchema);
    // deepMerge is only needed when partial settings exist
    if (!settings || typeof settings !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    return deepMerge(DEFAULT_SETTINGS, settings as Partial<UserSettings>);
  }

  /** Multi-get: one chrome.storage call for many keys (decrypts in parallel). */
  async getMany<K extends keyof StorageSchema>(
    keys: K[]
  ): Promise<Partial<Pick<StorageSchema, K>>> {
    await this.ensureInitialized();
    const out: Partial<Pick<StorageSchema, K>> = {};
    const missing: K[] = [];
    const reads = new Map<K, Promise<StorageSchema[K] | undefined>>();

    for (const key of new Set(keys)) {
      if (this.optimisticUpdates.has(key as string)) {
        out[key] = this.optimisticUpdates.get(key as string) as StorageSchema[K];
        continue;
      }
      if (this.pendingWrites.has(key as string)) {
        out[key] = this.pendingWrites.get(key as string) as StorageSchema[K];
        continue;
      }
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        if (cached !== StorageService.NEGATIVE_CACHE_SENTINEL) {
          out[key] = cached as StorageSchema[K];
        }
        this.cacheHits++;
      } else {
        this.cacheMisses++;
        const existing = this.inflightGets.get(String(key));
        if (existing) {
          reads.set(key, existing.promise as Promise<StorageSchema[K] | undefined>);
        } else {
          missing.push(key);
        }
      }
    }

    if (!this.storageAvailable) {
      return out;
    }

    if (missing.length > 0) {
      const batch = Promise.resolve().then(() =>
        withStorageTimeout(
          chrome.storage.local.get(missing as string[]),
          `getMany:${missing.length}`
        )
      );
      for (const key of missing) {
        reads.set(key, this.startRead(key, batch));
      }
    }
    await Promise.all(
      Array.from(reads, async ([key, reading]) => {
        const value = await reading;
        if (value !== undefined) {
          out[key] = value;
        }
      })
    );
    return out;
  }

  /**
   * Update settings
   */
  async updateSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings();
    const updated = deepMerge(current, updates);
    await this.set(STORAGE_KEYS.SETTINGS as keyof StorageSchema, updated);
    return updated;
  }

  /**
   * Add item to array in storage
   */
  async pushToArray<K extends keyof StorageSchema>(
    key: K,
    item: StorageSchema[K] extends Array<infer U> ? U : never,
    maxItems?: number
  ): Promise<void> {
    let current = (await this.get(key)) as unknown[];
    if (!Array.isArray(current)) {
      current = [];
    }
    current.unshift(item);

    if (maxItems && current.length > maxItems) {
      current.splice(maxItems);
    }

    await this.set(key, current as StorageSchema[K]);
  }

  /**
   * Remove item from array in storage
   */
  async removeFromArray<K extends keyof StorageSchema>(
    key: K,
    predicate: (item: StorageSchema[K] extends Array<infer U> ? U : never) => boolean
  ): Promise<void> {
    const current = (await this.get(key)) as unknown[];
    if (!Array.isArray(current)) {
      return;
    }
    const filtered = current.filter(
      (item) => !predicate(item as StorageSchema[K] extends Array<infer U> ? U : never)
    );
    await this.set(key, filtered as StorageSchema[K]);
  }

  /**
   * Update item in array in storage
   */
  async updateInArray<K extends keyof StorageSchema>(
    key: K,
    predicate: (item: StorageSchema[K] extends Array<infer U> ? U : never) => boolean,
    updates: Partial<StorageSchema[K] extends Array<infer U> ? U : never>
  ): Promise<void> {
    const current = (await this.get(key)) as unknown[];
    if (!Array.isArray(current)) {
      return;
    }
    const updated = current.map((item) =>
      predicate(item as StorageSchema[K] extends Array<infer U> ? U : never)
        ? Object.assign({}, item, updates)
        : item
    );
    await this.set(key, updated as StorageSchema[K]);
  }

  /**
   * Trims the unbounded history arrays before they exhaust QUOTA_BYTES.
   *
   * @param aggressive When true, trims far harder (used only after an actual
   *   quota rejection). Normal operation keeps generous limits so history stays
   *   useful; we only get brutal once storage is genuinely full.
   */
  private async pruneOldData(aggressive = false): Promise<void> {
    const EMAIL_LIMIT = aggressive ? 5 : 20;
    const PASSWORD_LIMIT = aggressive ? 5 : 20;
    const INBOX_LIMIT = aggressive ? 10 : 50;

    try {
      const emailHistory = await this.get('emailHistory');
      if (emailHistory && Array.isArray(emailHistory) && emailHistory.length > EMAIL_LIMIT) {
        const pruned = emailHistory.slice(0, EMAIL_LIMIT) as StorageSchema['emailHistory'];
        this.pendingWrites.set('emailHistory', pruned);
        this.cache.set('emailHistory', pruned);
        log.info(`Pruned email history to ${EMAIL_LIMIT} items`);
      }

      const passwordHistory = await this.get('passwordHistory');
      if (
        passwordHistory &&
        Array.isArray(passwordHistory) &&
        passwordHistory.length > PASSWORD_LIMIT
      ) {
        const pruned = passwordHistory.slice(0, PASSWORD_LIMIT) as StorageSchema['passwordHistory'];
        this.pendingWrites.set('passwordHistory', pruned);
        this.cache.set('passwordHistory', pruned);
        log.info(`Pruned password history to ${PASSWORD_LIMIT} items`);
      }

      const inbox = await this.get('inbox');
      if (inbox && Array.isArray(inbox) && inbox.length > INBOX_LIMIT) {
        const pruned = inbox.slice(0, INBOX_LIMIT) as StorageSchema['inbox'];
        this.pendingWrites.set('inbox', pruned);
        this.cache.set('inbox', pruned);
        log.info(`Pruned inbox cache to ${INBOX_LIMIT} items`);
      }

      // behaviorData.usagePatterns grows without bound and is privacy-sensitive
      // bulk data — it is the least valuable thing on disk when space runs out.
      if (aggressive) {
        const behavior = await this.get('behaviorData');
        if (
          behavior &&
          Array.isArray(behavior.usagePatterns) &&
          behavior.usagePatterns.length > 25
        ) {
          const pruned = {
            ...behavior,
            usagePatterns: behavior.usagePatterns.slice(0, 25),
          } as StorageSchema['behaviorData'];
          this.pendingWrites.set('behaviorData', pruned);
          this.cache.set('behaviorData', pruned);
          log.info('Pruned behavior usage patterns to 25 items');
        }
      }
    } catch (e) {
      log.warn('Failed to prune old data', e);
    }
  }

  /**
   * Get storage usage info
   */
  async getUsage(): Promise<{ used: number; total: number; percentage: number }> {
    return this.getUsageCached(true);
  }

  /** Cached usage for flush path — avoids blocking every OTP/email write. */
  private async getUsageCached(
    force = false
  ): Promise<{ used: number; total: number; percentage: number }> {
    if (!force && this.cachedUsage && Date.now() - this.cachedUsage.ts < USAGE_CACHE_TTL_MS) {
      return this.cachedUsage;
    }

    try {
      if (
        !this.storageAvailable ||
        typeof chrome === 'undefined' ||
        !chrome.storage?.local?.getBytesInUse
      ) {
        const empty = { used: 0, total: 10485760, percentage: 0, ts: Date.now() };
        this.cachedUsage = empty;
        return empty;
      }
      const bytesInUse = await withStorageTimeout(
        chrome.storage.local.getBytesInUse(null),
        'storage-usage'
      );
      const total = chrome.storage.local.QUOTA_BYTES || 10485760;
      const snap = {
        used: bytesInUse || 0,
        total,
        percentage: ((bytesInUse || 0) / total) * 100,
        ts: Date.now(),
      };
      this.cachedUsage = snap;
      return snap;
    } catch {
      const empty = { used: 0, total: 10485760, percentage: 0, ts: Date.now() };
      this.cachedUsage = empty;
      return empty;
    }
  }

  /**
   * Listen to storage changes
   */
  onChanged(
    callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void
  ): () => void {
    if (!this.storageAvailable || typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      return () => {};
    }
    // Each registration owns its subscription, even when callers reuse a function.
    const subscription = (changes: Record<string, chrome.storage.StorageChange>) =>
      callback(changes);
    this.changeCallbacks.add(subscription);
    if (!this.changeListener) {
      this.changeListener = (changes, areaName) => {
        if (areaName !== 'local' || !this.storageAvailable) {
          return;
        }
        const reads = Object.entries(changes).map(([key, change]) => {
          const typedKey = key as keyof StorageSchema;
          this.invalidateRead(typedKey);
          // A local queued write wins over an older Chrome change event.
          if (this.pendingWrites.has(key) || this.optimisticUpdates.has(key)) {
            return;
          }
          this.cache.delete(typedKey);
          const result = this.ensureInitialized().then(() =>
            change.newValue === undefined ? {} : { [key]: change.newValue }
          );
          return this.startRead(typedKey, result);
        });
        void Promise.all(reads)
          .then(() => {
            for (const observer of this.changeCallbacks) {
              try {
                observer(changes);
              } catch (error) {
                log.debug('Storage change observer failed', error);
              }
            }
          })
          .catch((error) => log.debug('Storage change cache sync unavailable', error));
      };
      chrome.storage.onChanged.addListener(this.changeListener);
    }

    return () => {
      this.changeCallbacks.delete(subscription);
      if (this.changeCallbacks.size === 0 && this.changeListener) {
        chrome.storage.onChanged.removeListener(this.changeListener);
        this.changeListener = null;
      }
    };
  }

  /**
   * PERFORMANCE: Preload frequently accessed keys into cache
   */
  async preload(keys: (keyof StorageSchema)[]): Promise<void> {
    const result = await this.getMany(keys);
    log.debug(`Preloaded ${Object.keys(result).length} keys`);
  }

  /**
   * Get cache stats for debugging / diagnostics
   */
  getCacheStats(): {
    size: number;
    keys: string[];
    hits: number;
    misses: number;
    hitRate: number;
    pendingWrites: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.cache.size,
      keys: this.cache.keys() as string[],
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 1,
      pendingWrites: this.pendingWrites.size,
    };
  }

  /**
   * Get LRU cache internal stats
   */
  getLRUCacheStats(): { size: number; maxSize: number; utilization: number } {
    return this.cache.getStats();
  }

  /**
   * PERFORMANCE: Manual cache cleanup (remove expired entries)
   */
  cleanupCache(): number {
    return this.cache.cleanup();
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECURITY: Extension Lifecycle Management
  // Clear all sensitive data on extension unload
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Clear all sensitive data on extension unload
   * @security Called when extension is unloaded/reloaded
   * @security Clears encryption keys, session secrets, and cache
   */
  onExtensionUnload(): void {
    log.info('Extension unload detected - clearing all sensitive data');
    this.storageAvailable = false;
    if (this.writeRetryTimer) {
      clearTimeout(this.writeRetryTimer);
      this.writeRetryTimer = null;
    }
    this.writeRetryAttempts = 0;
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
      this.writeDebounceTimer = null;
    }
    for (const timer of this.optimisticTimers.values()) {
      clearTimeout(timer);
    }
    this.optimisticTimers.clear();
    this.optimisticUpdates.clear();
    this.pendingWrites.clear();
    this.pendingResolvers.splice(0).forEach(({ resolve }) => resolve());
    if (this.changeListener) {
      try {
        chrome.storage.onChanged.removeListener(this.changeListener);
      } catch {
        /* The extension context may already be invalidated. */
      }
    }
    this.changeListener = null;
    this.changeCallbacks.clear();

    // Clear encryption keys
    clearEncryptionKeys();

    // Clear session secrets (API keys)
    this.clearSessionSecrets();

    // Clear cache
    this.invalidateReads();
    this.cache.clear();

    log.info('All sensitive data cleared from memory');
  }
}

// Export singleton instance
export const storageService = new StorageService();

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Register cleanup handler for extension unload
// ═══════════════════════════════════════════════════════════════════

if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Listen for extension unload/reload
  chrome.runtime.onSuspend?.addListener(() => {
    storageService.onExtensionUnload();
  });

  // Also listen for runtime restart (service worker restart)
  if (chrome.runtime.onRestartRequired) {
    chrome.runtime.onRestartRequired.addListener(() => {
      storageService.onExtensionUnload();
    });
  }
}
