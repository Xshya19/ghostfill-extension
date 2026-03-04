// Mail.tm Service - Alternative email API with JWT auth

import {
    EmailAccount,
    Email,
    MailTmDomain,
    MailTmAccount,
    MailTmMessage,
} from '../../types';
import { API } from '../../utils/constants';
import { createLogger } from '../../utils/logger';
import { cryptoService } from '../cryptoService';

const log = createLogger('MailTmService');

export class MailTmService {
    private baseUrl = API.MAIL_TM.BASE_URL;
    private token: string | null = null;
    private tokenExpiry: number = 0;
    private lastErrorTime: number = 0;
    private consecutiveErrors: number = 0;

    /**
     * Get available domains
     */
    async getDomains(): Promise<string[]> {
        const fallbackDomains = ['bugfoo.com', 'karenkey.com'];
        try {
            const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.DOMAINS}`);

            if (!response.ok) {
                // If domains endpoint fails, use fallback
                log.warn(`Failed to fetch domains (HTTP ${response.status}), using fallback`);
                return fallbackDomains;
            }

            const data = await response.json();
            const domains: MailTmDomain[] = data['hydra:member'] || [];

            const activeDomains = domains
                .filter((d) => d.isActive && !d.isPrivate)
                .map((d) => d.domain);

            return activeDomains.length > 0 ? activeDomains : fallbackDomains;
        } catch (error) {
            log.error('Failed to fetch Mail.tm domains, using fallback', error);
            return fallbackDomains;
        }
    }

    /**
     * Fetch with retry logic
     */
    private async fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                // Return immediately if successful or client error (4xx) except 429
                if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
                    return response;
                }

                // If 429 (Too Many Requests) or 5xx, wait and retry
                await new Promise(resolve => { setTimeout(resolve, 1000 * (i + 1)); });
            } catch (error) {
                if (i === retries - 1) {throw error;}
                await new Promise(resolve => { setTimeout(resolve, 1000 * (i + 1)); });
            }
        }
        throw new Error('Max retries reached');
    }

    /**
     * Create a new email account
     */
    async createAccount(address?: string, password?: string): Promise<EmailAccount> {
        try {
            // Get available domains
            const domains = await this.getDomains();
            if (domains.length === 0) {
                throw new Error('No domains available');
            }

            // Generate random address if not provided
            // Pick a random domain to increase chance of bypassing blacklists
            const domain = domains[Math.floor(Math.random() * domains.length)];
            const login = address || cryptoService.getRandomString(10, 'abcdefghijklmnopqrstuvwxyz0123456789');
            const fullEmail = `${login}@${domain}`;
            const pwd = password || cryptoService.getRandomString(16, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

            // Create account
            const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.ACCOUNTS}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    address: fullEmail,
                    password: pwd,
                }),
            });

            if (!response.ok) {
                const errorData = (await response.json().catch(() => ({}))) as { message?: string };
                throw new Error(errorData.message || `HTTP error: ${response.status}`);
            }

            const account: MailTmAccount = await response.json();

            // Get auth token
            await this.authenticate(fullEmail, pwd);

            const now = Date.now();
            return {
                login,
                domain,
                fullEmail: account.address,
                createdAt: now,
                expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
                service: 'mailtm',
                password: pwd,
                token: this.token || undefined,
            };
        } catch (error) {
            log.error('Failed to create Mail.tm account', error);
            throw error;
        }
    }

    /**
     * Authenticate and get JWT token
     */
    async authenticate(address: string, password: string): Promise<string> {
        try {
            const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ address, password }),
            });

            if (!response.ok) {
                throw new Error(`Authentication failed: ${response.status}`);
            }

            const data = await response.json();
            this.token = data.token;
            this.tokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour

            log.debug('Mail.tm authenticated');
            if (!this.token) {
                throw new Error('No token received from authentication');
            }
            return this.token;
        } catch (error) {
            log.error('Mail.tm authentication failed', error);
            throw error;
        }
    }

    /**
     * Set token from stored account
     */
    setToken(token: string): void {
        this.token = token;
        this.tokenExpiry = Date.now() + 60 * 60 * 1000;
    }

    /**
     * Check if authenticated
     */
    isAuthenticated(): boolean {
        return Boolean(this.token) && Date.now() < this.tokenExpiry;
    }

    /**
     * Ensure we have a valid token, re-authenticating if necessary
     */
    private async ensureAuthenticated(): Promise<void> {
        if (this.isAuthenticated()) {
            return;
        }

        // Check if we have credentials in storage to re-authenticate
        try {
            const { storageService } = await import('../storageService');
            const currentEmail = await storageService.get('currentEmail');

            if (currentEmail && currentEmail.service === 'mailtm' && currentEmail.password) {
                log.info('Token expired, re-authenticating...');
                await this.authenticate(currentEmail.fullEmail, currentEmail.password);
                return;
            }
        } catch (error) {
            log.warn('Failed to retrieve credentials for re-authentication', error);
        }

        throw new Error('Not authenticated and cannot refresh token');
    }

    /**
     * Get messages (inbox)
     */
    async getMessages(): Promise<Email[]> {
        try {
            await this.ensureAuthenticated();

            const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}`, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });

            if (response.status === 401) {
                // Token might be invalid despite expiry check, retry once
                this.token = null;
                await this.ensureAuthenticated();
                return this.getMessages();
            }

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();
            const messages: MailTmMessage[] = data['hydra:member'] || [];

            // Reset error counter on success
            this.consecutiveErrors = 0;
            return messages.map((msg) => this.convertMessage(msg));
        } catch (error) {
            // Throttle error logging to prevent spam
            this.consecutiveErrors++;
            const now = Date.now();
            if (now - this.lastErrorTime > 5000) { // Log at most once per 5 seconds
                log.error('Failed to get Mail.tm messages', error);
                this.lastErrorTime = now;
            }
            // Return empty array instead of throwing to prevent UI breakage
            return [];
        }
    }

    /**
     * Get a specific message
     */
    async getMessage(id: string): Promise<Email> {
        await this.ensureAuthenticated();

        try {
            const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}/${id}`, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });

            if (response.status === 401) {
                this.token = null;
                await this.ensureAuthenticated();
                return this.getMessage(id);
            }

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const msg: MailTmMessage = await response.json();
            return this.convertMessage(msg, true);
        } catch (error) {
            log.error('Failed to get Mail.tm message', error);
            throw error;
        }
    }

    /**
     * Delete a message
     */
    async deleteMessage(id: string): Promise<void> {
        await this.ensureAuthenticated();

        try {
            const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}/${id}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });

            if (response.status === 401) {
                this.token = null;
                await this.ensureAuthenticated();
                return this.deleteMessage(id);
            }

            if (!response.ok && response.status !== 204) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            log.debug('Mail.tm message deleted', { id });
        } catch (error) {
            log.error('Failed to delete Mail.tm message', error);
            throw error;
        }
    }

    /**
     * Convert Mail.tm message to our Email type
     */
    private convertMessage(msg: MailTmMessage, includeBody: boolean = false): Email {
        return {
            id: msg.id,
            from: msg.from.address,
            to: msg.to[0]?.address,
            subject: msg.subject,
            date: new Date(msg.createdAt).getTime(),
            body: includeBody ? (msg.text || msg.intro || '') : msg.intro || '',
            htmlBody: includeBody && msg.html ? msg.html.join('') : undefined,
            textBody: msg.text,
            attachments: [],
            read: msg.seen,
        };
    }
}

// Export singleton instance
export const mailTmService = new MailTmService();
