// Tempmail.plus / Mailto.plus Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('TempmailPlusService');
const BASE_URL = 'https://tempmail.plus/api/mails';

export class TempmailPlusService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['tempmail.plus', 'mailto.plus', 'frapmail.com'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername();
    const domain = 'tempmail.plus';
    const fullEmail = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: `tempmailplus_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'tempmailplus',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    const login = fullEmail.split('@')[0] || fullEmail;
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}?email=${encodeURIComponent(login)}&limit=50`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const mailList = data.mail_list || data.mails || data.result || [];

      return mailList.map((msg: any) => ({
        id: String(msg.mail_id || msg.id),
        from: contentToString(msg.from_mail || msg.from, 'Unknown Sender'),
        to: fullEmail,
        subject: contentToString(msg.subject, '(No Subject)'),
        date: msg.date ? new Date(msg.date).getTime() : Date.now(),
        body: contentToString(msg.text || msg.body),
        htmlBody: contentToString(msg.html || msg.body),
        textBody: contentToString(msg.text || msg.body),
        read: Boolean(msg.is_read),
        attachments: [],
      }));
    } catch (error) {
      log.warn('Failed to fetch Tempmail.plus messages', error);
      return [];
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    const login = fullEmail.split('@')[0] || fullEmail;
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/${encodeURIComponent(emailId)}?email=${encodeURIComponent(login)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const msg = await response.json();
      const bodyStr = contentToString(msg.text || msg.body || msg.html);
      const htmlStr = contentToString(msg.html || msg.body);
      const textStr = contentToString(msg.text || msg.body);

      return {
        id: String(msg.mail_id || msg.id || emailId),
        from: contentToString(msg.from_mail || msg.from, 'Unknown Sender'),
        to: fullEmail,
        subject: contentToString(msg.subject, '(No Subject)'),
        date: msg.date ? new Date(msg.date).getTime() : Date.now(),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
        read: true,
        attachments: [],
      };
    } catch (error) {
      log.error('Failed to fetch Tempmail.plus message details', error);
      throw error;
    }
  }
}

export const tempmailPlusService = new TempmailPlusService();
