// TMailor Service - Premium Rotating Domain Provider
// 500+ rotating domains hosted on Google servers to avoid blocklisting

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { createLogger } from '../../utils/logger';

const log = createLogger('TMailorService');

const TMAILOR_API = 'https://api.tmailor.com/api/v1';

const TMAILOR_HEADERS = {
  Accept: 'application/json',
};

interface TMailorEmailResponse {
  email: string;
  token?: string;
  domain: string;
}

interface TMailorMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
  body?: string;
  html?: string;
}

class TMailorService {
  private currentToken: string | null = null;

  /**
   * Exponential backoff retry wrapper
   */
  private async fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3): Promise<Response> {
    let lastError: Error | unknown = null;
    let lastStatus = 0;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetchWithTimeout(url, options);
        lastStatus = response.status;
        // If ok or a non-rate-limit 4xx, return immediately
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          return response;
        }

        // Retry on 5xx or 429 Rate Limit
        const baseDelay = 1000 * Math.pow(2, i);
        const jitter = Math.random() * 500;
        const delay = baseDelay + jitter;

        log.warn(`TMailor API request failed (${response.status}), retrying in ${Math.round(delay)}ms...`, {
          attempt: i + 1,
        });

        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      } catch (error) {
        lastError = error;
        if (i === maxRetries - 1) {
          throw typeof error === 'object' && error instanceof Error ? error : new Error(String(error));
        }
        const delay = 1000 * Math.pow(2, i);
        log.warn(`TMailor network error, retrying in ${Math.round(delay)}ms...`, error);

        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      }
    }
    const finalError = new Error(`TMailorService unreachable after retries (Status: ${lastStatus})`);
    if (lastError) {
      Object.defineProperty(finalError, 'cause', { value: lastError });
    }
    throw finalError;
  }

  /**
   * Generate a new email with rotating domain
   */
  async createAccount(prefix?: string): Promise<EmailAccount> {
    try {
      // Generate random prefix if not provided
      const emailPrefix = prefix || this.generatePrefix();

      // First, get available domains
      const domainsRes = await this.fetchWithRetry(`${TMAILOR_API}/domains`, {
        headers: TMAILOR_HEADERS,
      });

      if (!domainsRes.ok) {
        throw new Error('Failed to fetch domains from TMailor API');
      }

      let domain = 'tmailor.com'; // Default fallback

      const domains = await domainsRes.json();
      if (Array.isArray(domains) && domains.length > 0) {
        // Pick a cryptographically random domain from the pool
        const rand = new Uint32Array(1);
        crypto.getRandomValues(rand);
        domain = domains[rand[0] % domains.length];
      }

      // Create the email account
      const createRes = await this.fetchWithRetry(`${TMAILOR_API}/create`, {
        method: 'POST',
        headers: {
          ...TMAILOR_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: `${emailPrefix}@${domain}`,
        }),
      });

      if (!createRes.ok) {
        throw new Error(`TMailor API error: ${createRes.status}`);
      }

      const data: TMailorEmailResponse = await createRes.json();
      this.currentToken = data.token || null;

      const account: EmailAccount = {
        id: this.generateId(),
        username: emailPrefix,
        domain: data.domain || domain,
        fullEmail: data.email,
        service: 'tmailor',
        token: data.token,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };

      log.info('TMailor email created', { email: account.fullEmail, domain: account.domain });
      return account;
    } catch (error) {
      log.warn('TMailor create failed', error);
      throw error;
    }
  }

  /**
   * Fetch emails from inbox
   */
  async getEmails(account: EmailAccount): Promise<Email[]> {
    try {
      const response = await this.fetchWithRetry(
        `${TMAILOR_API}/emails?address=${encodeURIComponent(account.fullEmail)}&token=${account.token}`,
        { headers: TMAILOR_HEADERS }
      );

      if (!response.ok) {
        log.warn('TMailor inbox fetch failed', { status: response.status });
        return [];
      }

      const messages: TMailorMessage[] = await response.json();

      return messages.map((msg) => ({
        id: msg.id,
        from: msg.from,
        subject: msg.subject || '(no subject)',
        body: msg.body || '',
        htmlBody: msg.html || '',
        date: new Date(msg.date).getTime(),
        attachments: [],
        read: false,
      }));
    } catch (error) {
      log.warn('TMailor getEmails failed', error);
      return [];
    }
  }

  /**
   * Read full email content
   */
  async readEmail(id: string, account: EmailAccount): Promise<Email> {
    try {
      const response = await this.fetchWithRetry(
        `${TMAILOR_API}/email/${id}?address=${encodeURIComponent(account.fullEmail)}&token=${account.token}`,
        { headers: TMAILOR_HEADERS }
      );

      if (!response.ok) {
        throw new Error(`Failed to read email: ${response.status}`);
      }

      const msg: TMailorMessage = await response.json();

      return {
        id: msg.id,
        from: msg.from,
        subject: msg.subject || '(no subject)',
        body: msg.body || '',
        htmlBody: msg.html || '',
        date: new Date(msg.date).getTime(),
        attachments: [],
        read: true,
      };
    } catch (error) {
      log.warn('TMailor readEmail failed', error);
      throw error;
    }
  }

  /**
   * Generate random prefix
   */
  private generatePrefix(): string {
    const adjectives = ['swift', 'bright', 'calm', 'deep', 'eager', 'fair', 'glad', 'keen'];
    const nouns = ['fox', 'owl', 'wave', 'star', 'cloud', 'river', 'swift', 'peak'];
    const rng = new Uint32Array(3);
    crypto.getRandomValues(rng);
    const adj = adjectives[rng[0] % adjectives.length];
    const noun = nouns[rng[1] % nouns.length];
    const num = rng[2] % 9999;
    return `${adj}${noun}${num}`;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const rng = new Uint8Array(5);
    crypto.getRandomValues(rng);
    return `tmailor_${Date.now()}_${Array.from(rng)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }
}

export const tmailorService = new TMailorService();
