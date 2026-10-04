// Tempmail.plus / Mailto.plus Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { getSenderSource } from '../../utils/emailIdentity';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { throttledWarn, throwIfRetryableStatus } from './isRetryableError';
import { runBoundedProviderOperation } from './providerOperations';

const log = createLogger('TempmailPlusService');
const BASE_URL = 'https://tempmail.plus/api/mails';
// Published mailbox selector: https://tempmail.plus/. The website hostname
// tempmail.plus has a different MX and is not a supported receiving domain.
const MAILBOX_DOMAINS = [
  'mailto.plus',
  'fexpost.com',
  'fexbox.org',
  'mailbox.in.ua',
  'rover.info',
  'chitthi.in',
  'fextemp.com',
  'any.pink',
  'merepost.com',
];

class TempmailResponseError extends Error {}

async function readPayload(url: string, signal?: AbortSignal) {
  return runBoundedProviderOperation(
    async (boundedSignal) => {
      const response = await fetchWithTimeout(url, { signal: boundedSignal });
      throwIfRetryableStatus(response, 'Tempmail.plus');
      if (response.status === 404) {
        return null;
      }
      const payload = await response.json();
      if (!payload || typeof payload !== 'object' || payload.result === false || payload.err) {
        throw new TempmailResponseError(
          'Tempmail.plus returned an unavailable or protected inbox response'
        );
      }
      return payload;
    },
    signal,
    15_000
  );
}

export class TempmailPlusService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return [...MAILBOX_DOMAINS];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername();
    const domain = MAILBOX_DOMAINS[0]!;
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
    try {
      const data = await readPayload(
        `${BASE_URL}?email=${encodeURIComponent(fullEmail)}&limit=50`,
        signal
      );
      if (!data) {
        return [];
      }
      const mailList = data.mail_list ?? data.mails ?? data.result;
      if (!Array.isArray(mailList)) {
        throw new TempmailResponseError('Tempmail.plus returned an invalid inbox list');
      }

      // Fetch detail bodies for up to 5 most recent messages in parallel
      const recentMails = mailList.slice(0, 5);
      const detailedMails = await Promise.all(
        recentMails.map(async (msg: any) => {
          const mailId = msg.mail_id || msg.id;
          if (!mailId) {
            return msg;
          }
          try {
            const detailData = await readPayload(
              `${BASE_URL}/${encodeURIComponent(mailId)}?email=${encodeURIComponent(fullEmail)}`,
              signal
            );
            if (detailData) {
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
          from: getSenderSource(msg.from_name, msg.from_mail || msg.from),
          to: fullEmail,
          subject: contentToString(msg.subject, '(No Subject)'),
          date: safeParseDate(msg.date || msg.time, 0),
          body: bodyStr,
          htmlBody: htmlStr,
          textBody: textStr,
          read: msg.is_read !== undefined ? Boolean(msg.is_read) : msg.is_new === false,
          attachments: [],
        };
      });
    } catch (error) {
      throttledWarn(
        log,
        'tempmailplus-getMessages',
        'Failed to fetch Tempmail.plus messages',
        error
      );
      throw error;
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const msg = await readPayload(
        `${BASE_URL}/${encodeURIComponent(emailId)}?email=${encodeURIComponent(fullEmail)}`,
        signal
      );
      if (!msg) {
        throw new TempmailResponseError('Tempmail.plus message not found');
      }
      const bodyStr = contentToString(msg.text || msg.body || msg.html);
      const htmlStr = contentToString(msg.html || msg.body);
      const textStr = contentToString(msg.text || msg.body);

      return {
        id: String(msg.mail_id || msg.id || emailId),
        from: getSenderSource(msg.from_name, msg.from_mail || msg.from),
        to: fullEmail,
        subject: contentToString(msg.subject, '(No Subject)'),
        date: safeParseDate(msg.date || msg.time, 0),
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
