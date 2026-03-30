// Storage Types
// ═══════════════════════════════════════════════════════════════════
// SECURITY HARDENED: Session-based storage for sensitive data
// ═══════════════════════════════════════════════════════════════════

import { EmailAccount, EmailHistoryItem, Email, EmailService } from './email.types';
import { IdentityProfile } from './identity.types';

import { PasswordOptions, PasswordHistoryItem } from './password.types';

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Session-based storage for sensitive API keys
// API keys are NEVER persisted to disk, only stored in memory
// ═══════════════════════════════════════════════════════════════════

export interface SessionSecrets {
  /**
   * LLM API Key - stored in session only, cleared on extension unload
   * @security Never persisted to disk
   */
  llmApiKey?: string;

  /**
   * Custom domain API key - stored in session only
   * @security Never persisted to disk
   */
  customDomainKey?: string;

  /**
   * Session encryption key reference
   * @security Key material never leaves memory
   */
  encryptionKeyRef?: string;

  /**
   * Key rotation timestamp
   * @security Track when keys were last rotated
   */
  keyRotatedAt?: number;
}

export interface UserSettings {
  // Password settings
  passwordDefaults: PasswordOptions;

  // Email settings
  preferredEmailService:
    | '1secmail'
    | 'mailgw'
    | 'mailtm'
    | 'guerrilla'
    | 'tempmail'
    | 'maildrop'
    | 'custom';
  autoCheckInbox: boolean;
  checkIntervalSeconds: number;

  // UI settings
  darkMode: boolean | 'system';
  showFloatingButton: boolean;
  floatingButtonPosition: 'right' | 'left';

  // Behavior settings
  autoFillOTP: boolean;
  keyboardShortcuts: boolean;
  notifications: boolean;
  soundEnabled: boolean;
  autoConfirmLinks: boolean;

  // Privacy settings
  saveHistory: boolean;
  historyRetentionDays: number;
  clearOnClose: boolean;

  // Advanced settings
  debugMode: boolean;
  analyticsEnabled: boolean;

  // Custom Infrastructure
  // SECURITY FIX: API keys removed from persistent settings
  // Keys are now stored in session-only storage (chrome.storage.session)
  customDomain?: string;
  customDomainUrl?: string; // Endpoint URL (e.g. Cloudflare Worker)
  // customDomainKey is now in SessionSecrets (not persisted)

  // AI/LLM settings
  useLLMParser: boolean;
  llmModel?: string;
  // llmApiKey is now in SessionSecrets (not persisted)
}

export interface LastOTP {
  code: string;
  source: 'email' | 'sms' | 'manual';
  emailFrom?: string;
  emailSubject?: string;
  extractedAt: number;
  expiresAt?: number;
  usedAt?: number;
  confidence: number;
}

export interface BehaviorData {
  sitePreferences: Record<string, SitePreference>;
  usagePatterns: UsagePattern[];
  lastUpdated: number;
}

export interface SitePreference {
  domain: string;
  preferredEmailService?: string;
  preferredPasswordOptions?: Partial<PasswordOptions>;
  formAutoFillEnabled: boolean;
  lastVisited: number;
  visitCount: number;
}

export interface UsagePattern {
  action: string;
  timestamp: number;
  context?: string;
  duration?: number;
}

export interface StorageSchema {
  // Current state
  currentEmail: EmailAccount | null;
  currentIdentity: IdentityProfile | null;
  lastOTP: LastOTP | null;

  // History
  emailHistory: EmailHistoryItem[];
  passwordHistory: PasswordHistoryItem[];
  inbox: Email[];

  // Settings
  settings: UserSettings;

  // AI/Learning data
  behaviorData: BehaviorData;

  // Site context (for context-aware verification)
  // Maps tabId to SiteContext from siteContextService
  siteContexts: Record<
    number,
    {
      url: string;
      domain: string;
      tabId: number;
      expectedType: string;
      confidence: number;
      hasOTPField: boolean;
      capturedAt: number;
      expiresAt: number;
    }
  >;

  // Session data
  lastActiveTab: number;
  extensionVersion: string;
  installDate: number;
  lastUpdated: number;

  // Service Worker Boot State
  sw_boot_state?: {
    state: string;
    bootId: string;
    completedAt: number;
    servicesUp: number;
  };

  // Email service health state (persisted health check results)
  emailServiceHealth?: {
    timestamp: number;
    availableServices: EmailService[];
  };

  // Polling Manager cache to survive Service Worker unloads
  processedEmails?: Record<
    string,
    {
      id: string;
      processedAt: number;
      hadOTP: boolean;
      hadLink: boolean;
      ttlExpiresAt: number;
    }
  >;

  // Rate Limiting
  otpRateLimitTimestamps?: number[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  passwordDefaults: {
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false,
    excludeSimilar: false,
  },
  preferredEmailService: 'mailtm',
  autoCheckInbox: true,
  checkIntervalSeconds: 10,
  darkMode: 'system',
  showFloatingButton: true,
  floatingButtonPosition: 'right',
  autoFillOTP: true,
  keyboardShortcuts: true,
  notifications: true,
  soundEnabled: true,
  autoConfirmLinks: true, // Automatically open activation links in new tabs
  saveHistory: true,
  historyRetentionDays: 30,
  clearOnClose: false,
  debugMode: false,
  analyticsEnabled: false,
  // Custom domain defaults
  customDomain: '',
  customDomainUrl: '',
  // SECURITY FIX: customDomainKey removed - now stored in session-only storage
  // AI/LLM defaults - user must provide their own free API key
  useLLMParser: true,
  // SECURITY FIX: llmApiKey removed - now stored in session-only storage
  llmModel: 'llama-3.1-8b-instant',
};

export const STORAGE_KEYS = {
  CURRENT_EMAIL: 'currentEmail',
  CURRENT_IDENTITY: 'currentIdentity',
  LAST_OTP: 'lastOTP',
  EMAIL_HISTORY: 'emailHistory',
  PASSWORD_HISTORY: 'passwordHistory',
  INBOX: 'inbox',
  SETTINGS: 'settings',
  BEHAVIOR_DATA: 'behaviorData',
  LAST_ACTIVE_TAB: 'lastActiveTab',
  EXTENSION_VERSION: 'extensionVersion',
  INSTALL_DATE: 'installDate',
  LAST_UPDATED: 'lastUpdated',
} as const;

export type StorageKey = keyof typeof STORAGE_KEYS;
