// ═══════════════════════════════════════════════════════════════════════
//  EMAIL SERVICES TYPES
//  Extracted to break circular dependencies between emailServices and providerHealthManager
// ═══════════════════════════════════════════════════════════════════════

import type { EmailService } from '../../types';

/**
 * Provider health status tracking interface
 * Used by ProviderHealthManager to track email provider health
 */
export interface ProviderHealthStatus {
    name: EmailService;
    successRate: number;          // 0-1 rolling success rate
    consecutiveFailures: number;  // Count of failures in a row
    lastSuccess: number;          // Timestamp of last success
    lastFailure: number;          // Timestamp of last failure
    lastError: string | null;     // Last error message
    avgResponseTime: number;      // Rolling average response time (ms)
    circuitOpen: boolean;         // True = provider is "broken", skip it
    cooldownUntil: number;        // Skip until this timestamp
    totalRequests: number;        // Total requests made
    totalSuccesses: number;       // Total successful requests
}

/**
 * Configuration for provider health management
 */
export interface ProviderHealthConfig {
    circuitBreakerThreshold: number;    // Failures before opening circuit
    circuitResetTimeout: number;        // Ms before attempting circuit close
    maxCooldown: number;                // Max cooldown duration (ms)
    baseCooldown: number;               // Initial cooldown duration (ms)
    successRateDecay: number;           // How fast success rate decays (0-1)
    responseTimeDecay: number;          // How fast avg response time decays (0-1)
}

/**
 * Health report for a single provider
 */
export interface ProviderHealthReport {
    provider: EmailService;
    isAvailable: boolean;
    healthScore: number;
    successRate: number;
    consecutiveFailures: number;
    avgResponseTime: number;
    lastError: string | null;
}

/**
 * Event types for provider health status changes
 * Used for event emitter pattern to decouple health monitoring from email services
 */
export type ProviderHealthEventType = 
    | 'provider:healthy'
    | 'provider:degraded'
    | 'provider:unavailable'
    | 'provider:circuit-open'
    | 'provider:circuit-close'
    | 'provider:cooldown-expired';

export interface ProviderHealthEvent {
    type: ProviderHealthEventType;
    provider: EmailService;
    timestamp: number;
    data?: {
        successRate?: number;
        consecutiveFailures?: number;
        cooldownUntil?: number;
        error?: string;
    };
}

/**
 * Listener callback for health events
 */
export type ProviderHealthEventListener = (event: ProviderHealthEvent) => void;

/**
 * Abstract interface for provider health management
 * Allows dependency injection without circular imports
 */
export interface IProviderHealthManager {
    /** Record a successful request */
    recordSuccess(provider: EmailService, responseTimeMs: number): void;
    
    /** Record a failed request */
    recordFailure(provider: EmailService, error: Error): void;
    
    /** Check if a provider is available */
    isAvailable(provider: EmailService): boolean;
    
    /** Get the best available provider */
    getBestProvider(exclude?: EmailService[]): EmailService | null;
    
    /** Get all provider health statuses */
    getHealthReport(): ProviderHealthStatus[];
    
    /** Calculate retry delay with exponential backoff */
    getRetryDelay(attempt: number): number;
    
    /** Force reset a provider */
    resetProvider(provider: EmailService): void;
    
    /** Reset all providers */
    resetAll(): void;
    
    /** Subscribe to health events */
    subscribe(listener: ProviderHealthEventListener): () => void;
}
