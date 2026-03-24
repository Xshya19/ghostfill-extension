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
import { getRandomInt } from '../utils/encryption';
import { createLogger } from '../utils/logger';
import { BIP39_WORDLIST } from '../utils/wordlist';

const log = createLogger('PasswordService');
const PASSWORD_HISTORY_SESSION_KEY = 'passwordHistorySession';
const PASSWORD_HISTORY_LIMIT = 50;

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
  letters:
    /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)/i,
  numbers: /(?:012|123|234|345|456|567|678|789)/,
} as const;

const CHARACTER_TYPE_PATTERNS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/] as const;

class PasswordService {
  private sessionStorageInitialized = false;
  private legacyHistoryPurged = false;

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
          requiredChars.push(charArray[getRandomInt(0, charArray.length - 1)]);
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
          requiredChars.push(charArray[getRandomInt(0, charArray.length - 1)]);
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
          requiredChars.push(charArray[getRandomInt(0, charArray.length - 1)]);
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
          requiredChars.push(charArray[getRandomInt(0, charArray.length - 1)]);
        }
      }
    }

    if (opts.customCharset) {
      charsetArrays.length = 0; // Clear array
      charsetArrays.push(opts.customCharset.split(''));
    }

    // ALGORITHM FIX: Flatten charset arrays once
    const charset = charsetArrays.flat();
    let charsetLength = charset.length;

    if (charsetLength === 0) {
      // Fallback charset: alphanumeric + symbols for security (H14 fixed)
      const fallback = CHARACTER_SETS.lowercase + CHARACTER_SETS.uppercase + CHARACTER_SETS.numbers + CHARACTER_SETS.symbols;
      charset.push(...fallback.split(''));
      charsetLength = charset.length;
    }

    // ALGORITHM FIX: Use typed array for better crypto performance
    const remainingLength = Math.max(0, opts.length - requiredChars.length);

    // Generate all random indices at once using typed array
    const randomIndices = new Uint32Array(remainingLength);
    crypto.getRandomValues(randomIndices);

    // Build password array directly with O(1) array access
    const passwordChars: string[] = [...requiredChars];
    
    // Calculate max valid value for uniform distribution to prevent modulo bias (H6 fixed)
    const maxValid = 4294967296 - (4294967296 % charsetLength);

    for (let i = 0; i < remainingLength; ) {
      // Re-roll if value is out of uniform range
      if (randomIndices[i]! < maxValid) {
        const index = randomIndices[i]! % charsetLength;
        passwordChars.push(charset[index]);
        i++;
      } else {
        // Just get one more random value to replace the biased one
        const reRoll = new Uint32Array(1);
        crypto.getRandomValues(reRoll);
        randomIndices[i] = reRoll[0]!;
      }
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
    const words = BIP39_WORDLIST;

    const selectedWords: string[] = [];
    for (let i = 0; i < wordCount; i++) {
      const index = getRandomInt(0, words.length - 1);
      // Capitalize first letter randomly
      let word = words[index];
      if (getRandomInt(0, 1) === 1) {
        word = word.charAt(0).toUpperCase() + word.slice(1);
      }
      selectedWords.push(word);
    }

    // Add a random number at the end
    selectedWords.push(getRandomInt(10, 99).toString());

    return selectedWords.join(separator);
  }

  /**
   * Calculate password strength
   * CODE QUALITY FIX: Replaced magic numbers with named constants
   */
  calculateStrength(password: string): PasswordStrength {
    // Calculate entropy
    let charsetSize = 0;

    if (/[a-z]/.test(password)) {
      charsetSize += 26;
    }
    if (/[A-Z]/.test(password)) {
      charsetSize += 26;
    }
    if (/[0-9]/.test(password)) {
      charsetSize += 10;
    }
    if (/[^a-zA-Z0-9]/.test(password)) {
      charsetSize += 32;
    }

    const entropy = password.length * Math.log2(charsetSize || 1);

    // Calculate score (0-100)
    let score = Math.min(
      STRENGTH_SCORING.MAX_SCORE,
      (entropy / STRENGTH_SCORING.MAX_ENTROPY_SCORE) * STRENGTH_SCORING.MAX_SCORE
    );

    // Penalize repetitive patterns
    if (/(.)\1{2,}/.test(password)) {
      score -= STRENGTH_SCORING.REPETITIVE_PATTERN_PENALTY;
    }

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
    if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.WEAK) {
      level = 'weak';
    } else if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.FAIR) {
      level = 'fair';
    } else if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.GOOD) {
      level = 'good';
    } else if (score < STRENGTH_SCORING.LEVEL_THRESHOLDS.STRONG) {
      level = 'strong';
    } else {
      level = 'very-strong';
    }

    // Estimate crack time (assuming 1 billion guesses/second)
    const combinations = Math.pow(charsetSize || 1, password.length);
    const secondsToCrack = combinations / STRENGTH_SCORING.CRACK_RATE / 2; // Average case

    const crackTime = this.formatCrackTime(secondsToCrack);

    // Generate suggestions
    const suggestions: string[] = [];
    if (password.length < STRENGTH_SCORING.MIN_SUGGESTED_LENGTH) {
      suggestions.push('Use at least 12 characters');
    }
    if (!CHARACTER_TYPE_PATTERNS[1].test(password)) {
      suggestions.push('Add uppercase letters');
    }
    if (!CHARACTER_TYPE_PATTERNS[0].test(password)) {
      suggestions.push('Add lowercase letters');
    }
    if (!CHARACTER_TYPE_PATTERNS[2].test(password)) {
      suggestions.push('Add numbers');
    }
    if (!CHARACTER_TYPE_PATTERNS[3].test(password)) {
      suggestions.push('Add special characters');
    }

    return {
      score: Math.round(score),
      level,
      entropy: Math.round(entropy * 10) / 10,
      crackTime,
      suggestions,
    };
  }

  private async ensureSessionStorage(): Promise<void> {
    if (!chrome?.storage?.session) {
      throw new Error('Session storage is unavailable');
    }

    if (this.sessionStorageInitialized) {
      return;
    }

    try {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch (error) {
      log.debug('Password history session access level already configured or unavailable', error);
    }

    this.sessionStorageInitialized = true;
  }

  private async purgeLegacyPersistentHistory(): Promise<void> {
    if (this.legacyHistoryPurged || !chrome?.storage?.local) {
      return;
    }

    try {
      await chrome.storage.local.remove(['passwordHistory', 'passwordHistorySalt']);
      this.legacyHistoryPurged = true;
      log.info('Removed insecure legacy password history from persistent storage');
    } catch (error) {
      log.warn('Failed to purge insecure legacy password history', error);
    }
  }

  private async getSessionHistory(): Promise<PasswordHistoryItem[]> {
    await this.ensureSessionStorage();
    await this.purgeLegacyPersistentHistory();

    const result = await chrome.storage.session.get(PASSWORD_HISTORY_SESSION_KEY);
    const history = result[PASSWORD_HISTORY_SESSION_KEY];

    return Array.isArray(history) ? (history as PasswordHistoryItem[]) : [];
  }

  private async setSessionHistory(history: PasswordHistoryItem[]): Promise<void> {
    await this.ensureSessionStorage();
    await chrome.storage.session.set({
      [PASSWORD_HISTORY_SESSION_KEY]: history,
    });
  }

  /**
   * Save password to history
   */
  async saveToHistory(password: string, website: string): Promise<void> {
    const strength = this.calculateStrength(password);
    const history = await this.getSessionHistory();
    
    let storedPassword = password;
    let isEncrypted = false;
    
    try {
      const sessionKey = await import('../utils/encryption').then(m => m.getSessionKey());
      if (sessionKey) {
        storedPassword = await import('../utils/encryption').then(m => m.encrypt(password, sessionKey));
        isEncrypted = true;
      }
    } catch (e) {
      log.warn('Failed to encrypt password history item, storing fallback', e);
    }

    const historyItem: PasswordHistoryItem = {
      id: generateId(),
      password: storedPassword,
      website,
      createdAt: Date.now(),
      strength: strength.score,
      encrypted: isEncrypted,
    };

    history.unshift(historyItem);
    if (history.length > PASSWORD_HISTORY_LIMIT) {
      history.splice(PASSWORD_HISTORY_LIMIT);
    }

    await this.setSessionHistory(history);
    log.info('Password saved to session history', { website, persisted: false, encrypted: isEncrypted });
  }

  /**
   * Decrypt password from history
   */
  async decryptPassword(historyItem: PasswordHistoryItem): Promise<string> {
    if (!historyItem.encrypted) {
      return historyItem.password;
    }

    try {
      const sessionKey = await import('../utils/encryption').then(m => m.getSessionKey());
      if (!sessionKey) {throw new Error('No session key available');}
      return await import('../utils/encryption').then(m => m.decrypt(historyItem.password, sessionKey)) as string;
    } catch (e) {
      log.error('Failed to decrypt password history item', e);
      throw new Error('Encrypted password history could not be decrypted');
    }
  }

  /**
   * Get password history
   */
  async getHistory(): Promise<PasswordHistoryItem[]> {
    return this.getSessionHistory();
  }

  /**
   * Delete password from history
   */
  async deleteFromHistory(id: string): Promise<void> {
    const history = await this.getSessionHistory();
    const filtered = history.filter((item) => item.id !== id);
    await this.setSessionHistory(filtered);
    log.info('Password deleted from session history');
  }

  /**
   * Clear password history
   */
  async clearHistory(): Promise<void> {
    await this.setSessionHistory([]);
    log.info('Password session history cleared');
  }

  /**
   * Get a random character from charset
   * @deprecated Use direct array access with getRandomInt instead
   */
  private getRandomChar(charset: string): string {
    const index = getRandomInt(0, charset.length - 1);
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
      const j = getRandomInt(0, i);
      // Single swap operation
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /**
   * Format crack time for display
   */
  private formatCrackTime(seconds: number): string {
    if (seconds < 1) {
      return 'instantly';
    }
    if (seconds < 60) {
      return `${Math.floor(seconds)} seconds`;
    }
    if (seconds < 3600) {
      return `${Math.floor(seconds / 60)} minutes`;
    }
    if (seconds < 86400) {
      return `${Math.floor(seconds / 3600)} hours`;
    }
    if (seconds < 2592000) {
      return `${Math.floor(seconds / 86400)} days`;
    }
    if (seconds < 31536000) {
      return `${Math.floor(seconds / 2592000)} months`;
    }
    if (seconds < 3153600000) {
      return `${Math.floor(seconds / 31536000)} years`;
    }
    if (seconds < 3153600000000) {
      return `${Math.floor(seconds / 3153600000)} centuries`;
    }
    return 'millions of years';
  }
}

// Export singleton instance
export const passwordService = new PasswordService();
