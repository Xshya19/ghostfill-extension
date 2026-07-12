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

  private isGmailAccount(account: {
    service?: string;
    domain?: string;
    fullEmail?: string;
  } | null | undefined): boolean {
    if (!account) return false;
    if (account.service === 'gmail' || account.domain === 'gmail.com') return true;
    const email = (account.fullEmail || '').toLowerCase();
    return email.endsWith('@gmail.com') || email.endsWith('@googlemail.com');
  }

  /**
   * Resolve the email that must be filled, strictly from the popup tab:
   * - Temp Mail tab (disposable) → only disposable / non-gmail currentEmail
   * - Gmail tab → only gmail alias / base — never temp mail
   */
  async resolveEmailForActiveTab(): Promise<{
    email: string;
    preferredEmailType: 'disposable' | 'gmail';
    source: 'disposable' | 'gmail-alias' | 'gmail-base' | 'current' | 'none';
  }> {
    // getFresh: popup writes preferredEmailType in a different JS context;
    // never trust a stale service-worker LRU cache for this key.
    const rawPref = await storageService.getFresh('preferredEmailType');
    const preferredEmailType: 'disposable' | 'gmail' =
      rawPref === 'gmail' ? 'gmail' : 'disposable';

    if (preferredEmailType === 'gmail') {
      // Prefer active alias in currentEmail, then gmail base / profile
      const currentEmail = await storageService.getFresh('currentEmail');
      if (currentEmail?.fullEmail && this.isGmailAccount(currentEmail)) {
        log.info('resolveEmail: gmail alias from currentEmail', {
          email: currentEmail.fullEmail,
        });
        return {
          email: currentEmail.fullEmail,
          preferredEmailType,
          source: 'gmail-alias',
        };
      }
      const gmailBase =
        (await storageService.getFresh('gmailBase')) ||
        ((await storageService.getFresh('gmailProfile')) as { email?: string } | null)?.email ||
        '';
      if (gmailBase) {
        log.info('resolveEmail: gmail base', { email: gmailBase });
        return { email: gmailBase, preferredEmailType, source: 'gmail-base' };
      }
      log.info('Gmail tab active but no Gmail address configured');
      return { email: '', preferredEmailType, source: 'none' };
    }

    // Temp Mail tab — never leak Gmail into fill
    const disposableEmail = await storageService.getFresh('disposableEmail');
    if (disposableEmail?.fullEmail && !this.isGmailAccount(disposableEmail)) {
      return {
        email: disposableEmail.fullEmail,
        preferredEmailType,
        source: 'disposable',
      };
    }
    const currentEmail = await storageService.getFresh('currentEmail');
    if (currentEmail?.fullEmail && !this.isGmailAccount(currentEmail)) {
      return {
        email: currentEmail.fullEmail,
        preferredEmailType,
        source: 'current',
      };
    }
    log.info('Temp Mail tab active but no disposable email configured');
    return { email: '', preferredEmailType, source: 'none' };
  }

  /**
   * Get identity with email and password attached
   * Note: Password is cached in identity profile to ensure consistency across fills
   */
  async getCompleteIdentity(): Promise<
    IdentityProfile & {
      email: string;
      password: string;
      preferredEmailType: 'disposable' | 'gmail';
      emailSource: string;
    }
  > {
    try {
      const identity = await this.getCurrentIdentity();

      let email = '';
      let preferredEmailType: 'disposable' | 'gmail' = 'disposable';
      let emailSource = 'none';
      try {
        const resolved = await this.resolveEmailForActiveTab();
        email = resolved.email;
        preferredEmailType = resolved.preferredEmailType;
        emailSource = resolved.source;
      } catch (e) {
        log.warn('Failed to resolve email for active tab', e);
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
        preferredEmailType,
        emailSource,
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
