import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString } from '../../utils/core';
import { getRandomInt } from '../../utils/encryption';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn, throwIfRetryableStatus } from './isRetryableError';

const log = createLogger('MailinatorService');
const BASE_URL = 'https://www.mailinator.com/v2/domains/public/inboxes';

/** FNV-1a 32-bit hash → stable hex id from message-stable fields. */
function stableMailId(...parts: Array<string | number | undefined>): string {
  const direct = parts.find((p) => p !== undefined && p !== null && String(p).length > 0);
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct);
  }
  const s = parts.map((p) => String(p ?? '')).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `mi_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export class MailinatorService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['mailinator.com'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername() + getRandomInt(100, 9999);
    const domain = 'mailinator.com';
    const now = Date.now();
    const fullEmail = `${login}@${domain}`;

    log.info('mailinator: generated new public inbox', { email: fullEmail });

    return {
      id: `mailinator_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'mailinator',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const [login] = fullEmail.split('@');
      const response = await fetchWithTimeout(
        `${BASE_URL}/${encodeURIComponent(login || '')}`,
        { signal: signal ?? null }
      );

      if (response.status === 404) {
        return [];
      }
      throwIfRetryableStatus(response, 'Mailinator getMessages');

      const data = await response.json();
      const messages = data?.msgs || data?.messages || data || [];
      const msgList = Array.isArray(messages) ? messages : [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = msgList.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgId = msg.id || msg.messageId;
            return await this.fetchMessageDetail(login || '', msgId, signal);
          } catch {
            return { body: '', htmlBody: '', textBody: '' };
          }
        })
      );

      return msgList.map((msg: any, idx: number) => {
        const fullMsg = idx < 5 ? fullBodyResults[idx] : { body: '', htmlBody: '', textBody: '' };
        // Deterministic ID: Math.random() breaks dedup (new identity every
        // poll → duplicate notifications + unbounded cache growth).
        const stableId = stableMailId(
          msg.id,
          msg.messageId,
          msg.subject,
          msg.fromfull ?? msg.from ?? msg.sender,
          msg.time
        );
        return {
          id: stableId,
          from: contentToString(msg.fromfull || msg.from || msg.sender, 'Unknown Sender'),
          to: fullEmail,
          subject: contentToString(msg.subject, '(No Subject)'),
          date: msg.time ? Number(msg.time) : Date.now(),
          body: contentToString(fullMsg?.body),
          htmlBody: contentToString(fullMsg?.htmlBody),
          textBody: contentToString(fullMsg?.textBody),
          read: true,
          attachments: [],
        };
      });
    } catch (error) {
      if (isRetryableError(error)) {
        throttledWarn(log, 'mailinator-getMessages', 'Failed to fetch Mailinator messages', error);
        throw error;
      }
      log.debug('Mailinator getMessages non-retryable error, returning []', error);
      return [];
    }
  }

  private async fetchMessageDetail(
    login: string,
    msgId: string,
    signal?: AbortSignal
  ): Promise<{ body: string; htmlBody: string; textBody: string }> {
    const msgResponse = await fetchWithTimeout(
      `${BASE_URL}/${encodeURIComponent(login)}/messages/${encodeURIComponent(msgId)}`,
      { signal: signal ?? null }
    );
    if (!msgResponse.ok) {
      return { body: '', htmlBody: '', textBody: '' };
    }
    const fullMsg = await msgResponse.json();

    const parts = fullMsg?.parts || [];
    let htmlBody = '';
    let textBody = '';

    for (const part of parts) {
      // Header names vary in case across responses — compare lowercased.
      const headers = part.headers ?? {};
      const contentType = Object.entries(headers).find(([k]) =>
        String(k).toLowerCase() === 'content-type'
      )?.[1];
      const contentTypeStr = Array.isArray(contentType)
        ? String(contentType[0] ?? '')
        : String(contentType ?? '');
      if (contentTypeStr) {
        if (contentTypeStr.includes('text/html')) {
          htmlBody = contentToString(part.body);
        } else if (contentTypeStr.includes('text/plain')) {
          textBody = contentToString(part.body);
        }
      } else if (part.body) {
        htmlBody = contentToString(part.body);
      }
    }

    const finalHtml = htmlBody || textBody || contentToString(fullMsg?.body) || '';
    const finalText = textBody || htmlBody || contentToString(fullMsg?.body) || '';

    return {
      body: finalHtml,
      htmlBody: finalHtml,
      textBody: finalText,
    };
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const [login] = fullEmail.split('@');
      const detail = await this.fetchMessageDetail(login || '', emailId, signal);
      if (detail.body || detail.htmlBody) {
        return {
          id: String(emailId),
          from: 'Unknown Sender',
          to: fullEmail,
          subject: '(No Subject)',
          date: Date.now(),
          body: detail.body,
          htmlBody: detail.htmlBody,
          textBody: detail.textBody,
          read: true,
          attachments: [],
        };
      }
    } catch (e) {
      log.debug('Mailinator direct message fetch failed, falling back to message list', e);
    }

    const messages = await this.getMessages(fullEmail, signal);
    const found = messages.find((m) => String(m.id) === String(emailId));
    if (!found) {
      throw new Error(`Message ${emailId} not found in Mailinator inbox`);
    }
    return { ...found, read: true };
  }
}

export const mailinatorService = new MailinatorService();
