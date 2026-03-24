import React from 'react';

/**
 * GhostFill Feature Flags System
 *
 * Provides runtime feature flag control for gradual rollout of
 * the new architecture during the refactoring process.
 *
 * @module utils/featureFlags
 */

import { createLogger } from './logger';

const log = createLogger('FeatureFlags');

/**
 * Feature flag definitions with default values
 */
export interface FeatureFlags {
  // Service Layer Flags
  /** Enable new service layer architecture */
  NEW_SERVICE_LAYER: boolean;
  /** Enable new email provider implementations */
  NEW_EMAIL_PROVIDERS: boolean;

  // Detection Layer Flags
  /** Enable new detection engine */
  NEW_DETECTION_ENGINE: boolean;
  /** Enable new OTP extractor */
  NEW_OTP_EXTRACTOR: boolean;
  /** Enable new link extractor */
  NEW_LINK_EXTRACTOR: boolean;

  // UI Layer Flags
  /** Enable new component library */
  NEW_COMPONENT_LIBRARY: boolean;
  /** Enable new App context */
  NEW_APP_CONTEXT: boolean;

  // Background Layer Flags
  /** Enable new state management */
  NEW_STATE_MANAGEMENT: boolean;
  /** Enable session storage for state */
  NEW_SESSION_STORAGE: boolean;

  // A/B Testing Flags
  /** Percentage of users for A/B test (0-100) */
  AB_TEST_PERCENTAGE: number;
  /** Enable analytics tracking */
  ENABLE_ANALYTICS: boolean;
}

/**
 * Default flag values - all new features disabled by default
 */
export const DEFAULT_FLAGS: FeatureFlags = {
  NEW_SERVICE_LAYER: false,
  NEW_EMAIL_PROVIDERS: false,
  NEW_DETECTION_ENGINE: false,
  NEW_OTP_EXTRACTOR: false,
  NEW_LINK_EXTRACTOR: false,
  NEW_COMPONENT_LIBRARY: false,
  NEW_APP_CONTEXT: false,
  NEW_STATE_MANAGEMENT: false,
  NEW_SESSION_STORAGE: false,
  AB_TEST_PERCENTAGE: 0,
  ENABLE_ANALYTICS: false,
};

/**
 * Feature flag configuration for different environments
 */
export const ENV_CONFIGS: Record<string, Partial<FeatureFlags>> = {
  development: {
    NEW_SERVICE_LAYER: true,
    NEW_EMAIL_PROVIDERS: true,
    ENABLE_ANALYTICS: false,
  },
  staging: {
    NEW_SERVICE_LAYER: true,
    NEW_EMAIL_PROVIDERS: true,
    NEW_DETECTION_ENGINE: true,
    AB_TEST_PERCENTAGE: 50,
  },
  production: {
    ENABLE_ANALYTICS: true,
  },
};

/**
 * Feature Flag Manager Class
 *
 * Manages feature flag state with support for:
 * - Persistent storage
 * - URL parameter overrides (for testing)
 * - Environment-based defaults
 * - Listener notifications
 */
class FeatureFlagManager {
  private flags: FeatureFlags = { ...DEFAULT_FLAGS };
  private listeners: Set<() => void> = new Set();
  private initialized = false;

  private userHash: number | null = null;

  /**
   * Initialize feature flags from storage and URL params
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.debug('Already initialized');
      return;
    }

    // Start with defaults
    this.flags = { ...DEFAULT_FLAGS };

    // Apply environment-specific config
    const env = this.getEnvironment();
    const envConfig = ENV_CONFIGS[env];
    if (envConfig) {
      this.flags = { ...this.flags, ...envConfig };
      log.info(`Applied ${env} environment config`);
    }

    // Load from storage (for A/B testing persistence)
    try {
      const stored = await chrome.storage.local.get(['featureFlags', 'abUserHash']);
      
      if (stored.abUserHash !== undefined) {
        this.userHash = stored.abUserHash;
      } else {
        this.userHash = Math.abs(Math.floor(Math.random() * 1000));
        await chrome.storage.local.set({ abUserHash: this.userHash });
      }

      if (stored.featureFlags) {
        this.flags = { ...this.flags, ...stored.featureFlags };
        log.info('Loaded feature flags from storage');
      }
    } catch (error) {
      this.userHash = Math.abs(Math.floor(Math.random() * 1000));
      log.warn('Failed to load feature flags from storage', error);
    }

    // Override with URL params (for dev testing)
    // Format: ?flags={"NEW_SERVICE_LAYER":true,"AB_TEST_PERCENTAGE":25}
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const flagParam = urlParams.get('flags');
      if (flagParam) {
        try {
          const overrides = JSON.parse(flagParam);
          this.flags = { ...this.flags, ...overrides };
          log.info('Applied URL flag overrides', overrides);
        } catch (error) {
          log.warn('Failed to parse URL flags', error);
        }
      }
    }

    this.initialized = true;
    this.notifyListeners();
    log.info('Feature flags initialized', this.dump());
  }

  /**
   * Check if a feature flag is enabled
   */
  isEnabled(flag: keyof FeatureFlags): boolean {
    const value = this.flags[flag];

    // Handle percentage-based flags
    if (flag === 'AB_TEST_PERCENTAGE') {
      const hash = this.getUserHash();
      return hash % 100 < (value as number);
    }

    return (value as boolean) ?? false;
  }

  /**
   * Get the value of a feature flag
   */
  getValue<K extends keyof FeatureFlags>(flag: K): FeatureFlags[K] {
    return this.flags[flag];
  }

  /**
   * Set a feature flag value
   */
  async setFlag<K extends keyof FeatureFlags>(flag: K, enabled: FeatureFlags[K]): Promise<void> {
    this.flags[flag] = enabled;
    await this.persist();
    this.notifyListeners();
    log.info(`Flag updated: ${flag} = ${enabled}`);
  }

  /**
   * Set multiple flags at once
   */
  async setFlags(updates: Partial<FeatureFlags>): Promise<void> {
    this.flags = { ...this.flags, ...updates };
    await this.persist();
    this.notifyListeners();
    log.info('Flags updated', updates);
  }

  /**
   * Reset all flags to defaults
   */
  async reset(): Promise<void> {
    this.flags = { ...DEFAULT_FLAGS };
    await chrome.storage.local.remove('featureFlags');
    this.notifyListeners();
    log.info('Flags reset to defaults');
  }

  /**
   * Subscribe to flag changes
   * @returns Unsubscribe function
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get all flag values (for debugging)
   */
  dump(): Record<string, boolean | number> {
    return { ...this.flags };
  }

  /**
   * Get flags relevant for a specific layer
   */
  getLayerFlags(layer: 'service' | 'detection' | 'ui' | 'background'): Partial<FeatureFlags> {
    const layerFlags: Record<string, (keyof FeatureFlags)[]> = {
      service: ['NEW_SERVICE_LAYER', 'NEW_EMAIL_PROVIDERS'],
      detection: ['NEW_DETECTION_ENGINE', 'NEW_OTP_EXTRACTOR', 'NEW_LINK_EXTRACTOR'],
      ui: ['NEW_COMPONENT_LIBRARY', 'NEW_APP_CONTEXT'],
      background: ['NEW_STATE_MANAGEMENT', 'NEW_SESSION_STORAGE'],
    };

    const result: Partial<FeatureFlags> = {};
    for (const flag of layerFlags[layer]) {
      (result as Record<keyof FeatureFlags, FeatureFlags[keyof FeatureFlags]>)[flag] =
        this.flags[flag];
    }
    return result;
  }

  /**
   * Check if all flags for a layer are enabled
   */
  isLayerComplete(layer: 'service' | 'detection' | 'ui' | 'background'): boolean {
    const layerFlags = this.getLayerFlags(layer);
    return Object.values(layerFlags).every((v) => v === true);
  }

  private async persist(): Promise<void> {
    try {
      await chrome.storage.local.set({ featureFlags: this.flags });
    } catch (error) {
      log.warn('Failed to persist feature flags', error);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        log.error('Feature flag listener error', error);
      }
    });
  }

  private getEnvironment(): string {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
      return process.env.NODE_ENV;
    }
    // Default to production for extensions
    return 'production';
  }

  private getUserHash(): number {
    // SECURITY FIX: Uses generated stable random integer instead of universal extension ID
    return this.userHash !== null ? this.userHash : 500;
  }
}

// Singleton instance
export const featureFlags = new FeatureFlagManager();

/**
 * React Hook for using feature flags
 */
export function useFeatureFlag(flag: keyof FeatureFlags): boolean {
  const subscribe = React.useCallback(
    (callback: () => void) => featureFlags.subscribe(callback),
    []
  );
  const getSnapshot = React.useCallback(
    () => featureFlags.isEnabled(flag),
    [flag]
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Higher-Order Component for feature-gated components
 */
export function withFeatureFlag<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  flag: keyof FeatureFlags,
  FallbackComponent?: React.ComponentType<P>
): React.ComponentType<P> {
  return function FeatureFlaggedComponent(props: P) {
    const enabled = useFeatureFlag(flag);

    if (!enabled) {
      return FallbackComponent ? React.createElement(FallbackComponent, props) : null;
    }

    return React.createElement(WrappedComponent, props);
  };
}
