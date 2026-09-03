// OpenInbox Service - openinbox.io API integration
// Disposable email service for automated inbox and OTP extraction

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

const log = createLogger('OpeninboxService');
const BASE_URL = 'https://openinbox.io/api/v1';

export class OpeninboxService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['openinbox.io'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername();
    const domain = 'openinbox.io';
    const fullEmail = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: `openinbox_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'openinbox',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inboxes/${encodeURIComponent(fullEmail)}/messages`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      const messages = Array.isArray(data) ? data : data.messages || [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = messages.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgId = msg.id || msg.messageId;
            const msgResponse = await fetchWithTimeout(
              `${BASE_URL}/inboxes/${encodeURIComponent(fullEmail)}/messages/${encodeURIComponent(msgId)}`,
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
          date: safeParseDate(msg.createdAt || msg.date),
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
        throttledWarn(log, 'openinbox-getMessages', 'Failed to fetch OpenInbox messages', error);
        throw error;
      }
      log.debug('OpenInbox getMessages non-retryable error, returning []', error);
      return [];
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inboxes/${encodeURIComponent(fullEmail)}/messages/${encodeURIComponent(emailId)}`,
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
        date: safeParseDate(msg.createdAt || msg.date),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
        read: true,
        attachments: [],
      };
    } catch (error) {
      log.error('Failed to fetch OpenInbox message details', error);
      throw error;
    }
  }
}

export const openinboxService = new OpeninboxService();
