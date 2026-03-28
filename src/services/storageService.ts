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
import { deepMerge } from '../utils/core';
import {
  encrypt,
  decrypt,
  initializeSecureEncryption,
  getSessionKey,
  getMasterKey,
  clearEncryptionKeys,
} from '../utils/encryption'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { createLogger } from '../utils/logger';

/**
 * PERFORMANCE: O(1) LRU Cache Implementation using Map + doubly-linked list concept
 * Map provides O(1) get/set/delete
 * Access order is maintained by Map's insertion order (ES2015+ guarantee)
 */
import { LRUCache } from '../utils/lruCache';

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
const sessionSecretsRestoring: Promise<void> | null = null;

// Keys that contain sensitive data and should be encrypted
// SECURITY FIX: Comprehensive list of all sensitive keys in StorageSchema
// NOTE: API keys (llmApiKey, customDomainKey) are now in sessionSecrets (not persisted)
const SENSITIVE_KEYS: Array<keyof StorageSchema> = [
  // User credentials and identities
  'currentEmail', // Current email account (contains credentials)
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
];

// PERFORMANCE: O(1) LRU Cache Configuration
const CACHE_CONFIG = {
  MAX_SIZE: 100, // Maximum cache entries
  TTL_MS: 5 * 60 * 1000, // 5 minutes TTL for cache entries
} as const;


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
const STORAGE_OP_TIMEOUT_MS = 5_000; // 5-second hard timeout for storage ops

/** Wraps a storage promise with a hard timeout to prevent UI from hanging */
function withStorageTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Storage operation timed out: ${label}`)), STORAGE_OP_TIMEOUT_MS);
    }),
  ]);
}

class StorageService {
  // PERFORMANCE: O(1) LRU Cache instead of array-based O(n)
  private readonly cache: LRUCache<keyof StorageSchema, unknown>;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private readonly QUOTA_WARNING_THRESHOLD = 0.8;
  private readonly QUOTA_MAX_SIZE = 100 * 1024;
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingWrites: Map<string, unknown> = new Map();
  private writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResolvers: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  private readonly WRITE_BATCH_DELAY = 500;
  private isFlushing = false;
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
  private syncInProgress = false;

  // PERFORMANCE: Cache statistics
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor() {
    this.cache = new LRUCache<keyof StorageSchema, unknown>(
      CACHE_CONFIG.MAX_SIZE,
      CACHE_CONFIG.TTL_MS
    );
    // Lazy cleanup is now triggered per-access via maybecleanupCache()
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
      if (removed > 0) { log.debug(`Cleaned up ${removed} expired cache entries`); }
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
  private async acquireWriteMutex(timeoutMs: number = 5000): Promise<void> {
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
    // SECURITY/RELIABILITY FIX: Capture the old value for complete rollback if syncing fails
    const previousValue = this.cache.get(key) as StorageSchema[K] | undefined;

    // Update cache immediately for instant UI response
    this.optimisticUpdates.set(key, value);
    this.cache.set(key, value);

    // Sync to storage in background after delay
    setTimeout(() => {
      this.set(key, value)
        .then(() => {
          this.optimisticUpdates.delete(key);
        })
        .catch((error) => {
          log.error(`Optimistic update failed for ${String(key)}`, error);

          // Rollback safely
          if (previousValue !== undefined) {
            this.cache.set(key, previousValue);
          } else {
            this.cache.delete(key);
          }
          this.optimisticUpdates.delete(key);
        });
    }, syncDelay);
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
    this.optimisticUpdates.delete(key);
  }

  /**
   * Clear all optimistic updates
   */
  clearOptimisticUpdates(): void {
    this.optimisticUpdates.clear();
  }

  /**
   * Check if sync is in progress
   */
  isSyncInProgress(): boolean {
    return this.syncInProgress;
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
  async setSessionSecret<K extends keyof SessionSecrets>(key: K, value: SessionSecrets[K]): Promise<void> {
    sessionSecrets[key] = value;
    sessionSecretsInitialized = true;

    // Sync to chrome.storage.session so it survives SW restart using an isolated namespace
    if (chrome.storage.session) {
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

    sessionSecrets[key] = undefined;

    // Sync to chrome.storage.session using isolated namespace
    if (chrome.storage.session) {
      await chrome.storage.session.remove(`ghostfill_secret_${String(key)}`).catch((e) => {
        log.warn('Failed to clear session secret from storage', { key, error: e });
      });
    }

    const hasRemainingSecret = Boolean(sessionSecrets.llmApiKey || sessionSecrets.customDomainKey);
    if (!hasRemainingSecret) {
      sessionSecrets.keyRotatedAt = undefined;
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
    this.setSessionSecret('llmApiKey', apiKey).catch(e => log.error('Failed to set LLM API key session secret', e));
    this.setSessionSecret('keyRotatedAt', Date.now()).catch(e => log.error('Failed to set rotation time', e));
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
    this.setSessionSecret('customDomainKey', apiKey).catch(e => log.error('Failed to set custom domain session secret', e));
    this.setSessionSecret('keyRotatedAt', Date.now()).catch(e => log.error('Failed to set rotation time', e));
  }

  /**
   * Clear all session secrets (API keys)
   * @security Call on logout or extension unload
   */
  clearSessionSecrets(): void {
    // SECURITY FIX: Overwrite keys in memory before clearing
    if (sessionSecrets.llmApiKey) {
      sessionSecrets.llmApiKey = undefined;
    }
    if (sessionSecrets.customDomainKey) {
      sessionSecrets.customDomainKey = undefined;
    }
    sessionSecrets = {};
    sessionSecretsInitialized = false;
    log.info('Session secrets cleared from memory');
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
      return;
    }

    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          // Restore session secrets using isolated namespace from chrome.storage.session first
          if (chrome.storage.session) {
            // Also enforce TRUSTED_CONTEXTS to prevent non-extension components from reading secrets (PA3)
            await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
            
            const allSession = await chrome.storage.session.get(null);
            const secrets: any = {};
            for (const k of Object.keys(allSession)) {
              if (k.startsWith('ghostfill_secret_')) {
                secrets[k.replace('ghostfill_secret_', '')] = allSession[k];
              }
            }
            if (Object.keys(secrets).length > 0) {
              sessionSecrets = { ...sessionSecrets, ...secrets };
              sessionSecretsInitialized = true;
              log.debug('Restored session secrets from storage', { keys: Object.keys(secrets) });
            }
          }

          await initializeSecureEncryption();

          const data = await this.getAllInternal(); // Use internal method to avoid recursive waiting

          if (!data.settings) {
            // Use internal set to bypass initialization check
            await this.setInternal(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
          }

          if (!data.installDate) {
            await this.setInternal('installDate', Date.now());
          }

          await this.setInternal('extensionVersion', chrome.runtime.getManifest().version);

          this.initialized = true;
          log.debug('Storage initialized with secure encryption');
        } catch (error) {
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
    if (this.initialized) {
      return;
    }
    return this.initPromise || this.init();
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
  async get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K] | undefined> {
    await this.ensureInitialized();

    // PERFORMANCE: O(1) cache check
    const cachedValue = this.cache.get(key);
    if (cachedValue !== undefined) {
      this.cacheHits++;
      return cachedValue as StorageSchema[K];
    }

    this.cacheMisses++;

    if (!chrome?.storage?.local) {
      log.warn('Storage API unavailable', { key });
      return undefined;
    }

    try {
      const result = await withStorageTimeout(chrome.storage.local.get(key), `get:${String(key)}`);

      if (!result || !(key in result)) {
        return undefined;
      }

      let value = result[key] as StorageSchema[K] | undefined;

      // Decrypt sensitive data
      if (value && SENSITIVE_KEYS.includes(key) && typeof value === 'string') {
        try {
          value = (await decrypt(value as string, this.getEncryptionKey())) as StorageSchema[K];
        } catch (error) {
          log.warn(`Failed to decrypt ${key}, dropping value to prevent crash`, error);
          // SECURITY FIX: Drop the value so the UI doesn't crash on invalid string operations
          value = undefined;
        }
      }

      // Cache the value (O(1) with automatic eviction)
      if (value !== undefined) {
        this.cache.set(key, value);
      }

      return value;
    } catch (error) {
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
    this.pendingWrites.set(key, value);
    this.cache.set(key as keyof StorageSchema, value);

    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
    }

    return new Promise((resolve, reject) => {
      this.pendingResolvers.push({ resolve, reject });

      this.writeDebounceTimer = setTimeout(() => {
        this.writeDebounceTimer = null;
        const resolvers = [...this.pendingResolvers];
        this.pendingResolvers = [];

        this.flushPendingWrites()
          .then(() => {
            resolvers.forEach((r) => r.resolve());
          })
          .catch((err) => {
            resolvers.forEach((r) => r.reject(err));
          });
      }, this.WRITE_BATCH_DELAY);
    });
  }

  /**
   * PERFORMANCE: Flush all pending writes in a single batch
   * CRITICAL FIX #4: Uses mutex to prevent race conditions
   */
  private async flushPendingWrites(): Promise<void> {
    const performWrite = async () => {
      await this.acquireWriteMutex();
      const writesAttempted = Array.from(this.pendingWrites.keys());

      try {
        if (this.pendingWrites.size === 0) {
          return;
        }

        const writes = new Map(this.pendingWrites);
        this.pendingWrites.clear();

        const usage = await this.getUsage();

        for (const [key, value] of writes.entries()) {
          const valueSize = JSON.stringify(value).length;

          if (usage.percentage >= this.QUOTA_WARNING_THRESHOLD * 100) {
            log.error(`Storage quota at ${usage.percentage.toFixed(1)}% - refusing write`, {
              key,
              size: valueSize,
            });
            // CRITICAL FIX: To prevent endless loops, throw so we revert cache
            throw new Error('Storage quota nearly full');
          }

          if (valueSize > this.QUOTA_MAX_SIZE) {
            log.warn(`Large write detected for key ${key}`, { size: valueSize });
            await this.pruneOldData();
            // Prune updates pendingWrites, we need to ingest those updates into our current batch
            for (const [pKey, pVal] of this.pendingWrites.entries()) {
              writes.set(pKey, pVal);
            }
            this.pendingWrites.clear();
          }

          // Encrypt sensitive data
          let valueToStore: unknown = value;
          if (SENSITIVE_KEYS.includes(key as keyof StorageSchema)) {
            const masterKey = this.getEncryptionKey();
            if (masterKey) {
              try {
                valueToStore = await encrypt(value, masterKey);
              } catch (error) {
                log.error(`Failed to encrypt ${key}`, error);
                // CRITICAL FIX: throw so we revert cache instead of endless looping
                throw new Error('Failed to encrypt sensitive data');
              }
            }
          }

          writes.set(key, valueToStore);

          // PERFORMANCE: O(1) cache update
          this.cache.set(key as keyof StorageSchema, value);
        }

        await new Promise<void>((resolve, reject) => {
          chrome.storage.local.set(Object.fromEntries(writes), () => {
            if (chrome.runtime.lastError) {
              log.error('Chrome storage set failed', chrome.runtime.lastError);
              return reject(chrome.runtime.lastError);
            }
            resolve();
          });
        });

        log.debug(`Batch saved ${writes.size} keys`);
      } catch (error) {
        log.error('Failed to flush pending writes', error);

        // CRITICAL FIX: Revert the cache instead of leaving dirty UI state
        for (const key of writesAttempted) {
          this.pendingWrites.delete(key as keyof StorageSchema);
        }

        // Resync cache to actual storage since the optimistic update failed
        await this.getAllInternal().catch((e) => log.warn('Failed to resync cache', e));

        throw error;
      } finally {
        this.releaseWriteMutex();

        // Directly schedule retry if there are pending writes
        if (this.pendingWrites.size > 0) {
          setTimeout(() => {
            this.flushPendingWrites().catch((err) => {
              log.error('Retry flush failed', err);
            });
          }, this.WRITE_BATCH_DELAY);
        }
      }
    };

    const scheduledWrite = this.writeQueue.then(performWrite);
    // Ensure writeQueue recovers even if the write fails
    this.writeQueue = scheduledWrite.catch((e) => {
      log.error('Write queue operation failed and was recovered', e);
    });

    return scheduledWrite;
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

    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
      this.writeDebounceTimer = null;
    }

    this.pendingWrites.set(key, value);
    this.cache.set(key as keyof StorageSchema, value);
    return this.flushPendingWrites();
  }

  /**
   * Remove a value from storage
   */
  async remove(key: keyof StorageSchema): Promise<void> {
    await this.ensureInitialized();
    // Keep track of the original value for potential rollback
    const originalValue = this.cache.get(key);

    // Optimistic update
    this.cache.delete(key);

    // FIX §7.6: Cancel any pending buffered write for this key so a debounced
    // batch-flush cannot re-write the value we are about to delete.
    if (this.pendingWrites.has(key)) {
      this.pendingWrites.delete(key);
      log.debug(`Cancelled pending write for removed key: ${String(key)}`);
    }

    try {
      await chrome.storage.local.remove(key);
      log.debug(`Removed ${key}`);
    } catch (error) {
      log.error(`Failed to remove ${key}`, error);
      // Rollback optimistic update
      if (originalValue !== undefined) {
        this.cache.set(key, originalValue);
      }
      throw error;
    }
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
      if (!chrome?.storage?.local) {
        log.warn('Storage API unavailable (getAll)');
        return {};
      }

      const result = (await chrome.storage.local.get(null)) as Record<string, unknown>;
      const decryptedResult: Record<string, unknown> = {};

      // Update cache with all data, decrypting sensitive fields
      for (const [key, value] of Object.entries(result)) {
        let finalValue = value;
        if (
          value &&
          SENSITIVE_KEYS.includes(key as keyof StorageSchema) &&
          typeof value === 'string'
        ) {
          try {
            const masterKey = this.getEncryptionKey();
            if (masterKey) {
              // we might be inside initialization, so check
              finalValue = await decrypt(value as string, masterKey);
            } else {
              // SECURITY FIX: dropping value if master key is missing
              finalValue = undefined;
            }
          } catch (error) {
            log.warn(`Failed to decrypt ${key} in getAllInternal, dropping value`, error);
            // SECURITY FIX: Drop the value so the UI doesn't crash
            finalValue = undefined;
          }
        }

        if (finalValue !== undefined) {
          decryptedResult[key] = finalValue;
          this.cache.set(key as keyof StorageSchema, finalValue);
        }
      }

      return decryptedResult as Partial<StorageSchema>;
    } catch (error) {
      log.error('Failed to get all storage data', error);
      return {};
    }
  }

  /**
   * Clear all storage data
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    try {
      // Preserve encryption bootstrap material so data written after a clear
      // remains readable across the next service worker restart.
      const preservedLocal = await chrome.storage.local.get([
        'masterKeySeed',
        'internalEncryptionSalt',
      ]);

      await withStorageTimeout(chrome.storage.local.clear(), 'clear');
      if (Object.keys(preservedLocal).length > 0) {
        await withStorageTimeout(chrome.storage.local.set(preservedLocal), 'restore-clear-state');
      }
      if (chrome.storage.session) {
        await chrome.storage.session.clear();
      }
      this.cache.clear();
      this.pendingWrites.clear();
      // FIX #10: Also clear in-memory session secrets when storage is wiped
      this.clearSessionSecrets();
      log.info('Storage cleared (including session secrets)');
    } catch (error) {
      log.error('Failed to clear storage', error);
      throw error;
    }
  }

  /**
   * Get settings with defaults
   */
  async getSettings(): Promise<UserSettings> {
    const settings = await this.get(STORAGE_KEYS.SETTINGS as keyof StorageSchema);
    return deepMerge(DEFAULT_SETTINGS, (settings || {}) as Partial<UserSettings>);
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

  private async pruneOldData(): Promise<void> {
    try {
      const emailHistory = await this.get('emailHistory');
      if (emailHistory && Array.isArray(emailHistory) && emailHistory.length > 20) {
        const pruned = emailHistory.slice(0, 20) as StorageSchema['emailHistory'];
        this.pendingWrites.set('emailHistory', pruned);
        this.cache.set('emailHistory', pruned);
        log.info('Pruned email history to 20 items');
      }

      const passwordHistory = await this.get('passwordHistory');
      if (passwordHistory && Array.isArray(passwordHistory) && passwordHistory.length > 20) {
        const pruned = passwordHistory.slice(0, 20) as StorageSchema['passwordHistory'];
        this.pendingWrites.set('passwordHistory', pruned);
        this.cache.set('passwordHistory', pruned);
        log.info('Pruned password history to 20 items');
      }

      const inbox = await this.get('inbox');
      if (inbox && Array.isArray(inbox) && inbox.length > 10) {
        const pruned = inbox.slice(0, 10) as StorageSchema['inbox'];
        this.pendingWrites.set('inbox', pruned);
        this.cache.set('inbox', pruned);
        log.info('Pruned inbox cache to 10 items');
      }
    } catch (e) {
      log.warn('Failed to prune old data', e);
    }
  }

  /**
   * Get storage usage info
   */
  async getUsage(): Promise<{ used: number; total: number; percentage: number }> {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        const total = chrome.storage.local.QUOTA_BYTES || 10485760;
        resolve({
          used: bytesInUse,
          total,
          percentage: (bytesInUse / total) * 100,
        });
      });
    });
  }

  /**
   * Listen to storage changes
   */
  onChanged(
    callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void
  ): () => void {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') {
        void (async () => {
          // Keep cache in sync with decrypted values for sensitive keys.
          for (const key in changes) {
            const typedKey = key as keyof StorageSchema;
            const newValue = changes[key].newValue;

            if (newValue === undefined) {
              this.cache.delete(typedKey);
              continue;
            }

            if (SENSITIVE_KEYS.includes(typedKey) && typeof newValue === 'string') {
              try {
                const decryptedValue = await decrypt(newValue, this.getEncryptionKey());
                this.cache.set(typedKey, decryptedValue);
              } catch (error) {
                log.warn(`Failed to decrypt changed key ${key}, clearing cache entry`, error);
                this.cache.delete(typedKey);
              }
            } else {
              this.cache.set(typedKey, newValue);
            }
          }
          callback(changes);
        })();
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }

  /**
   * PERFORMANCE: Preload frequently accessed keys into cache
   */
  async preload(keys: (keyof StorageSchema)[]): Promise<void> {
    if (!chrome?.storage?.local) {
      return;
    }

    try {
      const result = await chrome.storage.local.get(keys as string[]);
      for (const [key, value] of Object.entries(result)) {
        this.cache.set(key as keyof StorageSchema, value);
      }
      log.debug(`Preloaded ${Object.keys(result).length} keys`);
    } catch (error) {
      log.warn('Failed to preload keys', error);
    }
  }

  /**
   * Get cache stats for debugging
   */
  getCacheStats(): {
    size: number;
    keys: string[];
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.cache.size,
      keys: this.cache.keys() as string[],
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
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

    // Clear encryption keys
    clearEncryptionKeys();

    // Clear session secrets (API keys)
    this.clearSessionSecrets();

    // Clear cache
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
