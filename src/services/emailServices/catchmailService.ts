// CatchMail Service - catchmail.io API integration
// API: https://api.catchmail.io/api/v1
// Free REST API for temporary disposable email

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('CatchmailService');
const BASE_URL = 'https://api.catchmail.io';

export class CatchmailService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['catchmail.io'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername();
    const domain = 'catchmail.io';
    const fullEmail = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: `catchmail_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days retention
      service: 'catchmail',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/api/v1/mailbox?address=${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      const messages = data.messages || [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = messages.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgResponse = await fetchWithTimeout(
              `${BASE_URL}/api/v1/message/${encodeURIComponent(msg.id)}?mailbox=${encodeURIComponent(fullEmail)}`,
              { signal: signal ?? null }
            );
            if (!msgResponse.ok) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const fullMsg = await msgResponse.json();
            return {
              body: fullMsg.body || fullMsg.text_body || fullMsg.html_body || '',
              htmlBody: fullMsg.html_body || fullMsg.body || '',
              textBody: fullMsg.text_body || fullMsg.body || '',
            };
          } catch {
            return { body: '', htmlBody: '', textBody: '' };
          }
        })
      );

      return messages.map((msg: any, idx: number) => {
        const email: Email = {
          id: String(msg.id),
          from: msg.from || 'Unknown Sender',
          to: msg.mailbox || fullEmail,
          subject: msg.subject || '(No Subject)',
          date: msg.date ? new Date(msg.date).getTime() : Date.now(),
          body: '',
          read: false,
          attachments: [],
        };
        if (idx < 5 && fullBodyResults[idx]) {
          const body = fullBodyResults[idx]!;
          email.body = body.body;
          email.htmlBody = body.htmlBody;
          email.textBody = body.textBody;
        }
        return email;
      });
    } catch (error) {
      log.warn('Failed to fetch Catchmail messages', error);
      return [];
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/api/v1/message/${encodeURIComponent(emailId)}?mailbox=${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const msg = await response.json();
      return {
        id: String(msg.id || emailId),
        from: msg.from || 'Unknown Sender',
        to: msg.mailbox || fullEmail,
        subject: msg.subject || '(No Subject)',
        date: msg.date ? new Date(msg.date).getTime() : Date.now(),
        body: msg.body || msg.text_body || msg.html_body || '',
        htmlBody: msg.html_body || msg.body || '',
        textBody: msg.text_body || msg.body || '',
        read: true,
        attachments: [],
      };
    } catch (error) {
      log.error('Failed to fetch Catchmail message details', error);
      throw error;
    }
  }
}

export const catchmailService = new CatchmailService();
