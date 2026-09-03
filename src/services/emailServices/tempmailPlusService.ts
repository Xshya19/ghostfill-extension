// Tempmail.plus / Mailto.plus Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn, throwIfRetryableStatus } from './isRetryableError';

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

      if (response.status === 404) {
        return [];
      }
      throwIfRetryableStatus(response, 'Tempmail.plus getMessages');

      const data = await response.json();
      const mailList: any[] = data.mail_list || data.mails || data.result || [];

      // Fetch detail bodies for up to 5 most recent messages in parallel
      const recentMails = mailList.slice(0, 5);
      const detailedMails = await Promise.all(
        recentMails.map(async (msg: any) => {
          const mailId = msg.mail_id || msg.id;
          if (!mailId) {
            return msg;
          }
          try {
            const detailRes = await fetchWithTimeout(
              `${BASE_URL}/${encodeURIComponent(mailId)}?email=${encodeURIComponent(login)}`,
              { signal: signal ?? null }
            );
            if (detailRes.ok) {
              const detailData = await detailRes.json();
              return { ...msg, ...detailData };
            }
          } catch {
            // Ignore failure to fetch single detail, use summary
          }
          return msg;
        })
      );

      return recentMails.map((rawMsg: any, idx: number) => {
        const msg = detailedMails[idx] || rawMsg;
        const htmlStr = contentToString(msg.html || msg.body || msg.text);
        const textStr = contentToString(msg.text || msg.body);
        const bodyStr = textStr || htmlStr;

        return {
          id: String(msg.mail_id || msg.id),
          from: contentToString(msg.from_mail || msg.from, 'Unknown Sender'),
          to: fullEmail,
          subject: contentToString(msg.subject, '(No Subject)'),
          date: safeParseDate(msg.date),
          body: bodyStr,
          htmlBody: htmlStr,
          textBody: textStr,
          read: Boolean(msg.is_read),
          attachments: [],
        };
      });
    } catch (error) {
      if (isRetryableError(error)) {
        throttledWarn(log, 'tempmailplus-getMessages', 'Failed to fetch Tempmail.plus messages', error);
        throw error;
      }
      log.debug('Tempmail.plus getMessages non-retryable error, returning []', error);
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
        date: safeParseDate(msg.date),
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
