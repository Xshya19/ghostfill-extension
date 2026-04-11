// Email Service Aggregator
// REFACTORED: Uses IProviderHealthManager interface to break circular dependencies

import { EmailAccount, Email, EmailService } from '../../types';
import { createLogger } from '../../utils/logger';
import { sanitizeEmailSubject } from '../../utils/sanitization.core';
import { storageService } from '../storageService';
import { IProviderHealthManager } from '../types/email-services.types';

import { CustomDomainService } from './customDomainService';
import { guerrillaMailService } from './guerrillaMailService';
import { maildropService } from './maildropService';
import { mailGwService } from './mailGwService';
import { mailTmService } from './mailTmService';
import { providerHealth } from './providerHealthManager';
import { tempMailService } from './tempMailService';

const log = createLogger('EmailServiceAggregator');
const customDomainService = new CustomDomainService();

class EmailServiceAggregator {
  private availableServices: EmailService[] = [
    'mailtm',
    'mailgw',
    'maildrop',
    'guerrilla',
    'tempmail',
    '1secmail',
    'custom',
  ];
  private healthCheckTimestamp: number = 0;
  private healthCheckInitialized: boolean = false;

  // Mutexes to prevent race conditions during concurrent operations
  private generateEmailPromise: Promise<EmailAccount> | null = null;
  private getCurrentEmailPromise: Promise<EmailAccount | null> | null = null;

  // ARCHITECTURE FIX: Inject health manager dependency (defaults to singleton)
  private healthManager: IProviderHealthManager;

  constructor(healthManager?: IProviderHealthManager) {
    this.healthManager = healthManager || providerHealth;
  }

  /**
   * PERFORMANCE FIX: Persist health check results to storage
   * Load persisted health state on initialization
   */
  private async loadHealthState(): Promise<void> {
    if (this.healthCheckInitialized) {
      return;
    }

    try {
      // P1.11: Ensure the underlying health manager is also initialized
      if (this.healthManager.init) {
        await this.healthManager.init();
      }

      const healthState = await storageService.get('emailServiceHealth');
      if (
        healthState &&
        typeof healthState === 'object' &&
        'timestamp' in healthState &&
        'availableServices' in healthState
      ) {
        const state = healthState as { timestamp: number; availableServices: EmailService[] };
        // Only use persisted state if less than 1 hour old
        if (Date.now() - state.timestamp < 60 * 60 * 1000) {
          this.healthCheckTimestamp = state.timestamp;
          this.availableServices = state.availableServices;
          log.debug('Loaded persisted health state', {
            available: this.availableServices,
            age: Math.round((Date.now() - state.timestamp) / 60000) + 'm',
          });
        }
      }
    } catch (error) {
      log.warn('Failed to load health state, using defaults', error);
    }

    this.healthCheckInitialized = true;
  }

  /**
   * PERFORMANCE FIX: Persist health check results to storage
   */
  private async persistHealthState(): Promise<void> {
    try {
      await storageService.set('emailServiceHealth', {
        timestamp: this.healthCheckTimestamp,
        availableServices: this.availableServices as EmailService[],
      });
      log.debug('Persisted health state');
    } catch (error) {
      log.warn('Failed to persist health state', error);
    }
  }

  /**
   * Get the best available provider using health scoring
   * Uses ProviderHealthManager for intelligent selection
   */
  private getBestProvider(exclude?: EmailService): EmailService | null {
    return this.healthManager.getBestProvider(exclude ? [exclude] : []);
  }

  /**
   * Perform health check to identify working services
   * Runs once every hour
   * PERFORMANCE FIX: Results are now persisted to storage
   */
  async performHealthCheck(): Promise<void> {
    // Load persisted state if not already done
    if (!this.healthCheckInitialized) {
      await this.loadHealthState();
    }

    // Debounce checks (1 hour)
    if (Date.now() - this.healthCheckTimestamp < 60 * 60 * 1000) {
      return;
    }

    log.info('Performing email service health check...');

    // Parallel checks
    const checks = this.availableServices.map(async (service) => {
      if (service === 'custom') {
        return 'custom';
      } // Always assume custom is "healthy" if configured (checked later)
      if (!this.healthManager.isAvailable(service)) {
        return null;
      } // Skip unavailable providers

      try {
        // Try to get domains as a lightweight "ping"
        const domains = await this.getDomains(service);
        if (domains && domains.length > 0) {
          if (
            (service === 'tempmail' || service === '1secmail') &&
            tempMailService.isUsingFallbackDomains()
          ) {
            // This is expected behavior - just use debug level, not warn
            log.debug(`Health check degraded for ${service}: using fallback domains`);
            // Don't record as failure - fallback domains still work
            return service;
          }
          return service;
        }
      } catch (e) {
        log.debug(`Health check failed for ${service}`, e);
      }
      return null;
    });

    const results = await Promise.all(checks);
    this.availableServices = results.filter((s): s is EmailService => s !== null);

    // Always ensure we have at least one fallback
    if (this.availableServices.length === 0) {
      this.availableServices = ['mailtm', 'mailgw', 'maildrop', 'guerrilla'];
      log.warn('All health checks failed, resetting to defaults');
    }

    this.healthCheckTimestamp = Date.now();

    // PERFORMANCE FIX: Persist health check results non-blocking
    this.persistHealthState().catch((e) => log.warn('Failed to persist health state', e));

    log.info('Health check complete', { available: this.availableServices });
  }

  /**
   * Generate a new email using the specified or default service
   * Mail.tm is now the primary service. TMailor is secondary.
   */
  private lastGenerationTime: number = 0;
  private readonly GENERATION_COOLDOWN_MS = 500; // 500ms rate limit

  async generateEmail(
    options: {
      service?: EmailService;
      prefix?: string;
      domain?: string;
      originUrl?: string;
      signal?: AbortSignal;
    } = {}
  ): Promise<EmailAccount> {
    const now = Date.now();
    const diff = this.GENERATION_COOLDOWN_MS - (now - this.lastGenerationTime);
    if (diff > 0) {
      const waitSec = (diff / 1000).toFixed(1);
      throw new Error(`Rate limit: wait ${waitSec}s before retry.`);
    }
    this.lastGenerationTime = now;

    if (this.generateEmailPromise) {
      return this.generateEmailPromise;
    }

    this.generateEmailPromise = (async () => {
      // Ensure we have a list of healthy services
      if (this.healthCheckTimestamp === 0) {
        // Run in background, don't block first call
        this.performHealthCheck().catch((err) => log.error('Background health check failed', err));
      }

      const settings = await storageService.getSettings();
      // Use preferred if valid/healthy, otherwise pick best healthy
      let service = options.service || settings.preferredEmailService || 'mailtm';

      // Custom precedence
      if (settings.preferredEmailService === 'custom' && !options.service) {
        service = 'custom';
      }

      // If preferred service is not in healthy list (and not explicitly requested by user via options), pick first healthy
      if (
        !options.service &&
        service !== 'custom' &&
        !this.availableServices.includes(service) &&
        this.availableServices.length > 0
      ) {
        service = this.availableServices[0]!;
        log.info(`Preferred service unavailable, switching to ${service}`);
      }

      let account: EmailAccount;
      const startTime = performance.now(); // Track response time for health scoring

      try {
        account = await this.createAccountWithService(service, options);
        if (options.originUrl) {
          account.originUrl = options.originUrl;
        }
      } catch (error) {
        // Record failure for health tracking
        this.healthManager.recordFailure(service, error as Error);
        log.warn(`Failed to generate email with ${service}, executing fallback logic...`, error);

        // Smart fallback with health-aware provider selection
        return this.generateEmailWithFallback(options, service, startTime);
      }

      // Success path - store and return (use account.service, not the requested service)
      return this.finalizeEmailGeneration(account, account.service as EmailService, startTime);
    })();

    try {
      return await this.generateEmailPromise;
    } finally {
      this.generateEmailPromise = null;
    }
  }

  /**
   * Create account with specified service, wrapped in a timeout
   * Simplified: Single responsibility, clear error messages
   */
  private async createAccountWithService(
    service: EmailService,
    options: { prefix?: string; domain?: string; signal?: AbortSignal }
  ): Promise<EmailAccount> {
    const TIMEOUT_MS = 30000;
    const internalAbortController = new AbortController();
    const signal = options.signal || internalAbortController.signal;

    const timeoutId = setTimeout(() => internalAbortController.abort(), TIMEOUT_MS);

    try {
      switch (service) {
        case 'custom':
          return await customDomainService.createAccount(signal);
        case 'maildrop':
          return await maildropService.createAccount(options.prefix, signal);
        case 'mailgw':
          return await mailGwService.createAccount(options.prefix, undefined, signal);
        case 'mailtm':
          if (mailTmService.isCircuitBreakerOpen()) {
            throw new Error(
              'Mail.tm circuit breaker open — skipping due to repeated auth failures'
            );
          }
          // Mail.tm rejects custom prefix/address requests with 401.
          // Pass undefined to let Mail.tm generate a random login.
          return await mailTmService.createAccount(undefined, undefined, signal);
        case 'guerrilla':
          return await guerrillaMailService.createAccount(signal);
        case 'tempmail':
        case '1secmail':
          return await tempMailService.generateEmail(options.prefix, options.domain, signal);
        default:
          log.warn(`Unknown service "${service}", defaulting to Mail.tm`);
          // Same fix for default fallback
          return await mailTmService.createAccount(undefined, undefined, signal);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Retry with fallback providers when primary fails
   */
  private async generateEmailWithFallback(
    options: { prefix?: string; domain?: string; originUrl?: string; signal?: AbortSignal },
    failedService: EmailService,
    startTime: number
  ): Promise<EmailAccount> {
    const triedProviders: EmailService[] = [failedService];
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const nextProvider = this.healthManager.getBestProvider(triedProviders);

      if (!nextProvider) {
        const errorMsg = `All email services unavailable after ${maxRetries} attempts`;
        log.error(errorMsg, { tried: triedProviders });
        throw new Error('All email services are currently unavailable. Please try again later.');
      }

      triedProviders.push(nextProvider);

      // Exponential backoff
      const delay = this.healthManager.getRetryDelay(attempt);
      log.info(
        `Retry ${attempt + 1}/${maxRetries}: Trying ${nextProvider} in ${Math.round(delay)}ms`
      );
      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });

      try {
        const account = await this.createAccountWithService(nextProvider, options);
        if (options.originUrl) {
          account.originUrl = options.originUrl;
        }
        return this.finalizeEmailGeneration(account, account.service as EmailService, startTime);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          this.healthManager.recordFailure(nextProvider, error as Error);
        }
        log.warn(`Fallback to ${nextProvider} failed (attempt ${attempt + 1})`, error);
        // Continue to next provider
      }
    }

    throw new Error('All email services are currently unavailable. Please try again later.');
  }

  /**
   * Finalize successful email generation
   * Stores email and records metrics
   */
  private async finalizeEmailGeneration(
    account: EmailAccount,
    service: EmailService,
    startTime: number
  ): Promise<EmailAccount> {
    // CRITICAL: Validate account.id before saving — required for SSE
    if (service === 'mailtm' && !account.id) {
      // Generate a fallback ID from the email address
      account.id = `fallback_${Date.now()}_${account.fullEmail.replace(/[@.]/g, '_')}`;
      log.warn('Mail.tm account missing id field — generated fallback ID for SSE', {
        fallbackId: account.id,
        email: account.fullEmail,
      });
    }

    log.info('Saving email to storage...', {
      email: account.fullEmail,
      hasId: Boolean(account.id),
    });
    await storageService.set('currentEmail', account);
    log.info('✅ Email saved to storage');

    await storageService.pushToArray(
      'emailHistory',
      {
        email: account.fullEmail,
        service: account.service,
        usedOn: [],
        createdAt: account.createdAt,
        emailsReceived: 0,
      },
      50
    );

    const responseTime = performance.now() - startTime;
    this.healthManager.recordSuccess(service, responseTime);

    log.info('Email generated', {
      email: account.fullEmail,
      service,
      responseTime: `${Math.round(responseTime)}ms`,
    });
    return account;
  }

  /**
   * Get current active email
   */
  async getCurrentEmail(preventRegeneration = false): Promise<EmailAccount | null> {
    if (this.getCurrentEmailPromise) {
      return this.getCurrentEmailPromise;
    }

    this.getCurrentEmailPromise = (async () => {
      const email = (await storageService.get('currentEmail')) as EmailAccount | null;

      // Ensure object is actually a valid EmailAccount (e.g. not an empty object or string)
      if (email && (typeof email !== 'object' || !email.fullEmail)) {
        log.warn('Found corrupted email object in storage, clearing it', { email });
        await storageService.remove('currentEmail');
        return null;
      }

      // Check if expired
      if (email && email.expiresAt < Date.now()) {
        if (preventRegeneration) {
          log.warn('Current email expired, preventing auto-regeneration to avoid loop');
          return null;
        }
        log.info('Current email expired, generating new one');
        return this.generateEmail({ service: email.service });
      }

      return email || null;
    })();

    try {
      return await this.getCurrentEmailPromise;
    } finally {
      this.getCurrentEmailPromise = null;
    }
  }

  /**
   * Check inbox for the specified account
   */
  async checkInbox(account: EmailAccount, signal?: AbortSignal): Promise<Email[]> {
    try {
      const maskedEmail = account.fullEmail
        ? account.fullEmail.replace(
            /^(.)(.*)(@.*)$/,
            (_, f, m, d) => `${f}${'*'.repeat(Math.min(m.length, 5))}${d}`
          )
        : 'unknown';

      log.debug('Checking inbox for account:', {
        service: account.service,
        fullEmail: maskedEmail,
      });

      // Validate account has required fields
      if (!account || !account.fullEmail) {
        log.error('Invalid account for inbox check', { account });
        throw new Error('Invalid email account: missing fullEmail');
      }

      // Ensure fullEmail contains @
      if (!account.fullEmail.includes('@')) {
        log.error('Invalid email format', { fullEmail: account.fullEmail });
        throw new Error('Invalid email format: must contain @');
      }

      let emails: Email[];

      switch (account.service) {
        case 'custom':
          emails = await customDomainService.getMessages(account, signal);
          break;
        case 'maildrop':
          // Maildrop - GraphQL API, no auth required
          emails = await maildropService.getMessages(account, signal);
          break;
        case 'mailgw':
          if (account.token) {
            mailGwService.setToken(account.token);
          } else if (account.password) {
            await mailGwService.authenticate(account.fullEmail, account.password, signal);
          }
          emails = await mailGwService.getMessages(signal);
          break;
        case 'mailtm':
          if (account.token) {
            await mailTmService.setToken(account.token);
          } else if (account.password) {
            await mailTmService.authenticate(account.fullEmail, account.password, signal);
          }
          try {
            emails = await mailTmService.getMessages(signal);
          } catch (e) {
            // If 401, re-authenticate with password and retry
            if (account.password && e instanceof Error && e.message.includes('401')) {
              log.info('Mail.tm 401 during checkInbox — re-authenticating and retrying');
              await mailTmService.authenticate(account.fullEmail, account.password, signal);
              emails = await mailTmService.getMessages(signal);
            } else {
              throw e;
            }
          }
          break;
        case 'guerrilla':
          if (account.token) {
            guerrillaMailService.setSession(account.token, account.fullEmail);
          }
          emails = await guerrillaMailService.getMessages(account.token, signal);
          break;
        case 'tempmail':
        case '1secmail':
        default: {
          // Extract login and domain from fullEmail if not available
          const parts = account.fullEmail ? account.fullEmail.split('@') : [];
          const loginName = account.login || account.username || parts[0];
          const domainName = account.domain || (parts.length > 1 ? parts[1] : '');

          if (!loginName || !domainName) {
            log.error('Cannot extract login/domain from account', { account });
            throw new Error('Invalid account structure');
          }

          emails = await tempMailService.checkInbox(loginName, domainName, signal);
          break;
        }
      }

      // Provide baseline sanitization for subject and from fields against XSS
      const safeEmails = emails.map((email) => ({
        ...email,
        subject: sanitizeEmailSubject(email.subject || '(No Subject)'),
        from: sanitizeEmailSubject(email.from || 'Unknown Sender'),
      }));

      // PERFORMANCE FIX: Only persist inbox if it actually changed.
      // Skip storage write when inbox is identical to avoid unnecessary
      // chrome.storage operations on every 10s poll cycle.
      // PERFORMANCE FIX: Efficient comparison using ID concatenation
      const cachedInbox = (await storageService.get('inbox')) || [];
      const inboxHash = (list: Email[]) => list.map((e) => `${e.id}:${e.read}`).join('|');

      if (inboxHash(safeEmails) !== inboxHash(cachedInbox)) {
        await storageService.set('inbox', safeEmails);
      }

      return safeEmails;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw error;
      }

      const errorMsg = (error as Error).message || String(error);

      // Detect rate limit errors (429 or "Max retries" or "rate limit")
      const isRateLimited =
        errorMsg.includes('429') ||
        errorMsg.includes('Max retries') ||
        errorMsg.includes('rate limit') ||
        errorMsg.includes('Too Many Requests');

      // Detect network errors
      const isNetworkError =
        errorMsg.includes('fetch') ||
        errorMsg.includes('network') ||
        errorMsg.includes('ECONNREFUSED') ||
        errorMsg.includes('timeout');

      if (isRateLimited) {
        log.warn(`Provider ${account.service} is rate-limited. Retrying later.`);
        this.healthManager.recordFailure(account.service, error as Error);
      }

      // Don't spam error logs for network glitches
      if (isNetworkError) {
        log.warn(`Network error checking inbox for ${account.service}: ${errorMsg}`);
      } else {
        log.warn('Failed to check inbox (will retry)', {
          service: account.service,
          error: errorMsg,
        });
      }

      // Wrap error with context before throwing
      const wrappedError = new Error(`Inbox check failed for ${account.service}: ${errorMsg}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wrappedError as any).originalError = error;
      throw wrappedError;
    }
  }

  /**
   * Read a specific email
   */
  async readEmail(
    emailId: string | number,
    account: EmailAccount,
    signal?: AbortSignal
  ): Promise<Email> {
    try {
      let email: Email;

      switch (account.service) {
        case 'custom': {
          const customMessages = await customDomainService.getMessages(account, signal);
          const found = customMessages.find((m) => m.id === emailId || m.id === String(emailId));
          if (!found) {
            throw new Error('Email not found');
          }
          email = found;
          break;
        }
        case 'maildrop':
          // Maildrop - GraphQL API for full message content
          email = await maildropService.getMessage(emailId.toString(), account, signal);
          break;
        case 'mailgw':
          if (account.token) {
            mailGwService.setToken(account.token);
          }
          email = await mailGwService.getMessage(emailId.toString(), signal);
          break;
        case 'mailtm':
          if (account.token) {
            await mailTmService.setToken(account.token);
          }
          email = await mailTmService.getMessage(emailId.toString(), signal);
          break;
        case 'guerrilla':
          email = await guerrillaMailService.getMessage(
            emailId.toString(),
            account.token || undefined,
            signal
          );
          break;
        case 'tempmail':
        case '1secmail':
        default:
          email = await tempMailService.readEmail(
            Number(emailId),
            account.login || account.username || '',
            account.domain,
            signal
          );
          break;
      }

      const safeEmail: Email = {
        ...email,
        subject: sanitizeEmailSubject(email.subject || '(No Subject)'),
        from: sanitizeEmailSubject(email.from || 'Unknown Sender'),
      };

      const inbox = await storageService.get('inbox');
      if (!Array.isArray(inbox)) {
        log.warn('Corrupted inbox found during readEmail, resetting');
        await storageService.set('inbox', [safeEmail]);
        return safeEmail;
      }

      const updatedInbox = inbox.map((e) => (String(e.id) === String(emailId) ? safeEmail : e));
      await storageService.set('inbox', updatedInbox);

      log.debug('Email read', { id: emailId });
      return safeEmail;
    } catch (error) {
      log.error('Failed to read email', error);
      throw error;
    }
  }

  /**
   * Get cached inbox
   */
  async getCachedInbox(): Promise<Email[]> {
    return (await storageService.get('inbox')) || [];
  }

  /**
   * Get available domains for a service
   */
  async getDomains(service: EmailService = 'tempmail', signal?: AbortSignal): Promise<string[]> {
    try {
      switch (service) {
        case 'maildrop':
          return ['maildrop.cc'];
        case 'guerrilla':
          return ['guerrillamail.com'];
        case 'mailgw':
          return mailGwService.getDomains(signal);
        case 'mailtm':
          return mailTmService.getDomains(signal);
        case 'tempmail':
        case '1secmail':
          return tempMailService.getDomains(signal);
        default:
          return ['unknown.com'];
      }
    } catch (error) {
      log.error('Failed to get domains', error);
      return [];
    }
  }

  /**
   * Get email history
   */
  async getHistory() {
    return (await storageService.get('emailHistory')) || [];
  }

  /**
   * Get health status for all providers
   */
  getProviderHealth() {
    return this.healthManager.getHealthReport();
  }

  /**
   * Clear email data
   */
  async clearData(): Promise<void> {
    await storageService.remove('currentEmail');
    await storageService.set('inbox', []);
    log.info('Email data cleared');
  }
}

// Export singleton instance (uses default providerHealth)
export const emailService = new EmailServiceAggregator();

// Export class for dependency injection scenarios
export { EmailServiceAggregator };

// Re-export individual services
export { tempMailService } from './tempMailService';
export { mailTmService } from './mailTmService';
export { mailGwService } from './mailGwService';
export { guerrillaMailService } from './guerrillaMailService';
export { maildropService } from './maildropService';
export { customDomainService };
export { providerHealth } from './providerHealthManager';
