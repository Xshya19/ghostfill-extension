// Mail.cx Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('MailCxService');
const BASE_URL = 'https://api.mail.cx/v1';

export class MailCxService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['mail.cx'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername();
    const domain = 'mail.cx';
    const fullEmail = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: `mailcx_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'mailcx',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inbox/${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const messages = Array.isArray(data) ? data : data.messages || data.result || [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = messages.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgId = msg.id || msg.messageId;
            const msgResponse = await fetchWithTimeout(
              `${BASE_URL}/email/${encodeURIComponent(msgId)}`,
              { signal: signal ?? null }
            );
            if (!msgResponse.ok) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const fullMsg = await msgResponse.json();
            return {
              body: fullMsg.body || fullMsg.text || fullMsg.html || '',
              htmlBody: fullMsg.html || fullMsg.body || '',
              textBody: fullMsg.text || fullMsg.body || '',
            };
          } catch {
            return { body: '', htmlBody: '', textBody: '' };
          }
        })
      );

      return messages.map((msg: any, idx: number) => {
        const email: Email = {
          id: String(msg.id || msg.messageId),
          from: msg.from || msg.sender || 'Unknown Sender',
          to: msg.to || fullEmail,
          subject: msg.subject || '(No Subject)',
          date: msg.date || msg.createdAt ? new Date(msg.date || msg.createdAt).getTime() : Date.now(),
          body: msg.body || msg.text || msg.html || '',
          htmlBody: msg.html || msg.body || '',
          read: Boolean(msg.read),
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
      log.warn('Failed to fetch Mail.cx messages', error);
      return [];
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/email/${encodeURIComponent(emailId)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const msg = await response.json();
      return {
        id: String(msg.id || emailId),
        from: msg.from || msg.sender || 'Unknown Sender',
        to: msg.to || fullEmail,
        subject: msg.subject || '(No Subject)',
        date: msg.date || msg.createdAt ? new Date(msg.date || msg.createdAt).getTime() : Date.now(),
        body: msg.body || msg.text || msg.html || '',
        htmlBody: msg.html || msg.body || '',
        textBody: msg.text || msg.body || '',
        read: true,
        attachments: [],
      };
    } catch (error) {
      log.error('Failed to fetch Mail.cx message details', error);
      throw error;
    }
  }
}

export const mailCxService = new MailCxService();
