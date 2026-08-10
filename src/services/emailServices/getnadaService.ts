// GetNada / Nada.ltd / Inboxes.com Service Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { createLogger } from '../../utils/logger';

const log = createLogger('GetnadaService');
const BASE_URL = 'https://getnada.com/api/v1';

export class GetnadaService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['getnada.com', 'nada.ltd', 'inboxes.com', 'cmail.club'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    // getnada.com is a SHARED-inbox service: incoming mail is routed into a pool
    // of public inboxes hosted by getnada, keyed by addresses that getnada itself
    // hands out — NOT to an arbitrary "anything@getnada.com" mailbox. Fabricating
    // `${prefix}@getnada.com` therefore produces an address that never receives
    // mail (the reported "provider never gets the OTP" case). We must adopt a live
    // address from getnada's shared-inbox pool instead.
    // If the pool can't be reached, reject generation so the aggregator falls back
    // to a working provider rather than handing the user a dead mailbox.
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
      log.warn('getnada shared-inbox discovery failed', e);
    }
    throw new Error('getnada shared inbox unavailable — falling back to another provider');
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/inboxes/${encodeURIComponent(fullEmail)}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        return [];
      }

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
            return {
              body: fullMsg.html || fullMsg.text || fullMsg.body || '',
              htmlBody: fullMsg.html || fullMsg.body || '',
              textBody: fullMsg.text || fullMsg.body || '',
            };
          } catch {
            return { body: '', htmlBody: '', textBody: '' };
          }
        })
      );

      return messages.map((msg: any, idx: number) => {
        const email: Email = {
          id: String(msg.uid || msg.id || msg.messageId),
          from: msg.fe || msg.from || 'Unknown Sender',
          to: fullEmail,
          subject: msg.s || msg.subject || '(No Subject)',
          date: msg.rf || msg.date ? new Date(msg.rf || msg.date).getTime() : Date.now(),
          body: msg.b || msg.body || '',
          htmlBody: msg.html || msg.body || '',
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
      log.warn('Failed to fetch GetNada messages', error);
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
      return {
        id: String(msg.uid || msg.id || emailId),
        from: msg.fe || msg.from || 'Unknown Sender',
        to: fullEmail,
        subject: msg.s || msg.subject || '(No Subject)',
        date: msg.rf || msg.date ? new Date(msg.rf || msg.date).getTime() : Date.now(),
        body: msg.html || msg.text || msg.body || '',
        htmlBody: msg.html || msg.body || '',
        textBody: msg.text || msg.body || '',
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
