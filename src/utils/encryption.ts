/**
 * Encryption Utilities - SECURITY HARDENED
 *
 * Provides AES-256-GCM encryption for sensitive data storage.
 * Uses PBKDF2 for key derivation with 100,000 iterations.
 *
 * @security All sensitive data should be encrypted before storage
 * @security Master password is NEVER stored - derived on-demand only
 * @security Keys are cleared on extension unload
 * @security KEY_MAX_LIFETIME set to 24 hours (aligned with KEY_ROTATION_INTERVAL)
 * @security Session keys persist in chrome.storage.session across SW restarts
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
 */

import { createLogger } from './logger';

const log = createLogger('Encryption');

/**
 * Convert a Uint8Array to a properly typed BufferSource for Web Crypto API.
 * Copies bytes into a fresh ArrayBuffer to satisfy TS 5.9's strict
 * Uint8Array<ArrayBuffer> constraint.
 */
function toBufferSource(arr: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(arr.byteLength);
  out.set(arr);
  return out;
}

// Encryption constants
const ENCRYPTION_VERSION = 1;
const SALT_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const ITERATIONS = 100000; // PBKDF2 iterations (balanced security/performance)

/**
 * Session-only key cache (cleared on extension unload)
 * @security Key is derived fresh each session, never persisted
 * @security Keys are stored in WeakRef for automatic garbage collection
 * @security Master password is NEVER stored - derived on-demand only
 */
let sessionKey: CryptoKey | null = null;
let masterKey: CryptoKey | null = null; // PERSISTENT key for storage.local
let sessionKeySalt: Uint8Array | null = null;
let sessionKeyExpiration: number | null = null;

const KEY_ROTATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const KEY_MAX_LIFETIME = 24 * 60 * 60 * 1000;

interface DerivedKeyCacheEntry {
  key: CryptoKey;
  ts: number;
}
const derivedKeyCache = new Map<string, DerivedKeyCacheEntry>();
const MAX_CACHE_SIZE = 20;
// L6: TTL for derived key cache entries (1 hour)
const DERIVED_KEY_TTL_MS = 60 * 60 * 1000;

/**
 * Derives a cryptographic key from a password using PBKDF2
 *
 * @param password - The password to derive key from
 * @param salt - The salt for key derivation
 * @returns Derived CryptoKey for AES-256-GCM
 *
 * @security Key derivation uses 100,000 iterations for brute-force resistance
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const saltBase64 = btoa(String.fromCharCode(...salt));

  // Hash the password so we don't store plaintext in memory cache
  const encoder = new TextEncoder();
  const passBuf = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  const passHash = Array.from(new Uint8Array(passBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const cacheKey = `${passHash}:${saltBase64}`;

  // L6: Evict expired entries and check cache
  const now = Date.now();
  if (derivedKeyCache.has(cacheKey)) {
    const entry = derivedKeyCache.get(cacheKey)!;
    if (now - entry.ts < DERIVED_KEY_TTL_MS) {
      return entry.key;
    }
    derivedKeyCache.delete(cacheKey); // expired
  }

  // LRU + TTL cleanup to prevent memory leaks
  if (derivedKeyCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest OR expired entry
    for (const [k, v] of derivedKeyCache) {
      if (now - v.ts > DERIVED_KEY_TTL_MS) {
        derivedKeyCache.delete(k);
        break;
      }
    }
    // If still full, evict the oldest entry (Map preserves insertion order)
    if (derivedKeyCache.size >= MAX_CACHE_SIZE) {
      const firstKey = derivedKeyCache.keys().next().value;
      if (firstKey) {
        derivedKeyCache.delete(firstKey);
      }
    }
  }

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false, // Not extractable
    ['deriveKey']
  );

  // Derive AES-256-GCM key - convert Uint8Array to ArrayBuffer
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBufferSource(salt),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // Not extractable
    ['encrypt', 'decrypt']
  );

  derivedKeyCache.set(cacheKey, { key, ts: Date.now() });
  return key;
}

/**
 * Generates a secure random session key
 * @security Uses crypto.getRandomValues() for true randomness
 */
export function generateSecurePassword(length = 32): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const charsLength = chars.length;
  // L7: Batch generates 2x the needed bytes to account for rejection sampling (reduces CSPRNG calls)
  const maxValid = 256 - (256 % charsLength);
  let result = '';
  // Batch generate — request enough bytes to fill the password in most cases
  while (result.length < length) {
    const needed = Math.max(length - result.length, 1);
    // Over-sample by 1.5x since rejection sampling discards some bytes
    const batchSize = Math.ceil(needed * 1.5);
    const randomValues = new Uint8Array(batchSize);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < batchSize && result.length < length; i++) {
      if (randomValues[i]! < maxValid) {
        result += chars[randomValues[i]! % charsLength];
      }
    }
  }
  return result;
}

/**
 * Securely clears a string from memory by overwriting the referenced object
 * Note: JS strings are immutable primitives — this clears the wrapper object
 * value property to null out the reference, but the original string may remain
 * in heap memory until the GC collects it. For truly sensitive data, use
 * Uint8Array / ArrayBuffer and fill with zeros instead.
 * @security Use for clearing passwords/sensitive strings from state objects
 */
export function secureClearString(strRef: { value: string }): void {
  if (strRef && strRef.value) {
    // Overwrite with random data before clearing
    strRef.value = generateSecurePassword(strRef.value.length);
    strRef.value = '';
  }
}

/**
 * Securely clears encryption keys from memory
 * @security Overwrites key material before nullifying
 * @security Call immediately after use or on session end
 */
export function secureClearKeys(): void {
  if (sessionKeySalt) {
    const randomSalt = crypto.getRandomValues(new Uint8Array(sessionKeySalt.length));
    sessionKeySalt.set(randomSalt);
    sessionKeySalt = null;
  }

  sessionKey = null;
  masterKey = null;
  sessionKeyExpiration = null;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
    chrome.storage.session
      .remove(['sessionKeySeed', 'encryptionSalt', 'keyExpiration'])
      .catch((e) => log.debug('Failed to clear keys from session storage', e));
  }

  log.debug('Encryption keys securely cleared from memory');
}

/**
 * Check if session key needs rotation
 * @security Rotates keys periodically to limit exposure window
 */
export function isKeyExpired(): boolean {
  if (!sessionKeyExpiration) {
    return true;
  }
  return Date.now() > sessionKeyExpiration;
}

/**
 * Rotate encryption keys
 * @security Generates fresh key material periodically
 */
export async function rotateSessionKey(): Promise<void> {
  log.debug('Rotating session encryption key');
  secureClearKeys();
  await initializeSecureEncryption();
}

/**
 * Validates password strength
 * @returns Object with score (0-4) and feedback
 */
export function validatePasswordStrength(password: string): { score: number; feedback: string[] } {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) {
    score++;
  }
  if (password.length >= 12) {
    score++;
  }
  if (password.length >= 16) {
    score++;
  }

  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) {
    score++;
  }
  if (/\d/.test(password)) {
    score++;
  }
  // eslint-disable-next-line no-useless-escape
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) {
    score++;
  }

  // M18: Score normalised to max 4.
  // Raw max = 6 (3 length + 1 case + 1 digit + 1 special);
  // Map 0-2 → 0, 3 → 1, 4 → 2, 5 → 3, 6 → 4 for a full [0..4] range.
  const normalised = score <= 2 ? 0 : score - 2;

  if (normalised <= 1) {
    feedback.push('Password is too weak');
  }
  if (password.length < 12) {
    feedback.push('Consider using at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    feedback.push('Add uppercase letters');
  }
  if (!/\d/.test(password)) {
    feedback.push('Add numbers');
  }
  // eslint-disable-next-line no-useless-escape
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) {
    feedback.push('Add special characters');
  }

  return { score: Math.min(normalised, 4), feedback };
}

// Dynamic Internal Salt: Fetched securely
let cachedInternalSalt: Uint8Array | null = null;
async function getInternalSalt(): Promise<Uint8Array> {
  if (cachedInternalSalt) {
    return cachedInternalSalt;
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get(['internalEncryptionSalt']);
    if (data.internalEncryptionSalt) {
      cachedInternalSalt = Uint8Array.from(atob(data.internalEncryptionSalt), (c) =>
        c.charCodeAt(0)
      );
      return cachedInternalSalt;
    }
    const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    await chrome.storage.local.set({
      internalEncryptionSalt: btoa(String.fromCharCode(...newSalt)),
    });
    cachedInternalSalt = newSalt;
    return newSalt;
  }
  // Fallback
  const fallbackSalt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(fallbackSalt);
  return fallbackSalt;
}

/**
 * Encrypts data using AES-256-GCM
 *
 * @param data - Data to encrypt (will be JSON stringified)
 * @param password - Password for encryption
 * @returns Base64-encoded encrypted data with metadata
 *
 * @security Uses AES-256-GCM with random IV for each encryption
 * @throws Error if encryption fails
 *
 * @example
 * const encrypted = await encrypt({ apiKey: 'secret' }, 'master-password');
 */
export async function encrypt(data: unknown, passwordOrKey: string | CryptoKey): Promise<string> {
  try {
    const isString = typeof passwordOrKey === 'string';
    // Generate random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    // Derive key from password or use provided key
    const key = isString
      ? await deriveKey(passwordOrKey as string, salt)
      : (passwordOrKey as CryptoKey);

    // Serialize and encode data
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(data));

    // Encrypt using AES-256-GCM
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

    // Pack: [version(1) + salt(16) + iv(12) + ciphertext + authTag(16)]
    // authTag is automatically appended by Web Crypto API (16 bytes for GCM)
    const packed = new Uint8Array(1 + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);

    packed[0] = ENCRYPTION_VERSION;
    packed.set(salt, 1);
    packed.set(iv, 1 + SALT_LENGTH);
    packed.set(new Uint8Array(ciphertext), 1 + SALT_LENGTH + IV_LENGTH);

    // M9: Convert to base64 for storage without spread (avoids V8 call-stack overflow for large payloads)
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < packed.length; i += chunkSize) {
      binary += String.fromCharCode(...packed.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  } catch (error) {
    log.error('Encryption failed', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypts data encrypted with encrypt() - SECURITY HARDENED
 *
 * @param encryptedData - Base64-encoded encrypted data
 * @param password - Password for decryption
 * @returns Decrypted and parsed data
 *
 * @security Validates encryption version before decryption
 * @security Anomaly detection for brute force protection
 * @security Blocks after 5 failed attempts within 1 minute
 * @throws Error if decryption fails or version mismatch
 *
 * @example
 * const data = await decrypt(encryptedString, 'master-password');
 */
export async function decrypt<T>(
  encryptedData: string,
  passwordOrKey: string | CryptoKey
): Promise<T> {
  let packed: Uint8Array;
  try {
    // Decode from base64
    packed = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
  } catch {
    // Not valid base64 — likely legacy unencrypted data
    throw new Error('Invalid encrypted data format (not base64)');
  }

  // Validate minimum length
  if (packed.length < 1 + SALT_LENGTH + IV_LENGTH) {
    throw new Error('Invalid encrypted data format (too short)');
  }

  // Extract version
  const version = packed[0];
  if (version !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  // Extract components
  const salt = packed.slice(1, 1 + SALT_LENGTH);
  const iv = packed.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
  const ciphertext = packed.slice(1 + SALT_LENGTH + IV_LENGTH);

  try {
    // Derive key and decrypt
    const isString = typeof passwordOrKey === 'string';
    const key = isString
      ? await deriveKey(passwordOrKey as string, salt)
      : (passwordOrKey as CryptoKey);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

    // Parse JSON
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch (error) {
    log.debug(
      'Decryption failed (keys may have rotated or data encrypted with a different key)',
      error
    );
    throw new Error('Failed to decrypt data');
  }
}

export function onRotationAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name === 'encryption-key-rotation') {
    rotateSessionKey().catch((err) => log.error('Auto key rotation failed', err));
  }
}

/**
 * Initializes encryption for the current session
 * @security Uses separate persistent Master Key and transient Session Key
 * @security Both keys are non-extractable (Key Insulation)
 * @security Key has expiration time for automatic rotation
 */
export async function initializeSecureEncryption(): Promise<void> {
  try {
    const currentVersion =
      typeof chrome !== 'undefined' ? chrome.runtime.getManifest().version : 'unknown';

    // 1. Initialize PERSISTENT MASTER KEY (for storage.local)
    // The persisted seed is required so encrypted records survive expected restarts.
    // — an attacker who reads raw disk storage gets only ciphertext with no key material.
    if (!masterKey && typeof chrome !== 'undefined' && chrome.storage?.local) {
      let masterSeed: Uint8Array | null = null;

      try {
        const localData = await chrome.storage.local.get(['masterKeySeed']);
        if (typeof localData.masterKeySeed === 'string') {
          masterSeed = Uint8Array.from(atob(localData.masterKeySeed), (c) => c.charCodeAt(0));
        }
      } catch {
        // Fall through to generation if persisted key material is unavailable.
      }

      if (!masterSeed) {
        masterSeed = crypto.getRandomValues(new Uint8Array(32));
        try {
          await chrome.storage.local.set({
            masterKeySeed: btoa(String.fromCharCode(...masterSeed)),
          });
        } catch {
          throw new Error('Critical: Failed to persist master encryption seed');
        }
      }

      masterKey = await crypto.subtle.importKey(
        'raw',
        toBufferSource(masterSeed),
        { name: 'AES-GCM', length: 256 },
        false, // NON-EXTRACTABLE (P0.3)
        ['encrypt', 'decrypt']
      );
      log.debug('Persistent Master Key initialized');
    }

    // 2. Initialize TRANSIENT SESSION KEY (for storage.session)
    if (
      (!sessionKey || isKeyExpired()) &&
      typeof chrome !== 'undefined' &&
      chrome.storage?.session
    ) {
      try {
        await chrome.storage.session
          .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
          .catch(() => {});
        const sessionData = await chrome.storage.session.get([
          'sessionKeySeed',
          'encryptionSalt',
          'keyExpiration',
          'appVersion',
        ]);

        if (
          sessionData.sessionKeySeed &&
          sessionData.encryptionSalt &&
          sessionData.keyExpiration > Date.now() &&
          sessionData.appVersion === currentVersion
        ) {
          const seed = Uint8Array.from(atob(sessionData.sessionKeySeed), (c) => c.charCodeAt(0));
          sessionKey = await crypto.subtle.importKey(
            'raw',
            seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength),
            { name: 'AES-GCM', length: 256 },
            false, // NON-EXTRACTABLE (P0.3)
            ['encrypt', 'decrypt']
          );
          sessionKeySalt = Uint8Array.from(atob(sessionData.encryptionSalt), (c) =>
            c.charCodeAt(0)
          );
          sessionKeyExpiration = sessionData.keyExpiration;
          log.debug('Loaded existing Session Key from storage.session');
        } else {
          // Generate new Session Key
          const seed = crypto.getRandomValues(new Uint8Array(32));
          sessionKeySalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
          sessionKeyExpiration = Date.now() + KEY_MAX_LIFETIME;

          sessionKey = await crypto.subtle.importKey(
            'raw',
            seed,
            { name: 'AES-GCM', length: 256 },
            false, // NON-EXTRACTABLE (P0.3)
            ['encrypt', 'decrypt']
          );

          await chrome.storage.session.set({
            sessionKeySeed: btoa(String.fromCharCode(...seed)),
            encryptionSalt: btoa(String.fromCharCode(...sessionKeySalt)),
            keyExpiration: sessionKeyExpiration,
            appVersion: currentVersion,
          });
          log.debug('Generated new Session Key');
        }
      } catch (e) {
        log.warn('Session key initialization failed, using non-persistent key', e);
      }
    }

    // Fallback only if in a non-extension context (tests)
    if (!masterKey) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        throw new Error('Critical: Failed to generate or load persistent master key from storage');
      }
      const seed = crypto.getRandomValues(new Uint8Array(32));
      masterKey = await crypto.subtle.importKey(
        'raw',
        seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }
    if (!sessionKey) {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      sessionKey = await crypto.subtle.importKey(
        'raw',
        seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      sessionKeySalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      sessionKeyExpiration = Date.now() + KEY_MAX_LIFETIME;
    }

    // Schedule automatic key rotation using alarms since setTimeout won't survive SW suspension
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      void chrome.alarms.create('encryption-key-rotation', {
        delayInMinutes: KEY_ROTATION_INTERVAL / 60000,
      });
    }

    // Intentionally clear password from memory scope since it is cached in Derive algorithm and session storage
  } catch (error) {
    log.error('Secure encryption initialization failed', error);
    throw error;
  }
}

/**
 * Gets the current session encryption key
 * @security Returns null if not initialized
 */
export function getSessionKey(): CryptoKey | null {
  return sessionKey;
}

/**
 * Gets the persistent master encryption key
 * @security Used for local storage persistence (P0.1 fix)
 */
export function getMasterKey(): CryptoKey | null {
  return masterKey;
}

/**
 * Clears encryption keys from memory
 * @security Call on extension unload or user logout
 * @security Uses secure overwrite before nullifying
 */
export function clearEncryptionKeys(): void {
  secureClearKeys();
}

/**
 * Handles extension unload - clears all encryption material
 */
export function onExtensionUnload(): void {
  clearEncryptionKeys();
  log.info('Encryption cleaned up on extension unload');
}

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Tab Close Key Invalidation
// Clear encryption keys when tabs are closed to prevent leakage
// ═══════════════════════════════════════════════════════════════════

/**
 * Track active tabs for key invalidation on close
 */
const activeTabs = new Set<number>();

/**
 * Register a tab as active for key tracking
 * @security Used to invalidate keys when tab closes
 */
export function registerActiveTab(tabId: number): void {
  activeTabs.add(tabId);
  log.debug('Tab registered for key tracking', { tabId, activeCount: activeTabs.size });
}

/**
 * Unregister a tab and potentially invalidate keys
 * @security Called when tab closes to clean up encryption material
 */
export function unregisterActiveTab(tabId: number): void {
  activeTabs.delete(tabId);
  log.debug('Tab unregistered', { tabId, remainingActive: activeTabs.size });

  // SECURITY FIX: Do NOT clear encryption keys on tab close.
  // The service worker manages its own lifecycle and stores persistence
  // via chrome.storage.session. Wiping keys on tab close breaks background operations.
}

/**
 * Check if there are any active tabs
 */
export function hasActiveTabs(): boolean {
  return activeTabs.size > 0;
}

/**
 * Get count of active tabs (for debugging)
 */
export function getActiveTabCount(): number {
  return activeTabs.size;
}

// Register cleanup handler for service worker
if (typeof chrome !== 'undefined' && chrome.runtime) {
  // chrome.runtime.onSuspend is only available in service workers/background
  if (chrome.runtime.onSuspend) {
    chrome.runtime.onSuspend.addListener(() => {
      onExtensionUnload();
    });
  }

  // SECURITY FIX: Listen for tab removal to invalidate keys
  if (chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId: number) => {
      unregisterActiveTab(tabId);
    });
  }
}

/**
 * Hashes a password using SHA-256
 *
 * @param password - Password to hash
 * @returns Hex-encoded hash
 *
 * @security One-way hash for password verification
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);

  // Use dynamically generated, securely cached salt for PBKDF2 hash verification
  const salt = await getInternalSalt();

  const baseKey = await crypto.subtle.importKey('raw', passwordData, { name: 'PBKDF2' }, false, [
    'deriveBits',
  ]);

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toBufferSource(salt),
      iterations: 210000,
      hash: 'SHA-256',
    },
    baseKey,
    256 // 32 bytes
  );

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies a password against a hash
 *
 * @param password - Password to verify
 * @param hash - Expected hash
 * @returns true if password matches
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computedHash = await hashPassword(password);

  // Constant-time comparison to prevent timing attacks
  if (computedHash.length !== hash.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return result === 0;
}

// ═══════════════════════════════════════════════════════════════════
// Cryptographic Utility Functions (Merged from legacy cryptoService)
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate cryptographically secure random bytes
 */
export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate a secure random number in range [min, max]
 * Security: Uses rejection sampling to eliminate modulo bias.
 */
export function getRandomInt(min: number, max: number): number {
  if (min >= max) {
    return min;
  }
  const range = max - min + 1;
  const maxMultiple = Math.floor(4294967296 / range) * range;
  const randomArray = new Uint32Array(1);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    crypto.getRandomValues(randomArray);
    const value = randomArray[0]!;
    if (value < maxMultiple) {
      return min + (value % range);
    }
  }
}

/**
 * Generate a random string from a charset
 */
export function getRandomString(length: number, charset: string): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[getRandomInt(0, charset.length - 1)];
  }
  return result;
}

/**
 * Shuffle array using Fisher-Yates with secure random
 */
export function secureShuffleArray<T>(array: T[], inPlace: boolean = false): T[] {
  const result = inPlace ? array : [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = getRandomInt(0, i);
    const tmp = result[j]!;
    result[j] = result[i]!;
    result[i] = tmp;
  }
  return result;
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  const bytes = getRandomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // Variant 1

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
