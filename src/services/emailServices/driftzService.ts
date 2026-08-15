import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('DriftzService');
const BASE_URL = 'https://api.driftz.net';

export class DriftzService {
  async getDomains(signal?: AbortSignal): Promise<string[]> {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/domains`, { signal: signal ?? null });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch domains');
      }

      // We primarily use temp domains for standard Ghostfill generation
      return Array.isArray(data.result?.temp) && data.result.temp.length > 0
        ? data.result.temp
        : ['temp.driftz.net'];
    } catch (error) {
      log.debug('Driftz domains unavailable, using fallback domain', { error: String(error) });
      return ['temp.driftz.net']; // Fallback
    }
  }

  async createAccount(signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/temp/generate`, {
        method: 'POST',
        signal: signal ?? null,
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.result?.address) {
          const address = data.result.address;
          const expiresAt = data.result.expiresAt
            ? Number(data.result.expiresAt) * 1000
            : Date.now() + 24 * 60 * 60 * 1000;
          const domain = address.split('@')[1] || 'temp.driftz.net';

          return {
            id: address,
            fullEmail: address,
            domain,
            service: 'driftz',
            createdAt: Date.now(),
            expiresAt,
          };
        }
      }
    } catch (error) {
      log.debug('Driftz remote generate failed, falling back to local generation', error);
    }

    // Resilient fallback: generate locally on supported domain
    const login = generateHumanLikeUsername();
    const domain = 'temp.driftz.net';
    const address = `${login}@${domain}`;
    const now = Date.now();

    return {
      id: address,
      fullEmail: address,
      domain,
      service: 'driftz',
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
    };
  }

  async getMessages(address: string, signal?: AbortSignal): Promise<Email[]> {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/temp/${encodeURIComponent(address)}?limit=50`, {
        signal: signal ?? null,
      });
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        } // Empty or expired
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch messages');
      }

      const messages = data.result?.items || [];

      // Fetch full body for first 5 messages in parallel
      const recentMessages = messages.slice(0, 5);
      const fullBodyResults = await Promise.all(
        recentMessages.map(async (msg: any) => {
          try {
            const msgResponse = await fetchWithTimeout(
              `${BASE_URL}/temp/${encodeURIComponent(address)}/${encodeURIComponent(msg.id)}`,
              { signal: signal ?? null }
            );
            if (!msgResponse.ok) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const msgData = await msgResponse.json();
            if (!msgData.success) {
              return { body: '', htmlBody: '', textBody: '' };
            }
            const fullMsg = msgData.result;
            return {
              body: contentToString(fullMsg.textContent || fullMsg.htmlContent),
              htmlBody: contentToString(fullMsg.htmlContent || fullMsg.textContent),
              textBody: contentToString(fullMsg.textContent || ''),
            };
          } catch {
            return { body: '', htmlBody: '', textBody: '' };
          }
        })
      );

      return messages.map((msg: any, idx: number) => {
        const email: Email = {
          id: String(msg.id),
          from: contentToString(msg.fromAddress, 'Unknown Sender'),
          to: contentToString(msg.toAddress || address),
          subject: contentToString(msg.subject, '(No Subject)'),
          date: msg.receivedAt ? Number(msg.receivedAt) * 1000 : Date.now(),
          body: '',
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
      log.warn('Failed to fetch Driftz messages', error);
      return [];
    }
  }

  async getMessage(address: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/temp/${encodeURIComponent(address)}/${encodeURIComponent(emailId)}`,
        { signal: signal ?? null }
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch message');
      }

      const msg = data.result;
      const bodyStr = contentToString(msg.textContent || msg.htmlContent);
      const htmlStr = contentToString(msg.htmlContent || msg.textContent);
      const textStr = contentToString(msg.textContent || '');

      return {
        id: String(msg.id),
        from: contentToString(msg.fromAddress, 'Unknown Sender'),
        to: contentToString(msg.toAddress || address),
        subject: contentToString(msg.subject, '(No Subject)'),
        date: msg.receivedAt ? Number(msg.receivedAt) * 1000 : Date.now(),
        body: bodyStr,
        htmlBody: htmlStr,
        textBody: textStr,
        read: true,
        attachments: msg.hasAttachments
          ? [{ filename: 'Attachments exist (requires API)', contentType: 'unknown', size: 0 }]
          : [],
      };
    } catch (error) {
      log.error('Failed to fetch Driftz message details', error);
      throw error;
    }
  }

  // --- Permanent Inboxes & Payments API (Advanced Features) ---

  async getPermanentMessages(
    address: string,
    password?: string,
    signal?: AbortSignal
  ): Promise<Email[]> {
    const headers: Record<string, string> = {};
    if (password) {
      headers['x-inbox-password'] = password;
    }

    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/emails/${encodeURIComponent(address)}?limit=50`,
        { headers, signal: signal ?? null }
      );
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch permanent messages');
      }

      return (data.result?.items || []).map((msg: any) => ({
        id: String(msg.id),
        from: contentToString(msg.fromAddress, 'Unknown Sender'),
        to: contentToString(msg.toAddress || address),
        subject: contentToString(msg.subject, '(No Subject)'),
        date: msg.receivedAt ? Number(msg.receivedAt) * 1000 : Date.now(),
        body: '',
        read: false,
        attachments: [],
      }));
    } catch (error) {
      log.warn('Failed to fetch Driftz permanent messages', error);
      return [];
    }
  }

  async getPermanentMessage(
    emailId: string,
    password?: string,
    signal?: AbortSignal
  ): Promise<Email> {
    const headers: Record<string, string> = {};
    if (password) {
      headers['x-inbox-password'] = password;
    }

    const response = await fetchWithTimeout(
      `${BASE_URL}/emails/message/${encodeURIComponent(emailId)}`,
      { headers, signal: signal ?? null }
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch permanent message');
    }

    const msg = data.result;
    const bodyStr = contentToString(msg.textContent || msg.htmlContent);
    const htmlStr = contentToString(msg.htmlContent || msg.textContent);
    const textStr = contentToString(msg.textContent || '');

    return {
      id: String(msg.id),
      from: contentToString(msg.fromAddress, 'Unknown Sender'),
      to: contentToString(msg.toAddress || ''),
      subject: contentToString(msg.subject, '(No Subject)'),
      date: msg.receivedAt ? Number(msg.receivedAt) * 1000 : Date.now(),
      body: bodyStr,
      htmlBody: htmlStr,
      textBody: textStr,
      read: true,
      attachments: msg.hasAttachments
        ? [{ filename: 'Attachments exist (requires API)', contentType: 'unknown', size: 0 }]
        : [],
    };
  }
}

export const driftzService = new DriftzService();
