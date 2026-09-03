// Throwawaymail Service - throwawaymail.app API integration
// API: https://throwawaymail.app/api
// Fast REST API for temporary disposable email, zero auth needed

import { EmailAccount, Email } from '../../types';
import {
  fetchWithTimeout,
  contentToString,
  safeParseDate,
  extractHtmlFromBody,
  extractTextFromBody,
} from '../../utils/core';
import { createLogger } from '../../utils/logger';

const log = createLogger('ThrowawaymailService');
const BASE_URL = 'https://throwawaymail.app';

export class ThrowawaymailService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['throwawaymail.app'];
  }

  async createAccount(_prefix?: string, signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/api/mailboxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: signal ?? null,
      });

      if (!response.ok) {
        throw new Error(`Failed to create throwawaymail mailbox: HTTP ${response.status}`);
      }

      const data = await response.json();
      const mailboxId = data.mailbox_id || data.id;
      const fullEmail = data.address;

      if (!mailboxId || !fullEmail) {
        throw new Error('Invalid response from throwawaymail API');
      }

      const [login, domain] = fullEmail.split('@');
      const now = Date.now();
      const expiresAt = data.expires_at ? safeParseDate(data.expires_at) : now + 60 * 60 * 1000;

      return {
        id: mailboxId,
        username: login || mailboxId,
        login: login || mailboxId,
        domain: domain || 'throwawaymail.app',
        fullEmail,
        token: mailboxId, // Save mailboxId as token for easy retrieval
        createdAt: now,
        expiresAt,
        service: 'throwawaymail',
      };
    } catch (error) {
      log.error('Throwawaymail createAccount failed', error);
      throw error;
    }
  }

  async getMessages(account: EmailAccount, signal?: AbortSignal): Promise<Email[]> {
    const mailboxId = account.token || account.id;
    if (!mailboxId) {
      return [];
    }

    try {
      const response = await fetchWithTimeout(`${BASE_URL}/api/mailboxes/${encodeURIComponent(mailboxId)}/messages`, {
        signal: signal ?? null,
      });

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      const messages: any[] = Array.isArray(data) ? data : data.messages || [];

      // If message list provides full body, use it; otherwise fetch top 5 message details
      const recentMessages = messages.slice(0, 5);
      const fullMessages = await Promise.all(
        recentMessages.map(async (msg: any) => {
          if (msg.body || msg.text || msg.html) {
            return msg;
          }
          const msgId = msg.message_id || msg.id;
          if (!msgId) {
            return msg;
          }
          try {
            const detailRes = await fetchWithTimeout(
              `${BASE_URL}/api/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(msgId)}`,
              { signal: signal ?? null }
            );
            if (detailRes.ok) {
              return await detailRes.json();
            }
          } catch {
            // Ignore failure to fetch single detail
          }
          return msg;
        })
      );

      return recentMessages.map((rawMsg: any, idx: number) => {
        const msg = fullMessages[idx] || rawMsg;
        const htmlStr = extractHtmlFromBody(msg.html_body || msg.html || msg.body);
        const textStr = extractTextFromBody(msg.text_body || msg.text || msg.body);
        const bodyStr = textStr || htmlStr;
        // Sender key varies by endpoint (list vs detail): try every known
        // variant before falling back — an empty sender shows as
        // "Unknown Sender" and hides who the mail is from.
        const fromAddr =
          msg.from ||
          msg.sender ||
          msg.from_email ||
          msg.sender_email ||
          msg.from_address ||
          msg.fromName ||
          msg.sender_name;

        const email: Email = {
          id: String(msg.message_id || msg.id || `${mailboxId}_${idx}`),
          from: contentToString(fromAddr, 'Unknown Sender'),
          to: contentToString(msg.to || account.fullEmail),
          subject: contentToString(msg.subject, '(No Subject)'),
          date: safeParseDate(msg.created_at || msg.date || Date.now()),
          body: bodyStr,
          htmlBody: htmlStr,
          textBody: textStr,
          read: false,
          attachments: [],
        };
        return email;
      });
    } catch (error) {
      log.warn('Throwawaymail getMessages failed', error);
      throw error;
    }
  }
}

export const throwawaymailService = new ThrowawaymailService();
