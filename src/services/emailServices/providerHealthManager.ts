// Provider Health Manager - Circuit Breaker + Exponential Backoff
// Tracks provider health and intelligently routes email generation requests
// REFACTORED: Uses event emitter pattern to break circular dependencies

import { EmailService } from '../../types';
import { createLogger } from '../../utils/logger';
import {
  ProviderHealthStatus,
  ProviderHealthConfig,
  ProviderHealthEvent,
  ProviderHealthEventListener,
  IProviderHealthManager,
} from '../types/email-services.types';

const log = createLogger('ProviderHealth');

// Type alias for config (interface removed to avoid empty interface lint error)
type HealthConfig = ProviderHealthConfig;

const DEFAULT_CONFIG: HealthConfig = {
  circuitBreakerThreshold: 3, // 3 consecutive failures = circuit open
  circuitResetTimeout: 2 * 60 * 1000, // 2 minutes before trying again (faster recovery)
  maxCooldown: 30 * 60 * 1000, // Max 30 minutes cooldown
  baseCooldown: 15 * 1000, // Start with 15 second cooldown
  successRateDecay: 0.9, // Weight factor for rolling average
  responseTimeDecay: 0.8, // Weight factor for response time avg
  degradedThreshold: 0.6, // Success rate below this = degraded (H1)
};

/**
 * ProviderHealthManager - Manages email provider health with circuit breaker pattern
 *
 * ARCHITECTURE FIX: Implements IProviderHealthManager interface for dependency injection
 * Uses event emitter pattern for decoupled health status notifications
 */
class ProviderHealthManager implements IProviderHealthManager {
  private health: Map<EmailService, ProviderHealthStatus> = new Map();
  private config: HealthConfig = DEFAULT_CONFIG;
  private listeners: Set<ProviderHealthEventListener> = new Set();

  // Priority order for providers (best first)
  private readonly providerPriority: EmailService[] = [
    'mailtm', // Real API, excellent anti-block reliability
    'tmailor', // 500+ domains, very reliable fallback
    'maildrop', // Free GraphQL, reliable
    'guerrilla', // Long-standing service
    'tempmail', // 1secmail.com
    '1secmail', // Legacy tempmail
    'dropmail', // Dropmail service
    'templol', // TempMail.lol
    'custom', // Custom domain
  ];

  constructor() {
    this.initializeProviders();
  }

  /**
   * P1.11: Explicit initialization to ensure state is loaded before use.
   * Called by the aggregator during its own loadHealthState.
   */
  public async init(): Promise<void> {
    await this.loadState();
  }

  // SECURITY/RELIABILITY FIX: Persist Provider Health across Service Worker wakes
  private async loadState(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const data = await chrome.storage.session.get('phm_health');
        if (data.phm_health) {
          const parsed = JSON.parse(data.phm_health) as [EmailService, ProviderHealthStatus][];
          for (const [provider, status] of parsed) {
            this.health.set(provider, status);
          }
        }
      } catch (error) {
        log.warn('Failed to load provider health state', error);
      }
    }
  }

  private saveState(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const serialized = JSON.stringify(Array.from(this.health.entries()));
        chrome.storage.session.set({ phm_health: serialized }).catch((e) => console.debug('PHM session save failed', e));
      } catch (error) {
        log.warn('Failed to save provider health state', error);
      }
    }
  }

  private initializeProviders(): void {
    for (const provider of this.providerPriority) {
      this.health.set(provider, this.createDefaultHealth(provider));
    }
  }

  private createDefaultHealth(name: EmailService): ProviderHealthStatus {
    return {
      name,
      successRate: 1.0, // Assume healthy initially
      consecutiveFailures: 0,
      lastSuccess: Date.now(),
      lastFailure: 0,
      lastError: null,
      avgResponseTime: 500, // Assume 500ms initially
      circuitOpen: false,
      cooldownUntil: 0,
      totalRequests: 0,
      totalSuccesses: 0,
    };
  }

  /**
   * Emit health event to all listeners
   */
  private emitEvent(event: ProviderHealthEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        log.error('Error in health event listener', error);
      }
    });
  }

  /**
   * Subscribe to health events
   * Returns unsubscribe function
   */
  subscribe(listener: ProviderHealthEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Record a successful request
   */
  recordSuccess(provider: EmailService, responseTimeMs: number): void {
    const health = this.getOrCreate(provider);

    health.totalRequests++;
    health.totalSuccesses++;
    health.consecutiveFailures = 0;
    health.lastSuccess = Date.now();
    health.circuitOpen = false;
    health.cooldownUntil = 0;
    health.lastError = null;

    // Rolling average success rate
    health.successRate =
      health.successRate * this.config.successRateDecay + (1 - this.config.successRateDecay);

    // Rolling average response time
    health.avgResponseTime =
      health.avgResponseTime * this.config.responseTimeDecay +
      responseTimeMs * (1 - this.config.responseTimeDecay);

    log.debug(`✅ ${provider} success`, {
      successRate: health.successRate.toFixed(2),
      responseTime: responseTimeMs,
    });

    // Emit healthy event if success rate is high
    if (health.successRate > 0.8) {
      this.emitEvent({
        type: 'provider:healthy',
        provider,
        timestamp: Date.now(),
        data: { successRate: health.successRate },
      });
    }

    this.saveState();
  }

  /**
   * Record a failed request
   */
  recordFailure(provider: EmailService, error: Error): void {
    const health = this.getOrCreate(provider);

    health.totalRequests++;
    health.consecutiveFailures++;
    health.lastFailure = Date.now();
    health.lastError = error.message;

    // Decay success rate
    health.successRate = health.successRate * this.config.successRateDecay;

    // Emit degraded event
    this.emitEvent({
      type: 'provider:degraded',
      provider,
      timestamp: Date.now(),
      data: {
        successRate: health.successRate,
        consecutiveFailures: health.consecutiveFailures,
        error: error.message,
      },
    });

    // Check if we should open the circuit
    if (health.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.openCircuit(provider, health);
    }

    log.warn(`❌ ${provider} failure`, {
      consecutiveFailures: health.consecutiveFailures,
      successRate: health.successRate.toFixed(2),
      error: error.message.slice(0, 100),
    });

    this.saveState();
  }

  /**
   * Open circuit breaker for a provider
   * BUG FIX: Uses crypto-based random for jitter instead of Math.random()
   */
  private openCircuit(provider: EmailService, health: ProviderHealthStatus): void {
    health.circuitOpen = true;

    // Exponential backoff: 30s, 60s, 120s, 240s, ... up to 30 min
    const backoffMultiplier = Math.pow(2, Math.min(health.consecutiveFailures - 1, 6));
    const cooldownDuration = Math.min(
      this.config.baseCooldown * backoffMultiplier,
      this.config.maxCooldown
    );

    // BUG FIX: Use crypto-based random for jitter (±20%) instead of Math.random()
    // This provides better distribution and is suitable for security-sensitive operations
    const jitter = this.getCryptoRandomJitter(cooldownDuration, 0.2);
    health.cooldownUntil = Date.now() + cooldownDuration + jitter;

    log.warn(`🔌 Circuit OPEN for ${provider}`, {
      cooldownSeconds: Math.round((cooldownDuration + jitter) / 1000),
      failures: health.consecutiveFailures,
    });

    // Emit circuit-open event
    this.emitEvent({
      type: 'provider:circuit-open',
      provider,
      timestamp: Date.now(),
      data: {
        cooldownUntil: health.cooldownUntil,
        consecutiveFailures: health.consecutiveFailures,
      },
    });

    this.saveState();
  }

  /**
   * Generate cryptographically secure random jitter
   * BUG FIX: Replaces Math.random() with crypto.getRandomValues for better distribution
   */
  private getCryptoRandomJitter(baseValue: number, percentage: number): number {
    // Generate random value between 0 and 1 using crypto API
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    // Convert to 0-1 range (Uint32 max is 4294967295)
    const randomValue = array[0] / 4294967295;
    // Apply percentage and center around 0 (range: -percentage to +percentage)
    return baseValue * percentage * (2 * randomValue - 1);
  }

  /**
   * Check if a provider is available (circuit closed and not in cooldown)
   */
  isAvailable(provider: EmailService): boolean {
    const health = this.health.get(provider);
    if (!health) {
      return true;
    } // Unknown providers are assumed available

    // Check if cooldown has expired
    if (health.cooldownUntil > 0 && Date.now() > health.cooldownUntil) {
      // Cooldown expired, try half-open state
      health.circuitOpen = false;
      health.cooldownUntil = 0;
      log.info(`🔄 ${provider} cooldown expired, attempting recovery`);

      // Emit circuit-close event
      this.emitEvent({
        type: 'provider:circuit-close',
        provider,
        timestamp: Date.now(),
      });
      this.saveState();
    }

    return !health.circuitOpen && health.cooldownUntil <= Date.now();
  }

  /**
   * Calculate health score for a provider (higher = better)
   */
  calculateScore(provider: EmailService): number {
    const health = this.health.get(provider);
    if (!health) {
      return 50;
    } // Unknown providers get neutral score

    if (!this.isAvailable(provider)) {
      return -100;
    } // Not available

    let score = 0;

    // Success rate contribution (0-40 points)
    score += health.successRate * 40;

    // Recency bonus (0-20 points) - prefer recently successful
    const timeSinceSuccess = Date.now() - health.lastSuccess;
    const recencyBonus = Math.max(0, 20 - timeSinceSuccess / (60 * 1000)); // -1 point per minute
    score += recencyBonus;

    // Response time penalty (0-20 points penalty)
    const responseTimePenalty = Math.min(20, health.avgResponseTime / 100);
    score -= responseTimePenalty;

    // Priority bonus based on predefined order (0-10 points)
    const priorityIndex = this.providerPriority.indexOf(provider);
    if (priorityIndex >= 0) {
      score += (this.providerPriority.length - priorityIndex) * 2;
    }

    // Failure penalty (exponential)
    score -= Math.pow(1.5, health.consecutiveFailures) * 5;

    // Degraded penalty (H1)
    if (health.successRate < (this.config as any).degradedThreshold) {
      score -= 30; // Significant penalty for degraded providers
    }

    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Get the best available provider
   */
  getBestProvider(exclude?: EmailService[]): EmailService | null {
    const excludeSet = new Set(exclude || []);
    const candidates: Array<{ provider: EmailService; score: number }> = [];

    for (const provider of this.providerPriority) {
      if (excludeSet.has(provider)) {
        continue;
      }
      if (!this.isAvailable(provider)) {
        continue;
      }

      candidates.push({
        provider,
        score: this.calculateScore(provider),
      });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      log.error('🚨 No providers available!');
      return null;
    }

    const best = candidates[0];
    log.debug(`📊 Best provider: ${best.provider} (score: ${best.score.toFixed(1)})`);

    return best.provider;
  }

  /**
   * Get all provider health statuses
   */
  getHealthReport(): ProviderHealthStatus[] {
    return Array.from(this.health.values());
  }

  /**
   * Calculate exponential backoff delay for retries
   * Fast flat failover delay for responsive fallback
   */
  getRetryDelay(attempt: number): number {
    return 500; // Flat 500ms retry delay for fast failover
  }

  /**
   * Force reset a provider (for manual recovery)
   */
  resetProvider(provider: EmailService): void {
    this.health.set(provider, this.createDefaultHealth(provider));
    log.info(`🔧 ${provider} manually reset`);

    this.emitEvent({
      type: 'provider:healthy',
      provider,
      timestamp: Date.now(),
    });
    this.saveState();
  }

  /**
   * Reset all providers
   */
  resetAll(): void {
    this.initializeProviders();
    this.saveState();
    log.info('🔧 All providers reset');
  }

  private getOrCreate(provider: EmailService): ProviderHealthStatus {
    let health = this.health.get(provider);
    if (!health) {
      health = this.createDefaultHealth(provider);
      this.health.set(provider, health);
    }
    return health;
  }
}

// Export singleton instance
export const providerHealth = new ProviderHealthManager();

// Export the class for dependency injection scenarios
export { ProviderHealthManager };
