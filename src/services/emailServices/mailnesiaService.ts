import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { getRandomInt } from '../../utils/encryption';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('MailnesiaService');
const BASE_URL = 'https://mailnesia.com';

export class MailnesiaService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['mailnesia.com'];
  }

  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = prefix || generateHumanLikeUsername() + getRandomInt(100, 9999);
    const domain = 'mailnesia.com';
    const now = Date.now();
    const fullEmail = `${login}@${domain}`;

    log.info('mailnesia: generated new public inbox', { email: fullEmail });

    return {
      id: `mailnesia_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      service: 'mailnesia',
    };
  }

  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const [login] = fullEmail.split('@');
      
      // Mailnesia provides an RSS feed for easy parsing
      const response = await fetchWithTimeout(
        `${BASE_URL}/rss/${encodeURIComponent(login || '')}`,
        { signal: signal ?? null }
      );

      if (!response.ok) {
        return [];
      }

      const xmlText = await response.text();
      
      // Simple regex parser for RSS since DOMParser isn't available in service workers
      const items: any[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      
      while ((match = itemRegex.exec(xmlText)) !== null) {
        const itemContent = match[1];
        
        const titleMatch = /<title><\!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/.exec(itemContent || '');
        const descMatch = /<description><\!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/.exec(itemContent || '');
        const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(itemContent || '');
        const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemContent || '');
        
        const title = (titleMatch?.[1] || titleMatch?.[2] || 'No Subject').trim();
        const description = (descMatch?.[1] || descMatch?.[2] || '').trim();
        const link = (linkMatch?.[1] || '').trim();
        const pubDate = (pubDateMatch?.[1] || '').trim();
        
        // Extract sender from title (Mailnesia formats title as "Sender: Subject")
        let from = 'Unknown Sender';
        let subject = title;
        if (title.includes(':')) {
           const parts = title.split(':');
           from = parts[0]?.trim() || 'Unknown Sender';
           subject = parts.slice(1).join(':').trim();
        }

        const msgId = link.split('/').pop() || String(Math.random());
        
        items.push({
           id: msgId,
           title: subject,
           description,
           link,
           pubDate,
           from
        });
      }

      return items.map((msg: any) => {
        const msgDate = msg.pubDate ? new Date(msg.pubDate).getTime() : Date.now();
        return {
          id: msg.id,
          threadId: msg.id,
          snippet: msg.title || 'No snippet',
          subject: msg.title || 'No Subject',
          from: msg.from,
          fromEmail: msg.from,
          fromName: msg.from,
          date: msgDate,
          dateFormatted: new Date(msgDate).toISOString(),
          isUnread: false,
          labelIds: [],
          attachments: [],
          read: true,
          body: String(msg.description || ''),
          htmlBody: String(msg.description || ''),
          textBody: String(msg.description || ''),
        };
      });
    } catch (error) {
      log.warn('mailnesia getMessages error', error);
      return [];
    }
  }
}

export const mailnesiaService = new MailnesiaService();
