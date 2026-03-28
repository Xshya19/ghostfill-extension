// TempMail Service - 1secmail.com API integration

import { EmailAccount, Email, TempMailMessage, TempMailFullMessage } from '../../types';
import { API, TEMP_MAIL_DOMAINS } from '../../utils/constants';
import { createLogger } from '../../utils/logger';

const log = createLogger('TempMailService');

// SECURITY FIX: Rate limiting configuration
const RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: 30,
  WINDOW_MS: 60 * 1000,
  RETRY_AFTER_MS: 2000,
};

const DOMAINS_CACHE_TTL_MS = 5 * 60 * 1000;

class TempMailService {
  private baseUrl = API.TEMP_MAIL.BASE_URL;
  private requestTimestamps: number[] = [];
  private cachedDomains: string[] | null = null;
  private cachedDomainsExpiresAt = 0;
  private cachedDomainsSource: 'api' | 'fallback' | null = null;
  private lastDomainFetchError: string | null = null;
  private hasNotifiedFallbackUsage = false;

  /**
   * Check if rate limit is exceeded
   * @security Prevents API abuse and 429 errors
   */
  private async checkRateLimit(): Promise<void> {
    // Use iterative loop instead of recursion to prevent potential call stack overflow
    while (this.requestTimestamps.length >= RATE_LIMIT.MAX_REQUESTS_PER_MINUTE) {
      const now = Date.now();
      this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < RATE_LIMIT.WINDOW_MS);

      if (this.requestTimestamps.length < RATE_LIMIT.MAX_REQUESTS_PER_MINUTE) {
        break;
      }

      log.warn('Rate limit exceeded, waiting', { waitTime: RATE_LIMIT.RETRY_AFTER_MS });
      await new Promise((resolve) => {
        setTimeout(resolve, RATE_LIMIT.RETRY_AFTER_MS);
      });
    }
  }

  /**
   * Record a request for rate limiting
   */
  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Get available domains
   * Falls back to hardcoded domains if API fails
   * BUG FIX: Now properly logs and notifies when using fallback domains
   */
  async getDomains(signal?: AbortSignal): Promise<string[]> {
    if (this.cachedDomains && Date.now() < this.cachedDomainsExpiresAt) {
      return this.cachedDomains;
    }

    await this.checkRateLimit();
    this.recordRequest();

    let apiError: string | null = null;

    try {
      const response = await fetch(
        `${this.baseUrl}?action=${API.TEMP_MAIL.ENDPOINTS.GET_DOMAINS}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
          },
          signal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const domains = await response.json();
      if (!Array.isArray(domains) || typeof domains[0] !== 'string') {
        throw new Error('Invalid domains API response structure');
      }
      this.cachedDomains = domains as string[];
      this.cachedDomainsExpiresAt = Date.now() + DOMAINS_CACHE_TTL_MS;
      this.cachedDomainsSource = 'api';
      this.lastDomainFetchError = null;
      this.hasNotifiedFallbackUsage = false;
      log.debug('TempMail domains fetched successfully', { count: domains.length });
      return this.cachedDomains;
    } catch (error) {
      // Capture error for logging
      apiError = error instanceof Error ? error.message : String(error);
      if (apiError !== this.lastDomainFetchError) {
        log.warn('TempMail domain fetch failed, using fallback domains', { error: apiError });
        this.lastDomainFetchError = apiError;
      } else {
        log.debug('TempMail domain fetch still failing; reusing fallback domains', { error: apiError });
      }
    }

    // Notify user when using fallback (best effort - don't block on this)
    if (!this.hasNotifiedFallbackUsage) {
      try {
        await this.notifyFallbackUsage(apiError);
        this.hasNotifiedFallbackUsage = true;
      } catch (notifyError) {
        log.debug('Could not send fallback notification', notifyError);
      }
    }

    this.cachedDomains = TEMP_MAIL_DOMAINS;
    this.cachedDomainsExpiresAt = Date.now() + DOMAINS_CACHE_TTL_MS;
    this.cachedDomainsSource = 'fallback';
    return this.cachedDomains;
  }

  isUsingFallbackDomains(): boolean {
    return this.cachedDomainsSource === 'fallback';
  }

  /**
   * Notify when fallback domains are being used
   * Sends message to background script for user notification
   */
  private async notifyFallbackUsage(error?: string): Promise<void> {
    try {
      await chrome.runtime.sendMessage({
        action: 'FALLBACK_DOMAINS_USED',
        payload: {
          service: 'tempmail',
          reason: 'API_UNAVAILABLE',
          timestamp: Date.now(),
          error: error || 'Unknown error',
        },
      });
      log.debug('Fallback domains notification sent');
    } catch {
      // Silent fail - notification is best-effort
      log.debug('Could not send fallback notification (extension context may be invalid)');
    }
  }

  /**
   * Generate a random email address
   */
  async generateEmail(prefix?: string, domain?: string, signal?: AbortSignal): Promise<EmailAccount> {
    await this.checkRateLimit();
    this.recordRequest();

    try {
      let login: string = '';
      let emailDomain: string = '';

      if (prefix) {
        // Use custom prefix
        login = prefix.toLowerCase().replace(/[^a-z0-9]/g, '');
      } else {
        // Generate random email from API
        const response = await fetch(
          `${this.baseUrl}?action=${API.TEMP_MAIL.ENDPOINTS.GEN_RANDOM}&count=1`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"',
            },
            signal,
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const emails = await response.json();
        if (!Array.isArray(emails) || typeof emails[0] !== 'string' || !emails[0].includes('@')) {
          throw new Error('Invalid generated email API response structure');
        }
        const [generatedEmail] = emails;
        const parts = generatedEmail.split('@');
        login = parts[0];
        emailDomain = parts[1];
      }

      // Use provided domain or get from generated email or default
      if (domain) {
        emailDomain = domain;
      } else if (!emailDomain) {
        const domains = await this.getDomains(signal);
        emailDomain = domains[Math.floor(Math.random() * domains.length)];
      }

      const fullEmail = `${login}@${emailDomain}`;
      const now = Date.now();

      const account: EmailAccount = {
        login,
        domain: emailDomain,
        fullEmail,
        createdAt: now,
        expiresAt: now + 60 * 60 * 1000, // 1 hour expiry
        service: 'tempmail',
      };

      log.info('Generated email', { email: fullEmail });
      return account;
    } catch (error) {
      log.error('Failed to generate email', error);
      throw error;
    }
  }

  /**
   * Check inbox for messages with rate limiting
   */
  async checkInbox(login: string, domain: string, signal?: AbortSignal): Promise<Email[]> {
    await this.checkRateLimit();
    this.recordRequest();

    try {
      const response = await fetch(
        `${this.baseUrl}?action=${API.TEMP_MAIL.ENDPOINTS.GET_MESSAGES}&login=${login}&domain=${domain}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          },
          signal
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const messages: TempMailMessage[] = await response.json();

      if (!Array.isArray(messages)) {
        return [];
      }

      // Limit messages mapped to avoid extreme large response DoS
      if (messages.length > 50) {
        messages.length = 50;
      }

      for (const msg of messages) {
        if (typeof msg.id !== 'number' && typeof msg.id !== 'string') {
          throw new Error('Invalid message ID');
        }
      }

      return messages.map((msg) => this.convertMessage(msg, login, domain));
    } catch (error) {
      log.error('Failed to check inbox', error);
      throw error;
    }
  }

  /**
   * Read a specific email with rate limiting
   */
  async readEmail(id: number, login: string, domain: string, signal?: AbortSignal): Promise<Email> {
    await this.checkRateLimit();
    this.recordRequest();

    try {
      const response = await fetch(
        `${this.baseUrl}?action=${API.TEMP_MAIL.ENDPOINTS.READ_MESSAGE}&login=${login}&domain=${domain}&id=${id}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          },
          signal
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const message: TempMailFullMessage = await response.json();
      if (!message || (typeof message.id !== 'number' && typeof message.id !== 'string')) {
        throw new Error('Invalid message body structure');
      }
      return this.convertFullMessage(message, login, domain);
    } catch (error) {
      log.error('Failed to read email', error);
      throw error;
    }
  }

  /**
   * Convert API message to our Email type
   */
  private convertMessage(msg: TempMailMessage, login: string, domain: string): Email {
    return {
      id: msg.id,
      from: msg.from,
      to: `${login}@${domain}`,
      subject: msg.subject,
      date: new Date(msg.date).getTime(),
      body: '',
      attachments: [],
      read: false,
    };
  }

  /**
   * Convert API full message to our Email type
   */
  private convertFullMessage(msg: TempMailFullMessage, login: string, domain: string): Email {
    return {
      id: msg.id,
      from: msg.from,
      to: `${login}@${domain}`,
      subject: msg.subject,
      date: new Date(msg.date).getTime(),
      body: msg.body || msg.textBody || '',
      htmlBody: msg.htmlBody,
      textBody: msg.textBody,
      attachments:
        msg.attachments?.map((att) => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
        })) || [],
      read: true,
    };
  }
}

// Export singleton instance
export const tempMailService = new TempMailService();
