import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { getRandomInt } from '../../utils/encryption';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('MailinatorService');
const BASE_URL = 'https://www.mailinator.com/v2/domains/public/inboxes';

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

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const messages = data?.msgs || data?.messages || data || [];
      const msgList = Array.isArray(messages) ? messages : [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = msgList.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgId = msg.id || msg.messageId;
            const msgResponse = await fetchWithTimeout(
              `${BASE_URL}/${encodeURIComponent(login || '')}/messages/${encodeURIComponent(msgId || '')}`,
              { signal: signal ?? null }
            );
            if (!msgResponse.ok) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const fullMsg = await msgResponse.json();
            
            // Mailinator API parts contains the body parts (html/text)
            const parts = fullMsg?.parts || [];
            let htmlBody = '';
            let textBody = '';
            
            for (const part of parts) {
               if (part.headers && part.headers['content-type']) {
                   if (part.headers['content-type'].includes('text/html')) {
                       htmlBody = part.body;
                   } else if (part.headers['content-type'].includes('text/plain')) {
                       textBody = part.body;
                   }
               } else if (part.body) {
                   htmlBody = part.body;
               }
            }
            
            const finalHtml = htmlBody || textBody || fullMsg?.body || '';
            const finalText = textBody || htmlBody || fullMsg?.body || '';

            return {
              body: finalHtml,
              htmlBody: finalHtml,
              textBody: finalText,
            };
          } catch {
            return { body: '', htmlBody: '', textBody: '' };
          }
        })
      );

      return msgList.map((msg: any, idx: number) => {
        const fullMsg = idx < 5 ? fullBodyResults[idx] : { body: '', htmlBody: '', textBody: '' };
        return {
          id: msg.id || msg.messageId || String(Math.random()),
          threadId: msg.id || String(Math.random()),
          snippet: msg.subject || 'No snippet',
          subject: msg.subject || 'No Subject',
          from: msg.fromfull || msg.from || msg.sender || 'Unknown Sender',
          fromEmail: msg.fromfull || msg.from || 'unknown@example.com',
          fromName: msg.from || 'Unknown',
          date: msg.time || Date.now(),
          dateFormatted: new Date(msg.time || Date.now()).toISOString(),
          isUnread: false,
          labelIds: [],
          attachments: [],
          read: true,
          ...fullMsg,
          body: String(fullMsg?.body || ''),
          htmlBody: String(fullMsg?.htmlBody || ''),
          textBody: String(fullMsg?.textBody || ''),
        };
      });
    } catch (error) {
      log.warn('mailinator getMessages error', error);
      return [];
    }
  }
}

export const mailinatorService = new MailinatorService();
