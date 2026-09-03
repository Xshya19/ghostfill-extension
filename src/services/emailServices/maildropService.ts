// Maildrop Service - GraphQL-based free disposable email
// API: https://api.maildrop.cc/graphql
// Features: No auth required, 24h retention, Heluna spam filters

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('MaildropService');

const MAILDROP_API = 'https://api.maildrop.cc/graphql';

// GraphQL queries
const INBOX_QUERY = `
query ($mailbox: String!) {
    inbox(mailbox: $mailbox) {
        id
        mailfrom
        subject
        date
        headerfrom
    }
}`;

const MESSAGE_QUERY = `
query ($mailbox: String!, $id: String!) {
    message(mailbox: $mailbox, id: $id) {
        id
        mailfrom
        headerfrom
        subject
        date
        html
        data
    }
}`;

const PING_QUERY = `
query {
    ping
}`;

interface MaildropInboxMessage {
  id: string;
  mailfrom: string;
  subject: string;
  date: string;
  headerfrom: string;
}

interface MaildropFullMessage extends MaildropInboxMessage {
  html: string;
  data: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

class MaildropService {
  private lastError: string | null = null;

  /**
   * Generate a unique mailbox name using human-like names
   */
  private generateMailboxName(): string {
    return generateHumanLikeUsername();
  }

  /**
   * Execute GraphQL query with retry logic
   */
  private async executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal,
    retries = 3
  ): Promise<T> {
    let lastError: Error | unknown = null;

    for (let i = 0; i < retries; i++) {
      try {
        const fetchInit: RequestInit = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'GhostFill-Extension/1.0',
            'x-apollo-operation-name': 'GhostFillQuery',
            'apollo-require-preflight': 'true',
          },
          body: JSON.stringify({ query, variables }),
          signal: signal ?? null,
        };
        const response = await fetchWithTimeout(MAILDROP_API, fetchInit);

        if (!response.ok) {
          // If 429 or 5xx, retry
          if (response.status === 429 || response.status >= 500) {
            throw new Error(`HTTP ${response.status}`);
          }
          // Otherwise fail immediately for client errors
          throw new Error(`HTTP error: ${response.status}`);
        }

        const result: GraphQLResponse<T> = await response.json();

        if (result.errors && result.errors.length > 0) {
          // Check if it's a transient GraphQL error
          const msg = result.errors[0]!.message;
          if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('rate limit')) {
            throw new Error(msg);
          }
          throw new Error(msg);
        }

        if (!result.data) {
          throw new Error('No data in response');
        }

        return result.data;
      } catch (error) {
        lastError = error;

        // Don't retry if aborted
        if (signal?.aborted) {
          throw error;
        }

        // Don't retry on certain errors (like 400 Bad Request) unless it's the last attempt
        if (i < retries - 1) {
          const waitTime = 1000 * (i + 1);
          log.warn(`Maildrop GraphQL attempt ${i + 1} failed, retrying in ${waitTime}ms...`, error);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
      }
    }

    const finalError =
      lastError instanceof Error ? lastError : new Error('Maildrop GraphQL request failed');
    this.lastError = finalError.message;
    throw finalError;
  }

  /**
   * Health check / ping the API
   */
  async ping(signal?: AbortSignal): Promise<boolean> {
    try {
      const data = await this.executeGraphQL<{ ping: string }>(PING_QUERY, {}, signal, 1);
      return data.ping === 'pong';
    } catch (error) {
      log.debug('Maildrop ping failed', error);
      return false;
    }
  }

  /**
   * Get available domains
   * Maildrop supports multiple domains, but maildrop.cc is primary
   */
  async getDomains(signal?: AbortSignal): Promise<string[]> {
    // Check health first with quick timeout. A failed ping means an empty
    // list so the aggregator health check ejects this provider instead of
    // treating it as permanently healthy.
    const isHealthy = await this.ping(signal);
    if (!isHealthy) {
      log.warn('Maildrop API appears down during domains check');
      return [];
    }

    // Known Maildrop domains
    return ['maildrop.cc'];
  }

  /**
   * Create a new disposable email account
   * Maildrop doesn't require registration - just generate a mailbox name
   */
  async createAccount(prefix?: string, signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const mailbox = prefix ? prefix.toLowerCase().replace(/[^a-z0-9]/g, '') : this.generateMailboxName();
      const domain = 'maildrop.cc';
      const fullEmail = `${mailbox}@${domain}`;
      const now = Date.now();

      // Quick health check to ensure API is reachable
      await this.ping(signal);

      const account: EmailAccount = {
        id: `maildrop_${now}_${Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')}`,
        username: mailbox,
        login: mailbox, // For backward compatibility
        domain,
        fullEmail,
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours (Maildrop retention)
        service: 'maildrop',
        token: mailbox, // Store mailbox name as token for later retrieval
      };

      log.info('Maildrop email created', { email: fullEmail });
      return account;
    } catch (error) {
      log.error('Failed to create Maildrop account', error);
      throw error;
    }
  }

  /**
   * Get messages from inbox with full content
   * Note: Maildrop's inbox query only returns metadata, so we fetch full content for each
   */
  async getMessages(account: EmailAccount, signal?: AbortSignal): Promise<Email[]> {
    try {
      const mailbox = account.token || account.username || account.login;
      if (!mailbox) {
        throw new Error('No mailbox identifier available');
      }

      // First, get inbox list (metadata only)
      const data = await this.executeGraphQL<{ inbox: MaildropInboxMessage[] }>(
        INBOX_QUERY,
        { mailbox },
        signal
      );

      const messages = data.inbox || [];

      // Fetch full content concurrently so a busy inbox does not spend one
      // network round-trip per message before link/OTP extraction can start.
      const fullMessages = await Promise.all(
        messages.slice(0, 10).map(async (msg): Promise<Email | null> => {
          if (signal?.aborted) {
            return null;
          }
          try {
            const fullData = await this.executeGraphQL<{ message: MaildropFullMessage }>(
              MESSAGE_QUERY,
              { mailbox, id: msg.id },
              signal
            );
            if (fullData.message) {
              return this.convertFullMessage(fullData.message, account.fullEmail);
            }
          } catch (msgError) {
            // If fetching full message fails, fall back to metadata-only version
            log.warn('Failed to fetch full message, using metadata', {
              id: msg.id,
              error: msgError,
            });
            return this.convertMessage(msg, account.fullEmail);
          }
          return this.convertMessage(msg, account.fullEmail);
        })
      );

      return fullMessages.filter((message): message is Email => message !== null);
    } catch (error) {
      log.error('Failed to get Maildrop messages', error);
      throw error;
    }
  }

  /**
   * Get a specific message by ID
   */
  async getMessage(emailId: string, account: EmailAccount, signal?: AbortSignal): Promise<Email> {
    try {
      const mailbox = account.token || account.username || account.login;
      if (!mailbox) {
        throw new Error('No mailbox identifier available');
      }

      const data = await this.executeGraphQL<{ message: MaildropFullMessage }>(
        MESSAGE_QUERY,
        { mailbox, id: emailId },
        signal
      );

      if (!data.message) {
        throw new Error(`Message ${emailId} not found`);
      }

      return this.convertFullMessage(data.message, account.fullEmail);
    } catch (error) {
      log.error('Failed to get Maildrop message', error);
      throw error;
    }
  }

  /**
   * Delete a message (Maildrop auto-deletes after 24h, no manual delete)
   */
  async deleteMessage(id: string): Promise<void> {
    void id;
    log.debug('Maildrop does not support manual message deletion');
    // Maildrop handles cleanup automatically
  }

  /**
   * Convert inbox message to Email type
   */
  private convertMessage(msg: MaildropInboxMessage, toEmail: string): Email {
    return {
      id: msg.id,
      from: contentToString(msg.headerfrom || msg.mailfrom, 'Unknown Sender'),
      to: toEmail,
      subject: contentToString(msg.subject, '(no subject)'),
      date: safeParseDate(msg.date),
      body: '',
      attachments: [],
      read: false,
    };
  }

  /**
   * Convert full message to Email type
   */
  private convertFullMessage(msg: MaildropFullMessage, toEmail: string): Email {
    const bodyStr = contentToString(msg.data);
    const htmlStr = contentToString(msg.html);
    const textStr = contentToString(msg.data);
    return {
      id: msg.id,
      from: contentToString(msg.headerfrom || msg.mailfrom, 'Unknown Sender'),
      to: toEmail,
      subject: contentToString(msg.subject, '(no subject)'),
      date: safeParseDate(msg.date),
      body: bodyStr,
      htmlBody: htmlStr,
      textBody: textStr,
      attachments: [],
      read: true,
    };
  }

  /**
   * Get last error message
   */
  getLastError(): string | null {
    return this.lastError;
  }
}

export const maildropService = new MaildropService();
