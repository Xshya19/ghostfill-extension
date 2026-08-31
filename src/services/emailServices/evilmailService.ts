// Evilmail Service - evilmail.dev / evilmail.pro REST API integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('EvilmailService');
const BASE_URL = 'https://evilmail.pro/api';

export class EvilmailService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['evilmail.dev', 'evilmail.pro'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername();
    const domain = 'evilmail.dev';
    const fullEmail = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: `evilmail_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'evilmail',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inbox?email=${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      const messages = Array.isArray(data) ? data : data.messages || data.data || [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = messages.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgId = msg.id || msg.messageId;
            const msgResponse = await fetchWithTimeout(
              `${BASE_URL}/message/${encodeURIComponent(msgId)}?email=${encodeURIComponent(fullEmail)}`,
              { signal: signal ?? null }
            );
            if (!msgResponse.ok) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const fullMsg = await msgResponse.json();
            const item = fullMsg.data || fullMsg;
            const bodyStr = contentToString(item.body || item.text || item.html);
            const htmlStr = contentToString(item.html || item.body);
            const textStr = contentToString(item.text || item.body);
            return {
              body: bodyStr,
              htmlBody: htmlStr,
              textBody: textStr,
            };
          } catch {
            return { body: '', htmlBody: '', textBody: '' };
          }
        })
      );

      return messages.map((msg: any, idx: number) => {
        const email: Email = {
          id: String(msg.id || msg.messageId),
          from: contentToString(msg.from || msg.sender, 'Unknown Sender'),
          to: contentToString(msg.to || fullEmail),
          subject: contentToString(msg.subject, '(No Subject)'),
          date: safeParseDate(msg.timestamp || msg.date),
          body: contentToString(msg.body || msg.text || msg.html),
          htmlBody: contentToString(msg.html || msg.body),
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
      log.warn('Failed to fetch Evilmail messages', error);
      return [];
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/message/${encodeURIComponent(emailId)}?email=${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const msg = await response.json();
      const item = msg.data || msg;
      const bodyStr = contentToString(item.body || item.text || item.html);
      const htmlStr = contentToString(item.html || item.body);
      const textStr = contentToString(item.text || item.body);

      return {
        id: String(item.id || emailId),
        from: contentToString(item.from || item.sender, 'Unknown Sender'),
        to: contentToString(item.to || fullEmail),
        subject: contentToString(item.subject, '(No Subject)'),
        date: safeParseDate(item.timestamp || item.date),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
        read: true,
        attachments: [],
      };
    } catch (error) {
      log.error('Failed to fetch Evilmail message details', error);
      throw error;
    }
  }
}

export const evilmailService = new EvilmailService();
