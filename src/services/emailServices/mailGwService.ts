// Mail.gw Service - Free temporary email API (similar to Mail.tm)

import { EmailAccount, Email, MailTmDomain, MailTmAccount, MailTmMessage } from '../../types';
import { API, fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { getSenderSource } from '../../utils/emailIdentity';
import { getRandomInt, getRandomString } from '../../utils/encryption';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { extractMessageList } from './messageListShape';

const log = createLogger('MailGwService');

class MailGwService {
  private baseUrl = API.MAIL_GW.BASE_URL;
  private token: string | null = null;
  private tokenExpiry: number = 0;
  /**
   * Account credentials kept in memory next to the token.
   *
   * WHY: the Mail.gw JWT only lives for an hour and the service worker is
   * killed/restarted constantly. Without the credentials the service had no
   * way to obtain a fresh token, so the inbox silently stopped being polled
   * (0 HTTP requests) an hour after every restart.
   */
  private credentials: { address: string; password: string } | null = null;

  /**
   * Fetch with robust retry logic (Exponential Backoff + Jitter)
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit & { timeout?: number } = {},
    retries = 3
  ): Promise<Response> {
    let lastError: Error | unknown = null;
    let lastStatus = 0;

    for (let i = 0; i < retries; i++) {
      if (options.signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }

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
        const jitter = getRandomInt(0, 499);
        const delay = baseDelay + jitter;

        log.warn(`API request failed (${response.status}), retrying in ${Math.round(delay)}ms...`, {
          attempt: i + 1,
        });
        await new Promise<void>((resolve, reject) => {
          if (options?.signal?.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
          }
          const timeoutId = setTimeout(resolve, delay);
          if (options?.signal) {
            options.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timeoutId);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          }
        });
      } catch (error) {
        lastError = error;

        if (
          options.signal?.aborted ||
          (error as Error).name === 'AbortError' ||
          (error as Error).message === 'AbortError'
        ) {
          throw error;
        }

        if (i === retries - 1) {
          throw typeof error === 'object' && error instanceof Error
            ? error
            : new Error(String(error));
        }
        const delay = 2000 * Math.pow(2, i);
        log.warn(`Network error, retrying in ${Math.round(delay)}ms...`, error);
        await new Promise<void>((resolve, reject) => {
          if (options?.signal?.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
          }
          const timeoutId = setTimeout(resolve, delay);
          if (options?.signal) {
            options.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timeoutId);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
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
      const options: RequestInit & { timeout?: number } = {
        timeout: 4000,
      };
      if (signal) {
        options.signal = signal;
      }
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.DOMAINS}`,
        options,
        1 // Only 1 attempt for domains fetch
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
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('Aborted') ||
          error.message.includes('timed out'))
      ) {
        log.debug('Failed to fetch Mail.gw domains due to abort/timeout, using fallback');
      } else {
        log.warn('Failed to fetch Mail.gw domains, using fallback', error);
      }
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
      const domain = domains[getRandomInt(0, domains.length - 1)]!;
      const login = address || generateHumanLikeUsername();
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
      // Keep the credentials so the token can be renewed later on.
      this.credentials = { address, password };

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
   * Set token from stored account.
   *
   * The address/password are kept in memory next to the token so the
   * service can renew the token by itself once the 1 h TTL expires — also
   * right after a service-worker restart, where no in-memory state survives
   * but the caller still knows the account credentials.
   */
  setToken(token: string, address?: string, password?: string): void {
    if (!token) {
      // Explicit sign-out (clearData) — drop the token AND the credentials.
      this.token = null;
      this.tokenExpiry = 0;
      this.credentials = null;
      return;
    }

    if (
      address &&
      this.credentials?.address === address &&
      (this.isAuthenticated() || this.tokenRefreshPromise)
    ) {
      // Same account with a live token — keep it. The in-memory token can be
      // newer than the persisted one (e.g. after a 401-triggered re-auth),
      // and replacing it would restart the auth dance on every poll.
      if (password) {
        this.credentials = { address, password };
      }
      return;
    }

    this.token = token;
    this.tokenExpiry = Date.now() + 60 * 60 * 1000;
    this.credentials = address
      ? {
          address,
          password: password || (this.credentials?.address === address ? this.credentials.password : ''),
        }
      : null;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return Boolean(this.token) && Date.now() < this.tokenExpiry;
  }

  private tokenRefreshPromise: Promise<string> | null = null;

  /**
   * Read the Mail.gw account from storage.
   *
   * BOTH keys are checked: the aggregator always stores a disposable account
   * under 'disposableEmail' and only mirrors it into 'currentEmail' when the
   * user is not on a Gmail alias. Reading 'currentEmail' alone therefore
   * locked out every user whose active mailbox lived in 'disposableEmail'
   * (or whose 'currentEmail' was a different provider).
   */
  private async readStoredAccount(): Promise<EmailAccount | null> {
    const { storageService } = await import('../storageService');
    const candidates: EmailAccount[] = [];

    for (const key of ['currentEmail', 'disposableEmail'] as const) {
      try {
        const account = await storageService.get(key);
        if (account && account.service === 'mailgw' && account.fullEmail && account.password) {
          candidates.push(account);
        }
      } catch (error) {
        log.warn(`Failed to read "${key}" while looking for Mail.gw credentials`, error);
      }
    }

    // Prefer the account we were last asked to poll.
    const preferred = this.credentials?.address;
    if (preferred) {
      const match = candidates.find((account) => account.fullEmail === preferred);
      if (match) {
        return match;
      }
    }
    return candidates[0] ?? null;
  }

  /**
   * Ensure we have a valid token, re-authenticating if necessary
   */
  private async ensureAuthenticated(signal?: AbortSignal): Promise<void> {
    if (this.isAuthenticated()) {
      return;
    }

    if (this.tokenRefreshPromise) {
      await this.tokenRefreshPromise;
      return;
    }

    this.tokenRefreshPromise = (async () => {
      // (1) In-memory credentials win: they belong to the account the
      //     aggregator is currently polling.
      const inMemory = this.credentials;
      if (inMemory?.address && inMemory.password) {
        log.info('Mail.gw token expired, re-authenticating with in-memory credentials');
        return this.authenticate(inMemory.address, inMemory.password, signal);
      }

      // (2) Storage fallback — 'currentEmail' AND 'disposableEmail'.
      try {
        const stored = await this.readStoredAccount();
        if (stored?.fullEmail && stored.password) {
          log.info('Mail.gw token expired, re-authenticating with stored account');
          return await this.authenticate(stored.fullEmail, stored.password, signal);
        }
      } catch (error) {
        log.warn('Failed to retrieve credentials for Mail.gw re-authentication', error);
      }

      throw new Error('Not authenticated and cannot refresh token');
    })();

    const refresh = this.tokenRefreshPromise;
    try {
      await refresh;
    } finally {
      if (this.tokenRefreshPromise === refresh) {
        this.tokenRefreshPromise = null;
      }
    }
  }

  /**
   * Fetch full body for a single message
   */
  private async fetchFullMessage(
    messageId: string,
    signal?: AbortSignal
  ): Promise<{ text: string; html: string }> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_GW.ENDPOINTS.MESSAGES}/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
          signal: signal ?? null,
        }
      );

      if (!response.ok) {
        return { text: '', html: '' };
      }

      const msg: MailTmMessage = await response.json();
      return {
        text: msg.text || '',
        html: Array.isArray(msg.html) ? msg.html.join('') : String(msg.html || ''),
      };
    } catch {
      return { text: '', html: '' };
    }
  }

  /**
   * Get messages (inbox) with full body for recent messages
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
        // A malformed payload must throw: mapping it onto [] would look like
        // an empty inbox and the aggregator would score the check as a
        // success (no circuit breaker, no fallback provider).
        const messages = extractMessageList(data, 'Mail.gw getMessages', {
          keys: ['hydra:member'],
        }) as MailTmMessage[];

        // Fetch full body for first 5 messages
        const recentMessages = messages.slice(0, 5);
        const fullBodyResults = await Promise.all(
          recentMessages.map(async (msg) => this.fetchFullMessage(msg.id, signal))
        );

        return messages.map((msg, idx) => {
          const email = this.convertMessage(msg, idx < 5);
          if (idx < 5 && fullBodyResults[idx]) {
            const body = fullBodyResults[idx]!;
            email.body = body.text || msg.intro || '';
            email.textBody = body.text || '';
            email.htmlBody = body.html || '';
          }
          return email;
        });
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
    const rawBody = includeBody ? msg.text || msg.intro || '' : msg.intro || '';
    const bodyStr = contentToString(rawBody);
    const textStr = contentToString(msg.text || rawBody);
    const htmlStr = includeBody && msg.html
      ? contentToString(Array.isArray(msg.html) ? msg.html.join('') : msg.html)
      : '';

    const email: Email = {
      id: String(msg.id),
      // Sender-less system messages would otherwise throw inside
      // messages.map and fail the ENTIRE inbox fetch.
      from: getSenderSource(undefined, msg.from),
      subject: contentToString(msg.subject, '(No Subject)'),
      date: safeParseDate(msg.createdAt),
      body: bodyStr,
      htmlBody: htmlStr || bodyStr,
      textBody: textStr,
      attachments: [],
      read: Boolean(msg.seen),
    };
    const toAddress = msg.to?.[0]?.address;
    if (toAddress) {
      email.to = contentToString(toAddress);
    }
    return email;
  }
}

// Export singleton instance
export const mailGwService = new MailGwService();
