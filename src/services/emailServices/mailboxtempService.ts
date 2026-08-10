// MailboxTemp Service - mailboxtemp.com API integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('MailboxtempService');
const BASE_URL = 'https://mailboxtemp.com/api';

export class MailboxtempService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['mailboxtemp.com'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername();
    const domain = 'mailboxtemp.com';
    const fullEmail = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: `mailboxtemp_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'mailboxtemp',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/messages?email=${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error: ${response.status}`);
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
              `${BASE_URL}/messages/${encodeURIComponent(msgId)}?email=${encodeURIComponent(fullEmail)}`,
              { signal: signal ?? null }
            );
            if (!msgResponse.ok) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const fullMsg = await msgResponse.json();
            const item = fullMsg.result || fullMsg;
            return {
              body: item.body || item.text || item.html || '',
              htmlBody: item.html || item.body || '',
              textBody: item.text || item.body || '',
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
      log.warn('Failed to fetch MailboxTemp messages', error);
      return [];
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/messages/${encodeURIComponent(emailId)}?email=${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const msg = await response.json();
      const item = msg.result || msg;
      return {
        id: String(item.id || emailId),
        from: item.from || item.sender || 'Unknown Sender',
        to: item.to || fullEmail,
        subject: item.subject || '(No Subject)',
        date: item.date || item.createdAt ? new Date(item.date || item.createdAt).getTime() : Date.now(),
        body: item.body || item.text || item.html || '',
        htmlBody: item.html || item.body || '',
        textBody: item.text || item.body || '',
        read: true,
        attachments: [],
      };
    } catch (error) {
      log.error('Failed to fetch MailboxTemp message details', error);
      throw error;
    }
  }
}

export const mailboxtempService = new MailboxtempService();
