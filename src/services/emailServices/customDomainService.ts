import { IEmailProvider, Email, EmailAccount } from '../../types';
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
      apiKey: apiKey,
    };
  }

  async createAccount(signal?: AbortSignal): Promise<EmailAccount> {
    const config = await this.getApiConfig();
    if (!config) {
      throw new Error('Custom domain not configured');
    }

    const rng = new Uint8Array(6);
    crypto.getRandomValues(rng);
    const prefix =
      'ghost_' +
      Array.from(rng)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

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
        
        const response = await fetch(generationUrl.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'create', prefix, domain: config.domain, fullEmail }),
          signal,
        });
        
        if (!response.ok) {
          log.warn(`Failed to register prefix with custom domain API (${response.status}). Proceeding anyway (assuming catch-all fallback).`);
        }
      }
    } catch (error) {
      log.warn('Error during custom domain API registration call, falling back to local creation:', error);
    }

    return {
      fullEmail,
      domain: config.domain,
      username: prefix,
      id: prefix, // use prefix as ID
      service: 'custom',
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 * 365, // 1 year "expiry" (persistent)
      token: config.apiKey, // Store API key as token for authorizing checks
    };
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
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal,
      });

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

        return data.messages.map((msg: CustomMessage) => ({
          id: msg.id || String(Date.now()),
          from: msg.from,
          subject: msg.subject,
          body: msg.body || '',
          htmlBody: msg.htmlBody,
          date: msg.date ? new Date(msg.date).getTime() : Date.now(),
          attachments: [],
          read: false,
        }));
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
