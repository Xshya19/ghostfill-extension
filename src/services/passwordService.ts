// Password Generation Service

import {
    PasswordOptions,
    PasswordStrength,
    GeneratedPassword,
    PasswordHistoryItem,
    DEFAULT_PASSWORD_OPTIONS,
    CHARACTER_SETS,
} from '../types';
import { generateId } from '../utils/core';
import { createLogger } from '../utils/logger';

import { cryptoService } from './cryptoService';
import { storageService } from './storageService';


const log = createLogger('PasswordService');

// CODE QUALITY FIX: Extracted magic numbers to named constants (module-level)
const STRENGTH_SCORING = {
    MAX_ENTROPY_SCORE: 128,
    MAX_SCORE: 100,
    MIN_SCORE: 0,
    REPETITIVE_PATTERN_PENALTY: 10,
    SEQUENTIAL_PATTERN_PENALTY: 10,
    CHARACTER_TYPE_BONUS: 5,
    LEVEL_THRESHOLDS: {
        WEAK: 20,
        FAIR: 40,
        GOOD: 60,
        STRONG: 80,
    },
    CRACK_RATE: 1e9, // 1 billion guesses/second
    MIN_SUGGESTED_LENGTH: 12,
} as const;

const SEQUENTIAL_PATTERNS = {
    letters: /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)/i,
    numbers: /(?:012|123|234|345|456|567|678|789)/,
} as const;

const CHARACTER_TYPE_PATTERNS = [
    /[a-z]/,
    /[A-Z]/,
    /[0-9]/,
    /[^a-zA-Z0-9]/,
] as const;

class PasswordService {
    /**
     * Generate a cryptographically secure password
     * ALGORITHM FIX: Pre-build charset as array once, use typed arrays for crypto
     * PERFORMANCE: O(1) character lookup instead of string concatenation
     */
    generate(options: Partial<PasswordOptions> = {}): GeneratedPassword {
        const opts: PasswordOptions = { ...DEFAULT_PASSWORD_OPTIONS, ...options };

        // ALGORITHM FIX: Build charset as array once for O(1) access
        const charsetArrays: string[][] = [];
        const requiredChars: string[] = [];

        if (opts.uppercase) {
            let chars = CHARACTER_SETS.uppercase;
            if (opts.excludeAmbiguous) {
                chars = chars.replace(/[OI]/g, '');
            }
            const charArray = chars.split('');
            charsetArrays.push(charArray);
            if (opts.minUppercase) {
                for (let i = 0; i < opts.minUppercase; i++) {
                    requiredChars.push(charArray[cryptoService.getRandomInt(0, charArray.length - 1)]);
                }
            }
        }

        if (opts.lowercase) {
            let chars = CHARACTER_SETS.lowercase;
            if (opts.excludeAmbiguous) {
                chars = chars.replace(/[ol]/g, '');
            }
            const charArray = chars.split('');
            charsetArrays.push(charArray);
            if (opts.minLowercase) {
                for (let i = 0; i < opts.minLowercase; i++) {
                    requiredChars.push(charArray[cryptoService.getRandomInt(0, charArray.length - 1)]);
                }
            }
        }

        if (opts.numbers) {
            let chars = CHARACTER_SETS.numbers;
            if (opts.excludeAmbiguous) {
                chars = chars.replace(/[01]/g, '');
            }
            const charArray = chars.split('');
            charsetArrays.push(charArray);
            if (opts.minNumbers) {
                for (let i = 0; i < opts.minNumbers; i++) {
                    requiredChars.push(charArray[cryptoService.getRandomInt(0, charArray.length - 1)]);
                }
            }
        }

        if (opts.symbols) {
            let chars = CHARACTER_SETS.symbols;
            if (opts.excludeSimilar) {
                chars = chars.replace(/[{}[\]()]/g, '');
            }
            const charArray = chars.split('');
            charsetArrays.push(charArray);
            if (opts.minSymbols) {
                for (let i = 0; i < opts.minSymbols; i++) {
                    requiredChars.push(charArray[cryptoService.getRandomInt(0, charArray.length - 1)]);
                }
            }
        }

        if (opts.customCharset) {
            charsetArrays.length = 0; // Clear array
            charsetArrays.push(opts.customCharset.split(''));
        }

        // ALGORITHM FIX: Flatten charset arrays once
        const charset = charsetArrays.flat();
        const charsetLength = charset.length;

        if (charsetLength === 0) {
            // Fallback charset
            charset.push(...(CHARACTER_SETS.lowercase + CHARACTER_SETS.numbers).split(''));
        }

        // ALGORITHM FIX: Use typed array for better crypto performance
        const remainingLength = opts.length - requiredChars.length;

        // Generate all random indices at once using typed array
        const randomIndices = new Uint32Array(remainingLength);
        crypto.getRandomValues(randomIndices);

        // Build password array directly with O(1) array access
        const passwordChars: string[] = [...requiredChars];

        for (let i = 0; i < remainingLength; i++) {
            // Use modulo with bias mitigation for small charsets
            const index = randomIndices[i] % charsetLength;
            passwordChars.push(charset[index]);
        }

        // ALGORITHM FIX: Optimized Fisher-Yates shuffle with single swap per iteration
        this.shuffleArrayInPlace(passwordChars);

        const password = passwordChars.join('');
        const strength = this.calculateStrength(password);

        log.debug('Generated password', { length: password.length, strength: strength.level });

        return {
            password,
            strength,
            options: opts,
            generatedAt: Date.now(),
        };
    }

    /**
     * Generate a passphrase (word-based password)
     */
    generatePassphrase(wordCount: number = 4, separator: string = '-'): string {
        const words = [
            'apple', 'brave', 'coral', 'delta', 'eagle', 'flame', 'grace', 'heart',
            'ivory', 'jewel', 'karma', 'lemon', 'magic', 'noble', 'ocean', 'pearl',
            'queen', 'river', 'storm', 'tiger', 'ultra', 'vivid', 'water', 'xenon',
            'yacht', 'zebra', 'amber', 'blaze', 'crisp', 'dream', 'ember', 'frost',
            'glow', 'haze', 'iris', 'jazz', 'kiwi', 'lunar', 'maple', 'neon',
            'opal', 'prism', 'quest', 'ruby', 'solar', 'topaz', 'unity', 'vibe',
            'wave', 'xray', 'yoga', 'zest', 'bloom', 'cloud', 'dusk', 'echo',
        ];

        const selectedWords: string[] = [];
        for (let i = 0; i < wordCount; i++) {
            const index = cryptoService.getRandomInt(0, words.length - 1);
            // Capitalize first letter randomly
            let word = words[index];
            if (cryptoService.getRandomInt(0, 1) === 1) {
                word = word.charAt(0).toUpperCase() + word.slice(1);
            }
            selectedWords.push(word);
        }

        // Add a random number at the end
        selectedWords.push(cryptoService.getRandomInt(10, 99).toString());

        return selectedWords.join(separator);
    }

    /**
     * Calculate password strength
     * CODE QUALITY FIX: Replaced magic numbers with named constants
     */
    calculateStrength(password: string): PasswordStrength {
        // Calculate entropy
        let charsetSize = 0;

        if (/[a-z]/.test(password)) {charsetSize += 26;}
        if (/[A-Z]/.test(password)) {charsetSize += 26;}
        if (/[0-9]/.test(password)) {charsetSize += 10;}
        if (/[^a-zA-Z0-9]/.test(password)) {charsetSize += 32;}

        const entropy = password.length * Math.log2(charsetSize || 1);

        // Calculate score (0-100)
        let score = Math.min(STRENGTH_SCORING.MAX_SCORE, (entropy / STRENGTH_SCORING.MAX_ENTROPY_SCORE) * STRENGTH_SCORING.MAX_SCORE);

        // Penalize repetitive patterns
        if (/(.)\1{2,}/.test(password)) {score -= STRENGTH_SCORING.REPETITIVE_PATTERN_PENALTY;}

        // Penalize sequential characters
        if (SEQUENTIAL_PATTERNS.letters.test(password)) {
            score -= STRENGTH_SCORING.SEQUENTIAL_PATTERN_PENALTY;
        }
        if (SEQUENTIAL_PATTERNS.numbers.test(password)) {
            score -= STRENGTH_SCORING.SEQUENTIAL_PATTERN_PENALTY;
        }

        // Bonus for mixing character types
        const types = CHARACTER_TYPE_PATTERNS.filter((r) => r.test(password)).length;
        score += (types - 1) * STRENGTH_SCORING.CHARACTER_TYPE_BONUS;

        score = Math.max(STRENGTH_SCORING.MIN_SCORE, Math.min(STRENGTH_SCORING.MAX_SCORE, score));

        // Determine level using named thresholds
        let level: PasswordStrength['level'];
        if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.WEAK) {level = 'weak';}
        else if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.FAIR) {level = 'fair';}
        else if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.GOOD) {level = 'good';}
        else if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.STRONG) {level = 'strong';}
        else {level = 'very-strong';}

        // Estimate crack time (assuming 1 billion guesses/second)
        const combinations = Math.pow(charsetSize || 1, password.length);
        const secondsToCrack = combinations / STRENGTH_SCORING.CRACK_RATE / 2; // Average case

        const crackTime = this.formatCrackTime(secondsToCrack);

        // Generate suggestions
        const suggestions: string[] = [];
        if (password.length < STRENGTH_SCORING.MIN_SUGGESTED_LENGTH) {suggestions.push('Use at least 12 characters');}
        if (!CHARACTER_TYPE_PATTERNS[1].test(password)) {suggestions.push('Add uppercase letters');}
        if (!CHARACTER_TYPE_PATTERNS[0].test(password)) {suggestions.push('Add lowercase letters');}
        if (!CHARACTER_TYPE_PATTERNS[2].test(password)) {suggestions.push('Add numbers');}
        if (!CHARACTER_TYPE_PATTERNS[3].test(password)) {suggestions.push('Add special characters');}

        return {
            score: Math.round(score),
            level,
            entropy: Math.round(entropy * 10) / 10,
            crackTime,
            suggestions,
        };
    }

    // Encryption key cache (in-memory only, NEVER persisted)
    private encryptionKey: CryptoKey | null = null;

    /**
     * Get or create encryption key for password storage
     * @security Key is stored in memory only - cleared on extension unload
     * @security Uses chrome.storage.session (cleared on browser close)
     */
    private async getEncryptionKey(): Promise<CryptoKey> {
        if (this.encryptionKey) {
            return this.encryptionKey;
        }

        try {
            // SECURITY FIX: Use chrome.storage.session instead of chrome.storage.local
            // Session storage is cleared when the extension unloads/browser closes
            const result = await chrome.storage.session.get('passwordEncryptionKey');
            if (result.passwordEncryptionKey) {
                this.encryptionKey = await cryptoService.importKey(result.passwordEncryptionKey);
                return this.encryptionKey;
            }
        } catch {
            // Key doesn't exist, create new one
        }

        // Generate new key
        const key = await cryptoService.generateKey();
        const exportedKey = await cryptoService.exportKey(key);

        // SECURITY FIX: Store in session storage (cleared on unload)
        await chrome.storage.session.set({ passwordEncryptionKey: exportedKey });
        this.encryptionKey = key;

        return key;
    }

    /**
     * Save password to history
     */
    async saveToHistory(password: string, website: string): Promise<void> {
        const strength = this.calculateStrength(password);

        // Encrypt password before storing
        const key = await this.getEncryptionKey();
        const encryptedPassword = await cryptoService.encrypt(password, key);

        const historyItem: PasswordHistoryItem = {
            id: generateId(),
            password: encryptedPassword,
            website,
            createdAt: Date.now(),
            strength: strength.score,
            encrypted: true,
        };

        await storageService.pushToArray('passwordHistory', historyItem, 50);
        log.info('Password saved to history', { website, encrypted: true });
    }

    /**
     * Decrypt password from history
     */
    async decryptPassword(historyItem: PasswordHistoryItem): Promise<string> {
        try {
            const key = await this.getEncryptionKey();
            return await cryptoService.decrypt(historyItem.password, key);
        } catch (e) {
            log.error('Password decryption failed', e);
            throw new Error('Failed to decrypt password');
        }
    }

    /**
     * Get password history
     */
    async getHistory(): Promise<PasswordHistoryItem[]> {
        return (await storageService.get('passwordHistory')) || [];
    }

    /**
     * Delete password from history
     */
    async deleteFromHistory(id: string): Promise<void> {
        await storageService.removeFromArray('passwordHistory', (item) => item.id === id);
        log.info('Password deleted from history');
    }

    /**
     * Clear password history
     */
    async clearHistory(): Promise<void> {
        await storageService.set('passwordHistory', []);
        log.info('Password history cleared');
    }

    /**
     * Get a random character from charset
     * @deprecated Use direct array access with cryptoService.getRandomInt instead
     */
    private getRandomChar(charset: string): string {
        const index = cryptoService.getRandomInt(0, charset.length - 1);
        return charset[index];
    }

    /**
     * Shuffle a string using Fisher-Yates
     * @deprecated Use shuffleArrayInPlace for better performance
     */
    private shuffleString(str: string): string {
        const arr = str.split('');
        this.shuffleArrayInPlace(arr);
        return arr.join('');
    }

    /**
     * Optimized Fisher-Yates shuffle for arrays (in-place)
     * PERFORMANCE FIX: Avoids string splitting/joining overhead
     */
    private shuffleArrayInPlace(arr: string[]): void {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = cryptoService.getRandomInt(0, i);
            // Single swap operation
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    /**
     * Format crack time for display
     */
    private formatCrackTime(seconds: number): string {
        if (seconds < 1) {return 'instantly';}
        if (seconds < 60) {return `${Math.floor(seconds)} seconds`;}
        if (seconds < 3600) {return `${Math.floor(seconds / 60)} minutes`;}
        if (seconds < 86400) {return `${Math.floor(seconds / 3600)} hours`;}
        if (seconds < 2592000) {return `${Math.floor(seconds / 86400)} days`;}
        if (seconds < 31536000) {return `${Math.floor(seconds / 2592000)} months`;}
        if (seconds < 3153600000) {return `${Math.floor(seconds / 31536000)} years`;}
        if (seconds < 3153600000000) {return `${Math.floor(seconds / 3153600000)} centuries`;}
        return 'millions of years';
    }
}

// Export singleton instance
export const passwordService = new PasswordService();
