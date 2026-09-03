// GetNada / Nada.ltd / Inboxes.com Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn, throwIfRetryableStatus } from './isRetryableError';

const log = createLogger('GetnadaService');
const BASE_URL = 'https://getnada.com/api/v1';

export class GetnadaService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['getnada.com', 'nada.ltd', 'inboxes.com', 'cmail.club'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/inboxes`, { signal: _signal ?? null });
      if (res.ok) {
        const data: unknown = await res.json();
        const pool = Array.isArray(data)
          ? data
          : data && typeof data === 'object'
            ? (data as Record<string, unknown>).inboxes ?? (data as Record<string, unknown>).data
            : null;
        if (Array.isArray(pool) && pool.length > 0) {
          const inbox = pool[Math.floor(Math.random() * pool.length)] as
            | Record<string, unknown>
            | null;
          const sharedEmail = inbox && (inbox.email || inbox.address || inbox.id);
          if (typeof sharedEmail === 'string' && sharedEmail.includes('@')) {
            const [login = '', domain = 'getnada.com'] = sharedEmail.split('@');
            const now = Date.now();
            log.info('getnada: adopted shared inbox address', { email: sharedEmail });
            return {
              id: `getnada_${now}_${login}`,
              username: login,
              login,
              domain,
              fullEmail: sharedEmail,
              createdAt: now,
              expiresAt: now + 24 * 60 * 60 * 1000,
              service: 'getnada',
            };
          }
        }
      }
    } catch (e) {
      log.debug('getnada shared-inbox discovery failed, using fallback', e);
    }

    const login = prefix || generateHumanLikeUsername();
    const domain = 'getnada.com';
    const fullEmail = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: `getnada_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'getnada',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inboxes/${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (response.status === 404) {
        return [];
      }
      throwIfRetryableStatus(response, 'GetNada getMessages');

      const data = await response.json();
      const messages = Array.isArray(data) ? data : data.msgs || data.messages || [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = messages.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgId = msg.uid || msg.id || msg.messageId;
            const msgResponse = await fetchWithTimeout(
              `${BASE_URL}/messages/html/${encodeURIComponent(msgId)}`,
              { signal: signal ?? null }
            );
            if (!msgResponse.ok) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const fullMsg = await msgResponse.json();
            const bodyStr = contentToString(fullMsg.html || fullMsg.text || fullMsg.body);
            const htmlStr = contentToString(fullMsg.html || fullMsg.body);
            const textStr = contentToString(fullMsg.text || fullMsg.body);
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
          id: String(msg.uid || msg.id || msg.messageId),
          from: contentToString(msg.fe || msg.from, 'Unknown Sender'),
          to: contentToString(fullEmail),
          subject: contentToString(msg.s || msg.subject, '(No Subject)'),
          date: safeParseDate(msg.rf || msg.date),
          body: contentToString(msg.b || msg.body),
          htmlBody: contentToString(msg.html || msg.body),
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
        throttledWarn(log, 'getnada-getMessages', 'Failed to fetch GetNada messages', error);
        throw error;
      }
      log.debug('GetNada getMessages non-retryable error, returning []', error);
      return [];
    }
  }

  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/messages/html/${encodeURIComponent(emailId)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const msg = await response.json();
      const bodyStr = contentToString(msg.html || msg.text || msg.body);
      const htmlStr = contentToString(msg.html || msg.body);
      const textStr = contentToString(msg.text || msg.body);

      return {
        id: String(msg.uid || msg.id || emailId),
        from: contentToString(msg.fe || msg.from, 'Unknown Sender'),
        to: contentToString(fullEmail),
        subject: contentToString(msg.s || msg.subject, '(No Subject)'),
        date: safeParseDate(msg.rf || msg.date),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
        read: true,
        attachments: [],
      };
    } catch (error) {
      log.error('Failed to fetch GetNada message details', error);
      throw error;
    }
  }
}

export const getnadaService = new GetnadaService();
