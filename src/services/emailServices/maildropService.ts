// Maildrop Service - GraphQL-based free disposable email
// API: https://api.maildrop.cc/graphql
// Features: No auth required, 24h retention, Heluna spam filters

import { EmailAccount, Email } from '../../types';
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
   * Generate a unique mailbox name
   */
  private generateMailboxName(): string {
    const adjectives = ['swift', 'quick', 'bright', 'calm', 'bold', 'keen', 'cool', 'fresh'];
    const nouns = ['fox', 'owl', 'hawk', 'bear', 'wolf', 'lion', 'deer', 'seal'];
    const rng = new Uint32Array(3);
    crypto.getRandomValues(rng);
    const adj = adjectives[rng[0] % adjectives.length];
    const noun = nouns[rng[1] % nouns.length];
    const num = rng[2] % 9999;
    return `${adj}${noun}${num}`;
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
        const response = await fetch(MAILDROP_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'GhostFill-Extension/1.0',
            'x-apollo-operation-name': 'GhostFillQuery',
            'apollo-require-preflight': 'true',
          },
          body: JSON.stringify({ query, variables }),
          signal,
        });

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
          const msg = result.errors[0].message;
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

    this.lastError = lastError instanceof Error ? lastError.message : String(lastError);
    log.error('GraphQL query failed after maximum retries', lastError);
    throw lastError;
  }

  /**
   * Health check - ping the API
   */
  async ping(): Promise<boolean> {
    try {
      const data = await this.executeGraphQL<{ ping: string }>(PING_QUERY);
      return data.ping === 'pong';
    } catch {
      return false;
    }
  }

  /**
   * Create a new email account (generate mailbox name)
   */
  async createAccount(prefix?: string, signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const mailbox = prefix || this.generateMailboxName();
      const domain = 'maildrop.cc';
      const fullEmail = `${mailbox}@${domain}`;
      const now = Date.now();

      // Maildrop doesn't require account creation - just use any mailbox name
      // But we'll ping to verify the service is up
      const data = await this.executeGraphQL<{ ping: string }>(PING_QUERY, {}, signal);
      const isUp = data?.ping === 'pong';
      if (!isUp) {
        throw new Error('Maildrop API is not responding');
      }

      const account: EmailAccount = {
        id: `maildrop_${now}_${Array.from(crypto.getRandomValues(new Uint8Array(5)))
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

      // For each message, fetch full content (needed for link extraction)
      // Limit to first 10 to avoid excessive API calls
      const fullMessages: Email[] = [];
      for (const msg of messages.slice(0, 10)) {
        if (signal?.aborted) {break;}
        try {
          const fullData = await this.executeGraphQL<{ message: MaildropFullMessage }>(
            MESSAGE_QUERY,
            { mailbox, id: msg.id },
            signal
          );
          if (fullData.message) {
            fullMessages.push(this.convertFullMessage(fullData.message, account.fullEmail));
          }
        } catch (msgError) {
          // If fetching full message fails, fall back to metadata-only version
          log.warn('Failed to fetch full message, using metadata', { id: msg.id, error: msgError });
          fullMessages.push(this.convertMessage(msg, account.fullEmail));
        }
      }

      return fullMessages;
    } catch (error) {
      log.error('Failed to get Maildrop messages', error);
      throw error;
    }
  }

  /**
   * Get a specific message with full content
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
      from: msg.headerfrom || msg.mailfrom,
      to: toEmail,
      subject: msg.subject || '(no subject)',
      date: new Date(msg.date).getTime(),
      body: '',
      attachments: [],
      read: false,
    };
  }

  /**
   * Convert full message to Email type
   */
  private convertFullMessage(msg: MaildropFullMessage, toEmail: string): Email {
    return {
      id: msg.id,
      from: msg.headerfrom || msg.mailfrom,
      to: toEmail,
      subject: msg.subject || '(no subject)',
      date: new Date(msg.date).getTime(),
      body: msg.data || '',
      htmlBody: msg.html || '',
      textBody: msg.data || '',
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
