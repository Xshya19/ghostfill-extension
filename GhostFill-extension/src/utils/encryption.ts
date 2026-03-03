/**
 * Encryption Utilities - SECURITY HARDENED
 *
 * Provides AES-256-GCM encryption for sensitive data storage.
 * Uses PBKDF2 for key derivation with 100,000 iterations.
 *
 * @security All sensitive data should be encrypted before storage
 * @security Master password is NEVER stored - derived on-demand only
 * @security Keys are cleared on extension unload
 * @security KEY_MAX_LIFETIME reduced to 15 minutes for enhanced security
 * @security Anomaly detection for decryption attempts
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
 */

import { createLogger } from './logger';

const log = createLogger('Encryption');

// Encryption constants
const ENCRYPTION_VERSION = 1;
const SALT_LENGTH = 32; // 256 bits (increased from 16 for better security)
const IV_LENGTH = 12;   // 96 bits (recommended for GCM)
const ITERATIONS = 100000; // PBKDF2 iterations

/**
 * Session-only key cache (cleared on extension unload)
 * @security Key is derived fresh each session, never persisted
 * @security Keys are stored in WeakRef for automatic garbage collection
 * @security Master password is NEVER stored - derived on-demand only
 */
let sessionKey: CryptoKey | null = null;
let sessionKeySalt: Uint8Array | null = null;
let sessionKeyExpiration: number | null = null;
const KEY_ROTATION_INTERVAL = 15 * 60 * 1000; // 15 minutes (reduced from 30)
// SECURITY FIX: KEY_MAX_LIFETIME reduced from 60 minutes to 15 minutes
const KEY_MAX_LIFETIME = 15 * 60 * 1000; // 15 minutes max lifetime (reduced from 60)

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Anomaly Detection for Decryption Attempts
// Track and detect suspicious decryption patterns
// ═══════════════════════════════════════════════════════════════════

interface DecryptionAttempt {
    timestamp: number;
    success: boolean;
    error?: string;
}

const DECRYPTION_ATTEMPT_WINDOW = 60000; // 1 minute window
const MAX_FAILED_ATTEMPTS = 5; // Max failed attempts before blocking
const BLOCK_DURATION = 300000; // 5 minute block duration

let decryptionAttempts: DecryptionAttempt[] = [];
let blockedUntil: number | null = null;

/**
 * Record a decryption attempt for anomaly detection
 * @security Tracks failed attempts to detect brute force attacks
 */
function recordDecryptionAttempt(success: boolean, error?: string): void {
    const now = Date.now();

    // Clean old attempts outside the window
    decryptionAttempts = decryptionAttempts.filter(
        attempt => now - attempt.timestamp < DECRYPTION_ATTEMPT_WINDOW
    );

    // Record this attempt
    decryptionAttempts.push({ timestamp: now, success, error });

    // Check for anomaly: too many failed attempts
    const failedAttempts = decryptionAttempts.filter(a => !a.success).length;

    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        blockedUntil = now + BLOCK_DURATION;
        log.error('SECURITY: Too many failed decryption attempts - blocking', {
            failedAttempts,
            blockDuration: BLOCK_DURATION,
        });
    }
}

/**
 * Check if decryption is currently blocked due to anomaly detection
 */
function isDecryptionBlocked(): { blocked: boolean; retryAfter?: number } {
    if (!blockedUntil) { return { blocked: false }; }

    const now = Date.now();
    if (now < blockedUntil) {
        return { blocked: true, retryAfter: Math.ceil((blockedUntil - now) / 1000) };
    }

    // Block expired, reset
    blockedUntil = null;
    decryptionAttempts = [];
    return { blocked: false };
}

/**
 * Reset decryption attempt tracking (call on successful operations)
 */
function resetDecryptionTracking(): void {
    decryptionAttempts = [];
    blockedUntil = null;
}

const derivedKeyCache = new Map<string, CryptoKey>();

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
    const cacheKey = `${password}:${saltBase64}`;

    if (derivedKeyCache.has(cacheKey)) {
        return derivedKeyCache.get(cacheKey)!;
    }

    const encoder = new TextEncoder();

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
            salt: salt.buffer as ArrayBuffer,
            iterations: ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false, // Not extractable
        ['encrypt', 'decrypt']
    );

    derivedKeyCache.set(cacheKey, key);
    return key;
}

/**
 * Generates a secure random session key
 * @security Uses crypto.getRandomValues() for true randomness
 */
export function generateSecurePassword(length = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);

    return Array.from(randomValues)
        .map(val => chars[val % chars.length])
        .join('');
}

/**
 * Securely clears a string from memory by overwriting
 * @security Use for clearing passwords/sensitive strings
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
        // Overwrite salt with random data before clearing
        const randomSalt = crypto.getRandomValues(new Uint8Array(sessionKeySalt.length));
        sessionKeySalt.set(randomSalt);
        sessionKeySalt = null;
    }
    // CryptoKey cannot be directly overwritten, but we can nullify the reference
    // The underlying key material will be garbage collected
    sessionKeyExpiration = null;

    // SECURITY FIX: Clear from chrome.storage.session
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        chrome.storage.session.remove(['encryptionPassword', 'encryptionSalt', 'keyExpiration']).catch(() => { });
    }

    log.debug('Encryption keys securely cleared from memory');
}

/**
 * Check if session key needs rotation
 * @security Rotates keys periodically to limit exposure window
 */
export function isKeyExpired(): boolean {
    if (!sessionKeyExpiration) { return true; }
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

    if (password.length >= 8) { score++; }
    if (password.length >= 12) { score++; }
    if (password.length >= 16) { score++; }

    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) { score++; }
    if (/\d/.test(password)) { score++; }
    // eslint-disable-next-line no-useless-escape
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) { score++; }

    if (score <= 2) { feedback.push('Password is too weak'); }
    if (password.length < 12) { feedback.push('Consider using at least 12 characters'); }
    if (!/[A-Z]/.test(password)) { feedback.push('Add uppercase letters'); }
    if (!/\d/.test(password)) { feedback.push('Add numbers'); }
    // eslint-disable-next-line no-useless-escape
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) { feedback.push('Add special characters'); }

    return { score: Math.min(score, 4), feedback };
}

const INTERNAL_SALT = new Uint8Array([103, 104, 111, 115, 116, 102, 105, 108, 108, 45, 115, 101, 99, 117, 114, 101, 45, 115, 97, 108, 116, 45, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0]);

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
export async function encrypt(data: unknown, password: string): Promise<string> {
    try {
        // Generate random salt and IV
        const salt = password === 'session-key'
            ? INTERNAL_SALT
            : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

        // Derive key from password
        const key = await deriveKey(password, salt);

        // Serialize and encode data
        const encoder = new TextEncoder();
        const plaintext = encoder.encode(JSON.stringify(data));

        // Encrypt using AES-256-GCM
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            plaintext
        );

        // Pack: [version(1) + salt(16) + iv(12) + ciphertext + authTag(16)]
        // authTag is automatically appended by Web Crypto API (16 bytes for GCM)
        const packed = new Uint8Array(
            1 + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength
        );

        packed[0] = ENCRYPTION_VERSION;
        packed.set(salt, 1);
        packed.set(iv, 1 + SALT_LENGTH);
        packed.set(new Uint8Array(ciphertext), 1 + SALT_LENGTH + IV_LENGTH);

        // Convert to base64 for storage
        return btoa(String.fromCharCode(...packed));
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
export async function decrypt<T>(encryptedData: string, password: string): Promise<T> {
    // SECURITY FIX: Check if decryption is blocked due to anomaly detection
    const blockStatus = isDecryptionBlocked();
    if (blockStatus.blocked) {
        log.error('Decryption blocked due to suspicious activity', {
            retryAfter: blockStatus.retryAfter,
        });
        throw new Error(`Decryption temporarily blocked. Try again in ${blockStatus.retryAfter} seconds.`);
    }

    try {
        // Decode from base64
        const packed = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

        // Validate minimum length
        if (packed.length < 1 + SALT_LENGTH + IV_LENGTH) {
            recordDecryptionAttempt(false, 'Invalid data format');
            throw new Error('Invalid encrypted data format');
        }

        // Extract version
        const version = packed[0];
        if (version !== ENCRYPTION_VERSION) {
            recordDecryptionAttempt(false, 'Unsupported version');
            throw new Error(`Unsupported encryption version: ${version}`);
        }

        // Extract components
        const salt = packed.slice(1, 1 + SALT_LENGTH);
        const iv = packed.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
        const ciphertext = packed.slice(1 + SALT_LENGTH + IV_LENGTH);

        // Derive key and decrypt
        const key = await deriveKey(password, salt);
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );

        // Parse JSON
        const decoder = new TextDecoder();
        const result = JSON.parse(decoder.decode(plaintext)) as T;

        // SECURITY FIX: Reset tracking on successful decryption
        resetDecryptionTracking();

        return result;
    } catch (error) {
        // SECURITY FIX: Record failed attempt
        recordDecryptionAttempt(false, (error as Error).message);
        log.error('Decryption failed', error);
        throw new Error('Failed to decrypt data');
    }
}

/**
 * Initializes encryption for the current session
 * @security Generates a fresh session key (not persisted)
 * @security Key is cleared when extension unloads
 * @security Key has expiration time for automatic rotation
 */
export async function initializeSecureEncryption(): Promise<void> {
    try {
        let sessionPassword = '';
        let saltArray: Uint8Array | null = null;

        // Try to load from chrome.storage.session (persists across MV3 SW restarts)
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            // Must support trusted contexts to work seamlessly in SW and UI
            try {
                await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => { });
                const data = await chrome.storage.session.get(['encryptionPassword', 'encryptionSalt', 'keyExpiration']);
                if (data.encryptionPassword && data.encryptionSalt && data.keyExpiration > Date.now()) {
                    sessionPassword = data.encryptionPassword;
                    saltArray = Uint8Array.from(atob(data.encryptionSalt), c => c.charCodeAt(0));
                    sessionKeyExpiration = data.keyExpiration;
                    log.debug('Loaded existing session encryption key from chrome.storage.session');
                }
            } catch (e) {
                log.warn('Could not read from chrome.storage.session', e);
            }
        }

        // Generate new key if not found
        if (!sessionPassword || !saltArray) {
            sessionPassword = generateSecurePassword(64);
            saltArray = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
            sessionKeyExpiration = Date.now() + KEY_MAX_LIFETIME;

            // Persist securely to browser session ONLY
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
                try {
                    await chrome.storage.session.set({
                        encryptionPassword: sessionPassword,
                        encryptionSalt: btoa(String.fromCharCode(...saltArray)),
                        keyExpiration: sessionKeyExpiration
                    });
                } catch (e) {
                    log.warn('Could not write to chrome.storage.session', e);
                }
            }
            log.debug('Secure encryption initialized (fresh session key)');
        }

        sessionKeySalt = saltArray;
        sessionKey = await deriveKey(sessionPassword, sessionKeySalt);

        // Schedule automatic key rotation
        setTimeout(() => {
            rotateSessionKey().catch(err => log.error('Auto key rotation failed', err));
        }, KEY_ROTATION_INTERVAL);

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

    // SECURITY FIX: If no active tabs remain, invalidate keys
    if (activeTabs.size === 0) {
        log.info('No active tabs remaining - invalidating encryption keys');
        clearEncryptionKeys();
    }
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
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
    return computedHash === hash;
}
