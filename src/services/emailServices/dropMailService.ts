// DropMail Service - GraphQL-based temporary email API

import { EmailAccount, Email } from '../../types';
import { API } from '../../utils/constants';
import { createLogger } from '../../utils/logger';

const log = createLogger('DropMailService');

interface DropMailSession {
  id: string;
  expiresAt: string;
  addresses: string[];
}

interface DropMailMessage {
  id: string;
  headerFrom: string;
  headerTo: string;
  headerSubject: string;
  text: string;
  html: string[];
  downloadUrl: string;
  createdAt: string;
  introduced: string;
}

class DropMailService {
  private baseUrl = `${API.DROPMAIL.BASE_URL}${API.DROPMAIL.GRAPHQL_ENDPOINT}`;
  private sessionId: string | null = null;
  private sessionToken: string | null = null;

  /**
   * Execute GraphQL query
   */
  private async executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<T> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: JSON.stringify({ query, variables }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = (await response.json()) as { data: T; errors?: Array<{ message: string }> };
      if (result.errors) {
        throw new Error(result.errors[0]?.message || 'GraphQL error');
      }

      return result.data;
    } catch (error) {
      log.error('GraphQL query failed', error);
      throw error;
    }
  }

  /**
   * Create a new email session
   */
  async createAccount(signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const query = `
                mutation {
                    introduceSession {
                        id
                        expiresAt
                        addresses {
                            address
                        }
                    }
                }
            `;

      const data = await this.executeGraphQL<{ introduceSession: DropMailSession }>(query, {}, signal);
      const session: DropMailSession = data.introduceSession;

      this.sessionId = session.id;
      this.sessionToken = session.id;

      const fullEmail = session.addresses?.[0];
      if (!fullEmail) {
        throw new Error('DropMail returned no addresses');
      }
      const [login, domain] = fullEmail.split('@');

      const now = Date.now();
      const expiresAt = new Date(session.expiresAt).getTime();

      return {
        login,
        domain,
        fullEmail,
        createdAt: now,
        expiresAt,
        service: 'dropmail',
        token: this.sessionToken,
      };
    } catch (error) {
      log.error('Failed to create DropMail account', error);
      throw error;
    }
  }

  /**
   * Set session ID from stored account
   */
  setSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.sessionToken = sessionId;
  }

  /**
   * Get messages (inbox)
   */
  async getMessages(sessionId?: string, signal?: AbortSignal): Promise<Email[]> {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('No session ID available');
    }

    try {
      const query = `
                query($id: ID!) {
                    session(id: $id) {
                        mails {
                            id
                            headerFrom
                            headerTo
                            headerSubject
                            text
                            html
                            introduced
                        }
                    }
                }
            `;

      const data = await this.executeGraphQL<{ session: { mails: DropMailMessage[] } }>(query, {
        id: sid,
      }, signal);
      const messages: DropMailMessage[] = data.session?.mails || [];

      return messages.map((msg) => this.convertMessage(msg));
    } catch (error) {
      log.error('Failed to get DropMail messages', error);
      throw error;
    }
  }

  /**
   * Get a specific message
   */
  async getMessage(id: string, sessionId?: string, signal?: AbortSignal): Promise<Email> {
    const messages = await this.getMessages(sessionId, signal);
    const message = messages.find((m) => m.id === id);

    if (!message) {
      throw new Error(`Message ${id} not found`);
    }

    return message;
  }

  /**
   * Delete a message (DropMail doesn't support deletion, return success)
   */
  async deleteMessage(id: string): Promise<void> {
    log.debug('DropMail does not support message deletion', { id });
    // DropMail sessions expire automatically, no deletion needed
  }

  /**
   * Convert DropMail message to our Email type
   */
  private convertMessage(msg: DropMailMessage): Email {
    return {
      id: msg.id,
      from: msg.headerFrom,
      to: msg.headerTo,
      subject: msg.headerSubject,
      date: new Date(msg.introduced).getTime(),
      body: msg.text || '',
      htmlBody: msg.html?.join(''),
      textBody: msg.text,
      attachments: [],
      read: false, // DropMail doesn't track read status
    };
  }
}

// Export singleton instance
export const dropMailService = new DropMailService();
