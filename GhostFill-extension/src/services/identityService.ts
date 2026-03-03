// Identity Service - Generates consistent, realistic identities for auto-fill
// FIX: Externalized name pools to separate data module for better maintainability

import { STORAGE_KEYS } from '../types';
import { createLogger } from '../utils/logger';

import { firstNames, lastNames, emailDomains } from './data/identityData';
import { passwordService } from './passwordService';
import { storageService } from './storageService';

const log = createLogger('IdentityService');

export interface IdentityProfile {
    firstName: string;
    lastName: string;
    fullName: string;
    username: string;
    emailPrefix: string;
    email?: string; // Full email with domain
    password?: string; // Generated password
    cachedPassword?: string; // Persistence for the generated password
}

// Note: Name pools and email domains are now externalized in ./data/identityData.ts
// This allows for easier customization and extension without modifying service logic

class IdentityService {
    private currentIdentity: IdentityProfile | null = null;

    /**
     * Generate a new random identity
     */
    generateIdentity(): IdentityProfile {
        const first = firstNames[Math.floor(Math.random() * firstNames.length)];
        const last = lastNames[Math.floor(Math.random() * lastNames.length)];
        const randomNum = Math.floor(Math.random() * 9999);

        const identity: IdentityProfile = {
            firstName: first,
            lastName: last,
            fullName: `${first} ${last}`,
            username: `${first.toLowerCase()}${last.toLowerCase()}${randomNum}`,
            emailPrefix: `${first.toLowerCase()}.${last.toLowerCase()}.${randomNum}`
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

        // Generate new if none exists
        return this.generateIdentity();
    }

    /**
     * Get identity with email and password attached
     * Note: Password is cached in identity profile to ensure consistency across fills
     */
    async getCompleteIdentity(): Promise<IdentityProfile & { email: string; password: string }> {
        try {
            const identity = await this.getCurrentIdentity();

            // Get current email account (fallback to realistic domain if none exists)
            let email: string;
            try {
                const currentEmail = await storageService.get('currentEmail');
                if (currentEmail?.fullEmail) {
                    email = currentEmail.fullEmail;
                } else {
                    // Use realistic email domain instead of temp.mail
                    const randomDomain = emailDomains[Math.floor(Math.random() * emailDomains.length)];
                    email = `${identity.emailPrefix}@${randomDomain}`;
                    log.info('Using realistic email domain', { domain: randomDomain });
                }
            } catch (e) {
                // Fallback if storage fails - use realistic domain
                const randomDomain = emailDomains[Math.floor(Math.random() * emailDomains.length)];
                email = `${identity.emailPrefix}@${randomDomain}`;
                log.warn('Failed to get currentEmail from storage, using realistic domain', e);
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
                    const randomNum = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
                    password = `Gf${randomNum}Sx!`;
                    log.warn('Failed to generate password, using random fallback', e);
                }
            }

            return {
                ...identity,
                email,
                password
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
