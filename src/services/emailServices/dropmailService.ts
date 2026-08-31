// Dropmail.me Service - GraphQL Integration

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';

const log = createLogger('DropmailService');
const GRAPHQL_ENDPOINT = 'https://dropmail.me/api/graphql/ghostfill_client_session';

const INTRODUCE_SESSION_MUTATION = `
mutation {
  introduceSession {
    id
    expiresAt
    addresses {
      address
    }
  }
}`;

const GET_SESSION_MAILS_QUERY = `
query ($id: ID!) {
  session(id: $id) {
    id
    expiresAt
    mails {
      id
      fromAddr
      toAddr
      headerSubject
      text
      html
      receivedAt
    }
  }
}`;

export class DropmailService {
  async getDomains(_signal?: AbortSignal): Promise<string[]> {
    return ['dropmail.me', 'emlpro.com', 'emltmp.com', '10mail.org'];
  }

  async createAccount(_prefix?: string, signal?: AbortSignal): Promise<EmailAccount> {
    try {
      const response = await fetchWithTimeout(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: INTRODUCE_SESSION_MUTATION }),
        signal: signal ?? null,
      });

      if (!response.ok) {
        throw new Error(`Dropmail GraphQL error: ${response.status}`);
      }

      const resJson = await response.json();
      const sessionData = resJson.data?.introduceSession;

      if (!sessionData || !sessionData.addresses?.[0]?.address) {
        throw new Error('Invalid introduceSession response');
      }

      const fullEmail = sessionData.addresses[0].address;
      const parts = fullEmail.split('@');
      const login = parts[0] || generateHumanLikeUsername();
      const domain = parts[1] || 'dropmail.me';
      const now = Date.now();

      return {
        id: sessionData.id,
        username: login,
        login,
        domain,
        fullEmail,
        token: sessionData.id, // Store session ID as token
        createdAt: now,
        expiresAt: safeParseDate(sessionData.expiresAt, now + 60 * 60 * 1000),
        service: 'dropmail',
      };
    } catch (error) {
      log.error('Failed to create Dropmail account', error);
      // Fallback local creation
      const login = generateHumanLikeUsername();
      const domain = 'dropmail.me';
      const now = Date.now();
      return {
        id: `dropmail_${now}_${login}`,
        username: login,
        login,
        domain,
        fullEmail: `${login}@${domain}`,
        createdAt: now,
        expiresAt: now + 60 * 60 * 1000,
        service: 'dropmail',
      };
    }
  }

  async getMessages(account: EmailAccount, signal?: AbortSignal): Promise<Email[]> {
    const sessionId = account.token || account.id;
    if (!sessionId) {
      return [];
    }

    try {
      const response = await fetchWithTimeout(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: GET_SESSION_MAILS_QUERY,
          variables: { id: sessionId },
        }),
        signal: signal ?? null,
      });

      if (!response.ok) {
        return [];
      }

      const resJson = await response.json();
      const mails = resJson.data?.session?.mails || [];

      return mails.map((m: any) => {
        const bodyStr = contentToString(m.text || m.html);
        const htmlStr = contentToString(m.html || m.text);
        const textStr = contentToString(m.text || m.html);
        return {
          id: String(m.id),
          from: contentToString(m.fromAddr, 'Unknown Sender'),
          to: contentToString(m.toAddr || account.fullEmail),
          subject: contentToString(m.headerSubject, '(No Subject)'),
          date: safeParseDate(m.receivedAt),
          body: bodyStr,
          htmlBody: htmlStr,
          textBody: textStr,
          read: false,
          attachments: [],
        };
      });
    } catch (error) {
      log.warn('Failed to fetch Dropmail messages', error);
      return [];
    }
  }

  async getMessage(account: EmailAccount, emailId: string, signal?: AbortSignal): Promise<Email> {
    const messages = await this.getMessages(account, signal);
    const found = messages.find((m) => String(m.id) === String(emailId));
    if (!found) {
      throw new Error('Message not found');
    }
    return { ...found, read: true };
  }
}

export const dropmailService = new DropmailService();
