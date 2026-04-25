// Mail.tm Service - Alternative email API with JWT auth

import { EmailAccount, Email, MailTmDomain, MailTmAccount, MailTmMessage } from '../../types';
import { API } from '../../utils/constants';
import { fetchWithTimeout } from '../../utils/core';
import { getRandomInt, getRandomString } from '../../utils/encryption';
import { createLogger } from '../../utils/logger';

const log = createLogger('MailTmService');

export class MailTmService {
  private baseUrl = API.MAIL_TM.BASE_URL;
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private tokenRefreshPromise: Promise<string> | null = null;
  private lastErrorTime: number = 0;
  private consecutiveErrors: number = 0;

  // Circuit breaker for auth failures — disables Mail.tm after repeated 401s
  private authFailureCount = 0;
  private authCircuitOpenUntil = 0;
  private readonly AUTH_CIRCUIT_BREAKER_THRESHOLD = 3;
  private readonly AUTH_CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

  // In-memory domain cache to avoid repeated network calls
  private cachedDomainsList: string[] | null = null;
  private domainsCacheTime: number = 0;
  private readonly DOMAINS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

  /**
   * Check if the circuit breaker is open (Mail.tm should be skipped)
   */
  isCircuitBreakerOpen(): boolean {
    if (this.authCircuitOpenUntil > Date.now()) {
      return true;
    }
    if (this.authCircuitOpenUntil > 0 && Date.now() > this.authCircuitOpenUntil) {
      log.info('Mail.tm circuit breaker reset — retrying');
      this.authCircuitOpenUntil = 0;
      this.authFailureCount = 0;
    }
    return false;
  }

  /**
   * Record a successful authentication (resets circuit breaker)
   */
  recordAuthSuccess(): void {
    this.authFailureCount = 0;
    this.authCircuitOpenUntil = 0;
  }

  /**
   * Record an authentication failure (may trip circuit breaker)
   */
  recordAuthFailure(): void {
    this.authFailureCount++;
    if (this.authFailureCount >= this.AUTH_CIRCUIT_BREAKER_THRESHOLD) {
      this.authCircuitOpenUntil = Date.now() + this.AUTH_CIRCUIT_BREAKER_COOLDOWN_MS;
      log.warn(
        `Mail.tm circuit breaker OPEN — ${this.authFailureCount} consecutive auth failures, disabling for 5 min`
      );
    }
  }

  /**
   * Get available domains (with in-memory caching)
   */
  async getDomains(signal?: AbortSignal): Promise<string[]> {
    // Check memory cache first — avoids network call on every email generation
    if (this.cachedDomainsList && Date.now() - this.domainsCacheTime < this.DOMAINS_CACHE_TTL_MS) {
      return this.cachedDomainsList;
    }

    const fallbackDomains = ['bugfoo.com', 'karenkey.com'];
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.DOMAINS}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        log.warn(`Failed to fetch domains (HTTP ${response.status}), using fallback`);
        return fallbackDomains;
      }

      const data = await response.json();
      const domains: MailTmDomain[] = data['hydra:member'] || [];

      const activeDomains = domains.filter((d) => d.isActive && !d.isPrivate).map((d) => d.domain);

      const result = activeDomains.length > 0 ? activeDomains : fallbackDomains;
      // Cache the result in memory
      this.cachedDomainsList = result;
      this.domainsCacheTime = Date.now();
      return result;
    } catch (error) {
      log.error('Failed to fetch Mail.tm domains, using fallback', error);
      return fallbackDomains;
    }
  }

  /**
   * Fetch with retry logic
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
        // Return immediately if successful or client error (4xx) except 429
        if (
          response.ok ||
          (response.status >= 400 && response.status < 500 && response.status !== 429)
        ) {
          return response;
        }

        // If 429 (Too Many Requests) or 5xx, wait and retry
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 1000 * (i + 1));
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
        if (i === retries - 1) {
          throw typeof error === 'object' && error instanceof Error
            ? error
            : new Error(String(error));
        }
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 1000 * (i + 1));
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
    const finalError = new Error(`MailTmService max retries reached (Status: ${lastStatus})`);
    if (lastError) {
      Object.defineProperty(finalError, 'cause', { value: lastError });
    }
    throw finalError;
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
      const login = address || getRandomString(10, 'abcdefghijklmnopqrstuvwxyz0123456789');
      const fullEmail = `${login}@${domain}`;
      const pwd =
        password ||
        getRandomString(16, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

      // Create account
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.ACCOUNTS}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            address: fullEmail,
            password: pwd,
          }),
          signal: signal ?? null,
        }
      );

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorData.message || `HTTP error: ${response.status}`);
      }

      const account: MailTmAccount = await response.json();

      // CRITICAL: Validate account.id exists — required for SSE Mercure subscription
      if (!account.id) {
        log.error('Mail.tm API response missing account.id field — SSE will not work', {
          accountKeys: Object.keys(account),
          accountSample: JSON.stringify(account).substring(0, 200),
        });
        // Generate a fallback ID from the address to prevent undefined
        account.id = `fallback_${Date.now()}_${account.address}`;
      }

      // Mail.tm API has eventual consistency — new accounts need time to propagate
      // before they can authenticate. Progressive delay with polling.
      await this.waitUntilAuthenticatable(fullEmail, pwd, signal);

      // If waitUntilAuthenticatable already got a token, skip the auth loop
      let lastAuthError: Error | null = null;
      const maxAuthAttempts = 4;
      if (!this.token || !this.isAuthenticated()) {
        for (let attempt = 1; attempt <= maxAuthAttempts; attempt++) {
          try {
            await this.authenticate(fullEmail, pwd, signal);
            break;
          } catch (authError) {
            lastAuthError = authError as Error;
            if (attempt < maxAuthAttempts) {
              const delayMs = 1500 * attempt;
              log.warn(
                `Mail.tm auth attempt ${attempt}/${maxAuthAttempts} failed, retrying in ${delayMs}ms`,
                {
                  status: authError instanceof Error ? authError.message : 'unknown',
                }
              );
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }
        }
      }

      if (!this.token) {
        log.error('Mail.tm authentication failed after retries', {
          attempts: maxAuthAttempts,
          error: lastAuthError?.message,
        });
        this.recordAuthFailure();
        throw lastAuthError || new Error('Authentication failed after retries');
      }

      this.recordAuthSuccess();

      const now = Date.now();
      return {
        id: account.id,
        login,
        domain,
        fullEmail: account.address,
        createdAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
        service: 'mailtm',
        password: pwd,
        token: this.token || '',
      };
    } catch (error) {
      log.error('Failed to create Mail.tm account', error);
      throw error;
    }
  }

  /**
   * Wait until a newly created account becomes authenticatable.
   * Mail.tm has eventual consistency — accounts may take 1-3s to propagate.
   * This method polls the token endpoint with progressive delays.
   */
  private async waitUntilAuthenticatable(
    address: string,
    password: string,
    signal?: AbortSignal,
    maxWaitMs = 4000
  ): Promise<void> {
    const delays = [300, 500, 800, 1200]; // progressive polling
    const startTime = Date.now();

    for (const delay of delays) {
      if (Date.now() - startTime > maxWaitMs) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        const response = await fetchWithTimeout(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, password }),
          signal: signal ?? null,
          timeout: 3000,
        });

        if (response.ok) {
          // Consume the token so we don't double-authenticate
          const data = await response.json();
          this.token = data.token;
          this.tokenExpiry = Date.now() + 8 * 60 * 1000;
          log.debug('Account became authenticatable during wait phase');
          return;
        }
      } catch {
        // Still propagating, continue waiting
        continue;
      }
    }

    log.debug('Account propagation wait complete, proceeding to auth loop');
  }

  /**
   * Authenticate and get JWT token
   */
  async authenticate(address: string, password: string, signal?: AbortSignal): Promise<string> {
    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}${API.MAIL_TM.ENDPOINTS.TOKEN}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address, password }),
        signal: signal ?? null,
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.token = null;
        }
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const data = await response.json();
      this.token = data.token;
      this.tokenExpiry = Date.now() + 8 * 60 * 1000;

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
   * Get current JWT token (for SSE Mercure subscription)
   */
  getToken(): string | null {
    return this.isAuthenticated() ? this.token : null;
  }

  /**
   * Set token from stored account
   */
  async setToken(token: string): Promise<void> {
    this.token = token;
    this.tokenExpiry = Date.now() + 8 * 60 * 1000;
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
  async ensureAuthenticated(signal?: AbortSignal): Promise<void> {
    if (this.isAuthenticated()) {
      return;
    }

    // Check if we have credentials in storage to re-authenticate
    try {
      const { storageService } = await import('../storageService');
      const currentEmail = await storageService.get('currentEmail');

      if (currentEmail && currentEmail.service === 'mailtm' && currentEmail.password) {
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
    try {
      await this.ensureAuthenticated(signal);

      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
          signal: signal ?? null,
        }
      );

      if (response.status === 401) {
        log.info('Token invalid, re-authenticating...');
        await this.ensureAuthenticated(signal);

        const retryResponse = await this.fetchWithRetry(
          `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}`,
          {
            headers: {
              Authorization: `Bearer ${this.token}`,
            },
            signal: signal ?? null,
          }
        );

        if (!retryResponse.ok) {
          throw new Error(`HTTP error: ${retryResponse.status}`);
        }

        const data = await retryResponse.json();
        const messages: MailTmMessage[] = data['hydra:member'] || [];

        this.consecutiveErrors = 0;
        return messages.map((msg) => this.convertMessage(msg));
      }

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      const messages: MailTmMessage[] = data['hydra:member'] || [];

      this.consecutiveErrors = 0;
      return messages.map((msg) => this.convertMessage(msg));
    } catch (error) {
      this.consecutiveErrors++;
      const now = Date.now();
      if (now - this.lastErrorTime > 5000) {
        log.error('Failed to get Mail.tm messages', error);
        this.lastErrorTime = now;
      }
      // FIX: Removed providerHealth.recordFailure() — providerHealth was never
      // imported into this service, causing a ReferenceError on every network
      // failure that would crash the service worker's polling loop.
      throw error;
    }
  }

  /**
   * Get a specific message
   */
  async getMessage(id: string, signal?: AbortSignal): Promise<Email> {
    await this.ensureAuthenticated(signal);

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}/${id}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
          signal: signal ?? null,
        }
      );

      if (response.status === 401) {
        await this.ensureAuthenticated(signal);

        const retryResponse = await this.fetchWithRetry(
          `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}/${id}`,
          {
            headers: {
              Authorization: `Bearer ${this.token}`,
            },
            signal: signal ?? null,
          }
        );

        if (!retryResponse.ok) {
          throw new Error(`HTTP error: ${retryResponse.status}`);
        }

        const msg: MailTmMessage = await retryResponse.json();
        return this.convertMessage(msg, true);
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
      const response = await this.fetchWithRetry(
        `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}/${id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        }
      );

      if (response.status === 401) {
        await this.ensureAuthenticated();

        const retryResponse = await this.fetchWithRetry(
          `${this.baseUrl}${API.MAIL_TM.ENDPOINTS.MESSAGES}/${id}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${this.token}`,
            },
          }
        );

        if (!retryResponse.ok && retryResponse.status !== 204) {
          throw new Error(`HTTP error: ${retryResponse.status}`);
        }

        log.debug('Mail.tm message deleted', { id });
        return;
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
    const result: Email = {
      id: msg.id,
      from: msg.from.address,
      to: msg.to[0]?.address ?? '',
      subject: msg.subject,
      date: new Date(msg.createdAt).getTime(),
      body: includeBody ? msg.text || msg.intro || '' : msg.intro || '',
      attachments: [],
      read: msg.seen,
    };
    if (includeBody && msg.html) {
      result.htmlBody = Array.isArray(msg.html) ? msg.html.join('') : String(msg.html);
    }
    if (msg.text) {
      result.textBody = msg.text;
    }
    return result;
  }
}

// Export singleton instance
export const mailTmService = new MailTmService();
