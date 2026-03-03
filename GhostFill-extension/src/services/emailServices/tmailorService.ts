// TMailor Service - Premium Rotating Domain Provider
// 500+ rotating domains hosted on Google servers to avoid blocklisting

import { EmailAccount, Email } from '../../types';
import { createLogger } from '../../utils/logger';

const log = createLogger('TMailorService');

const TMAILOR_API = 'https://api.tmailor.com/api/v1';

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
     * Generate a new email with rotating domain
     */
    async createAccount(prefix?: string): Promise<EmailAccount> {
        try {
            // Generate random prefix if not provided
            const emailPrefix = prefix || this.generatePrefix();

            // First, get available domains
            const domainsRes = await fetch(`${TMAILOR_API}/domains`, {
                headers: { 'Accept': 'application/json' }
            });

            let domain = 'tmailor.com'; // Default fallback

            if (domainsRes.ok) {
                const domains = await domainsRes.json();
                if (Array.isArray(domains) && domains.length > 0) {
                    // Pick a random domain from the pool
                    domain = domains[Math.floor(Math.random() * domains.length)];
                }
            }

            // Create the email account
            const createRes = await fetch(`${TMAILOR_API}/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    email: `${emailPrefix}@${domain}`
                })
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
            log.error('TMailor create failed', error);
            throw error;
        }
    }

    /**
     * Fetch emails from inbox
     */
    async getEmails(account: EmailAccount): Promise<Email[]> {
        try {

            const response = await fetch(
                `${TMAILOR_API}/inbox?email=${encodeURIComponent(account.fullEmail)}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        ...(account.token ? { 'Authorization': `Bearer ${account.token}` } : {})
                    }
                }
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
    async readEmail(emailId: string, account: EmailAccount): Promise<Email> {
        try {
            const response = await fetch(
                `${TMAILOR_API}/message/${emailId}?email=${encodeURIComponent(account.fullEmail)}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        ...(account.token ? { 'Authorization': `Bearer ${account.token}` } : {})
                    }
                }
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
            log.error('TMailor readEmail failed', error);
            throw error;
        }
    }

    /**
     * Generate random prefix
     */
    private generatePrefix(): string {
        const adjectives = ['swift', 'bright', 'calm', 'deep', 'eager', 'fair', 'glad', 'keen'];
        const nouns = ['fox', 'owl', 'wave', 'star', 'cloud', 'river', 'swift', 'peak'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(Math.random() * 9999);
        return `${adj}${noun}${num}`;
    }

    /**
     * Generate unique ID
     */
    private generateId(): string {
        return `tmailor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
}

export const tmailorService = new TMailorService();
