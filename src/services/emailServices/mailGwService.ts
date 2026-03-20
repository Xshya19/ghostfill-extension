// Mail.gw Service - Free temporary email API (similar to Mail.tm)

import { EmailAccount, Email, MailTmDomain, MailTmAccount, MailTmMessage } from '../../types';
import { API } from '../../utils/constants';
import { fetchWithTimeout } from '../../utils/core';
import { getRandomString } from '../../utils/encryption';
import { createLogger } from '../../utils/logger';

const log = createLogger('MailGwService');

class MailGwService {
  private baseUrl = API.MAIL_GW.BASE_URL;
  private token: string | null = null;
  private tokenExpiry: number = 0;

  /**
   * Fetch with robust retry logic (Exponential Backoff + Jitter)
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 3
  ): Promise<Response> {
    let lastError: Error | unknown = null;
    let lastStatus = 0;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetchWithTimeout(url, options);
        lastStatus = response.status;

        // Return immediately if successful
        if (response.ok) {
          return response;
        }

        // Return if client error (4xx) BUT NOT 429
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return response;
        }

        // If 429 (Too Many Requests) or 5xx, wait and retry
        // Exponential backoff: 2s, 4s, 8s...
        const baseDelay = 2000 * Math.pow(2, i);
        // Jitter: +/- 0-500ms to prevent thundering herd
        const jitter = Math.random() * 500;
        const delay = baseDelay + jitter;

        log.warn(`API request failed (${response.status}), retrying in ${Math.round(delay)}ms...`, {
          attempt: i + 1,
        });
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      } catch (error) {
        lastError = error;
        if (i === retries - 1) {
          throw typeof error === 'object' && error instanceof Error ? error : new Error(String(error));
        }
        const delay = 2000 * Math.pow(2, i);
        log.warn(`Network error, retrying in ${Math.round(delay)}ms...`, error);
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      }
    }
    const finalError = new Error(`MailGwService unreachable after retries (Status: ${lastStatus})`);
    if (lastError) {
      Object.defineProperty(finalError, 'cause', { value: lastError });
    }
    throw finalError;
  }

  /**
   * Get available domains
   */
  async getDomains(): Promise<string[]> {
    const fallbackDomains = ['exdonuts.com'];
    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_GW.ENDPOINTS.DOMAINS}`);

      if (!response.ok) {
        log.warn(`Failed to fetch domains (HTTP ${response.status}), using fallback`);
        return fallbackDomains;
      }

      const data = await response.json();
      const domains: MailTmDomain[] = data['hydra:member'] || [];

      const activeDomains = domains.filter((d) => d.isActive && !d.isPrivate).map((d) => d.domain);

      return activeDomains.length > 0 ? activeDomains : fallbackDomains;
    } catch (error) {
      log.warn('Failed to fetch Mail.gw domains, using fallback', error);
      return fallbackDomains;
    }
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
      const login =
        address || getRandomString(10, 'abcdefghijklmnopqrstuvwxyz0123456789');
      const fullEmail = `${login}@${domain}`;
      const pwd =
        password ||
        getRandomString(
          16,
          'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        );

      // Create account
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.ACCOUNTS}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            address: fullEmail,
            password: pwd,
          }),
        }
      );

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
        service: 'mailgw',
        password: pwd,
        token: this.token || undefined,
      };
    } catch (error) {
      log.warn('Failed to create Mail.gw account', error);
      throw error;
    }
  }

  /**
   * Authenticate and get JWT token
   */
  async authenticate(address: string, password: string): Promise<string> {
    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_GW.ENDPOINTS.TOKEN}`, {
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

      log.debug('Mail.gw authenticated');
      if (!this.token) {
        throw new Error('No token received from authentication');
      }
      return this.token;
    } catch (error) {
      log.error('Mail.gw authentication failed', error);
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

      if (currentEmail && currentEmail.service === 'mailgw' && currentEmail.password) {
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
    await this.ensureAuthenticated();

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.MESSAGES}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        }
      );

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

      return messages.map((msg) => this.convertMessage(msg));
    } catch (error) {
      log.error('Failed to get Mail.gw messages', error);
      throw error;
    }
  }

  /**
   * Get a specific message
   */
  async getMessage(id: string): Promise<Email> {
    await this.ensureAuthenticated();

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.MESSAGES}/${id}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        }
      );

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
      log.error('Failed to get Mail.gw message', error);
      throw error;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(id: string): Promise<void> {
    await this.ensureAuthenticated();

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.MESSAGES}/${id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        }
      );

      if (response.status === 401) {
        this.token = null;
        await this.ensureAuthenticated();
        return this.deleteMessage(id);
      }

      if (!response.ok && response.status !== 204) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      log.debug('Mail.gw message deleted', { id });
    } catch (error) {
      log.error('Failed to delete Mail.gw message', error);
      throw error;
    }
  }

  /**
   * Convert Mail.gw message to our Email type
   */
  private convertMessage(msg: MailTmMessage, includeBody: boolean = false): Email {
    return {
      id: msg.id,
      from: msg.from.address,
      to: msg.to[0]?.address,
      subject: msg.subject,
      date: new Date(msg.createdAt).getTime(),
      body: includeBody ? msg.text || msg.intro || '' : msg.intro || '',
      htmlBody:
        includeBody && msg.html
          ? Array.isArray(msg.html)
            ? msg.html.join('')
            : String(msg.html)
          : undefined,
      textBody: msg.text,
      attachments: [],
      read: msg.seen,
    };
  }
}

// Export singleton instance
export const mailGwService = new MailGwService();
