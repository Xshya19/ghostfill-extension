import { IEmailProvider, Email, EmailAccount } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { storageService } from '../storageService';
import { providerHealth } from './providerHealthManager';

const log = createLogger('CustomDomainService');

/**
 * Service to interface with a user-provided custom domain endpoint (e.g. Cloudflare Worker)
 *
 * API Spec expected:
 * GET /api/generate?prefix=xyz  -> { email: "xyz@domain.com", token: "secret" }
 * GET /api/messages?email=x@d.com&token=secret -> { messages: [ ... ] }
 */
export class CustomDomainService implements IEmailProvider {
  name = 'Custom Domain';
  enabled = true;
  priority = 100; // High priority if configured

  private async getApiConfig(): Promise<{
    updateUrl: string;
    domain: string;
    apiKey?: string;
  } | null> {
    const settings = await storageService.getSettings();
    if (!settings.customDomain || !settings.customDomainUrl) {
      return null;
    }
    // SECURITY FIX: Get API key from session-only storage (not persisted)
    const apiKey = await storageService.getCustomDomainKey();
    return {
      updateUrl: settings.customDomainUrl,
      domain: settings.customDomain,
      ...(apiKey && { apiKey }),
    };
  }

  async createAccount(signal?: AbortSignal): Promise<EmailAccount> {
    const config = await this.getApiConfig();
    if (!config) {
      throw new Error('Custom domain not configured');
    }

    const prefix = generateHumanLikeUsername();
    // If the user provided an endpoint for generation, use it
    // Otherwise, simply assume catch-all routing
    const fullEmail = `${prefix}@${config.domain}`;

    // SECURITY FIX: Notify custom backend to register the generated alias
    try {
      if (config.updateUrl) {
        const generationUrl = new URL(config.updateUrl);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.apiKey) {
          headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        const fetchInit: RequestInit = {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'create', prefix, domain: config.domain, fullEmail }),
          signal: signal ?? null,
        };
        const response = await fetchWithTimeout(generationUrl.toString(), fetchInit);

        if (!response.ok) {
          const details = await response.text().catch(() => '');
          const suffix = details ? `: ${details.slice(0, 200)}` : '';
          throw new Error(`Custom domain registration failed (${response.status})${suffix}`);
        }
      }
    } catch (error) {
      const registrationError = error instanceof Error ? error : new Error(String(error));
      providerHealth.recordFailure('custom', registrationError);
      log.warn('Custom domain API registration failed; account was not created', registrationError);
      throw registrationError;
    }

    return {
      fullEmail,
      domain: config.domain,
      username: prefix,
      id: prefix,
      service: 'custom' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 * 365,
      ...(config.apiKey && { token: config.apiKey }),
    } as EmailAccount;
  }

  private requestTimestamps: number[] = [];
  private readonly MAX_REQUESTS_PER_MINUTE = 60;

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < 60000);
    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_MINUTE) {
      log.warn('Custom domain API rate limit exceeded');
      throw new Error('Rate limit exceeded');
    }
    this.requestTimestamps.push(now);
  }

  async getMessages(account: EmailAccount, signal?: AbortSignal): Promise<Email[]> {
    const config = await this.getApiConfig();
    if (!config) {
      return [];
    }

    if (account.token && account.token.length > 512) {
      log.warn('API Key exceeds safe length criteria.');
      return [];
    }

    await this.checkRateLimit();

    try {
      // Assume the custom URL supports a standard query param format
      // e.g. https://my-worker.workers.dev/api/messages?email=...

      const url = new URL(config.updateUrl);
      url.searchParams.set('email', account.fullEmail);

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (account.token) {
        headers['Authorization'] = `Bearer ${account.token}`;
      }

      const t0 = performance.now();
      const fetchInit: RequestInit = {
        method: 'GET',
        headers,
        signal: signal ?? null,
      };
      const response = await fetchWithTimeout(url.toString(), fetchInit);

      if (!response.ok) {
        const error = new Error(`Custom API returned ${response.status}`);
        providerHealth.recordFailure('custom', error);
        throw error;
      }

      const data = await response.json();
      providerHealth.recordSuccess('custom', performance.now() - t0);

      // Expected format: { messages: [ { id, from, subject, body, htmlBody, date } ] }
      if (data && Array.isArray(data.messages)) {
        interface CustomMessage {
          id?: string;
          from?: string;
          subject?: string;
          body?: string;
          htmlBody?: string;
          date?: string | number;
        }

        return data.messages.map((msg: CustomMessage) => {
          const bodyStr = contentToString(msg.body);
          const htmlStr = contentToString(msg.htmlBody || msg.body);
          return {
            id: msg.id || String(Date.now()),
            from: contentToString(msg.from, 'Unknown Sender'),
            to: account.fullEmail,
            subject: contentToString(msg.subject, '(No Subject)'),
            body: bodyStr,
            htmlBody: htmlStr,
            textBody: bodyStr,
            date: safeParseDate(msg.date),
            attachments: [],
            read: false,
          };
        });
      }

      return [];
    } catch (error) {
      log.warn('Failed to fetch from custom domain', error);
      if (error instanceof Error) {
        providerHealth.recordFailure('custom', error);
      }
      return [];
    }
  }
}
