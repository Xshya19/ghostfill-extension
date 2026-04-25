// Identity Service - Generates consistent, realistic identities for auto-fill
// FIX: Externalized name pools to separate data module for better maintainability

import { STORAGE_KEYS, IdentityProfile } from '../types';
import { getRandomInt } from '../utils/encryption';
import { createLogger } from '../utils/logger';

import { firstNames, lastNames } from './data/identityData';
import { passwordService } from './passwordService';
import { storageService } from './storageService';

const log = createLogger('IdentityService');

// Note: Name pools and email domains are now externalized in ./data/identityData.ts
// This allows for easier customization and extension without modifying service logic

class IdentityService {
  private currentIdentity: IdentityProfile | null = null;

  private secureRandomIndex(max: number): number {
    return getRandomInt(0, max - 1);
  }

  /**
   * Generate a new random identity
   */
  generateIdentity(): IdentityProfile {
    // Safety checks for data arrays
    const first = firstNames?.length
      ? firstNames[this.secureRandomIndex(firstNames.length)]!
      : 'User';
    const last = lastNames?.length ? lastNames[this.secureRandomIndex(lastNames.length)]! : 'Test';
    const randomNum = getRandomInt(100, 9999);

    const identity: IdentityProfile = {
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`,
      username: `${first.toLowerCase()}${last.toLowerCase()}${randomNum}`,
      emailPrefix: `${first.toLowerCase()}.${last.toLowerCase()}.${randomNum}`,
    };

    this.currentIdentity = identity;
    log.info('Generated new identity', { username: identity.username });

    return identity;
  }

  /**
   * Get current identity or generate a new one
   */
  async getCurrentIdentity(): Promise<IdentityProfile> {
    if (this.currentIdentity) {
      return this.currentIdentity;
    }

    // Try to load from storage
    const stored = await storageService.get(STORAGE_KEYS.CURRENT_IDENTITY);
    if (stored) {
      this.currentIdentity = stored as IdentityProfile;
      return this.currentIdentity;
    }

    // Generate new if none exists and persist it for session consistency
    const newIdentity = this.generateIdentity();
    await this.saveIdentity(newIdentity);
    return newIdentity;
  }

  /**
   * Get identity with email and password attached
   * Note: Password is cached in identity profile to ensure consistency across fills
   */
  async getCompleteIdentity(): Promise<IdentityProfile & { email: string; password: string }> {
    try {
      const identity = await this.getCurrentIdentity();

      // Get current email account — require a real email, no fake fallbacks
      let email: string;
      try {
        const currentEmail = await storageService.get('currentEmail');
        if (currentEmail?.fullEmail) {
          email = currentEmail.fullEmail;
        } else {
          log.warn('No email account configured — generate an email first');
          email = '';
        }
      } catch (e) {
        log.warn('Failed to get currentEmail from storage', e);
        email = '';
      }

      // Use cached password if available, otherwise generate and cache
      let password = identity.cachedPassword;
      if (!password) {
        try {
          const passwordResult = await passwordService.generate();
          password = passwordResult.password;

          // Cache the password in identity to ensure consistency
          identity.cachedPassword = password;
          await this.saveIdentity(identity);
        } catch (e) {
          // Fallback password if generation fails - generate random secure password
          const bytes = new Uint8Array(16);
          crypto.getRandomValues(bytes);
          password =
            Array.from(bytes)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('') + 'Gf1!$';
          log.warn('Failed to generate password, using random fallback', e);
        }
      }

      return {
        ...identity,
        email,
        password,
      };
    } catch (error) {
      log.error('Failed to get complete identity', error);
      throw error;
    }
  }

  /**
   * Save current identity to storage
   */
  async saveIdentity(identity: IdentityProfile): Promise<void> {
    this.currentIdentity = identity;
    await storageService.set(STORAGE_KEYS.CURRENT_IDENTITY, identity);
    log.debug('Identity saved to storage');
  }

  /**
   * Clear current identity
   */
  async clearIdentity(): Promise<void> {
    this.currentIdentity = null;
    await storageService.remove(STORAGE_KEYS.CURRENT_IDENTITY);
    log.debug('Identity cleared');
  }

  /**
   * Generate and save a new identity
   */
  async refreshIdentity(): Promise<IdentityProfile> {
    const identity = this.generateIdentity();
    await this.saveIdentity(identity);
    return identity;
  }
}

export const identityService = new IdentityService();
