// TempMail.lol Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

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
      log.warn('Failed to create TempMail.lol account from API, using fallback', error);
      const login = generateHumanLikeUsername();
      const domain = 'tempmail.lol';
      const now = Date.now();
      return {
        id: `tempmaillol_${now}_${login}`,
        username: login,
        login,
        domain,
        fullEmail: `${login}@${domain}`,
        token: login,
        createdAt: now,
        expiresAt: now + 60 * 60 * 1000,
        service: 'tempmaillol',
      };
    }
  }

  async getMessages(token: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inbox?token=${encodeURIComponent(token)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        return [];
      }

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
      log.warn('Failed to fetch TempMail.lol messages', error);
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
