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
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, delay);
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          }
        });
      } catch (error) {
        lastError = error;
        if (i === retries - 1) {
          throw typeof error === 'object' && error instanceof Error
            ? error
            : new Error(String(error));
        }
        const delay = 2000 * Math.pow(2, i);
        log.warn(`Network error, retrying in ${Math.round(delay)}ms...`, error);
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, delay);
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          }
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
  async getDomains(signal?: AbortSignal): Promise<string[]> {
    const fallbackDomains = ['exdonuts.com'];
    try {
      const options: RequestInit = {};
      if (signal) {
        options.signal = signal;
      }
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.DOMAINS}`,
        options
      );

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
  async createAccount(
    address?: string,
    password?: string,
    signal?: AbortSignal
  ): Promise<EmailAccount> {
    try {
      // Get available domains
      const domains = await this.getDomains(signal);
      if (domains.length === 0) {
        throw new Error('No domains available');
      }

      // Generate random address if not provided
      // Pick a random domain to increase chance of bypassing blacklists
      const domain = domains[Math.floor(Math.random() * domains.length)]!;
      const login = address || getRandomString(10, 'abcdefghijklmnopqrstuvwxyz0123456789');
      const fullEmail = `${login}@${domain}`;
      const pwd =
        password ||
        getRandomString(16, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

      // Create account
      const createOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address: fullEmail,
          password: pwd,
        }),
      };
      if (signal) {
        createOptions.signal = signal;
      }
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.ACCOUNTS}`,
        createOptions
      );

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorData.message || `HTTP error: ${response.status}`);
      }

      const apiAccount: MailTmAccount = await response.json();

      // CRITICAL: Validate account.id exists
      if (!apiAccount.id) {
        log.error('Mail.gw API response missing account.id field', {
          accountKeys: Object.keys(apiAccount),
        });
        apiAccount.id = `fallback_${Date.now()}_${fullEmail.replace(/[@.]/g, '_')}`;
      }

      // Get auth token
      await this.authenticate(fullEmail, pwd, signal);

      const now = Date.now();
      const account: EmailAccount = {
        id: apiAccount.id,
        login,
        domain,
        fullEmail: apiAccount.address,
        createdAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
        service: 'mailgw',
        password: pwd,
      };
      if (this.token) {
        account.token = this.token;
      }
      return account;
    } catch (error) {
      log.warn('Failed to create Mail.gw account', error);
      throw error;
    }
  }

  /**
   * Authenticate and get JWT token
   */
  async authenticate(address: string, password: string, signal?: AbortSignal): Promise<string> {
    try {
      const authOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address, password }),
      };
      if (signal) {
        authOptions.signal = signal;
      }
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.TOKEN}`,
        authOptions
      );

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
  private async ensureAuthenticated(signal?: AbortSignal): Promise<void> {
    if (this.isAuthenticated()) {
      return;
    }

    // Check if we have credentials in storage to re-authenticate
    try {
      const { storageService } = await import('../storageService');
      const currentEmail = await storageService.get('currentEmail');

      if (currentEmail && currentEmail.service === 'mailgw' && currentEmail.password) {
        log.info('Token expired, re-authenticating...');
        await this.authenticate(currentEmail.fullEmail, currentEmail.password, signal);
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
  async getMessages(signal?: AbortSignal): Promise<Email[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensureAuthenticated(signal);

      try {
        const msgOptions: RequestInit = {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        };
        if (signal) {
          msgOptions.signal = signal;
        }
        const response = await this.fetchWithRetry(
          `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.MESSAGES}`,
          msgOptions
        );

        if (response.status === 401) {
          this.token = null;
          await this.ensureAuthenticated(signal);
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        const messages: MailTmMessage[] = data['hydra:member'] || [];

        return messages.map((msg) => this.convertMessage(msg));
      } catch (error) {
        if (attempt === 1) {
          log.error('Failed to get Mail.gw messages', error);
          throw error;
        }
      }
    }
    throw new Error('Failed to get Mail.gw messages after retry');
  }

  /**
   * Get a specific message
   */
  async getMessage(id: string, signal?: AbortSignal): Promise<Email> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensureAuthenticated(signal);

      try {
        const msgOpts: RequestInit = {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        };
        if (signal) {
          msgOpts.signal = signal;
        }
        const response = await this.fetchWithRetry(
          `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.MESSAGES}/${id}`,
          msgOpts
        );

        if (response.status === 401) {
          this.token = null;
          await this.ensureAuthenticated(signal);
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const msg: MailTmMessage = await response.json();
        return this.convertMessage(msg, true);
      } catch (error) {
        if (attempt === 1) {
          log.error('Failed to get Mail.gw message', error);
          throw error;
        }
      }
    }
    throw new Error('Failed to get Mail.gw message after retry');
  }

  /**
   * Delete a message
   */
  async deleteMessage(id: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
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
          continue;
        }

        if (!response.ok && response.status !== 204) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        log.debug('Mail.gw message deleted', { id });
        return;
      } catch (error) {
        if (attempt === 1) {
          log.error('Failed to delete Mail.gw message', error);
          throw error;
        }
      }
    }
    throw new Error('Failed to delete Mail.gw message after retry');
  }

  /**
   * Convert Mail.gw message to our Email type
   */
  private convertMessage(msg: MailTmMessage, includeBody: boolean = false): Email {
    const email: Email = {
      id: msg.id,
      from: msg.from.address,
      subject: msg.subject,
      date: new Date(msg.createdAt).getTime(),
      body: includeBody ? msg.text || msg.intro || '' : msg.intro || '',
      attachments: [],
      read: msg.seen,
    };
    const toAddress = msg.to[0]?.address;
    if (toAddress) {
      email.to = toAddress;
    }
    if (includeBody && msg.html) {
      email.htmlBody = Array.isArray(msg.html) ? msg.html.join('') : String(msg.html);
    }
    if (msg.text) {
      email.textBody = msg.text;
    }
    return email;
  }
}

// Export singleton instance
export const mailGwService = new MailGwService();
