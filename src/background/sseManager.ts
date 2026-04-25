/**
 * SSE (Server-Sent Events) Manager for Mail.tm
 *
 * Connects to Mail.tm's Mercure hub for real-time email push notifications.
 * Eliminates polling for Mail.tm accounts — emails arrive instantly (0-1s).
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Service Worker                                             │
 * │  ┌───────────────────────────────────────────────────────┐  │
 * │  │  SSEManager                                           │  │
 * │  │  ┌─────────────────────────────────────────────────┐  │  │
 * │  │  │  fetch + ReadableStream → mercure.mail.tm       │  │  │
 * │  │  │  Topic: /accounts/{id}                          │  │  │
 * │  │  │  Auth: Bearer <JWT> (via fetch header)          │  │  │
 * │  │  │  On event → trigger inbox check → process       │  │  │
 * │  │  └─────────────────────────────────────────────────┘  │  │
 * │  └───────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Fallback: If SSE fails, automatically switches to polling.
 */

import { mailTmService, emailService } from '../services/emailServices';
import { EmailAccount } from '../types';
import { diag } from '../utils/diagnosticLogger';
import { createLogger } from '../utils/logger';

const log = createLogger('SSEManager');

// Mercure hub URL for Mail.tm
const MERCURE_HUB_URL = 'https://mercure.mail.tm/.well-known/mercure';

// Reconnection settings
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_MULTIPLIER = 2;
const MAX_RECONNECT_ATTEMPTS = 5;

// Circuit breaker for persistent server errors (502/503/504)
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Connection health check
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const MAX_SILENT_MS = 90_000;

// Abort controller for closing stream
let currentAbortController: AbortController | null = null;

interface SSEState {
  connected: boolean;
  accountId: string | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastEventTime: number;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  totalEventsReceived: number;
  totalReconnects: number;
  streamReader: ReadableStreamDefaultReader<Uint8Array> | null;
  // Circuit breaker state
  consecutiveServerErrors: number;
  circuitBreakerUntil: number;
  hasNotifiedOutage: boolean;
}

class SSEManager {
  private state: SSEState = {
    connected: false,
    accountId: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    lastEventTime: 0,
    healthCheckTimer: null,
    totalEventsReceived: 0,
    totalReconnects: 0,
    streamReader: null,
    consecutiveServerErrors: 0,
    circuitBreakerUntil: 0,
    hasNotifiedOutage: false,
  };

  private onEmailReceived: ((accountId: string) => void) | null = null;

  /**
   * Set callback for when a new email arrives via SSE
   */
  setOnEmailReceived(callback: (accountId: string) => void): void {
    this.onEmailReceived = callback;
  }

  /**
   * Start SSE connection for a Mail.tm account
   */
  async connect(account: EmailAccount): Promise<boolean> {
    const flowId = diag.startFlow(
      'sse',
      'SSE Connect',
      `Account: ${account.id?.substring(0, 8)}...`
    );

    if (account.service !== 'mailtm') {
      diag.step(flowId, 'sse', 'Service check', `Not mailtm: ${account.service}`);
      log.debug('SSE only supported for Mail.tm', { service: account.service });
      diag.endFlow(flowId, 'sse', 'SSE Connect', false, `Unsupported service: ${account.service}`);
      return false;
    }

    if (!account.id || account.id === 'undefined' || account.id === 'null') {
      diag.log(
        'error',
        'sse',
        'Invalid account ID',
        `ID: ${account.id}`,
        { accountId: account.id, fullEmail: account.fullEmail },
        flowId,
        1
      );
      log.error('Cannot connect to SSE: account.id is missing or invalid', {
        accountId: account.id,
        fullEmail: account.fullEmail,
        hasToken: Boolean(account.token),
      });
      diag.endFlow(flowId, 'sse', 'SSE Connect', false, 'Account ID missing or invalid');
      return false;
    }

    if (this.state.connected && this.state.accountId === account.id) {
      diag.step(flowId, 'sse', 'Already connected', `Account: ${account.id}`);
      log.debug('Already connected to SSE for this account');
      diag.endFlow(flowId, 'sse', 'SSE Connect', true, 'Already connected');
      return true;
    }

    // Disconnect existing connection
    diag.step(flowId, 'sse', 'Disconnecting existing', '');
    this.disconnect();

    this.state.accountId = account.id;

    try {
      // Ensure we have a valid token
      diag.step(flowId, 'sse', 'Ensuring authenticated', '');
      await mailTmService.ensureAuthenticated?.();

      const token = mailTmService.getToken();
      if (!token) {
        diag.log('error', 'sse', 'No auth token', 'Falling back to polling', undefined, flowId, 2);
        log.error('No auth token available for SSE — falling back to polling');
        diag.endFlow(flowId, 'sse', 'SSE Connect', false, 'No auth token');
        return false;
      }

      // Build SSE URL with topic subscription
      const topic = `/accounts/${account.id}`;
      const sseUrl = `${MERCURE_HUB_URL}?topic=${encodeURIComponent(topic)}`;
      diag.step(flowId, 'sse', 'Connecting', `Topic: ${topic}`, { url: sseUrl });
      log.info('🔌 Connecting to Mail.tm SSE stream', { accountId: account.id, topic });

      await this.connectWithAuth(sseUrl, token);

      diag.endFlow(flowId, 'sse', 'SSE Connect', true, 'Connected successfully');
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      diag.log('error', 'sse', 'SSE connection failed', errMsg, { error }, flowId, 4);
      log.error('Failed to connect to SSE', error);
      this.scheduleReconnect(account);
      diag.endFlow(flowId, 'sse', 'SSE Connect', false, `Connection failed: ${errMsg}`);
      return false;
    }
  }

  /**
   * Connect to SSE with authentication using fetch + ReadableStream
   * (EventSource doesn't support custom headers)
   */
  private async connectWithAuth(url: string, token: string): Promise<void> {
    // Cancel any existing stream
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: currentAbortController.signal,
      });

      if (!response.ok) {
        const status = response.status;
        diag.log('error', 'sse', `SSE HTTP ${status}`, response.statusText, {
          status,
          statusText: response.statusText,
        });
        // Detect server errors that indicate infrastructure issues
        const isServerError = status >= 500 && status <= 599;
        if (isServerError) {
          this.state.consecutiveServerErrors++;
          diag.state(
            'sse',
            'Server error count',
            `${this.state.consecutiveServerErrors} consecutive errors`,
            { consecutiveErrors: this.state.consecutiveServerErrors }
          );
          log.warn(
            `SSE server error ${status} (consecutive: ${this.state.consecutiveServerErrors})`
          );

          // Activate circuit breaker after threshold
          if (this.state.consecutiveServerErrors >= CIRCUIT_BREAKER_THRESHOLD) {
            this.state.circuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
            this.state.consecutiveServerErrors = 0;
            this.state.hasNotifiedOutage = false;
            diag.state(
              'sse',
              'Circuit breaker ACTIVATED',
              `Cooldown: ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000}min`
            );
            log.error(
              `SSE circuit breaker activated — Mercure hub appears down. Cooldown: ${CIRCUIT_BREAKER_COOLDOWN_MS / 60000}min`
            );
          }
        } else {
          // Non-server errors reset the counter
          this.state.consecutiveServerErrors = 0;
        }
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        diag.log('error', 'sse', 'SSE no body', 'Response has no body stream');
        throw new Error('SSE response has no body');
      }

      this.state.connected = true;
      this.state.reconnectAttempts = 0;
      this.state.lastEventTime = Date.now();
      this.state.consecutiveServerErrors = 0;
      diag.state('sse', 'SSE Connected', 'Real-time email push active', {
        accountId: this.state.accountId,
      });
      log.info('✅ SSE connected — real-time email push active');
      this.startHealthCheck();

      // Trigger immediate inbox check to catch any emails that arrived during outage
      emailService
        .getCurrentEmail()
        .then((account) => {
          if (account && account.service === 'mailtm') {
            log.info('📬 Running immediate inbox check after SSE reconnection');
            emailService.checkInbox(account).catch(() => {});
          }
        })
        .catch(() => {});

      // Read the stream
      const reader = response.body.getReader();
      this.state.streamReader = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (!currentAbortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          log.info('SSE stream ended');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          this.processSSELine(line.trim());
        }
      }

      // Stream closed, attempt reconnection
      this.state.connected = false;
      this.state.streamReader = null;
      log.warn('SSE stream closed, reconnecting...');

      const currentEmail = await emailService.getCurrentEmail();
      if (currentEmail && currentEmail.service === 'mailtm' && currentEmail.id) {
        this.scheduleReconnect(currentEmail);
      } else {
        log.warn('Cannot reconnect after stream close — account invalid or missing id', {
          service: currentEmail?.service,
          hasId: Boolean(currentEmail?.id),
        });
      }
    } catch (error) {
      this.state.connected = false;
      this.state.streamReader = null;

      if ((error as Error).name === 'AbortError') {
        log.debug('SSE connection aborted (intentional)');
        return;
      }

      log.error('SSE connection error', error);

      // Check if circuit breaker is active
      if (this.state.circuitBreakerUntil > Date.now()) {
        const remaining = Math.round((this.state.circuitBreakerUntil - Date.now()) / 60000);
        if (!this.state.hasNotifiedOutage) {
          this.state.hasNotifiedOutage = true;
          log.warn(
            `⚠️ Mail.tm real-time notifications unavailable (Mercure hub down). Using polling fallback for ~${remaining}min.`
          );
        } else {
          log.debug(`Circuit breaker active — skipping reconnect (${remaining}min remaining)`);
        }
        return; // Don't schedule reconnect while circuit breaker is active
      }

      // Reset circuit breaker on successful connection after cooldown
      if (this.state.circuitBreakerUntil > 0 && Date.now() > this.state.circuitBreakerUntil) {
        this.state.circuitBreakerUntil = 0;
        this.state.consecutiveServerErrors = 0;
        this.state.hasNotifiedOutage = false;
        log.info('Circuit breaker reset — attempting SSE reconnection');
      }

      const currentEmail = await emailService.getCurrentEmail();
      if (currentEmail && currentEmail.service === 'mailtm' && currentEmail.id) {
        this.scheduleReconnect(currentEmail);
      } else {
        log.warn('Cannot schedule SSE reconnect — account invalid or missing id', {
          service: currentEmail?.service,
          hasId: Boolean(currentEmail?.id),
          accountId: currentEmail?.id,
        });
      }
    }
  }

  /**
   * Process a single SSE line
   */
  private processSSELine(line: string): void {
    if (!line || line.startsWith(':')) {
      return; // Skip comments and empty lines
    }

    if (line.startsWith('data:')) {
      try {
        const data = JSON.parse(line.substring(5).trim());
        this.handleSSEEvent(data);
      } catch {
        log.debug('Failed to parse SSE data', { line: line.substring(0, 100) });
      }
    }
  }

  /**
   * Handle an SSE event (new email notification)
   * Mercure sends the full Account resource with updated "used" property
   */
  private handleSSEEvent(data: unknown): void {
    this.state.lastEventTime = Date.now();
    this.state.totalEventsReceived++;

    log.debug('📨 SSE event received', {
      accountId: this.state.accountId,
      data: JSON.stringify(data).substring(0, 200),
    });

    // Trigger inbox check to fetch the new email
    if (this.onEmailReceived && this.state.accountId) {
      this.onEmailReceived(this.state.accountId);
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(account: EmailAccount): void {
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
    }

    if (this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      diag.log(
        'error',
        'sse',
        'SSE max reconnects reached',
        `Falling back to polling after ${MAX_RECONNECT_ATTEMPTS} attempts`
      );
      log.error(
        `SSE max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — falling back to polling`
      );
      this.state.connected = false;
      return;
    }

    this.state.totalReconnects++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(RECONNECT_MULTIPLIER, this.state.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    );

    this.state.reconnectAttempts++;
    diag.state(
      'sse',
      'SSE reconnect scheduled',
      `Attempt ${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
      { delay, attempt: this.state.reconnectAttempts }
    );
    log.info(
      `🔄 SSE reconnect scheduled in ${delay}ms (attempt ${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    this.state.reconnectTimer = setTimeout(async () => {
      try {
        // Refresh token before reconnecting to avoid 401 on stale tokens
        if (account.service === 'mailtm' && account.fullEmail && account.password) {
          try {
            await mailTmService.authenticate(account.fullEmail, account.password);
            const freshToken = mailTmService.getToken();
            if (freshToken) {
              account.token = freshToken;
            }
          } catch (e) {
            log.warn('SSE reconnect: token refresh failed, using existing token', e);
          }
        }
        await this.connect(account);
      } catch (e) {
        log.error('SSE reconnect failed', e);
      }
    }, delay);
  }

  /**
   * Start health check to detect silent disconnections
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.state.healthCheckTimer = setInterval(() => {
      const silentTime = Date.now() - this.state.lastEventTime;
      if (silentTime > MAX_SILENT_MS && this.state.connected) {
        log.warn('SSE silent for too long, reconnecting...', { silentTime });
        this.disconnect();

        emailService
          .getCurrentEmail()
          .then((account) => {
            if (account && account.service === 'mailtm' && account.id) {
              this.connect(account).catch((e) => log.error('SSE health reconnect failed', e));
            } else {
              log.warn('Cannot health-reconnect SSE — account invalid or missing id', {
                service: account?.service,
                hasId: Boolean(account?.id),
              });
            }
          })
          .catch(() => {});
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Stop health check
   */
  private stopHealthCheck(): void {
    if (this.state.healthCheckTimer) {
      clearInterval(this.state.healthCheckTimer);
      this.state.healthCheckTimer = null;
    }
  }

  /**
   * Disconnect SSE
   */
  disconnect(): void {
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }

    this.stopHealthCheck();

    // Abort the fetch stream
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    // Close stream reader
    if (this.state.streamReader) {
      this.state.streamReader.releaseLock();
      this.state.streamReader = null;
    }

    this.state.connected = false;
    this.state.accountId = null;
    this.state.reconnectAttempts = 0;

    log.info('🔌 SSE disconnected');
  }

  /**
   * Check if SSE circuit breaker is active (Mercure hub down)
   */
  isCircuitBreakerActive(): boolean {
    return this.state.circuitBreakerUntil > Date.now();
  }

  /**
   * Get time remaining until circuit breaker cooldown expires (ms)
   */
  getCircuitBreakerRemainingMs(): number {
    const remaining = this.state.circuitBreakerUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Check if SSE is active and connected
   */
  isConnected(): boolean {
    return this.state.connected;
  }

  /**
   * Get SSE metrics for debugging
   */
  getMetrics(): object {
    return {
      connected: this.state.connected,
      accountId: this.state.accountId,
      reconnectAttempts: this.state.reconnectAttempts,
      totalEventsReceived: this.state.totalEventsReceived,
      totalReconnects: this.state.totalReconnects,
      lastEventTime: this.state.lastEventTime,
      circuitBreakerActive: this.state.circuitBreakerUntil > Date.now(),
      consecutiveServerErrors: this.state.consecutiveServerErrors,
    };
  }

  /**
   * Reset state (called on email session change)
   */
  reset(): void {
    this.disconnect();
    this.state.totalEventsReceived = 0;
    this.state.totalReconnects = 0;
    this.state.consecutiveServerErrors = 0;
    this.state.circuitBreakerUntil = 0;
    this.state.hasNotifiedOutage = false;
  }
}

// Export singleton
export const sseManager = new SSEManager();
