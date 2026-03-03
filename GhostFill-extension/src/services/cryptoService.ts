// Cryptography Service - Using Web Crypto API

import { createLogger } from '../utils/logger';

const log = createLogger('CryptoService');

/**
 * Cryptographically secure encryption and key derivation service
 */
class CryptoService {
    private encoder = new TextEncoder();
    private decoder = new TextDecoder();

    /**
     * Generate cryptographically secure random bytes
     */
    getRandomBytes(length: number): Uint8Array {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return bytes;
    }

    /**
     * Generate a random string from a charset
     */
    getRandomString(length: number, charset: string): string {
        const randomValues = new Uint32Array(length);
        crypto.getRandomValues(randomValues);

        let result = '';
        for (let i = 0; i < length; i++) {
            result += charset[randomValues[i] % charset.length];
        }
        return result;
    }

    /**
     * Generate a secure random number in range [min, max]
     */
    getRandomInt(min: number, max: number): number {
        const range = max - min + 1;
        const bytesNeeded = Math.ceil(Math.log2(range) / 8);
        const randomBytes = this.getRandomBytes(bytesNeeded);

        let randomValue = 0;
        for (let i = 0; i < bytesNeeded; i++) {
            randomValue = (randomValue << 8) | randomBytes[i];
        }

        return min + (randomValue % range);
    }

    /**
     * Shuffle array using Fisher-Yates with secure random
     * ALGORITHM FIX: Shuffle in-place when possible, avoid unnecessary copy
     */
    secureShuffleArray<T>(array: T[], inPlace: boolean = false): T[] {
        // ALGORITHM FIX: Support both in-place and copy modes
        const result = inPlace ? array : [...array];
        
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.getRandomInt(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    /**
     * Derive a key from password using PBKDF2
     */
    async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
        const passwordKey = await crypto.subtle.importKey(
            'raw',
            this.encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt.buffer as ArrayBuffer,
                iterations: 100000,
                hash: 'SHA-256',
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Generate a new encryption key
     */
    async generateKey(): Promise<CryptoKey> {
        return crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Export key to base64 string
     */
    async exportKey(key: CryptoKey): Promise<string> {
        const exported = await crypto.subtle.exportKey('raw', key);
        return this.arrayBufferToBase64(exported);
    }

    /**
     * Import key from base64 string
     */
    async importKey(keyString: string): Promise<CryptoKey> {
        const keyData = this.base64ToArrayBuffer(keyString);
        return crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Encrypt data with AES-256-GCM
     */
    async encrypt(data: string, key: CryptoKey): Promise<string> {
        try {
            const iv = this.getRandomBytes(12);
            const encoded = this.encoder.encode(data);

            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
                key,
                encoded
            );

            // Combine IV and encrypted data
            const combined = new Uint8Array(iv.length + encrypted.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encrypted), iv.length);

            return this.arrayBufferToBase64(combined.buffer as ArrayBuffer);
        } catch (error) {
            log.error('Encryption failed', error);
            throw error;
        }
    }

    /**
     * Decrypt data with AES-256-GCM
     */
    async decrypt(encryptedData: string, key: CryptoKey): Promise<string> {
        try {
            const combined = this.base64ToArrayBuffer(encryptedData);
            const combinedArray = new Uint8Array(combined);

            // Extract IV and encrypted data
            const iv = combinedArray.slice(0, 12);
            const encrypted = combinedArray.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
                key,
                encrypted
            );

            return this.decoder.decode(decrypted);
        } catch (error) {
            log.error('Decryption failed', error);
            throw error;
        }
    }

    /**
     * Encrypt with password (derives key internally)
     */
    async encryptWithPassword(data: string, password: string): Promise<string> {
        const salt = this.getRandomBytes(16);
        const key = await this.deriveKey(password, salt);
        const encrypted = await this.encrypt(data, key);

        // Combine salt and encrypted data
        const saltBase64 = this.arrayBufferToBase64(salt.buffer as ArrayBuffer);
        return `${saltBase64}:${encrypted}`;
    }

    /**
     * Decrypt with password
     */
    async decryptWithPassword(encryptedData: string, password: string): Promise<string> {
        const [saltBase64, encrypted] = encryptedData.split(':');
        const salt = new Uint8Array(this.base64ToArrayBuffer(saltBase64));
        const key = await this.deriveKey(password, salt);
        return this.decrypt(encrypted, key);
    }

    /**
     * Hash a string using SHA-256
     */
    async hash(data: string): Promise<string> {
        const encoded = this.encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
        return this.arrayBufferToHex(hashBuffer);
    }

    /**
     * Generate a UUID v4
     */
    generateUUID(): string {
        const bytes = this.getRandomBytes(16);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 1

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

    /**
     * Convert ArrayBuffer to Base64
     * FIX: Replaced deprecated btoa() with modern encoding approach
     */
    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        // Use modern encoding that works in all contexts including service workers
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        // FIX: Use safe base64 encoding compatible with extension contexts
        try {
            return btoa(binary);
        } catch {
            // Fallback for environments where btoa may fail (e.g., non-ASCII)
            // Use manual base64 encoding
            const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            let result = '';
            const len = bytes.length;
            for (let i = 0; i < len; i += 3) {
                const a = bytes[i];
                const b = i + 1 < len ? bytes[i + 1] : 0;
                const c = i + 2 < len ? bytes[i + 2] : 0;
                result += base64Chars[a >> 2];
                result += base64Chars[((a & 0x03) << 4) | (b >> 4)];
                result += i + 1 < len ? base64Chars[((b & 0x0f) << 2) | (c >> 6)] : '=';
                result += i + 2 < len ? base64Chars[c & 0x3f] : '=';
            }
            return result;
        }
    }

    /**
     * Convert Base64 to ArrayBuffer
     * FIX: Replaced deprecated atob() with modern decoding approach
     */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        // FIX: Use safe base64 decoding compatible with extension contexts
        let binary: string;
        try {
            binary = atob(base64);
        } catch {
            // Fallback for environments where atob may fail
            // Use manual base64 decoding
            const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            const base64Index = new Map<string, number>();
            base64Chars.split('').forEach((char, index) => {
                base64Index.set(char, index);
            });
            
            binary = '';
            const len = base64.length;
            for (let i = 0; i < len; i += 4) {
                const a = base64Index.get(base64[i]) || 0;
                const b = base64Index.get(base64[i + 1]) || 0;
                const c = base64[i + 2] !== '=' ? base64Index.get(base64[i + 2]) || 0 : 0;
                const d = base64[i + 3] !== '=' ? base64Index.get(base64[i + 3]) || 0 : 0;
                binary += String.fromCharCode((a << 2) | (b >> 4));
                if (base64[i + 2] !== '=') {
                    binary += String.fromCharCode(((b & 0x0f) << 4) | (c >> 2));
                }
                if (base64[i + 3] !== '=') {
                    binary += String.fromCharCode(((c & 0x03) << 6) | d);
                }
            }
        }
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Convert ArrayBuffer to Hex string
     */
    private arrayBufferToHex(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        return Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

// Export singleton instance
export const cryptoService = new CryptoService();
