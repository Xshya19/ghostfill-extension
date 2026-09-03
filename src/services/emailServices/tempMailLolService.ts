// TempMail.lol Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn, throwIfRetryableStatus } from './isRetryableError';

const log = createLogger('TempMailLolService');
const BASE_URL = 'https://api.tempmail.lol/v2';

export class TempMailLolService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['tempmail.lol', 'disposable.com'];
  }

  async createAccount(_prefix?: string, signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/inbox/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        throw new Error(`TempMail.lol error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.address || !data.token) {
        throw new Error('Invalid TempMail.lol response');
      }

      const fullEmail = data.address;
      const parts = fullEmail.split('@');
      const login = parts[0] || generateHumanLikeUsername();
      const domain = parts[1] || 'tempmail.lol';
      const now = Date.now();

      return {
        id: `tempmaillol_${now}_${login}`,
        username: login,
        login,
        domain,
        fullEmail,
        token: data.token,
        createdAt: now,
        expiresAt: now + 60 * 60 * 1000,
        service: 'tempmaillol',
      };
    } catch (error) {
      // No local fallback: a username is not a server token, so a fabricated
      // account would 401/empty-poll forever. Re-throw so the aggregator's
      // generateEmailWithFallback picks a working provider instead.
      log.warn('TempMail.lol create failed, falling back to another provider', error);
      throw error;
    }
  }

  async getMessages(token: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inbox?token=${encodeURIComponent(token)}`,
        { signal: signal ?? null }
      );

      if (response.status === 404) {
        return [];
      }
      throwIfRetryableStatus(response, 'TempMail.lol getMessages');

      const data = await response.json();
      const emails = data.emails || [];

      return emails.map((msg: any, idx: number) => {
        const bodyStr = contentToString(msg.body || msg.html);
        const htmlStr = contentToString(msg.html || msg.body);
        return {
          id: String(msg.id || idx),
          from: contentToString(msg.from, 'Unknown Sender'),
          to: contentToString(msg.to),
          subject: contentToString(msg.subject, '(No Subject)'),
          date: safeParseDate(msg.date),
          body: bodyStr,
          htmlBody: htmlStr,
          textBody: bodyStr,
          read: false,
          attachments: [],
        };
      });
    } catch (error) {
      if (isRetryableError(error)) {
        throttledWarn(log, 'tempmaillol-getMessages', 'Failed to fetch TempMail.lol messages', error);
        throw error;
      }
      log.debug('TempMail.lol fetch failed (non-retryable)', error);
      return [];
    }
  }

  async getMessage(token: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    const messages = await this.getMessages(token, signal);
    const found = messages.find((m) => String(m.id) === String(emailId));
    if (!found) {
      throw new Error('Message not found');
    }
    return { ...found, read: true };
  }
}

export const tempMailLolService = new TempMailLolService();
