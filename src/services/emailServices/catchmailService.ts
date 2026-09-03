// CatchMail Service - catchmail.io API integration
// API: https://api.catchmail.io/api/v1
// Free REST API for temporary disposable email

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
import { isRetryableError, throttledWarn } from './isRetryableError';

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
            const htmlStr = extractHtmlFromBody(fullMsg.html_body || fullMsg.html || fullMsg.body);
            const textStr = extractTextFromBody(fullMsg.text_body || fullMsg.text || fullMsg.body);
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
          id: String(msg.id),
          from: contentToString(msg.from, 'Unknown Sender'),
          to: contentToString(msg.mailbox || fullEmail),
          subject: contentToString(msg.subject, '(No Subject)'),
          date: safeParseDate(msg.date),
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
      if (isRetryableError(error)) {
        throttledWarn(log, 'catchmail-getMessages', 'Failed to fetch Catchmail messages', error);
        throw error;
      }
      // Non-retryable (e.g. malformed response) — degrade gracefully
      log.debug('Catchmail getMessages non-retryable error, returning []', error);
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
      const htmlStr = extractHtmlFromBody(msg.html_body || msg.html || msg.body);
      const textStr = extractTextFromBody(msg.text_body || msg.text || msg.body);
      const bodyStr = textStr || htmlStr;

      return {
        id: String(msg.id || emailId),
        from: contentToString(msg.from, 'Unknown Sender'),
        to: contentToString(msg.mailbox || fullEmail),
        subject: contentToString(msg.subject, '(No Subject)'),
        date: safeParseDate(msg.date),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
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
