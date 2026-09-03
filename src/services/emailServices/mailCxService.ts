// Mail.cx Service Integration

import { EmailAccount, Email } from '../../types';
import {
  fetchWithTimeout,
  contentToString,
  safeParseDate,
  extractHtmlFromBody,
  extractTextFromBody,
} from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn, throwIfRetryableStatus } from './isRetryableError';

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

      if (response.status === 404) {
        return [];
      }
      throwIfRetryableStatus(response, 'Mail.cx getMessages');

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
            const htmlStr = extractHtmlFromBody(fullMsg.html || fullMsg.body);
            const textStr = extractTextFromBody(fullMsg.text || fullMsg.body);
            const bodyStr = textStr || htmlStr;
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
          date: safeParseDate(msg.date || msg.createdAt),
          body: '',
          htmlBody: '',
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
      if (isRetryableError(error)) {
        throttledWarn(log, 'mailcx-getMessages', 'Failed to fetch Mail.cx messages', error);
        throw error;
      }
      log.debug('Mail.cx getMessages non-retryable error, returning []', error);
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
      const htmlStr = extractHtmlFromBody(msg.html || msg.body);
      const textStr = extractTextFromBody(msg.text || msg.body);
      const bodyStr = textStr || htmlStr;

      return {
        id: String(msg.id || emailId),
        from: contentToString(msg.from || msg.sender, 'Unknown Sender'),
        to: contentToString(msg.to || fullEmail),
        subject: contentToString(msg.subject, '(No Subject)'),
        date: safeParseDate(msg.date || msg.createdAt),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
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
