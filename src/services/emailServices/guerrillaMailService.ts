// Guerrilla Mail Service - With Robust Rate Limiting

import { EmailAccount, Email } from '../../types';
import { API } from '../../utils/constants';
import { createLogger } from '../../utils/logger';

const log = createLogger('GuerrillaMailService');

interface GuerrillaSession {
  email_addr: string;
  email_timestamp: number;
  sid_token: string;
  alias?: string;
}

interface GuerrillaEmail {
  mail_id: string;
  mail_from: string;
  mail_subject: string;
  mail_timestamp: string;
  mail_excerpt: string;
  mail_body?: string;
  mail_read: number;
}

class GuerrillaMailService {
  private baseUrl = API.GUERRILLA.BASE_URL;
  private sessionId: string | null = null;
  private emailAddress: string | null = null;

  // Rate limiting state
  private lastRequestTime = 0;
  private minRequestInterval = 2000; // 2 seconds between requests
  private cooldownUntil = 0; // Timestamp until which no requests are allowed
  private backoffMs = 2000; // Start with 2s backoff
  private maxBackoffMs = 30000; // Max 30s backoff
  private consecutiveFailures = 0;

  // Request queue to serialize calls
  private requestQueue: Promise<void> = Promise.resolve();

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Execute Guerrilla Mail API request with robust rate limiting
   */
  private async executeRequest<T>(params: Record<string, string>): Promise<T> {
    // Queue the request to prevent concurrent API calls
    return new Promise((resolve, reject) => {
      this.requestQueue = this.requestQueue.then(async () => {
        try {
          const result = await this.doRequest<T>(params);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async doRequest<T>(params: Record<string, string>): Promise<T> {
    // Check if we're in cooldown
    const now = Date.now();
    if (now < this.cooldownUntil) {
      const waitTime = this.cooldownUntil - now;
      log.debug(`Rate limited. Waiting ${Math.round(waitTime / 1000)}s before retry...`);
      await this.delay(waitTime);
    }

    // Enforce minimum interval between requests
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.delay(this.minRequestInterval - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();

    try {
      const url = new URL(this.baseUrl);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });

      const response = await fetch(url.toString());

      if (response.status === 429) {
        // Exponential backoff
        this.consecutiveFailures++;
        this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
        this.cooldownUntil = Date.now() + this.backoffMs;

        log.warn(`Rate limited (429). Backing off for ${this.backoffMs / 1000}s`);
        throw new Error(`Rate limited. Retry after ${this.backoffMs / 1000}s`);
      }

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // Success - reset backoff
      this.consecutiveFailures = 0;
      this.backoffMs = 2000;

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Rate limited')) {
        log.warn('Guerrilla Mail rate limited (background wait)', { backoff: this.backoffMs });
      } else {
        log.error('Guerrilla Mail API request failed', error);
      }
      throw error;
    }
  }

  /**
   * Create a new email session
   */
  async createAccount(): Promise<EmailAccount> {
    try {
      const data = await this.executeRequest<GuerrillaSession>({
        f: 'get_email_address',
        ip: '1',
        agent: 'GhostFill',
      });

      this.sessionId = data.sid_token;
      this.emailAddress = data.email_addr;

      const [login, domain] = data.email_addr.split('@');
      const now = Date.now();

      return {
        login,
        domain,
        fullEmail: data.email_addr,
        createdAt: now,
        expiresAt: now + 60 * 60 * 1000, // 1 hour session
        service: 'guerrilla',
        token: data.sid_token,
      };
    } catch (error) {
      log.error('Failed to create Guerrilla Mail account', error);
      throw error;
    }
  }

  /**
   * Set session ID from stored account
   */
  setSession(sessionId: string, emailAddress: string): void {
    this.sessionId = sessionId;
    this.emailAddress = emailAddress;
  }

  /**
   * Get messages (inbox)
   */
  async getMessages(sessionId?: string): Promise<Email[]> {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('No session ID available');
    }

    try {
      const data = (await this.executeRequest<{ list: GuerrillaEmail[] }>({
        f: 'get_email_list',
        sid_token: sid,
        offset: '0',
      })) as { list: GuerrillaEmail[] };

      const messages: GuerrillaEmail[] = data.list || [];
      return messages.map((msg) => this.convertMessage(msg));
    } catch (error) {
      log.error('Failed to get Guerrilla Mail messages', error);
      throw error;
    }
  }

  /**
   * Get a specific message
   */
  async getMessage(id: string, sessionId?: string): Promise<Email> {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('No session ID available');
    }

    try {
      const data = await this.executeRequest<GuerrillaEmail>({
        f: 'fetch_email',
        sid_token: sid,
        email_id: id,
      });

      return this.convertMessage(data, true);
    } catch (error) {
      log.error('Failed to get Guerrilla Mail message', error);
      throw error;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(id: string, sessionId?: string): Promise<void> {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('No session ID available');
    }

    try {
      await this.executeRequest<void>({
        f: 'del_email',
        sid_token: sid,
        email_ids: id,
      });

      log.debug('Guerrilla Mail message deleted', { id });
    } catch (error) {
      log.error('Failed to delete Guerrilla Mail message', error);
      throw error;
    }
  }

  /**
   * Convert Guerrilla Mail message to our Email type
   */
  private convertMessage(msg: GuerrillaEmail, includeBody: boolean = false): Email {
    return {
      id: msg.mail_id,
      from: msg.mail_from,
      to: this.emailAddress || undefined,
      subject: msg.mail_subject,
      date: parseInt(msg.mail_timestamp, 10) * 1000, // Convert to milliseconds
      body: includeBody ? msg.mail_body || msg.mail_excerpt : msg.mail_excerpt,
      htmlBody: includeBody ? msg.mail_body : undefined,
      textBody: msg.mail_body,
      attachments: [],
      read: msg.mail_read === 1,
    };
  }
}

// Export singleton instance
export const guerrillaMailService = new GuerrillaMailService();
