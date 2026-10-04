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
import { getSenderSource } from '../../utils/emailIdentity';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn } from './isRetryableError';
import { MessageHydrationCache } from './messageHydrationCache';

const log = createLogger('CatchmailService');
const BASE_URL = 'https://api.catchmail.io';

export class CatchmailService {
  private readonly messageCache = new MessageHydrationCache();

  clearMessageCache(): void {
    this.messageCache.clear();
  }

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

      // Refresh the list on every poll, reusing already hydrated bodies.
      const recentMessages = messages.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            return await this.getMessage(fullEmail, String(msg.id), signal);
          } catch (error) {
            if (signal?.aborted || (error as Error)?.name === 'AbortError') {
              throw error;
            }
            return undefined;
          }
        })
      );

      return messages.map((msg: any, idx: number) => {
        const email: Email = {
          id: String(msg.id),
          from: getSenderSource(undefined, msg.from),
          to: contentToString(msg.mailbox || fullEmail),
          subject: contentToString(msg.subject, '(No Subject)'),
          date: safeParseDate(msg.date, 0),
          body: '',
          read: false,
          attachments: [],
        };
        if (idx < 5 && fullBodyResults[idx]) {
          const body = fullBodyResults[idx]!;
          if (email.date === 0 && body.date > 0) {
            email.date = body.date;
          }
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
    return this.messageCache.get(
      fullEmail,
      emailId,
      () => this.fetchMessage(fullEmail, emailId, signal),
      signal
    );
  }

  private async fetchMessage(
    fullEmail: string,
    emailId: string,
    signal?: AbortSignal
  ): Promise<Email> {
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
        from: getSenderSource(undefined, msg.from),
        to: contentToString(msg.mailbox || fullEmail),
        subject: contentToString(msg.subject, '(No Subject)'),
        date: safeParseDate(msg.date, 0),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
        read: true,
        attachments: [],
      };
    } catch (error) {
      if (!signal?.aborted && (error as Error)?.name !== 'AbortError') {
        log.debug('Failed to fetch Catchmail message details', error);
      }
      throw error;
    }
  }
}

export const catchmailService = new CatchmailService();
