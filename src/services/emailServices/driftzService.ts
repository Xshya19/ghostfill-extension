import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn } from './isRetryableError';

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

      // We primarily use temp domains for standard Ghostfill generation, prioritizing bbjbinin.mn
      const tempDomains: string[] =
        Array.isArray(data.result?.temp) && data.result.temp.length > 0
          ? data.result.temp
          : ['bbjbinin.mn', 'manornewtech.org'];
      return tempDomains.sort((a, b) => (a === 'bbjbinin.mn' ? -1 : b === 'bbjbinin.mn' ? 1 : 0));
    } catch (error) {
      log.debug('Driftz domains unavailable, using fallback domains', { error: String(error) });
      return ['bbjbinin.mn', 'manornewtech.org']; // Real active temp domains fallback with bbjbinin.mn default
    }
  }

  async createAccount(signal?: AbortSignal, requestedDomain?: string): Promise<EmailAccount> {
    const targetDomain = requestedDomain || 'bbjbinin.mn';
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/temp/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain: targetDomain }),
        signal: signal ?? null,
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.result?.address) {
          const address = data.result.address;
          const expiresAt = data.result.expiresAt
            ? Number(data.result.expiresAt) * 1000
            : Date.now() + 24 * 60 * 60 * 1000;
          const domain = address.split('@')[1] || 'bbjbinin.mn';

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

    // Resilient fallback: generate locally. Use a static domain — the network
    // just failed, so calling getDomains() here would fail too (and burn a
    // second timeout before returning the same static list anyway).
    const login = generateHumanLikeUsername();
    const domain = targetDomain || 'bbjbinin.mn';
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
      if (isRetryableError(error)) {
        throttledWarn(log, 'driftz-getMessages', 'Failed to fetch Driftz messages', error);
        throw error;
      }
      log.debug('Driftz getMessages non-retryable error, returning []', error);
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
      if (isRetryableError(error)) {
        throttledWarn(log, 'driftz-getPermanentMessages', 'Failed to fetch Driftz permanent messages', error);
        throw error;
      }
      log.debug('Driftz getPermanentMessages non-retryable error, returning []', error);
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
