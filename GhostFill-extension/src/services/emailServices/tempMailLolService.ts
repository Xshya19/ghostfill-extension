// TempMailLol Service - Alternative free temp email with less-known domains

import { EmailAccount, Email } from '../../types';
import { createLogger } from '../../utils/logger';

const log = createLogger('TempMailLolService');

interface TempMailLolDomain {
    name: string;
    forward_available: boolean;
    web_available: boolean;
}

interface TempMailLolEmail {
    email: string;
    token: string;
}

interface TempMailLolMessage {
    id: number;
    from: string;
    subject: string;
    body: string;
    html: string;
    date: string;
}

class TempMailLolService {
    private baseUrl = 'https://api.tempmail.lol';
    private token: string | null = null;

    /**
     * Get available domains
     */
    async getDomains(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/domains`);

            if (!response.ok) {
                log.warn('Failed to get domains');
                return ['tempmail.lol'];
            }

            const domains: TempMailLolDomain[] = await response.json();
            return domains.map(d => d.name);
        } catch (error) {
            log.error('Failed to get domains', error);
            return ['tempmail.lol'];
        }
    }

    /**
     * Create a new email account
     */
    async createAccount(): Promise<EmailAccount> {
        try {
            const response = await fetch(`${this.baseUrl}/generate`, {
                headers: {
                    'User-Agent': 'GhostFill-Extension/1.0',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data: TempMailLolEmail = await response.json();
            this.token = data.token;

            const [login, domain] = data.email.split('@');
            const now = Date.now();

            return {
                login,
                domain,
                fullEmail: data.email,
                createdAt: now,
                expiresAt: now + 60 * 60 * 1000, // 1 hour
                service: 'templol',
                token: data.token,
            };
        } catch (error) {
            log.error('Failed to create TempMailLol account', error);
            throw error;
        }
    }

    /**
     * Set token from stored account
     */
    setToken(token: string): void {
        this.token = token;
    }

    /**
     * Get messages (inbox)
     */
    async getMessages(token?: string): Promise<Email[]> {
        const authToken = token || this.token;
        if (!authToken) {
            throw new Error('No token available');
        }

        try {
            const response = await fetch(`${this.baseUrl}/auth/${authToken}`, {
                headers: {
                    'User-Agent': 'GhostFill-Extension/1.0',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            if (!data.email) {
                return [];
            }

            const messages: TempMailLolMessage[] = data.emails || [];
            return messages.map((msg) => this.convertMessage(msg));
        } catch (error) {
            log.error('Failed to get TempMailLol messages', error);
            throw error;
        }
    }

    /**
     * Get a specific message
     */
    async getMessage(id: string, token?: string): Promise<Email> {
        const messages = await this.getMessages(token);
        const message = messages.find((m) => m.id === id);

        if (!message) {
            throw new Error(`Message ${id} not found`);
        }

        return message;
    }

    /**
     * Delete a message (not supported by TempMailLol)
     */
    async deleteMessage(id: string): Promise<void> {
        log.debug('TempMailLol does not support message deletion', { id });
    }

    /**
     * Convert TempMailLol message to our Email type
     */
    private convertMessage(msg: TempMailLolMessage): Email {
        return {
            id: msg.id.toString(),
            from: msg.from,
            subject: msg.subject,
            date: new Date(msg.date).getTime(),
            body: msg.body || '',
            htmlBody: msg.html,
            textBody: msg.body,
            attachments: [],
            read: false,
        };
    }
}

// Export singleton instance
export const tempMailLolService = new TempMailLolService();
