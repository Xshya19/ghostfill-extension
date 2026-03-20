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

class TempMailService {
  private baseUrl = API.TEMP_MAIL.BASE_URL;
  private requestTimestamps: number[] = [];

  /**
   * Check if rate limit is exceeded
   * @security Prevents API abuse and 429 errors
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < RATE_LIMIT.WINDOW_MS);

    if (this.requestTimestamps.length >= RATE_LIMIT.MAX_REQUESTS_PER_MINUTE) {
      const waitTime = RATE_LIMIT.RETRY_AFTER_MS;
      log.warn('Rate limit exceeded, waiting', { waitTime });
      await new Promise((resolve) => {
        setTimeout(resolve, waitTime);
      });
      return this.checkRateLimit();
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
  async getDomains(): Promise<string[]> {
    await this.checkRateLimit();
    this.recordRequest();

    let apiError: string | null = null;

    try {
      const response = await fetch(
        `${this.baseUrl}?action=${API.TEMP_MAIL.ENDPOINTS.GET_DOMAINS}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const domains = await response.json();
      if (!Array.isArray(domains) || typeof domains[0] !== 'string') {
        throw new Error('Invalid domains API response structure');
      }
      log.debug('TempMail domains fetched successfully', { count: domains.length });
      return domains as string[];
    } catch (error) {
      // Capture error for logging
      apiError = error instanceof Error ? error.message : String(error);
      log.warn('TempMail domain fetch failed, using fallback domains', { error: apiError });
    }

    // Notify user when using fallback (best effort - don't block on this)
    try {
      await this.notifyFallbackUsage(apiError);
    } catch (notifyError) {
      log.debug('Could not send fallback notification', notifyError);
    }

    return TEMP_MAIL_DOMAINS;
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
  async generateEmail(prefix?: string, domain?: string): Promise<EmailAccount> {
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
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Accept: 'application/json',
            },
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
        const domains = await this.getDomains();
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
  async checkInbox(login: string, domain: string): Promise<Email[]> {
    await this.checkRateLimit();
    this.recordRequest();

    try {
      const response = await fetch(
        `${this.baseUrl}?action=${API.TEMP_MAIL.ENDPOINTS.GET_MESSAGES}&login=${login}&domain=${domain}`
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
  async readEmail(id: number, login: string, domain: string): Promise<Email> {
    await this.checkRateLimit();
    this.recordRequest();

    try {
      const response = await fetch(
        `${this.baseUrl}?action=${API.TEMP_MAIL.ENDPOINTS.READ_MESSAGE}&login=${login}&domain=${domain}&id=${id}`
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
